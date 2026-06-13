"""
FR.IA Ideogram Parse Node — Parse la réponse LLM (passe 1 ou 2) pour Ideogram 4.

Reçoit en entrée :
  - llm_response (STRING) : la string brute sortie par le LLM
  - context (STRING)      : JSON bundle retourné par /api/ideogram/prep
  - width (INT), height (INT) : dimensions pour le preview
  - pass_number (INT, défaut=1) : quelle passe on parse

Fait :
  1. Appelle /api/ideogram/parse qui extrait le JSON, le valide, convertit
     les bboxes pixels -> 0-1000, et (si pass=1) construit le validation_prompt
  2. Rend le preview visuel des bboxes (côté local avec PIL)

Sorties :
  - prompt (STRING) : JSON propre (bboxes en 0-1000)
  - validation_prompt (STRING) : prompt de validation pour passe 2 (vide si pass=2)
  - validation_system (STRING) : system prompt pour passe 2 (vide si pass=2)
  - preview (IMAGE) : rendu visuel des bboxes
  - debug (STRING) : debug markdown
"""

import json
import logging


class FRIAIdeogramParseNode:
    CATEGORY = "FR.IA"
    FUNCTION = "parse"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "llm_response": ("STRING", {"forceInput": True, "multiline": True, "default": ""}),
                "context": ("STRING", {"forceInput": True, "multiline": True, "default": "{}"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "pass_number": ("INT", {"default": 1, "min": 1, "max": 2}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("prompt", "validation_prompt", "validation_system", "preview", "debug")

    def parse(self, llm_response, context, width, height, pass_number):
        # Lire api_url/api_key depuis localStorage côté JS et les passer via
        # _api_config. Mais ici on n'a pas _api_config widget, on le récupère
        # depuis localStorage côté Python n'est pas possible.
        # Solution : on ajoute _api_config comme widget hidden, qui est sync
        # par le DOM widget (ou on le dérive du context).
        # Pour l'instant, on le dérive du context JSON qui contient le model.
        try:
            ctx = json.loads(context) if isinstance(context, str) else context
        except json.JSONDecodeError:
            ctx = {}

        # L'api_url doit être passé via un widget caché _api_config qu'on
        # ajoute au node. On l'infère du context sinon fallback.
        # (Voir widget JS qui remplit _api_config depuis localStorage.)
        api_url = "https://kw.holaf.fr/api"
        api_key = ""
        # On tente de lire _api_config via les widgets du node
        # (sera fourni par le DOM widget)
        # Note : on ne peut pas accéder aux widgets ici, mais on peut
        # passer api_url/api_key via des entrées hidden.
        # Workaround : on les lit depuis le context si présents
        api_url = ctx.get("api_url", api_url)
        api_key = ctx.get("api_key", api_key)

        payload = {
            "llm_response": llm_response,
            "context": context,
            "width": width,
            "height": height,
            "pass_number": pass_number,
        }

        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            import requests
            r = requests.post(f"{api_url}/ideogram/parse",
                              json=payload, headers=headers, timeout=30)
            r.raise_for_status()
            data = r.json()

            prompt_out = data.get("prompt", "")
            validation_prompt = data.get("validation_prompt", "")
            validation_system = data.get("validation_system", "")
            is_valid = data.get("is_valid_json", False)
            error_msg = data.get("error", "")
            debug = data.get("debug", "")

            logging.warning(
                f"[FR.IA Ideogram Parse] pass={pass_number} is_valid={is_valid} "
                f"prompt_len={len(prompt_out)} val_prompt_len={len(validation_prompt)}"
            )

            # Preview local avec PIL (rendu des bboxes)
            preview_tensor = _render_preview(prompt_out, width, height, is_valid, error_msg)

            return {
                "ui": {
                    "prompt": [prompt_out],
                    "validation_prompt": [validation_prompt],
                    "validation_system": [validation_system],
                    "debug": [debug],
                },
                "result": (prompt_out, validation_prompt, validation_system, preview_tensor, debug),
            }
        except ImportError:
            msg = "Erreur: module 'requests' manquant. pip install requests"
            empty_tensor = _empty_image(width, height)
            return {
                "ui": {"prompt": [msg], "debug": [msg]},
                "result": (msg, "", "", empty_tensor, msg),
            }
        except Exception as e:
            err = str(e)
            msg = f"Erreur API : {err}"
            logging.warning(f"[FR.IA Ideogram Parse] {msg}")
            empty_tensor = _empty_image(width, height)
            return {
                "ui": {"prompt": [msg], "debug": [msg]},
                "result": (msg, "", "", empty_tensor, msg),
            }


def _render_preview(prompt_text, width, height, is_valid=True, error_msg=""):
    """
    Rend un preview visuel des bboxes Ideogram 4.
    Adapté de l'ancien ideogram4_node._render_preview.
    """
    import torch
    from PIL import Image, ImageDraw, ImageFont
    import re

    bg_color = (42, 42, 46)
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)

    caption = None
    if prompt_text and prompt_text.strip():
        try:
            s = prompt_text.strip()
            m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s)
            if m:
                s = m.group(1)
            caption = json.loads(s)
        except Exception:
            caption = None

    if not caption:
        # Afficher un message d'erreur
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(16, width // 40))
        except Exception:
            font = ImageFont.load_default()
        msg = error_msg if error_msg else "JSON invalide ou absent"
        msg = msg[:200]
        try:
            tb = draw.textbbox((0, 0), msg, font=font)
            w, h = tb[2] - tb[0], tb[3] - tb[1]
        except Exception:
            w, h = len(msg) * 8, 16
        draw.text(((width - w) / 2, (height - h) / 2), msg, fill=(136, 136, 136), font=font)
        return _to_comfy_image(img)

    elements = (caption.get("compositional_deconstruction") or {}).get("elements") or []
    background = (caption.get("compositional_deconstruction") or {}).get("background") or ""

    try:
        font_pill = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(20, width // 40))
        font_desc = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(18, width // 50))
        font_bg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", max(16, width // 60))
    except Exception:
        font_pill = font_desc = font_bg = ImageFont.load_default()

    colors = [
        (34, 211, 238), (132, 204, 22), (168, 85, 247),
        (234, 179, 8), (249, 115, 22), (236, 72, 153), (6, 182, 212),
    ]

    # NOTE : les bboxes sont en 0-1000 (déjà converties par le backend),
    # donc on les dénormalise pour le rendu pixels.
    bbox_coords = []
    for idx, el in enumerate(elements):
        bbox = el.get("bbox")
        if not bbox or not isinstance(bbox, list) or len(bbox) != 4:
            bbox_coords.append(None)
            continue
        yMin, xMin, yMax, xMax = bbox
        # Dénormaliser 0-1000 -> pixels
        x = int(xMin / 1000 * width)
        y = int(yMin / 1000 * height)
        bw = int((xMax - xMin) / 1000 * width)
        bh = int((yMax - yMin) / 1000 * height)
        if bw < 4 or bh < 4:
            bbox_coords.append(None)
            continue
        bbox_coords.append((x, y, bw, bh, idx))

    # PASSE 1 : fills (opaques, blendes avec le fond gris)
    alpha_fill = 80  # 0-255
    for coords in bbox_coords:
        if coords is None:
            continue
        x, y, bw, bh, idx = coords
        color = colors[idx % len(colors)]
        fill = (
            color[0] * alpha_fill // 255 + bg_color[0] * (255 - alpha_fill) // 255,
            color[1] * alpha_fill // 255 + bg_color[1] * (255 - alpha_fill) // 255,
            color[2] * alpha_fill // 255 + bg_color[2] * (255 - alpha_fill) // 255,
        )
        draw.rectangle([x, y, x + bw, y + bh], fill=fill)

    # PASSE 2 : outlines + text (toujours par dessus)
    for coords in bbox_coords:
        if coords is None:
            continue
        x, y, bw, bh, idx = coords
        color = colors[idx % len(colors)]
        el = elements[idx]

        draw.rectangle([x, y, x + bw, y + bh], outline=color, width=3)

        idx_label = f"{idx + 1:02d}"
        pill_pad = 6
        try:
            pb = draw.textbbox((0, 0), idx_label, font=font_pill)
            pw = pb[2] - pb[0] + pill_pad * 2
            ph = pb[3] - pb[1] + 4
        except Exception:
            pw, ph = 28, 22
        pw = max(pw, 28)
        draw.rectangle([x, y, x + pw, y + ph], fill=color)
        draw.text((x + pw / 2, y + ph / 2), idx_label, fill=(0, 0, 0), font=font_pill, anchor="mm")

        text_y = y + ph + 6
        if el.get("type") == "text" and el.get("text"):
            txt = f'"{el["text"]}"'
            draw.text((x + 6, text_y), txt, fill=color, font=font_pill)
            if el.get("desc"):
                draw.text((x + 6, text_y + 22), el["desc"], fill=(255, 255, 255), font=font_desc)
        elif el.get("desc"):
            _wrap_text(draw, el["desc"], x + 6, text_y, bw - 12, font_desc, 18, 5)

    if background:
        bg_h = max(40, height // 20)
        draw.rectangle([0, height - bg_h, width, height], fill=(0, 0, 0))
        _wrap_text(draw, "BG: " + background, 6, height - bg_h + 4, width - 12, font_bg, 18, 3)

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


def _empty_image(width, height):
    import torch
    from PIL import Image
    img = Image.new("RGB", (width, height), (42, 42, 46))
    return _to_comfy_image(img)
