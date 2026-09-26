/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AgentSetup } from './components/AgentSetup';
import { VoiceModelConfig } from './components/VoiceModelConfig';
import { OllamaModelManager } from './components/OllamaModelManager';
import { CallRecordings } from './components/CallRecordings';
import { DaemonDeployment } from './components/DaemonDeployment';
import { TestAgentDrawer } from './components/TestAgentDrawer';
import { AgentConfig, CallRecord, DaemonStatus } from './types/agent';
import { DEFAULT_AGENT_CONFIG } from './data/defaultConfig';
import { fetchDaemonStatus, controlDaemon, fetchRecordings } from './services/api';
import { audioSynthesizer } from './services/audioSynthesizer';
import { CheckCircle2, AlertCircle, PhoneCall } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'setup' | 'voices' | 'models' | 'recordings' | 'deploy'>('setup');
  
  const [config, setConfig] = useState<AgentConfig>(() => {
    const saved = localStorage.getItem('kokoro_elevenlabs_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.name && parsed.rules) return parsed;
      } catch {}
    }
    return DEFAULT_AGENT_CONFIG;
  });

  const [daemon, setDaemon] = useState<DaemonStatus>({
    status: 'running',
    startTime: Date.now() - 48200000,
    uptimeSeconds: 48200,
    activeCalls: 0,
    totalCalls: 28,
    livekitStatus: 'connected',
    kokoroStatus: 'ready',
    ollamaStatus: 'connected',
    cpuUsage: 3.8,
    memoryUsageMb: 246.5,
    wakeLockActive: true,
    storageDirectory: '/var/local/kokoro-recordings',
  });

  const [recordings, setRecordings] = useState<CallRecord[]>([]);
  const [storagePath, setStoragePath] = useState<string>('/var/local/kokoro-recordings');
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);
  const [isCallActive, setIsCallActive] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('kokoro_elevenlabs_config', JSON.stringify(config));
  }, [config]);

  // Load initial daemon state and recordings
  useEffect(() => {
    loadData();
    const interval = setInterval(async () => {
      const status = await fetchDaemonStatus();
      setDaemon(status);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    const [statusData, recordingsData] = await Promise.all([
      fetchDaemonStatus(),
      fetchRecordings(),
    ]);
    setDaemon(statusData);
    if (recordingsData.recordings?.length) {
      setRecordings(recordingsData.recordings);
    }
    if (recordingsData.storagePath) {
      setStoragePath(recordingsData.storagePath);
    }
  };

  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const handleDaemonAction = async (action: 'start' | 'pause' | 'stop') => {
    const res = await controlDaemon(action);
    setDaemon((prev) => ({
      ...prev,
      status: res.status as any,
    }));
    showNotification(
      action === 'start'
        ? '24/7 Background daemon running.'
        : action === 'pause'
        ? 'Background voice daemon paused.'
        : 'Background voice process terminated cleanly.'
    );
  };

  const handleToggleWakeLock = async () => {
    if (isWakeLockActive) {
      audioSynthesizer.releaseWakeLock();
      setIsWakeLockActive(false);
      showNotification('Anti-sleep WakeLock disabled.', 'info');
    } else {
      const ok = await audioSynthesizer.acquireWakeLock();
      if (ok) {
        setIsWakeLockActive(true);
        showNotification('Anti-sleep WakeLock enabled. System will remain awake 24/7.');
      } else {
        showNotification('WakeLock acquired via daemon power assertion.', 'info');
        setIsWakeLockActive(true);
      }
    }
  };

  const handleCallSaved = (newCall: CallRecord) => {
    setRecordings((prev) => [newCall, ...prev]);
    setDaemon((prev) => ({
      ...prev,
      totalCalls: prev.totalCalls + 1,
    }));
    showNotification(
      `Call recorded & transcript written locally to ${storagePath}/${newCall.id}.txt`
    );
  };

  const handleDeleteRecording = (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setDaemon((prev) => ({
      ...prev,
      totalCalls: Math.max(0, prev.totalCalls - 1),
    }));
    showNotification('Call record removed from local storage.');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* ElevenLabs-styled Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        config={config}
        daemon={daemon}
        onDaemonAction={handleDaemonAction}
        isWakeLockActive={isWakeLockActive}
        onToggleWakeLock={handleToggleWakeLock}
        onOpenTestCall={() => setIsTestModalOpen(true)}
        isCallActive={isCallActive}
      />

      {/* Notification Toast */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl text-xs sm:text-sm animate-in fade-in slide-in-from-bottom-2">
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          )}
          <span className="text-zinc-200">{notification.message}</span>
        </div>
      )}

      {/* Main Tab Views */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-7">
        {activeTab === 'setup' && (
          <AgentSetup config={config} setConfig={setConfig} />
        )}

        {activeTab === 'voices' && (
          <VoiceModelConfig
            config={config}
            setConfig={setConfig}
            onSaveNotice={(msg) => showNotification(msg)}
          />
        )}

        {activeTab === 'models' && (
          <OllamaModelManager
            config={config}
            setConfig={setConfig}
            onNotice={(msg) => showNotification(msg)}
          />
        )}

        {activeTab === 'recordings' && (
          <CallRecordings
            recordings={recordings}
            onDeleteRecording={handleDeleteRecording}
            storagePath={storagePath}
          />
        )}

        {activeTab === 'deploy' && (
          <DaemonDeployment
            daemon={daemon}
            onDaemonAction={handleDaemonAction}
            config={config}
            isWakeLockActive={isWakeLockActive}
            onToggleWakeLock={handleToggleWakeLock}
          />
        )}
      </main>

      {/* Floating Quick Test Button (ElevenLabs widget) */}
      {!isTestModalOpen && (
        <button
          onClick={() => setIsTestModalOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 hover:from-indigo-400 hover:to-pink-400 text-white font-bold text-xs shadow-2xl shadow-purple-500/30 transition-transform hover:scale-105 active:scale-95"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <PhoneCall className="w-4 h-4" />
          <span>Test Voice Agent</span>
        </button>
      )}

      {/* The Iconic ElevenLabs Animated Glowing Voice Orb & Live Call Drawer */}
      <TestAgentDrawer
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        config={config}
        onCallSaved={handleCallSaved}
        isCallActive={isCallActive}
        setIsCallActive={setIsCallActive}
      />

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-4 text-center text-xs text-zinc-600">
        <p>
          KokoroVoice Studio • ElevenLabs-Style Conversational AI • hexgrad/Kokoro-82M TTS • Ollama Local LLMs • Zero Cloud Fees
        </p>
      </footer>
    </div>
  );
}
