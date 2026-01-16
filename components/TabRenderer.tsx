
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Pause, Volume2, Music, Waves, Square, AlertCircle, Info, Download, FileText, Code, ChevronDown, Bell, BellOff } from 'lucide-react';
import { GuitarTabResult, TabSection, TabMeasure, TabNote, TUNINGS, TUNING_FREQS } from '../types';

interface TabRendererProps {
  data: GuitarTabResult;
  originalAudioUrl: string | null;
}

interface RenderedNote {
  fret: string;
  confidence?: number;
}

const TabRenderer: React.FC<TabRendererProps> = ({ data, originalAudioUrl }) => {
  const [isPlayingOriginal, setIsPlayingOriginal] = useState(false);
  const [isPlayingSynth, setIsPlayingSynth] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  
  // Real-time tracking states
  const [activeMeasureIdx, setActiveMeasureIdx] = useState<number | null>(null);
  const [activePosIdx, setActivePosIdx] = useState<number | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthContextRef = useRef<AudioContext | null>(null);
  const synthOscillators = useRef<OscillatorNode[]>([]);
  const synthTimeoutRefs = useRef<number[]>([]);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const synthStartTimeRef = useRef<number>(0);

  // Find the string labels based on the tuning name
  const currentTuning = useMemo(() => TUNINGS.find(t => t.name === data.tuning) || TUNINGS[0], [data.tuning]);
  const stringLabels = useMemo(() => [...currentTuning.notes].reverse(), [currentTuning]);

  // Flatten measures for easier tracking
  const flatMeasures = useMemo(() => {
    return data.sections.flatMap((section, sIdx) => 
      section.measures.map((measure, mIdx) => ({
        ...measure,
        sectionIdx: sIdx,
        measureIdx: mIdx,
        absoluteIdx: 0 // Placeholder
      }))
    ).map((m, i) => ({ ...m, absoluteIdx: i }));
  }, [data.sections]);

  // Handle original audio instance lifecycle
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current = null;
    }
    setIsPlayingOriginal(false);

    if (originalAudioUrl) {
      const audio = new Audio(originalAudioUrl);
      audio.onended = () => setIsPlayingOriginal(false);
      audio.onerror = (e) => {
        console.error("Audio error:", e);
        setIsPlayingOriginal(false);
      };
      audioRef.current = audio;
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, [originalAudioUrl]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setShowSaveMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      stopAllPlayback();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const stopAllPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlayingOriginal(false);

    synthOscillators.current.forEach(osc => {
      try { osc.stop(); } catch (e) {}
    });
    synthOscillators.current = [];
    synthTimeoutRefs.current.forEach(t => clearTimeout(t));
    synthTimeoutRefs.current = [];
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    setIsPlayingSynth(false);
    setActiveMeasureIdx(null);
    setActivePosIdx(null);
    setActiveSectionIdx(null);
  };

  const updatePlaybackProgress = () => {
    if (!synthContextRef.current || !isPlayingSynth) return;

    const tempo = data.tempo || 120;
    const secondsPerMeasure = (60 / tempo) * 4;
    const secondsPerPosition = secondsPerMeasure / 16;
    const elapsed = synthContextRef.current.currentTime - synthStartTimeRef.current;

    if (elapsed < 0) {
      animationFrameRef.current = requestAnimationFrame(updatePlaybackProgress);
      return;
    }

    const totalPositions = Math.floor(elapsed / secondsPerPosition);
    const absMeasureIdx = Math.floor(totalPositions / 16);
    const posInMeasure = totalPositions % 16;

    if (absMeasureIdx < flatMeasures.length) {
      const currentFlat = flatMeasures[absMeasureIdx];
      setActiveSectionIdx(currentFlat.sectionIdx);
      setActiveMeasureIdx(currentFlat.measureIdx);
      setActivePosIdx(posInMeasure);
      animationFrameRef.current = requestAnimationFrame(updatePlaybackProgress);
    } else {
      stopAllPlayback();
    }
  };

  const toggleOriginalPlayback = () => {
    if (isPlayingSynth) stopAllPlayback();

    if (!audioRef.current) {
      console.warn("Original audio source is missing or invalid.");
      return;
    }

    if (isPlayingOriginal) {
      audioRef.current.pause();
      setIsPlayingOriginal(false);
    } else {
      audioRef.current.play().catch(err => {
        console.error("Audio play failed:", err);
        setIsPlayingOriginal(false);
      });
      setIsPlayingOriginal(true);
    }
  };

  const playSynth = () => {
    if (isPlayingOriginal) stopAllPlayback();
    if (isPlayingSynth) {
      stopAllPlayback();
      return;
    }

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    synthContextRef.current = ctx;
    setIsPlayingSynth(true);

    const tempo = data.tempo || 120;
    const secondsPerMeasure = (60 / tempo) * 4;
    const secondsPerPosition = secondsPerMeasure / 16;
    const secondsPerBeat = 60 / tempo;
    const tuningBaseFreqs = TUNING_FREQS[data.tuning || 'E Standard'] || TUNING_FREQS['E Standard'];

    const startTime = ctx.currentTime + 0.2;
    synthStartTimeRef.current = startTime;
    let measureStartTime = startTime;

    data.sections.forEach((section) => {
      section.measures.forEach((measure) => {
        // Schedule Metronome Clicks if enabled
        if (metronomeEnabled) {
          for (let beat = 0; beat < 4; beat++) {
            const clickTime = measureStartTime + (beat * secondsPerBeat);
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            // Accent on beat 1
            osc.frequency.setValueAtTime(beat === 0 ? 1200 : 800, clickTime);
            osc.type = 'sine';

            gain.gain.setValueAtTime(0, clickTime);
            gain.gain.linearRampToValueAtTime(0.1, clickTime + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.05);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(clickTime);
            osc.stop(clickTime + 0.06);
            synthOscillators.current.push(osc);
          }
        }

        const sortedNotes = [...measure.notes].sort((a, b) => a.position - b.position);
        
        sortedNotes.forEach((note) => {
          const fretNum = parseInt(note.fret.toString());
          if (isNaN(fretNum)) return;

          const stringIdx = 6 - note.string;
          const baseFreq = tuningBaseFreqs[stringIdx];
          const frequency = baseFreq * Math.pow(2, fretNum / 12);
          const noteStartTime = measureStartTime + (note.position * secondsPerPosition);

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(frequency, noteStartTime);
          
          gain.gain.setValueAtTime(0, noteStartTime);
          gain.gain.linearRampToValueAtTime(0.15, noteStartTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStartTime + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteStartTime);
          osc.stop(noteStartTime + 0.5);
          synthOscillators.current.push(osc);
        });
        measureStartTime += secondsPerMeasure;
      });
    });

    animationFrameRef.current = requestAnimationFrame(updatePlaybackProgress);
  };

  const downloadFile = (content: string, fileName: string, contentType: string) => {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    setShowSaveMenu(false);
  };

  const handleDownloadAscii = () => {
    if (!data.rawAscii) return;
    const fileName = `${data.songTitle.replace(/\s+/g, '_')}_tab.txt`;
    downloadFile(data.rawAscii, fileName, 'text/plain');
  };

  const handleDownloadJson = () => {
    const fileName = `${data.songTitle.replace(/\s+/g, '_')}_tab.json`;
    downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
  };

  const renderMeasure = (measure: TabMeasure, sIdx: number, mIdx: number) => {
    const stringLines: (RenderedNote | null)[][] = Array(6).fill(null).map(() => Array(16).fill(null));
    const isCurrentMeasure = activeSectionIdx === sIdx && activeMeasureIdx === mIdx;

    measure.notes.forEach((note: TabNote) => {
      const sIndex = note.string - 1;
      const pos = Math.min(Math.max(0, note.position), 15);
      if (sIndex >= 0 && sIndex < 6) {
        if (!stringLines[sIndex][pos]) {
          stringLines[sIndex][pos] = {
            fret: note.fret.toString(),
            confidence: note.confidence
          };
        }
      }
    });

    return (
      <div className={`flex-shrink-0 min-w-[300px] border-r border-slate-700/50 last:border-r-0 relative pt-14 pb-8 px-6 transition-all duration-300 group/measure ${
        isCurrentMeasure ? 'bg-amber-500/5 border-amber-500/30' : 'hover:bg-white/5'
      }`}>
        <div className={`absolute top-4 left-6 flex flex-wrap gap-2 font-bold text-[11px] tracking-widest uppercase transition-all duration-300 ${
          isCurrentMeasure ? 'text-amber-400 scale-105 opacity-100' : 'text-slate-400 opacity-70'
        }`}>
          {measure.chords.length > 0 ? (
            measure.chords.map((chord, i) => (
              <span key={i} className={`px-2 py-0.5 rounded border shadow-sm ${
                isCurrentMeasure ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}>{chord}</span>
            ))
          ) : (
            <span className="text-slate-600 italic">No Chord</span>
          )}
        </div>

        <div className="flex flex-col gap-2.5 mono text-slate-300 relative mt-2">
          {stringLabels.map((label, sIdxLine) => (
            <div key={sIdxLine} className="flex items-center">
              <span className={`w-6 text-[11px] font-bold transition-colors ${isCurrentMeasure ? 'text-amber-500' : 'text-slate-500'}`}>
                {label}
              </span>
              <div className="flex-1 flex tracking-[0.45em] text-sm relative">
                <div className={`absolute inset-y-1/2 left-0 right-0 h-[1px] -z-10 transition-colors ${
                  isCurrentMeasure ? 'bg-amber-500/20' : 'bg-slate-800'
                }`}></div>
                
                {/* Active Beat Highlight Column */}
                {isCurrentMeasure && activePosIdx !== null && (
                  <div 
                    className="absolute inset-y-0 w-5 bg-amber-500/20 border-x border-amber-500/30 -z-5 pointer-events-none transition-all duration-75"
                    style={{ left: `${activePosIdx * 1.25}rem` }}
                  />
                )}

                {stringLines[sIdxLine].map((cell, cIdx) => {
                  const isLowConfidence = cell && cell.confidence !== undefined && cell.confidence < 0.7;
                  const isActiveCell = isCurrentMeasure && activePosIdx === cIdx;
                  
                  return (
                    <span 
                      key={cIdx} 
                      className={`w-5 text-center relative z-10 group/note transition-all ${
                        cell 
                        ? (isLowConfidence ? 'text-amber-500/70' : 'text-amber-500 font-bold drop-shadow-[0_0_8px_rgba(245,158,11,0.3)]') 
                        : 'text-slate-700'
                      } ${isActiveCell && cell ? 'scale-125 !text-white' : ''}`}
                    >
                      {cell ? cell.fret : '-'}
                      {isLowConfidence && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_4px_rgba(245,158,11,1)]"></div>
                        </div>
                      )}
                      {cell && cell.confidence !== undefined && (
                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 text-[8px] px-2 py-0.5 rounded opacity-0 group-hover/note:opacity-100 transition-opacity z-[60] whitespace-nowrap text-slate-300 shadow-xl pointer-events-none">
                          {Math.round(cell.confidence * 100)}% Match
                        </div>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-slate-900/80 backdrop-blur-md rounded-3xl p-8 border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Music className="w-32 h-32 text-amber-500" />
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8 relative z-10">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-4xl font-black text-white tracking-tight">{data.songTitle}</h2>
                <span className={`px-3 py-1 rounded-full border font-bold text-[10px] uppercase tracking-widest transition-colors ${
                  isPlayingSynth ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'bg-amber-600/20 text-amber-500 border-amber-600/30'
                }`}>
                  {data.tuning}
                </span>
              </div>
              <div className="flex flex-wrap gap-6 text-sm text-slate-400 font-medium">
                {data.key && <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Key: <span className="text-white font-bold">{data.key}</span></span>}
                {data.tempo && <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Tempo: <span className="text-white font-bold">{data.tempo} BPM</span></span>}
              </div>
            </div>

            <div className="flex items-center gap-4 py-2 px-4 bg-slate-950/50 rounded-xl border border-slate-800 w-fit">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full shadow-[0_0_5px_rgba(245,158,11,0.5)]"></div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Uncertain Match (&lt;70%)</span>
              </div>
              <div className="w-px h-3 bg-slate-800"></div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 italic">
                <Info className="w-3 h-3" />
                Harmonic labels enforced per measure
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={!originalAudioUrl}
              onClick={toggleOriginalPlayback}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all border shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                isPlayingOriginal 
                ? 'bg-amber-600 border-amber-500 text-white shadow-amber-900/40' 
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isPlayingOriginal ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              {isPlayingOriginal ? 'Pause Original' : 'Play Original'}
            </button>
            
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1 shadow-lg">
              <button
                onClick={playSynth}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  isPlayingSynth 
                  ? 'bg-red-600 text-white shadow-red-900/40' 
                  : 'text-slate-300 hover:bg-slate-700'
                }`}
              >
                {isPlayingSynth ? <Square className="w-4 h-4 fill-current" /> : <Waves className="w-4 h-4" />}
                {isPlayingSynth ? 'Stop' : 'Synth'}
              </button>
              <button
                onClick={() => setMetronomeEnabled(!metronomeEnabled)}
                className={`p-2 rounded-lg transition-all ml-1 ${
                  metronomeEnabled 
                  ? 'text-amber-500 bg-amber-500/10' 
                  : 'text-slate-500 hover:text-slate-300'
                }`}
                title={metronomeEnabled ? "Disable Metronome" : "Enable Metronome"}
              >
                {metronomeEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
            </div>

            <div className="relative" ref={saveMenuRef}>
              <button
                onClick={() => setShowSaveMenu(!showSaveMenu)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-950 rounded-xl font-bold text-sm hover:bg-amber-500 hover:text-white transition-all shadow-xl shadow-white/5"
              >
                <Download className="w-4 h-4" />
                Save Tab
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showSaveMenu ? 'rotate-180' : ''}`} />
              </button>
              
              {showSaveMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                  <button
                    onClick={handleDownloadAscii}
                    className="w-full flex items-center gap-3 px-4 py-4 text-left text-sm text-slate-300 hover:bg-amber-600 hover:text-white transition-colors border-b border-slate-800"
                  >
                    <FileText className="w-4 h-4" />
                    <div className="flex flex-col">
                      <span className="font-bold">Download ASCII</span>
                      <span className="text-[10px] opacity-70">Formatted plain text (.txt)</span>
                    </div>
                  </button>
                  <button
                    onClick={handleDownloadJson}
                    className="w-full flex items-center gap-3 px-4 py-4 text-left text-sm text-slate-300 hover:bg-amber-600 hover:text-white transition-colors"
                  >
                    <Code className="w-4 h-4" />
                    <div className="flex flex-col">
                      <span className="font-bold">Download JSON</span>
                      <span className="text-[10px] opacity-70">Raw structured data (.json)</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-12">
          {data.sections.map((section: TabSection, sIdx) => (
            <div key={sIdx} className="space-y-4">
              <h3 className={`text-lg font-bold flex items-center gap-3 transition-colors ${activeSectionIdx === sIdx ? 'text-amber-500' : 'text-slate-200'}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black transition-all ${
                  activeSectionIdx === sIdx ? 'bg-amber-500 text-slate-950 scale-110 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-amber-600/10 text-amber-500'
                }`}>
                  0{sIdx + 1}
                </span>
                {section.title}
              </h3>
              <div className="flex overflow-x-auto pb-8 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent bg-slate-950/50 rounded-2xl border border-slate-800/50">
                {section.measures.map((measure, mIdx) => (
                  <React.Fragment key={mIdx}>
                    {renderMeasure(measure, sIdx, mIdx)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>

        {data.rawAscii && (
          <div className="mt-12 pt-12 border-t border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Technical ASCII Export</h4>
              <button 
                onClick={() => {
                   navigator.clipboard.writeText(data.rawAscii || '');
                }}
                className="text-[10px] font-bold text-amber-600 hover:text-amber-500 uppercase tracking-widest bg-amber-600/10 px-3 py-1 rounded"
              >
                Copy to Clipboard
              </button>
            </div>
            <pre className="p-8 bg-slate-950 rounded-2xl text-[11px] mono text-slate-500 overflow-x-auto border border-slate-800/50 leading-relaxed shadow-inner">
              {data.rawAscii}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default TabRenderer;
