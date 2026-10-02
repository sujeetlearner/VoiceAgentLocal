"""Local HTTP TTS service for Bella's Hindi/Hinglish voice.

Wraps harrrshall/hinglish-tts (IndicF5, duration-patched) behind a tiny
stdlib HTTP server like the kokoro SYNTH server. Model is loaded once and
held warm; all requests serialize on a lock so CPU inference stays
predictable.

IndicXlit (fairseq) does not build on this machine, so the lib_normalize
fallback is monkeypatched to our lightweight Roman->Devanagari converter.
Whitelists (canonical loans / NEs / function words) still take priority.

Endpoints:
    GET  /health            -> {"loaded": bool}
    GET  /tts?text=...      -> audio/wav (24 kHz mono)
    POST /tts {"text":...}  -> audio/wav (24 kHz mono)
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, THIS_DIR)
sys.path.insert(0, os.path.join(THIS_DIR, "hinglish-tts"))

HOST = os.environ.get("INDIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("INDIC_PORT", "8124"))
REF_WAV = os.environ.get(
    "INDIC_REF_WAV",
    os.path.join(THIS_DIR, "hinglish-tts", "data", "reference_audio", "hindi_ref.wav"),
)
REF_TXT = os.path.join(os.path.dirname(REF_WAV), "hindi_ref.txt")
SPEED = float(os.environ.get("INDIC_SPEED", "1.02"))

_state = {"load_error": None, "device": None}
_lock = threading.Lock()
_model = None


def _load() -> None:
    global _model
    import torch
    from inference import load_model
    import scoring.scripts.lib_normalize as ln
    import indic_fallback as fb

    class _FakeXlit:
        """IndicXlit stand-in used only for tokens that miss the whitelists."""
        def translit_word(self, key, topk=1):
            return {"hi": [fb.to_devanagari(key)]}

    ln._get_xlit = lambda: _FakeXlit()          # never import fairseq
    ln._xlit_engine = _FakeXlit()
    device = "cpu"
    _model = load_model(device=device)
    _state["device"] = str(torch.get_num_threads()) + " cpu threads, " + device


def synthesize(text: str, ref_wav: str, ref_txt: str, speed: float) -> bytes:
    if _model is None:
        # Model is loaded exactly once in main(). Never re-attempt a (possibly
        # gated/slow) load per request — that would stall every agent call.
        err = _state.get("load_error") or "model not loaded"
        raise RuntimeError(f"model unavailable: {err[:120]}")
    import io
    import numpy as np
    from inference import synthesize as _synth
    from scoring.scripts.lib_normalize import to_unified_devanagari
    import soundfile as sf

    normalised = to_unified_devanagari(text)
    audio = np.asarray(_synth(_model, normalised, ref_wav, ref_txt, speed=speed), dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio.reshape(-1), 24000, format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        return

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _audio(self, data: bytes):
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {"loaded": _model is not None,
                             "device": _state["device"],
                             "load_error": _state["load_error"]})
        elif self.path.startswith("/tts"):
            from urllib.parse import urlparse, parse_qs
            qs = parse_qs(urlparse(self.path).query)
            text = (qs.get("text") or [""])[0].strip()
            if not text:
                self._json(400, {"error": "empty text"})
                return
            try:
                with _lock:
                    data = synthesize(text, REF_WAV, REF_TXT, SPEED)
                self._audio(data)
            except Exception as e:
                self._json(500, {"error": f"{type(e).__name__}: {e}"})
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
        if not text:
            self._json(400, {"error": "empty text"})
            return
        try:
            with _lock:
                data = synthesize(text, REF_WAV, REF_TXT, body.get("speed") or SPEED)
            self._audio(data)
        except Exception as e:
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


def main() -> None:
    if not os.path.exists(REF_WAV):
        print(f"WARN: reference audio not found at {REF_WAV} (voice cloning unavailable)")
    _state["load_error"] = "pending"
    try:
        _load()
        _state["load_error"] = None
    except Exception as e:
        _state["load_error"] = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"model load deferred: {_state['load_error']}")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"indic server on http://{HOST}:{PORT}  ref={REF_WAV}  device={_state['device']}")
    srv.serve_forever()


if __name__ == "__main__":
    main()