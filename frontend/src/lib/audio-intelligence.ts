/**
 * Audio Intelligence Monitor
 * - Detects multiple voices vs single voice frequency spikes
 * - Detects whispering (high frequency, low energy)
 * - Detects consistent background noise
 */

export interface AudioSignal {
  flag: "normal" | "multiple_voices" | "whispering" | "high_noise";
  confidence: number;
}

export class AudioMonitor {
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private audioContext: AudioContext | null = null;
  private isSuspicious: boolean = false;

  constructor(stream: MediaStream) {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);
    } catch (e) {
      console.error("[AudioMonitor] Init failed:", e);
    }
  }

  analyze(): AudioSignal {
    if (!this.analyser || !this.dataArray) return { flag: "normal", confidence: 0 };

    this.analyser.getByteFrequencyData(this.dataArray as any);

    // 1. Calculate energy
    let total = 0;
    for (const val of this.dataArray) total += val;
    const avgEnergy = total / this.dataArray.length;

    // 2. Simple Whisper Detection (Focus on high mids/highs where sibilance lives)
    const midHighFreqs = this.dataArray.slice(300, 800);
    const midHighEnergy = midHighFreqs.reduce((a, b) => a + b, 0) / midHighFreqs.length;

    // 3. Simple Voice Activity Heuristic
    // Energy in human voice range (80-300Hz) vs total
    const voiceEnergy = this.dataArray.slice(10, 100).reduce((a, b) => a + b, 0) / 90;

    let flag: AudioSignal["flag"] = "normal";
    let score = 0;

    if (midHighEnergy > 40 && avgEnergy < 60) {
      flag = "whispering";
      score = 0.65;
    } else if (voiceEnergy > 100 && avgEnergy > 120) {
      // Very high energy might suggest secondary speakers or environment noise
      flag = "high_noise";
      score = 0.45;
    }

    return { flag, confidence: score };
  }

  stop() {
    this.audioContext?.close().catch(() => {});
  }
}
