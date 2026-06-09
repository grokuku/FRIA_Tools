"""
FR.IA Ideogram 4 Caption Builder — Construit un JSON caption Ideogram 4 via LLM.

Widgets visibles (ComfyUI natifs) :
  - seed (avec control_after generate)
  - width / height (forceInput : sockets seulement)
  - description (STRING multiligne)
  - element_1..4 (STRING multiligne)

Widget interne unique : _api_config (JSON avec api_url, api_key, preset_id, style_id).
Stocker preset_id et style_id dans ce JSON evite les "points superposes" sur
les inputs (chaque input ComfyUI a un socket, donc 3 widgets caches = 3 sockets
qui s'ajoutent inutilement sur la gauche du node).

Sorties :
  - prompt (STRING) : le JSON caption Ideogram 4
  - width (INT), height (INT) : pour chainage vers d'autres nodes
  - preview (IMAGE) : rendu PIL du layout (bboxes + texte) a la resolution
    d'entree. Peut etre connecte a un node Preview/Save Image.
"""

import json
import io
import base64


class FRIAIdeogram4Node:
    CATEGORY = "FR.IA"
    FUNCTION = "build_caption"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64, "forceInput": True}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64, "forceInput": True}),
                "description": ("STRING", {"multiline": True, "default": ""}),
                "element_1": ("STRING", {"multiline": True, "default": ""}),
                "element_2": ("STRING", {"multiline": True, "default": ""}),
                "element_3": ("STRING", {"multiline": True, "default": ""}),
                "element_4": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                # JSON serialise par le JS : api_url, api_key, preset_id, style_id
                "_api_config": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "IMAGE")
    RETURN_NAMES = ("prompt", "width", "height", "preview")

    def build_caption(self, seed=0, width=1024, height=1024,
                      description="", element_1="", element_2="", element_3="", element_4="",
                      _api_config="{}"):
        try:
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            api_cfg = {}

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")
        preset_id = api_cfg.get("preset_id") or None
        style_id = api_cfg.get("style_id") or None

        # Construire le payload pour /api/enhance
        ep_elements = []
        for el in [element_1, element_2, element_3, element_4]:
            if el and el.strip():
                ep_elements.append({"type": "text", "text": el.strip()})

        payload = {
            "text": description.strip(),
            "seed": seed if seed > 0 else None,
            "prompt_type": "ideogram4",
            "width": width,
            "height": height,
            "ep_elements": ep_elements,
            "preset_id": preset_id,
            "style_id": style_id,
        }

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        # Appeler l'API
        try:
            import requests
            r = requests.post(f"{api_url}/enhance",
                              json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            prompt = data.get("output", "")
        except ImportError:
            prompt = "Erreur: module 'requests' manquant. pip install requests"
        except Exception as e:
            msg = str(e)
            if "401" in msg:
                prompt = "Erreur : cle API invalide ou manquante."
            elif "429" in msg:
                prompt = "Erreur : rate limit atteint. Attendez un instant."
            else:
                prompt = f"Erreur API : {msg}"

        # Rendu de l'image preview
        preview_tensor = _render_preview(prompt, width, height)

        return {
            "ui": {"prompt": [prompt]},
            "result": (prompt, width, height, preview_tensor)
        }


def _render_preview(prompt_text, width, height):
    """
    Rend le JSON caption Ideogram 4 en image PIL avec les bboxes.
    Retourne un torch.Tensor [1, H, W, 3] (format ComfyUI IMAGE).

    Si le prompt n'est pas du JSON valide, retourne une image avec un message.
    """
    import torch
    from PIL import Image, ImageDraw, ImageFont

    # Creer une image vide (fond gris fonce comme la preview DOM)
    img = Image.new("RGB", (width, height), (42, 42, 46))
    draw = ImageDraw.Draw(img)

    # Parser le JSON caption
    caption = None
    if prompt_text and prompt_text.strip():
        try:
            s = prompt_text.strip()
            # Strip code fences
            import re
            m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s)
            if m:
                s = m.group(1)
            caption = json.loads(s)
        except Exception:
            caption = None

    if not caption:
        # Afficher un message d'erreur au centre
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(16, width // 40))
        except Exception:
            font = ImageFont.load_default()
        msg = "JSON invalide ou absent"
        try:
            bbox = draw.textbbox((0, 0), msg, font=font)
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception:
            w, h = len(msg) * 8, 16
        draw.text(((width - w) / 2, (height - h) / 2), msg, fill=(136, 136, 136), font=font)
        return _to_comfy_image(img)

    elements = (caption.get("compositional_deconstruction") or {}).get("elements") or []
    background = (caption.get("compositional_deconstruction") or {}).get("background") or ""

    # Police
    try:
        font_pill = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(14, width // 60))
        font_desc = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(12, width // 70))
        font_bg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", max(11, width // 80))
    except Exception:
        font_pill = font_desc = font_bg = ImageFont.load_default()

    colors = [
        (34, 211, 238),   # cyan
        (132, 204, 22),   # lime
        (168, 85, 247),   # violet
        (234, 179, 8),    # jaune
        (249, 115, 22),   # orange
        (236, 72, 153),   # rose
        (6, 182, 212),    # teal
    ]

    for idx, el in enumerate(elements):
        bbox = el.get("bbox")
        if not bbox or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        yMin, xMin, yMax, xMax = bbox
        # bbox en coords 0-1000 -> pixels
        x = int(xMin / 1000 * width)
        y = int(yMin / 1000 * height)
        bw = int((xMax - xMin) / 1000 * width)
        bh = int((yMax - yMin) / 1000 * height)
        if bw < 4 or bh < 4:
            continue

        color = colors[idx % len(colors)]
        # Fond transparent (mélange avec le fond gris)
        fill = (color[0] // 8 + 42, color[1] // 8 + 42, color[2] // 8 + 46)
        draw.rectangle([x, y, x + bw, y + bh], outline=color, width=2, fill=fill)

        # Pill d'index
        idx_label = f"{idx + 1:02d}"
        pill_pad = 4
        try:
            pb = draw.textbbox((0, 0), idx_label, font=font_pill)
            pw = pb[2] - pb[0] + pill_pad * 2
            ph = pb[3] - pb[1] + 2
        except Exception:
            pw, ph = 20, 16
        pw = max(pw, 22)
        draw.rectangle([x, y, x + pw, y + ph], fill=color)
        draw.text((x + pw / 2, y + ph / 2), idx_label, fill=(0, 0, 0), font=font_pill, anchor="mm")

        # Contenu texte
        text_y = y + ph + 4
        if el.get("type") == "text" and el.get("text"):
            txt = f'"{el["text"]}"'
            draw.text((x + 6, text_y), txt, fill=color, font=font_pill)
            if el.get("desc"):
                draw.text((x + 6, text_y + 18), el["desc"], fill=(255, 255, 255, 200), font=font_desc)
        elif el.get("desc"):
            _wrap_text(draw, el["desc"], x + 6, text_y, bw - 12, font_desc, 14, 5)

    # Background en bas
    if background:
        bg_h = max(30, height // 25)
        draw.rectangle([0, height - bg_h, width, height], fill=(0, 0, 0))
        _wrap_text(draw, "BG: " + background, 6, height - bg_h + 4, width - 12, font_bg, 13, 3)

    return _to_comfy_image(img)


def _wrap_text(draw, text, x, y, max_w, font, line_h, max_lines):
    """Wrap text dans max_w pixels, max_lines lignes."""
    words = text.split()
    line = ""
    cur_y = y
    lines = 0
    for i, word in enumerate(words):
        test = (line + " " + word).strip() if line else word
        try:
            bbox = draw.textbbox((0, 0), test, font=font)
            w = bbox[2] - bbox[0]
        except Exception:
            w = len(test) * 7
        if w > max_w and line:
            draw.text((x, cur_y), line, fill=(255, 255, 255), font=font)
            line = word
            cur_y += line_h
            lines += 1
            if lines >= max_lines:
                # Tronquer
                draw.text((x, cur_y), line + ("..." if i < len(words) - 1 else ""), fill=(255, 255, 255), font=font)
                return
        else:
            line = test
    if line:
        draw.text((x, cur_y), line, fill=(255, 255, 255), font=font)


def _to_comfy_image(pil_img):
    """Convertit une PIL.Image en torch.Tensor [1, H, W, 3] (format ComfyUI)."""
    import torch
    import numpy as np
    arr = np.array(pil_img).astype(np.float32) / 255.0
    # ComfyUI IMAGE: [B, H, W, C]
    return torch.from_numpy(arr).unsqueeze(0)
