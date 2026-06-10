"""
FR.IA Prompt Enhancer Node — Optimise un prompt via LLM.
DOM widget + connexion aux éléments du Elements Picker.
"""

import json


class FRIAEnhanceNode:
    CATEGORY = "FR.IA"
    FUNCTION = "enhance"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "base_prompt": ("STRING", {"multiline": True, "default": ""}),
                "prompt_type": (["sdxl", "sd15", "flux", "anima", "qwen", "liste"], {"default": "sdxl"}),
                "preset_id": ("INT", {"default": 0, "min": 0}),
                "style_id": ("INT", {"default": 0, "min": 0}),
                "special_instructions": ("STRING", {"default": ""}),
            },
            "optional": {
                # JSON sérialisé des éléments (connecté à la sortie elements_json du Elements Picker)
                "elements": ("STRING", {"forceInput": True, "multiline": True, "default": "[]"}),
                # NB : _api_config n'est PAS déclaré ici volontairement.
                # Il est créé dynamiquement par le JS via node.addWidget() pour éviter
                # qu'une socket d'entrée visible soit créée côté ComfyUI (voir le
                # commentaire correspondant dans fria_enhance_widget.js).
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "negative_prompt")

    def enhance(self, seed=0, base_prompt="", prompt_type="sdxl",
                preset_id=0, style_id=0, special_instructions="",
                elements="[]", _api_config="{}"):
        try:
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            api_cfg = {}

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")

        # Parse elements JSON (soit un tableau direct, soit l'objet _elements_json complet)
        # Si ce n'est pas du JSON, c'est du texte brut (ex: sortie "elements" du Picker)
        elems = []
        elems_raw = ""
        try:
            elems_parsed = json.loads(elements) if elements else []
            if isinstance(elems_parsed, dict):
                elems = elems_parsed.get("elements", [])
            elif isinstance(elems_parsed, list):
                elems = elems_parsed
            else:
                pass
        except (json.JSONDecodeError, TypeError):
            # Pas du JSON → texte brut
            elems_raw = elements or ""

        # Transformer les éléments structurés en texte
        def _fmt_elems(elist):
            lines = []
            for e in elist:
                if e.get("type") == "filter":
                    name = e.get("name") or f"ID {e.get('id', '?')}"
                    lines.append(f"[Filtre: {name}]")
                elif e.get("type") == "text":
                    lines.append(f"[Recherche: {e.get('text', '')}]")
                elif e.get("type") == "random":
                    lines.append("[Éléments aléatoires]")
            return "\n".join(lines)

        elems_text = _fmt_elems(elems)
        # Concaténer : éléments formatés + texte brut + prompt de base
        parts = [p for p in [elems_text, elems_raw, base_prompt] if p]
        combined_text = "\n\n".join(parts)

        # Construire le payload pour /api/enhance
        payload = {
            "text": combined_text,
            "seed": seed if seed > 0 else None,
            "prompt_type": prompt_type,
            "preset_id": preset_id if preset_id > 0 else None,
            "style_id": style_id if style_id > 0 else None,
            "special_instructions": special_instructions,
        }

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            import requests
            # Streaming ndjson : on lit les chunks jusqu'au status='done'
            r = requests.post(f"{api_url}/enhance",
                              json=payload, headers=headers, stream=True, timeout=(10, 180))
            r.raise_for_status()
            prompt = ""
            neg_prompt = ""
            for line in r.iter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line.decode('utf-8'))
                except Exception:
                    continue
                status = chunk.get("status", "")
                if status == "done":
                    prompt = chunk.get("output", "")
                    neg_prompt = chunk.get("negative_prompt", "")
                    break
                elif status == "error":
                    return {
                        "ui": {"prompt": [f"Erreur: {chunk.get('error', '')[:200]}"], "negative_prompt": [""]},
                        "result": (f"Erreur: {chunk.get('error', '')[:200]}", "")
                    }
            return {
                "ui": {"prompt": [prompt], "negative_prompt": [neg_prompt]},
                "result": (prompt, neg_prompt)
            }
        except ImportError:
            msg = "Erreur: module 'requests' manquant. pip install requests"
            return {
                "ui": {"prompt": [msg], "negative_prompt": [""]},
                "result": (msg, "")
            }
        except Exception as e:
            msg = str(e)
            if "401" in msg:
                msg = "Erreur : clé API invalide ou manquante."
            elif "429" in msg:
                msg = "Erreur : rate limit atteint. Attendez un instant."
            else:
                msg = f"Erreur API : {msg}"
            return {
                "ui": {"prompt": [msg], "negative_prompt": [""]},
                "result": (msg, "")
            }
