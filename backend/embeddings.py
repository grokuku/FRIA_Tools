"""
Module d'embeddings via Hugging Face Inference API.
Utilise le modèle multilingue paraphrase-MiniLM-L12-v2 (384 dimensions).

Configuration :
  - Variable d'environnement HF_TOKEN
  - ou fichier ~/.hf_token contenant le token
"""

import os
import json
import urllib.request
import urllib.error

# Modèle multilingue performant (pas de préfixe spécial requis)
HF_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL}"

# Token surchargeable dynamiquement (depuis la BDD admin)
_OVERRIDE_TOKEN = None


def set_token(token: str | None):
    """Surcharge le token HF (appelé depuis l'app avec le token stocké en BDD)."""
    global _OVERRIDE_TOKEN
    _OVERRIDE_TOKEN = token


def _get_hf_token() -> str | None:
    """Lit le token HF : override > env var > fichier ~/.hf_token."""
    if _OVERRIDE_TOKEN:
        return _OVERRIDE_TOKEN
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    try:
        path = os.path.expanduser("~/.hf_token")
        if os.path.exists(path):
            with open(path) as f:
                return f.read().strip()
    except OSError:
        pass
    return None


def generate_embedding(text: str) -> list[float]:
    """Appelle l'API HF et retourne un vecteur d'embedding (384 floats)."""
    token = _get_hf_token()
    if not token:
        raise ValueError(
            "Token Hugging Face non trouvé.\n"
            "Définissez la variable d'environnement HF_TOKEN\n"
            "ou créez ~/.hf_token avec votre token (https://hf.co/settings/tokens)."
        )

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = json.dumps({"inputs": text}).encode("utf-8")

    req = urllib.request.Request(HF_API_URL, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"Erreur API HF ({e.code}): {body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Erreur réseau HF: {e.reason}")

    # Réponse normale : [[0.1, 0.2, ...]]
    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], list):
        return [float(x) for x in result[0]]

    # Le modèle peut être en cours de chargement
    if isinstance(result, dict) and "error" in result:
        err = result["error"]
        if "loading" in err.lower():
            raise RuntimeError(
                "Modèle HF en cours de chargement, réessayez dans quelques secondes."
            )
        raise RuntimeError(f"Erreur API HF: {err}")

    raise RuntimeError(f"Réponse API HF inattendue: {json.dumps(result)[:200]}")


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Cosine similarity entre deux vecteurs."""
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def is_available() -> bool:
    """Vérifie rapidement si le token est configuré (sans appel API)."""
    return _get_hf_token() is not None
