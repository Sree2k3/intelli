import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Volume2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const StreamingVoiceAgent = ({ onComplete }: { onComplete: () => void }) => {
    const [status, setStatus] = useState<'listening' | 'thinking' | 'speaking' | 'idle'>('idle');
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

    // ── WebSocket Reconnection Logic ───────────────────────────────────────────
    const connectWS = useCallback(() => {
        setError(null);
        const voiceUrl = import.meta.env.VITE_VOICE_SERVER_URL || 'wss://aiinterviewtest.scaloz.com/voice';
        const ws = new WebSocket(voiceUrl);
        wsRef.current = ws;

        ws.onopen = () => console.log('[WS] Connected to Streaming Pipeline');
        ws.onclose = () => {
            console.log('[WS] Disconnected. Retrying in 2s...');
            setTimeout(connectWS, 2000);
        };
        ws.onerror = () => setError('WebSocket connection failed. Ensure server is running.');

        ws.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                const message = JSON.parse(event.data);
                if (message.type === 'transcript') {
                    setTranscript(message.data.text);
                } else if (message.type === 'interrupt') {
                    stopPlayback();
                } else if (message.type === 'status') {
                    setStatus(message.data);
                }
            } else {
                // Audio binary: Raw 16kHz Mono 16-bit PCM
                const arrayBuffer = await event.data.arrayBuffer();
                scheduleAudioBuffer(arrayBuffer);
            }
        };
    }, []);

    useEffect(() => {
        connectWS();
        return () => wsRef.current?.close();
    }, [connectWS]);

    // ── Progressive Playback Engine ──────────────────────────────────────────
    const scheduleAudioBuffer = (arrayBuffer: ArrayBuffer) => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        }

        const ctx = audioContextRef.current;
        const int16View = new Int16Array(arrayBuffer);
        const float32View = new Float32Array(int16View.length);
        for (let i = 0; i < int16View.length; i++) float32View[i] = int16View[i] / 32768;

        const buffer = ctx.createBuffer(1, float32View.length, 16000);
        buffer.getChannelData(0).set(float32View);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + buffer.duration;
        activeSourcesRef.current.push(source);

        source.onended = () => {
            activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
            if (activeSourcesRef.current.length === 0) setStatus('idle');
        };
    };

    const stopPlayback = () => {
        activeSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
        activeSourcesRef.current = [];
        nextStartTimeRef.current = 0;
    };

    // ── Audio Capture System ──────────────────────────────────────────────────
    const startCapture = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 16000 });

            const ctx = audioContextRef.current;
            const source = ctx.createMediaStreamSource(stream);
            const processor = ctx.createScriptProcessor(4096, 1, 1);

            // Interruption handling: Tell server to kill current output
            wsRef.current?.send(JSON.stringify({ type: 'interrupt' }));
            stopPlayback();

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Data = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16Data[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                }
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(int16Data.buffer);
                }
            };

            source.connect(processor);
            processor.connect(ctx.destination);
            (window as any)._audioStream = stream; // Keep alive
            setIsListening(true);
            setStatus('listening');
        } catch (err) {
            setError('Microphone access denied.');
        }
    };

    const stopCapture = () => {
        const stream = (window as any)._audioStream;
        stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        setIsListening(false);
        setStatus('idle');
    };

    return (
        <div className="card-elevated rounded-md border border-white/10 bg-zinc-950/20 p-12 w-full max-w-4xl shadow-2xl h-[600px] flex flex-col items-center justify-center relative overflow-hidden backdrop-blur-xl">
            {/* Visualizer Background */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                {isListening && <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 to-transparent animate-pulse" />}
            </div>

            <div className="relative mb-14">
                {isListening && (
                    <div className="absolute inset-[-40px] rounded-full border-2 border-cyan-500/10 animate-[ping_3s_infinite]" />
                )}
                <button
                    onClick={() => isListening ? stopCapture() : startCapture()}
                    className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl ${isListening ? 'bg-red-500 shadow-red-500/40 ring-4 ring-red-500/20' : 'bg-cyan-500 shadow-cyan-500/40 hover:scale-105'}`}
                >
                    {isListening ? <MicOff className="h-10 w-10 text-white" /> : <Mic className="h-10 w-10 text-white" />}
                </button>
            </div>

            <div className="text-center w-full max-w-lg space-y-6">
                <div className="flex items-center justify-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${status === 'listening' ? 'bg-cyan-400 animate-pulse' : status === 'thinking' ? 'bg-amber-400 animate-bounce' : status === 'speaking' ? 'bg-emerald-400 animate-ping' : 'bg-white/20'}`} />
                    <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-white/40">
                        {status === 'listening' ? 'User Speaking' : status === 'thinking' ? 'AI Thinking' : status === 'speaking' ? 'AI Responding' : 'System Ready'}
                    </p>
                </div>

                <div className="h-[120px] bg-white/5 rounded-md border border-white/5 flex items-center justify-center p-8 transition-all relative group">
                    <p className={`text-xl font-medium leading-relaxed transition-all duration-500 ${isListening ? 'text-white' : 'text-white/40 italic'}`}>
                        {transcript || (isListening ? 'Speak naturally...' : 'Tap to start a real-time conversation')}
                    </p>
                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/90 rounded-md border border-red-500/50 p-4">
                            <div className="flex items-center gap-2 text-red-500">
                                <AlertCircle className="h-5 w-5" />
                                <span className="text-xs font-bold">{error}</span>
                                <Button size="sm" variant="ghost" onClick={connectWS} className="h-8">
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-14 flex items-center gap-6 opacity-20 hover:opacity-50 transition-opacity">
                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /><span className="text-[9px] font-bold tracking-widest text-white">LOW LATENCY</span></div>
                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-[9px] font-bold tracking-widest text-white">STREAMING TTS</span></div>
                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-[9px] font-bold tracking-widest text-white">VOICE TURNOVER</span></div>
            </div>
        </div>
    );
};
