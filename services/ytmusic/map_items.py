"""Map ytmusicapi payloads into the app's song shape. Read-only."""

from __future__ import annotations


def thumb(item: dict) -> str | None:
    thumbs = item.get("thumbnails") or []
    if not isinstance(thumbs, list) or not thumbs:
        return None
    best = max(thumbs, key=lambda t: (t or {}).get("width") or 0)
    url = best.get("url") if isinstance(best, dict) else None
    return url or None


def artist_line(item: dict) -> str:
    artists = item.get("artists")
    if isinstance(artists, list):
        names = [
            a.get("name")
            for a in artists
            if isinstance(a, dict) and a.get("name")
        ]
        if names:
            return ", ".join(names)
    for key in ("artist", "author", "uploader"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def duration_ms(value) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        seconds = int(value)
        return seconds * 1000 if seconds > 0 else None
    text = str(value).strip()
    if text.isdigit():
        return int(text) * 1000
    parts = text.split(":")
    if not parts or any(not p.isdigit() for p in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds * 1000 if seconds else None


def song_from(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    video_id = item.get("videoId")
    if not isinstance(video_id, str) or len(video_id) != 11:
        return None
    album = item.get("album")
    album_name = album.get("name") if isinstance(album, dict) else None
    available = item.get("isAvailable", True)
    return {
        "id": f"yt:{video_id}",
        "name": item.get("title") or "Untitled",
        "artist": artist_line(item),
        "album": album_name,
        "art": thumb(item),
        "durationMs": duration_ms(item.get("duration_seconds") if item.get("duration_seconds") is not None else item.get("duration")),
        "youtubeId": video_id,
        "available": available is not False,
    }


def playlist_from(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    playlist_id = item.get("playlistId")
    if not isinstance(playlist_id, str) or not playlist_id:
        return None
    count = item.get("count")
    return {
        "id": playlist_id,
        "name": item.get("title") or "Playlist",
        "count": "" if count is None else str(count),
        "art": thumb(item),
    }


def tracks_of(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        tracks = payload.get("tracks")
        if isinstance(tracks, list):
            return tracks
        items = payload.get("items")
        if isinstance(items, list):
            return items
    return []


def page(rows: list, offset: int, limit: int) -> dict:
    offset = max(0, offset)
    limit = min(50, max(1, limit))
    chunk = rows[offset : offset + limit]
    return {
        "items": chunk,
        "offset": offset,
        "limit": limit,
        "hasMore": len(rows) > offset + limit,
    }


def songs_page(payload, offset: int, limit: int) -> dict:
    songs = []
    for item in tracks_of(payload):
        song = song_from(item) if isinstance(item, dict) else None
        if song:
            songs.append(song)
    return page(songs, offset, limit)


def map_home(rows) -> dict:
    sections = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        items = []
        for content in row.get("contents") or []:
            if not isinstance(content, dict):
                continue
            if content.get("videoId"):
                song = song_from(content)
                if song:
                    items.append({"kind": "song", "song": song})
            elif content.get("playlistId"):
                items.append(
                    {
                        "kind": "playlist",
                        "id": content["playlistId"],
                        "name": content.get("title") or "Playlist",
                        "art": thumb(content),
                    }
                )
        sections.append({"title": row.get("title") or "For you", "items": items})
    return {"sections": sections}
