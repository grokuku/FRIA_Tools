"""
FR.IA Ideogram 4 Caption Builder — Construit un JSON caption Ideogram 4 via LLM.

Entrees :
  - seed (INT) : widget natif ComfyUI
  - width / height (INT) : widgets natifs, connectables
  - description (STRING multiligne) : widget natif ComfyUI
  - element_1..4 (STRING) : widget natif ComfyUI, connectables
  - _api_config (STRING, cache) : JSON interne

Sorties :
  - prompt (STRING), width (INT), height (INT), preview (IMAGE)
"""

import json


class FRIAIdeogram4Node:
    CATEGORY = "FR.IA"
    FUNCTION = "build_caption"
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
            },
            "optional": {
                "_api_config": ("STRING", {"default": "{}", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "IMAGE", "STRING")
    RETURN_NAMES = ("prompt", "width", "height", "preview", "debug")

    def build_caption(self, seed=0, width=1024, height=1024,
                      description="", element_1="", element_2="",
                      element_3="", element_4="",
                      _api_config="{}"):
        try:
            api_cfg = json.loads(_api_config) if _api_config else {}
        except json.JSONDecodeError:
            api_cfg = {}

        api_url = (api_cfg.get("api_url") or "https://kw.holaf.fr/api").rstrip("/")
        api_key = api_cfg.get("api_key", "")
        preset_id = api_cfg.get("preset_id") or None
        style_id = api_cfg.get("style_id") or None

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

        preview_tensor = _render_preview(prompt, width, height)

        # Recuperer le debug_md depuis la reponse API
        debug_md = data.get('debug_md', '') if isinstance(data, dict) else ''

        return {
            "ui": {"prompt": [prompt]},
            "result": (prompt, width, height, preview_tensor, debug_md)
        }


def _render_preview(prompt_text, width, height):
    import torch
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (width, height), (42, 42, 46))
    draw = ImageDraw.Draw(img)

    caption = None
    if prompt_text and prompt_text.strip():
        try:
            s = prompt_text.strip()
            import re
            m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s)
            if m:
                s = m.group(1)
            caption = json.loads(s)
        except Exception:
            caption = None

    if not caption:
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

    try:
        font_pill = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(14, width // 60))
        font_desc = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(12, width // 70))
        font_bg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", max(11, width // 80))
    except Exception:
        font_pill = font_desc = font_bg = ImageFont.load_default()

    colors = [
        (34, 211, 238), (132, 204, 22), (168, 85, 247),
        (234, 179, 8), (249, 115, 22), (236, 72, 153), (6, 182, 212),
    ]

    for idx, el in enumerate(elements):
        bbox = el.get("bbox")
        if not bbox or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        yMin, xMin, yMax, xMax = bbox
        x = int(xMin / 1000 * width)
        y = int(yMin / 1000 * height)
        bw = int((xMax - xMin) / 1000 * width)
        bh = int((yMax - yMin) / 1000 * height)
        if bw < 4 or bh < 4:
            continue

        color = colors[idx % len(colors)]
        fill = (color[0] // 8 + 42, color[1] // 8 + 42, color[2] // 8 + 46)
        draw.rectangle([x, y, x + bw, y + bh], outline=color, width=2, fill=fill)

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

        text_y = y + ph + 4
        if el.get("type") == "text" and el.get("text"):
            txt = f'"{el["text"]}"'
            draw.text((x + 6, text_y), txt, fill=color, font=font_pill)
            if el.get("desc"):
                draw.text((x + 6, text_y + 18), el["desc"], fill=(255, 255, 255, 200), font=font_desc)
        elif el.get("desc"):
            _wrap_text(draw, el["desc"], x + 6, text_y, bw - 12, font_desc, 14, 5)

    if background:
        bg_h = max(30, height // 25)
        draw.rectangle([0, height - bg_h, width, height], fill=(0, 0, 0))
        _wrap_text(draw, "BG: " + background, 6, height - bg_h + 4, width - 12, font_bg, 13, 3)

    return _to_comfy_image(img)


def _wrap_text(draw, text, x, y, max_w, font, line_h, max_lines):
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
                draw.text((x, cur_y), line + ("..." if i < len(words) - 1 else ""), fill=(255, 255, 255), font=font)
                return
        else:
            line = test
    if line:
        draw.text((x, cur_y), line, fill=(255, 255, 255), font=font)


def _to_comfy_image(pil_img):
    import torch
    import numpy as np
    arr = np.array(pil_img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)