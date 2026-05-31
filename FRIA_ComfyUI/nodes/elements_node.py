"""
FR.IA Elements Picker Node — Custom widget (JavaScript).
L'UI interactive est rendue par web/js/fria_elements_widget.js.
Le seed est une entrée standard ComfyUI → changement de seed = ré-exécution.
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
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("elements",)

    def generate(self, seed):
        # Le widget JS stocke le résultat dans un widget caché _result
        prompt = ""
        if hasattr(self, "widgets") and self.widgets:
            for w in self.widgets:
                if w.name == "_result":
                    prompt = w.value or ""
                    break
        return (prompt,)
