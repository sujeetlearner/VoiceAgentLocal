"""
KokoroVoice 24/7 local voice agent.

Run as a background daemon (spawned by the Node backend, or `python agent.py`):
  1. Registers with the local LiveKit server (JOIN_WORKER).
  2. For every call into a room it answers with:
       Silero VAD -> faster-whisper STT -> Ollama LLM (decision tree) -> Kokoro TTS,
     following the decision tree configured from the UI.
  3. Records every call (user + agent audio) and a timestamped transcript to ./data/recordings.
  4. Pushes live transcript/state events to the backend for the UI.

Everything runs on-device. No cloud services involved.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.request

from livekit import agents as _lk_agents  # noqa
from livekit.agents import (  # noqa: F401
    Agent,
    AgentSession,
    ChatContext,
    ChatMessage,
    JobContext,
    WorkerOptions,
    cli,
    utils,
)
from livekit.agents.llm.chat_context import Instructions
from livekit import rtc

from decision import build_system_prompt, extract_action, load_config, sanitize_agent_reply
import decision
import recorder
from stt_local import WhisperSTT

# silence noisy asyncio/heavy-model warnings in daemon logs
import logging
for _nm in ("faster_whisper", "torch", "urllib3", "faster-whisper"):
    logging.getLogger(_nm).setLevel(logging.WARNING)

AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(AGENT_DIR, os.environ.get("VOICEAGENT_DATA", "../data"))
OLLAMA_BASE = os.environ.get("OLLAMA_BASE", "http://127.0.0.1:11434/v1")
NODE_URL = os.environ.get("NODE_URL", "http://127.0.0.1:4001")

_cfg: dict = {}
_config_path = os.path.join(DATA_DIR, "config.json")


def _reload_config() -> dict:
    global _cfg
    _cfg = load_config(_config_path)
    return _cfg


def _post_event(payload: dict) -> None:
    try:
        req = urllib.request.Request(
            f"{NODE_URL}/api/call/events",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=1.0)
    except Exception:
        pass


class VoiceAgent(Agent):
    def __init__(self, *, system_prompt: str, welcome: str, recorder_ref) -> None:
        super().__init__(instructions=Instructions(system_prompt))
        self._welcome = welcome
        self._rec = recorder_ref
        self._nudged = False
        self._forced = False
        self._caller_lang = None

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage
    ) -> None:
        """Help the LLM detect a non-English caller."""

        try:
            lang = self._caller_lang() if callable(self._caller_lang) else str(self._caller_lang or "")
        except Exception:
            lang = ""
        low = lang.lower().strip()
        if low not in ("", "en", "en-us", "en-gb", "auto") and new_message is not None:
            if low.startswith("hi"):
                hint = (
                    "The caller is speaking Hindi/Hinglish (Hindi mixed with "
                    "English words). Reply exactly like a native Hindi speaker: "
                    "write Hindi in Devanagari script (English words allowed "
                    "inline, never Romanized Hindi). Match the same mix of "
                    "languages they are using."
                )
            else:
                hint = (
                    f"The caller is speaking {lang}. Reply in that language as "
                    "a native speaker would."
                )
            msg = ChatMessage(role="system", content=[hint])
            items = turn_ctx.items
            try:
                idx = items.index(new_message)
            except ValueError:
                idx = len(items)
            items.insert(idx, msg)
        await super().on_user_turn_completed(turn_ctx, new_message)

    async def on_enter(self) -> None:
        if self._welcome:
            # Speak the greeting straight through TTS (no LLM round-trip) so the
            # caller hears us immediately and the model never queues the first turn.
            try:
                self.session.say(self._welcome, add_to_chat_ctx=True)
            except Exception as exc:
                print(f"[agent] greeting TTS failed ({exc!r}); using LLM greeting")
                await self.session.generate_reply(instructions=self._welcome)


async def _subscribe_user_audio(room: rtc.Room, rec) -> None:
    """Record the remote user side of the call to a local WAV (24 kHz mono)."""
    def frame_to_float32(frame: rtc.AudioFrame) -> None:
        try:
            import numpy as np
            buf = frame.data if hasattr(frame, "data") else frame  # bytes/int16
            arr = np.frombuffer(buf, dtype=np.int16) if isinstance(buf, (bytes, bytearray)) else np.asarray(buf)
            if frame.num_channels and frame.num_channels > 1:
                arr = arr.reshape(-1, frame.num_channels).mean(axis=1)
            fl = arr.astype(np.float32) / 32768.0
            # resample to 24k linearly
            if frame.sample_rate != 24000 and fl.size:
                n = int(round(fl.shape[0] * 24000 / frame.sample_rate))
                pos = np.linspace(0, max(fl.shape[0] - 1, 1), n)
                lo = pos.astype(np.int64); hi = np.minimum(lo + 1, fl.shape[0] - 1)
                frac = (pos - lo).astype(np.float32)
                fl = fl[lo] * (1 - frac) + fl[hi] * frac
            rec.add_user_audio(fl)
        except Exception:
            pass

    async def on_track_published(
            track: rtc.RemoteAudioTrack, publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
        if not isinstance(track, rtc.RemoteAudioTrack):
            return
        try:
            stream = rtc.AudioStream(track)
            async for ev in stream:
                frame_to_float32(ev.frame)
        except Exception:
            pass

    room.on("track_published", on_track_published)


from livekit.agents.worker import AgentServer


def _prewarm_job_process(job) -> None:
    """Runs in every job process at spawn: preloads the heavy models once so the
    first (and every subsequent) call starts from a warm process — no ~18 s
    torch import mid-call. Best-effort; failures just degrade to cold start."""
    import time
    t0 = time.time()
    try:
        _reload_config()
        try:
            import torch  # noqa: F401
        except Exception as exc:
            print(f"[prewarm] torch import failed: {exc}")
        try:
            import tts_providers
            from tts_providers import PROVIDERS
            provider = PROVIDERS.get(_cfg.get("tts_provider", "kokoro"))
            if provider is not None:
                provider.warm()
        except Exception as exc:
            print(f"[prewarm] kokoro warm failed: {exc}")
        try:
            import asyncio
            from livekit.plugins.silero import VAD
            VAD.load()
        except Exception as exc:
            print(f"[prewarm] vad warm failed: {exc}")
        try:
            from stt_local import warm_up
            warm_up(_cfg.get("stt_model", "base"))
        except Exception as exc:
            print(f"[prewarm] whisper warm failed: {exc}")
        try:
            import urllib.request
            body = json.dumps({"model": _cfg.get("llm", "qwen2.5:7b-instruct"),
                               "messages": [{"role": "user", "content": "hi"}],
                               "stream": False, "max_tokens": 1, "keep_alive": "-1m"}).encode()
            req = urllib.request.Request(f"{OLLAMA_BASE if OLLAMA_BASE.endswith('/v1') else OLLAMA_BASE + '/v1'}/chat/completions",
                                         data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                resp.read()
            print(f"[prewarm] llm {_cfg.get('llm', 'qwen2.5:7b-instruct')} resident")
        except Exception as exc:
            print(f"[prewarm] llm warm failed: {exc}")
    except Exception as exc:
        print(f"[prewarm] failed: {exc}")
    print(f"[prewarm] models ready in {time.time() - t0:.1f}s")


server = AgentServer(
    load_threshold=0.5,
    num_idle_processes=1,
    initialize_process_timeout=900,
    job_memory_warn_mb=1800,
    setup_fnc=_prewarm_job_process,
)


@server.rtc_session(agent_name="")
async def entrypoint(ctx: JobContext) -> None:
    _reload_config()
    call_id = ctx.job.id.replace("-", "")[:12]
    rec = recorder.CallRecorder(call_id, enabled=bool(_cfg.get("record_calls", False)))
    recorder.set_active(rec)
    _post_event({"call_id": call_id, "type": "state", "state": "starting"})

    # ---- LLM: Ollama's OpenAI-compatible endpoint (local) ----
    from livekit.plugins.openai import LLM
    llm = LLM(
        model=_cfg.get("llm", "phi:latest"),
        base_url=OLLAMA_BASE,
        api_key="llm-local",
        temperature=float(_cfg.get("llm_temperature", 0.3)),
        max_completion_tokens=200,
        extra_body={"max_tokens": 200, "keep_alive": "-1m"},
    )

    # ---- STT: local faster-whisper ----
    stt = WhisperSTT(model=_cfg.get("stt_model", "base"))

# ---- VAD: silero (local) — activated only on clear speech so background
#         echo/noise cannot abort the agent mid-sentence ----
    from livekit.plugins.silero import VAD
    vad = VAD.load(activation_threshold=0.62, min_silence_duration=0.6)

    # ---- TTS: pluggable provider (Kokoro default) ----
    from tts_livekit import ProviderTTS
    from tts_providers import PROVIDERS
    tts_key = str(_cfg.get("tts_provider") or "kokoro").strip()
    if tts_key not in PROVIDERS:
        tts_key = "kokoro"   # never let a bad config kill the call
    tts = ProviderTTS(
        provider=tts_key,
        voice=_cfg.get("tts_voice", "af_bella"),
        lang=_cfg.get("language", "en"),
        speed=float(_cfg.get("tts_speed", 0.9) or 0.9),
        emotion=_cfg.get("tts_emotion", "natural"),
    )

    system_prompt = build_system_prompt(_cfg)
    welcome = _cfg.get("welcome", "")

    agent = VoiceAgent(system_prompt=system_prompt, welcome=welcome, recorder_ref=rec)
    agent._caller_lang = lambda: stt.language
    session = AgentSession(
        stt=stt, vad=vad, llm=llm, tts=tts,
        user_away_timeout=10.0,
        turn_handling={
            "endpointing": {"min_delay": 0.7, "max_delay": 3.0},
            "interruption": {
                "enabled": True,
                "min_duration": 0.4,   # ~400ms of speech to barge in
                "min_words": 3,        # ...at least 3 clear words
                "false_interruption_timeout": 1.5,
                "resume_false_interruption": True,  # auto-resume if it was a false stop
            },
        },
    )

    # ---- live transcript + actions from committed messages ----
    last_user_text = ""

    async def _safely_speak(why: str, instructions: str) -> None:
        """Interrupt (if any) then generate a follow-up reply.

        NOTE: in livekit-agents 1.8.x, `session.interrupt()` returns a
        Future and `session.generate_reply()` returns a SpeechHandle —
        neither is a coroutine. Both are invoked directly here (guarded),
        so an API mismatch can never silently swallow the agent's reply.
        """
        print(f"[agent] speak({why})")
        try:
            h = session.interrupt()
            if h:
                await h
        except Exception as exc:
            print(f"[agent] interrupt failed ({why}): {exc!r}")
        try:
            session.generate_reply(instructions=instructions)
            _post_event({"call_id": call_id, "type": "state", "state": f"speaking-{why}"})
        except Exception as exc:
            print(f"[agent] generate_reply failed ({why}): {exc!r}")
            _post_event({"call_id": call_id, "type": "state", "state": "fallback-reply"})

    def _suppress_action(why: str) -> None:
        """Caller never asked for an end/transfer — undo the LLM's tag and follow up."""
        rec.note(f"action-suppressed: {why}")
        _post_event({"call_id": call_id, "type": "action", "action": "continue"})
        asyncio.get_event_loop().create_task(_safely_speak(
            "suppress",
            "The caller did NOT ask to end the call or be transferred. "
            "Politely ask one short sentence if there is anything else "
            "you can help them with today. Do not say goodbye.",
        ))

    def on_item(ev) -> None:
        try:
            _on_item(ev)
        except Exception as exc:
            print(f"[agent] on_item error: {exc!r}")

    def _on_item(ev) -> None:
        nonlocal last_user_text
        item = getattr(ev, "item", None)
        if item is None:
            return
        role = getattr(item, "role", None)
        text = getattr(item, "text", None)
        if not text:
            content = getattr(item, "content", None)
            if isinstance(content, (list, tuple)):
                text = "".join(c for c in content if isinstance(c, str))
            elif isinstance(content, str):
                text = content
            else:
                text = ""
        if not text or not role:
            return
        if role == "user":
            last_user_text = text.strip()
            agent._nudged = False
            agent._forced = False
            rec.append_user(last_user_text)
            _post_event({"call_id": call_id, "type": "transcript", "speaker": "user", "text": last_user_text})
        elif role == "assistant":
            action = extract_action(text)
            clean = sanitize_agent_reply(text)
            rec.append_agent(clean)
            _post_event({"call_id": call_id, "type": "transcript", "speaker": "agent", "text": clean})
            if action == "escalate" and not decision.is_escalating(last_user_text):
                _suppress_action("caller did not ask for a human")
                return
            if action == "end" and not decision.is_closing(last_user_text):
                _suppress_action("caller did not say goodbye")
                return
            if decision.is_escalating(last_user_text) and action != "escalate" and not agent._forced:
                # Caller EXPLICITLY asked for a human but the LLM skipped the tag — force it.
                agent._forced = True
                asyncio.get_event_loop().create_task(_safely_speak(
                    "force-escalate",
                    "The caller explicitly asked to speak to a human. Say one short reassuring line "
                    "such as \"Of course, let me connect you to a human agent right away.\" and end "
                    "your reply with exactly " + decision.TAG_ESCALATE + ".",
                ))
                return
            if action in ("escalate", "end"):
                rec.note(f"decision-tree hit -> {action.upper()}")
                _post_event({"call_id": call_id, "type": "action", "action": action})
                asyncio.get_event_loop().call_soon(
                    lambda: asyncio.create_task(
                        _finish(session, rec, action, call_id)
                    )
                )

    def on_state(ev) -> None:
        st = getattr(ev, "new_state", None)
        party = getattr(ev, "type", "")
        _post_event({"call_id": call_id, "type": "state", "state": st, "party": party})
        # The caller is quiet (user_away_timeout) — gently prompt once, never end/transfer.
        if party == "user_state_changed" and st == "away" and not agent._nudged:
            agent._nudged = True
            asyncio.get_event_loop().create_task(_safely_speak(
                "nudge",
                "The caller has been quiet and is waiting. Say ONE polite short "
                "sentence: \"Is there anything else I can help you with today?\" "
                "Do not say goodbye and do not end the call.",
            ))

    session.on("conversation_item_added", on_item)
    session.on("agent_state_changed", on_state)
    session.on("user_state_changed", on_state)

    merged = rtc.Room()
    room = ctx.room or merged
    if rec.enabled:
        _subscribe_user_audio(room, rec)
    start_task = asyncio.create_task(session.start(agent, room=room))
    _post_event({"call_id": call_id, "type": "state", "state": "in-call"})
    try:
        await asyncio.wait_for(
            _wait_ended(session, rec, call_id),
            timeout=max(float(_cfg.get("idle_timeout_s", 60)), 30),
        )
    except (asyncio.TimeoutError, Exception):
        pass
    finally:
        try:
            await session.shutdown(drain=False)
        except Exception:
            pass
        rec.save(ended_reason="call-ended")
        if start_task and not start_task.done():
            start_task.cancel()
        recorder.set_active(None)
        _post_event({"call_id": call_id, "type": "state", "state": "ended"})


async def _wait_ended(session, rec, call_id) -> None:
    """Hold the job open; end when action fired or participant leaves."""
    closed = asyncio.Event()
    def on_close(ev) -> None:
        reason = getattr(ev, "reason", None)
        reason = reason.value if hasattr(reason, "value") else str(reason)
        print(f"[agent] session closed: {reason}")
        rec.note(f"call closed: {reason}")
        _post_event({"call_id": call_id, "type": "state", "state": "closed", "reason": reason})
        closed.set()
    session.on("close", on_close)
    while True:
        if closed.is_set():
            break
        rec_list = rec
        if rec_list and getattr(rec_list, "_ended", False):
            break
        await asyncio.sleep(1)


async def _finish(session, rec, action, call_id) -> None:
    _post_event({"call_id": call_id, "type": "state", "state": f"closing-{action}"})
    try:
        await session.shutdown(drain=True)
    except Exception:
        pass


def main() -> None:
    _reload_config()
    import asyncio
    asyncio.run(server.run())


if __name__ == "__main__":
    main()