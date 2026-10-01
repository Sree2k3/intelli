/**
 * src/lib/interviewAudioBus.ts
 *
 * Unified Web Audio Bus for Interviews.
 *
 * Solves the critical issue where candidates wearing earphones/headphones
 * hear the AI interviewer, but the AI audio is missing from the recorded video.
 *
 * Routing:
 * 1. AI Voice (TTS audio) -> audioContext.destination (candidate's earphones/speakers)
 *                         -> recordingDestination (mixed into MediaRecorder track)
 * 2. Candidate Microphone -> recordingDestination only (mixed into MediaRecorder track,
 *                            never echoed back into candidate's earphones)
 * 3. Fallback: window.speechSynthesis if network or TTS fails.
 */

import { synthesizeSpeechAudio } from "./api";

class InterviewAudioBus {
  private audioContext: AudioContext | null = null;
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private currentBufferSource: AudioBufferSourceNode | null = null;
  private activeElementSource: MediaElementAudioSourceNode | null = null;
  private isSpeaking = false;
  private audioCache = new Map<string, ArrayBuffer>();
  private activeAbortController: AbortController | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      const unlock = () => {
        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {});
        }
      };
      window.addEventListener("click", unlock, { passive: true });
      window.addEventListener("keydown", unlock, { passive: true });
      window.addEventListener("touchstart", unlock, { passive: true });
    }
  }

  /** Get or initialize the shared AudioContext */
  public getAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  /** Get or initialize the shared MediaStreamAudioDestinationNode */
  public getRecordingDestination(): MediaStreamAudioDestinationNode {
    const ctx = this.getAudioContext();
    if (!this.recordingDestination) {
      this.recordingDestination = ctx.createMediaStreamDestination();
    }
    return this.recordingDestination;
  }

  /** Returns the audio tracks intended for MediaRecorder */
  public getRecordingAudioTracks(): MediaStreamTrack[] {
    const dest = this.getRecordingDestination();
    return dest.stream.getAudioTracks();
  }

  /** Connect candidate microphone stream to the recording destination only */
  public connectMicStream(micStream: MediaStream) {
    try {
      const ctx = this.getAudioContext();
      const dest = this.getRecordingDestination();

      if (this.micSourceNode) {
        try {
          this.micSourceNode.disconnect();
        } catch (_) {}
      }

      if (micStream && micStream.getAudioTracks().length > 0) {
        this.micSourceNode = ctx.createMediaStreamSource(micStream);
        // Connect ONLY to recordingDestination, NOT ctx.destination (avoids candidate hearing echo of themselves)
        this.micSourceNode.connect(dest);
        console.log("[InterviewAudioBus] Mic stream successfully connected to recording destination.");
      }
    } catch (err) {
      console.warn("[InterviewAudioBus] Failed to connect mic stream:", err);
    }
  }

  /** Connect an HTMLMediaElement (like <audio id="ai-voice">) to both earphones and recording destination */
  public connectMediaElement(element: HTMLMediaElement) {
    if (!element) return;
    try {
      const ctx = this.getAudioContext();
      const dest = this.getRecordingDestination();

      if ((element as any).__connectedToAudioBus) {
        return;
      }

      const source = ctx.createMediaElementSource(element);
      source.connect(dest); // Record to video
      source.connect(ctx.destination); // Play to earphones
      (element as any).__connectedToAudioBus = true;
      this.activeElementSource = source;
      console.log("[InterviewAudioBus] HTMLMediaElement connected to earphones and recording destination.");
    } catch (err) {
      console.warn("[InterviewAudioBus] connectMediaElement skipped or already bound:", err);
    }
  }

  /** Clean text before TTS */
  private cleanText(text: string): string {
    return text
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/#/g, "")
      .trim();
  }

  /** Prefetch audio for anticipated text to eliminate latency */
  public async prefetch(text: string, voice?: string): Promise<void> {
    const clean = this.cleanText(text);
    if (!clean || this.audioCache.has(clean)) return;

    try {
      const buffer = await synthesizeSpeechAudio(clean, voice);
      if (buffer && buffer.byteLength > 0) {
        if (this.audioCache.size > 50) {
          const firstKey = this.audioCache.keys().next().value;
          if (firstKey) this.audioCache.delete(firstKey);
        }
        this.audioCache.set(clean, buffer);
      }
    } catch (_) {
      // Silent fail on prefetch; will retry on actual speak
    }
  }

  /**
   * Speak text:
   * 1. Fetches TTS audio from backend (Deepgram Aura / OpenAI)
   * 2. Decodes via Web Audio
   * 3. Plays to earphones AND mixes into recordingDestination simultaneously
   * 4. Gracefully falls back to window.speechSynthesis if offline/error
   */
  public async speak(
    text: string,
    options?: {
      voice?: string;
      onStart?: () => void;
      onEnd?: () => void;
      priority?: boolean;
    }
  ): Promise<void> {
    this.stopSpeaking();

    const clean = this.cleanText(text);
    if (!clean) {
      options?.onEnd?.();
      return;
    }

    const ctx = this.getAudioContext();
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    this.isSpeaking = true;
    options?.onStart?.();

    const controller = new AbortController();
    this.activeAbortController = controller;

    try {
      // 1. Check prefetch cache or fetch from backend TTS
      let arrayBuffer = this.audioCache.get(clean);
      if (!arrayBuffer) {
        arrayBuffer = await synthesizeSpeechAudio(clean, options?.voice, controller.signal);
        this.audioCache.set(clean, arrayBuffer);
      }

      if (controller.signal.aborted) return;

      // 2. Decode audio data into AudioBuffer
      // Clone arrayBuffer because decodeAudioData detaches the underlying buffer in some engines
      const bufferToDecode = arrayBuffer.slice(0);
      const audioBuffer = await ctx.decodeAudioData(bufferToDecode);

      if (controller.signal.aborted) return;

      // 3. Play via Web Audio buffer source
      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        const dest = this.getRecordingDestination();
        // Send to BOTH headphones and the recording pipeline!
        source.connect(ctx.destination);
        source.connect(dest);

        this.currentBufferSource = source;

        source.onended = () => {
          if (this.currentBufferSource === source) {
            this.currentBufferSource = null;
          }
          resolve();
        };

        source.start(0);
      });

      this.isSpeaking = false;
      options?.onEnd?.();
    } catch (err: any) {
      if (controller.signal.aborted) {
        this.isSpeaking = false;
        return;
      }

      console.warn("[InterviewAudioBus] Backend TTS failed or unavailable, falling back to browser SpeechSynthesis:", err);
      // 4. Fallback to SpeechSynthesis
      await this.speakViaSpeechSynthesis(clean, options);
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
    }
  }

  /** Browser SpeechSynthesis fallback */
  private speakViaSpeechSynthesis(
    clean: string,
    options?: { onStart?: () => void; onEnd?: () => void }
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        this.isSpeaking = false;
        options?.onEnd?.();
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utt = new SpeechSynthesisUtterance(clean);
      utt.rate = 0.95;
      utt.pitch = 1.02;

      const voices = window.speechSynthesis.getVoices();
      const localFemale = voices.find(
        (v) =>
          v.localService &&
          v.lang.startsWith("en") &&
          (v.name.includes("Zira") || v.name.includes("Hazel") || v.name.includes("Female"))
      );
      if (localFemale) utt.voice = localFemale;

      let ended = false;
      const finish = () => {
        if (!ended) {
          ended = true;
          this.isSpeaking = false;
          options?.onEnd?.();
          resolve();
        }
      };

      utt.onstart = () => {
        this.isSpeaking = true;
      };
      utt.onend = finish;
      utt.onerror = finish;

      // Safety timeout
      const timeoutMs = Math.min(60000, Math.max(10000, clean.length * 60 + 5000));
      setTimeout(finish, timeoutMs);

      try {
        window.speechSynthesis.speak(utt);
      } catch (_) {
        finish();
      }
    });
  }

  /** Immediately stop any active speech */
  public stopSpeaking() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.stop(0);
        this.currentBufferSource.disconnect();
      } catch (_) {}
      this.currentBufferSource = null;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }

    this.isSpeaking = false;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /** Tear down audio resources on complete session exit */
  public cleanup() {
    this.stopSpeaking();
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (_) {}
      this.micSourceNode = null;
    }
  }
}

export const interviewAudioBus = new InterviewAudioBus();
export default interviewAudioBus;
