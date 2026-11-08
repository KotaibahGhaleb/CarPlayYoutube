#!/usr/bin/env python3
"""Read-only YouTube Music library service.

Talks to YouTube Music through ytmusicapi. It never rates songs, edits the
library, or writes listening history. Tokens stay in the auth file on this
machine and are not included in responses.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from map_items import map_home, page, playlist_from, songs_page

HOST = os.environ.get("YTMUSIC_BIND", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
AUTH_PATH = Path(os.environ.get("YTMUSIC_AUTH_PATH", ".secrets/ytmusic-auth.json"))
SERVICE_KEY = os.environ.get("YTMUSIC_SERVICE_KEY", "").strip()

lock = threading.Lock()
client = None
method: str | None = None
cache: dict[str, tuple[float, object]] = {}
pending: dict | None = None


def public_error(exc: BaseException) -> str:
    text = str(exc)
    text = re.sub(r"ya29\.[A-Za-z0-9_\-]+", "[token]", text)
    text = re.sub(
        r"(?i)(authorization|cookie|sapisid|refresh_token|access_token|client_secret)[=:]\s*\S+",
        r"\1=[redacted]",
        text,
    )
    text = re.sub(r"https?://\S+", "[url]", text)
    return text[:240] or "Library request failed"


def auth_kind(data: object) -> str | None:
    if not isinstance(data, dict):
        return None
    if data.get("refresh_token") and data.get("access_token"):
        return "oauth"
    lowered = {str(k).lower() for k in data}
    if "cookie" in lowered or "authorization" in lowered:
        return "browser"
    return None


def load_client(force: bool = False):
    global client, method
    with lock:
        if client is not None and not force:
            return client
        if not AUTH_PATH.exists():
            client = None
            method = None
            return None
        data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        kind = auth_kind(data)
        method = kind
        try:
            if kind == "oauth":
                client_id = os.environ.get("YTMUSIC_CLIENT_ID", "").strip()
                client_secret = os.environ.get("YTMUSIC_CLIENT_SECRET", "").strip()
                if not client_id or not client_secret:
                    raise RuntimeError(
                        "Set YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET for device sign-in"
                    )
                from ytmusicapi import OAuthCredentials, YTMusic

                client = YTMusic(
                    str(AUTH_PATH),
                    oauth_credentials=OAuthCredentials(client_id, client_secret),
                )
            elif kind == "browser":
                from ytmusicapi import YTMusic

                client = YTMusic(str(AUTH_PATH))
            else:
                raise RuntimeError("Auth file is not a device token or browser session")
        except ImportError as exc:
            raise RuntimeError(
                "ytmusicapi is not installed. Run pip install -r services/ytmusic/requirements.txt"
            ) from exc
        return client


def clear_state() -> None:
    global client, method, pending
    with lock:
        client = None
        method = None
        pending = None
        cache.clear()


def cached(key: str, loader, ttl: int = 45):
    now = time.time()
    with lock:
        hit = cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = loader()
    with lock:
        cache[key] = (now + ttl, value)
    return value


def revoke(token: str) -> None:
    if not token:
        return
    try:
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/revoke",
            data=urllib.parse.urlencode({"token": token}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            res.read()
    except Exception:
        return


def save_oauth(token: dict) -> None:
    expires_in = int(token.get("expires_in") or 3600)
    data = {
        "scope": token.get("scope") or "https://www.googleapis.com/auth/youtube",
        "token_type": token.get("token_type") or "Bearer",
        "access_token": token["access_token"],
        "refresh_token": token["refresh_token"],
        "expires_in": expires_in,
        "expires_at": int(time.time()) + expires_in,
    }
    AUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    AUTH_PATH.write_text(json.dumps(data), encoding="utf-8")
    try:
        os.chmod(AUTH_PATH, 0o600)
    except OSError:
        pass


def window(offset: int, limit: int) -> tuple[int, int, int]:
    offset = max(0, offset)
    limit = min(50, max(1, limit))
    return offset, limit, min(201, offset + limit + 1)


def require_client():
    yt = load_client()
    if yt is None:
        raise PermissionError("Not connected")
    return yt


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        path = urllib.parse.urlparse(self.path).path
        print(f"[ytmusic] {self.command} {path}")

    def _authorized(self) -> bool:
        if not SERVICE_KEY:
            return True
        got = self.headers.get("x-service-key", "")
        return hmac.compare_digest(got, SERVICE_KEY)

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, exc: BaseException) -> None:
        if isinstance(exc, PermissionError):
            self._send(401, {"error": "auth_required", "message": public_error(exc)})
            return
        text = public_error(exc)
        code = 401 if re.search(r"401|expired|unauthorized|auth", text, re.I) else 502
        self._send(code, {"error": "library_error", "message": text})

    def _query(self):
        return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        path = urllib.parse.urlparse(self.path).path
        qs = self._query()
        try:
            if path == "/health":
                self._send(200, {"ok": True})
                return
            if path == "/status":
                self._send(200, status_payload())
                return
            offset = int((qs.get("offset") or ["0"])[0] or 0)
            limit = int((qs.get("limit") or ["25"])[0] or 25)
            if path == "/playlists":
                self._send(200, list_playlists(offset, limit))
                return
            if path == "/playlist":
                self._send(200, one_playlist((qs.get("id") or [""])[0], offset, limit))
                return
            if path == "/liked":
                self._send(200, liked(offset, limit))
                return
            if path == "/library":
                self._send(200, library_songs(offset, limit))
                return
            if path == "/home":
                rows = int((qs.get("limit") or ["8"])[0] or 8)
                self._send(200, home(rows))
                return
            self._send(404, {"error": "not found"})
        except Exception as exc:
            self._fail(exc)

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/auth/device/start":
                self._send(200, start_device())
                return
            if path == "/auth/device/poll":
                self._send(200, poll_device())
                return
            if path == "/disconnect":
                disconnect()
                self._send(200, {"ok": True, "connected": False})
                return
            if path == "/reload":
                self._send(200, reload_client())
                return
            self._send(404, {"error": "not found"})
        except Exception as exc:
            self._fail(exc)


def status_payload() -> dict:
    if not AUTH_PATH.exists():
        return {
            "connected": False,
            "service": True,
            "method": None,
            "accountName": "",
            "error": "",
        }
    try:
        yt = load_client()
        info = yt.get_account_info() if yt is not None else {}
        name = ""
        if isinstance(info, dict):
            name = info.get("accountName") or info.get("channelHandle") or ""
        return {
            "connected": yt is not None,
            "service": True,
            "method": method,
            "accountName": name,
            "error": "",
        }
    except Exception as exc:
        return {
            "connected": False,
            "service": True,
            "method": method,
            "accountName": "",
            "error": public_error(exc),
        }


def list_playlists(offset: int, limit: int) -> dict:
    offset, limit, want = window(offset, limit)

    def load():
        rows = require_client().get_library_playlists(limit=want) or []
        return [item for item in (playlist_from(row) for row in rows) if item]

    return page(cached(f"playlists:{want}", load), offset, limit)


def one_playlist(playlist_id: str, offset: int, limit: int) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,80}", playlist_id or ""):
        raise ValueError("Invalid playlist id")
    offset, limit, want = window(offset, limit)

    def load():
        return require_client().get_playlist(
            playlist_id, limit=want, related=False, suggestions_limit=0
        )

    data = cached(f"playlist:{playlist_id}:{want}", load)
    body = songs_page(data, offset, limit)
    if isinstance(data, dict):
        body["name"] = data.get("title") or "Playlist"
    return body


def liked(offset: int, limit: int) -> dict:
    offset, limit, want = window(offset, limit)
    data = cached(f"liked:{want}", lambda: require_client().get_liked_songs(limit=want))
    return songs_page(data, offset, limit)


def library_songs(offset: int, limit: int) -> dict:
    offset, limit, want = window(offset, limit)
    data = cached(
        f"library:{want}",
        lambda: require_client().get_library_songs(limit=want, validate_responses=False),
    )
    return songs_page(data, offset, limit)


def home(rows: int) -> dict:
    rows = min(12, max(1, rows))
    data = cached(f"home:{rows}", lambda: require_client().get_home(limit=rows))
    return map_home(data)


def start_device() -> dict:
    global pending
    client_id = os.environ.get("YTMUSIC_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YTMUSIC_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RuntimeError(
            "Set YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET. Create a TV and limited-input OAuth client; this is not website Google sign-in."
        )
    try:
        from ytmusicapi.auth.oauth import OAuthCredentials
    except ImportError as exc:
        raise RuntimeError(
            "ytmusicapi is not installed. Run pip install -r services/ytmusic/requirements.txt"
        ) from exc
    creds = OAuthCredentials(client_id, client_secret)
    code = creds.get_code()
    with lock:
        pending = {
            "device_code": code.get("device_code"),
            "interval": int(code.get("interval") or 5),
            "expires": time.time() + int(code.get("expires_in") or 1800),
            "creds": creds,
        }
    return {
        "userCode": code.get("user_code"),
        "verificationUrl": code.get("verification_url") or "https://www.google.com/device",
        "interval": int(code.get("interval") or 5),
        "expiresIn": int(code.get("expires_in") or 1800),
    }


def poll_device() -> dict:
    global pending
    with lock:
        flow = pending
    if not flow:
        return {"status": "error", "message": "Sign-in hasn't been started"}
    if time.time() > flow["expires"]:
        with lock:
            pending = None
        return {"status": "expired", "message": "That code expired"}
    token = flow["creds"].token_from_code(flow["device_code"])
    error = token.get("error") if isinstance(token, dict) else None
    if error in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    if error:
        if error in ("access_denied", "expired_token"):
            with lock:
                pending = None
        return {
            "status": "error",
            "message": public_error(RuntimeError(token.get("error_description") or error)),
        }
    if not isinstance(token, dict) or not token.get("refresh_token") or not token.get("access_token"):
        return {"status": "error", "message": "Google did not return a usable token"}
    save_oauth(token)
    with lock:
        pending = None
        cache.clear()
    global client
    with lock:
        client = None
    load_client(force=True)
    return {"status": "connected"}


def disconnect() -> None:
    access = refresh = None
    if AUTH_PATH.exists():
        try:
            data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                access = data.get("access_token")
                refresh = data.get("refresh_token")
        except Exception:
            pass
        try:
            AUTH_PATH.unlink()
        except OSError:
            pass
    clear_state()
    if isinstance(refresh, str):
        revoke(refresh)
    elif isinstance(access, str):
        revoke(access)


def reload_client() -> dict:
    with lock:
        cache.clear()
    global client
    with lock:
        client = None
    return status_payload()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[ytmusic] listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
