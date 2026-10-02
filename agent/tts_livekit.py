"""
Custom LiveKit TTS plugin backed by the pluggable TTS provider registry.

Also tees generated audio into the active CallRecorder so every agent utterance
is captured on-device.
"""
from __future__ import annotations

import io
import time
from typing import Optional

import numpy as np

import recorder
from livekit import agents as lk_agents  # noqa: F401 (import side effects)
from livekit.agents import tts as _lk_tts
from livekit.rtc import AudioFrame


class _Chunked(_lk_tts.ChunkedStream):
    def __init__(self, tts: "_ProviderTTS", text: str, conn_options):
        super().__init__(tts=tts, input_text=text, conn_options=conn_options)
        self._tts = tts

    def _sentences(self, text: str):
        import re
        parts = re.split(r"(?<=[.!?।॥])\s*", text.strip())
        out = [p.strip() for p in parts if p.strip()]
        return out or [text.strip()]

    async def _synth_one(self, text: str):
        import io
        import re
        import soundfile as sf
        from tts_providers import PROVIDERS
        audio = await self._route(text)
        buf = io.BytesIO()
        sf.write(buf, audio, 24000, format="WAV")
        return audio, buf.getvalue()

    async def _route(self, text: str) -> "np.ndarray":
        """Pick the TTS voice per utterance by script:
        Devanagari -> IndicF5 Hinglish voice (indicator: the caller is Hindi);
        everything else -> the configured default voice (kokoro for English)."""
        import re
        from tts_providers import PROVIDERS
        if re.search(r"[\u0900-\u097F]", text):
            ind = PROVIDERS.get("indic")
            if ind is not None:
                try:
                    return await ind.synthesize(
                        text,
                        voice=self._tts._voice,
                        lang="hi",
                        speed=self._tts._speed,
                        emotion=self._tts._emotion,
                    )
                except Exception:
                    pass  # fall through to default provider
        return await self._tts._provider.synthesize(
            text,
            voice=self._tts._voice,
            lang=self._tts._lang,
            speed=self._tts._speed,
            emotion=self._tts._emotion,
        )

    async def _run(self, output_emitter):
        import time
        import numpy as np
        t0 = time.time()
        output_emitter.initialize(
            request_id=f"kokoro-{int(t0*1000)}",
            sample_rate=24000,
            num_channels=1,
            mime_type="audio/wav",
        )
        LEAD = np.zeros(int(0.10 * 24000), dtype=np.float32)      # calm 100 ms lead-in
        PAUSE = np.zeros(int(0.28 * 24000), dtype=np.float32)     # gentle 280 ms breath gap
        appended_lead = False
        for chunk in self._sentences(self.input_text):
            audio, wav = await self._synth_one(chunk)
            if not appended_lead and audio.size:
                audio = np.concatenate([LEAD, audio]); appended_lead = True
            elif audio.size:
                audio = np.concatenate([PAUSE, audio])
            buf = io.BytesIO()
            import soundfile as sf
            sf.write(buf, audio, 24000, format="WAV")
            wav = buf.getvalue()
            output_emitter.push(wav)
            rec = recorder.active()
            if rec is not None:
                rec.add_agent_audio(audio)


class ProviderTTS(_lk_tts.TTS):
    def __init__(self, provider, voice: str = "af_heart", lang: str = "en",
                 speed: float = 1.0, emotion: str = "natural"):
        super().__init__(capabilities=_lk_tts.TTSCapabilities(streaming=False),
                         sample_rate=24000, num_channels=1)
        from tts_providers import PROVIDERS, get_voices
        p = PROVIDERS.get(provider)
        if p is None:
            raise RuntimeError(f"unknown TTS provider '{provider}'")
        self._provider = p
        self._voice = voice or p.meta().default_voice
        self._lang = lang
        self._speed = float(speed)
        self._emotion = emotion
        self._provider_key = provider

    @property
    def provider(self) -> str:
        return self._provider_key

    @property
    def model(self) -> str:
        return self._provider_key

    def update_options(self, *, voice=None, lang=None, speed=None, emotion=None):
        if voice:
            self._voice = voice
        if lang:
            self._lang = lang
        if speed:
            self._speed = float(speed)
        if emotion:
            self._emotion = emotion
        return self

    def synthesize(self, text: str, *, conn_options=None) -> _lk_tts.ChunkedStream:
        return _Chunked(self, text, conn_options or _lk_tts.DEFAULT_API_CONNECT_OPTIONS)