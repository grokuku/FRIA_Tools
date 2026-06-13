"""
FR.IA Ideogram Prep Node — Prépare les prompts (system + user) pour Ideogram 4.

Au lieu d'appeler un LLM en interne, ce node fait un seul appel léger au
backend FR.IA (`/api/ideogram/prep`) qui retourne les chaînes prêtes pour
la passe 1 :

  - llm_prompt     : le prompt utilisateur (GENERAL DESCRIPTION, ELEMENTS TO
                     PLACE, IMAGE DIMENSIONS, STYLE, ADDITIONAL INSTRUCTIONS)
  - system_prompt  : le prompt système (règles JSON Ideogram 4 strictes)
  - context        : JSON bundle {original_input, width, height, style_text,
                     model} pour la passe 2 (construit par /api/ideogram/parse)

L'utilisateur branche ensuite n'importe quel node LLM (LM Studio, Ollama,
llama.cpp, OpenAI, etc.) entre ce Prep et la node FR.IA Ideogram Parse.
Il peut optionnellement faire une passe 2 (validation des bboxes) en
rebranchant la sortie `validation_prompt` du Parse vers un 2ème LLM, puis
vers le Parse avec pass_number=2.

Entrées (identiques au FRIAIdeogramPrepNode) :
  - seed (INT)
  - description (STRING multiligne)
  - element_1..4 (STRING) — widgets natifs
  - special_instructions (STRING)
  - _api_config (STRING, hidden) — JSON interne piloté par le DOM widget

Sorties :
  - llm_prompt (STRING)
  - system_prompt (STRING)
  - context (STRING, JSON sérialisé)
"""

import json
import logging


class FRIAIdeogramPrepNode:
    CATEGORY = "FR.IA"
    FUNCTION = "prepare"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "description": ("STRING", {"multiline": True, "default": ""}),
                "element_1": ("STRING", {"default": ""}),
                "element_2": ("STRING", {"default": ""}),
                "element_3": ("STRING", {"default": ""}),
                "element_4": ("STRING", {"default": ""}),
                "special_instructions": ("STRING", {"default": ""}),
                # Cache technique (api_url + api_key + style_id), caché visuellement
                # par le DOM widget. La socket d'entrée est supprimée côté JS.
                "_api_config": ("STRING", {"default": "{}", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("llm_prompt", "system_prompt", "context")

    def prepare(self, seed=0, width=1024, height=1024, description="",
                element_1="", element_2="", element_3="", element_4="",
                special_instructions="", _api_config="{}"):
        try:
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            api_cfg = {}

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")
        style_id = int(api_cfg.get("style_id", 0) or 0)

        # Construire ep_elements (format Ideogram 4 : liste de {type, text})
        ep_elements = []
        for el in [element_1, element_2, element_3, element_4]:
            if el and el.strip():
                ep_elements.append({"type": "text", "text": el.strip()})

        # Construire le payload pour /api/ideogram/prep
        payload = {
            "text": description.strip(),
            "seed": seed if seed > 0 else None,
            "prompt_type": "ideogram4",
            "width": width,
            "height": height,
            "ep_elements": ep_elements,
            "style_id": style_id if style_id > 0 else None,
            "special_instructions": special_instructions,
            # api_url/api_key sont passes au backend pour que la Parse node
            # puisse rappeler /api/ideogram/parse sur la meme URL.
            "api_url": api_url,
            "api_key": api_key,
        }

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            import requests
            r = requests.post(f"{api_url}/ideogram/prep",
                              json=payload, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()

            llm_prompt = data.get("llm_prompt", "")
            system_prompt = data.get("system_prompt", "")
            context = data.get("context", "{}")

            logging.warning(
                f"[FR.IA Ideogram Prep] style_id={style_id} model='{data.get('model', '?')}' "
                f"sys_len={len(system_prompt)} user_len={len(llm_prompt)}"
            )

            return {
                "ui": {
                    "llm_prompt": [llm_prompt],
                    "system_prompt": [system_prompt],
                },
                "result": (llm_prompt, system_prompt, context),
            }
        except ImportError:
            msg = "Erreur: module 'requests' manquant. pip install requests"
            return {
                "ui": {"llm_prompt": [msg], "system_prompt": [""], "context": ["{}"]},
                "result": (msg, "", "{}"),
            }
        except Exception as e:
            err = str(e)
            if "401" in err:
                msg = "Erreur : clé API invalide ou manquante. Configurez-la dans le menu FR.IA."
            elif "404" in err:
                msg = f"Erreur : endpoint /ideogram/prep introuvable sur {api_url}. Backend FR.IA pas à jour ?"
            else:
                msg = f"Erreur API : {err}"
            logging.warning(f"[FR.IA Ideogram Prep] {msg}")
            return {
                "ui": {"llm_prompt": [msg], "system_prompt": [""], "context": ["{}"]},
                "result": (msg, "", "{}"),
            }
