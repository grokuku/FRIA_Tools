"""
FR.IA Elements Picker Node — Custom widget (JavaScript).
L'UI interactive est rendue par web/js/fria_elements_widget.js.

Au "Run" (workflow), Python appelle directement l'API /api/generate
avec le seed courant + les éléments sérialisés → résultat déterministe.
Au "Test generation", JS appelle l'API pour un aperçu instantané.
"""

import json


class FRIAElementsNode:
    CATEGORY = "FR.IA"
    FUNCTION = "generate"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                # JSON sérialisé par le JS : elements + random_count
                # Masqué dans l'UI ComfyUI
                "_elements_json": ("STRING", {"default": "{}", "multiline": True}),
                # JSON sérialisé par le JS : api_url + api_key
                # Masqué dans l'UI ComfyUI
                "_api_config": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("elements",)

    def generate(self, seed, _elements_json="{}", _api_config="{}"):
        try:
            elems_cfg = json.loads(_elements_json) if _elements_json else {}
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            return ("Erreur : config JSON invalide",)

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")
        elements = elems_cfg.get("elements", [])
        random_count = int(elems_cfg.get("random_count", 0))

        # Vérifier qu'il y a du contenu à générer
        if not elements and random_count <= 0:
            return ("",)

        # Construire le payload pour /api/generate
        payload = {"elements": elements}
        if seed > 0:
            payload["seed"] = seed
        if random_count > 0:
            payload["random_count"] = random_count

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            import requests
            r = requests.post(f"{api_url}/generate", json=payload, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()
            return (data.get("prompt", ""),)
        except ImportError:
            return ("Erreur : module 'requests' manquant. pip install requests",)
        except Exception as e:
            msg = str(e)
            if "401" in msg:
                return ("Erreur : clé API invalide ou manquante. Configurez-la dans le menu FR.IA.",)
            if "429" in msg:
                return ("Erreur : rate limit atteint. Attendez un instant.",)
            return (f"Erreur API : {msg}",)