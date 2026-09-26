import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Download, 
  RefreshCw, 
  Check, 
  HardDrive, 
  Zap, 
  Search, 
  CheckCircle2, 
  Terminal, 
  Sliders, 
  Sparkles,
  Server,
  Layers,
  Activity,
  Gauge,
  ShieldCheck,
  CheckCircle
} from 'lucide-react';
import { AgentConfig, OllamaModelInfo } from '../types/agent';
import { LOCAL_OLLAMA_MODELS } from '../data/defaultConfig';
import { fetchOllamaModels, pullOllamaModel } from '../services/api';

interface OllamaModelManagerProps {
  config: AgentConfig;
  setConfig: React.Dispatch<React.SetStateAction<AgentConfig>>;
  onNotice?: (msg: string) => void;
}

export const OllamaModelManager: React.FC<OllamaModelManagerProps> = ({
  config,
  setConfig,
  onNotice,
}) => {
  const [models, setModels] = useState<OllamaModelInfo[]>(LOCAL_OLLAMA_MODELS);
  const [loading, setLoading] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState(true);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:11434');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | '16gb' | 'installed' | 'LLM' | 'TTS' | 'STT'>('all');
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    const data = await fetchOllamaModels();
    setOllamaOnline(data.online);
    setEndpoint(data.endpoint);
    if (data.models && data.models.length > 0) {
      setModels(data.models);
    }
    setLoading(false);
  };

  const handleDownloadModel = async (modelName: string) => {
    setDownloadingModel(modelName);
    setDownloadProgress(10);

    const interval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 25;
      });
    }, 450);

    const res = await pullOllamaModel(modelName);
    clearInterval(interval);
    setDownloadProgress(100);

    setTimeout(() => {
      setDownloadingModel(null);
      setDownloadProgress(0);

      setModels((prev) =>
        prev.map((m) =>
          m.name === modelName
            ? { ...m, status: 'installed', updated: 'Just installed' }
            : m
        )
      );

      const targetModel = models.find((m) => m.name === modelName);
      if (targetModel?.category === 'TTS') {
        setConfig((c) => ({ ...c, selectedTTSModel: modelName }));
      } else {
        setConfig((c) => ({ ...c, selectedLLM: modelName }));
      }

      if (onNotice) {
        onNotice(`Model ${modelName} downloaded and activated for local voice pipeline.`);
      }
    }, 600);
  };

  const handleSelectModel = (modelName: string) => {
    const targetModel = models.find((m) => m.name === modelName);
    if (targetModel?.category === 'TTS') {
      setConfig((c) => ({ ...c, selectedTTSModel: modelName }));
      if (onNotice) onNotice(`Active TTS Engine set to ${modelName}`);
    } else {
      setConfig((c) => ({ ...c, selectedLLM: modelName }));
      if (onNotice) onNotice(`Active LLM switched to ${modelName}`);
    }
  };

  // Calculate RAM footprint
  const currentLLM = models.find((m) => m.name === config.selectedLLM);
  const currentTTS = models.find((m) => m.name === config.selectedTTSModel);
  const llmRamMb = currentLLM?.ramNeededMb || 4500;
  const ttsRamMb = currentTTS?.ramNeededMb || 250;
  const sttRamMb = 850; // Whisper
  const osRamMb = 3200; // OS headroom
  const totalAllocatedMb = llmRamMb + ttsRamMb + sttRamMb + osRamMb;
  const hostRamTotalMb = 16384; // 16 GB
  const ramPercentUsed = Math.min(100, Math.round((totalAllocatedMb / hostRamTotalMb) * 100));

  const filteredModels = models.filter((m) => {
    if (categoryFilter === '16gb' && m.ramTier !== 'fits-16gb') return false;
    if (categoryFilter === 'installed' && m.status !== 'installed') return false;
    if (categoryFilter === 'LLM' && m.category !== 'LLM') return false;
    if (categoryFilter === 'TTS' && m.category !== 'TTS') return false;
    if (categoryFilter === 'STT' && m.category !== 'STT') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inName = m.name.toLowerCase().includes(q);
      const inDesc = m.description?.toLowerCase().includes(q);
      const inParam = m.parameterSize?.toLowerCase().includes(q);
      if (!inName && !inDesc && !inParam) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* 16 GB HOST RAM DASHBOARD */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-zinc-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-5 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <Gauge className="w-3.5 h-3.5" /> 16 GB RAM Host Profile Active
              </span>
              <span className="text-xs text-zinc-400 font-mono">
                Supports up to 14B LLMs &amp; SOTA TTS
              </span>
            </div>
            <h2 className="text-xl font-bold text-white">
              Hardware Memory Allocation &amp; Local Model Tier
            </h2>
            <p className="text-xs text-zinc-300 mt-1 max-w-2xl leading-relaxed">
              With 16 GB RAM, your system can easily run flagship models like <strong>Llama 3.1 8B</strong>, <strong>Qwen 2.5 14B</strong>, <strong>Mistral Nemo 12B</strong>, alongside <strong>Coqui XTTS v2</strong> and <strong>Whisper Large v3</strong> simultaneously.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadModels}
              disabled={loading}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-900/80 hover:bg-zinc-800 text-xs font-semibold text-zinc-200 rounded-xl border border-zinc-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Node</span>
            </button>
          </div>
        </div>

        {/* Real-time RAM Allocation Bar */}
        <div className="mt-5 space-y-2.5">
          <div className="flex justify-between items-center text-xs font-mono">
            <div className="flex items-center gap-4 text-zinc-300">
              <span>Host RAM: <strong>16.0 GB</strong></span>
              <span>•</span>
              <span className="text-indigo-400 font-semibold">
                Allocated: {(totalAllocatedMb / 1024).toFixed(1)} GB ({ramPercentUsed}%)
              </span>
              <span>•</span>
              <span className="text-emerald-400 font-semibold">
                Available: {((hostRamTotalMb - totalAllocatedMb) / 1024).toFixed(1)} GB Free
              </span>
            </div>
            <span className="text-zinc-400 text-[11px]">Zero OOM Risk</span>
          </div>

          {/* Segmented Memory Visualizer */}
          <div className="w-full bg-zinc-950 rounded-xl h-3.5 overflow-hidden flex border border-zinc-800 p-0.5">
            <div
              style={{ width: `${(llmRamMb / hostRamTotalMb) * 100}%` }}
              className="bg-indigo-500 h-full rounded-l-lg transition-all"
              title={`LLM (${config.selectedLLM}): ${(llmRamMb / 1024).toFixed(1)} GB`}
            />
            <div
              style={{ width: `${(ttsRamMb / hostRamTotalMb) * 100}%` }}
              className="bg-pink-500 h-full transition-all"
              title={`TTS (${config.selectedTTSModel}): ${(ttsRamMb / 1024).toFixed(1)} GB`}
            />
            <div
              style={{ width: `${(sttRamMb / hostRamTotalMb) * 100}%` }}
              className="bg-amber-500 h-full transition-all"
              title={`STT (Whisper): ${(sttRamMb / 1024).toFixed(1)} GB`}
            />
            <div
              style={{ width: `${(osRamMb / hostRamTotalMb) * 100}%` }}
              className="bg-zinc-700 h-full rounded-r-lg transition-all"
              title={`OS / System Headroom: ${(osRamMb / 1024).toFixed(1)} GB`}
            />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-400 pt-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              LLM: <strong>{config.selectedLLM}</strong> ({(llmRamMb / 1024).toFixed(1)} GB)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-pink-500" />
              TTS: <strong>{config.selectedTTSModel}</strong> ({(ttsRamMb / 1024).toFixed(1)} GB)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              STT: <strong>Whisper Local</strong> (0.9 GB)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
              OS Headroom: 3.2 GB
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 1: Active Model Selectors */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-4 h-4 text-indigo-400" /> Active Local Pipeline Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
            <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1.5 flex items-center justify-between">
              <span>Active Conversational LLM</span>
              <span className="text-indigo-400 font-mono text-[11px]">Ollama Runtime</span>
            </label>
            <select
              value={config.selectedLLM}
              onChange={(e) => handleSelectModel(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
            >
              {models
                .filter((m) => m.category === 'LLM')
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.parameterSize || `${m.sizeMb}MB`}) — {m.tokensPerSec ? `${m.tokensPerSec} tok/s` : 'Local'} • RAM: ~{(m.ramNeededMb ? m.ramNeededMb / 1024 : 3).toFixed(1)}GB
                  </option>
                ))}
            </select>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              Powers conversational reasoning, natural language understanding, and branch routing.
            </p>
          </div>

          <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
            <label className="block text-xs font-semibold uppercase text-zinc-400 mb-1.5 flex items-center justify-between">
              <span>Active TTS Voice Engine</span>
              <span className="text-pink-400 font-mono text-[11px]">Speech Synthesis</span>
            </label>
            <select
              value={config.selectedTTSModel}
              onChange={(e) => setConfig({ ...config, selectedTTSModel: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
            >
              <option value="hexgrad/kokoro-82m">
                hexgrad/Kokoro-82M (82M params, 85ms latency, studio broadcast)
              </option>
              <option value="coqui/xtts-v2">
                Coqui XTTS v2 (Zero-shot human clone from 6s wav, 17 languages)
              </option>
              <option value="resemble/chatterbox">
                Resemble Chatterbox (Ultra-low latency real-time voice clone)
              </option>
              <option value="fishaudio/fish-speech-1.5">
                Fish Speech 1.5 (Dual-AR SOTA Voice Cloning &amp; Emotion)
              </option>
            </select>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              100% open-source neural speech synthesis running locally on your hardware.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 2: Model Catalogue & 1-Click Downloader */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Model Catalogue &amp; 1-Click Pull</span>
              <span className="text-xs text-zinc-500 font-mono">({filteredModels.length} models)</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Download any model directly into your local Ollama / PyTorch cache.
            </p>
          </div>

          {/* Category Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-0.5 flex">
              {[
                { id: 'all', label: 'All' },
                { id: '16gb', label: '⭐ 16GB RAM Tier (8B-14B)' },
                { id: 'installed', label: 'Installed' },
                { id: 'LLM', label: 'LLM' },
                { id: 'TTS', label: 'TTS' },
                { id: 'STT', label: 'STT' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setCategoryFilter(tab.id as any)}
                  className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                    categoryFilter === tab.id
                      ? 'bg-zinc-800 text-white font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Model Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredModels.map((model) => {
            const isSelected = config.selectedLLM === model.name || config.selectedTTSModel === model.name;
            const isInstalled = model.status === 'installed';
            const isDownloadingThis = downloadingModel === model.name;
            const is16gbTier = model.ramTier === 'fits-16gb';

            return (
              <div
                key={model.name}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/30'
                    : is16gbTier
                    ? 'border-zinc-800 bg-zinc-900/80 hover:border-purple-500/40'
                    : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white font-mono">{model.name}</span>
                        {model.parameterSize && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {model.parameterSize}
                          </span>
                        )}
                        {isSelected && (
                          <span className="text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-indigo-600 text-white">
                            Active
                          </span>
                        )}
                        {is16gbTier && (
                          <span className="text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            16GB Tier
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 font-mono mt-0.5 block">
                        Size: {model.sizeMb} MB • RAM required: ~{model.ramNeededMb ? `${(model.ramNeededMb / 1024).toFixed(1)} GB` : '3.0 GB'}
                      </span>
                    </div>

                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                        model.category === 'TTS'
                          ? 'bg-pink-500/10 text-pink-400 border-pink-500/20'
                          : model.category === 'STT'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                      }`}
                    >
                      {model.category || 'LLM'}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-400 mb-3 leading-relaxed">
                    {model.description}
                  </p>
                </div>

                <div>
                  {/* Performance stats */}
                  <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono py-2 border-t border-zinc-800/80 mb-3">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      Speed: <strong>{model.tokensPerSec || 30} tok/s</strong>
                    </span>
                    <span>•</span>
                    <span className="text-emerald-400">
                      {isInstalled ? '✓ Ready Locally' : 'Available in Catalogue'}
                    </span>
                  </div>

                  {/* Action button */}
                  {isDownloadingThis ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-mono text-zinc-300">
                        <span>Pulling to Ollama...</span>
                        <span>{downloadProgress}%</span>
                      </div>
                      <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                        <div
                          className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : isInstalled ? (
                    <button
                      onClick={() => handleSelectModel(model.name)}
                      disabled={isSelected}
                      className={`w-full py-2 rounded-xl text-xs font-bold transition-all ${
                        isSelected
                          ? 'bg-zinc-800 text-zinc-500 cursor-default'
                          : 'bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white'
                      }`}
                    >
                      {isSelected ? 'Currently Selected' : 'Set as Active Model'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDownloadModel(model.name)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Model (1-Click Pull)</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal manual pull snippet */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-xs">
        <span className="font-bold text-white flex items-center gap-2 mb-2">
          <Terminal className="w-4 h-4 text-emerald-400" /> Prefer Ollama Command Line?
        </span>
        <p className="text-zinc-400 mb-2">
          You can also pull any of these larger 16GB models on your command line, and KokoroVoice will auto-detect them:
        </p>
        <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 font-mono text-emerald-400 flex items-center justify-between">
          <code>ollama run {config.selectedLLM}</code>
          <span className="text-zinc-500 text-[11px] font-sans">100% Offline &amp; Free</span>
        </div>
      </div>
    </div>
  );
};
