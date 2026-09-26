import React, { useState } from 'react';
import { 
  Sparkles, 
  MessageSquare, 
  Sliders, 
  ShieldAlert, 
  Plus, 
  Trash2, 
  PhoneOff, 
  UserCheck, 
  Wrench, 
  Zap, 
  Check, 
  AlertCircle,
  HelpCircle,
  Clock,
  Volume2
} from 'lucide-react';
import { AgentConfig, DecisionRule } from '../types/agent';
import { KOKORO_VOICES } from '../data/defaultConfig';

interface AgentSetupProps {
  config: AgentConfig;
  setConfig: React.Dispatch<React.SetStateAction<AgentConfig>>;
}

export const AgentSetup: React.FC<AgentSetupProps> = ({ config, setConfig }) => {
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleTrigger, setNewRuleTrigger] = useState<'intent' | 'keyword' | 'sentiment'>('intent');
  const [newRuleKeywords, setNewRuleKeywords] = useState('');
  const [newRuleAction, setNewRuleAction] = useState<DecisionRule['actionType']>('speak_reply');
  const [newRuleTarget, setNewRuleTarget] = useState('Senior Operations Team');
  const [newRuleResponse, setNewRuleResponse] = useState('');

  const selectedVoice = KOKORO_VOICES.find((v) => v.id === config.selectedVoiceId) || KOKORO_VOICES[0];

  const handleToggleRule = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    }));
  };

  const handleDeleteRule = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== id),
    }));
  };

  const handleAddRule = () => {
    if (!newRuleName || !newRuleKeywords) return;
    const rule: DecisionRule = {
      id: `rule-${Date.now().toString(36)}`,
      name: newRuleName,
      triggerType: newRuleTrigger,
      conditionValue: newRuleKeywords,
      actionType: newRuleAction,
      actionTarget: newRuleAction === 'escalate_human' ? newRuleTarget : undefined,
      agentResponseText: newRuleResponse || undefined,
      enabled: true,
    };

    setConfig((prev) => ({
      ...prev,
      rules: [...prev.rules, rule],
    }));

    setShowAddRuleModal(false);
    setNewRuleName('');
    setNewRuleKeywords('');
    setNewRuleResponse('');
  };

  const applyTemplate = (type: 'support' | 'clinic' | 'sales' | 'hindi') => {
    if (type === 'support') {
      setConfig((c) => ({
        ...c,
        name: 'Bella Support Assistant',
        firstMessage: 'Hello! Thank you for calling Nexus Support. My name is Bella. How can I help you today?',
        systemPrompt: `You are Bella, a helpful and empathetic customer service voice agent running 100% locally on this machine via LiveKit and hexgrad/Kokoro-82M.
1. Answer questions concisely in 1 to 2 conversational sentences.
2. If caller asks for a refund, billing dispute, or wants a human manager, escalate immediately.
3. When the caller is satisfied, say a friendly farewell and conclude.`,
      }));
    } else if (type === 'hindi') {
      setConfig((c) => ({
        ...c,
        name: 'Priya Hindi Assistant',
        language: 'hi-IN',
        selectedVoiceId: 'if_priya',
        firstMessage: 'नमस्ते! नेक्सस ऑटोमेशन में आपका स्वागत है। मैं प्रिया हूँ। बताएं आज मैं आपकी क्या सहायता कर सकती हूँ?',
        systemPrompt: `आप प्रिया हैं, एक अत्यंत मानवीय, विनम्र और मददगार AI वॉइस असिस्टेंट।
1. हमेशा सरल, स्पष्ट और स्वाभाविक हिंदी में 1 या 2 छोटे वाक्यों में उत्तर दें।
2. यदि ग्राहक किसी समस्या या रिफंड की मांग करता है, तो तुरंत मानवीय सहायता का आश्वासन दें।
3. कभी भी रोबोटिक या मशीनी न लगें, हमेशा मधुर और जीवंत लहजे में बात करें।`,
      }));
    } else if (type === 'clinic') {
      setConfig((c) => ({
        ...c,
        name: 'Dr. Harris Clinic Concierge',
        firstMessage: 'Good day! You have reached Westside Health Clinic. Are you calling to book an appointment or check lab test results?',
        systemPrompt: `You are a medical concierge voice agent running locally with complete HIPAA privacy on this device.
1. Be reassuring, calm, and articulate.
2. Direct emergency symptoms immediately to human emergency dispatch.
3. Assist with appointment booking inquiries concisely.`,
      }));
    } else if (type === 'sales') {
      setConfig((c) => ({
        ...c,
        name: 'Apex Inbound Sales Agent',
        firstMessage: 'Hi there! Thanks for your interest in Apex Enterprise. Are you evaluating local voice AI for a customer call center or internal helpdesk?',
        systemPrompt: `You are a proactive, friendly sales qualification agent.
1. Discover the caller's team size and primary use case in 2 polite questions.
2. Transfer high-intent enterprise inquiries to a live account executive.`,
      }));
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* SECTION 1: Identity & Persona (ElevenLabs style) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Agent Persona & First Message</h2>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Configure how your voice agent introduces itself and navigates conversations.
            </p>
          </div>

          {/* Quick templates */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 font-medium">Templates:</span>
            <button
              onClick={() => applyTemplate('support')}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            >
              Support
            </button>
            <button
              onClick={() => applyTemplate('hindi')}
              className="px-2.5 py-1 rounded-lg bg-orange-950/60 hover:bg-orange-900/80 text-orange-300 border border-orange-700/60 transition-colors font-medium flex items-center gap-1"
            >
              <span>🇮🇳</span> Hindi Concierge
            </button>
            <button
              onClick={() => applyTemplate('clinic')}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            >
              Clinic
            </button>
            <button
              onClick={() => applyTemplate('sales')}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
            >
              Sales
            </button>
          </div>
        </div>

        <div className="space-y-5">
          {/* Agent Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Agent Name
              </label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. Bella Concierge"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Primary Language
              </label>
              <select
                value={config.language}
                onChange={(e) => setConfig({ ...config, language: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="hi-IN">Hindi (हिन्दी - India)</option>
                <option value="en-IN">English (Indian Accent - India)</option>
                <option value="en-US">English (United States)</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="es-ES">Spanish (Español)</option>
                <option value="fr-FR">French (Français)</option>
                <option value="ja-JP">Japanese (日本語)</option>
                <option value="zh-CN">Chinese (Mandarin)</option>
              </select>
            </div>
          </div>

          {/* First Message */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                First Message (Initial Greeting)
              </label>
              <span className="text-[11px] text-indigo-400 font-mono">
                Synthesized by Kokoro-82M upon connect (&lt;90ms)
              </span>
            </div>
            <textarea
              rows={2}
              value={config.firstMessage}
              onChange={(e) => setConfig({ ...config, firstMessage: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 leading-relaxed font-sans"
              placeholder="What the agent immediately speaks when the caller connects..."
            />
          </div>

          {/* System Prompt / Directive */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                System Prompt (Persona & Instructions)
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                Variables: {'{{caller_name}}'}, {'{{order_id}}'}
              </span>
            </div>
            <textarea
              rows={5}
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs sm:text-sm text-zinc-200 font-mono focus:outline-none focus:border-indigo-500 leading-relaxed"
              placeholder="Define behavioral rules, boundaries, and situation instructions..."
            />
          </div>
        </div>
      </div>

      {/* SECTION 2: Simple Decision & Action Rules (ElevenLabs style: Simple, Intuitive, No Messy Nodes) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-white">Decision Rules & Actions</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-mono">
                {config.rules.filter((r) => r.enabled).length} Active Rules
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Define in what situations what the agent should do, when to end calls, and when to escalate to a human agent.
            </p>
          </div>

          <button
            onClick={() => setShowAddRuleModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Decision Rule</span>
          </button>
        </div>

        {/* Rules Cards List */}
        <div className="space-y-3">
          {config.rules.map((rule) => {
            const isEscalate = rule.actionType === 'escalate_human';
            const isEnd = rule.actionType === 'end_call';

            return (
              <div
                key={rule.id}
                className={`p-4 rounded-xl border transition-all ${
                  !rule.enabled
                    ? 'border-zinc-800/60 bg-zinc-950/40 opacity-60'
                    : isEscalate
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : isEnd
                    ? 'border-rose-500/30 bg-rose-500/5'
                    : 'border-zinc-800 bg-zinc-950/70'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => handleToggleRule(rule.id)}
                      className="rounded bg-zinc-900 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{rule.name}</span>
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                            isEscalate
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : isEnd
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                              : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                          }`}
                        >
                          {rule.actionType.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mt-1">
                        When caller intent matches: <code className="text-zinc-200">"{rule.conditionValue}"</code>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-1 rounded text-zinc-600 hover:text-rose-400 transition-colors"
                    title="Delete rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Spoken Response or Escalation Target */}
                {rule.agentResponseText && (
                  <div className="mt-2.5 text-xs text-zinc-300 bg-zinc-900/80 rounded-lg p-2.5 border border-zinc-800/80 font-mono">
                    <span className="text-zinc-500 select-none mr-1.5">Agent reply:</span>
                    "{rule.agentResponseText}"
                  </div>
                )}

                {isEscalate && rule.actionTarget && (
                  <div className="mt-2 text-xs flex items-center gap-2 text-amber-300 font-medium">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Transfers to: {rule.actionTarget} with full call transcript</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 3: Conversation Flow Controls (Barge-in, Silence, Turn-taking) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Conversation & Latency Controls</h3>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure how smoothly the agent listens, handles interruptions, and concludes turns.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1.5">
              Interruption Sensitivity (Barge-In)
            </label>
            <select
              value={config.interruptSensitivity}
              onChange={(e) => setConfig({ ...config, interruptSensitivity: e.target.value as any })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="high">High — Stops speaking immediately when user talks (ElevenLabs default)</option>
              <option value="medium">Medium — Filters out quick coughs or 'uh-huh' interjections</option>
              <option value="low">Low — Finishes current sentence before listening</option>
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center text-xs mb-1.5">
              <span className="text-zinc-400 font-semibold uppercase">Silence Timeout</span>
              <span className="font-mono text-indigo-400 font-semibold">{config.silenceTimeoutSec}s</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.5"
              value={config.silenceTimeoutSec}
              onChange={(e) => setConfig({ ...config, silenceTimeoutSec: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
              <span>1.0s (Fast turn)</span>
              <span>2.5s (Balanced)</span>
              <span>5.0s (Patient)</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center text-xs mb-1.5">
              <span className="text-zinc-400 font-semibold uppercase">Max Call Duration</span>
              <span className="font-mono text-indigo-400 font-semibold">{config.maxCallDurationMinutes} min</span>
            </div>
            <input
              type="range"
              min="5"
              max="60"
              step="5"
              value={config.maxCallDurationMinutes}
              onChange={(e) => setConfig({ ...config, maxCallDurationMinutes: parseInt(e.target.value, 10) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
              <span>5 min</span>
              <span>15 min</span>
              <span>60 min</span>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoEscalateOnNegativeSentiment}
              onChange={(e) => setConfig({ ...config, autoEscalateOnNegativeSentiment: e.target.checked })}
              className="rounded bg-zinc-900 border-zinc-700 text-indigo-600 focus:ring-0"
            />
            <span>Auto-escalate when caller displays frustrated sentiment</span>
          </label>

          <span className="text-[11px] text-emerald-400 font-mono">
            Silero VAD + Faster-Whisper active
          </span>
        </div>
      </div>

      {/* Modal: Add Decision Rule */}
      {showAddRuleModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-400" /> New Decision & Action Rule
            </h4>

            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                Rule Name
              </label>
              <input
                type="text"
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                placeholder="e.g. Inquire Shipping Return"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Trigger Type
                </label>
                <select
                  value={newRuleTrigger}
                  onChange={(e) => setNewRuleTrigger(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="intent">Intent Match</option>
                  <option value="keyword">Keyword Match</option>
                  <option value="sentiment">Negative Sentiment</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Action Type
                </label>
                <select
                  value={newRuleAction}
                  onChange={(e) => setNewRuleAction(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="speak_reply">Speak Response</option>
                  <option value="escalate_human">Escalate to Human Agent</option>
                  <option value="end_call">End Call Cleanly</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                Keywords / Phrases to Trigger
              </label>
              <input
                type="text"
                value={newRuleKeywords}
                onChange={(e) => setNewRuleKeywords(e.target.value)}
                placeholder="e.g. return, exchange, wrong item"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            {newRuleAction === 'escalate_human' ? (
              <div>
                <label className="block text-xs font-semibold uppercase text-amber-400 mb-1">
                  Escalation Target
                </label>
                <input
                  type="text"
                  value={newRuleTarget}
                  onChange={(e) => setNewRuleTarget(e.target.value)}
                  placeholder="e.g. Senior Tier 2 Dispatch"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1">
                  Spoken Reply
                </label>
                <textarea
                  rows={2}
                  value={newRuleResponse}
                  onChange={(e) => setNewRuleResponse(e.target.value)}
                  placeholder="What Kokoro-82M will speak in response..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setShowAddRuleModal(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRule}
                disabled={!newRuleName || !newRuleKeywords}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold text-white rounded-xl shadow-md"
              >
                Save Decision Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
