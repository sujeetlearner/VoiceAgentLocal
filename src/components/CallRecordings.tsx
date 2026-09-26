import React, { useState, useRef } from 'react';
import { 
  FileText, 
  Download, 
  Trash2, 
  Play, 
  Square, 
  Search, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  HardDrive, 
  User, 
  Bot, 
  Copy, 
  Check, 
  Volume2, 
  Tag,
  ExternalLink,
  ShieldCheck,
  FileCode
} from 'lucide-react';
import { CallRecord } from '../types/agent';
import { deleteCallRecording } from '../services/api';
import { audioSynthesizer } from '../services/audioSynthesizer';
import { KOKORO_VOICES } from '../data/defaultConfig';

interface CallRecordingsProps {
  recordings: CallRecord[];
  onDeleteRecording: (id: string) => void;
  storagePath: string;
}

export const CallRecordings: React.FC<CallRecordingsProps> = ({
  recordings,
  onDeleteRecording,
  storagePath,
}) => {
  const [selectedCallId, setSelectedCallId] = useState<string>(recordings[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'escalated'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPlayingTranscript, setIsPlayingTranscript] = useState(false);
  const [playbackProgressSec, setPlaybackProgressSec] = useState(0);

  const selectedCall = recordings.find((r) => r.id === selectedCallId) || recordings[0];

  const filteredRecordings = recordings.filter((call) => {
    if (statusFilter !== 'all' && call.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inId = call.id.toLowerCase().includes(q);
      const inCaller = call.caller.toLowerCase().includes(q);
      const inNotes = call.notes?.toLowerCase().includes(q);
      const inTranscript = call.transcript.some((t) => t.text.toLowerCase().includes(q));
      if (!inId && !inCaller && !inNotes && !inTranscript) return false;
    }
    return true;
  });

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  const handleCopyRawTranscript = (call: CallRecord) => {
    const raw = [
      `============================================================`,
      `LOCAL KOKORO-82M & LIVEKIT CALL TRANSCRIPT`,
      `Call ID: ${call.id}`,
      `Date/Time: ${new Date(call.timestamp).toLocaleString()}`,
      `Duration: ${formatDuration(call.durationSeconds)}`,
      `Status: ${call.status.toUpperCase()}`,
      `Voice Model: ${call.voiceUsed}`,
      `LLM Model: ${call.llmUsed}`,
      `Local File: ${storagePath}/${call.id}.txt`,
      `============================================================`,
      '',
      ...call.transcript.map(
        (t) => `[${t.timestamp}] [${t.speaker.toUpperCase()}]: ${t.text}`
      ),
      '',
      `Notes: ${call.notes || 'None'}`,
    ].join('\n');

    navigator.clipboard.writeText(raw);
    setCopiedId(call.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownload = (call: CallRecord, format: 'txt' | 'json' | 'md' | 'srt') => {
    let content = '';
    let mimeType = 'text/plain';
    const filename = `${call.id}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(call, null, 2);
      mimeType = 'application/json';
    } else if (format === 'md') {
      content = [
        `# Local Call Record: \`${call.id}\``,
        ``,
        `- **Caller**: ${call.caller}`,
        `- **Date**: ${new Date(call.timestamp).toLocaleString()}`,
        `- **Duration**: ${formatDuration(call.durationSeconds)}`,
        `- **Status**: \`${call.status}\``,
        `- **TTS Engine**: \`${call.voiceUsed}\``,
        `- **LLM**: \`${call.llmUsed}\``,
        `- **Cost**: $0.00 (100% Local Free)`,
        ``,
        `### Timestamped Dialogue`,
        ``,
        ...call.transcript.map(
          (t) => `**[${t.timestamp}] ${t.speaker === 'agent' ? '🤖 Kokoro Agent' : '👤 Caller'}**: ${t.text}\n`
        ),
      ].join('\n');
      mimeType = 'text/markdown';
    } else if (format === 'srt') {
      content = call.transcript
        .map((t, idx) => {
          const parts = t.timestamp.split(':');
          const sec = parseInt(parts[0] || '0', 10) * 60 + parseInt(parts[1] || '0', 10);
          const fmt = (s: number) => {
            const m = Math.floor(s / 60).toString().padStart(2, '0');
            const remSec = (s % 60).toString().padStart(2, '0');
            return `00:${m}:${remSec},000`;
          };
          return `${idx + 1}\n${fmt(sec)} --> ${fmt(sec + 4)}\n${t.speaker.toUpperCase()}: ${t.text}\n`;
        })
        .join('\n');
    } else {
      // Plain text localized format
      content = [
        `Call ID: ${call.id}`,
        `Date: ${new Date(call.timestamp).toLocaleString()}`,
        `Duration: ${formatDuration(call.durationSeconds)}`,
        `Status: ${call.status}`,
        `Voice: ${call.voiceUsed}`,
        `LLM: ${call.llmUsed}`,
        `Storage: ${storagePath}/${call.id}.txt`,
        `----------------------------------------------------`,
        ...call.transcript.map((t) => `[${t.timestamp}] ${t.speaker.toUpperCase()}: ${t.text}`),
      ].join('\n');
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isPlayingRef = useRef(false);

  const handlePlayRecording = async (call: CallRecord) => {
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      audioSynthesizer.stopSpeaking();
      setIsPlayingTranscript(false);
      return;
    }

    isPlayingRef.current = true;
    setIsPlayingTranscript(true);

    const agentVoice = KOKORO_VOICES.find((v) => call.voiceUsed?.includes(v.name)) || KOKORO_VOICES[0];
    const callerVoice = KOKORO_VOICES.find((v) => v.id === 'am_michael') || KOKORO_VOICES[4];

    for (let i = 0; i < call.transcript.length; i++) {
      if (!isPlayingRef.current) break;
      const turn = call.transcript[i];
      const isAgent = turn.speaker === 'agent';
      const speakerVoice = isAgent ? agentVoice : callerVoice;
      const emotion = isAgent && call.sentiment === 'frustrated' ? 'empathetic' : 'natural';

      await audioSynthesizer.speak(
        turn.text,
        speakerVoice,
        isAgent ? 1.0 : 1.05,
        isAgent ? 1.0 : 0.95,
        0.78,
        0.85,
        0.35,
        0.72,
        emotion
      );

      // Short natural conversational pause between turns
      if (isPlayingRef.current && i < call.transcript.length - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    isPlayingRef.current = false;
    setIsPlayingTranscript(false);
  };

  const handleDelete = async (id: string) => {
    await deleteCallRecording(id);
    onDeleteRecording(id);
    if (selectedCallId === id) {
      const remaining = recordings.filter((r) => r.id !== id);
      setSelectedCallId(remaining[0]?.id || '');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner: Local Privacy & Storage Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Call Recordings & Local Transcripts</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase tracking-wider">
              100% Stored on Device
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            All audio interactions are transcribed locally with precise millisecond timestamps and archived into localized text files.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2">
          <HardDrive className="w-4 h-4 text-indigo-400 flex-shrink-0" />
          <span className="truncate max-w-xs">{storagePath}</span>
        </div>
      </div>

      {/* Main Split Layout: Calls Table + Transcript Reader */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Call Sessions List */}
        <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col h-[640px]">
          {/* Search & Filter */}
          <div className="space-y-2.5 pb-3 border-b border-zinc-800">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transcripts, caller ID, or notes..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-mono">
                {filteredRecordings.length} calls logged
              </span>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 flex">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    statusFilter === 'all' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('completed')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    statusFilter === 'completed' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400'
                  }`}
                >
                  Completed
                </button>
                <button
                  onClick={() => setStatusFilter('escalated')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    statusFilter === 'escalated' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400'
                  }`}
                >
                  Escalated
                </button>
              </div>
            </div>
          </div>

          {/* Calls List */}
          <div className="flex-1 overflow-y-auto space-y-2 pt-3 pr-1">
            {filteredRecordings.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                <FileText className="w-10 h-10 text-zinc-700 mb-2" />
                <p className="text-xs">No calls recorded yet</p>
              </div>
            ) : (
              filteredRecordings.map((call) => {
                const isSelected = selectedCall?.id === call.id;
                const isEscalated = call.status === 'escalated';

                return (
                  <div
                    key={call.id}
                    onClick={() => setSelectedCallId(call.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 shadow-sm'
                        : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate">
                        <div className="font-bold text-xs text-white truncate flex items-center gap-1.5">
                          <span>{call.caller}</span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                              isEscalated
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {call.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          {new Date(call.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          • {formatDuration(call.durationSeconds)} • Cost: $0.00
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(call.id);
                        }}
                        className="p-1 rounded text-zinc-600 hover:text-rose-400 transition-colors"
                        title="Delete recording file"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Preview first caller turn */}
                    {call.transcript[1] && (
                      <p className="text-[11px] text-zinc-400 mt-2 truncate font-mono">
                        "{call.transcript[1].text}"
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Detailed Localized Plain-Text Transcript & Audio Player */}
        <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col h-[640px]">
          {selectedCall ? (
            <>
              {/* Header Info */}
              <div className="pb-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">Call: {selectedCall.id}</h3>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                        selectedCall.status === 'escalated'
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {selectedCall.status}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 font-mono mt-0.5">
                    Saved locally: <code className="text-indigo-400">{storagePath}/{selectedCall.id}.txt</code>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleCopyRawTranscript(selectedCall)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded-lg border border-zinc-700 transition-colors"
                    title="Copy plain text with timestamps"
                  >
                    {copiedId === selectedCall.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy TXT</span>
                  </button>

                  <div className="relative group">
                    <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-xs text-white rounded-lg transition-colors font-medium">
                      <Download className="w-3.5 h-3.5" />
                      <span>Export</span>
                    </button>
                    <div className="absolute right-0 mt-1 w-32 bg-zinc-950 border border-zinc-800 rounded-xl p-1 shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-20 text-xs">
                      <button
                        onClick={() => handleDownload(selectedCall, 'txt')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300"
                      >
                        Plain Text (.txt)
                      </button>
                      <button
                        onClick={() => handleDownload(selectedCall, 'md')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300"
                      >
                        Markdown (.md)
                      </button>
                      <button
                        onClick={() => handleDownload(selectedCall, 'json')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300"
                      >
                        JSON Format (.json)
                      </button>
                      <button
                        onClick={() => handleDownload(selectedCall, 'srt')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 text-zinc-300"
                      >
                        Subtitles (.srt)
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => handlePlayRecording(selectedCall)}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition-colors"
                    title={isPlayingTranscript ? 'Stop playback' : 'Play audio transcript'}
                  >
                    {isPlayingTranscript ? (
                      <Square className="w-4 h-4 text-rose-400 fill-current" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-indigo-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Call Details Bar */}
              <div className="py-2.5 px-3 my-2 bg-zinc-950/70 border border-zinc-800 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                <div>
                  <span className="text-zinc-500 block">CALLER</span>
                  <span className="text-zinc-300 truncate block">{selectedCall.caller}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">DURATION</span>
                  <span className="text-zinc-300">{formatDuration(selectedCall.durationSeconds)}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">VOICE ENGINE</span>
                  <span className="text-indigo-400 truncate block">{selectedCall.voiceUsed}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">LOCAL LLM</span>
                  <span className="text-emerald-400 truncate block">{selectedCall.llmUsed}</span>
                </div>
              </div>

              {/* Localized Transcript Log */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-2 pt-2">
                {selectedCall.transcript.map((item, index) => {
                  const isAgent = item.speaker === 'agent';
                  return (
                    <div
                      key={index}
                      className={`flex gap-3 text-xs ${isAgent ? 'justify-start' : 'justify-end'}`}
                    >
                      {isAgent && (
                        <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] rounded-2xl p-3.5 space-y-1.5 ${
                          isAgent
                            ? 'bg-zinc-950 border border-zinc-800 text-zinc-200'
                            : 'bg-indigo-600 text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                          <span className="font-semibold uppercase tracking-wider">
                            {isAgent ? 'Kokoro-82M Voice Agent' : 'Caller'}
                          </span>
                          <span className="font-mono">[{item.timestamp}]</span>
                        </div>

                        <p className="text-xs sm:text-sm leading-relaxed">{item.text}</p>
                      </div>

                      {!isAgent && (
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedCall.notes && (
                <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-400 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/60">
                  <strong className="text-zinc-300">Session Notes:</strong> {selectedCall.notes}
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
              <FileText className="w-12 h-12 text-zinc-700 mb-2" />
              <p className="text-sm text-zinc-400">Select a call recording to view transcript</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
