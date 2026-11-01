"""Static server for the module folder with caching off and byte ranges (the map archives are
read in parts, as Foundry serves them), for tools/*.html.

  python tools/serve.py [port]
"""
import http.server, os, re, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
# Sibling modules (KG Realms: Faerûn) beside this checkout, served at /modules/<id>/ as Foundry would.
MODULES = os.path.abspath(os.path.join(HERE, "..", ".."))


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        match = re.match(r"/modules/([\w-]+)/(.*)", urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0]))
        if match and os.path.isdir(os.path.join(MODULES, match.group(1))):
            return os.path.join(MODULES, match.group(1), *match.group(2).split("/"))
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_GET(self):
        match = re.match(r"bytes=(\d+)-(\d*)$", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        start = int(match.group(1))
        end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        with open(path, "rb") as f:
            f.seek(start)
            body = f.read(end - start + 1)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


os.chdir(os.path.join(HERE, ".."))
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8790), Handler).serve_forever()
