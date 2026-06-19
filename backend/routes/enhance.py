"""Routes enhance for FR.IA backend."""

from context import *


# ── Enhance ─────────────────────────────────────────────────────────

def convert_bboxes_to_normalized(json_text, width, height):
    """
    Convertit les bboxes du JSON caption de pixels vers 0-1000 normalise.
    Le LLM genere les bboxes en coordonnees pixels (car c'est plus intuitif),
    mais l'API Ideogram 4 attend du 0-1000 normalise.

    Pour chaque element avec un bbox [y_min, x_min, y_max, x_max] en pixels :
      y_min_norm = round(y_min / height * 1000)
      x_min_norm = round(x_min / width * 1000)
      y_max_norm = round(y_max / height * 1000)
      x_max_norm = round(x_max / width * 1000)
    """
    import re
    if not json_text or not width or not height:
        return json_text
    try:
        s = json_text.strip()
        # Strip code fences si present
        m = re.search(r'```(?:json)?\s*([\s\S]+?)\s*```', s)
        if m:
            s = m.group(1)
        data = json.loads(s)
    except Exception:
        return json_text

    elements = (data.get("compositional_deconstruction") or {}).get("elements") or []
    changed = False
    for el in elements:
        bbox = el.get("bbox")
        if not bbox or not isinstance(bbox, list) or len(bbox) != 4:
            continue
        y_min, x_min, y_max, x_max = bbox
        # Detecter si deja en 0-1000 (toutes valeurs <= 1000)
        # Si max value > 1000, c'est des pixels -> convertir
        max_val = max(y_min, x_min, y_max, x_max)
        if max_val <= 1000:
            continue  # deja normalise, on touche pas
        # Clamp aux dimensions de l'image
        y_min = max(0, min(y_min, height))
        x_min = max(0, min(x_min, width))
        y_max = max(y_min + 1, min(y_max, height))
        x_max = max(x_min + 1, min(x_max, width))
        # Convertir en 0-1000
        el["bbox"] = [
            round(y_min / height * 1000),
            round(x_min / width * 1000),
            round(y_max / height * 1000),
            round(x_max / width * 1000),
        ]
        changed = True

    if changed:
        # Re-serialiser en gardant le meme format
        try:
            return json.dumps(data, ensure_ascii=False)
        except Exception:
            return json_text
    return json_text


def _build_debug_markdown(sections, conversion_debug, width, height):
    """Assemble un markdown de debug a partir des sections collectees."""
    lines = []
    lines.append("# FR.IA Ideogram 4 — Debug")
    lines.append("")
    lines.append(f"**Image** : {width}x{height}")
    lines.append("")

    for sec in sections:
        if 'title' in sec:
            # Passe 1 : generation
            lines.append(f"## {sec['title']}")
            lines.append("")
            lines.append(f"**Model** : `{sec.get('model', '?')}`  ")
            lines.append(f"**Temperature** : {sec.get('temperature', '?')}  ")
            lines.append(f"**Max tokens** : {sec.get('max_tokens', '?')}")
            lines.append("")
            lines.append("### System Prompt")
            lines.append("```")
            lines.append(sec.get('system_prompt', ''))
            lines.append("```")
            lines.append("")
            lines.append("### User Prompt")
            lines.append("```")
            lines.append(sec.get('user_prompt', ''))
            lines.append("```")
            lines.append("")
            if 'raw_output' in sec:
                lines.append("### Sortie brute LLM")
                lines.append("```")
                lines.append(sec['raw_output'])
                lines.append("```")
                lines.append("")
        elif 'pass' in sec:
            # Passe de validation
            lines.append(f"## Passe {sec['pass']} : Validation spatiale")
            lines.append("")
            for i, call in enumerate(sec.get('api_calls', [])):
                lines.append(f"### Appel LLM {i+1}")
                lines.append("")
                lines.append(f"**Model** : `{call.get('model', '?')}`  ")
                lines.append(f"**Temperature** : {call.get('temperature', '?')}")
                lines.append("")
                lines.append("#### System Prompt")
                lines.append("```")
                lines.append(call.get('system_prompt', ''))
                lines.append("```")
                lines.append("")
                lines.append("#### User Prompt")
                lines.append("```")
                lines.append(call.get('user_prompt', ''))
                lines.append("```")
                lines.append("")
                if 'raw_output' in call:
                    lines.append("#### Sortie brute LLM")
                    lines.append("```")
                    lines.append(call['raw_output'])
                    lines.append("```")
                    lines.append("")
                if 'error' in call:
                    lines.append(f"**Erreur** : {call['error']}")
                    lines.append("")
                if 'status' in call:
                    lines.append(f"**Statut** : {call['status']}")
                    lines.append("")

    if conversion_debug:
        lines.append("## Conversion pixels \u2192 0-1000")
        lines.append("")
        lines.append(f"**Dimensions** : {conversion_debug['width']}x{conversion_debug['height']}")
        lines.append("")
        lines.append("### Avant conversion (pixels)")
        lines.append("```")
        lines.append(conversion_debug.get('before', ''))
        lines.append("```")
        lines.append("")
        lines.append("### Apres conversion (0-1000 normalise)")
        lines.append("```")
        lines.append(conversion_debug.get('after', ''))
        lines.append("```")
        lines.append("")

    return '\n'.join(lines)


@app.route('/api/enhance', methods=['POST'])
def enhance_prompt():
    """
    Endpoint streaming pour /api/enhance.
    Envoie un keepalive JSON toutes les 5s pendant l'appel LLM
    pour eviter que le client (ComfyUI) timeout sur cold start Ollama (~66s).
    Format: ndjson (1 ligne JSON par chunk)
    """
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    # Resultat partage entre thread et generator
    result_box = {'done': False, 'value': None, 'error': None}

    def worker():
        try:
            result_box['value'] = _do_enhance(user_id, data)
        except Exception as e:
            import traceback
            result_box['error'] = f'{e}\n{traceback.format_exc()}'
        finally:
            result_box['done'] = True

    thread = Thread(target=worker, daemon=True)
    thread.start()

    def generate():
        # Premier chunk immediat pour confirmer la connexion
        yield json.dumps({'status': 'pending', 'message': 'starting'}) + '\n'
        # Keepalive toutes les 5s pendant que le thread bosse
        while not result_box['done']:
            time.sleep(5)
            if not result_box['done']:
                yield json.dumps({'status': 'pending', 'message': 'waiting for LLM'}) + '\n'
        # Resultat
        if result_box['error']:
            yield json.dumps({'status': 'error', 'error': result_box['error']}) + '\n'
        else:
            val = result_box['value']
            # Cas special : _do_enhance a capture une erreur (ex: 429, LLM injoignable)
            # et l'a retournee comme dict {'_status': N, 'error': '...'} (sans jsonify
            # car on est dans un Thread sans contexte Flask).
            if isinstance(val, dict) and '_status' in val and 'error' in val:
                yield json.dumps({'status': 'error', 'error': val['error']}) + '\n'
            else:
                yield json.dumps({'status': 'done', **val}) + '\n'

    return Response(generate(), mimetype='application/x-ndjson')


@app.route('/api/enhance/prepare', methods=['POST'])
def enhance_prepare():
    """
    Etape 1 du flow /api/enhance en mode decouple.
    Construit le payload LLM et decide du routage :

    - Si le preset a is_client_side=1 : stocke la session en BDD et retourne
      {session_id, llm_request, llm_config, status: 'awaiting_llm'}.
      Le client doit alors faire l'appel LLM lui-meme, puis rappeler
      /api/enhance/finish avec {session_id, llm_response}.

    - Sinon : fait l'appel LLM en interne (comme /api/enhance), appelle
      _finish_enhance, et retourne directement le resultat final.
      (Pas de streaming : pour le streaming cloud, utiliser /api/enhance.)
    """
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    prepared = _prepare_enhance(user_id, data)
    if isinstance(prepared, tuple):  # erreur (jsonify, status)
        return prepared

    if prepared['is_client_side']:
        # ── Mode client-side : le client fait l'appel LLM ──────────
        session_id = _save_enhance_session(user_id, prepared)

        import logging
        logging.warning(f"[enhance/prepare] session={session_id} user={user_id} preset='{prepared['preset_name']}' is_client_side=1 -> awaiting_llm")

        return jsonify({
            'status': 'awaiting_llm',
            'session_id': session_id,
            'llm_request': prepared['llm_request'],
            'llm_config': prepared['llm_config'],
            'debug_meta': {
                'preset_id': prepared['preset_id'],
                'preset_name': prepared['preset_name'],
                'is_client_side': True,
                'validation_passes': prepared['validation_passes'],
                'model': prepared['model'],
            },
        })
    else:
        # ── Mode cloud : on fait l'appel LLM en interne puis finish ──
        try:
            llm_response = _call_llm_internal(prepared['llm_request'], prepared['llm_config'])
        except Exception as e:
            msg = str(e)
            import logging
            logging.warning(f"[enhance/prepare] LLM EXCEPTION: {msg!r}")
            if '429' in msg:
                return jsonify({'error': 'Rate limit atteint sur le serveur LLM. Attends un peu et reessaye.'}), 429
            if 'connect' in msg.lower() or 'refused' in msg.lower():
                return jsonify({'error': f'Serveur LLM inaccessible : verifie l\'URL ({prepared["llm_config"]["base_url"]})'}), 502
            return jsonify({'error': f'Erreur LLM: {msg}'}), 502
        result = _finish_enhance_pass1(user_id, prepared, llm_response)
        # Passes de validation en interne (mode cloud)
        if prepared['validation_passes'] > 0:
            result['output'] = _run_validation_passes_internal(
                prepared, result['output'], result['debug_sections']
            )
        final = _build_final_result(
            result, prepared['output_format'], prepared['width'], prepared['height']
        )
        final['status'] = 'done'
        return jsonify(final)


@app.route('/api/enhance/prompts', methods=['POST'])
def enhance_prompts():
    """
    Variante legerement decouplee de /api/enhance/prepare pour le node ComfyUI
    FR.IA Prompt Prep.

    Fait le meme travail de preparation (merge texte, fetch preset, build system
    prompt depuis template) mais NE FAIT PAS d'appel LLM et NE CREE PAS de
    session. Retourne directement les 3 chaines pretes a etre injectees dans
    n'importe quel node LLM compatible OpenAI :

        {
          "llm_prompt":     "...",  # le prompt utilisateur fusionne
          "system_prompt":  "...",  # le prompt systeme (template + examples + rules)
          "neg_prompt":     "...",  # le negative prompt (depuis le style selectionne)
          "model":          "...",  # le modele configure dans le preset
          "validation_passes": 0,   # le Prep ne gere pas les passes de validation
        }

    Le client ComfyUI prend ces 3 chaines et les branche sur n'importe quel
    node LLM (LM Studio, Ollama, llama.cpp, etc.). L'utilisateur a ainsi le
    controle total sur la VRAM et le moteur d'inference.
    """
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    import logging
    logging.warning(
        f"[enhance/prompts] REQUEST user={user_id} "
        f"keys={list(data.keys())} style_id={data.get('style_id')} "
        f"template_id={data.get('template_id') or data.get('prompt_type')} text_len={len(data.get('text', ''))}"
    )

    prepared = _prepare_enhance(user_id, data)
    if isinstance(prepared, tuple):  # erreur (jsonify, status)
        return prepared

    # Log diagnostic: le style est-il arrive jusqu'au system_prompt ?
    _sys_content = ''
    for _m in prepared.get('llm_request', {}).get('messages', []):
        if _m.get('role') == 'system':
            _sys_content = _m.get('content', '')
            break
    _has_style_rule = 'STYLE PRESERVATION RULE' in _sys_content
    logging.warning(
        f"[enhance/prompts] DIAG style_id_sent={data.get('style_id')} "
        f"style_text_len={len(prepared.get('style_text') or '')} "
        f"has_style_rule_in_sys={_has_style_rule} "
        f"preset_id_resolved={prepared.get('preset_id')}"
    )

    # Extraire system + user depuis llm_request['messages']
    messages = prepared.get('llm_request', {}).get('messages', [])
    system_prompt = ''
    llm_prompt = ''
    for m in messages:
        if m.get('role') == 'system':
            system_prompt = m.get('content', '')
        elif m.get('role') == 'user':
            llm_prompt = m.get('content', '')

    neg_prompt = prepared.get('negative_prompt') or ''

    import logging
    logging.warning(
        f"[enhance/prompts] user={user_id} preset='{prepared['preset_name']}' "
        f"model='{prepared['model']}' sys_len={len(system_prompt)} "
        f"user_len={len(llm_prompt)} neg_len={len(neg_prompt)}"
    )

    return jsonify({
        'llm_prompt': llm_prompt,
        'system_prompt': system_prompt,
        'neg_prompt': neg_prompt,
        'model': prepared['model'],
        'validation_passes': 0,  # le Prep ne gere pas les passes de validation
        'preset_name': prepared['preset_name'],
    })


@app.route('/api/enhance/finish', methods=['POST'])
def enhance_finish():
    """
    Etape 2 du flow /api/enhance en mode client-side (multi-passes).

    Reçoit {session_id, llm_response, pass} :
    - llm_response : la reponse OpenAI brute renvoyee par le serveur LLM du client
    - pass : numero de passe qu'on vient de finir (1, 2 ou 3). Defaut : 1.

    Pour le mode cloud (preset is_client_side=0) : fait TOUTES les passes en
    interne et retourne directement le resultat final.

    Pour le mode local (preset is_client_side=1) :
    - pass=1 : post-traitement passe 1 + sauvegarde state
      - si validation_passes <= 1 : retourne {status: done, ...}
      - sinon : retourne {status: awaiting_validation, pass: 2, llm_request, llm_config}
    - pass=2+ : parse la reponse, met a jour le state
      - si c'etait la derniere passe : retourne {status: done, ...}
      - sinon : retourne {status: awaiting_validation, pass: N+1, llm_request, llm_config}
    """
    guard = _login_required()
    if guard: return guard
    user_id = _get_current_user_id()
    data = request.get_json() or {}

    session_id = data.get('session_id', '').strip()
    llm_response = data.get('llm_response')
    pass_idx = int(data.get('pass', 1))  # 1, 2 ou 3

    if not session_id:
        return jsonify({'error': 'session_id requis'}), 400
    if not llm_response or not isinstance(llm_response, dict):
        return jsonify({'error': 'llm_response doit etre un objet JSON (reponse OpenAI brute)'}), 400
    if pass_idx < 1 or pass_idx > 3:
        return jsonify({'error': 'pass doit etre 1, 2 ou 3'}), 400

    try:
        prepared = _load_enhance_session(session_id, user_id)
    except ValueError as e:
        return jsonify({'error': f'Session invalide : {e}'}), 404

    import logging
    logging.warning(f"[enhance/finish] session={session_id} user={user_id} preset='{prepared.get('preset_name')}' pass={pass_idx}")

    # ── Mode cloud : on fait tout en interne, comme /api/enhance ─────────
    if not prepared.get('is_client_side'):
        try:
            pass1_result = _finish_enhance_pass1(user_id, prepared, llm_response)
        except Exception as e:
            return jsonify({'error': f'Erreur post-traitement : {e}'}), 500
        # Passes de validation en interne
        if prepared['validation_passes'] > 0:
            pass1_result['output'] = _run_validation_passes_internal(
                prepared, pass1_result['output'], pass1_result['debug_sections']
            )
        result = _build_final_result(
            pass1_result, prepared['output_format'], prepared['width'], prepared['height']
        )
        _delete_enhance_session(session_id)
        result['status'] = 'done'
        result['session_id'] = session_id
        return jsonify(result)

    # ── Mode client-side (local) : multi-passes, state machine en BDD ──────
    if pass_idx == 1:
        # Premier appel : on vient de finir la passe 1
        try:
            pass1_result = _finish_enhance_pass1(user_id, prepared, llm_response)
        except Exception as e:
            return jsonify({'error': f'Erreur post-traitement passe 1 : {e}'}), 500
        # Sauvegarder le state pour les passes suivantes
        _update_enhance_session(session_id, user_id, {
            'state': 'awaiting_validation',
            'current_output': pass1_result['output'],
            'pass_idx_done': 1,
            'debug_sections': pass1_result['debug_sections'],
            'conversion_debug': pass1_result['conversion_debug'],
        })
        # Si on n'a pas de passe 2, on a fini
        if prepared['validation_passes'] <= 1:
            _delete_enhance_session(session_id)
            result = _build_final_result(
                pass1_result, prepared['output_format'], prepared['width'], prepared['height']
            )
            result['status'] = 'done'
            result['session_id'] = session_id
            return jsonify(result)
        # Sinon, préparer la passe 2 pour le client
        return _prepare_next_validation_pass(session_id, user_id, prepared, next_pass_idx=2)
    else:
        # Appel N+1 (N >= 2) : on a fini la passe N, on attend la reponse
        current_output = prepared.get('current_output', '')
        debug_sections = list(prepared.get('debug_sections', []))
        prev_pass_idx = pass_idx - 1  # la passe qu'on vient de finir
        llm_request, val_debug = _prepare_validation_pass(
            current_output, prepared['merged_text'], prepared['style_text'],
            prepared['width'], prepared['height'],
            prepared['llm_config']['model'], prev_pass_idx
        )
        # Parser la reponse
        new_output, val_debug = _finish_validation_pass(llm_response, val_debug)
        if new_output is not None:
            current_output = new_output
        debug_sections.append(val_debug)
        # Si c'etait la derniere passe, retourner le resultat final
        if pass_idx >= prepared['validation_passes']:
            _delete_enhance_session(session_id)
            pass1_result = {
                'output': current_output,
                'negative_prompt': prepared['negative_prompt'],
                'model_used': prepared['model'],
                'debug_sections': debug_sections,
                'conversion_debug': prepared.get('conversion_debug'),
            }
            result = _build_final_result(
                pass1_result, prepared['output_format'], prepared['width'], prepared['height']
            )
            result['status'] = 'done'
            result['session_id'] = session_id
            return jsonify(result)
        # Sinon, préparer la passe suivante
        _update_enhance_session(session_id, user_id, {
            'state': 'awaiting_validation',
            'current_output': current_output,
            'pass_idx_done': pass_idx,
            'debug_sections': debug_sections,
        })
        return _prepare_next_validation_pass(
            session_id, user_id, prepared,
            next_pass_idx=pass_idx + 1,
            current_output=current_output
        )


def _prepare_next_validation_pass(session_id, user_id, prepared, next_pass_idx, current_output=None):
    """
    Helper : prepare le payload LLM de la passe de validation suivante.
    Sauvegarde le state et retourne la reponse awaiting_validation.
    """
    if current_output is None:
        current_output = prepared.get('current_output', '')
    llm_request, _ = _prepare_validation_pass(
        current_output, prepared['merged_text'], prepared['style_text'],
        prepared['width'], prepared['height'],
        prepared['llm_config']['model'], next_pass_idx - 1,
        validation_system_prompt=prepared.get('validation_system_prompt', ''),
        validation_examples=prepared.get('validation_examples')
    )
    # Note : on NE sauve pas le llm_request en BDD (regenerable a partir de current_output)
    return jsonify({
        'status': 'awaiting_validation',
        'session_id': session_id,
        'pass': next_pass_idx,
        'llm_request': llm_request,
        'llm_config': prepared['llm_config'],
        'debug_meta': {
            'preset_name': prepared['preset_name'],
            'is_client_side': True,
            'validation_pass': next_pass_idx,
            'validation_passes_total': prepared['validation_passes'],
            'model': prepared['model'],
        },
    })


def _do_enhance(user_id, data):
    """Orchestrateur cloud: prepare + appel LLM interne + finish (passe 1) + passes de validation."""
    prepared = _prepare_enhance(user_id, data)
    if isinstance(prepared, tuple):  # erreur
        return prepared
    try:
        llm_response = _call_llm_internal(prepared['llm_request'], prepared['llm_config'])
    except Exception as e:
        msg = str(e)
        import logging
        logging.warning(f"[enhance] LLM EXCEPTION: {msg!r}")
        # IMPORTANT : _do_enhance tourne dans un Thread sans contexte Flask actif.
        # On retourne des DICTS purs (pas jsonify). C'est le generator de /api/enhance
        # qui serialise en ndjson.
        if '429' in msg:
            return {'_status': 429, 'error': 'Rate limit atteint sur le serveur LLM. Attends un peu et reessaye.'}
        if 'connect' in msg.lower() or 'refused' in msg.lower():
            return {'_status': 502, 'error': f'Serveur LLM inaccessible : verifie l\'URL ({prepared["llm_config"]["base_url"]})'}
        return {'_status': 502, 'error': f'Erreur LLM: {msg}'}
    # Post-traitement passe 1 (toujours commun cloud/local)
    pass1_result = _finish_enhance_pass1(user_id, prepared, llm_response)
    # Passes de validation en mode cloud : le backend les fait toutes en interne
    if prepared['validation_passes'] > 0:
        pass1_result['output'] = _run_validation_passes_internal(
            prepared, pass1_result['output'], pass1_result['debug_sections']
        )
    # IMPORTANT : retourner un dict pur, pas jsonify(...).
    # _do_enhance est appele dans un Thread separe, sans contexte Flask actif.
    # C'est le generator de /api/enhance qui serialise en json.dumps(...).
    return _build_final_result(
        pass1_result, prepared['output_format'], prepared['width'], prepared['height']
    )


# ── Sessions /api/enhance en mode client-side (LLM local) ──────────────
# En mode local, le frontend (ou un node ComfyUI) fait 2 requêtes HTTP :
#   1. POST /api/enhance/prepare   → le backend construit le payload LLM
#                                    et le stocke dans enhance_sessions
#   2. POST /api/enhance/finish    → le client envoie la reponse LLM,
#                                    le backend fait le post-traitement
# Les sessions expirent automatiquement apres 1h.

ENHANCE_SESSION_TTL = 3600  # 1 heure


def _save_enhance_session(user_id, prepared):
    """
    Persiste le contexte de generation (payload + metadata) en BDD pour
    permettre au client de le rappeler dans /api/enhance/finish.
    Retourne le session_id.
    """
    session_id = secrets.token_urlsafe(24)
    # Stocker le session_id DANS le payload aussi (pour qu'il survive au aller-retour BDD)
    prepared = dict(prepared)
    prepared['session_id'] = session_id
    expires_at = (datetime.utcnow() + timedelta(seconds=ENHANCE_SESSION_TTL)).strftime('%Y-%m-%d %H:%M:%S')
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO enhance_sessions (id, user_id, expires_at, state, payload_json) VALUES (?, ?, ?, 'prepared', ?)",
            (session_id, user_id, expires_at, json.dumps(prepared, ensure_ascii=False))
        )
        conn.commit()
    finally:
        conn.close()
    return session_id


def _load_enhance_session(session_id, user_id):
    """
    Recupere le contexte de generation depuis la BDD.
    Verifie que la session appartient bien a user_id et n'a pas expire.
    Retourne le dict 'prepared' ou leve une ValueError si invalide.
    """
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT payload_json, expires_at, state FROM enhance_sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id)
        ).fetchone()
        if not row:
            raise ValueError('Session inconnue ou expiree')
        # Verifier expiration
        try:
            expires = datetime.strptime(row['expires_at'], '%Y-%m-%d %H:%M:%S')
            if datetime.utcnow() > expires:
                conn.execute("DELETE FROM enhance_sessions WHERE id = ?", (session_id,))
                conn.commit()
                raise ValueError('Session expiree')
        except ValueError:
            raise  # propager notre propre erreur
        return json.loads(row['payload_json'])
    finally:
        conn.close()


def _delete_enhance_session(session_id):
    """Supprime une session apres utilisation (cleanup)."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM enhance_sessions WHERE id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()


def _update_enhance_session(session_id, user_id, updates):
    """
    Met a jour le payload_json d'une session en fusionnant 'updates' dans le dict existant.
    Utilise pour sauvegarder le state au fur et a mesure des passes de validation.
    Leve ValueError si la session est introuvable ou expiree.
    """
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT payload_json, expires_at FROM enhance_sessions WHERE id = ? AND user_id = ?",
            (session_id, user_id)
        ).fetchone()
        if not row:
            raise ValueError('Session inconnue ou expiree')
        try:
            expires = datetime.strptime(row['expires_at'], '%Y-%m-%d %H:%M:%S')
            if datetime.utcnow() > expires:
                conn.execute("DELETE FROM enhance_sessions WHERE id = ?", (session_id,))
                conn.commit()
                raise ValueError('Session expiree')
        except ValueError:
            raise
        payload = json.loads(row['payload_json'])
        payload.update(updates)  # fusion
        # Update DB
        conn.execute(
            "UPDATE enhance_sessions SET payload_json = ?, state = ? WHERE id = ?",
            (json.dumps(payload, ensure_ascii=False), updates.get('state', 'in_progress'), session_id)
        )
        conn.commit()
        return payload
    finally:
        conn.close()


def _prepare_enhance(user_id, data):
    """
    Construit le payload LLM a partir des params de la requete.
    Retourne un dict {session_id, llm_request, llm_config, debug_sections, ...}
    ou un tuple (jsonify, status) en cas d'erreur.

    Le payload est le format OpenAI standard envoye a /chat/completions.
    Les metadata (preset, template_id, merged_text, etc.) sont stockees
    dans le dict pour etre reutilisees par _finish_enhance.
    """
    import logging
    # Debug : collecter les etapes pour le markdown de debug
    debug_sections = []

    preset_id = data.get('preset_id')
    text = data.get('text', '').strip()
    template_id = data.get('template_id')
    # Accepter aussi 'prompt_type' comme ancien alias le temps de la transition
    if not template_id and data.get('prompt_type'):
        try:
            template_id = int(data.get('prompt_type'))
        except (ValueError, TypeError):
            pass
    if not template_id:
        return jsonify({'error': 'template_id requis'}), 400
    try:
        template_id = int(template_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'template_id invalide'}), 400

    style_id = data.get('style_id')
    style_text = data.get('style_text', '').strip()
    special_instructions = data.get('special_instructions', '').strip()
    ep_elements = data.get('ep_elements', [])
    random_count = int(data.get('random_count', 0))
    width = int(data.get('width') or 0)
    height = int(data.get('height') or 0)

    # Resoudre le template selectionne
    conn = get_db()
    template_row = conn.execute(
        "SELECT id, name, output_format, system_prompt, examples FROM prompt_templates WHERE id = ? AND (is_public = 1 OR is_default = 1 OR user_id = ?)",
        (template_id, user_id)
    ).fetchone()
    conn.close()
    if not template_row:
        return jsonify({'error': f"Template {template_id} introuvable ou inaccessible."}), 404
    output_format = template_row['output_format'] or 'text'
    template_system_prompt = template_row['system_prompt'] or ''
    template_name = template_row['name'] or ''
    try:
        template_examples = json.loads(template_row['examples']) if template_row['examples'] else []
    except Exception:
        template_examples = []

    logging.warning(f"[enhance] REQUEST user={user_id} preset_id={preset_id} template_id={template_id} name='{template_name}' output_format='{output_format}' text_len={len(text)}")

    # Resoudre le style si style_id fourni
    negative_prompt = ''
    if style_id:
        conn = get_db()
        row = conn.execute("SELECT style_text, negative_prompt FROM styles WHERE id = ?", (style_id,)).fetchone()
        if row:
            if not style_text:
                style_text = row['style_text'] or ''
            negative_prompt = row['negative_prompt'] or ''
        conn.close()

    # Resoudre les elements EP
    ep_keywords = []
    if ep_elements:
        conn = get_db()
        cur = conn.cursor()
        for elem in ep_elements:
            if elem.get('type') == 'filter' and elem.get('id'):
                cur.execute("SELECT keyword_id FROM filter_cache WHERE filter_id = ?", (elem['id'],))
                kids = [r[0] for r in cur.fetchall()]
                if kids:
                    cur.execute("SELECT keyword FROM keywords WHERE id IN (" + ','.join('?' for _ in kids) + ")", kids)
                    kws = [r[0] for r in cur.fetchall()]
                    if kws:
                        ep_keywords.append(random.choice(kws))
            elif elem.get('type') == 'text' and elem.get('text'):
                try:
                    qv = generate_embedding(elem['text'])
                    cur.execute("SELECT k.keyword, ke.embedding FROM keywords k JOIN keyword_embeddings ke ON ke.keyword_id = k.id")
                    rows = cur.fetchall()
                    scored = []
                    for r in rows:
                        vec = json.loads(r['embedding']) if r['embedding'] else None
                        if vec:
                            s = cosine_similarity(qv, vec)
                            if s >= 0.45:
                                scored.append((r['keyword'], s))
                    scored.sort(key=lambda x: x[1], reverse=True)
                    top5 = [k for k, _ in scored[:5]]
                    if top5:
                        ep_keywords.append(random.choice(top5))
                except Exception:
                    pass
        conn.close()

    ep_text = ', '.join(ep_keywords) if ep_keywords else ''

    # Random elements : piocher depuis sections non encore utilisees
    rand_keywords = []
    if random_count > 0:
        conn = get_db()
        cur = conn.cursor()
        # Trouver les sections deja utilisees
        all_kw_text = (text + ' ' + ep_text).lower()
        existing = []
        for kw in all_kw_text.replace(',', ' ').split():
            kw = kw.strip()
            if len(kw) >= 3:
                existing.append(kw)
        if existing:
            placeholders = ','.join('?' for _ in existing)
            cur.execute(f"SELECT DISTINCT section_id FROM keywords WHERE LOWER(keyword) IN ({placeholders})", existing)
            used_sections = {r[0] for r in cur.fetchall() if r[0]}
        else:
            used_sections = set()
        # Piocher des keywords depuis des sections inutilisees
        if used_sections:
            ph = ','.join('?' for _ in used_sections)
            cur.execute(f"SELECT keyword FROM keywords WHERE (section_id NOT IN ({ph}) OR section_id IS NULL) AND privacy_status = 'public' ORDER BY RANDOM() LIMIT ?", list(used_sections) + [random_count])
        else:
            cur.execute("SELECT keyword FROM keywords WHERE privacy_status = 'public' ORDER BY RANDOM() LIMIT ?", (random_count,))
        rand_keywords = [r[0] for r in cur.fetchall()]
        conn.close()

    rand_text = ', '.join(rand_keywords) if rand_keywords else ''

    # ── Branche specifique Ideogram 4 ─────────────────────────────
    # Pour Ideogram 4 on structure l'entree en sections nommees
    # (description generale + 4 elements + dimensions) au lieu du
    # format avec priorites [PRIORITE ...] qui n'a pas de sens ici.
    # ── Construction de l'entree utilisateur (genérique) ──────────
    # Le template BDD definit le format exact (sections, priorites, etc.)
    # via son system_prompt. On envoie le contenu brut a structurer.
    merged_parts = []
    if text:
        merged_parts.append(text)
    if ep_text:
        merged_parts.append(ep_text)
    if rand_text:
        merged_parts.append(rand_text)
    if style_text:
        merged_parts.append("STYLE (must be preserved verbatim):\n" + style_text)
    if special_instructions:
        merged_parts.append("ADDITIONAL INSTRUCTIONS:\n" + special_instructions)
    if width and height:
        from math import gcd
        g = gcd(width, height)
        merged_parts.append(f"IMAGE DIMENSIONS: {width}x{height} pixels (aspect ratio: {width//g}:{height//g})")
    # Les elements EP de type "text" sont les sujets principaux
    named_elems = [e.get('text', '').strip() for e in ep_elements
                   if e.get('type') == 'text' and e.get('text', '').strip()]
    if named_elems:
        elems_str = '\n'.join(f"  {i+1}. {desc}" for i, desc in enumerate(named_elems))
        merged_parts.append(f"ELEMENTS TO PLACE IN THE SCENE:\n{elems_str}")
    merged_text = '\n\n'.join(merged_parts)
    if not merged_text.strip():
        return jsonify({'error': 'Aucun contenu a generer'}), 400

    # Recuperer le preset
    conn = get_db()
    preset = None
    if preset_id:
        preset = conn.execute("SELECT * FROM ai_presets WHERE id = ?", (preset_id,)).fetchone()
    if not preset:
        # Fallback : premier preset personnel dispo
        preset = conn.execute(
            "SELECT * FROM ai_presets WHERE user_id = ? OR is_global = 1 ORDER BY is_global DESC LIMIT 1",
            (user_id,)
        ).fetchone()
    if not preset:
        conn.close()
        return jsonify({'error': 'Aucun preset IA configure. Cree un preset dans la configuration.'}), 400

    api_key = decrypt_api_key(preset['api_key_encrypted'])
    base_url = preset['base_url'].rstrip('/')
    model = preset['model']
    conn.close()
    # Debug temporaire : tracer le preset utilise
    logging.warning(f"[enhance] user={user_id} preset_id={preset['id']} name='{preset['name']}' is_global={preset['is_global']} model='{model}' base_url='{base_url}' api_key_len={len(api_key) if api_key else 0}")

    # Construire le prompt systeme a partir du template selectionne
    logging.warning(f"[enhance] template_id={template_id} name='{template_name}' output_format='{output_format}' found={'yes' if template_system_prompt else 'no'} sys_len={len(template_system_prompt)}")

    system_parts = []

    # 1) STYLE — tout en haut, imperatif
    if style_text:
        system_parts.append(f"""CRITICAL — STYLE PRESERVATION RULE
You MUST preserve the following style in the output prompt, verbatim and unmodified:
{style_text}

This style is IMPERATIVE. Keep it exactly as written, do NOT rephrase or summarize it.""")

    # 2) INSTRUCTIONS — system_prompt du template (doc, schema, tips, output format)
    # Les exemples et les regles obligatoires sont geres separement ci-dessous.
    if template_system_prompt and template_system_prompt.strip():
        system_parts.append(template_system_prompt.strip())
    else:
        return jsonify({'error': f"Aucun template trouve pour template_id={template_id}. Cree un template dans l'onglet Templates."}), 400

    # 3) EXAMPLES — injectes depuis le champ examples du template
    if template_examples:
        ex_list = '\n'.join(f'- {ex}' for ex in template_examples)
        system_parts.append(f"""## Examples
Here are well-structured examples for reference — study them but do NOT copy verbatim:
{ex_list}""")

    # 4) MANDATORY RULES — regles obligatoires, non visibles dans l'UI
    system_parts.append("""Mandatory rules:
- The assigned STYLE must be preserved exactly as-is
- In case of conflict, prioritize: base prompt > elements > random
- Remove duplicates
- Organize by importance
- DO NOT REPEAT the same tags/concepts
- OUTPUT ONLY the prompt, nothing else: no explanations, no comments, no introductory sentences
- The prompt must be ready to use in an image generator""")

    # 5) Instructions speciales (toujours en dernier)
    if special_instructions:
        system_parts.append(f"Additional instructions: {special_instructions}")

    system_prompt = '\n\n'.join(system_parts)

    # Construire le payload LLM (format OpenAI standard pour /chat/completions)
    llm_request = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': merged_text}
        ],
        'temperature': 0.3,
        'frequency_penalty': 0.5,
        'repeat_penalty': 1.2,
    }
    llm_config = {
        'base_url': base_url,
        'api_key': api_key,
        'model': model,
    }
    # Debug : enregistrer la passe 1
    debug_sections.append({
        'title': 'Passe 1 : Generation',
        'model': model,
        'system_prompt': system_prompt[:2000],
        'user_prompt': merged_text[:2000],
        'temperature': llm_request['temperature'],
    })

    # ── Auto-critique : passes de validation (Ideogram 4 uniquement) ────
    # Pour les autres types, pas de bbox/structure a valider, on garde 0.
    validation_passes = int(data.get('validation_passes', 0))
    validation_passes = max(0, min(validation_passes, 3))  # borne 0..3

    # Charger le template de validation (optionnel, pour Ideogram 4 passe 2)
    # Si validation_template_id est fourni, utilise son system_prompt.
    # Sinon, garde le hardcodé (backward compatible).
    validation_template_id = data.get('validation_template_id')
    validation_system_prompt = ''
    validation_examples = []
    if validation_passes > 0 and validation_template_id:
        conn = get_db()
        val_row = conn.execute(
            "SELECT system_prompt, examples FROM prompt_templates WHERE id = ?",
            (int(validation_template_id),)
        ).fetchone()
        if val_row:
            validation_system_prompt = val_row['system_prompt'] or ''
            try:
                validation_examples = json.loads(val_row['examples']) if val_row['examples'] else []
            except Exception:
                validation_examples = []
        conn.close()

    return {
        # Identifiant unique de cette session de generation.
        # En mode local (client-side), le caller doit conserver ce session_id
        # pour le rappeler dans /api/enhance/finish.
        'session_id': None,  # pas de session persistante en mode cloud (un seul appel HTTP)
        'llm_request': llm_request,
        'llm_config': llm_config,
        # Metadata necessaires a _finish_enhance (tout ce qui n'est pas dans le payload LLM)
        'user_id': user_id,
        'preset_id': preset['id'],
        'preset_name': preset['name'],
        'is_global': preset['is_global'],
        # Indique si le preset est marque client-side (= appel LLM deleste au client).
        # Utilise par /api/enhance/prepare pour decider du routage.
        'is_client_side': bool(_row_get(preset, 'is_client_side', 0)),
        'template_id': template_id,
        'template_name': template_name,
        'output_format': output_format,
        'width': width,
        'height': height,
        'style_text': style_text,
        'style_id': data.get('style_id'),
        'negative_prompt': negative_prompt,
        'merged_text': merged_text,
        'model': model,
        'validation_passes': validation_passes,
        'validation_template_id': validation_template_id,
        'validation_system_prompt': validation_system_prompt,
        'validation_examples': validation_examples,
        'debug_sections': debug_sections,
    }


def _call_llm_internal(llm_request, llm_config):
    """
    Helper: fait l'appel LLM via requests (avec retry logic Ollama Cloud).
    Leve une exception en cas d'erreur — l'appelant decide du code HTTP.
    Retourne le dict de reponse OpenAI ({choices: [{message: {content: ...}}], ...}).
    """
    import requests
    import logging
    base_url = llm_config['base_url']
    api_key = llm_config.get('api_key', '')
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'} if api_key else {'Content-Type': 'application/json'}
    r = requests.post(f'{base_url}/chat/completions', headers=headers, json=llm_request, timeout=180)
    r.raise_for_status()
    result = r.json()
    output = result['choices'][0]['message']['content'].strip()
    # Retry si l'output est vide OU manifestement tronque (Ollama Cloud est instable)
    for retry in range(3):
        if len(output) >= 50:
            break
        if not output:
            logging.warning(f"[enhance] LLM output vide, retry {retry+1}/3")
        else:
            logging.warning(f"[enhance] LLM output trop court (len={len(output)}), retry {retry+1}/3")
        r = requests.post(f'{base_url}/chat/completions', headers=headers, json=llm_request, timeout=180)
        r.raise_for_status()
        result = r.json()
        output = result['choices'][0]['message']['content'].strip()
    logging.warning(f"[enhance] LLM response status=200 output_len={len(output)} output_preview={output[:100]!r}")
    return result


def _finish_enhance_pass1(user_id, prepared, llm_response):
    """
    Post-traitement apres l'appel LLM passe 1.
    - Nettoyage output (code fences, [PRIORITE ...])
    - Sauvegarde BDD (generated_prompts)
    - Conversion bbox pixels -> 0-1000 (Ideogram 4)
    - Construction du debug_md initial (passe 1 uniquement)

    Les passes de validation sont orchestrées par l'appelant :
    - _do_enhance (cloud) appelle _run_validation_passes_internal apres
    - /api/enhance/finish (client-side) appelle _finish_validation_step en boucle

    Retourne un dict contenant les donnees brutes :
    {
        'output': str,                       # sortie nettoyee + bbox converties
        'negative_prompt': str,
        'model_used': str,
        'debug_sections': list,              # contient la passe 1
        'conversion_debug': dict|None,       # pour reconstruire debug_md final
    }
    """
    output = llm_response['choices'][0]['message']['content'].strip()
    debug_sections = list(prepared['debug_sections'])  # copie locale pour eviter de polluer prepared

    # Debug : sortie brute passe 1
    if debug_sections:
        debug_sections[-1]['raw_output'] = output[:3000]

    # Post-nettoyage de la sortie : retirer les balises de code et [PRIORITE ...]
    import re
    def clean_output(text):
        text = re.sub(r'\[PRIORITE\s+(HAUTE|MOYENNE|BASSE)\]', '', text, flags=re.IGNORECASE)
        return text.strip()
    # Nettoyer les balises de code eventuelles
    if output.startswith('```'):
        lines = output.split('\n')
        if lines[0].startswith('```'):
            lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        output = '\n'.join(lines).strip()
    # Nettoyer les marqueurs [PRIORITE ...]
    output = clean_output(output)

    # Metadata
    template_id = prepared['template_id']
    template_name = prepared.get('template_name', '')
    merged_text = prepared['merged_text']
    width = prepared['width']
    height = prepared['height']
    model = prepared['model']

    # Sauvegarde du prompt genere
    try:
        conn2 = get_db()
        conn2.execute(
            """INSERT INTO generated_prompts (user_id, preset_id, template_id, input_text, output_text, style_id, model_used)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, prepared['preset_id'], template_id, merged_text, output, prepared['style_id'], model)
        )
        conn2.commit()
        conn2.close()
    except Exception:
        pass  # non-bloquant

    # Le template BDD peut demander une conversion bbox via son system_prompt.
    # On la desactive ici — le LLM sort directement du 0-1000 si le template le demande.
    conversion_debug = None

    return {
        'output': output,
        'negative_prompt': prepared['negative_prompt'],
        'model_used': model,
        'debug_sections': debug_sections,
        'conversion_debug': conversion_debug,
    }


def _build_final_result(pass1_result, output_format, width, height):
    """
    Assemble le dict final a partir des resultats de _finish_enhance_pass1
    et des sections de debug (qui peuvent inclure les passes de validation).
    """
    debug_sections = pass1_result['debug_sections']

    # Reconstruire le debug_md pour tous les templates (plus de filtrage ideogram)
    debug_md = ''
    if debug_sections:
        debug_md = _build_debug_markdown(debug_sections, pass1_result.get('conversion_debug'), width, height)

    return {
        'output': pass1_result['output'],
        'negative_prompt': pass1_result['negative_prompt'],
        'model_used': pass1_result['model_used'],
        'debug_md': debug_md,
    }


def _run_validation_passes_internal(prepared, output, debug_sections):
    """
    Orchestrateur des passes de validation pour le mode CLOUD.
    Execute TOUTES les passes en interne (le backend fait les appels LLM).
    Modifie 'output' en place. Met a jour debug_sections.

    A terme, cette fonction sera jumelée avec une variante client-side
    (cf. TODO dans /api/enhance/finish).
    """
    for pass_idx in range(prepared['validation_passes']):
        try:
            corrected, val_debug = _do_validation_pass(
                output, prepared['merged_text'], prepared['style_text'],
                prepared['width'], prepared['height'],
                prepared['llm_config'], pass_idx,
                validation_system_prompt=prepared.get('validation_system_prompt', ''),
                validation_examples=prepared.get('validation_examples')
            )
            debug_sections.append(val_debug)
            if corrected:
                output = corrected
        except Exception:
            # En cas d'erreur de validation, on garde la sortie precedente
            pass
    return output


def _prepare_validation_pass(current_output, original_input, style_text, width, height, model, pass_idx, validation_system_prompt='', validation_examples=None):
    """
    Etape 1 d'une passe de validation (Ideogram 4).
    Construit le payload LLM.

    - system prompt : le template de validation (ou hardcodé si vide)
      + les exemples du template (si fournis)
    - user prompt   : le JSON brut de la passe 1 (current_output)

    Retourne (llm_request, debug_dict).
    """
    debug = {'pass': pass_idx + 1, 'api_calls': []}

    system_content = validation_system_prompt
    if not system_content:
        system_content = 'You are a spatial composition expert. You output ONLY corrected JSON with properly placed bounding boxes.'

    # Ajouter les exemples du template au system prompt
    if validation_examples and isinstance(validation_examples, list):
        ex_list = '\n'.join(f'- {ex}' for ex in validation_examples)
        system_content += f"\n\n## Examples\nHere are examples of well-structured Ideogram 4 captions — study the bbox placement:\n{ex_list}"

    # User prompt = la sortie brute de la passe 1
    user_content = current_output

    llm_request = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_content},
            {'role': 'user', 'content': user_content},
        ],
        'temperature': 0.1,
        'frequency_penalty': 0.0,
        'repeat_penalty': 1.0,
    }
    # Debug : enregistrer l'appel de validation
    debug['api_calls'].append({
        'system_prompt': llm_request['messages'][0]['content'],
        'user_prompt': user_content[:3000],
        'temperature': llm_request['temperature'],
        'model': model,
    })
    return llm_request, debug


def _finish_validation_pass(llm_response, debug):
    """
    Etape 2 d'une passe de validation (Ideogram 4).
    Prend la reponse LLM, verifie que c'est du JSON valide.
    Retourne (new_output|None, debug_updated).
    - new_output : la string JSON corrigee, ou None si invalide
    - debug_updated : debug avec le raw_output et le status ajoutes
    """
    import re as _re
    new_output = llm_response['choices'][0]['message']['content'].strip()
    debug['api_calls'][-1]['raw_output'] = new_output[:3000]

    # Nettoyer les fences
    if new_output.startswith('```'):
        nl = new_output.split('\n')
        if nl[0].startswith('```'):
            nl = nl[1:]
        if nl and nl[-1].strip() == '```':
            nl = nl[:-1]
        new_output = '\n'.join(nl).strip()

    # Verifier que c'est du JSON valide
    try:
        s2 = new_output.strip()
        m2 = _re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", s2)
        if m2:
            s2 = m2.group(1)
        json.loads(s2)
        debug['api_calls'][-1]['status'] = 'valid_json'
        return new_output, debug
    except Exception as e:
        debug['api_calls'][-1]['status'] = f'invalid_json: {e}'
        return None, debug


def _do_validation_pass(current_output, original_input, style_text, width, height, llm_config, pass_idx, validation_system_prompt='', validation_examples=None):
    """
    Helper retro-compatible : prepare + appel LLM interne + finish d'une passe.
    Utilise uniquement par le flow cloud (mode local delegue au client).
    Retourne (new_output|None, debug_dict).
    """
    import requests as _req
    llm_request, debug = _prepare_validation_pass(
        current_output, original_input, style_text, width, height,
        llm_config['model'], pass_idx,
        validation_system_prompt=validation_system_prompt,
        validation_examples=validation_examples
    )
    base_url = llm_config['base_url']
    api_key = llm_config.get('api_key', '')
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'} if api_key else {'Content-Type': 'application/json'}
    try:
        r = _req.post(f'{base_url}/chat/completions', headers=headers, json=llm_request, timeout=180)
        r.raise_for_status()
        result = r.json()
    except Exception as e:
        debug['api_calls'][-1]['error'] = str(e)
        return None, debug
    return _finish_validation_pass(result, debug)


# ── LLM utilitaire pour keywords (bulk import / generation) ─────────────

@app.route('/api/keywords/llm-process', methods=['POST'])
def keywords_llm_process():
    """
    Appel LLM simple pour les operations sur les mots-cles.
    Corps : {preset_id, instruction, input_text?}
    - instruction : le prompt / instruction utilisateur
    - input_text (optionnel) : texte a reformater (bulk import conversion)
    Retourne : {output: str}
    """
    guard = _login_required()
    if guard:
        return guard
    user_id = _get_current_user_id()

    data = request.get_json() or {}
    preset_id = data.get('preset_id')
    instruction = (data.get('instruction') or '').strip()
    input_text = (data.get('input_text') or '').strip()

    if not preset_id:
        return jsonify({'error': 'preset_id requis'}), 400
    if not instruction:
        return jsonify({'error': 'instruction requise'}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM ai_presets WHERE id = ? AND (user_id = ? OR is_global = 1)",
        (preset_id, user_id)
    )
    preset = cur.fetchone()
    conn.close()

    if not preset:
        return jsonify({'error': 'Preset introuvable'}), 404

    api_key = decrypt_api_key(preset['api_key_encrypted'])
    base_url = preset['base_url'].rstrip('/')
    model = preset['model']

    # Construire le message systeme
    system_msg = "Tu es un assistant specialise dans la gestion de mots-cles pour un outil de generation de prompt d'images."
    if input_text:
        messages = [
            {'role': 'system', 'content': system_msg},
            {'role': 'user', 'content': f"{instruction}\n\nVoici le texte a traiter :\n\n{input_text}"}
        ]
    else:
        messages = [
            {'role': 'system', 'content': system_msg},
            {'role': 'user', 'content': instruction}
        ]

    llm_request = {
        'model': model,
        'messages': messages,
        'temperature': 0.3,
    }
    llm_config = {
        'base_url': base_url,
        'api_key': api_key,
    }

    try:
        llm_response = _call_llm_internal(llm_request, llm_config)
    except Exception as e:
        msg = str(e)
        import logging
        logging.warning(f"[keywords/llm-process] LLM EXCEPTION: {msg!r}")
        if '429' in msg:
            return jsonify({'error': 'Rate limite atteint sur le serveur LLM. Attends un peu et reessaye.'}), 429
        if 'connect' in msg.lower() or 'refused' in msg.lower():
            return jsonify({'error': f'Serveur LLM inaccessible : verifie l\'URL ({base_url})'}), 502
        return jsonify({'error': f'Erreur LLM: {msg}'}), 502

    output = llm_response['choices'][0]['message']['content'].strip()
    usage = llm_response.get('usage', {})
    
    # Essayer de recuperer la taille max de contexte
    max_context = None
    try:
        import requests as _req2
        r2 = _req2.get(f'{base_url}/models', headers=llm_config.get('headers', {}), timeout=5)
        if r2.ok:
            models_data = r2.json()
            all_models = models_data.get('data') or models_data.get('models') or []
            for m in all_models:
                mid = m.get('id') or m.get('name') or ''
                if mid == model or model in mid:
                    max_context = m.get('max_context_length') or m.get('context_length') or \
                                  m.get('max_model_len') or m.get('context_window')
                    break
    except Exception:
        pass
    
    # Fallback : valeurs connues
    if not max_context:
        known = {
            'gpt-4': 8192, 'gpt-4-turbo': 128000, 'gpt-3.5': 4096,
            'claude': 100000, 'gemma': 8192, 'llama': 4096,
            'mistral': 8192, 'mixtral': 32768, 'qwen': 32768,
            'deepseek': 4096, 'command': 4096,
        }
        for k, v in known.items():
            if k in model.lower():
                max_context = v
                break
    
    if not max_context:
        max_context = 4096
    
    return jsonify({'output': output, 'usage': usage, 'max_context': max_context})
