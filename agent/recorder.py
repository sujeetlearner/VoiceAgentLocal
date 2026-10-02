"""
Local-first call recording.

- Transcript: human-readable localized .txt with timestamps (user + agent lines).
- Audio: raw user-side and agent-side WAV saved on-device (24 kHz mono).
Everything stays under ./data/recordings — nothing leaves the machine.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import Optional

import numpy as np

DATA_DIR = os.environ.get("VOICEAGENT_DATA", "../data")
REC_DIR = os.path.join(DATA_DIR, "recordings")
os.makedirs(REC_DIR, exist_ok=True)

_SELF = threading.local()


class CallRecorder:
    def __init__(self, call_id: str, enabled: bool = True) -> None:
        self.call_id = call_id
        self.enabled = enabled
        self.started = time.time()
        self._lock = threading.Lock()
        self._user_chunks: list[np.ndarray] = []
        self._agent_chunks: list[np.ndarray] = []
        self.user_samples = 0
        self.agent_samples = 0
        self._lines: list[str] = []

    # ------------------------------------------------------------------ file paths
    def transcript_path(self) -> str:
        return os.path.join(REC_DIR, f"call-{self.call_id}.txt")

    def user_wav(self) -> str:
        return os.path.join(REC_DIR, f"call-{self.call_id}-user.wav")

    def agent_wav(self) -> str:
        return os.path.join(REC_DIR, f"call-{self.call_id}-agent.wav")

    # ------------------------------------------------------------------ content
    def now(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def append_user(self, text: str) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._lines.append(f"[{self.now()}] USER  >> {text}")

    def append_agent(self, text: str) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._lines.append(f"[{self.now()}] AGENT >> {text}")

    def note(self, text: str) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._lines.append(f"[{self.now()}] NOTE  >> {text}")

    def add_user_audio(self, float32_16k: np.ndarray) -> None:
        """Resample to 24k won't happen here; input from track is converted by caller."""
        if not self.enabled:
            return
        with self._lock:
            self._user_chunks.append(np.asarray(float32_16k, dtype=np.float32))

    def add_agent_audio(self, float32_24k: np.ndarray) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._agent_chunks.append(np.asarray(float32_24k, dtype=np.float32))

    # ------------------------------------------------------------------ finalize
    def save(self, ended_reason: str = "ended") -> dict:
        if not self.enabled:
            return {"call_id": self.call_id, "enabled": False}
        import soundfile as sf
        duration = time.time() - self.started
        with self._lock:
            user = np.concatenate(self._user_chunks) if self._user_chunks else np.zeros(0, np.float32)
            agent = np.concatenate(self._agent_chunks) if self._agent_chunks else np.zeros(0, np.float32)
            lines = list(self._lines)

        files = [self.transcript_path(), self.user_wav(), self.agent_wav()]
        if user.size:
            sf.write(self.user_wav(), user, 24000)
        else:
            if os.path.exists(self.user_wav()):
                os.remove(self.user_wav())
            files.remove(self.user_wav())
        if agent.size:
            sf.write(self.agent_wav(), agent, 24000)
        else:
            if os.path.exists(self.agent_wav()):
                os.remove(self.agent_wav())
            files.remove(self.agent_wav())

        header = [
            "VOICE AGENT CALL TRANSCRIPT  (local, private)",
            "=" * 60,
            f"Call ID   : {self.call_id}",
            f"Started   : {datetime.fromtimestamp(self.started).strftime('%Y-%m-%d %H:%M:%S')}",
            f"Duration  : {duration:.0f}s",
            f"Ended     : {ended_reason}",
            "=" * 60,
        ]
        with open(self.transcript_path(), "w", encoding="utf-8") as f:
            f.write("\n".join(header + lines))

        return {
            "call_id": self.call_id,
            "duration_s": round(duration, 1),
            "ended_reason": ended_reason,
            "files": [os.path.basename(p) for p in files],
        }


_recorder: Optional[CallRecorder] = None


def set_active(r: Optional[CallRecorder]) -> None:
    global _recorder
    _recorder = r


def active() -> Optional[CallRecorder]:
    return _recorder