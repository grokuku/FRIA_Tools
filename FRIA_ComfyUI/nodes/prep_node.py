"""
FR.IA Prompt Prep Node — Prépare les prompts (system + user) pour n'importe quel LLM.

Au lieu d'appeler un LLM en interne, ce node fait un seul appel léger au
backend FR.IA (`/api/enhance/prompts`) qui retourne les 3 chaînes prêtes :

  - llm_prompt     : le prompt utilisateur fusionné (à brancher sur l'entrée
                     `prompt` du node LLM)
  - system_prompt  : le prompt système complet (à brancher sur
                     `system_prompt` du node LLM)
  - neg_prompt     : le negative prompt du style (à brancher sur KSampler
                     CLIP Text Encode négatif)

L'utilisateur branche ensuite n'importe quel node LLM (LM Studio, Ollama,
llama.cpp, OpenAI, etc.) entre ce Prep et le reste du workflow. Il a ainsi
le contrôle total sur la VRAM et le moteur d'inférence.

Entrées (identiques à FRIAEnhanceNode) :
  - seed (INT)
  - base_prompt (STRING multiligne)
  - prompt_type (COMBO)
  - preset_id (INT)
  - style_id (INT)
  - special_instructions (STRING)
  - elements (STRING, optionnel) — JSON du Elements Picker
  - _api_config (STRING, hidden) — JSON interne piloté par le DOM widget

Sorties :
  - llm_prompt (STRING)
  - system_prompt (STRING)
  - neg_prompt (STRING)
"""

import json
import logging


class FRIAPromptPrepNode:
    CATEGORY = "FR.IA"
    FUNCTION = "prepare"
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
                # Cache technique (api_url + api_key), caché visuellement par le DOM widget.
                # La socket d'entrée est supprimée côté JS via node.removeInput().
                "_api_config": ("STRING", {"default": "{}", "multiline": True}),
            },
            "optional": {
                # JSON sérialisé des éléments (connecté à la sortie elements_json du Elements Picker)
                "elements": ("STRING", {"forceInput": True, "multiline": True, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("llm_prompt", "system_prompt", "neg_prompt")

    def prepare(self, seed=0, base_prompt="", prompt_type="sdxl",
                preset_id=0, style_id=0, special_instructions="",
                elements="[]", _api_config="{}"):
        try:
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            api_cfg = {}

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")

        # Parser elements : soit un tableau direct, soit l'objet _elements_json complet
        elems = []
        elems_raw = ""
        try:
            elems_parsed = json.loads(elements) if elements else []
            if isinstance(elems_parsed, dict):
                elems = elems_parsed.get("elements", [])
            elif isinstance(elems_parsed, list):
                elems = elems_parsed
        except (json.JSONDecodeError, TypeError):
            # Pas du JSON → texte brut
            elems_raw = elements or ""

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

        # Construire le payload pour /api/enhance/prompts
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

        # Un seul appel : /api/enhance/prompts (pas d'appel LLM)
        try:
            import requests
            r = requests.post(f"{api_url}/enhance/prompts",
                              json=payload, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()

            llm_prompt = data.get("llm_prompt", "")
            system_prompt = data.get("system_prompt", "")
            neg_prompt = data.get("neg_prompt", "")

            logging.warning(
                f"[FR.IA Prep] preset_id={preset_id} model='{data.get('model', '?')}' "
                f"sys_len={len(system_prompt)} user_len={len(llm_prompt)} neg_len={len(neg_prompt)}"
            )

            return {
                "ui": {
                    "llm_prompt": [llm_prompt],
                    "system_prompt": [system_prompt],
                    "neg_prompt": [neg_prompt],
                },
                "result": (llm_prompt, system_prompt, neg_prompt),
            }
        except ImportError:
            msg = "Erreur: module 'requests' manquant. pip install requests"
            return {
                "ui": {"llm_prompt": [msg], "system_prompt": [""], "neg_prompt": [""]},
                "result": (msg, "", ""),
            }
        except Exception as e:
            err = str(e)
            if "401" in err:
                msg = "Erreur : clé API invalide ou manquante. Configurez-la dans le menu FR.IA."
            elif "429" in err:
                msg = "Erreur : rate limit atteint. Attendez un instant."
            elif "404" in err:
                msg = f"Erreur : endpoint /enhance/prompts introuvable sur {api_url}. Backend FR.IA pas à jour ?"
            else:
                msg = f"Erreur API : {err}"
            logging.warning(f"[FR.IA Prep] {msg}")
            return {
                "ui": {"llm_prompt": [msg], "system_prompt": [""], "neg_prompt": [""]},
                "result": (msg, "", ""),
            }
