
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Upload, FileAudio, Play, Square, Loader2, Music2, RefreshCcw, Guitar, Settings2, ShieldCheck, Layers, AlertTriangle, XCircle, Clock, WifiOff, Lock } from 'lucide-react';
import { AppState, GuitarTabResult, TUNINGS, VoicingPreference, VOICING_PREFERENCES } from './types';
import { generateGuitarTabFromAudio, TranscriptionError } from './services/geminiService';
import TabRenderer from './components/TabRenderer';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<GuitarTabResult | null>(null);
  const [errorDetails, setErrorDetails] = useState<{message: string, code?: string} | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedTuning, setSelectedTuning] = useState(TUNINGS[0].name);
  const [selectedVoicing, setSelectedVoicing] = useState<VoicingPreference>('full');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (state === AppState.RECORDING) {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) window.clearInterval(timerRef.current);
      setRecordingTime(0);
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [state]);

  const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (!result) return reject(new Error("FileReader produced null result"));
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = () => reject(new Error("Failed to read audio data"));
      reader.readAsDataURL(blob);
    });
  };

  const startRecording = async () => {
    setErrorDetails(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size < 2000) { 
          setErrorDetails({ message: "The recording was too short. Please record at least 2-3 seconds.", code: "SHORT" });
          setState(AppState.ERROR);
          return;
        }
        
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        stream.getTracks().forEach(track => track.stop());
        processAudio(audioBlob, mimeType);
      };

      recorder.start();
      setState(AppState.RECORDING);
    } catch (err) {
      setErrorDetails({ message: 'Microphone access denied. Please check your system permissions.', code: "AUTH" });
      setState(AppState.ERROR);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 30 * 1024 * 1024) { 
        setErrorDetails({ message: "Audio file is too large (max 30MB). Please use a shorter clip.", code: "SIZE" });
        setState(AppState.ERROR);
        return;
      }
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      processAudio(file, file.type);
    }
  };

  const processAudio = async (audioBlob: Blob, mimeType: string) => {
    setState(AppState.PROCESSING);
    setErrorDetails(null);
    
    try {
      const base64 = await convertBlobToBase64(audioBlob);
      const tabData = await generateGuitarTabFromAudio(base64, mimeType, selectedTuning, selectedVoicing);
      setResult(tabData);
      setState(AppState.RESULT);
    } catch (err: any) {
      setErrorDetails({ 
        message: err.message || 'An unexpected error occurred during analysis.',
        code: err.code || 'UNKNOWN'
      });
      setState(AppState.ERROR);
      console.error("[Tabify Process Error]", err);
    }
  };

  const resetApp = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setState(AppState.IDLE);
    setResult(null);
    setErrorDetails(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderErrorIcon = (code?: string) => {
    switch(code) {
      case 'QUOTA': return <Clock className="w-12 h-12 text-amber-500" />;
      case 'NETWORK': return <WifiOff className="w-12 h-12 text-amber-500" />;
      case 'AUTH': return <Lock className="w-12 h-12 text-amber-500" />;
      case 'SAFETY': return <XCircle className="w-12 h-12 text-amber-500" />;
      default: return <AlertTriangle className="w-12 h-12 text-red-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-5xl flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-600 rounded-lg shadow-lg shadow-amber-900/20">
            <Guitar className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Tabify<span className="text-amber-500">AI</span></h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3 text-amber-500" />
              Pro Accuracy Engine
            </p>
          </div>
        </div>
        {state !== AppState.IDLE && (
          <button onClick={resetApp} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
            <RefreshCcw className="w-4 h-4" />
            Restart
          </button>
        )}
      </header>

      <main className="w-full max-w-5xl flex-1 flex flex-col">
        {state === AppState.IDLE && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 animate-in fade-in duration-1000">
            <div className="space-y-4 max-w-2xl">
              <h2 className="text-4xl md:text-6xl font-bold text-white tracking-tight">
                High-fidelity <span className="text-amber-500">guitar</span> transcription.
              </h2>
              <p className="text-lg text-slate-400">
                Powered by Gemini 3 Pro. Expert-level analysis of harmonics, timing, and fretboard logic.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-4xl">
              <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-xl shadow-black/20">
                <div className="flex items-center justify-center gap-2 text-slate-400 mb-2">
                  <Settings2 className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold uppercase tracking-widest">Tuning</span>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {TUNINGS.map((tuning) => (
                    <button
                      key={tuning.name}
                      onClick={() => setSelectedTuning(tuning.name)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                        selectedTuning === tuning.name ? 'bg-amber-600 border-amber-500 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {tuning.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-xl shadow-black/20">
                <div className="flex items-center justify-center gap-2 text-slate-400 mb-2">
                  <Layers className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold uppercase tracking-widest">Voicing</span>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {VOICING_PREFERENCES.map((pref) => (
                    <button
                      key={pref.id}
                      onClick={() => setSelectedVoicing(pref.id)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                        selectedVoicing === pref.id ? 'bg-amber-600 border-amber-500 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {pref.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
              <button onClick={startRecording} className="group flex flex-col items-center p-12 rounded-3xl bg-slate-900 border border-slate-800 hover:border-amber-600/50 hover:bg-slate-800/50 transition-all shadow-lg">
                <div className="mb-6 p-5 bg-amber-600/10 rounded-full group-hover:scale-110 group-hover:bg-amber-600/20 transition-all">
                  <Mic className="w-10 h-10 text-amber-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Record Audio</h3>
                <p className="text-slate-500 text-sm">Play directly into your mic</p>
              </button>
              <label className="group flex flex-col items-center p-12 rounded-3xl bg-slate-900 border border-slate-800 hover:border-amber-600/50 hover:bg-slate-800/50 transition-all cursor-pointer shadow-lg">
                <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                <div className="mb-6 p-5 bg-amber-600/10 rounded-full group-hover:scale-110 group-hover:bg-amber-600/20 transition-all">
                  <Upload className="w-10 h-10 text-amber-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Upload File</h3>
                <p className="text-slate-500 text-sm">WAV, MP3, or M4A supported</p>
              </label>
            </div>
          </div>
        )}

        {state === AppState.RECORDING && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in zoom-in">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-600 rounded-full animate-ping opacity-25"></div>
              <div className="relative z-10 p-12 bg-amber-600 rounded-full shadow-2xl border-4 border-amber-400/20">
                <Mic className="w-16 h-16 text-white" />
              </div>
            </div>
            <div className="text-center">
              <h3 className="text-3xl font-bold text-white mb-2 uppercase tracking-tighter">Recording...</h3>
              <p className="text-4xl mono font-bold text-amber-500">{formatTime(recordingTime)}</p>
            </div>
            <button onClick={stopRecording} className="px-10 py-4 bg-white text-slate-950 rounded-full font-bold flex items-center gap-3 hover:bg-amber-500 hover:text-white transition-all">
              <Square className="w-5 h-5 fill-current" />
              Analyze Tab
            </button>
          </div>
        )}

        {state === AppState.PROCESSING && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in fade-in">
            <div className="relative w-32 h-32">
              <Loader2 className="w-32 h-32 text-amber-500 animate-spin stroke-[1]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Guitar className="w-12 h-12 text-white opacity-80" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-white">AI Engine Processing...</h3>
              <p className="text-slate-400 max-w-sm">Performing deep spectral analysis. This may take up to 30 seconds for complex audio.</p>
            </div>
            <div className="w-full max-w-sm h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
              <div className="h-full bg-amber-500 animate-[loading_2.5s_ease-in-out_infinite] w-1/4 rounded-full"></div>
            </div>
          </div>
        )}

        {state === AppState.RESULT && result && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-1000 pb-24">
            <TabRenderer data={result} originalAudioUrl={audioUrl} />
          </div>
        )}

        {state === AppState.ERROR && errorDetails && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-6 animate-in shake">
            <div className="p-6 bg-slate-900 rounded-full border border-slate-800 shadow-xl">
              {renderErrorIcon(errorDetails.code)}
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-white tracking-tight">Transcription Failed</h3>
              <p className="text-slate-400 max-w-md text-sm leading-relaxed">{errorDetails.message}</p>
              {errorDetails.code === 'QUOTA' && (
                <p className="text-amber-500/70 text-xs font-bold uppercase tracking-widest mt-2">API Cooling Down...</p>
              )}
            </div>
            <div className="flex gap-4">
              <button onClick={resetApp} className="px-8 py-3 bg-white text-slate-950 rounded-xl font-bold hover:bg-slate-200 transition-all shadow-lg">
                Try Different Audio
              </button>
              {errorDetails.code === 'QUOTA' && (
                <button onClick={() => { if(audioUrl) { /* Logic to re-process if possible */ } }} className="px-8 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 border border-slate-700 transition-all">
                  Retry Now
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-slate-900 w-full max-w-5xl flex flex-col md:flex-row items-center justify-between text-slate-500 text-xs py-8">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-600" />
          <p>© 2026 Tabify AI • Advanced Guitar Transcription Engine</p>
        </div>
      </footer>

      <style>{`
        @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
        .scrollbar-thin::-webkit-scrollbar { height: 8px; }
        .scrollbar-thumb-slate-700::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 10px; border: 2px solid #0f172a; }
        .scrollbar-track-transparent::-webkit-scrollbar-track { background-color: transparent; }
      `}</style>
    </div>
  );
};

export default App;
