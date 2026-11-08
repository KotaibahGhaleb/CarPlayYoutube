"""Write a YouTube Music browser session to the server auth file.

Usage (on the machine that runs the library service):
  python services/ytmusic/setup_browser.py path\\to\\headers.txt

headers.txt is a local file you create from your own browser. Do not commit
it, and do not paste it into chat. Firefox's "copy request headers" format
is the one ytmusicapi documents.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python services/ytmusic/setup_browser.py headers.txt", file=sys.stderr)
        return 2
    source = Path(sys.argv[1])
    raw = source.read_text(encoding="utf-8")
    dest = Path(os.environ.get("YTMUSIC_AUTH_PATH", ".secrets/ytmusic-auth.json"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    import ytmusicapi

    ytmusicapi.setup(filepath=str(dest), headers_raw=raw)
    print(f"Wrote browser session to {dest}")
    print("Restart the library service, then use Refresh in the app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
