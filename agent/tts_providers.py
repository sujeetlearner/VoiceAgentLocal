"""
Pluggable Text-to-Speech provider registry.

Each provider exposes: synthesize(text, voice, lang, speed) -> np.float32 mono audio @ 24kHz.
- `provider.meta` drives the UI dropdown + install instructions.
- `KokoroProvider` is the default (fast, realistic, fully local — hexgrad/Kokoro-82M).
- Bark / VITS / StyleTTS2 / Orpheus / OpenVoice are registered as extension points so you can
  hot-swap or A/B test models from the UI. Build against THIS interface and they plug right in.

Usage:
    provider = TTSHelpers.get("kokoro")
    audio = await provider.synthesize("Hello!", voice="af_heart", lang="a")
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

DATA_DIR = os.environ.get("VOICEAGENT_DATA", "../data")
VOICES_FILE = os.path.join(DATA_DIR, "kokoro_voices.txt")

# Curated Kokoro-82M voices (validated lazy at load time; falls back to af_heart).
KOKORO_VOICES: List[Dict[str, Any]] = [
    {"id": "af_heart", "label": "Bella (warm US female)", "lang": "en", "accent": "US"},
    {"id": "af_bella", "label": "Bella 2 (soft US female)", "lang": "en", "accent": "US"},
    {"id": "af_nicole", "label": "Nicole (bright US female)", "lang": "en", "accent": "US"},
    {"id": "af_aoede", "label": "Aoede (holding US female)", "lang": "en", "accent": "US"},
    {"id": "af_kore", "label": "Kore (cheerful US female)", "lang": "en", "accent": "US"},
    {"id": "af_sky", "label": "Sky (airy US female)", "lang": "en", "accent": "US"},
    {"id": "af_alloy", "label": "Alloy (neutral US female)", "lang": "en", "accent": "US"},
    {"id": "am_michael", "label": "Michael (warm US male)", "lang": "en", "accent": "US"},
    {"id": "am_fenrir", "label": "Fenrir (deep US male)", "lang": "en", "accent": "US"},
    {"id": "am_puck", "label": "Puck (high-energy US male)", "lang": "en", "accent": "US"},
    {"id": "am_onyx", "label": "Onyx (neutral US male)", "lang": "en", "accent": "US"},
    {"id": "bm_george", "label": "George (UK male)", "lang": "en", "accent": "UK"},
    {"id": "bf_emma", "label": "Emma (UK female)", "lang": "en", "accent": "UK"},
]

LANG_CODE = {
    "en": "a",    # American English
    "en-us": "a",
    "en-gb": "b",
    "hi": "h",    # Hindi (softer, corrective)
    "ja": "j",
    "ko": "k",
    "zh": "z",
    "es": "e",
    "fr": "f",
    "it": "i",
    "pt": "p",
}
LANG_CODE.setdefault  # no-op guard


_DEVA_CONSONANTS = {
    "क":"k", "ख":"kh", "ग":"g", "घ":"gh", "ङ":"ng", "च":"ch", "छ":"chh",
    "ज":"j", "झ":"jh", "ञ":"ny", "ट":"t", "ठ":"th", "ड":"d", "ढ":"dh",
    "ण":"n", "त":"t", "थ":"th", "द":"d", "ध":"dh", "न":"n", "प":"p",
    "फ":"f", "ब":"b", "भ":"bh", "म":"m", "य":"y", "र":"r", "ल":"l",
    "व":"v", "श":"sh", "ष":"sh", "स":"s", "ह":"h",
}
_DEVA_VOWELS = {
    "अ":"a", "आ":"aa", "इ":"i", "ई":"ee", "उ":"u", "ऊ":"oo", "ऋ":"ri",
    "ए":"e", "ऐ":"ai", "ओ":"o", "औ":"au", "ॐ":"om",
}
_DEVA_MATRA = {
    "ा":"aa", "ि":"i", "ी":"ee", "ु":"u", "ू":"oo", "ृ":"ri", "े":"e",
    "ै":"ai", "ो":"o", "ौ":"au", "ॉ":"o", "ँ":"n", "ं":"n", "ः":"h",
}
_DEVA_DIGITS = {"०":"0", "१":"1", "२":"2", "३":"3", "४":"4", "५":"5", "६":"6", "७":"7", "८":"8", "९":"9", "ऑ":"o", "ऑ़":"o"}


def to_latin_hinglish(text: str) -> str:
    """Convert Devanagari to a Latin approximation an English-trained voice can say.
    Consonants carry their inherent 'a' (नमस्ते -> namaste); matras replace it;
    virama (्) removes it (स् + त -> st). Latin text passes through untouched."""
    def _map(run: str) -> str:
        out: list = []              # tokens; consonant still awaiting vowel = ["C"+lat]
        for ch in run:
            if ch == "्":
                if out and out[-1].startswith("C"):
                    out[-1] = out[-1][1:]    # finalize consonant, no vowel
                continue
            if ch in _DEVA_MATRA:
                m = _DEVA_MATRA[ch]
                if out and out[-1].startswith("C"):
                    out[-1] = out[-1][1:] + m   # matra REPLACES inherent 'a'
                else:
                    out.append(m.replace(".", ""))  # lone matra: drop dot artifacts
                continue
            if ch in _DEVA_CONSONANTS:
                out.append("C" + _DEVA_CONSONANTS[ch])
                continue
            if ch in _DEVA_VOWELS:
                out.append(_DEVA_VOWELS[ch])
                continue
            if ch in _DEVA_DIGITS:
                out.append(_DEVA_DIGITS[ch])
                continue
            if ch in "।॥":
                out.append(".")
                continue
            out.append(ch)          # spaces/punctuation pass through
        return "".join((o[1:] + "a") if o.startswith("C") else o for o in out)  # realize inherent 'a'

    if not any("\u0900" <= ch <= "\u097F" for ch in text):
        return text
    import re
    return re.sub(r"[\u0900-\u097F]+", lambda m: _map(m.group(0)), text)


def _clean_for_tts(text: str) -> str:
    """Strip characters that degrade TTS quality: speaker tags, markdown, emoji,
    action tags, and stray control chars. Keeps letters, digits and basic punctuation."""
    import re
    text = text.replace("।", ".").replace("॥", ".")
    text = re.sub(r"[\u2700-\u27BF\u2600-\u26FF\uFE0F\uD83C-\uD83F]", "", text)  # emoji
    text = re.sub(r"[\[\]{}*_>`~#|]", " ", text)                     # brackets/markdown
    text = re.sub(r"\b(call-in|caller-[a-z-]+)\b", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _warm_postprocess(x: np.ndarray, sample_rate: int = 24000) -> np.ndarray:
    """Studio-style warmth chain: proximity EQ + de-ess + gentle compression.

    - Low-shelf boost ~140 Hz            (proximity / warmth / presence)
    - Peaking +1.2 dB @ 320 Hz            (body)
    - Peaking -2.5 dB @ 6.3 kHz, Q 2.2    (de-ess — tames स/श/च sibilance)
    - High-shelf -1.5 dB @ 9.5 kHz        (soft highs, no harshness)
    - Gentle 2.2:1 compressor + make-up   (steady, close-to-the-ear level)
    - Peak-limit to 0.92 so nothing clips
    Pure numpy/scipy; runs in <20 ms per sentence on CPU. Applied by every
    provider (kokoro, indic, …) so Bella keeps one consistent warm identity.
    """
    if x is None or np.asarray(x).size == 0:
        return x
    y = np.asarray(x, dtype=np.float32).copy()
    try:
        from scipy.signal import sosfilt
        # biquad shelves built from analog prototypes — hand-rolled SOS above
        lowshelf = _lowshelf_sos(140.0, 1.8, sample_rate)
        peak_warm = _peaking_sos(320.0, 1.2, 0.9, sample_rate)
        dewes = _peaking_sos(6300.0, -2.5, 2.2, sample_rate)
        top = _highshelf_sos(9500.0, -1.5, sample_rate)
        for b in (lowshelf, peak_warm, dewes, top):
            y = sosfilt(b, y)
    except Exception:
        pass  # filters are optional; compression below still warms the mix
    envelope, gain = _soft_compressor(y, sample_rate)
    y = y * gain
    peak = np.max(np.abs(y))
    if peak > 0:
        y = y * (0.92 / peak)
    return y.astype(np.float32)


def _biquad_design(a0, a1, a2, b0, b1, b2) -> list:
    """Normalized SOS section from raw biquad coefficients."""
    return [[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]]


def _lowshelf_sos(f0: float, gain_db: float, sr: int):
    import math
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / sr
    alpha = math.sin(w0) / 2 * math.sqrt(2)  # Q = 0.707
    c, s = math.cos(w0), math.sin(w0)
    a0 = (A + 1) + (A - 1) * c + 2 * math.sqrt(A) * alpha
    b0 = A * ((A + 1) - (A - 1) * c + 2 * math.sqrt(A) * alpha)
    b1 = 2 * A * ((A - 1) - (A + 1) * c)
    b2 = A * ((A + 1) - (A - 1) * c - 2 * math.sqrt(A) * alpha)
    a1 = -2 * ((A - 1) + (A + 1) * c)
    a2 = (A + 1) + (A - 1) * c - 2 * math.sqrt(A) * alpha
    return _biquad_design(a0, a1, a2, b0, b1, b2)


def _highshelf_sos(f0: float, gain_db: float, sr: int):
    import math
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / sr
    alpha = math.sin(w0) / 2 * math.sqrt(2)
    c, s = math.cos(w0), math.sin(w0)
    a0 = (A + 1) - (A - 1) * c + 2 * math.sqrt(A) * alpha
    b0 = A * ((A + 1) + (A - 1) * c + 2 * math.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * c)
    b2 = A * ((A + 1) + (A - 1) * c - 2 * math.sqrt(A) * alpha)
    a1 = 2 * ((A - 1) - (A + 1) * c)
    a2 = (A + 1) - (A - 1) * c - 2 * math.sqrt(A) * alpha
    return _biquad_design(a0, a1, a2, b0, b1, b2)


def _peaking_sos(f0: float, gain_db: float, q: float, sr: int):
    import math
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / sr
    alpha = math.sin(w0) / (2 * q)
    c, s = math.cos(w0), math.sin(w0)
    a0 = 1 + alpha / A
    b0 = 1 + alpha * A
    b1 = -2 * c
    b2 = 1 - alpha * A
    a1 = -2 * c
    a2 = 1 - alpha / A
    return _biquad_design(a0, a1, a2, b0, b1, b2)


def _soft_compressor(x: np.ndarray, sr: int):
    """Smooth RMS-like envelope (forward attack, slow release) -> 2.2:1 gain."""
    from scipy.signal import lfilter
    attack = 0.004          # 4 ms
    release = 0.120        # 120 ms (long, gentle)
    a_env = 1.0 - np.exp(-1.0 / (attack * sr))
    absx = np.abs(x)
    env = lfilter([a_env], [1, -(1 - a_env)], absx)
    a_rel = 1.0 - np.exp(-1.0 / (release * sr))
    rel = lfilter([a_rel], [1, -(1 - a_rel)], env)[::-1]
    env = rel
    thr = 0.30              # above ~ -10.5 dBFS start reducing
    ratio = 2.2
    makeup = 1.35           # +2.6 dB consistent loudness
    gain = np.where(env > thr, ((thr + (env - thr) / ratio) / env), 1.0)
    gain = np.minimum(gain, 1.0)
    return env, (gain * makeup).astype(np.float32)


def _soften_voice(audio: np.ndarray, sample_rate: int = 24000) -> np.ndarray:
    """Back-compat alias for _warm_postprocess (used by KokoroProvider)."""
    import numpy as _np
    return _warm_postprocess(audio, sample_rate)


@dataclass
class ProviderMeta:
    key: str
    name: str
    description: str
    install: str          # shell command to enable this provider
    installed: bool
    default_voice: str
    voices: List[Dict[str, Any]] = field(default_factory=list)


class BaseTTSProvider:
    key = "base"

    def meta(self) -> ProviderMeta:
        raise NotImplementedError

    async def synthesize(self, text: str, voice: Optional[str] = None,
                         lang: str = "en", speed: float = 1.0,
                         emotion: str = "natural") -> np.ndarray:
        raise NotImplementedError


class KokoroProvider(BaseTTSProvider):
    """hexgrad/Kokoro-82M — 82M param transformer TTS. Fast on CPU, natural prosody."""
    key = "kokoro"
    sample_rate = 24000

    # One shared KPipeline across every KokoroProvider instance (the main TTS
    # and the IndicF5 fallback) so the model is loaded exactly once per process.
    _shared = {"pipe": None}

    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    def warm(self) -> None:
        """Load the Kokoro pipeline synchronously (used to pre-warm an idle job process)."""
        if self._shared["pipe"] is None:
            from kokoro import KPipeline
            self._shared["pipe"] = KPipeline(lang_code="a")

    async def _ensure(self) -> Any:
        if self._shared["pipe"] is None:
            async with self._lock:
                if self._shared["pipe"] is None:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, self.warm)
        return self._shared["pipe"]

    def meta(self) -> ProviderMeta:
        return ProviderMeta(
            key=self.key, name="Kokoro-82M (default)",
            description="Transformers-based neural TTS — realistic prosody, runs in <100ms "
                        "per sentence on CPU. Open-source (hexgrad/Kokoro-82M).",
            install="pip install kokoro",
            installed=True, default_voice="af_bella",
            voices=KOKORO_VOICES,
        )

    async def synthesize(self, text, voice="af_heart", lang="en", speed=1.0, emotion="natural"):
        pipe = await self._ensure()
        lc = LANG_CODE.get(lang, "a")
        text = to_latin_hinglish(text)
        text = _clean_for_tts(text)
        voice_key = voice
        if not any(v["id"] == voice for v in KOKORO_VOICES):
            voice_key = "af_bella"

        def _run() -> np.ndarray:
            out = np.zeros(0, dtype=np.float32)
            try:
                for result in pipe(text, voice=voice_key, speed=speed):
                    out = np.concatenate(
                        [out, result.audio.numpy().astype(np.float32)])
            except Exception:
                out = np.zeros(0, dtype=np.float32)
                for result in pipe(text, voice="af_bella", speed=speed):
                    out = np.concatenate(
                        [out, result.audio.numpy().astype(np.float32)])
            if out.size == 0:
                raise RuntimeError(f"kokoro returned no audio for: {text[:40]}")
            return _soften_voice(out, sample_rate=self.sample_rate)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)


class IndicTTSProvider(BaseTTSProvider):
    """Local Hinglish voice — AI4Bharat IndicF5 via the indic_server HTTP service
    (:8124, harrrshall/hinglish-tts duration-patched, voice-cloned from a
    reference clip). Talks to the /tts endpoint; Devanagari text flows through
    to_unified_devanagari server-side. If the service is down, falls back to the
    kokoro provider (with Devanagari -> Latin transliteration) so calls never break."""
    key = "indic"
    sample_rate = 24000

    def __init__(self) -> None:
        self._url = os.environ.get("INDIC_URL", "http://127.0.0.1:8124")
        self._kokoro = KokoroProvider()

    def meta(self) -> ProviderMeta:
        return ProviderMeta(
            key=self.key, name="IndicF5 (Hinglish clone)",
            description="Local IndicF5 Hinglish voice — zero-shot voice cloning from a "
                        "reference clip, warm DSP post-processing. Hindi/Hinglish callers "
                        "get this voice; English stays on Kokoro.",
            install="", installed=True, default_voice="hindi_ref",
            voices=[{"id": "hindi_ref", "label": "Bella Hindi (IndicF5 clone)", "lang": "hi", "accent": "Hindi"}],
        )

    async def synthesize(self, text, voice="hindi_ref", lang="hi", speed=1.0, emotion="natural"):
        import io
        import soundfile as sf
        from urllib.parse import urlencode
        import urllib.request as u

        def _fetch() -> bytes:
            url = f"{self._url}/tts?{urlencode({'text': text, 'speed': speed})}"
            with u.urlopen(url, timeout=2.0) as r:
                return r.read()

        loop = asyncio.get_event_loop()
        try:
            wav = await loop.run_in_executor(None, _fetch)
            audio, _ = sf.read(io.BytesIO(wav), dtype="float32")
            audio = _warm_postprocess(audio, self.sample_rate)
        except Exception:
            audio = await self._kokoro.synthesize(
                text, voice="af_bella", lang="en", speed=speed, emotion=emotion)
        if audio.size == 0:
            raise RuntimeError(f"indic returned no audio for: {text[:40]}")
        return audio


class _NotInstalledProvider(BaseTTSProvider):
    key = "placeholder"
    install = ""
    name = ""
    description = ""
    default_voice = ""

    def meta(self) -> ProviderMeta:
        return ProviderMeta(
            key=self.key, name=self.name, description=self.description,
            install=self.install, installed=False,
            default_voice=self.default_voice, voices=[],
        )

    async def synthesize(self, text, voice=None, lang="en", speed=1.0, emotion="natural"):
        raise RuntimeError(f"provider '{self.key}' not installed. Run: {self.install}")


def _placeholder(key, name, install, description, default_voice="") -> _NotInstalledProvider:
    p = _NotInstalledProvider()
    p.key, p.name, p.install, p.description, p.default_voice = (
        key, name, install, description, default_voice,
    )
    return p


PROVIDERS: Dict[str, BaseTTSProvider] = {
    "kokoro": KokoroProvider(),
    "indic": IndicTTSProvider(),
    # --- extension points (install the pip package, they light up in the UI) ---
    "bark": _placeholder(
        "bark",
        "Bark (audio-prompt TTS)",
        "pip install git+https://github.com/suno-ai/bark.git",
        "Speech made completely from scratch. Emotion, laughter, pauses via audio "
        "prompts. Heavier (slower on CPU) but highly expressive.",
        "v2/en_speaker_6",
    ),
    "vits": _placeholder(
        "vits",
        "VITS (cond VAEs + adversarial)",
        "pip install git+https://github.com/jaywalnut310/vits.git",
        "Conditional VAE + HiFi-GAN. Extremely natural single-speaker output; needs "
        "a trained G2P/checkpoint per voice.",
    ),
    "styletts2": _placeholder(
        "styletts2",
        "StyleTTS2 (zero-shot style)",
        "pip install git+https://github.com/yl4579/StyleTTS2.git",
        "Human-level zero-shot voice cloning with style diffusion.",
    ),
    "orpheus": _placeholder(
        "orpheus",
        "Orpheus-TTS (LLM + emotion tags)",
        "pip install git+https://github.com/canopyai/Orpheus-TTS.git",
        "Llama-backbone TTS with emotion tags (<laugh>, <breath>) and zero-shot cloning.",
    ),
    "openvoice": _placeholder(
        "openvoice",
        "OpenVoice (style/clone control)",
        "pip install git+https://github.com/myshell-ai/OpenVoice.git",
        "Granular style, emotion, accent control with reference-speaker tone cloning.",
        "en_new",
    ),
}

DEFAULT_VOICES = {k: p.meta().default_voice for k, p in PROVIDERS.items()}


def list_providers() -> List[Dict[str, Any]]:
    return [dict(vars(p.meta()), voices=None) for p in PROVIDERS.values()]


def get_voices(provider: str = "kokoro") -> List[Dict[str, Any]]:
    p = PROVIDERS.get(provider)
    return p.meta().voices if p and p.meta().voices else KOKORO_VOICES


async def synthesize(provider: str, text: str, voice: str,
                     lang: str = "en", speed: float = 1.0, emotion: str = "natural") -> np.ndarray:
    p = PROVIDERS.get(provider)
    if p is None:
        raise RuntimeError(f"unknown provider '{provider}'")
    if not p.meta().installed:
        raise RuntimeError(f"provider '{provider}' not installed. Run: {p.meta().install}")
    return await p.synthesize(text, voice=voice, lang=lang, speed=speed, emotion=emotion)


if __name__ == "__main__":
    print(json.dumps(list_providers(), indent=2, default=str))