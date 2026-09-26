export interface KokoroVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  accent: 'American' | 'British' | 'Indian' | 'Japanese' | 'Chinese' | 'Spanish' | 'French' | 'Italian';
  description: string;
  sampleText: string;
  recommendedRole: string;
  langCode: string;
  naturalPitch: number;
  naturalRate: number;
  acousticTone: 'warm' | 'crisp' | 'deep' | 'bright' | 'mellow';
  tags: string[];
  isCloned?: boolean;
  clonedFromAudio?: string;
  sourceSpeaker?: string;
  ttsEngine?: 'kokoro-82m' | 'xtts-v2' | 'chatterbox' | 'openvoice' | 'fish-speech';
}

export interface VoiceCloneProfile {
  id: string;
  name: string;
  gender: 'female' | 'male';
  accent: string;
  description: string;
  targetEngine: 'xtts-v2' | 'chatterbox' | 'kokoro-82m' | 'openvoice';
  audioClipSeconds: number;
  sampleAudioName: string;
  audioDataUrl?: string;
  status: 'ready' | 'processing' | 'cloned';
  cloneQualityScore: number; // e.g. 98%
  similarityScore: number; // e.g. 96%
  createdAt: string;
}

export interface OllamaModelInfo {
  name: string;
  sizeMb: number;
  updated: string;
  recommended: boolean;
  category?: 'LLM' | 'TTS' | 'STT';
  status?: 'installed' | 'available' | 'downloading';
  description?: string;
  tokensPerSec?: number;
  ramNeededMb?: number;
  ramTier?: 'fits-16gb' | 'ultra-low' | 'high-end';
  parameterSize?: string;
}

export interface DecisionRule {
  id: string;
  name: string;
  triggerType: 'intent' | 'keyword' | 'sentiment' | 'silence' | 'fallback';
  conditionValue: string; // e.g. "dispute, refund, manager, supervisor"
  actionType: 'escalate_human' | 'end_call' | 'speak_reply' | 'tool_call';
  actionTarget?: string; // e.g. "Senior Tier 2 Dispatch"
  agentResponseText?: string;
  enabled: boolean;
}

export interface DecisionTreeEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionType: 'intent' | 'keyword' | 'sentiment' | 'fallback' | 'always';
  conditionValue: string;
  label: string;
}

export interface DecisionTreeNode {
  id: string;
  type: 'greeting' | 'intent_router' | 'question' | 'tool_action' | 'escalate_human' | 'end_call';
  title: string;
  agentSpeech: string;
  variableName?: string;
  toolName?: string;
  escalationReason?: string;
  escalationTarget?: string;
  x: number;
  y: number;
  edges: DecisionTreeEdge[];
}

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  firstMessage: string;
  language: string;
  selectedVoiceId: string;
  selectedTTSModel: string; // 'hexgrad/kokoro-82m', 'coqui/xtts-v2', 'resemble/chatterbox'
  ttsEngineFamily: 'kokoro' | 'xtts' | 'chatterbox' | 'openvoice' | 'browser_neural';
  vocalBreathiness: number; // 0.0 to 1.0 (human vocal cord air simulation)
  pitchInflection: number; // 0.0 to 1.0 (dynamic human cadence & micro-prosody)
  voiceSpeed: number; // 0.7 to 1.4
  voicePitch: number; // 0.8 to 1.25
  voiceStability: number; // 0.0 to 1.0 (ElevenLabs style: consistent prosody)
  voiceClarity: number; // 0.0 to 1.0 (ElevenLabs style: crispness & harmonic boost)
  voiceEmotion: 'natural' | 'empathetic' | 'energetic' | 'authoritative' | 'calm' | 'cheerful' | 'apologetic';
  selectedLLM: string;
  llmTemperature: number;
  llmContextWindow: number;
  selectedSTT: string; // 'whisper-base', 'whisper-small'
  interruptSensitivity: 'high' | 'medium' | 'low';
  silenceTimeoutSec: number;
  maxCallDurationMinutes: number;
  autoEscalateOnNegativeSentiment: boolean;
  saveLocalRecordings: boolean;
  localDirectory: string;
  rules: DecisionRule[];
}

export interface TranscriptEntry {
  speaker: 'agent' | 'user';
  text: string;
  timestamp: string;
  nodeId?: string;
  latencyMs?: number;
}

export interface CallRecord {
  id: string;
  caller: string;
  durationSeconds: number;
  timestamp: string;
  status: 'completed' | 'escalated' | 'ended_by_user';
  sentiment: 'positive' | 'neutral' | 'frustrated';
  voiceUsed: string;
  llmUsed: string;
  turnsCount: number;
  transcript: TranscriptEntry[];
  audioFileName?: string;
  notes?: string;
  escalationReason?: string;
  cost: string; // '$0.00 (Local)'
}

export interface DaemonStatus {
  status: 'running' | 'paused' | 'stopped';
  startTime: number;
  uptimeSeconds: number;
  activeCalls: number;
  totalCalls: number;
  livekitStatus: string;
  kokoroStatus: string;
  ollamaStatus: string;
  cpuUsage: number;
  memoryUsageMb: number;
  wakeLockActive: boolean;
  storageDirectory: string;
}
