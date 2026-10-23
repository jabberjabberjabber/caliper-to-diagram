"""Serve the caliper-to-diagram web app on localhost and open it in a browser."""

import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent / "web"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain through the registry; force the right types.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
    }

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description="Turn caliper measurements into dimensioned drawings.")
    parser.add_argument("--port", type=int, default=8765, help="port to serve on (0 picks a free one)")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    args = parser.parse_args()

    handler = functools.partial(QuietHandler, directory=str(WEB_DIR))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/"
        print(f"caliper-to-diagram running at {url}  (Ctrl+C to stop)")
        if not args.no_browser:
            threading.Timer(0.5, webbrowser.open, (url,)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
