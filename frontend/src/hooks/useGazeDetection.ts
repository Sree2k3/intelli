import { useEffect, useRef, useState, useCallback } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export type GazeDirection = "LEFT" | "RIGHT" | "UP" | "DOWN" | "CENTER";

interface GazeState {
  gaze: GazeDirection;
  strikeCount: number;
  status: "NORMAL" | "CHEATING_DETECTED";
}

interface UseGazeDetectionProps {
  onLookAway?: (strikeCount: number) => void;
  onCheatingFlag?: () => void;
  interviewId?: string; // Optional: for scoped localStorage
  initialStrikes?: number;
  proctoringMaxStrikes?: number;
  enabled?: boolean;
}

// Landmark Constants according to the requirements
const LANDMARKS = {
  LEFT_EYE_CORNER: 33,
  RIGHT_EYE_CORNER: 133,
  TOP_EYELID: 159,
  BOTTOM_EYELID: 145,
  IRIS_CENTER: 468
};

export const useGazeDetection = ({ onLookAway, onCheatingFlag, interviewId, initialStrikes, proctoringMaxStrikes = 3, enabled = true }: UseGazeDetectionProps = {}) => {
  const storageKey = interviewId ? `gaze_strikes_${interviewId}` : "gaze_strikes_generic";

  const [gazeState, setGazeState] = useState<GazeState>(() => {
    if (!enabled) {
      return { gaze: "CENTER", strikeCount: 0, status: "NORMAL" };
    }
    // 8. Persist strikeCount to avoid reset on refresh
    const saved = sessionStorage.getItem(storageKey);
    const parsed = saved ? parseInt(saved, 10) : 0;
    
    // Use initialStrikes from prop if provided (from DB), else fallback to sessionStorage
    const startStrikes = initialStrikes ?? (isNaN(parsed) ? 0 : parsed);
    
    return {
      gaze: "CENTER",
      strikeCount: startStrikes,
      status: startStrikes >= proctoringMaxStrikes ? "CHEATING_DETECTED" : "NORMAL",
    };
  });

  const lastStrikeTimeRef = useRef<number>(0);
  const strikeCountRef = useRef<number>(gazeState.strikeCount);
  const continuousCenterStartTimeRef = useRef<number>(Date.now());
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const isInitializingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    const initFaceLandmarker = async () => {
      if (faceLandmarkerRef.current || isInitializingRef.current) return;
      isInitializingRef.current = true;

      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "CPU"
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1,
        });
        console.log("[GazeDetection] FaceLandmarker initialized with Iris tracking");
      } catch (error) {
        console.error("[GazeDetection] Failed to initialize FaceLandmarker:", error);
      } finally {
        isInitializingRef.current = false;
      }
    };

    initFaceLandmarker();

    return () => {
      faceLandmarkerRef.current?.close();
    };
  }, []);

  const lookAwayBufferRef = useRef<number>(0);

  const detectGaze = useCallback((videoElement: HTMLVideoElement) => {
    if (!enabled || !faceLandmarkerRef.current || videoElement.readyState < 2) return null;

    const startTimeMs = performance.now();
    const results = faceLandmarkerRef.current.detectForVideo(videoElement, startTimeMs);
    let result: GazeState | null = null;

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // 2. Extract required landmarks
      const leftCorner = landmarks[LANDMARKS.LEFT_EYE_CORNER];
      const rightCorner = landmarks[LANDMARKS.RIGHT_EYE_CORNER];
      const topEyelid = landmarks[LANDMARKS.TOP_EYELID];
      const bottomEyelid = landmarks[LANDMARKS.BOTTOM_EYELID];
      const irisCenter = landmarks[LANDMARKS.IRIS_CENTER];

      if (leftCorner && rightCorner && topEyelid && bottomEyelid && irisCenter) {
        // 3. Calculate gaze direction using both X and Y axis
        // Vertical Eye Opening Height
        const eyeOpenHeight = Math.abs(bottomEyelid.y - topEyelid.y);
        const eyeWidth = Math.abs(rightCorner.x - leftCorner.x);
        
        // ── ROBUST BLINK DETECTION (Eye Aspect Ratio - EAR) ──────────────────
        // EAR = height / width. A typical open eye is ~0.25 - 0.40. 
        // A blinking/closed eye is typically < 0.15.
        const ear = eyeWidth !== 0 ? eyeOpenHeight / eyeWidth : 0;

        // Classification
        let currentGaze: GazeDirection = "CENTER";

        // ONLY classify if the eye is definitely open.
        // This is the primary defense against "strike on blink".
        if (ear > 0.20) { 
          // Handle mirroring/coord mapping
          const hMin = Math.min(leftCorner.x, rightCorner.x);
          const ratioX = eyeWidth !== 0 ? (irisCenter.x - hMin) / eyeWidth : 0.5;
          
          const vMin = Math.min(topEyelid.y, bottomEyelid.y);
          const ratioY = eyeOpenHeight !== 0 ? (irisCenter.y - vMin) / eyeOpenHeight : 0.5;

          // Relaxed classification logic:
          // Normal screen reading spans ratioX 0.22 - 0.78, ratioY 0.25 - 0.82
          // Only trigger if gaze is drastically turned away from screen
          if (ratioX < 0.20) {
            currentGaze = "LEFT";
          } else if (ratioX > 0.80) {
            currentGaze = "RIGHT";
          } else if (ratioY < 0.18) {
            currentGaze = "UP";
          } else if (ratioY > 0.88) {
            currentGaze = "DOWN";
          }
        }

        const now = Date.now();
        let updatedStrikeCount = strikeCountRef.current;

        // 5. Implement strike-based cheating logic with SUSTAINED THRESHOLD
        if (currentGaze !== "CENTER") {
          continuousCenterStartTimeRef.current = now;
          
          // Increment look-away buffer for every contiguous "away" sample
          lookAwayBufferRef.current += 1;

          // REQUIREMENT: Only strike if look-away is sustained for >= 8 samples (~20s)
          if (lookAwayBufferRef.current >= 8) {
            // Check the 15-second strike rate-limit cooldown
            if (now - lastStrikeTimeRef.current > 15000) {
              if (strikeCountRef.current < proctoringMaxStrikes) {
                strikeCountRef.current += 1;
              }
              updatedStrikeCount = strikeCountRef.current;
              lastStrikeTimeRef.current = now;
              
              sessionStorage.setItem(storageKey, updatedStrikeCount.toString());
              
              if (onLookAway) onLookAway(updatedStrikeCount);
              if (updatedStrikeCount >= proctoringMaxStrikes && gazeState.status !== "CHEATING_DETECTED") {
                if (onCheatingFlag) onCheatingFlag();
              }
            }
          }
        } else {
          lookAwayBufferRef.current = Math.max(0, lookAwayBufferRef.current - 1); // Decrement buffer instead of immediate reset to handle tracking flickers
          
          // Reset continuous center timer
          if (now - continuousCenterStartTimeRef.current > 30000 && strikeCountRef.current > 0) {
            strikeCountRef.current = 0;
            updatedStrikeCount = 0;
            sessionStorage.setItem(storageKey, "0");
          }
          continuousCenterStartTimeRef.current = now;
        }

        const newStatus = updatedStrikeCount >= proctoringMaxStrikes ? "CHEATING_DETECTED" : "NORMAL";
        const newState: GazeState = {
          gaze: currentGaze,
          strikeCount: updatedStrikeCount,
          status: newStatus,
        };
        setGazeState(newState);
        result = newState;
      }
    } else {
      lookAwayBufferRef.current = 0;
      const newState: GazeState = {
        gaze: "CENTER",
        strikeCount: strikeCountRef.current,
        status: strikeCountRef.current >= proctoringMaxStrikes ? "CHEATING_DETECTED" : "NORMAL",
      };
      setGazeState(newState);
      result = newState;
    }
    return result;
  }, [onLookAway, onCheatingFlag, gazeState.status, storageKey]);

  const setGazeStrikeCount = useCallback((count: number) => {
    strikeCountRef.current = count;
    sessionStorage.setItem(storageKey, count.toString());
    setGazeState(prev => ({
      ...prev,
      strikeCount: count,
      status: count >= proctoringMaxStrikes ? "CHEATING_DETECTED" : "NORMAL"
    }));
  }, [storageKey]);

  return { gazeState, detectGaze, setGazeStrikeCount };
};
