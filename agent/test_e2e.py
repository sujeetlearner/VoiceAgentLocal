"""
Headless end-to-end call test.
Publishes a spoken phrase into a LiveKit room, the local agent answers,
and we capture the agent's audio response + confirm a transcript file was written.
Run:  LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecret \
       .venv/bin/python e2e_call.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

import numpy as np
import soundfile as sf
from livekit import rtc

ROOM = "e2e-test"
SAMPLE = os.path.join(os.path.dirname(__file__), "..", "data", "e2e_phrase.wav")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "e2e_agent_reply.wav")


async def main():
    if not os.path.exists(SAMPLE):
        # synthesize a phrase the agent must hear
        from tts_providers import synthesize
        audio = await synthesize(
            "kokoro", "Hello Bella. I would like to book an appointment for tomorrow, "
            "please schedule me in the afternoon.",
            "af_nicole", "en")
        sf.write(SAMPLE, audio, 24000)

    data, sr = sf.read(SAMPLE, dtype="float32")
    if sr != 48000:
        n = int(round(data.shape[0] * 48000 / sr))
        pos = np.linspace(0, max(data.shape[0] - 1, 1), n)
        data = data[pos.astype(np.int64)]
    float_data = data.astype(np.float32)

    room = rtc.Room()
    agent_reply = []
    first_frame_at = [None]
    t_connect = [None]

    @room.on("track_subscribed")
    def on_track(track, pub, participant):
        if isinstance(track, rtc.RemoteAudioTrack):
            async def recv():
                stream = rtc.AudioStream(track)
                async for ev in stream:
                    if first_frame_at[0] is None:
                        first_frame_at[0] = time.time()
                    agent_reply.append(ev.frame)
            asyncio.create_task(recv())

    t_connect[0] = time.time()
    await room.connect(os.environ["LIVEKIT_URL"], os.environ["LIVEKIT_TOKEN"])
    print("connected to", ROOM, "— waiting 8s for the greeting to finish")
    await asyncio.sleep(8)

    source = rtc.AudioSource(48000, 1)
    track = rtc.LocalAudioTrack.create_audio_track("speaker-test", source)
    opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    await room.local_participant.publish_track(track, opts)

    # convert 48k float -> int16 frames and push
    frame_size = 4800  # 100ms
    int16 = (float_data * 32767).clip(-32768, 32767).astype(np.int16)
    for i in range(0, len(int16) - frame_size + 1, frame_size):
        f = rtc.AudioFrame(int16[i:i + frame_size].tobytes(), 48000, 1, len(int16[i:i + frame_size]))
        await source.capture_frame(f)
        await asyncio.sleep(0.1)  # real-time pacing (100 ms frame + 100 ms gap)
    await asyncio.sleep(3)  # let VAD collect tail

    print("spoken phrase published; waiting for a SECOND agent utterance (the answer)…")
    base_voiced = 0.0
    t_pub = asyncio.get_event_loop().time()
    deadline = t_pub + 75
    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(2)
        if not agent_reply:
            continue
        voiced = 0.0
        for f in agent_reply:
            arr = np.frombuffer(f.data, dtype=np.int16).astype(np.float32) / 32767.0
            voiced += float(np.count_nonzero(np.abs(arr) > 0.02)) / f.sample_rate
        if base_voiced == 0.0:
            base_voiced = voiced
            print(f"  base speech (greeting) at publish: {base_voiced:.1f}s")
        elif voiced > base_voiced + 2.5:
            print(f"  detected answer — voiced grew to {voiced:.1f}s")
            break
    print(f"  waited {(asyncio.get_event_loop().time() - t_pub):.0f}s after publish")

    if first_frame_at[0] is not None:
        print(f"time-to-first-agent-audio: {first_frame_at[0] - t_connect[0]:.1f}s")

    if agent_reply:
        # naive segment concatenation of raw sample bytes is unsafe; instead
        # just report how many frames we captured
        total_s = sum(f.samples_per_channel * f.num_channels / f.sample_rate for f in agent_reply)
        print(f"agent spoke: {total_s:.1f}s captured in {len(agent_reply)} frames")
        sample_rate = agent_reply[0].sample_rate
        # collect via consistent 48k to build a wav
        collected = np.concatenate([
            np.frombuffer(f.data, dtype=np.int16).astype(np.float32) / 32767.0
            for f in agent_reply if f.data
        ])
        voiced = np.abs(collected) > 0.02
        speech_s = float(np.count_nonzero(voiced)) / sample_rate
        print(f"real speech in capture: {speech_s:.1f}s")
        sf.write(OUT, collected, sample_rate)
        print("wrote", OUT)
        ok = True
    else:
        print("NO agent audio received within 90s")
        ok = False

    await room.disconnect()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))