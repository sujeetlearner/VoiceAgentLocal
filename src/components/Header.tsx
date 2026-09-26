import React from 'react';
import { 
  Sliders, 
  Mic2, 
  Cpu, 
  FileText, 
  Server, 
  Play, 
  Pause, 
  Square, 
  ShieldCheck, 
  PhoneCall, 
  Sparkles,
  Zap,
  HardDrive
} from 'lucide-react';
import { AgentConfig, DaemonStatus } from '../types/agent';

interface HeaderProps {
  activeTab: 'setup' | 'voices' | 'models' | 'recordings' | 'deploy';
  setActiveTab: (tab: 'setup' | 'voices' | 'models' | 'recordings' | 'deploy') => void;
  config: AgentConfig;
  daemon: DaemonStatus;
  onDaemonAction: (action: 'start' | 'pause' | 'stop') => void;
  isWakeLockActive: boolean;
  onToggleWakeLock: () => void;
  onOpenTestCall: () => void;
  isCallActive: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  config,
  daemon,
  onDaemonAction,
  isWakeLockActive,
  onToggleWakeLock,
  onOpenTestCall,
  isCallActive,
}) => {
  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
  };

  const navItems = [
    { id: 'setup', label: 'Agent Setup', icon: Sliders, badge: 'Logic' },
    { id: 'voices', label: 'Voice & TTS Studio', icon: Mic2, badge: 'Kokoro-82M' },
    { id: 'models', label: 'Ollama Models', icon: Cpu, badge: 'Local LLM' },
    { id: 'recordings', label: 'Call History', icon: FileText, badge: `${daemon.totalCalls}` },
    { id: 'deploy', label: '24/7 Runner', icon: Server, badge: 'Daemon' },
  ] as const;

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md sticky top-0 z-40">
      {/* Top tier: ElevenLabs styled top bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Brand & Active Agent Identity */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex items-center justify-center">
            {/* Animated mini orb */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-0.5 shadow-lg shadow-purple-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-full flex items-center justify-center">
                <Mic2 className="w-4 h-4 text-indigo-400" />
              </div>
            </div>
            {daemon.status === 'running' && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">{config.name}</h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                ElevenLabs Style
              </span>
              <span className="hidden md:inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                100% Free & Local
              </span>
            </div>
            <p className="text-xs text-zinc-400 flex items-center gap-2">
              <span>hexgrad/Kokoro-82M</span>
              <span className="text-zinc-600">•</span>
              <span className="text-indigo-400">{config.selectedLLM}</span>
              <span className="text-zinc-600">•</span>
              <span>LiveKit WebRTC</span>
            </p>
          </div>
        </div>

        {/* Right side controls: Test Agent, 24/7 Daemon, Anti-Sleep */}
        <div className="flex items-center gap-3">
          {/* 24/7 Daemon Status pill */}
          <div className="hidden sm:flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                daemon.status === 'running'
                  ? 'bg-emerald-400 animate-pulse'
                  : daemon.status === 'paused'
                  ? 'bg-amber-400'
                  : 'bg-zinc-600'
              }`}
            />
            <span className="text-zinc-300 font-medium">
              {daemon.status === 'running'
                ? `24/7 Active (${formatUptime(daemon.uptimeSeconds)})`
                : daemon.status === 'paused'
                ? 'Daemon Paused'
                : 'Daemon Stopped'}
            </span>

            {daemon.status === 'running' ? (
              <button
                onClick={() => onDaemonAction('pause')}
                className="p-1 rounded hover:bg-zinc-800 text-amber-400 transition-colors ml-1"
                title="Pause background daemon"
              >
                <Pause className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => onDaemonAction('start')}
                className="p-1 rounded hover:bg-zinc-800 text-emerald-400 transition-colors ml-1"
                title="Start 24/7 background process"
              >
                <Play className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Anti-Sleep button */}
          <button
            onClick={onToggleWakeLock}
            className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              isWakeLockActive
                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
            title="Ensures agent process stays awake continuously 24/7 even when display sleeps"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isWakeLockActive ? 'Anti-Sleep: On' : 'Anti-Sleep: Off'}</span>
          </button>

          {/* Test Call Primary Button (ElevenLabs widget launcher) */}
          <button
            onClick={onOpenTestCall}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${
              isCallActive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20 animate-pulse'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-indigo-600/20'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{isCallActive ? 'Call in Progress' : 'Test Agent'}</span>
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-1 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/80 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                <span>{item.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {item.badge}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
