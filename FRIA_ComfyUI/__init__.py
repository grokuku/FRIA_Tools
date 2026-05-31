from .nodes.elements_node import FRIAElementsNode
from .nodes.enhance_node import FRIAEnhanceNode

from .nodes.diagnostic_node import FRIADiagnosticNode

NODE_CLASS_MAPPINGS = {
    "FRIAElementsNode": FRIAElementsNode,
    "FRIAEnhanceNode": FRIAEnhanceNode,
    "FRIADiagnosticNode": FRIADiagnosticNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FRIAElementsNode": "FR.IA Elements Picker",
    "FRIAEnhanceNode": "FR.IA Prompt Enhancer",
    "FRIADiagnosticNode": "FR.IA Diagnostic",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
