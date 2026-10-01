/**
 * Proctoring v2.0 — Enterprise Grade Core Logic
 * - EMA Smoothing (High-Stability Tracking)
 * - Suspicion Signal Aggregator
 * - Telemetry Logging
 */

export interface TelemetryEvent {
  timestamp: number;
  type: "vision" | "audio" | "object";
  label: string;
  confidence: number;
  metadata?: any;
}

/**
 * Exponential Moving Average (EMA) for signal smoothing.
 * Prevents jitter in gaze/face tracking.
 */
export class EMASmoother {
  private previousValue: number | null = null;
  private alpha: number;

  constructor(alpha: number = 0.3) {
    this.alpha = alpha;
  }

  smooth(current: number): number {
    if (this.previousValue === null) {
      this.previousValue = current;
      return current;
    }
    const smoothed = this.alpha * current + (1 - this.alpha) * this.previousValue;
    this.previousValue = smoothed;
    return smoothed;
  }

  reset() {
    this.previousValue = null;
  }
}

/**
 * Enterprise Telemetry Logger
 * Syncs with video timestamps for forensic review.
 */
export class TelemetryLogger {
  private logs: TelemetryEvent[] = [];
  private interviewId: string;

  constructor(interviewId: string) {
    this.interviewId = interviewId;
  }

  log(event: Omit<TelemetryEvent, "timestamp">) {
    const logEvent: TelemetryEvent = {
      ...event,
      timestamp: Date.now(),
    };
    this.logs.push(logEvent);
    console.debug(`[Telemetry] ${logEvent.label} (${logEvent.confidence.toFixed(2)})`);
  }

  getLogs() {
    return [...this.logs];
  }

  async flush() {
    // In a real system, you'd send this to the backend as a JSON file
    const data = JSON.stringify(this.logs, null, 2);
    // Placeholder for future API upload: await uploadTelemetry(this.interviewId, data);
    this.logs = [];
    return data;
  }
}
