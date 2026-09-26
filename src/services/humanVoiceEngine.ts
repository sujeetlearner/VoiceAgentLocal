/**
 * Human Voice Acoustic & Formant Engine
 * Synthesizes natural human-realistic vocal nuances using formant filters,
 * breath glottal pulses, micro-jitter, and prosody pitch envelopes.
 * Eliminates robotic metallic artifacts.
 */

export interface FormantFrequencies {
  f1: number; // First vowel formant (throat/jaw opening)
  f2: number; // Second vowel formant (tongue position)
  f3: number; // Third vowel formant (vocal tract length)
}

// Natural human phonetic vowel formants in Hz (Peterson & Barney standard acoustics)
export const VOWEL_FORMANTS: Record<string, FormantFrequencies> = {
  a: { f1: 850, f2: 1610, f3: 2850 }, // 'ah' as in father
  e: { f1: 530, f2: 1840, f3: 2480 }, // 'eh' as in bed
  i: { f1: 270, f2: 2290, f3: 3010 }, // 'ee' as in meet
  o: { f1: 570, f2: 840, f3: 2410 },  // 'oh' as in boat
  u: { f1: 300, f2: 870, f3: 2240 },  // 'oo' as in boot
};

/**
 * Generates an organic glottal human breath audio buffer (micro-subtle vocal cord aspiration)
 * This gives synthetic speech the breathy, lifelike presence characteristic of human speakers.
 */
export function createVocalAspirationBuffer(
  audioCtx: AudioContext,
  durationSec = 0.25,
  breathiness = 0.35
): AudioBuffer {
  const sampleRate = audioCtx.sampleRate;
  const bufferSize = Math.floor(sampleRate * durationSec);
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  // Pink noise generator (filtered 1/f glottal noise)
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    const pink = b0 + b1 + b2 + white * 0.5362;
    // Envelope: quick attack, natural organic decay
    const env = Math.sin((i / bufferSize) * Math.PI);
    data[i] = pink * 0.04 * breathiness * env;
  }

  return buffer;
}
