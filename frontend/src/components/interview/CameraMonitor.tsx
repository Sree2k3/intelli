import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Video, VideoOff, GripHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TelemetryLogger, EMASmoother } from "@/lib/proctoring-v2";
import { AudioMonitor } from "@/lib/audio-intelligence";
import { getPartPresignedUrl, completeMultipartUpload } from "@/lib/api";
import { decryptPayload } from "@/lib/encryption";
import { interviewAudioBus } from "@/lib/interviewAudioBus";
import ProctorWorker from "../../proctor.worker?worker";
import { useGazeDetection } from "@/hooks/useGazeDetection";

export interface CameraMonitorHandle {
  /** Flush final chunk, upload all parts, finalize with S3. Resolves when done. */
  stopAndFinalize: () => Promise<void>;
  stopProctoring: () => void;
}

interface Props {
  interviewId: string;
  inviteToken: string;
  isRecording: boolean;
  onViolation: (msg: string) => void;
  onUploadComplete?: () => void;
  initialStrikes?: { mobile: number; multi_person: number; gaze: number };
  saveVideoRecording?: boolean;
  showCandidateVideo?: boolean;
  proctoringEnabled?: boolean;
  proctoringMaxStrikes?: number;
  proctoringMaxStrikesAction?: string;
}

const CameraMonitor = forwardRef<CameraMonitorHandle, Props>(function CameraMonitor(
  { 
    interviewId, 
    inviteToken, 
    isRecording, 
    onViolation, 
    onUploadComplete, 
    initialStrikes, 
    saveVideoRecording = false, 
    showCandidateVideo = true,
    proctoringEnabled = true,
    proctoringMaxStrikes = 3,
    proctoringMaxStrikesAction = "flag_review"
  },
  ref
) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const partNumberRef = useRef(1);  // Start from part 1 for multipart upload
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gazeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // ── AWS S3 Multipart Upload Tracking ───────────────────────────────────────
  const uploadIdRef = useRef<string | null>(null);
  const uploadedPartsRef = useRef<Array<{ PartNumber: number; ETag: string }>>([]);
  const pendingUploadsRef = useRef<Promise<void>[]>([]);
  const uploadInitializedRef = useRef(false);
  // Flag: stopAndFinalize() has taken over — the isRecording effect must stand down
  const isFinalizingRef = useRef(false);
  const startRecordingSessionRef = useRef<() => Promise<void>>();
  
  // ── 5MB Buffer for AWS EntityTooSmall Compliance ──────────────────────────
  const chunkBufferRef = useRef<Blob[]>([]);
  const currentBufferSizeRef = useRef(0);
  const recordingStartTimeRef = useRef<number | null>(null);
  const MIN_PART_SIZE = 5 * 1024 * 1024; // AWS requirement: parts must be >= 5MB

  // V2.0 Modular refs
  const workerRef = useRef<Worker | null>(null);
  const audioMonitorRef = useRef<AudioMonitor | null>(null);
  const telemetryRef = useRef<TelemetryLogger>(new TelemetryLogger(interviewId));
  const smootherRef = useRef(new EMASmoother(0.4));
  const consecutiveObjectsRef = useRef<Record<string, number>>({});
  const [activeDetections, setActiveDetections] = useState<Array<{type: string, model: string}>>([]);
  const [mobileStrikes, setMobileStrikes] = useState(initialStrikes?.mobile || 0);
  const [multiPersonStrikes, setMultiPersonStrikes] = useState(initialStrikes?.multi_person || 0);
  const [backendStrikes, setBackendStrikes] = useState(0);

  // Reference to track previous total strike count for screenshot triggers
  const prevStrikesRef = useRef({ mobile: (initialStrikes?.mobile || 0), multi: (initialStrikes?.multi_person || 0), gaze: (initialStrikes?.gaze || 0) });

  // Strike cooldown references to prevent cascading false strikes
  const lastMultiPersonStrikeTimeRef = useRef<number>(0);
  const lastMobileStrikeTimeRef = useRef<number>(0);
  const lastScreenshotTimeRef = useRef<number>(0);
  const strikesLimitNotifiedRef = useRef<boolean>(false);

  // ── YOLO Throttling & Abort Control ────────────────────────────────────────
  const isProcessingYoloRef = useRef(false);
  const yoloAbortControllerRef = useRef<AbortController | null>(null);
  const isInterviewActiveRef = useRef(true);

  // ── Gaze Detection Hook ────────────────────────────────────────────────────
  const { gazeState, detectGaze, setGazeStrikeCount } = useGazeDetection({
    interviewId,
    initialStrikes: initialStrikes?.gaze,
    proctoringMaxStrikes,
    enabled: proctoringEnabled,
    onLookAway: (count) => {
      telemetryRef.current.log({
        type: "vision",
        label: "eye_look_away",
        confidence: 1.0,
        metadata: { strikeCount: count }
      });
    },
    onCheatingFlag: () => {
      handleViolation(`Suspicious eye movement pattern detected (${proctoringMaxStrikes} strikes).`, { gaze: proctoringMaxStrikes });
    }
  });

  const detectGazeRef = useRef(detectGaze);
  useEffect(() => {
    detectGazeRef.current = detectGaze;
  }, [detectGaze]);

  // Reference to track latest strikes for immediate sync during termination
  const latestStrikesRef = useRef({ mobile: mobileStrikes, multi: multiPersonStrikes, gaze: gazeState.strikeCount, backend: backendStrikes });
  
  useEffect(() => {
    latestStrikesRef.current = { mobile: mobileStrikes, multi: multiPersonStrikes, gaze: gazeState.strikeCount, backend: backendStrikes };
  }, [mobileStrikes, multiPersonStrikes, gazeState.strikeCount, backendStrikes]);

  const currentStatusRef = useRef({
    gaze: gazeState.gaze,
    status: gazeState.status,
    strikes: Math.min(proctoringMaxStrikes, Math.max(backendStrikes, gazeState.strikeCount + mobileStrikes + multiPersonStrikes))
  });
  useEffect(() => {
    currentStatusRef.current = {
      gaze: gazeState.gaze,
      status: gazeState.status,
      strikes: Math.min(proctoringMaxStrikes, Math.max(backendStrikes, gazeState.strikeCount + mobileStrikes + multiPersonStrikes))
    };
  }, [gazeState, mobileStrikes, multiPersonStrikes, backendStrikes, proctoringMaxStrikes]);

  const captureScreenshot = useCallback(async (reason: string, force: boolean = false): Promise<void> => {
    const now = Date.now();
    if (!force && (now - lastScreenshotTimeRef.current < 3000)) {
      return;
    }
    lastScreenshotTimeRef.current = now;

    return new Promise((resolve) => {
      if (videoRef.current) {
        const video = videoRef.current;
        const targetW = video.videoWidth || 640;
        const targetH = video.videoHeight || 480;
        
        if (targetW && targetH) {
          const snapshotCanvas = document.createElement("canvas");
          snapshotCanvas.width = targetW;
          snapshotCanvas.height = targetH;
          const context = snapshotCanvas.getContext("2d", { willReadFrequently: true });
          
          if (context) {
            context.drawImage(video, 0, 0, targetW, targetH);
            snapshotCanvas.toBlob(async (blob) => {
              if (blob) {
                const formData = new FormData();
                formData.append("file", blob, "screenshot.jpg");
                formData.append("timestamp", new Date().toISOString());
                formData.append("reason", reason);
                try {
                  const apiUrl = import.meta.env.VITE_API_BASE_URL || "";
                  const uploadRes = await fetch(`${apiUrl}/rest/v1/interviews/by-token/${inviteToken}/upload-screenshot`, {
                    method: "POST",
                    body: formData
                  });
                  if (uploadRes.ok) {
                    console.log(`[Screenshot] Uploaded violation screenshot successfully (${reason}).`);
                  } else {
                    console.error("[Screenshot] Upload failed:", uploadRes.status);
                  }
                } catch (err) {
                  console.error("[Screenshot] Upload failed:", err);
                }
              }
              resolve();
            }, "image/jpeg", 0.85);
            return;
          }
        }
      }
      resolve();
    });
  }, [inviteToken]);

  const handleViolation = useCallback(async (msg: string, finalOverrides?: { multi?: number, mobile?: number, gaze?: number }) => {
    if (interviewId && inviteToken) {
      try {
        await fetch(`${import.meta.env.VITE_API_BASE_URL || ""}/rest/v1/interviews/by-token/${inviteToken}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-invite-token": inviteToken },
          body: JSON.stringify({
            proctoring_strikes: {
              mobile: finalOverrides?.mobile ?? latestStrikesRef.current.mobile,
              multi_person: finalOverrides?.multi ?? latestStrikesRef.current.multi,
              gaze: finalOverrides?.gaze ?? latestStrikesRef.current.gaze,
              backend: latestStrikesRef.current.backend
            }
          })
        });
      } catch (e) {
        console.error("[Strikes] Sync before termination failed:", e);
      }
    }
    
    await captureScreenshot(msg);
    onViolation(msg);
  }, [captureScreenshot, onViolation, interviewId, inviteToken]);

  // Sync strikes to backend when they change & capture violation screenshot
  useEffect(() => {
    if (!proctoringEnabled) return;
    if (interviewId && inviteToken) {
      const syncStrikes = async () => {
        try {
          await fetch(`${import.meta.env.VITE_API_BASE_URL || ""}/rest/v1/interviews/by-token/${inviteToken}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-invite-token": inviteToken },
            body: JSON.stringify({
              proctoring_strikes: {
                mobile: mobileStrikes,
                multi_person: multiPersonStrikes,
                gaze: gazeState.strikeCount,
                backend: backendStrikes
              }
            })
          });
        } catch (e) {
          console.error("[Strikes] Sync failed:", e);
        }
      };
      syncStrikes();

      // Trigger screenshot capture and upload if total strikes increased
      const totalStrikes = mobileStrikes + multiPersonStrikes + gazeState.strikeCount;
      const prevTotal = prevStrikesRef.current.mobile + prevStrikesRef.current.multi + prevStrikesRef.current.gaze;
      
      if (totalStrikes > prevTotal) {
        let reason = "Proctoring Violation";
        if (mobileStrikes > prevStrikesRef.current.mobile) reason = "Mobile Device Detected";
        else if (multiPersonStrikes > prevStrikesRef.current.multi) reason = "Multiple Persons Detected";
        else if (gazeState.strikeCount > prevStrikesRef.current.gaze) reason = "Suspicious Eye Movement";
        
        // Fire and forget (don't await here so we don't block the effect)
        captureScreenshot(reason);
      }
      prevStrikesRef.current = { mobile: mobileStrikes, multi: multiPersonStrikes, gaze: gazeState.strikeCount };
    }
  }, [mobileStrikes, multiPersonStrikes, gazeState.strikeCount, backendStrikes, interviewId, inviteToken, proctoringEnabled]);

  const [statusMsg, setStatusMsg] = useState("Initializing camera...");
  const [violationMsg, setViolationMsg] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<"normal" | "warning" | "final_warning">("normal");
  
  const stopProctoring = useCallback(() => {
    isInterviewActiveRef.current = false;
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (gazeIntervalRef.current) {
      clearInterval(gazeIntervalRef.current);
      gazeIntervalRef.current = null;
    }
    if (yoloAbortControllerRef.current) {
      yoloAbortControllerRef.current.abort();
      yoloAbortControllerRef.current = null;
    }
  }, []);

  const stopTracksAndWS = useCallback(() => {
    stopProctoring();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioMonitorRef.current) {
      audioMonitorRef.current.stop();
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    interviewAudioBus.cleanup();
  }, [stopProctoring]);

  // ── Imperative handle: strict Promise that resolves ONLY after backend confirms ──
  useImperativeHandle(ref, () => ({
    stopProctoring,
    stopAndFinalize: (): Promise<void> => {
      isFinalizingRef.current = true;
      
      // Instantly kill AI Proctoring loops to prevent further strikes and 403 spam
      stopProctoring();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === "inactive") {
        console.warn("[CameraMonitor] stopAndFinalize: recorder inactive.");
        if (onUploadComplete) onUploadComplete();
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        console.log("[CameraMonitor] stopAndFinalize: starting controlled finalization...");

        // 1. Immediately abort any pending YOLO calls
        if (yoloAbortControllerRef.current) {
          yoloAbortControllerRef.current.abort();
          yoloAbortControllerRef.current = null;
        }

        const originalOnData = mr.ondataavailable;
        mr.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) {
            chunkBufferRef.current.push(e.data);
            currentBufferSizeRef.current += e.data.size;
            console.log(`[S3/Final] Buffered fragment: ${e.data.size} bytes. Total: ${currentBufferSizeRef.current}`);
          }
        };

        mr.onstop = async () => {
          console.log("[CameraMonitor] onstop: final data processing...");
          try {
            // 1. Combine everything in the buffer
            if (chunkBufferRef.current.length > 0) {
              let finalBlob = new Blob(chunkBufferRef.current, { type: "video/webm" });
              if (recordingStartTimeRef.current) {
                const durationMs = Date.now() - recordingStartTimeRef.current;
                if (durationMs > 1000) {
                  try {
                    const fixWebmDuration = (await import("fix-webm-duration")).default;
                    finalBlob = await fixWebmDuration(finalBlob, durationMs);
                    console.log(`[CameraMonitor] Injected WebM duration: ${(durationMs / 1000).toFixed(1)}s`);
                  } catch (fixErr) {
                    console.warn("[CameraMonitor] Client WebM duration injection skipped:", fixErr);
                  }
                }
              }
              
              if (!saveVideoRecording) {
                // BYPASS ALL VIDEO STORAGE FLOWS
                console.log("[CameraMonitor] Video recording is disabled. Discarding video fragments.");
                toast({ title: "Session Completed", description: "Interview completed. Video recording discarded as per settings." });
              } else if (uploadIdRef.current && uploadIdRef.current !== "DISABLED") {
                // S3 MULTIPART FLOW
                const currentPartNumber = partNumberRef.current++;
                console.log(`[S3/Final] Uploading last part ${currentPartNumber} (${(finalBlob.size / 1024).toFixed(1)} KB)`);
                
                const p = (async () => {
                  try {
                    const { url } = await getPartPresignedUrl(inviteToken, currentPartNumber);
                    const res = await fetch(url, {
                      method: "PUT", body: finalBlob,
                      headers: { "Content-Type": "video/webm" },
                    });
                    if (!res.ok) throw new Error(`S3 PUT ${res.status}`);
                    const eTag = res.headers.get("ETag");
                    if (eTag) uploadedPartsRef.current.push({ PartNumber: currentPartNumber, ETag: eTag });
                  } catch (err) { console.error(`[S3/Final] part ${currentPartNumber} failed:`, err); }
                })();
                pendingUploadsRef.current.push(p);

                await Promise.all(pendingUploadsRef.current);
                const sortedParts = [...uploadedPartsRef.current].sort((a, b) => a.PartNumber - b.PartNumber);
                
                console.log(`[CameraMonitor] Finalizing S3 upload with ${sortedParts.length} parts...`);
                const timeout = new Promise<never>((_, r) =>
                  setTimeout(() => r(new Error("complete-upload timed out")), 45_000)
                );
                await Promise.race([
                  completeMultipartUpload(inviteToken, sortedParts, uploadIdRef.current),
                  timeout,
                ]);
                toast({ title: "Video Saved", description: "Interview recording saved to S3." });
              } else {
                // LOCAL FALLBACK FLOW
                console.log(`[CameraMonitor] Local mode: Uploading entire recording (${(finalBlob.size / 1024).toFixed(1)} KB)`);
                const formData = new FormData();
                formData.append("video", finalBlob, "recording.webm");
                formData.append("interview_id", interviewId);

                const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";
                const res = await fetch(`${apiUrl}/rest/v1/interviews/by-token/${inviteToken}/upload-video`, {
                  method: "POST",
                  body: formData,
                  headers: {
                    "x-invite-token": inviteToken
                  }
                });

                if (!res.ok) throw new Error(`Local upload failed: ${res.status}`);
                const result = await res.json();
                console.log("[CameraMonitor] Local upload SUCCESS:", result);
                toast({ title: "Video Saved", description: "Interview recording saved locally." });
              }
              
              // Clear buffer only after success
              chunkBufferRef.current = [];
              currentBufferSizeRef.current = 0;
            } else {
              console.warn("[CameraMonitor] No data recorded to upload.");
            }

            if (onUploadComplete) onUploadComplete();
            resolve();
          } catch (err: any) {
            console.error("[CameraMonitor] Finalization error:", err);
            toast({ title: "Upload Error", description: "Could not save video recording.", variant: "destructive" });
            if (onUploadComplete) onUploadComplete();
            reject(err);
          } finally {
            stopTracksAndWS();
          }
        };

        console.log("[CameraMonitor] Calling requestData() to flush final buffer...");
        try { mr.requestData(); } catch (_) {}
        setTimeout(() => {
          console.log("[CameraMonitor] Calling mr.stop()...");
          try { mr.stop(); } catch (_) {}
        }, 250);
      });
    },
  }), [inviteToken, onUploadComplete, stopTracksAndWS]);

  useEffect(() => {
    const isCameraNeeded = Boolean(saveVideoRecording || showCandidateVideo || proctoringEnabled);

    if (!isCameraNeeded) {
      console.log("[CameraMonitor] Video recording, candidate live video, and AI proctoring are all disabled. Camera hardware will not be accessed.");
      setStatusMsg("Camera not required");
      return;
    }

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } }, 
          audio: true 
        });
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (proctoringEnabled) {
          audioMonitorRef.current = new AudioMonitor(stream);
          const worker = new ProctorWorker();
          workerRef.current = worker;
          worker.postMessage({ type: "init" });
          
          worker.onmessage = (event) => {
            if (event.data.type === "result") {
              const { object } = event.data.data;
              let foundMobile = false;
              if (object) {
                const label = object.label.toLowerCase();
                if (label.includes("phone") || label.includes("cellular") || label.includes("handheld")) {
                  foundMobile = true;
                  consecutiveObjectsRef.current["mobile_phone"] = (consecutiveObjectsRef.current["mobile_phone"] || 0) + 1;
                  
                  if (consecutiveObjectsRef.current["mobile_phone"] >= 2) {
                    setMobileStrikes(prev => {
                      if (prev >= proctoringMaxStrikes) return prev;
                      const nextCount = prev + 1;
                      setTimeout(() => {
                        if (nextCount < proctoringMaxStrikes) {
                          if (nextCount === proctoringMaxStrikes - 1) {
                            toast({ title: "Final Warning", description: proctoringMaxStrikesAction === "auto_terminate" ? "Another detection will terminate." : "Another detection will trigger review flag.", variant: "destructive" });
                          } else {
                            toast({ title: "Warning", description: "Mobile device detected!", variant: "destructive" });
                          }
                        } else if (nextCount >= proctoringMaxStrikes) {
                          if (proctoringMaxStrikesAction === "auto_terminate") {
                            handleViolation(`Multiple mobile phone violations detected (${proctoringMaxStrikes} strikes).`, { mobile: nextCount });
                          } else {
                            toast({ title: "Strikes Exceeded", description: `Strikes limit reached (${proctoringMaxStrikes} strikes). Incident logged.`, variant: "destructive" });
                          }
                        }
                      }, 0);
                      return nextCount;
                    });
                    consecutiveObjectsRef.current["mobile_phone"] = 0;
                  }
                }
              }
              if (!foundMobile) {
                consecutiveObjectsRef.current["mobile_phone"] = Math.max(0, (consecutiveObjectsRef.current["mobile_phone"] || 0) - 1);
              }
              setActiveDetections(prev => {
                const others = prev.filter(p => p.model !== "MobileNet");
                return foundMobile ? [...others, { type: "Mobile Phone", model: "MobileNet" }] : others;
              });
            }
          };
        }

        // Route candidate mic and AI speech into the unified recording bus
        interviewAudioBus.connectMicStream(stream);

        const aiAudioEl = document.getElementById("ai-voice") as HTMLMediaElement;
        if (aiAudioEl) {
          interviewAudioBus.connectMediaElement(aiAudioEl);
        }

        const combinedStream = new MediaStream([
          ...stream.getVideoTracks(),
          ...interviewAudioBus.getRecordingAudioTracks()
        ]);

        const getRecorderOptions = (): MediaRecorderOptions => {
          const candidates: string[] = [
            "video/webm;codecs=vp8,opus",
            "video/webm",
          ];
          for (const mimeType of candidates) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
               return { mimeType, videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 };
            }
          }
          return {};
        };

        const recorderOptions = getRecorderOptions();
        const mr = new MediaRecorder(combinedStream, recorderOptions);
        mediaRecorderRef.current = mr;

        const startRecordingSession = async () => {
          if (mr.state !== "inactive") return;
          try {
            const { initiateMultipartUpload } = await import("@/lib/api");
            const { upload_id } = await initiateMultipartUpload(inviteToken);
            uploadIdRef.current = upload_id;
            uploadInitializedRef.current = true;
            isFinalizingRef.current = false;
            uploadedPartsRef.current = [];
            pendingUploadsRef.current = [];
            partNumberRef.current = 1;
            chunkBufferRef.current = [];
            currentBufferSizeRef.current = 0;
            recordingStartTimeRef.current = Date.now();
            mr.start(10_000);
          } catch (err) {
            console.error("[CameraMonitor] Failed to start recording session:", err);
          }
        };
        (startRecordingSessionRef as any).current = startRecordingSession;

        mr.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0) {
            chunkBufferRef.current.push(e.data);
            currentBufferSizeRef.current += e.data.size;

            // Only do multipart chunks if S3 is enabled
            if (uploadIdRef.current !== "DISABLED" && currentBufferSizeRef.current >= MIN_PART_SIZE) {
              const blobToUpload = new Blob(chunkBufferRef.current, { type: "video/webm" });
              chunkBufferRef.current = [];
              currentBufferSizeRef.current = 0;

              const currentPartNumber = partNumberRef.current++;
              const uploadPromise = (async () => {
                try {
                  const { url } = await getPartPresignedUrl(inviteToken, currentPartNumber);
                  const uploadRes = await fetch(url, { method: "PUT", body: blobToUpload, headers: { "Content-Type": "video/webm" } });
                  const eTag = uploadRes.headers.get("ETag");
                  if (eTag) uploadedPartsRef.current.push({ PartNumber: currentPartNumber, ETag: eTag });
                } catch (err) { console.error(`[S3/Chunk] Part ${currentPartNumber} upload failed:`, err); }
              })();
              pendingUploadsRef.current.push(uploadPromise);
            }
          }
        };

        mr.onstop = async () => { /* Logic already in stopAndFinalize handle */ };

        const detectObjectInBackend = async (base64Image: string) => {
          if (isProcessingYoloRef.current) return;
          isProcessingYoloRef.current = true;

          // Ensure we have a fresh AbortController
          if (!yoloAbortControllerRef.current) {
            yoloAbortControllerRef.current = new AbortController();
          }

          try {
            const formData = new FormData();
            formData.append("image", base64Image);
            const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";
            
            const response = await fetch(`${apiUrl}/detect-object`, { 
              method: "POST", 
              body: formData,
              signal: yoloAbortControllerRef.current.signal
            });

            if (!isInterviewActiveRef.current) {
              // The interview is over. Ignore this delayed network packet entirely.
              return; 
            }

            if (!response.ok) return;
            const raw = await response.json();
            const data = await decryptPayload(raw);
            const detections = data.detections || [];
            const currentLabels = detections.map((d: any) => d.label);
            const yoloActive = [];
            
            const personCount = currentLabels.filter((l: string) => l === "person").length;
            const cellPhoneCount = currentLabels.filter((l: string) => l === "cell phone" || l === "remote").length;
            
            if (personCount > 1) {
              yoloActive.push({ type: "Multiple Persons", model: "YOLOv8" });
              consecutiveObjectsRef.current["multi_person"] = (consecutiveObjectsRef.current["multi_person"] || 0) + 1;
              const now = Date.now();
              const currentTotal = Math.min(proctoringMaxStrikes, Math.max(backendStrikes, currentStatusRef.current.strikes));
              
              if (currentTotal < proctoringMaxStrikes && consecutiveObjectsRef.current["multi_person"] >= 1 && (now - lastMultiPersonStrikeTimeRef.current > 6000)) {
                lastMultiPersonStrikeTimeRef.current = now;
                consecutiveObjectsRef.current["multi_person"] = 0;

                // 1. Immediately capture evidence screenshot with force=true
                captureScreenshot("Multiple Persons Detected", true);

                // 2. Show red warning banner directly on camera monitor
                setFaceStatus("warning");
                setViolationMsg("Multiple persons detected!");
                setTimeout(() => setViolationMsg(null), 5000);

                // 3. Immediately increment multi-person strikes
                setMultiPersonStrikes(prev => {
                  if (prev >= proctoringMaxStrikes) return prev;
                  const nextCount = Math.min(proctoringMaxStrikes, prev + 1);
                  const nextTotal = Math.min(proctoringMaxStrikes, currentTotal + 1);
                  setTimeout(() => {
                    if (nextTotal < proctoringMaxStrikes) {
                      if (nextTotal === proctoringMaxStrikes - 1) {
                        toast({ title: "Final Warning", description: proctoringMaxStrikesAction === "auto_terminate" ? "Another detection will terminate." : "Another detection will trigger review flag.", variant: "destructive" });
                      } else {
                        toast({ title: "Warning: Strike Issued", description: `Multiple persons detected! Strike ${nextTotal}/${proctoringMaxStrikes}`, variant: "destructive" });
                      }
                    } else if (nextTotal >= proctoringMaxStrikes) {
                      if (proctoringMaxStrikesAction === "auto_terminate") {
                        handleViolation(`Multiple person violations detected (${proctoringMaxStrikes} strikes).`, { multi: nextCount });
                      } else {
                        toast({ title: "Strikes Exceeded", description: `Strikes limit reached (${proctoringMaxStrikes} strikes). Incident logged.`, variant: "destructive" });
                      }
                    }
                  }, 0);
                  return nextCount;
                });
              }
            } else {
              consecutiveObjectsRef.current["multi_person"] = 0;
              if (personCount === 1) yoloActive.push({ type: "Candidate", model: "YOLOv8" });
            }

            if (cellPhoneCount > 0) {
              yoloActive.push({ type: "Mobile Phone", model: "YOLOv8" });
              consecutiveObjectsRef.current["mobile_phone"] = (consecutiveObjectsRef.current["mobile_phone"] || 0) + 1;
              const now = Date.now();
              const currentTotal = Math.min(proctoringMaxStrikes, Math.max(backendStrikes, currentStatusRef.current.strikes));

              if (currentTotal < proctoringMaxStrikes && consecutiveObjectsRef.current["mobile_phone"] >= 1 && (now - lastMobileStrikeTimeRef.current > 6000)) {
                lastMobileStrikeTimeRef.current = now;
                consecutiveObjectsRef.current["mobile_phone"] = 0;

                // 1. Immediately capture evidence screenshot with force=true
                captureScreenshot("Mobile Phone Detected", true);

                // 2. Show red warning banner directly on camera monitor
                setFaceStatus("warning");
                setViolationMsg("Mobile device detected!");
                setTimeout(() => setViolationMsg(null), 5000);

                // 3. Immediately increment mobile strikes
                setMobileStrikes(prev => {
                  if (prev >= proctoringMaxStrikes) return prev;
                  const nextCount = Math.min(proctoringMaxStrikes, prev + 1);
                  const nextTotal = Math.min(proctoringMaxStrikes, currentTotal + 1);
                  setTimeout(() => {
                    if (nextTotal < proctoringMaxStrikes) {
                      if (nextTotal === proctoringMaxStrikes - 1) {
                        toast({ title: "Final Warning", description: proctoringMaxStrikesAction === "auto_terminate" ? "Another detection will terminate." : "Another detection will trigger review flag.", variant: "destructive" });
                      } else {
                        toast({ title: "Warning: Strike Issued", description: `Mobile device detected! Strike ${nextTotal}/${proctoringMaxStrikes}`, variant: "destructive" });
                      }
                    } else if (nextTotal >= proctoringMaxStrikes) {
                      if (proctoringMaxStrikesAction === "auto_terminate") {
                        handleViolation(`Multiple mobile phone violations detected (${proctoringMaxStrikes} strikes).`, { mobile: nextCount });
                      } else {
                        toast({ title: "Strikes Exceeded", description: `Strikes limit reached (${proctoringMaxStrikes} strikes). Incident logged.`, variant: "destructive" });
                      }
                    }
                  }, 0);
                  return nextCount;
                });
              }
            } else {
              consecutiveObjectsRef.current["mobile_phone"] = 0;
            }

            setActiveDetections(prev => {
              const others = prev.filter(p => p.model === "MediaPipe" || p.model === "MobileNet");
              return [...others, ...yoloActive];
            });
          } catch (e: any) {
            if (e.name === 'AbortError') {
              console.log("[YOLO] Detection aborted.");
            } else {
              console.error("[YOLO] Error:", e);
            }
          } finally {
            isProcessingYoloRef.current = false;
          }
        };

        if (!proctoringEnabled) {
          setStatusMsg("Monitoring active (Proctoring disabled)");
          if (startRecordingSessionRef.current) startRecordingSessionRef.current();
          return;
        }

        const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";
        const wsUrl = apiUrl.replace('http', 'ws') + '/ws/face-monitor';
        wsRef.current = new WebSocket(`${wsUrl}?interview_id=${interviewId}`);
        
        wsRef.current.onopen = () => {
          setStatusMsg("AI Proctoring active");
          gazeIntervalRef.current = setInterval(() => {
            if (videoRef.current) detectGazeRef.current(videoRef.current);
          }, 2500);

          // Serial detection loop to prevent backend congestion
          let isProcessingFrame = false;
          const processFrame = async () => {
            if (isProcessingFrame || isFinalizingRef.current) return;
            if (!videoRef.current || !canvasRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

            isProcessingFrame = true;
            try {
              const context = canvasRef.current.getContext("2d", { willReadFrequently: true });
              if (context) {
                // Downscale for performance to prevent UI lag (max width 320)
                const targetWidth = Math.min(320, videoRef.current.videoWidth || 320);
                const scale = targetWidth / (videoRef.current.videoWidth || 1);
                const targetHeight = (videoRef.current.videoHeight || 240) * scale;
                
                canvasRef.current.width = targetWidth;
                canvasRef.current.height = targetHeight;
                context.drawImage(videoRef.current, 0, 0, targetWidth, targetHeight);
                const b64 = canvasRef.current.toDataURL("image/jpeg", 0.5);
                const audioSignal = audioMonitorRef.current?.analyze();
                
                // ── YOLO Throttling: Only send if not already processing ──
                // We do NOT await this to keep the MediaPipe/WebSocket loop responsive
                if (!isProcessingYoloRef.current) {
                  detectObjectInBackend(b64);
                }
                
                if (workerRef.current && typeof createImageBitmap !== 'undefined') {
                  createImageBitmap(canvasRef.current).then(bitmap => {
                    workerRef.current?.postMessage({ type: "process-frame", data: { imageBitmap: bitmap } }, [bitmap]);
                  }).catch(err => console.error("[CameraMonitor] Worker bitmap error:", err));
                }
                
                wsRef.current.send(JSON.stringify({
                  image: b64,
                  signals: {
                    audio: audioSignal?.flag,
                    gaze: currentStatusRef.current.gaze,
                    status: currentStatusRef.current.status,
                    strikes: currentStatusRef.current.strikes,
                    timestamp: Date.now()
                  }
                }));
              }
            } catch (err) {
              console.error("[CameraMonitor] Frame processing error:", err);
            } finally {
              isProcessingFrame = false;
            }
          };

          frameIntervalRef.current = setInterval(processFrame, 1000);
        };

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.message) {
              const isLimit = data.message.toLowerCase().includes("limit reached");
              if (!isLimit || !strikesLimitNotifiedRef.current) {
                setStatusMsg(data.message);
              }
            }
            const mpActive = [];
            if (data.face_count > 1) {
              mpActive.push({ type: "Multi Face", model: "MediaPipe" });
            }
            if (data.face_count === 0) mpActive.push({ type: "No Face", model: "MediaPipe" });
            setActiveDetections(prev => {
              const others = prev.filter(p => p.model === "YOLOv8" || p.model === "MobileNet");
              return [...mpActive, ...others];
            });

            if (data.status === "warning" || data.status === "final_warning" || data.status === "terminate") {
              const isLimitMsg = data.message && data.message.toLowerCase().includes("limit reached");
              if (isLimitMsg && strikesLimitNotifiedRef.current) {
                // Limit already announced, skip repeating banner/screenshot
                return;
              }
              if (isLimitMsg) {
                strikesLimitNotifiedRef.current = true;
              }

              setFaceStatus(data.status === "terminate" ? "error" : data.status);
              setViolationMsg(data.message);
              
              // Only capture screenshot if it's a warning (terminate will capture on its own if needed)
              if (data.status !== "terminate") {
                captureScreenshot(data.message || "Proctoring Violation", true);
                setTimeout(() => {
                  setViolationMsg(null);
                  setFaceStatus("normal");
                  setStatusMsg("Monitoring active");
                }, 5000);
              }

              // Parse backend messages to increment frontend counters so AdminDashboard shows correct evidence
              let newMulti = undefined;
              let newGaze = undefined;
              let newMobile = undefined;
              
              const isMultiViolation = data.violation_type === "multi_person" || 
                (data.message && (data.message.toLowerCase().includes("multiple") || data.message.toLowerCase().includes("multi")));
              const isGazeViolation = data.violation_type === "gaze" || 
                (data.message && (data.message.toLowerCase().includes("face not detected") || data.message.toLowerCase().includes("focus") || data.message.toLowerCase().includes("eye")));
              const isMobileViolation = data.violation_type === "mobile" ||
                (data.message && (data.message.toLowerCase().includes("mobile") || data.message.toLowerCase().includes("phone") || data.message.toLowerCase().includes("device")));
              
              if (isMultiViolation) {
                newMulti = Math.min(proctoringMaxStrikes, multiPersonStrikes + 1);
                setMultiPersonStrikes(newMulti);
                latestStrikesRef.current.multi = newMulti;
              } else if (isGazeViolation) {
                newGaze = Math.min(proctoringMaxStrikes, gazeState.strikeCount + 1);
                setGazeStrikeCount(newGaze);
                latestStrikesRef.current.gaze = newGaze;
              } else if (isMobileViolation) {
                newMobile = Math.min(proctoringMaxStrikes, mobileStrikes + 1);
                setMobileStrikes(newMobile);
                latestStrikesRef.current.mobile = newMobile;
              }

              if (data.strikes !== undefined) {
                setBackendStrikes(Math.min(proctoringMaxStrikes, data.strikes));
              }

              // Update prevStrikesRef to prevent duplicate screenshot in the useEffect
              prevStrikesRef.current = {
                mobile: newMobile !== undefined ? newMobile : mobileStrikes,
                multi: newMulti !== undefined ? newMulti : multiPersonStrikes,
                gaze: newGaze !== undefined ? newGaze : gazeState.strikeCount
              };

              if (data.status === "terminate") {
                handleViolation(data.message, { 
                  multi: newMulti, 
                  gaze: newGaze,
                  mobile: newMobile
                });
              }
            } else if (data.status === "normal") {
              setFaceStatus("normal");
              setViolationMsg(null);
            }
          } catch(e) {}
        };

        if (startRecordingSessionRef.current) startRecordingSessionRef.current();
      } catch (err) {
        setStatusMsg("Camera access denied.");
      }
    };

    initCamera();
    return () => { 
      stopProctoring();
      stopTracksAndWS(); 
    };
  }, [interviewId, saveVideoRecording, showCandidateVideo, proctoringEnabled, stopProctoring, stopTracksAndWS]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && isRecording && proctoringEnabled) {
        toast({ title: "Warning", description: "Tab switching detected. Incident logged.", variant: "destructive" });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isRecording, toast, proctoringEnabled]);

  useEffect(() => {
    if (isRecording && saveVideoRecording && mediaRecorderRef.current?.state === "inactive" && startRecordingSessionRef.current) {
      startRecordingSessionRef.current();
    }
  }, [isRecording, saveVideoRecording]);

  return (
    <motion.div 
      drag dragConstraints={{ left: -1000, right: 1000, top: -1000, bottom: 1000 }} dragMomentum={false}
      style={{ position: 'fixed', bottom: '32px', right: '32px', zIndex: 50, display: (showCandidateVideo && proctoringEnabled !== false) ? 'flex' : 'none' }}
      className="w-64 rounded-xl shadow-2xl border border-border/30 glass-card cursor-grab active:cursor-grabbing flex flex-col overflow-hidden backdrop-blur-2xl"
    >
      <div className="bg-background/40 backdrop-blur-md border-b border-border/20 h-6 flex items-center justify-between px-3">
        <div className="flex gap-1.5 items-center">
          {activeDetections.map((d, i) => (
             <span key={i} className="text-[7px] text-cyan-500 font-black bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
               {d.type}
             </span>
          ))}
          {proctoringEnabled && gazeState.gaze !== "CENTER" && <span className="text-[7px] text-amber-500 font-black bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">EYE AWAY</span>}
          
          {/* Live Strike Counter */}
          {proctoringEnabled && Math.min(proctoringMaxStrikes, Math.max(backendStrikes, mobileStrikes + multiPersonStrikes + gazeState.strikeCount)) > 0 && (
            <span className="text-[7px] text-red-500 font-black bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
              STRIKES: {Math.min(proctoringMaxStrikes, Math.max(backendStrikes, mobileStrikes + multiPersonStrikes + gazeState.strikeCount))}
            </span>
          )}
        </div>
        <div className="w-8 h-1 rounded-full bg-border/40 hover:bg-border/60 transition-colors" />
      </div>
      
      <div className="relative aspect-video bg-black/80 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none opacity-90" />
        <canvas ref={canvasRef} className="hidden" />
        <audio id="ai-voice" playsInline className="hidden" />
        
        {/* Recording indicator ring */}
        {isRecording && (
          <div className="absolute inset-0 pointer-events-none border-2 border-red-500/30 rounded-b-xl">
            <motion.div 
              className="absolute inset-0 border-2 border-red-500/50 rounded-b-xl"
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </div>
        )}

        {/* Gradient Overlay for Text */}
        <div className="absolute inset-x-0 bottom-0 pt-8 pb-2 px-2 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none flex flex-col justify-end">
          <div className="flex items-center justify-between">
            <span className={`text-[8px] font-bold uppercase tracking-widest flex items-center gap-1 ${faceStatus === 'normal' ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${faceStatus === 'normal' ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
              {statusMsg}
            </span>
            
            {isRecording ? (
              <span className="flex items-center text-red-500 gap-1 text-[8px] font-bold uppercase tracking-widest bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
              </span>
            ) : (
              <span className="flex items-center text-zinc-400 gap-1 text-[8px] font-bold uppercase tracking-widest bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
                OFF
              </span>
            )}
          </div>
          
          <div className="flex gap-2 mt-1">
            <span className={`text-[8px] font-bold tracking-widest ${gazeState.gaze !== 'CENTER' ? 'text-amber-400' : 'text-zinc-400'}`}>
              GAZE: {gazeState.gaze}
            </span>
            <span className={`text-[8px] font-bold tracking-widest ${Math.min(proctoringMaxStrikes, Math.max(backendStrikes, gazeState.strikeCount + mobileStrikes + multiPersonStrikes)) > 0 ? 'text-red-400' : 'text-zinc-400'}`}>
              STRIKES: {Math.min(proctoringMaxStrikes, Math.max(backendStrikes, gazeState.strikeCount + mobileStrikes + multiPersonStrikes))}/{proctoringMaxStrikes}
            </span>
          </div>
        </div>

        <AnimatePresence>
          {violationMsg && (
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }} 
              animate={{ opacity: 1, y: 0, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="absolute top-2 left-2 right-2 bg-red-600/90 rounded border border-red-400/50 p-2 flex items-center justify-center gap-2 backdrop-blur-md shadow-2xl pointer-events-none z-10"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-white animate-pulse shrink-0" />
              <p className="text-white text-[9px] font-black uppercase tracking-widest truncate">{violationMsg}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});

export default CameraMonitor;
