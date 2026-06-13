"""FR.IA Terminal Node — A ComfyUI node that opens a web-based terminal.

The actual terminal is rendered by the DOM widget (see
web/js/fria_terminal_widget.js). This node has no Python logic: it
just exists so users can drag it from the menu, resize it, and have
a terminal session per node instance.

WARNING: NO PASSWORD. Do not expose ComfyUI to a public network
without a reverse proxy providing authentication.
"""


class FRIATerminalNode:
    CATEGORY = "FR.IA"
    FUNCTION = "noop"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()

    def noop(self, seed):
        # Nothing to compute server-side. The terminal runs in the
        # browser via WebSocket to /fr_ia/terminal. Returning None
        # is the convention for OUTPUT_NODE-only nodes.
        return None
