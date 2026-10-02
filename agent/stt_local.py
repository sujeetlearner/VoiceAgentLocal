"""
Local STT: faster-whisper via the livekit STT interface.
Audio stays on-device; no cloud transcription.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

os.environ.setdefault("VOICEAGENT_DATA", "../data")
DATA_STT = os.environ.get("VOICEAGENT_STT_MODEL", "base")

_WHISPER_CACHE: dict = {}


def warm_up(model: Optional[str] = None) -> object:
    """Preload a faster-whisper model once per process so the first call is warm."""
    global _WHISPER_CACHE
    name = model or DATA_STT
    if name not in _WHISPER_CACHE:
        from faster_whisper import WhisperModel
        _WHISPER_CACHE[name] = WhisperModel(name, device="auto", compute_type="int8")
    return _WHISPER_CACHE[name]


def _resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    """Simple linear-resample mono float32."""
    if src == dst or x.size == 0:
        return x
    n_out = int(round(x.shape[0] * dst / src))
    pos = np.linspace(0, max(x.shape[0] - 1, 1), n_out)
    lo = pos.astype(np.int64)
    hi = np.minimum(lo + 1, x.shape[0] - 1)
    frac = (pos - lo).astype(np.float32)
    return x[lo] * (1 - frac) + x[hi] * frac


class LocalWhisperSTT:
    """Small wrapper that livekit-agents treats as an STT provider object.

    Uses faster-whisper model downloaded once into the local cache.
    """

    provider: str = "faster-whisper"
    stt_capabilities = None  # overridden below at import time

    def __init__(self, model: Optional[str] = None) -> None:
        self._model_name = model or DATA_STT
        self._model: Optional[object] = None
        self._lock = asyncio.Lock()
        self.last_lang: Optional[str] = None

    async def _ensure(self):
        if self._model is None:
            async with self._lock:
                if self._model is None:
                    loop = asyncio.get_event_loop()
                    self._model = await loop.run_in_executor(
                        None, lambda: warm_up(self._model_name))
        return self._model

    async def recognize(
        self,
        buffer,
        *,
        language: Optional[str] = None,
        conn_options=None,
    ) -> list:
        model = await self._ensure()
        data = np.asarray(buffer.data, dtype=np.float32)
        if data.ndim > 1:
            data = data.mean(axis=1)
        if data.size and np.abs(data).max() > 1.0:
            data = data / 32768.0  # int16 PCM -> float in [-1, 1]
        data16 = _resample(data, int(buffer.sample_rate), 16000)
        # run inference off-thread to avoid blocking the loop
        loop = asyncio.get_event_loop()
        def run():
            segs, info = model.transcribe(
                data16, language=language or None,
                beam_size=1, vad_filter=False, condition_on_previous_text=False,
            )
            text = " ".join(s.text.strip() for s in segs).strip()
            return text, getattr(info, "language", None)
        text, lang = await loop.run_in_executor(None, run)
        self.last_lang = lang or self.last_lang
        return [text]


# --- build a livekit `STT` subclass from the wrapper at import time ---
from livekit.agents import stt as _lk_stt  # noqa: E402


class _RecognizeStream(_lk_stt.StreamAdapter):
    pass


class WhisperSTT(_lk_stt.STT):
    def __init__(self, model: Optional[str] = None) -> None:
        super().__init__(capabilities=_lk_stt.STTCapabilities(
            streaming=False,
            interim_results=False,
        ))
        self._model_src = model or DATA_STT
        self._impl = LocalWhisperSTT(model or DATA_STT)
        self._lang: Optional[str] = None  # pinned after the first utterance
        self._lock = asyncio.Lock()

    @property
    def provider(self) -> str:
        return "faster-whisper"

    @property
    def model(self) -> str:
        return self._model_src

    @property
    def language(self) -> Optional[str]:
        """Language detected on the caller's first utterance ('en', 'hi', ...)."""
        return self._lang

    def _ensure_opts(self, options):
        return options

    async def _recognize_impl(self, buffer, *, language=None, conn_options=None):
        # Pin the caller's language after the first utterance: whisper's automatic
        # language detection is slow (~5-10s) — doing it once then locking the
        # language keeps Hindi/Hinglish accurate and every later turn fast.
        if self._lang is None:
            async with self._lock:
                if self._lang is None:
                    results = await self._impl.recognize(buffer, language=None)
                    self._lang = self._impl.last_lang or "en"
                    lang = self._lang
                else:
                    lang = self._lang
                    results = await self._impl.recognize(buffer, language=lang)
        else:
            lang = self._lang
            results = await self._impl.recognize(buffer, language=lang)
        text = results[0] if results else ""
        return _lk_stt.SpeechEvent(
            type=_lk_stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                _lk_stt.SpeechData(
                    text=text, language=lang or "en",
                    confidence=1.0,
                )
            ],
        )