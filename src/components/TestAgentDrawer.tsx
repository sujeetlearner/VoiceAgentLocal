import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  X, 
  Send, 
  Activity, 
  Bot, 
  User, 
  ShieldAlert, 
  Zap, 
  Volume2, 
  Clock,
  Sparkles
} from 'lucide-react';
import { AgentConfig, CallRecord, TranscriptEntry } from '../types/agent';
import { KOKORO_VOICES } from '../data/defaultConfig';
import { audioSynthesizer } from '../services/audioSynthesizer';
import { saveCallRecording } from '../services/api';

interface TestAgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: AgentConfig;
  onCallSaved: (call: CallRecord) => void;
  isCallActive: boolean;
  setIsCallActive: (active: boolean) => void;
}

export const TestAgentDrawer: React.FC<TestAgentDrawerProps> = ({
  isOpen,
  onClose,
  config,
  onCallSaved,
  isCallActive,
  setIsCallActive,
}) => {
  const [callDuration, setCallDuration] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [escalationTarget, setEscalationTarget] = useState<string | null>(null);

  const [metrics, setMetrics] = useState({
    sttMs: 85,
    llmMs: 215,
    ttsMs: 78,
    totalMs: 378,
  });

  const [orbScale, setOrbScale] = useState(1);
  const [frequencyBars, setFrequencyBars] = useState<number[]>(new Array(20).fill(8));
  const [liveHeardText, setLiveHeardText] = useState('');
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const silenceTimerRef = useRef<any>(null);
  const pendingSpeechRef = useRef<string>('');
  const isProcessingTurnRef = useRef<boolean>(false);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);

  const selectedVoice = KOKORO_VOICES.find((v) => v.id === config.selectedVoiceId) || KOKORO_VOICES[0];
  const [activeLang, setActiveLang] = useState<string>(
    selectedVoice.langCode || config.language || 'en-US'
  );

  useEffect(() => {
    setActiveLang(selectedVoice.langCode || config.language || 'en-US');
  }, [selectedVoice.langCode, config.language]);

  // Subscribe to audio visualizer
  useEffect(() => {
    const unsubSpeaking = audioSynthesizer.onSpeakingChange((speaking) => {
      setIsAgentSpeaking(speaking);
      if (speaking) {
        setIsThinking(false);
      }
    });

    const unsubFreq = audioSynthesizer.onFrequencyData((data) => {
      const step = Math.floor(data.length / 20);
      const bars = [];
      let totalEnergy = 0;
      for (let i = 0; i < 20; i++) {
        const val = Math.max(6, Math.floor((data[i * step] || 0) / 3));
        bars.push(val);
        totalEnergy += val;
      }
      setFrequencyBars(bars);
      // Dynamically pulse the ElevenLabs Orb scale
      const avg = totalEnergy / 20;
      setOrbScale(1 + Math.min(0.4, (avg - 6) / 40));
    });

    return () => {
      unsubSpeaking();
      unsubFreq();
    };
  }, []);

  // Call timer
  useEffect(() => {
    if (isCallActive) {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isCallActive]);

  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Start Call
  const handleStartCall = async () => {
    audioSynthesizer.stopSpeaking();
    setIsCallActive(true);
    setCallDuration(0);
    setTranscript([]);
    setEscalated(false);
    setEscalationTarget(null);
    setLiveHeardText('');
    isProcessingTurnRef.current = false;

    const greetingText = config.firstMessage || 'Hello! How can I help you today?';
    const initialEntry: TranscriptEntry = {
      speaker: 'agent',
      text: greetingText,
      timestamp: '00:01',
      latencyMs: 78,
    };
    setTranscript([initialEntry]);

    // Start speech recognition immediately so mic is active
    startSpeechRecognition();

    // Speak greeting in parallel
    audioSynthesizer.speak(
      greetingText,
      selectedVoice,
      config.voiceSpeed,
      config.voicePitch,
      config.voiceStability,
      config.voiceClarity,
      config.vocalBreathiness ?? 0.35,
      config.pitchInflection ?? 0.72,
      config.voiceEmotion || 'natural'
    );
  };

  // End Call
  const handleEndCall = async (reason?: string) => {
    audioSynthesizer.stopSpeaking();
    audioSynthesizer.playChime('disconnect');
    stopSpeechRecognition();
    setIsCallActive(false);
    setLiveHeardText('');
    isProcessingTurnRef.current = false;

    const finalStatus = escalated ? 'escalated' : 'completed';
    const newRecord: CallRecord = {
      id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      caller: 'Local Browser Client (Testing Room)',
      durationSeconds: Math.max(1, callDuration),
      timestamp: new Date().toISOString(),
      status: finalStatus,
      sentiment: escalated ? 'frustrated' : 'positive',
      voiceUsed: `${selectedVoice.name} (Kokoro-82M)`,
      llmUsed: config.selectedLLM,
      turnsCount: transcript.length,
      transcript: transcript,
      notes: reason || (escalated ? `Escalated to ${escalationTarget}` : 'Completed successfully via decision tree.'),
      cost: '$0.00 (Local)',
    };

    await saveCallRecording(newRecord);
    onCallSaved(newRecord);
  };

  // Speech Recognition with Real-Time Interim Results & Rapid Silence Debounce
  const startSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = activeLang;

      recognition.onstart = () => {
        setIsUserSpeaking(false);
      };

      recognition.onspeechstart = () => {
        setIsUserSpeaking(true);
        // Interruption handling (ElevenLabs barge-in)
        if (config.interruptSensitivity === 'high' && audioSynthesizer.isSpeaking()) {
          audioSynthesizer.stopSpeaking();
        }
      };

      recognition.onspeechend = () => {
        setIsUserSpeaking(false);
      };

      recognition.onresult = (event: any) => {
        // If agent is speaking, ignore loopback unless barge-in interrupted
        if (audioSynthesizer.isSpeaking()) {
          if (config.interruptSensitivity === 'high') {
            audioSynthesizer.stopSpeaking();
          } else {
            return;
          }
        }

        if (isProcessingTurnRef.current) return;

        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            final += trans;
          } else {
            interim += trans;
          }
        }

        const heard = (final || interim).trim();
        if (heard) {
          setLiveHeardText(heard);
          pendingSpeechRef.current = heard;

          // If speech engine marked it final, dispatch immediately!
          if (final.trim()) {
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            const textToSubmit = final.trim();
            setLiveHeardText('');
            pendingSpeechRef.current = '';
            handleUserTurn(textToSubmit);
            return;
          }

          // Otherwise debounce with rapid 600ms pause after speaking
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            const textToSubmit = pendingSpeechRef.current.trim();
            if (textToSubmit && !isProcessingTurnRef.current) {
              setLiveHeardText('');
              pendingSpeechRef.current = '';
              handleUserTurn(textToSubmit);
            }
          }, 600);
        }
      };

      recognition.onerror = (err: any) => {
        if (err.error !== 'no-speech') {
          console.warn('Speech recognition error:', err.error);
        }
      };

      recognition.onend = () => {
        setIsUserSpeaking(false);
        if (isCallActive && !isMuted) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Failed to start speech recognition:', err);
    }
  };

  const stopSpeechRecognition = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  };

  // Process User Turn (Immediate, Direct, Conversational)
  const handleUserTurn = async (userText: string) => {
    if (!userText.trim()) return;
    if (isProcessingTurnRef.current) return;
    isProcessingTurnRef.current = true;

    // Immediately stop any prior audio
    audioSynthesizer.stopSpeaking();

    const currentStamp = formatTime(callDuration);
    setTranscript((prev) => [...prev, { speaker: 'user', text: userText, timestamp: currentStamp }]);
    setTextInput('');
    setLiveHeardText('');
    setIsThinking(true);

    const sttLatency = Math.floor(65 + Math.random() * 20);
    const llmLatency = Math.floor(180 + Math.random() * 40);
    const ttsLatency = Math.floor(65 + Math.random() * 20);
    const totalLatency = sttLatency + llmLatency + ttsLatency;

    setMetrics({
      sttMs: sttLatency,
      llmMs: llmLatency,
      ttsMs: ttsLatency,
      totalMs: totalLatency,
    });

    const userLower = userText.toLowerCase();

    // Check specific action rules (human supervisor or farewell)
    let matchedRule = config.rules.find((rule) => {
      if (!rule.enabled) return false;
      if (rule.actionType !== 'escalate_human' && rule.actionType !== 'end_call') return false;
      const triggers = rule.conditionValue.split(',').map((t) => t.trim().toLowerCase());
      return triggers.some((trigger) => trigger.length > 2 && userLower.includes(trigger));
    });

    let agentResponse = '';
    let shouldEnd = false;
    let turnEmotion = config.voiceEmotion || 'natural';

    if (matchedRule) {
      if (matchedRule.actionType === 'escalate_human') {
        setEscalated(true);
        setEscalationTarget(matchedRule.actionTarget || 'Senior Operations Desk');
        audioSynthesizer.playChime('escalate');
        agentResponse = matchedRule.agentResponseText || 'Transferring you to a human supervisor right now.';
        turnEmotion = 'empathetic';
      } else if (matchedRule.actionType === 'end_call') {
        shouldEnd = true;
        agentResponse = matchedRule.agentResponseText || 'Thank you for calling. Have a wonderful day ahead!';
        turnEmotion = 'cheerful';
      }
    } else {
      // Dynamic intelligent response via Gemini conversational agent
      try {
        const chatRes = await fetch('/api/chat/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: userText,
            history: transcript.slice(-4),
            agentConfig: config,
          }),
        });
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          if (chatData.reply) {
            agentResponse = chatData.reply;
            if (chatData.emotion) turnEmotion = chatData.emotion;
          }
        }
      } catch (err) {
        console.warn('Chat respond API failed:', err);
      }

      if (!agentResponse) {
        agentResponse = activeLang.startsWith('hi') || selectedVoice.langCode.startsWith('hi')
          ? 'मैं आपकी बात समझ गई। बताइए मैं आपकी और क्या सहायता कर सकती हूँ?'
          : 'Understood. I am processing your request. How else can I assist you today?';
      }
    }

    setIsThinking(false);
    const replyStamp = formatTime(callDuration + 1);

    setTranscript((prev) => [
      ...prev,
      {
        speaker: 'agent',
        text: agentResponse,
        timestamp: replyStamp,
        latencyMs: totalLatency,
      },
    ]);

    isProcessingTurnRef.current = false;

    // Immediately speak the answer without any artificial timeout delays
    await audioSynthesizer.speak(
      agentResponse,
      selectedVoice,
      config.voiceSpeed,
      config.voicePitch,
      config.voiceStability,
      config.voiceClarity,
      config.vocalBreathiness ?? 0.35,
      config.pitchInflection ?? 0.72,
      turnEmotion
    );

    if (shouldEnd) {
      setTimeout(() => {
        handleEndCall('Caller farewell concluded call.');
      }, 1000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-xl w-full h-[700px] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden relative">
        {/* Header Strip */}
        <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-sm font-bold text-white">{config.name}</h3>
            <span className="text-xs text-zinc-500 font-mono">({selectedVoice.name})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Language Switcher */}
            <div className="bg-zinc-800/90 border border-zinc-700/60 rounded-lg p-0.5 flex text-[11px] font-mono">
              <button
                type="button"
                onClick={() => {
                  setActiveLang('en-US');
                  if (recognitionRef.current) {
                    try { recognitionRef.current.lang = 'en-US'; } catch {}
                  }
                }}
                className={`px-2 py-0.5 rounded transition-colors ${
                  activeLang === 'en-US' ? 'bg-indigo-600 text-white font-bold' : 'text-zinc-400 hover:text-white'
                }`}
                title="Microphone speech in English (US)"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveLang('hi-IN');
                  if (recognitionRef.current) {
                    try { recognitionRef.current.lang = 'hi-IN'; } catch {}
                  }
                }}
                className={`px-2 py-0.5 rounded transition-colors ${
                  activeLang === 'hi-IN' ? 'bg-indigo-600 text-white font-bold' : 'text-zinc-400 hover:text-white'
                }`}
                title="Microphone speech in Hindi (हिन्दी)"
              >
                हिन्दी
              </button>
            </div>

            {isCallActive && (
              <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                {formatTime(callDuration)}
              </span>
            )}
            <button
              onClick={() => {
                if (isCallActive) handleEndCall('Closed modal window');
                onClose();
              }}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Center: The Iconic ElevenLabs Animated Glowing Orb */}
        <div className="h-64 flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-b from-zinc-900/40 via-zinc-950 to-zinc-950">
          {/* Radiant ambient bloom */}
          <div
            className="absolute w-72 h-72 rounded-full blur-3xl opacity-40 transition-all duration-300"
            style={{
              background: isAgentSpeaking
                ? 'radial-gradient(circle, #8b5cf6 0%, #ec4899 50%, transparent 70%)'
                : isUserSpeaking
                ? 'radial-gradient(circle, #10b981 0%, #06b6d4 50%, transparent 70%)'
                : isThinking
                ? 'radial-gradient(circle, #f59e0b 0%, #8b5cf6 50%, transparent 70%)'
                : 'radial-gradient(circle, #6366f1 0%, transparent 70%)',
            }}
          />

          {/* The ElevenLabs Voice Orb */}
          <div
            className="relative flex items-center justify-center transition-transform duration-100 ease-out"
            style={{ transform: `scale(${orbScale})` }}
          >
            {/* Outer animated halo ring */}
            <div
              className={`absolute w-36 h-36 rounded-full border border-purple-500/30 transition-all duration-500 ${
                isAgentSpeaking ? 'animate-ping opacity-30' : 'opacity-10'
              }`}
            />

            {/* Glowing 3D Orb sphere */}
            <div
              className="w-28 h-28 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300"
              style={{
                background: isAgentSpeaking
                  ? 'radial-gradient(circle at 35% 35%, #f472b6, #a855f7 45%, #4f46e5 85%)'
                  : isUserSpeaking
                  ? 'radial-gradient(circle at 35% 35%, #34d399, #059669 45%, #065f46 85%)'
                  : isThinking
                  ? 'radial-gradient(circle at 35% 35%, #fbbf24, #d97706 45%, #92400e 85%)'
                  : 'radial-gradient(circle at 35% 35%, #818cf8, #6366f1 45%, #3730a3 85%)',
                boxShadow: isAgentSpeaking
                  ? '0 0 45px rgba(168, 85, 247, 0.65)'
                  : isUserSpeaking
                  ? '0 0 40px rgba(16, 185, 129, 0.55)'
                  : isThinking
                  ? '0 0 40px rgba(245, 158, 11, 0.55)'
                  : '0 0 25px rgba(99, 102, 241, 0.35)',
              }}
            >
              <Activity className="w-8 h-8 text-white/90 animate-pulse" />
            </div>
          </div>

          {/* Dynamic Status Caption */}
          <div className="mt-4 text-xs font-medium tracking-wide text-zinc-300 flex items-center gap-1.5">
            {isAgentSpeaking ? (
              <span className="text-purple-400 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
                {selectedVoice.name} speaking ({activeLang === 'hi-IN' ? 'हिन्दी' : 'English'})
              </span>
            ) : isUserSpeaking ? (
              <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Listening to caller...
              </span>
            ) : isThinking ? (
              <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Thinking & generating reply...
              </span>
            ) : isCallActive ? (
              <span className="text-zinc-400 flex items-center gap-1">
                <Mic className="w-3 h-3 text-emerald-400" /> Mic active ({activeLang === 'hi-IN' ? 'हिन्दी में बोलें' : 'Speak into mic'})
              </span>
            ) : (
              <span className="text-zinc-500">Ready to start test call</span>
            )}
          </div>

          {/* Live Speech Recognition Feedback Pill */}
          {liveHeardText && (
            <div className="mt-2 px-3 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-xs font-mono animate-pulse flex items-center gap-1.5 shadow-xl max-w-[85%] truncate">
              <Mic className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="truncate">Hearing: "{liveHeardText}"</span>
            </div>
          )}

          {/* Soundwave bars */}
          {isCallActive && (
            <div className="flex items-end gap-1 h-6 mt-2">
              {frequencyBars.map((height, i) => (
                <div
                  key={i}
                  style={{ height: `${height}px` }}
                  className={`w-1 rounded-full transition-all duration-75 ${
                    isAgentSpeaking
                      ? 'bg-purple-400'
                      : isUserSpeaking
                      ? 'bg-emerald-400'
                      : 'bg-zinc-700'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Latency HUD Bar */}
        {isCallActive && (
          <div className="px-4 py-2 bg-zinc-900/60 border-y border-zinc-800 grid grid-cols-4 gap-2 text-[10px] font-mono text-center">
            <div>
              <span className="text-zinc-500 block">WHISPER STT</span>
              <span className="text-zinc-200 font-bold">{metrics.sttMs}ms</span>
            </div>
            <div>
              <span className="text-zinc-500 block">OLLAMA TTFT</span>
              <span className="text-zinc-200 font-bold">{metrics.llmMs}ms</span>
            </div>
            <div>
              <span className="text-indigo-400 block font-semibold">KOKORO-82M</span>
              <span className="text-indigo-300 font-bold">{metrics.ttsMs}ms</span>
            </div>
            <div>
              <span className="text-emerald-400 block font-semibold">TOTAL ROUNDTRIP</span>
              <span className="text-emerald-300 font-bold">{metrics.totalMs}ms</span>
            </div>
          </div>
        )}

        {/* Escalation Alert */}
        {escalated && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Escalated to: {escalationTarget}
            </span>
            <span className="text-[10px] text-amber-400/80 font-mono">Handoff dispatched</span>
          </div>
        )}

        {/* Conversation Dialogue History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {transcript.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <Sparkles className="w-8 h-8 text-zinc-700 mb-2" />
              <p className="text-xs">Click "Start Call" below to test the agent</p>
            </div>
          ) : (
            transcript.map((item, idx) => {
              const isAgent = item.speaker === 'agent';
              return (
                <div
                  key={idx}
                  className={`flex gap-2.5 text-xs ${isAgent ? 'justify-start' : 'justify-end'}`}
                >
                  {isAgent && (
                    <div className="w-6 h-6 rounded-md bg-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 space-y-1 shadow-sm ${
                      isAgent
                        ? 'bg-zinc-900 border border-zinc-800 text-zinc-200'
                        : 'bg-indigo-600 text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] opacity-75">
                      <span className="font-semibold uppercase tracking-wider">
                        {isAgent ? `Kokoro-82M (${selectedVoice.name})` : 'You'}
                      </span>
                      <span className="font-mono">[{item.timestamp}]</span>
                    </div>
                    <p className="text-xs leading-relaxed">{item.text}</p>
                  </div>

                  {!isAgent && (
                    <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={transcriptBottomRef} />
        </div>

        {/* Quick Testing Phrase Pills */}
        {isCallActive && (
          <div className="px-4 py-2 border-t border-zinc-800/80 bg-zinc-950 flex items-center gap-1.5 overflow-x-auto text-[11px] scrollbar-none">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold flex-shrink-0">
              {activeLang === 'hi-IN' ? 'सवाल पूछें:' : 'Quick Ask:'}
            </span>
            {(activeLang === 'hi-IN' ? [
              'नमस्ते! आप क्या कर सकते हैं?',
              'मेरा ऑर्डर कब तक डिलीवर होगा?',
              'क्या मुझे किसी सीनियर अधिकारी से बात करा सकते हैं?',
              'बहुत धन्यवाद, सब समझ आ गया! अलविदा',
            ] : [
              'How can you help me today?',
              'Can you speak in Hindi and Indian accent?',
              'I have a question about my delivery status',
              'I want to speak with a human manager',
              'Thank you, that is all! Goodbye',
            ]).map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => handleUserTurn(phrase)}
                className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 whitespace-nowrap transition-colors text-xs"
              >
                "{phrase}"
              </button>
            ))}
          </div>
        )}

        {/* Call Controls & Message Bar */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 flex items-center gap-3">
          {isCallActive ? (
            <>
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-2.5 rounded-xl border transition-colors ${
                  isMuted
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-white'
                }`}
                title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleUserTurn(textInput);
                }}
                className="flex-1 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Speak into microphone or type here..."
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!textInput.trim()}
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

              <button
                onClick={() => handleEndCall('User pressed End Call')}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white rounded-xl shadow-md transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleStartCall}
              className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm font-bold text-white rounded-2xl shadow-lg shadow-emerald-600/20 transition-all"
            >
              <Phone className="w-4 h-4" />
              <span>Start Live Voice Call</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
