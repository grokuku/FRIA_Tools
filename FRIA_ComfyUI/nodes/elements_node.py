"""
FR.IA Elements Picker Node — Custom widget (JavaScript).
L'UI interactive est rendue par web/js/fria_elements_widget.js.
Le seed est une entrée standard ComfyUI → changement de seed = ré-exécution.
Le _result est un widget optionnel sérialisé par ComfyUI (masqué en JS).
"""


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
                # Widget masqué côté JS, mais sérialisé par ComfyUI pour passer
                # le résultat de "Test generation" lors du run du workflow
                "_result": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("elements",)

    def generate(self, seed, _result=""):
        return (_result or "",)