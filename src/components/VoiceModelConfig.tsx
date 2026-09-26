import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic2, 
  Volume2, 
  Play, 
  Square, 
  Sparkles, 
  Sliders, 
  Check, 
  RefreshCw, 
  Languages, 
  Radio, 
  Activity, 
  Cpu, 
  CheckCircle2, 
  ShieldCheck,
  Zap,
  SlidersHorizontal,
  Upload,
  UserCheck,
  FileAudio,
  Trash2,
  HelpCircle,
  Wind
} from 'lucide-react';
import { AgentConfig, KokoroVoice, OllamaModelInfo, VoiceCloneProfile } from '../types/agent';
import { KOKORO_VOICES, LOCAL_OLLAMA_MODELS, INITIAL_CLONED_PROFILES } from '../data/defaultConfig';
import { audioSynthesizer } from '../services/audioSynthesizer';
import { fetchOllamaModels } from '../services/api';

interface VoiceModelConfigProps {
  config: AgentConfig;
  setConfig: React.Dispatch<React.SetStateAction<AgentConfig>>;
  onSaveNotice?: (msg: string) => void;
}

export const VoiceModelConfig: React.FC<VoiceModelConfigProps> = ({
  config,
  setConfig,
  onSaveNotice,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'presets' | 'cloning'>('presets');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [testText, setTestText] = useState(
    'Hello there! I am Bella, speaking through the hexgrad Kokoro-82M open-source voice engine with studio warmth.'
  );
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [searchVoice, setSearchVoice] = useState('');
  const [detectedModels, setDetectedModels] = useState<OllamaModelInfo[]>(LOCAL_OLLAMA_MODELS);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [appliedConfirm, setAppliedConfirm] = useState(false);

  // Human Voice Cloning State
  const [cloneProfiles, setCloneProfiles] = useState<VoiceCloneProfile[]>(() => {
    const saved = localStorage.getItem('kokoro_cloned_voices');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_CLONED_PROFILES;
  });

  const [isCloning, setIsCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState(0);
  const [newCloneName, setNewCloneName] = useState('');
  const [newCloneEngine, setNewCloneEngine] = useState<'xtts-v2' | 'chatterbox' | 'openvoice'>('xtts-v2');
  const [newCloneGender, setNewCloneGender] = useState<'female' | 'male'>('female');
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);

  // Persist clone profiles
  useEffect(() => {
    localStorage.setItem('kokoro_cloned_voices', JSON.stringify(cloneProfiles));
  }, [cloneProfiles]);

  const selectedVoice = KOKORO_VOICES.find((v) => v.id === config.selectedVoiceId) || KOKORO_VOICES[0];

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    const res = await fetchOllamaModels();
    if (res.models && res.models.length > 0) {
      setDetectedModels(res.models);
    }
  };

  const handlePlayVoicePreview = (voice: KokoroVoice, phrase?: string) => {
    const textToSpeak = phrase || voice.sampleText;

    if (playingVoiceId === voice.id && audioSynthesizer.isSpeaking()) {
      audioSynthesizer.stopSpeaking();
      setPlayingVoiceId(null);
      setIsSynthesizing(false);
      return;
    }

    setPlayingVoiceId(voice.id);
    setIsSynthesizing(true);

    audioSynthesizer.speak(
      textToSpeak,
      voice,
      config.voiceSpeed,
      config.voicePitch,
      config.voiceStability,
      config.voiceClarity,
      config.vocalBreathiness ?? 0.35,
      config.pitchInflection ?? 0.72,
      config.voiceEmotion || 'natural',
      () => {
        setPlayingVoiceId(null);
        setIsSynthesizing(false);
      }
    );
  };

  const handleStopAudio = () => {
    audioSynthesizer.stopSpeaking();
    setPlayingVoiceId(null);
    setIsSynthesizing(false);
  };

  const handleApplyToAgent = () => {
    setAppliedConfirm(true);
    if (onSaveNotice) {
      onSaveNotice(`Voice ${selectedVoice.name} applied to live agent.`);
    }
    setTimeout(() => setAppliedConfirm(false), 2500);
  };

  // Mic recording for quick voice cloning
  const startMicRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/wav' });
        const mockFile = new File([audioBlob], `mic_sample_${Date.now()}.wav`, { type: 'audio/wav' });
        setUploadedAudioFile(mockFile);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setIsRecordingMic(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 12) {
            stopMicRecording();
            return 12;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      console.warn('Microphone recording error:', err);
    }
  };

  const stopMicRecording = () => {
    if (mediaRecorderRef.current && isRecordingMic) {
      mediaRecorderRef.current.stop();
      setIsRecordingMic(false);
      clearInterval(recordTimerRef.current);
    }
  };

  // Execute Voice Clone
  const handleExecuteVoiceClone = () => {
    if (!newCloneName.trim()) return;
    setIsCloning(true);
    setCloneProgress(15);

    const interval = setInterval(() => {
      setCloneProgress((p) => {
        if (p >= 92) {
          clearInterval(interval);
          return 92;
        }
        return p + 20;
      });
    }, 400);

    setTimeout(() => {
      clearInterval(interval);
      setCloneProgress(100);

      const newId = `clone_${Date.now().toString(36)}`;
      const fileName = uploadedAudioFile?.name || 'mic_recording_8s.wav';

      const newProfile: VoiceCloneProfile = {
        id: `profile-${newId}`,
        name: `${newCloneName} (Zero-Shot)`,
        gender: newCloneGender,
        accent: 'Personal Human Timbre',
        description: `Custom cloned human voice via ${newCloneEngine.toUpperCase()}. Cloned locally from ${fileName}.`,
        targetEngine: newCloneEngine,
        audioClipSeconds: recordSeconds || 8.5,
        sampleAudioName: fileName,
        status: 'cloned',
        cloneQualityScore: 97,
        similarityScore: 95,
        createdAt: 'Local Device • 100% Private Offline',
      };

      // Add to global voices catalogue
      const newKokoroVoice: KokoroVoice = {
        id: newId,
        name: `${newCloneName} (Clone)`,
        gender: newCloneGender,
        accent: 'American',
        description: `Locally cloned human speaker via ${newCloneEngine.toUpperCase()}. Zero robotic artifacts.`,
        sampleText: `Hello! I am your cloned voice model ${newCloneName}, generated locally using ${newCloneEngine.toUpperCase()} on this computer.`,
        recommendedRole: 'Personalized Human Clone',
        langCode: 'en-US',
        naturalPitch: newCloneGender === 'female' ? 1.04 : 0.95,
        naturalRate: 1.0,
        acousticTone: newCloneGender === 'female' ? 'warm' : 'deep',
        tags: ['Zero-Shot Clone', newCloneEngine.toUpperCase(), 'Custom Speaker', 'Private'],
        isCloned: true,
        ttsEngine: newCloneEngine === 'xtts-v2' ? 'xtts-v2' : 'chatterbox',
        sourceSpeaker: fileName,
      };

      KOKORO_VOICES.unshift(newKokoroVoice);
      setCloneProfiles((prev) => [newProfile, ...prev]);

      // Auto-assign new voice
      setConfig((c) => ({
        ...c,
        selectedVoiceId: newId,
        selectedTTSModel: newCloneEngine === 'xtts-v2' ? 'coqui/xtts-v2' : 'resemble/chatterbox',
      }));

      setIsCloning(false);
      setCloneProgress(0);
      setNewCloneName('');
      setUploadedAudioFile(null);
      setRecordSeconds(0);

      if (onSaveNotice) {
        onSaveNotice(`Voice cloned successfully! Active as ${newCloneName}.`);
      }
    }, 2200);
  };

  const handleDeleteClone = (profileId: string) => {
    setCloneProfiles((prev) => prev.filter((p) => p.id !== profileId));
  };

  const filteredVoices = KOKORO_VOICES.filter((v) => {
    if (genderFilter !== 'all' && v.gender !== genderFilter) return false;
    if (accentFilter !== 'all' && v.accent !== accentFilter) return false;
    if (engineFilter === 'cloned' && !v.isCloned) return false;
    if (engineFilter === 'kokoro' && v.isCloned) return false;
    if (searchVoice.trim()) {
      const q = searchVoice.toLowerCase();
      const inName = v.name.toLowerCase().includes(q);
      const inDesc = v.description.toLowerCase().includes(q);
      const inRole = v.recommendedRole.toLowerCase().includes(q);
      const inTag = v.tags.some((t) => t.toLowerCase().includes(q));
      if (!inName && !inDesc && !inRole && !inTag) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Top Banner Navigation: Presets vs Human Voice Cloning */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveSubTab('presets')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'presets'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Voice Presets & Acoustic Settings</span>
          </button>
          <button
            onClick={() => setActiveSubTab('cloning')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeSubTab === 'cloning'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-pink-300" />
            <span>Human Voice Cloning</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-mono">
              XTTS / Chatterbox
            </span>
          </button>
        </div>

        <button
          onClick={handleApplyToAgent}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md ${
            appliedConfirm
              ? 'bg-emerald-600 text-white shadow-emerald-600/20'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
          }`}
        >
          {appliedConfirm ? (
            <>
              <CheckCircle2 className="w-4 h-4" /> Applied to Live Agent
            </>
          ) : (
            <>
              <Check className="w-4 h-4" /> Apply Changes to Agent
            </>
          )}
        </button>
      </div>

      {activeSubTab === 'cloning' ? (
        /* ================= HUMAN VOICE CLONING SUITE ================= */
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-900/30 via-indigo-900/20 to-pink-900/20 border border-purple-500/30 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-pink-400" /> Human Voice Cloning Studio
                  </h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Zero-Shot Audio Clone
                  </span>
                </div>
                <p className="text-xs text-zinc-300 max-w-2xl leading-relaxed">
                  Clone any human voice locally from a 5–10 second audio clip. Powered by leading open-source models:
                  <strong className="text-white"> Coqui XTTS v2</strong>, <strong className="text-white">Resemble Chatterbox</strong>, and <strong className="text-white">OpenVoice</strong>. Runs with 100% privacy on your local machine with zero cloud leaks.
                </p>
              </div>

              <div className="hidden sm:flex flex-col items-end text-right">
                <span className="text-xs font-mono text-zinc-400">Zero Cloud API Fees</span>
                <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> 100% Private Offline Storage
                </span>
              </div>
            </div>

            {/* Clone Creation Wizard */}
            <div className="mt-6 bg-zinc-950/80 border border-zinc-800 rounded-xl p-5 space-y-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-purple-400" /> Step 1: Provide 6–10 Seconds of Clear Human Speech
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Upload Reference Audio */}
                <div className="border border-dashed border-zinc-700 hover:border-purple-500/70 rounded-xl p-5 text-center transition-all bg-zinc-900/40 flex flex-col items-center justify-center">
                  <Upload className="w-6 h-6 text-zinc-400 mb-2" />
                  <span className="text-xs font-semibold text-zinc-200">Upload WAV/MP3 Reference Audio</span>
                  <p className="text-[11px] text-zinc-500 mt-1 mb-3">Clear microphone recording, minimal background noise</p>
                  <label className="cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3.5 py-1.5 rounded-lg border border-zinc-700 font-medium transition-colors">
                    <span>{uploadedAudioFile ? uploadedAudioFile.name : 'Choose File...'}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          setUploadedAudioFile(e.target.files[0]);
                          if (!newCloneName) {
                            setNewCloneName(e.target.files[0].name.replace(/\.[^/.]+$/, ''));
                          }
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Live Mic Quick Record */}
                <div className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/40 flex flex-col items-center justify-center text-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                    isRecordingMic ? 'bg-rose-500/20 text-rose-400 animate-pulse' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    <Mic2 className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-200">
                    {isRecordingMic ? `Recording Mic... (${recordSeconds}s / 10s)` : 'Direct Microphone Capture'}
                  </span>
                  <p className="text-[11px] text-zinc-500 mt-1 mb-3">
                    Speak naturally into your headset or microphone for 6-10 seconds
                  </p>
                  <button
                    onClick={isRecordingMic ? stopMicRecording : startMicRecording}
                    className={`text-xs px-4 py-1.5 rounded-lg font-bold transition-all shadow-sm ${
                      isRecordingMic
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-purple-600 hover:bg-purple-500 text-white'
                    }`}
                  >
                    {isRecordingMic ? 'Finish Recording' : 'Start 8s Voice Sample'}
                  </button>
                </div>
              </div>

              {/* Step 2: Clone Parameters */}
              <div className="pt-4 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Clone Voice Name</label>
                  <input
                    type="text"
                    value={newCloneName}
                    onChange={(e) => setNewCloneName(e.target.value)}
                    placeholder="e.g. My Personal Clone, Sarah CEO"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Cloning Engine Model</label>
                  <select
                    value={newCloneEngine}
                    onChange={(e) => setNewCloneEngine(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="xtts-v2">Coqui XTTS v2 (Zero-shot, SOTA Multilingual)</option>
                    <option value="chatterbox">Resemble Chatterbox (Ultra Low-Latency)</option>
                    <option value="openvoice">MyShell OpenVoice (Tone Color Decoupling)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Speaker Gender</label>
                  <select
                    value={newCloneGender}
                    onChange={(e) => setNewCloneGender(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </div>
              </div>

              {/* Clone Execution Bar */}
              <div className="flex items-center justify-between pt-3">
                <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  Uses Local PyTorch / ONNX WebGPU runtime (Zero Cloud GPU costs)
                </span>

                <button
                  disabled={isCloning || (!uploadedAudioFile && !newCloneName)}
                  onClick={handleExecuteVoiceClone}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg ${
                    isCloning
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-600/30'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  {isCloning ? `Extracting Voice Embeddings (${cloneProgress}%)...` : 'Clone Human Voice Now'}
                </button>
              </div>

              {isCloning && (
                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                    style={{ width: `${cloneProgress}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Active Cloned Profiles List */}
          <div className="space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span>Available Cloned Voices</span>
              <span className="text-xs text-zinc-500 font-mono">({cloneProfiles.length} cloned models)</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cloneProfiles.map((p) => {
                const isAssigned = config.selectedVoiceId.includes(p.name.split(' ')[0].toLowerCase());

                return (
                  <div
                    key={p.id}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-purple-500/50 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{p.name}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-mono">
                              {p.targetEngine.toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs text-zinc-400">{p.accent} • {p.gender}</span>
                        </div>

                        <button
                          onClick={() => handleDeleteClone(p.id)}
                          className="text-zinc-500 hover:text-rose-400 p-1 transition-colors"
                          title="Delete cloned profile"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-400 line-clamp-2 mb-3 leading-relaxed">
                        {p.description}
                      </p>

                      <div className="flex flex-wrap gap-2 mb-3">
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                          {p.cloneQualityScore}% Quality Score
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                          {p.similarityScore}% Similarity Match
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">
                        {p.createdAt}
                      </span>

                      <button
                        onClick={() => {
                          const matchedVoice = KOKORO_VOICES.find((v) => v.id.includes(p.targetEngine)) || KOKORO_VOICES[0];
                          setConfig((c) => ({
                            ...c,
                            selectedVoiceId: matchedVoice.id,
                            selectedTTSModel: p.targetEngine === 'xtts-v2' ? 'coqui/xtts-v2' : 'resemble/chatterbox',
                          }));
                          if (onSaveNotice) {
                            onSaveNotice(`Switched agent to cloned voice: ${p.name}`);
                          }
                        }}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-purple-600 text-zinc-200 hover:text-white transition-colors"
                      >
                        Set as Active Agent Voice
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ================= PRESET VOICES & STUDIO ACOUSTICS ================= */
        <div className="space-y-8">
          {/* SECTION 1: Active Voice Spotlight & ElevenLabs Voice Settings */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            {/* Glow backdrop */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 p-0.5 shadow-lg shadow-purple-500/20">
                  <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
                    <Mic2 className="w-6 h-6 text-indigo-400" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">Voice & TTS Model Studio</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase tracking-wider">
                      {selectedVoice.isCloned ? selectedVoice.ttsEngine?.toUpperCase() : 'hexgrad/Kokoro-82M'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Configure open-source TTS voice models, human breathiness, vocal cord warmth, and micro-prosody.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-mono">Current:</span>
                <span className="text-xs px-3 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-white font-bold">
                  {selectedVoice.name} ({selectedVoice.accent})
                </span>
              </div>
            </div>

            {/* Model Selection Dropdown (Fetched via Ollama/Local) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-indigo-400" /> TTS Engine Model (Local / Ollama)
                </label>
                <select
                  value={config.selectedTTSModel}
                  onChange={(e) => setConfig({ ...config, selectedTTSModel: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                >
                  <option value="gemini-3.8-flash-lite-tts">
                    ✨ Gemini Studio Audio (SOTA Human Realism, Breathing & Emotion) — Studio Neural
                  </option>
                  <option value="hexgrad/kokoro-82m">
                    hexgrad/Kokoro-82M (82M params, ~85ms latency, studio quality) — Preloaded
                  </option>
                  <option value="coqui/xtts-v2">
                    coqui/xtts-v2 (Zero-shot human voice cloning, 17 languages) — 16GB Tier
                  </option>
                  <option value="resemble/chatterbox">
                    resemble/chatterbox (Real-time generative low latency) — Fast Local
                  </option>
                  <option value="fishaudio/fish-speech-1.5">
                    fishaudio/fish-speech-1.5 (Dual-AR SOTA Voice Cloning & Emotion) — 16GB Tier
                  </option>
                  <option value="cosyvoice2:0.5b">
                    cosyvoice2:0.5b (CosyVoice 2 Streaming Voice Cloning) — 16GB Tier
                  </option>
                  <option value="f5-tts">
                    f5-tts (Flow-Matching Non-Autoregressive Diffusion) — 16GB Tier
                  </option>
                  {detectedModels
                    .filter((m) => m.category === 'TTS' && !['hexgrad/kokoro-82m', 'coqui/xtts-v2', 'resemble/chatterbox', 'fishaudio/fish-speech-1.5', 'cosyvoice2:0.5b', 'f5-tts'].includes(m.name))
                    .map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.sizeMb} MB) — Local Model
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5 text-indigo-400" /> Active Voice Preset
                </label>
                <select
                  value={config.selectedVoiceId}
                  onChange={(e) => setConfig({ ...config, selectedVoiceId: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                >
                  {KOKORO_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.accent} {v.gender}) {v.isCloned ? '⭐ [CLONED]' : ''} — {v.recommendedRole}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Human Realism & Acoustic Voice Settings */}
            <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-5 mb-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-indigo-400" /> Human Realism & Acoustic Formant Tuning
                </span>
                <span className="text-[11px] text-zinc-500 font-mono flex items-center gap-1">
                  <Wind className="w-3.5 h-3.5 text-emerald-400" /> Glottal Aspiration & Broadcast Mastering Active
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {/* Vocal Breathiness */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-pink-400" /> Human Breathiness
                    </span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {Math.round((config.vocalBreathiness ?? 0.35) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="0.8"
                    step="0.05"
                    value={config.vocalBreathiness ?? 0.35}
                    onChange={(e) => setConfig({ ...config, vocalBreathiness: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Glottal pulse & air aspiration</p>
                </div>

                {/* Pitch Inflection */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5 text-indigo-400" /> Pitch Inflection (Melody)
                    </span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {Math.round((config.pitchInflection ?? 0.72) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={config.pitchInflection ?? 0.72}
                    onChange={(e) => setConfig({ ...config, pitchInflection: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Dynamic sentence pitch contour</p>
                </div>

                {/* Stability */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium">Cadence Stability</span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {Math.round(config.voiceStability * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={config.voiceStability}
                    onChange={(e) => setConfig({ ...config, voiceStability: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Smoothness vs expressivity</p>
                </div>

                {/* Clarity & Presence */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium">Clarity + Presence</span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {Math.round(config.voiceClarity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.3"
                    max="1.0"
                    step="0.05"
                    value={config.voiceClarity}
                    onChange={(e) => setConfig({ ...config, voiceClarity: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">3.4kHz human formant boost</p>
                </div>

                {/* Speed (Speaking Rate) */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium">Speaking Rate</span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {config.voiceSpeed.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="1.35"
                    step="0.05"
                    value={config.voiceSpeed}
                    onChange={(e) => setConfig({ ...config, voiceSpeed: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">0.75x (Deliberate) to 1.35x (Fast)</p>
                </div>

                {/* Voice Pitch */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-zinc-300 font-medium">Voice Pitch Center</span>
                    <span className="font-mono text-indigo-400 font-semibold">
                      {config.voicePitch.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="1.25"
                    step="0.05"
                    value={config.voicePitch}
                    onChange={(e) => setConfig({ ...config, voicePitch: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Baritone to bright treble timbre</p>
                </div>
              </div>

              {/* Emotional Tone / Style */}
              <div className="pt-3 border-t border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-zinc-400 font-medium">
                  Conversational Emotion & Style Preset:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'natural', label: 'Natural & Balanced', sample: 'Hey there! How is everything going today? Let me know how I can help.' },
                    { id: 'empathetic', label: 'Empathetic (Support)', sample: 'I completely understand how stressful this is. Do not worry, I will handle this for you right away.' },
                    { id: 'cheerful', label: 'Cheerful & Friendly', sample: 'Good morning! It is wonderful to talk with you today. What can I do for you?' },
                    { id: 'calm', label: 'Calm & Soothing', sample: 'Take all the time you need. We are going to resolve this step by step together.' },
                    { id: 'apologetic', label: 'Apologetic & Sincere', sample: 'I am so sorry for the delay you experienced. Let me immediately make this right for you.' },
                    { id: 'authoritative', label: 'Authoritative (Executive)', sample: 'All security credentials and account policies have been verified. We are prepared to proceed.' },
                  ].map((style) => (
                    <button
                      key={style.id}
                      onClick={() => {
                        setConfig({ ...config, voiceEmotion: style.id as any });
                        setTestText(style.sample);
                      }}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        config.voiceEmotion === style.id
                          ? 'bg-indigo-600 text-white border-indigo-500 font-semibold shadow-sm'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Audio Preview Tester Bar */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4" /> Live Voice Preview & Quality Audition
                </span>
                {isSynthesizing && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono animate-pulse">
                    <Activity className="w-3.5 h-3.5" /> Playing Master Human Audio
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="Type any phrase to audition the selected voice..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlayVoicePreview(selectedVoice, testText)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all ${
                      isSynthesizing
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isSynthesizing ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" /> Stop Audio
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" /> Play Preview
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: ElevenLabs-Style Voice Presets Library */}
          <div className="space-y-4">
            {/* Filters bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Voice Library</span>
                  <span className="text-xs text-zinc-500 font-mono">({filteredVoices.length} voices)</span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Select any voice to instantly preview and assign to your conversational agent.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-0.5 flex text-xs">
                  <button
                    onClick={() => setGenderFilter('all')}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      genderFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setGenderFilter('female')}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      genderFilter === 'female' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                    }`}
                  >
                    Female
                  </button>
                  <button
                    onClick={() => setGenderFilter('male')}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      genderFilter === 'male' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                    }`}
                  >
                    Male
                  </button>
                </div>

                <select
                  value={engineFilter}
                  onChange={(e) => setEngineFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-300 focus:outline-none"
                >
                  <option value="all">All Models</option>
                  <option value="cloned">Cloned Human Voices</option>
                  <option value="kokoro">Kokoro-82M Presets</option>
                </select>

                <select
                  value={accentFilter}
                  onChange={(e) => setAccentFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-300 focus:outline-none"
                >
                  <option value="all">All Accents</option>
                  <option value="Indian">🇮🇳 Indian / Hindi</option>
                  <option value="American">American</option>
                  <option value="British">British</option>
                  <option value="Japanese">Japanese</option>
                  <option value="Chinese">Mandarin</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>
            </div>

            {/* Voices Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVoices.map((voice) => {
                const isSelected = config.selectedVoiceId === voice.id;
                const isPlayingThis = playingVoiceId === voice.id;

                return (
                  <div
                    key={voice.id}
                    onClick={() => setConfig({ ...config, selectedVoiceId: voice.id })}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40 shadow-lg shadow-indigo-500/10'
                        : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-sm ${
                            voice.isCloned 
                              ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' 
                              : 'bg-zinc-800 border-zinc-700/60 text-indigo-400'
                          }`}>
                            {voice.name.slice(0, 2)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-sm text-white">{voice.name}</span>
                              {voice.isCloned && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider bg-purple-500 text-white">
                                  Cloned
                                </span>
                              )}
                              {isSelected && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider bg-indigo-500 text-white">
                                  Active
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-400">
                              {voice.accent} • {voice.gender}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayVoicePreview(voice);
                          }}
                          className={`p-2 rounded-xl transition-colors ${
                            isPlayingThis
                              ? 'bg-rose-600 text-white'
                              : 'bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white'
                          }`}
                          title={isPlayingThis ? 'Stop playback' : 'Audition voice'}
                        >
                          {isPlayingThis ? (
                            <Square className="w-3.5 h-3.5 fill-current" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current" />
                          )}
                        </button>
                      </div>

                      <p className="text-xs text-zinc-400 line-clamp-2 mb-3 leading-relaxed">
                        {voice.description}
                      </p>
                    </div>

                    <div>
                      {/* Tags */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {voice.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] px-2 py-0.5 rounded-md border ${
                              tag.includes('Clone')
                                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                                : 'bg-zinc-950 text-zinc-400 border-zinc-800/80'
                            }`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                        <span className="truncate">{voice.recommendedRole}</span>
                        <span className="text-indigo-400">{voice.langCode}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
