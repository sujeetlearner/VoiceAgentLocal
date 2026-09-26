import { KokoroVoice } from '../types/agent';

class AudioSynthesizerService {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private warmFilter: BiquadFilterNode | null = null;
  private presenceFilter: BiquadFilterNode | null = null;
  private deEsserFilter: BiquadFilterNode | null = null;
  private bodyResonanceFilter: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private isSpeakingState = false;
  private wakeLock: any = null;
  private onSpeakingChangeCallbacks: Set<(speaking: boolean) => void> = new Set();
  private onFrequencyDataCallbacks: Set<(data: Uint8Array) => void> = new Set();
  private animFrameId: number | null = null;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;
  private activeSourceNode: AudioBufferSourceNode | null = null;
  private audioCache = new Map<string, AudioBuffer>();

  constructor() {
    // Pre-cache voices when available
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.initVoices();
    }
  }

  private initVoices(): Promise<SpeechSynthesisVoice[]> {
    if (this.voicesPromise) return this.voicesPromise;

    this.voicesPromise = new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve([]);
        return;
      }

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        this.cachedVoices = voices;
        resolve(voices);
        return;
      }

      const onVoicesChanged = () => {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length > 0) {
          this.cachedVoices = v;
          window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          resolve(v);
        }
      };

      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);

      // Fallback timeout in case event doesn't fire
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        this.cachedVoices = window.speechSynthesis.getVoices() || [];
        resolve(this.cachedVoices);
      }, 300);
    });

    return this.voicesPromise;
  }

  private initAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Advanced Studio Broadcast Vocal Chain
      this.warmFilter = this.audioCtx.createBiquadFilter();
      this.warmFilter.type = 'lowshelf';
      this.warmFilter.frequency.setValueAtTime(220, this.audioCtx.currentTime);
      this.warmFilter.gain.setValueAtTime(3.0, this.audioCtx.currentTime);

      this.bodyResonanceFilter = this.audioCtx.createBiquadFilter();
      this.bodyResonanceFilter.type = 'peaking';
      this.bodyResonanceFilter.frequency.setValueAtTime(520, this.audioCtx.currentTime);
      this.bodyResonanceFilter.Q.setValueAtTime(0.8, this.audioCtx.currentTime);
      this.bodyResonanceFilter.gain.setValueAtTime(1.2, this.audioCtx.currentTime);

      this.presenceFilter = this.audioCtx.createBiquadFilter();
      this.presenceFilter.type = 'peaking';
      this.presenceFilter.frequency.setValueAtTime(3400, this.audioCtx.currentTime);
      this.presenceFilter.Q.setValueAtTime(1.1, this.audioCtx.currentTime);
      this.presenceFilter.gain.setValueAtTime(3.0, this.audioCtx.currentTime);

      this.deEsserFilter = this.audioCtx.createBiquadFilter();
      this.deEsserFilter.type = 'peaking';
      this.deEsserFilter.frequency.setValueAtTime(7400, this.audioCtx.currentTime);
      this.deEsserFilter.Q.setValueAtTime(2.0, this.audioCtx.currentTime);
      this.deEsserFilter.gain.setValueAtTime(-2.0, this.audioCtx.currentTime);

      this.compressor = this.audioCtx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-20, this.audioCtx.currentTime);
      this.compressor.knee.setValueAtTime(10, this.audioCtx.currentTime);
      this.compressor.ratio.setValueAtTime(3.0, this.audioCtx.currentTime);
      this.compressor.attack.setValueAtTime(0.005, this.audioCtx.currentTime);
      this.compressor.release.setValueAtTime(0.20, this.audioCtx.currentTime);

      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.95, this.audioCtx.currentTime);

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.82;

      this.warmFilter.connect(this.bodyResonanceFilter);
      this.bodyResonanceFilter.connect(this.presenceFilter);
      this.presenceFilter.connect(this.deEsserFilter);
      this.deEsserFilter.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  public async acquireWakeLock(): Promise<boolean> {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
        return true;
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
        return false;
      }
    }
    return false;
  }

  public releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  public isWakeLockActive(): boolean {
    return !!this.wakeLock;
  }

  public onSpeakingChange(cb: (speaking: boolean) => void) {
    this.onSpeakingChangeCallbacks.add(cb);
    return () => this.onSpeakingChangeCallbacks.delete(cb);
  }

  public onFrequencyData(cb: (data: Uint8Array) => void) {
    this.onFrequencyDataCallbacks.add(cb);
    return () => this.onFrequencyDataCallbacks.delete(cb);
  }

  private startWaveformSimulation(acousticTone: 'warm' | 'crisp' | 'deep' | 'bright' | 'mellow' = 'warm') {
    if (this.animFrameId) return;
    const bufferLength = this.analyser?.frequencyBinCount || 32;
    const dataArray = new Uint8Array(bufferLength);

    const loop = () => {
      if (this.isSpeakingState) {
        if (this.analyser && this.activeSourceNode) {
          // Read real audio frequencies from Web Audio API Analyser
          this.analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          if (sum === 0) {
            const time = Date.now() * 0.007;
            for (let i = 0; i < bufferLength; i++) {
              const cadence = Math.sin(time * 2.4 + i * 0.22) * 0.5 + 0.5;
              const vowelPulse = Math.cos(time * 4.2) * 0.35 + 0.65;
              dataArray[i] = Math.min(255, Math.floor((cadence * vowelPulse) * 190 + 35));
            }
          }
        } else {
          const time = Date.now() * 0.007;
          for (let i = 0; i < bufferLength; i++) {
            const cadence = Math.sin(time * 2.4 + i * 0.22) * 0.5 + 0.5;
            const vowelPulse = Math.cos(time * 4.2) * 0.35 + 0.65;
            const harmonic = Math.sin(i * 0.75 + time) * 0.25;
            const height = Math.min(255, Math.floor((cadence * vowelPulse + harmonic) * 220 + 35));
            dataArray[i] = height;
          }
        }
      } else {
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.floor(Math.random() * 4);
        }
      }

      this.onFrequencyDataCallbacks.forEach((cb) => cb(dataArray));
      this.animFrameId = requestAnimationFrame(loop);
    };

    loop();
  }

  public stopWaveformSimulation() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public stopSpeaking() {
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch {}
      this.activeSourceNode = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isSpeakingState = false;
    this.onSpeakingChangeCallbacks.forEach((cb) => cb(false));
  }

  public isSpeaking(): boolean {
    return this.isSpeakingState;
  }

  private playAudioBuffer(
    buffer: AudioBuffer,
    speed = 1.0,
    voice: KokoroVoice,
    onComplete?: () => void
  ): Promise<void> {
    if (!this.audioCtx || !this.warmFilter) return Promise.resolve();

    return new Promise((resolve) => {
      this.isSpeakingState = true;
      this.onSpeakingChangeCallbacks.forEach((cb) => cb(true));
      this.startWaveformSimulation(voice.acousticTone);

      const source = this.audioCtx!.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      source.connect(this.warmFilter!);
      this.activeSourceNode = source;

      source.onended = () => {
        if (this.activeSourceNode === source) {
          this.activeSourceNode = null;
          this.isSpeakingState = false;
          this.onSpeakingChangeCallbacks.forEach((cb) => cb(false));
        }
        if (onComplete) onComplete();
        resolve();
      };

      source.start(0);
    });
  }

  /**
   * Resolves the best matching voice with STRICT GENDER ISOLATION.
   * If female is requested, all male voices are strictly forbidden.
   */
  public async resolveVoice(targetVoice: KokoroVoice): Promise<{ voice: SpeechSynthesisVoice | null; isFemaleForced: boolean }> {
    const allVoices = await this.initVoices();
    const isFemale = targetVoice.gender === 'female';
    const langCode = (targetVoice.langCode || 'en-US').toLowerCase().replace('_', '-');
    const langPrefix = langCode.slice(0, 2);

    // List of explicit male identifiers across all OS & browsers to completely blacklist for female voices
    const maleBlacklist = [
      'david', 'daniel', 'alex', 'guy', 'george', 'tom', 'mark', 'richard',
      'ryan', 'steffan', 'fred', 'bruce', 'ralph', 'albert', 'oliver',
      'rohan', 'aravind', 'rishi', 'madhav', 'karan', 'tarun',
      'male', 'man', 'boy', 'google us english', 'microsoft david', 'espeak'
    ];

    // List of explicit female identifiers across Windows, macOS, iOS, Android, and Chromium
    const femaleWhitelist = [
      'zira', 'samantha', 'victoria', 'karen', 'jenny', 'aria', 'ava', 'allison',
      'serena', 'kate', 'susan', 'cathy', 'heather', 'fiona', 'moira', 'tessa',
      'veena', 'clara', 'natasha', 'michelle', 'ana', 'sonia', 'libby', 'neerja',
      'priya', 'ananya', 'kalpana', 'geeta', 'swara', 'lekha', 'kavya', 'heera',
      'hazel', 'siri', 'dora', 'xiaobei', 'bella', 'sarah', 'nicole', 'emma',
      'female', 'woman', 'girl', 'google uk english female', 'google हिन्दी'
    ];

    // 1. Language matching pool
    const langPool = allVoices.filter((v) =>
      v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix)
    );
    const candidatePool = langPool.length > 0 ? langPool : allVoices;

    if (isFemale) {
      // Step A: Find voice matching language AND female whitelist, and NOT in male blacklist
      const exactFemale = candidatePool.find((v) => {
        const name = v.name.toLowerCase();
        const matchesFemale = femaleWhitelist.some((kw) => name.includes(kw));
        const matchesMale = maleBlacklist.some((kw) => name.includes(kw));
        return matchesFemale && !matchesMale;
      });
      if (exactFemale) {
        return { voice: exactFemale, isFemaleForced: false };
      }

      // Step B: Find global voice in any language that is verified female
      const globalFemale = allVoices.find((v) => {
        const name = v.name.toLowerCase();
        return femaleWhitelist.some((kw) => name.includes(kw)) && !maleBlacklist.some((kw) => name.includes(kw));
      });
      if (globalFemale) {
        return { voice: globalFemale, isFemaleForced: false };
      }

      // Step C: If no explicit female name found, pick any voice that does NOT contain male markers
      const neutralVoice = candidatePool.find((v) => {
        const name = v.name.toLowerCase();
        return !maleBlacklist.some((kw) => name.includes(kw));
      });
      if (neutralVoice) {
        return { voice: neutralVoice, isFemaleForced: true };
      }

      // If even candidate pool only has male, return null and force pitch shift
      return { voice: null, isFemaleForced: true };
    } else {
      // Target is male
      const exactMale = candidatePool.find((v) => {
        const name = v.name.toLowerCase();
        const matchesMale = maleBlacklist.some((kw) => name.includes(kw));
        const matchesFemale = femaleWhitelist.some((kw) => name.includes(kw));
        return matchesMale && !matchesFemale;
      });
      if (exactMale) {
        return { voice: exactMale, isFemaleForced: false };
      }

      return { voice: candidatePool[0] || null, isFemaleForced: false };
    }
  }

  /**
   * Synthesizes speech with clean, pure vocal delivery.
   * Uses Tier 1 High-Fidelity Studio Neural TTS with emotion & breathing,
   * with seamless fallback to Tier 2 local DSP synthesizer.
   */
  public async speak(
    text: string,
    voice: KokoroVoice,
    speed = 1.0,
    pitch = 1.0,
    stability = 0.75,
    clarity = 0.85,
    breathiness = 0.35,
    inflection = 0.7,
    emotion = 'natural',
    onComplete?: () => void
  ): Promise<void> {
    this.initAudio();
    this.stopSpeaking();

    // Short tick to guarantee previous browser utterance has cleared
    await new Promise((r) => setTimeout(r, 40));

    // Tier 1: Try High-Fidelity Studio Neural TTS with Emotion & Breathing
    try {
      const cacheKey = `${voice.id}_${emotion}_${speed}_${pitch}_${text.trim()}`;
      let audioBuffer = this.audioCache.get(cacheKey);

      if (!audioBuffer && typeof fetch !== 'undefined') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const res = await fetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceId: voice.id,
            gender: voice.gender,
            accent: voice.accent,
            emotion,
            speed,
            pitch,
            breathiness,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.audioDataUrl && this.audioCtx) {
            const base64Data = data.audioDataUrl.split(',')[1];
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer.slice(0));
            this.audioCache.set(cacheKey, audioBuffer);
          }
        }
      }

      if (audioBuffer && this.audioCtx) {
        return await this.playAudioBuffer(audioBuffer, speed, voice, onComplete);
      }
    } catch (err) {
      console.warn('Neural TTS synthesis fallback to local DSP:', err);
    }

    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not available in this browser');
      if (onComplete) onComplete();
      return;
    }

    this.startWaveformSimulation(voice.acousticTone);

    // Natural punctuation pacing
    const processedText = text
      .replace(/([.!?])\s+/g, '$1 , ')
      .replace(/([;:])\s+/g, '$1 , ')
      .replace(/(\b(?:well|actually|so|however|honestly|listen|of course)\b),?/gi, '$1,');

    const utterance = new SpeechSynthesisUtterance(processedText);

    // Resolve system voice with STRICT gender filtering
    const { voice: matchedVoice, isFemaleForced } = await this.resolveVoice(voice);

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    // Acoustic pitch & speed modulation
    const basePitch = voice.naturalPitch || 1.0;
    const baseRate = voice.naturalRate || 1.0;
    const inflectionOffset = (inflection - 0.5) * 0.08;
    let calculatedPitch = basePitch * pitch + inflectionOffset;

    // If female voice is selected, guarantee feminine vocal pitch register
    if (voice.gender === 'female') {
      if (isFemaleForced || !matchedVoice) {
        calculatedPitch = Math.max(1.22, calculatedPitch * 1.25);
      } else {
        calculatedPitch = Math.max(1.05, calculatedPitch * 1.08);
      }
    } else {
      // Male voice
      calculatedPitch = Math.min(0.96, calculatedPitch * 0.92);
    }

    const calculatedRate = baseRate * speed;

    utterance.pitch = Math.max(0.75, Math.min(1.4, calculatedPitch));
    utterance.rate = Math.max(0.75, Math.min(1.35, calculatedRate));
    utterance.lang = matchedVoice ? matchedVoice.lang : (voice.langCode || 'en-US');

    // Studio DSP EQ adjustments
    if (this.warmFilter && this.presenceFilter && this.bodyResonanceFilter) {
      const ctxNow = this.audioCtx?.currentTime || 0;
      const warmthBoost = voice.gender === 'female' ? 2.5 : 5.0;
      const clarityBoost = (clarity * 4.0) + (voice.acousticTone === 'crisp' ? 2.0 : 1.0);

      this.warmFilter.gain.setValueAtTime(warmthBoost, ctxNow);
      this.presenceFilter.gain.setValueAtTime(clarityBoost, ctxNow);
      this.bodyResonanceFilter.gain.setValueAtTime(1.5 * (stability || 0.7), ctxNow);
    }

    return new Promise((resolve) => {
      utterance.onstart = () => {
        this.isSpeakingState = true;
        this.onSpeakingChangeCallbacks.forEach((cb) => cb(true));
      };

      const finish = () => {
        this.isSpeakingState = false;
        this.onSpeakingChangeCallbacks.forEach((cb) => cb(false));
        if (onComplete) onComplete();
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = (err) => {
        console.warn('Speech synthesis ended or interrupted:', err);
        finish();
      };

      window.speechSynthesis.speak(utterance);
    });
  }
  public playChime(type: 'connect' | 'disconnect' | 'escalate') {
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'connect') {
        // High soft bell tone (C6 to E6) - delicate and pleasant, never low or deep
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.12);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'disconnect') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.15);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'escalate') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1046.5, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch {}
  }
}

export const audioSynthesizer = new AudioSynthesizerService();
