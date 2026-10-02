"""
Tiny local HTTP TTS service for UI "test voice" + demo generation.
Reuses the pluggable provider registry (Kokoro by default).
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tts_providers  # noqa: E402

PORT = int(os.environ.get("SYNTH_PORT", "8123"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        return

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {"ok": True, "providers": list(tts_providers.PROVIDERS.keys())})
        elif self.path.startswith("/voices"):
            self._json(200, {"voices": tts_providers.get_voices()})
        elif self.path.startswith("/providers"):
            self._json(200, {"providers": tts_providers.list_providers()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad request: {e}"})
            return
        text = (body.get("text") or "").strip()[:400]
        voice = body.get("voice") or "af_heart"
        provider = body.get("provider") or "kokoro"
        speed = float(body.get("speed") or 1.0)
        lang = body.get("lang") or "en"
        emotion = body.get("emotion") or "natural"
        if not text:
            self._json(400, {"error": "empty text"})
            return

        def run():
            return tts_providers.synthesize(provider, text, voice, lang, speed, emotion)

        import asyncio
        audio = asyncio.run(run())
        buf = io.BytesIO()
        import soundfile as sf
        sf.write(buf, audio, 24000, format="WAV")
        data = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"synth server on http://127.0.0.1:{PORT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()