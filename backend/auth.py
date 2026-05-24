"""
Module d'authentification Discord OAuth2.
Limite les accès aux membres d'un serveur Discord spécifique (optionnel).

Configuration via variables d'environnement (ou .env) :
  DISCORD_CLIENT_ID      requis
  DISCORD_CLIENT_SECRET  requis
  DISCORD_GUILD_ID       optionnel — ID du serveur à restreindre
  DISCORD_REDIRECT_URI   optionnel — défaut: http://localhost:5000/api/auth/discord/callback
  SECRET_KEY             requis — pour les sessions Flask
"""

import os
import json
from pathlib import Path

import requests
from authlib.integrations.flask_client import OAuth
from flask import session, redirect, request, jsonify, current_app

DISCORD_API = "https://discord.com/api"


def init_oauth(app):
    """Configure OAuth sur l'app Flask et retourne l'instance."""
    oauth = OAuth(app)
    oauth.register(
        name="discord",
        client_id=os.environ["DISCORD_CLIENT_ID"],
        client_secret=os.environ["DISCORD_CLIENT_SECRET"],
        authorize_url="https://discord.com/api/oauth2/authorize",
        access_token_url="https://discord.com/api/oauth2/token",
        client_kwargs={"scope": "identify guilds guilds.members.read"},
    )
    return oauth


def make_discord_session(token: dict) -> requests.Session:
    """Crée une session requests avec le token Discord."""
    ses = requests.Session()
    ses.headers.update({"Authorization": f"Bearer {token['access_token']}"})
    return ses


def get_user_guilds(ses: requests.Session) -> list[dict]:
    """Récupère la liste des serveurs de l'utilisateur."""
    resp = ses.get(f"{DISCORD_API}/users/@me/guilds")
    resp.raise_for_status()
    return resp.json()


def check_guild_access(ses: requests.Session) -> tuple[bool, str | None]:
    """
    Vérifie si l'utilisateur est membre du serveur requis.
    Retourne (ok, error_message).
    """
    guild_id = os.environ.get("DISCORD_GUILD_ID")
    if not guild_id:
        return True, None  # Pas de restriction

    try:
        guilds = get_user_guilds(ses)
        if not any(g["id"] == guild_id for g in guilds):
            return False, (
                "Tu n'es pas membre du serveur Discord requis. "
                "Rejoins-le d'abord puis réessaie."
            )
        return True, None
    except Exception as e:
        return False, f"Erreur lors de la vérification du serveur : {e}"


def get_guild_member(ses: requests.Session, guild_id: str) -> dict | None:
    """Récupère les infos du membre dans un serveur (nickname, rôles…)."""
    resp = ses.get(f"{DISCORD_API}/users/@me/guilds/{guild_id}/member")
    if resp.ok:
        return resp.json()
    return None


def get_user_info(ses: requests.Session) -> dict:
    """Récupère les infos Discord de l'utilisateur."""
    resp = ses.get(f"{DISCORD_API}/users/@me")
    resp.raise_for_status()
    return resp.json()


def avatar_url(user: dict) -> str:
    """Construit l'URL de l'avatar Discord."""
    uid = user["id"]
    hash_ = user.get("avatar")
    if not hash_:
        # Avatar par défaut
        default = int(uid) % 5
        return f"https://cdn.discordapp.com/embed/avatars/{default}.png"
    anim = "gif" if hash_.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{uid}/{hash_}.{anim}?size=64"


def get_logged_user() -> dict | None:
    """Retourne l'utilisateur connecté depuis la session, ou None."""
    user = session.get("user")
    if not user:
        return None
    # Ajoute l'avatar à jour
    user["avatar_url"] = avatar_url(user)
    return user
