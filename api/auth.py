"""
Google OAuth 2.0 Authentication routes for PennyWise.
Handles Google login, callback, session management, and user info.
"""
import os
import uuid
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import APIRouter, Request, Response, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from dotenv import load_dotenv

# Load env from api/.env
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

logger = logging.getLogger("auth")

# ── Config ────────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
BASE_URL             = os.getenv("BASE_URL", "http://localhost:8000")
REDIRECT_URI         = f"{BASE_URL}/api/auth/google/callback"
FRONTEND_URL         = os.getenv("FRONTEND_URL", "http://localhost:3000")

GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.send",
]

# ── Persistent session store ───────────────────────────────────────────────────
# { session_id: { email, name, picture, access_token, refresh_token } }
SESSION_FILE = Path(__file__).resolve().parent / ".sessions.json"
_sessions_cache: Dict[str, Dict[str, Any]] = {}

def _load_sessions() -> Dict[str, Dict[str, Any]]:
    global _sessions_cache
    if _sessions_cache:
        return _sessions_cache
    if SESSION_FILE.exists():
        try:
            _sessions_cache = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
            return _sessions_cache
        except Exception:
            return {}
    return {}

def _save_sessions(sessions: Dict[str, Dict[str, Any]]):
    global _sessions_cache
    _sessions_cache = sessions
    try:
        SESSION_FILE.write_text(json.dumps(sessions), encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to save session file: {e}")

SESSION_COOKIE = "pw_session"

# ── Router ────────────────────────────────────────────────────────────────────
auth_router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _get_session(request: Request) -> Optional[Dict[str, Any]]:
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        return None
    sessions = _load_sessions()
    return sessions.get(session_id)


@auth_router.get("/google")
async def google_login():
    """Redirect user to Google's OAuth consent screen."""
    import urllib.parse
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         " ".join(SCOPES),
        "access_type":   "offline",
        "prompt":        "consent",
    }
    url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url)


@auth_router.get("/google/callback")
async def google_callback(code: str, response: Response):
    """Handle Google OAuth callback, exchange code for tokens, set session cookie."""
    import requests as req_lib

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    # Exchange code for tokens
    token_resp = req_lib.post(GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri":  REDIRECT_URI,
        "grant_type":    "authorization_code",
    })

    if token_resp.status_code != 200:
        logger.error(f"Token exchange failed: {token_resp.text}")
        raise HTTPException(status_code=400, detail="Failed to exchange authorization code")

    token_data = token_resp.json()
    access_token  = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    # Fetch user info
    userinfo_resp = req_lib.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"}
    )

    if userinfo_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch user info")

    user_info = userinfo_resp.json()
    email   = user_info.get("email", "")
    name    = user_info.get("name", "")
    picture = user_info.get("picture", "")

    # Create session
    session_id = str(uuid.uuid4())
    sessions = _load_sessions()
    sessions[session_id] = {
        "email":         email,
        "name":          name,
        "picture":       picture,
        "access_token":  access_token,
        "refresh_token": refresh_token,
        "token_data":    token_data,
    }
    _save_sessions(sessions)

    logger.info(f"User logged in: {email}")

    # Redirect to frontend dashboard with session cookie
    redirect = RedirectResponse(url=f"{FRONTEND_URL}/dashboard")
    redirect.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=False,   # Needs to be readable by frontend checks via HTTP
        samesite="lax",
        max_age=86400 * 7,  # 7 days
        path="/",
    )
    return redirect


@auth_router.get("/user")
async def get_user(request: Request):
    """Return current logged-in user info from session."""
    session = _get_session(request)
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return JSONResponse({
        "email":   session["email"],
        "name":    session["name"],
        "picture": session["picture"],
    })


@auth_router.get("/status")
async def auth_status(request: Request):
    """Check if the user is authenticated."""
    session = _get_session(request)
    return JSONResponse({
        "authenticated": session is not None,
        "email": session.get("email") if session else None,
    })


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    """Log out the current user by clearing the session."""
    session_id = request.cookies.get(SESSION_COOKIE)
    sessions = _load_sessions()
    if session_id and session_id in sessions:
        sessions.pop(session_id, None)
        _save_sessions(sessions)
        logger.info(f"Session {session_id[:8]}... logged out")

    resp = JSONResponse({"success": True, "message": "Logged out"})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@auth_router.post("/dev-login")
async def dev_login(response: Response):
    """Bypass login for local development / testing without Google credentials."""
    session_id = str(uuid.uuid4())
    sessions = _load_sessions()
    sessions[session_id] = {
        "email": "admin@pennywise.finance",
        "name": "Demo Admin",
        "picture": "https://api.dicebear.com/7.x/avataaars/svg?seed=PennyWise",
        "access_token": "mock_dev_token",
        "refresh_token": "mock_refresh_token",
        "token_data": {},
    }
    _save_sessions(sessions)
    logger.info("Dev login session created")

    resp = JSONResponse({
        "success": True,
        "authenticated": True,
        "user": {
            "email": "admin@pennywise.finance",
            "name": "Demo Admin",
            "picture": "https://api.dicebear.com/7.x/avataaars/svg?seed=PennyWise",
        }
    })
    resp.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        httponly=False,
        samesite="lax",
        max_age=86400 * 7,
        path="/",
    )
    return resp



def get_session_by_request(request: Request) -> Optional[Dict[str, Any]]:
    """Helper exported for use in email.py."""
    return _get_session(request)
