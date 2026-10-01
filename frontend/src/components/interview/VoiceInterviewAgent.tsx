/**
 * VoiceInterviewAgent — Premium AI Interview Engine
 * 
 * Redesigned for a world-class candidate experience.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, VolumeX, CheckCircle2, Search, Loader2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendInterviewMessage, transcribeAudio, submitCandidateAnswer, fetchInterviewClosing } from "@/lib/api";
import { interviewAudioBus } from "@/lib/interviewAudioBus";
import VoiceVisualizer from "./VoiceVisualizer";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message { role: "ai" | "user"; content: string; }
interface InterviewMeta {
  focusing_on?: string;
  current_question_index?: number;
  follow_up_count?: number;
  total_questions?: number;
  question_id?: string;
  question_text?: string;
}
interface Props {
  interviewId: string;
  inviteToken: string;
  jobRole: string;
  initialRound?: string;
  candidateName?: string;
  isTimeUp?: boolean;
  onAdvance: (next: string) => void;
  onComplete: () => void;
}

/**
 * Strip conversational lead-in phrases and transition artifacts
 * so the Question Card displays strictly the question itself.
 */
export function cleanQuestionCardText(rawText: string): string {
  if (!rawText) return "Waiting for your interview to start...";
  let text = rawText.trim();

  const leadInPatterns = [
    /^(?:no\s+problem|that'?s\s+completely\s+fine|that'?s\s+fine|understood|alright|all\s+right|okay|ok|great|got\s+it|sure|thank\s+you|thanks)[\s,.]*/i,
    /^(?:let'?s\s+move\s+(?:on\s+)?(?:to\s+(?:the\s+)?next\s+question)?|moving\s+(?:on\s+)?(?:to\s+(?:the\s+)?next\s+question)?|to\s+(?:the\s+)?next\s+question)[\s,.]*/i,
    /^(?:it\s+seems\s+we\s+didn'?t\s+receive\s+an\s+answer[\s,.]*)/i,
    /^(?:let'?s\s+continue[\s,.]*)/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadInPatterns) {
      if (pattern.test(text)) {
        const next = text.replace(pattern, "").trim();
        if (next.length > 0) {
          text = next;
          changed = true;
        }
      }
    }
  }

  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text || rawText;
}

export default function VoiceInterviewAgent({
  interviewId, inviteToken, jobRole,
  candidateName = "Candidate", initialRound = "technical",
  isTimeUp,
  onAdvance, onComplete,
}: Props) {
  const { toast } = useToast();

  // ── UI State ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRound, setCurrentRound] = useState(initialRound);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState("AI is preparing...");
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [meta, setMeta] = useState<InterviewMeta | null>(null);
  const [stage, setStage] = useState<"intro" | "interviewing" | "closing">("intro");
  
  // Ref for auto-scrolling transcript
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [introText, setIntroText] = useState<string | null>(null);
  const transcriptRef = useRef("");
  const initialRoundRef = useRef(currentRound);

  const isMountedRef = useRef(true);
  const isForceClosingRef = useRef(false);
  const isSubmittingAnswerRef = useRef(false);

  // ── Speech Boundary Detection State (Don't Cut Mid-Sentence) ──
  const [isFinishingSentence, setIsFinishingSentence] = useState(false);
  const isFinishingSentenceRef = useRef(false);
  const [sentenceWrapUpSeconds, setSentenceWrapUpSeconds] = useState(30);
  const wrapUpCompletedRef = useRef(false);
  const softCloseExecutedRef = useRef(false);
  const triggerWrapUpCompletionRef = useRef<() => Promise<void>>(null!);
  const executeSoftCloseRef = useRef<() => Promise<void>>(null!);

  // Safety watchdog: ensure isTranscribing is never stuck for more than 3.5s
  useEffect(() => {
    if (isTranscribing) {
      const timer = setTimeout(() => {
        console.warn("[Watchdog] Force clearing isTranscribing state after safety timeout.");
        setIsTranscribing(false);
        isSubmittingAnswerRef.current = false;
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isTranscribing]);

  // Safety watchdog: ensure isThinking is never stuck indefinitely
  useEffect(() => {
    if (isThinking) {
      const timer = setTimeout(() => {
        console.warn("[Watchdog] Force clearing isThinking state after safety timeout.");
        setIsThinking(false);
        inFlightRef.current = false;
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [isThinking]);

  // Handle Time Expiration with Speech Boundary Detection
  const timeUpHandledRef = useRef(false);
  useEffect(() => {
    if (isTimeUp && !timeUpHandledRef.current) {
      timeUpHandledRef.current = true;

      // Check if candidate is actively speaking (mic open & spoken content or recent STT result)
      const hasRecentSpeech = lastResultTimeRef.current > 0 && (Date.now() - lastResultTimeRef.current < 2500);
      const hasSpokenContent = transcriptRef.current.trim().length > 0;
      const isCandidateSpeaking = isListeningRef.current && (hasRecentSpeech || hasSpokenContent);

      if (isCandidateSpeaking) {
        console.log("[SpeechBoundary] Assessment time up, but candidate is actively speaking. Granting up to 30s wrap-up.");
        setIsFinishingSentence(true);
        isFinishingSentenceRef.current = true;
        setSentenceWrapUpSeconds(30);
      } else {
        console.log("[SpeechBoundary] Assessment time up and candidate is not speaking. Proceeding to soft close immediately.");
        if (executeSoftCloseRef.current) {
          executeSoftCloseRef.current();
        }
      }
    }
  }, [isTimeUp]);

  // Cleanup on unmount to kill speech
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      interviewAudioBus.stopSpeaking();
      window.speechSynthesis?.cancel();
      stopVolumeSimulation();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  // ── Persistence Logic ──
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    const key = `interview_session_${interviewId}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const {
          messages: savedMsgs,
          currentRound: savedRound,
          stage: savedStage,
          meta: savedMeta
        } = JSON.parse(saved);

        if (savedMsgs?.length) setMessages(savedMsgs);
        if (savedRound) {
          setCurrentRound(savedRound);
          roundRef.current = savedRound;
        }
        if (savedStage) setStage(savedStage);
        if (savedMeta) setMeta(savedMeta);
        console.log(`[Persistence] Restored ${savedMsgs?.length || 0} messages.`);
      } catch (e) {
        console.warn("Failed to restore session", e);
      }
    }
    setIsRestored(true);
  }, [interviewId]);

  useEffect(() => {
    if (!isRestored) return;
    const key = `interview_session_${interviewId}`;
    const sessionData = {
      messages,
      currentRound,
      stage,
      meta,
      lastUpdate: new Date().toISOString()
    };
    localStorage.setItem(key, JSON.stringify(sessionData));
  }, [messages, currentRound, stage, meta, interviewId, isRestored]);

  // ── Refs ──
  const inFlightRef = useRef(false);
  const roundRef = useRef(initialRound);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastResultTimeRef = useRef(Date.now());
  const lastRestartTimeRef = useRef(Date.now());
  const stopAndSendRef = useRef<() => Promise<void>>(null!);
  // Snapshot of the question ID at the moment listening STARTS — prevents
  // answer/question mismatch caused by meta state updating mid-recording.
  const activeQuestionIdRef = useRef<string | null>(null);
  // Guard flag: set true when stopAndSend is called to block any in-flight auto-save.
  const listeningStoppedRef = useRef(false);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // ── Thinking Phase Cycler ──
  useEffect(() => {
    if (!isThinking) {
      setThinkingPhase("AI is preparing...");
      return;
    }
    
    // Cycle through meaningful AI states during latency
    const phases = [
      "Saving your response...",
      "AI is analyzing your answer...",
      "Preparing the next question..."
    ];
    let i = 0;
    setThinkingPhase(phases[0]);
    
    const interval = setInterval(() => {
      i = (i + 1) % phases.length;
      setThinkingPhase(phases[i]);
    }, 3000); // Change text every 3 seconds
    
    return () => clearInterval(interval);
  }, [isThinking]);

  // ── Auto-Save Transcript to DB Live ──
  // Uses activeQuestionIdRef (locked at startListening time) instead of meta.question_id
  // to prevent saving a partial transcript against the next question after state advances.
  useEffect(() => {
    if (!isListening || !activeQuestionIdRef.current || !transcript.trim()) return;
    // Do not auto-save if stop has already been triggered (race guard)
    if (listeningStoppedRef.current) return;

    const currentText = transcript.trim();

    const timer = setTimeout(async () => {
      // Re-check the guard inside the timeout callback in case stop fired during the delay
      if (listeningStoppedRef.current) return;
      try {
        const qId = activeQuestionIdRef.current || meta?.question_id;
        if (!qId) return;
        await submitCandidateAnswer(inviteToken || "", qId, currentText);
        if (!isMountedRef.current) return;
        console.log(`[AutoSave] Saving live answer for Q: ${qId}...`);
      } catch (err) {
        console.warn("[AutoSave Error] Failed to update draft answer:", err);
      }
    }, 4000); // 4s debounce — avoids saving mid-sentence partial results

    return () => clearTimeout(timer);
  }, [transcript, isListening, inviteToken]);

  // ─── TTS (Unified Audio Bus - Mixed into Earphones & Recording Stream) ─────
  const speak = async (text: string, isPriority = false): Promise<void> => {
    if (isForceClosingRef.current && !isPriority) return;
    if (!isMountedRef.current) return;

    setIsSpeaking(true);
    startVolumeSimulation();

    try {
      await interviewAudioBus.speak(text, {
        onStart: () => {
          if (isMountedRef.current) {
            setIsSpeaking(true);
            startVolumeSimulation();
          }
        },
        onEnd: () => {
          if (isMountedRef.current) {
            setIsSpeaking(false);
            stopVolumeSimulation();
          }
        },
      });
    } catch (err) {
      console.error("[TTS] Speech execution failed:", err);
    } finally {
      if (isMountedRef.current) {
        setIsSpeaking(false);
        stopVolumeSimulation();
      }
    }
  };

  const stopSpeaking = () => {
    interviewAudioBus.stopSpeaking();
    setIsSpeaking(false);
    stopVolumeSimulation();
  };

  // ── Lip Sync Simulation (Handled automatically by GPU animations) ──
  const startVolumeSimulation = () => {};
  const stopVolumeSimulation = () => {};

  // ── Engine call ──
  const sendRef = useRef<(msg: string | null, roundOverride?: string) => Promise<void>>(null!);
  sendRef.current = async (msg: string | null, roundOverride?: string) => {
    if (inFlightRef.current || isForceClosingRef.current) return;
    inFlightRef.current = true;
    setIsThinking(true);

    const round = roundOverride ?? roundRef.current;
    let handledTransition = false;

    if (msg) setMessages(prev => [...prev, { role: "user", content: msg }]);

    try {
      const data = await sendInterviewMessage(interviewId, msg, round, jobRole, inviteToken);
      if (!isMountedRef.current || isForceClosingRef.current) {
        inFlightRef.current = false;
        return;
      }
      const aiText = ((data.response as string) || "Let's continue.").trim();
      const newMeta = (data.metadata || {}) as InterviewMeta;
      const shouldAdvance = data.shouldAdvance === true;
      const nextRound = shouldAdvance ? ((data.nextRound as string) || "completed") : null;

      if (data.isIntro && data.introduction) {
        setIntroText(data.introduction);
        setMessages(prev => [
          ...prev,
          { role: "ai", content: data.introduction },
          { role: "ai", content: aiText }
        ]);
      } else {
        setMessages(prev => [...prev, { role: "ai", content: aiText }]);
      }
      setMeta(newMeta);
      setTranscript("");

      if (!msg && messages.length === 0) setStage("intro");
      else if (shouldAdvance && nextRound === "completed") setStage("closing");
      else setStage("interviewing");

      setIsThinking(false);
      if (data.isIntro && data.introduction) {
        interviewAudioBus.prefetch(aiText);
        await speak(data.introduction);
        if (!isMountedRef.current) return;
        await speak(aiText);
      } else {
        await speak(aiText);
      }
      if (!isMountedRef.current) return;

      if (shouldAdvance && nextRound === "completed") {
        inFlightRef.current = false;
        handledTransition = true;
        onComplete();
      } else if (shouldAdvance && nextRound) {
        onAdvance(nextRound);
        handledTransition = true;
        inFlightRef.current = false;
        if (nextRound === "coding") return;
        roundRef.current = nextRound;
        setCurrentRound(nextRound);
        setMessages([]);
        setMeta(null);
        setStage("intro");
        await sendRef.current(null, nextRound);
      } else {
        // Automatically start listening since the question is complete
        setTimeout(() => startListening(newMeta.question_id), 500);
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Issue", description: "Connection issue.", variant: "destructive" });
    } finally {
      setIsThinking(false);
      if (!handledTransition) inFlightRef.current = false;
    }
  };

  useEffect(() => {
    // Wait for restoration to complete
    if (!isRestored) return;

    // Only send initial message if history is empty
    if (messages.length === 0) {
      sendRef.current(null, initialRound);
    } else {
      console.log("[Persistence] Resuming existing conversation.");
    }
  }, [isRestored]);

  // ── Skip / Pass Intent Detector ──
  const isCandidateSkipOrPass = (text: string): boolean => {
    if (!text || !text.trim()) return false;
    const cleaned = text.replace(/\[(?:Initial Answer|Follow-up Answer|Follow-up \d+)\]/gi, "").trim();
    if (!cleaned) return false;
    const normalized = cleaned.toLowerCase().replace(/[^a-z0-9\s']/g, " ").trim();
    if (!normalized) return false;

    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;

    const SKIP_PASS_REGEXES = [
      /\b(?:skip|pass|bypass)\b/,
      /\b(?:can|could|may|please)?\s*(?:we|i)?\s*(?:please)?\s*(?:skip|pass|move on|go on|go ahead|proceed)\b/,
      /\b(?:let'?s|lets)\s+(?:skip|pass|move on|go to the next|proceed|move forward)\b/,
      /\b(?:next|forward)\s*(?:question|one|topic)?\s*(?:please)?\b/,
      /\b(?:move|go|proceed|jump|step)\s+(?:on|forward|ahead|to the next)\b/,
      /\b(?:i\s+)?(?:don'?t|dont|do\s+not|dunno|idk)\s+know\b/,
      /\b(?:i\s+)?(?:have|got)?\s*(?:no|zero)\s+(?:idea|clue|knowledge|notion)\b/,
      /\b(?:i'?m|i\s+am)?\s*(?:not|really\s+not|honestly\s+not)\s*(?:sure|certain|confident)\b/,
      /\b(?:drawing|drew)\s+a\s+blank\b/,
      /\b(?:my\s+)?mind\s+(?:went|is)\s+blank\b/,
      /\b(?:not|never|haven'?t|have\s+not)\s*(?:really)?\s*(?:familiar|worked|used|touched|dealt|experienced)\b/,
      /\b(?:no|little|zero|lack)\s+experience\s+with\b/,
      /\bnever\s+(?:heard|worked|used|seen)\b/,
      /\b(?:out\s+of|outside(?:\s+of)?)\s+(?:my\s+)?(?:domain|scope|expertise|area|knowledge)\b/,
      /\bnot\s+in\s+my\s+wheelhouse\b/,
      /\bnot\s+my\s+strong\s+suit\b/,
      /\b(?:i\s+)?(?:can'?t|cannot|cant|am\s+unable\s+to)\s+answer\b/,
      /\b(?:no|don'?t\s+have\s+an?)\s+answer\b/,
      /\b(?:prefer|rather)\s+not\s+to\s+answer\b/,
      /\b(?:would\s+like\s+to|want\s+to)\s+(?:skip|pass|move\s+on)\b/,
    ];

    const matches = SKIP_PASS_REGEXES.some(re => re.test(normalized));
    if (!matches) return false;

    // Substantive answer safeguard: if candidate spoke a substantive alternative answer (> 20 words),
    // only treat as skip if they explicitly concluded with an advancement directive.
    if (words.length > 20) {
      const explicitAdvance = /\b(?:skip|pass|move\s+on|next\s+question|next\s+one)\b/.test(normalized);
      if (!explicitAdvance) return false;
    }

    return true;
  };

  // ── Filler / Meaningful Answer Detection ──
  // Mirrors the backend `is_meaningful_response` logic so fillers are caught
  // before they are ever sent to the AI or saved to the database.
  const isMeaningfulAnswer = (text: string): boolean => {
    if (!text || !text.trim()) return false;
    // Intentional pass/skip intents are recognized as valid candidate actions
    if (isCandidateSkipOrPass(text)) {
      return true;
    }
    // Strip speech-to-text label prefixes
    const cleaned = text.replace(/\[(?:Initial Answer|Follow-up Answer|Follow-up \d+)\]/gi, "").trim();
    if (!cleaned) return false;
    // Normalize to lowercase alphanumeric + spaces
    const normalized = cleaned.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (!normalized) return false;

    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    const FILLER_WORDS = new Set([
      "thank", "you", "thanks", "okay", "ok", "alright", "yeah", "yes", "no", "got", "it", "sure",
      "understood", "hmm", "please", "continue", "next", "question", "hi", "hello", "hey",
      "yep", "yup", "fine", "good", "nothing", "none", "maybe", "perhaps", "um", "uh", "idk", "dunno",
      "not", "i", "dont", "do", "know", "go", "ahead", "ready", "lets", "let", "s",
      "proceed", "so", "much", "well", "ah", "oh", "like", "actually", "basically", "literally",
      "just", "then", "this", "that", "the", "a", "an", "and", "or", "but", "of", "to",
      "for", "with", "on", "at", "by", "from", "up", "about", "into", "over", "after", "am", "is",
      "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "would", "could",
      "should", "think", "thought", "guess", "suppose", "as", "if"
    ]);
    const contentWords = words.filter(w => !FILLER_WORDS.has(w));
    
    // Reject if ALL words are filler AND it's a very short response (likely a false trigger grunt like "yes" or "okay")
    if (contentWords.length === 0 && words.length <= 3) return false;
    
    // Otherwise, it has some meaningful content OR it's a long conversational response that shouldn't be dropped silently.
    return true;
  };

  // ── Listening ──
  const isListeningRef = useRef(false);
  const finalTextRef = useRef("");
  const silenceNudgeGivenRef = useRef(false);
  const consecutiveEmptyAttemptsRef = useRef(0);
  const autoAdvanceOnSilenceRef = useRef<() => Promise<void>>(null!);

  const startListening = (forceQuestionId?: string | null) => {
    if (isSpeaking) stopSpeaking();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (recognitionRef.current) return;

    // Lock the active question ID NOW before any async work, so auto-save and
    // stopAndSend always reference the question that triggered this listening session.
    // This prevents answer/question mismatch when meta.question_id advances.
    activeQuestionIdRef.current = forceQuestionId !== undefined ? forceQuestionId : (meta?.question_id ?? null);
    listeningStoppedRef.current = false;
    isSubmittingAnswerRef.current = false;
    silenceNudgeGivenRef.current = false;
    console.log(`[STT] startListening — locked question_id: ${activeQuestionIdRef.current}`);

    const startMediaRecorder = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
        recorder.onstart = () => {
          setRecordingSeconds(0);
          lastResultTimeRef.current = Date.now();
          recordingTimerRef.current = setInterval(() => {
            setRecordingSeconds(s => {
              const nextSec = s + 1;

              // 0. Speech Boundary Mode: Candidate finishing their sentence when assessment time expired
              if (isFinishingSentenceRef.current) {
                setSentenceWrapUpSeconds(prev => {
                  const remaining = prev - 1;
                  const silentMs = Date.now() - lastResultTimeRef.current;

                  // Natural sentence boundary: candidate paused for 2.0s after speaking
                  if (silentMs >= 2000) {
                    console.log("[SpeechBoundary] Natural sentence boundary detected (2s pause). Wrapping up response.");
                    if (recordingTimerRef.current) {
                      clearInterval(recordingTimerRef.current);
                      recordingTimerRef.current = null;
                    }
                    if (triggerWrapUpCompletionRef.current) {
                      triggerWrapUpCompletionRef.current();
                    }
                    return 0;
                  }

                  // 30s wrap-up hard cap reached
                  if (remaining <= 0) {
                    console.log("[SpeechBoundary] 30s wrap-up ceiling reached. Wrapping up response.");
                    if (recordingTimerRef.current) {
                      clearInterval(recordingTimerRef.current);
                      recordingTimerRef.current = null;
                    }
                    if (triggerWrapUpCompletionRef.current) {
                      triggerWrapUpCompletionRef.current();
                    }
                    return 0;
                  }

                  return remaining;
                });
                return s;
              }

              // 1. Max duration check (120s)
              if (nextSec >= 120) {
                console.log("[SilenceChecker] Max duration reached (120s). Submitting answer.");
                if (recordingTimerRef.current) {
                  clearInterval(recordingTimerRef.current);
                  recordingTimerRef.current = null;
                }
                stopAndSendRef.current();
                return s;
              }

              const hasSpoken = transcriptRef.current.trim().length > 0;
              const silentMs = Date.now() - lastResultTimeRef.current;

              // 2. Candidate gave an answer and stopped speaking:
              // For skip/pass intents, auto-advance snappily (1.8s) so candidate isn't waiting!
              // For regular answers, provide normal 5s natural thinking/breathing pause.
              if (hasSpoken) {
                const currentText = transcriptRef.current.trim();
                const isSkip = isCandidateSkipOrPass(currentText);
                const silenceThreshold = isSkip ? 1800 : 5000;
                if (silentMs >= silenceThreshold) {
                  console.log(`[SilenceChecker] Speech completed (${isSkip ? '1.8s skip intent' : '5s answer'} silence). Submitting answer.`);
                  if (recordingTimerRef.current) {
                    clearInterval(recordingTimerRef.current);
                    recordingTimerRef.current = null;
                  }
                  stopAndSendRef.current();
                  return s;
                }
              } else {
                // 3. Complete silence (candidate has not spoken at all)
                // Silently auto-advance after 30s behind the scenes
                if (nextSec >= 30) {
                  console.log("[SilenceChecker] 30s inactivity timeout reached. Auto-advancing behind the scenes.");
                  if (recordingTimerRef.current) {
                    clearInterval(recordingTimerRef.current);
                    recordingTimerRef.current = null;
                  }
                  autoAdvanceOnSilenceRef.current();
                  return s;
                }
              }

              return nextSec;
            });
          }, 1000);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch (err) { console.error(err); }
    };
    startMediaRecorder();

    isListeningRef.current = true;
    finalTextRef.current = "";
    transcriptRef.current = ""; // Synchronously reset the ref to avoid race conditions!
    setTranscript("");
    setFinalTranscript("");
    setInterimTranscript("");
    setIsListening(true);
    lastResultTimeRef.current = Date.now();

    if (SR) {
      let networkRetryCount = 0;
      const MAX_NETWORK_RETRIES = 5;

      const createAndStart = (retryDelay = 0) => {
        const r = new SR();
        r.lang = "en-US"; r.continuous = true; r.interimResults = true;

        r.onstart = () => {
        // Do NOT reset lastResultTimeRef here. It should track actual speech or the start of the turn.
        console.log("[SpeechRecognition] Started / restarted.");
      };

      r.onresult = (e: any) => {
        networkRetryCount = 0;
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            finalTextRef.current += e.results[i][0].transcript + " ";
          } else {
            interimText += e.results[i][0].transcript;
          }
        }
        // Only reset the silence timer when actual speech is detected
        lastResultTimeRef.current = Date.now();
        
        const fullFinal = finalTextRef.current;
        setFinalTranscript(fullFinal);
        setInterimTranscript(interimText);
        
        const fullTranscript = (fullFinal + interimText).trim();
        setTranscript(fullTranscript);
        transcriptRef.current = fullTranscript;
      };

      r.onerror = (e: any) => {
        const err: string = e.error;
        console.error(`[SpeechRecognition Error] ${err}`, e);
        recognitionRef.current = null;

        // "aborted" means WE called stop() — never restart
        if (err === "aborted") {
          console.log("[SpeechRecognition] Aborted by us — not restarting.");
          return;
        }

        if (!isListeningRef.current) return;

        if (err === "network") {
          networkRetryCount++;
          if (networkRetryCount > MAX_NETWORK_RETRIES) {
            console.warn("[SpeechRecognition] Network error limit reached. Falling back to audio-only mode.");
            toast({
              title: "Live transcription unavailable",
              description: "Voice transcription is falling back to audio recording. Your answers will still be captured when you click 'Finish Speaking'.",
              variant: "destructive"
            });
            return; // stop retrying
          }
          const backoffMs = Math.min(16000, 1000 * Math.pow(2, networkRetryCount - 1));
          console.log(`[SpeechRecognition] Network error (attempt ${networkRetryCount}/${MAX_NETWORK_RETRIES}). Retrying in ${backoffMs}ms...`);
          setTimeout(() => {
            if (isListeningRef.current) {
              recognitionRef.current = createAndStart(backoffMs);
            }
          }, backoffMs);
          return;
        }

        // "no-speech" and other transient errors — restart after short delay
        console.log(`[SpeechRecognition] Transient error '${err}' — restarting in 300ms.`);
        setTimeout(() => {
          if (isMountedRef.current && isListeningRef.current) {
            recognitionRef.current = createAndStart();
          }
        }, 300);
      };

      r.onend = () => {
        if (!isMountedRef.current) return;
        // onend fires after both normal stop AND after onerror — check if onerror already scheduled restart
        if (recognitionRef.current !== r) return; // onerror already handled it
        recognitionRef.current = null;

        if (isListeningRef.current) {
          // Normal end (e.g. browser cut off continuous mode or just breathing pause) — restart immediately
          setTimeout(() => {
            if (isMountedRef.current && isListeningRef.current) {
              recognitionRef.current = createAndStart();
            }
          }, 100);
        } else {
          setIsListening(false);
        }
      };

      if (retryDelay > 0) {
        setTimeout(() => { try { r.start(); } catch (_) {} }, retryDelay);
      } else {
        try { r.start(); } catch (_) {}
      }
      return r;
    };

    recognitionRef.current = createAndStart();
    }
  };

  const autoAdvanceOnSilence = async () => {
    if (isSubmittingAnswerRef.current || isForceClosingRef.current || inFlightRef.current) return;
    isSubmittingAnswerRef.current = true;
    listeningStoppedRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    isListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) { }
    recognitionRef.current = null;
    setIsListening(false);

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      mediaRecorderRef.current = null;
    }

    setTranscript("");
    setFinalTranscript("");
    setInterimTranscript("");
    finalTextRef.current = "";
    transcriptRef.current = "";

    if (!isMountedRef.current) return;

    try {
      consecutiveEmptyAttemptsRef.current = 0;
      console.log("[AutoAdvance] Inactivity auto-advance triggered.");
      await sendRef.current("(No response provided - timed out)");
    } catch (err) {
      console.error("[AutoAdvance Error]", err);
    } finally {
      isSubmittingAnswerRef.current = false;
    }
  };
  autoAdvanceOnSilenceRef.current = autoAdvanceOnSilence;


  const stopAndSend = async () => {
    // If user clicks Finish Answering during sentence wrap-up, finalize immediately
    if (isFinishingSentenceRef.current) {
      console.log("[SpeechBoundary] Candidate clicked finish during wrap-up window.");
      if (triggerWrapUpCompletionRef.current) {
        await triggerWrapUpCompletionRef.current();
      }
      return;
    }

    if (isSubmittingAnswerRef.current || isForceClosingRef.current) {
      console.log("[StopAndSend] Already submitting or force closing. Ignoring duplicate call.");
      return;
    }
    isSubmittingAnswerRef.current = true;
    // Set the guard FIRST so any in-flight auto-save timers are cancelled
    listeningStoppedRef.current = true;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    isListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) { }
    recognitionRef.current = null;
    setIsListening(false);

    try {
      let audioBlob: Blob | null = null;
      if (mediaRecorderRef.current) {
        const recorder = mediaRecorderRef.current;
        mediaRecorderRef.current = null;
        try {
          const stopPromise = new Promise<Blob>((resolve) => {
            const timer = setTimeout(() => {
              resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
            }, 600);
            recorder.onstop = () => {
              clearTimeout(timer);
              resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
            };
          });
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
          recorder.stream.getTracks().forEach((t) => t.stop());
          audioBlob = await stopPromise;
        } catch (recErr) {
          console.warn("[MediaRecorder Stop Error]", recErr);
        }
      }

      let finalAnswer = transcriptRef.current.trim();
      const capturedTranscript = transcript?.trim();
      if (!finalAnswer && capturedTranscript) finalAnswer = capturedTranscript;

      // Opportunistic fast cloud Whisper refinement
      // Never block the user for more than 2.0s if answer exists, or 3.0s if empty
      if (audioBlob && audioBlob.size > 1000) {
        setIsTranscribing(true);
        console.log("[STT] Refining audio transcript with cloud Whisper...");
        try {
          const maxWaitMs = finalAnswer.length > 0 ? 2000 : 3000;
          const timeoutPromise = new Promise<{ text: string }>((resolve) =>
            setTimeout(() => {
              console.warn(`[STT] Cloud transcription timed out after ${maxWaitMs}ms. Using local transcript.`);
              resolve({ text: finalAnswer });
            }, maxWaitMs)
          );

          const cloudTxt = await Promise.race([
            transcribeAudio(audioBlob, finalAnswer, inviteToken),
            timeoutPromise
          ]);

          if (isMountedRef.current && cloudTxt?.text) {
            const whisperText = cloudTxt.text.trim();
            if (whisperText.length > 0) {
              console.log("[STT] Cloud transcribed successfully:", whisperText.substring(0, 50));
              finalAnswer = whisperText;
            }
          }
        } catch (err) {
          console.error("[Transcribe Error]", err);
        } finally {
          setIsTranscribing(false);
        }
      }

      if (!finalAnswer && capturedTranscript) finalAnswer = capturedTranscript;

      setTranscript(""); 
      setFinalTranscript("");
      setInterimTranscript("");
      finalTextRef.current = "";
      transcriptRef.current = ""; // Synchronously reset the ref to avoid race conditions!

      if (!isMountedRef.current) return;

      if (finalAnswer) {
        // ── Filler Detection ──────────────────────────────────────────────────
        // If the entire captured text is just acknowledgements or filler words,
        // do not send it as an answer. Instead send "(No Response)" so the
        // backend records the turn correctly without scoring garbage speech.
        // ── Filler Detection ──────────────────────────────────────────────────
        if (!isMeaningfulAnswer(finalAnswer)) {
          if (consecutiveEmptyAttemptsRef.current === 0) {
            consecutiveEmptyAttemptsRef.current += 1;
            console.warn(`[StopAndSend] Filler-only answer detected ("${finalAnswer.substring(0, 60)}"). Asking to repeat once.`);
            await speak("I didn't catch that clearly. Could you please repeat your answer?");
            setTimeout(() => {
              isSubmittingAnswerRef.current = false;
              startListening(activeQuestionIdRef.current);
            }, 500);
            return;
          } else {
            console.warn("[StopAndSend] Repeated filler answer. Advancing.");
            consecutiveEmptyAttemptsRef.current = 0;
            await sendRef.current("(No response captured)");
            return;
          }
        } else {
          consecutiveEmptyAttemptsRef.current = 0;
          console.log(`[StopAndSend] Sending answer (${finalAnswer.length} chars).`);
          await sendRef.current(finalAnswer);
        }
      } else {
        // No transcript and no audio
        if (consecutiveEmptyAttemptsRef.current === 0) {
          consecutiveEmptyAttemptsRef.current += 1;
          console.warn("[StopAndSend] No answer captured (attempt 1). Asking to repeat once.");
          await speak("I didn't catch that clearly. Could you please repeat your answer?");
          setTimeout(() => {
            isSubmittingAnswerRef.current = false;
            startListening(activeQuestionIdRef.current);
          }, 500);
          return;
        } else {
          console.warn("[StopAndSend] Repeated empty answer. Advancing.");
          consecutiveEmptyAttemptsRef.current = 0;
          await sendRef.current("(No response captured)");
          return;
        }
      }
    } catch (err) {
      console.error("[StopAndSend Error]", err);
    } finally {
      setIsTranscribing(false);
      isSubmittingAnswerRef.current = false;
    }
  };
  stopAndSendRef.current = stopAndSend;

  const cancelListening = () => {
    isSubmittingAnswerRef.current = false;
    isListeningRef.current = false;
    listeningStoppedRef.current = true;
    try { recognitionRef.current?.stop(); } catch (_) { }
    recognitionRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setTranscript(""); finalTextRef.current = "";
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      } catch (e) {}
      mediaRecorderRef.current = null;
    }
  };

  // ── Executive Soft Close Implementation ──
  const executeSoftClose = async () => {
    if (softCloseExecutedRef.current) return;
    softCloseExecutedRef.current = true;
    isForceClosingRef.current = true;
    isFinishingSentenceRef.current = false;
    setIsFinishingSentence(false);
    setStage("closing");

    stopSpeaking();
    cancelListening();

    try {
      console.log("[SoftClose] Requesting personalized closing sign-off from backend...");
      const closingData = await fetchInterviewClosing(interviewId, candidateName, jobRole, inviteToken);
      const textToSpeak = closingData?.closing_text?.trim() ||
        `Thank you${candidateName && candidateName.trim().toLowerCase() !== "there" ? `, ${candidateName.trim()}` : ""}. Our time for the interview has concluded. We appreciate you sharing your experience today, and our recruitment team will be in touch regarding next steps.`;

      console.log("[SoftClose] Speaking personalized closing:", textToSpeak);
      await speak(textToSpeak, true);
    } catch (err) {
      console.error("[SoftClose] Error speaking closing sign-off:", err);
    } finally {
      if (isMountedRef.current) {
        console.log("[SoftClose] Sign-off voice playback completed. Calling onComplete.");
        onComplete();
      }
    }
  };
  executeSoftCloseRef.current = executeSoftClose;

  // ── Sentence Wrap-Up Completion Implementation ──
  const triggerWrapUpCompletion = async () => {
    if (wrapUpCompletedRef.current || isSubmittingAnswerRef.current) return;
    wrapUpCompletedRef.current = true;
    isSubmittingAnswerRef.current = true;
    listeningStoppedRef.current = true;
    isFinishingSentenceRef.current = false;
    setIsFinishingSentence(false);

    console.log("[SpeechBoundary] Finalizing candidate's completed sentence...");

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    isListeningRef.current = false;
    try { recognitionRef.current?.stop(); } catch (_) {}
    recognitionRef.current = null;
    setIsListening(false);

    let audioBlob: Blob | null = null;
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      try {
        const stopPromise = new Promise<Blob>((resolve) => {
          const timer = setTimeout(() => {
            resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
          }, 500);
          recorder.onstop = () => {
            clearTimeout(timer);
            resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
          };
        });
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        recorder.stream.getTracks().forEach((t) => t.stop());
        audioBlob = await stopPromise;
      } catch (recErr) {
        console.warn("[SpeechBoundary] MediaRecorder Stop Error:", recErr);
      }
    }

    let finalAnswer = transcriptRef.current.trim();
    if (!finalAnswer && finalTextRef.current.trim()) {
      finalAnswer = finalTextRef.current.trim();
    }

    // Opportunistic fast cloud Whisper refinement if audio blob exists
    if (audioBlob && audioBlob.size > 1000 && (!finalAnswer || finalAnswer.length < 15)) {
      try {
        const timeoutPromise = new Promise<{ text: string }>((resolve) =>
          setTimeout(() => resolve({ text: finalAnswer }), 2000)
        );
        const cloudTxt = await Promise.race([
          transcribeAudio(audioBlob, finalAnswer, inviteToken),
          timeoutPromise
        ]);
        if (cloudTxt?.text && cloudTxt.text.trim().length > 0) {
          finalAnswer = cloudTxt.text.trim();
        }
      } catch (err) {
        console.warn("[SpeechBoundary] Whisper refinement fallback:", err);
      }
    }

    // Save final completed sentence to DB for active question
    const qId = activeQuestionIdRef.current || meta?.question_id;
    if (qId && finalAnswer) {
      try {
        console.log(`[SpeechBoundary] Successfully saved final sentence for Q ${qId}: "${finalAnswer.substring(0, 60)}..."`);
        await submitCandidateAnswer(inviteToken || "", qId, finalAnswer);
      } catch (dbErr) {
        console.warn("[SpeechBoundary] Error saving final answer:", dbErr);
      }
    }

    setTranscript("");
    setFinalTranscript("");
    setInterimTranscript("");
    finalTextRef.current = "";
    transcriptRef.current = "";
    isSubmittingAnswerRef.current = false;

    // Transition smoothly to warm personalized closing
    await executeSoftClose();
  };
  triggerWrapUpCompletionRef.current = triggerWrapUpCompletion;

  // Cleanup speech recognition and media recorder on unmount to prevent resource leaks
  useEffect(() => {
    return () => {
      cancelListening();
    };
  }, []);


  const lastAI = [...messages].reverse().find(m => m.role === "ai");
  const rawQuestionText = meta?.question_text || lastAI?.content || "Waiting for your interview to start...";
  const currentQuestionText = cleanQuestionCardText(rawQuestionText);

  const handleInteraction = () => {
    if (isListening) {
      stopAndSend();
    } else if (!isSpeaking && !isThinking && !isTranscribing) {
      startListening();
    }
  };

  // ── Derive status label ──
  const getStatusLabel = () => {
    if (stage === "closing") return "Concluding Assessment";
    if (isFinishingSentence) return `Wrap-up (${sentenceWrapUpSeconds}s)`;
    if (isSpeaking) return "AI is speaking";
    if (isListening) return "Listening to you";
    if (isThinking) return thinkingPhase;
    if (isTranscribing) return "Transcribing";
    return "Ready";
  };

  return (
    <div className="h-full w-full text-foreground flex flex-col items-center justify-between overflow-hidden font-sans relative bg-mesh">
      
      {/* Animated Background Layers */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{
            x: [0, 30, -20, 0],
            y: [0, -20, 10, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-[10%] left-[20%] w-[400px] h-[400px] rounded-full bg-cyan-500/[0.04] blur-[100px]"
        />
        <motion.div
          animate={{
            x: [0, -20, 30, 0],
            y: [0, 20, -10, 0],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[20%] right-[15%] w-[350px] h-[350px] rounded-full bg-blue-600/[0.04] blur-[100px]"
        />
        <motion.div
          animate={{
            x: [0, 15, -15, 0],
            y: [0, -15, 20, 0],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          className="absolute top-[50%] right-[40%] w-[250px] h-[250px] rounded-full bg-violet-500/[0.03] blur-[80px]"
        />
      </div>

      {/* 1. Top Section: AI Identity */}
      <div className="flex flex-col items-center z-10 animate-slide-up shrink-0 mt-4 md:mt-6">
        {/* Status Chip */}
        <div className="flex items-center gap-2.5 mb-3 px-4 py-2 rounded-full glass-card shadow-lg">
          <div className="relative flex items-center justify-center">
            <span className={`w-2 h-2 rounded-full ${
              stage === "closing" ? 'bg-cyan-400' :
              isFinishingSentence ? 'bg-amber-400' :
              isSpeaking ? 'bg-cyan-400' : isListening ? 'bg-emerald-400' : isThinking ? 'bg-amber-400' : 'bg-cyan-400'
            }`} />
            <span className={`absolute w-2 h-2 rounded-full animate-ping ${
              stage === "closing" ? 'bg-cyan-400/50' :
              isFinishingSentence ? 'bg-amber-400/50' :
              isSpeaking ? 'bg-cyan-400' : isListening ? 'bg-emerald-400' : isThinking ? 'bg-amber-400' : 'bg-cyan-400/50'
            }`} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-foreground/70">
            Scaloz Engine
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 border-l border-border/50 pl-2.5">
            {getStatusLabel()}
          </span>
        </div>
        
        {/* Dynamic Heading */}
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          {stage === "closing" ? (
            <span className="flex items-center gap-2 text-cyan-500 dark:text-cyan-400">
              Interview Concluding
              <span className="flex gap-0.5">
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              </span>
            </span>
          ) : isFinishingSentence ? (
            <span className="flex items-center gap-2 text-amber-500 dark:text-amber-400">
              Wrapping up your final thought...
              <span className="flex gap-0.5">
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              </span>
            </span>
          ) : isSpeaking ? (
            <span className="flex items-center gap-2">
              Scaloz AI is speaking
              <span className="flex gap-0.5">
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              </span>
            </span>
          ) : isListening ? (
            <span className="text-emerald-600 dark:text-emerald-400">Listening to your response</span>
          ) : isThinking ? (
            "Processing your answer..."
          ) : (
            "Scaloz AI is ready"
          )}
        </h2>
        
        {/* Quick Skip (Disabled) */}
        <div className="h-10 flex items-center justify-center mt-1" />
      </div>

      {/* 2. Middle Section: The AI Orb Portal */}
      <div className="relative flex-1 w-full flex items-center justify-center z-10 min-h-[160px]">
        {/* Outer Glow Rings */}
        <div className="absolute w-56 h-56 md:w-64 md:h-64 rounded-full">
          <motion.div
            animate={{
              scale: isSpeaking || isListening ? [1, 1.08, 1] : 1,
              opacity: isSpeaking || isListening ? [0.15, 0.3, 0.15] : 0.08,
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className={`absolute inset-0 rounded-full border ${
              isSpeaking ? 'border-cyan-400/20' : isFinishingSentence ? 'border-amber-400/30' : isListening ? 'border-emerald-400/20' : 'border-border/20'
            }`}
          />
          <motion.div
            animate={{
              scale: isSpeaking || isListening ? [1, 1.15, 1] : 1,
              opacity: isSpeaking || isListening ? [0.08, 0.2, 0.08] : 0.04,
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            className={`absolute -inset-4 rounded-full border ${
              isSpeaking ? 'border-cyan-400/10' : isListening ? 'border-emerald-400/10' : 'border-border/10'
            }`}
          />
        </div>

        {/* Main Orb Container */}
        <motion.div
          animate={{
            scale: isSpeaking ? [1, 1.02, 1] : isListening ? [1, 1.01, 1] : 1,
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="relative w-40 h-40 md:w-48 md:h-48 rounded-full"
        >
          {/* Glassmorphic Orb Shell */}
          <div className="absolute inset-0 rounded-full overflow-hidden backdrop-blur-2xl bg-background/40 dark:bg-black/20 border border-border/50 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            {/* Inner gradient glow */}
            <div className={`absolute inset-0 transition-all duration-700 ${
              isSpeaking ? 'bg-gradient-to-br from-cyan-500/20 via-transparent to-blue-500/20' :
              isFinishingSentence ? 'bg-gradient-to-br from-amber-500/25 via-transparent to-orange-500/20' :
              isListening ? 'bg-gradient-to-br from-emerald-500/20 via-transparent to-teal-500/20' :
              isThinking ? 'bg-gradient-to-br from-amber-500/20 via-transparent to-orange-500/20' :
              'bg-gradient-to-br from-slate-500/10 via-transparent to-slate-500/10'
            }`} />
          </div>

          {/* Visualizer inside the orb */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center relative">
              <VoiceVisualizer
                isSpeaking={isSpeaking}
                isListening={isListening}
                isThinking={isThinking}
                isTranscribing={isTranscribing}
                volume={isSpeaking ? 0.8 : isListening ? 0.4 : 0.1}
              />
            </div>
          </div>
        </motion.div>
      </div>

      {/* 3. Bottom Section: Context Cards & Controls */}
      <div className="w-full max-w-3xl space-y-3 z-10 shrink-0 mb-4 px-4">

        {/* Question Area */}
        <motion.div
          layout
          className="glass-card p-4.5 md:p-6 relative overflow-hidden group min-h-[90px] max-h-[150px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {/* Animated left accent */}
          <div className={`absolute top-0 left-0 w-1 h-full rounded-full transition-colors duration-500 ${
            isSpeaking ? 'bg-gradient-to-b from-cyan-400 to-blue-500' :
            isListening ? 'bg-gradient-to-b from-emerald-400 to-teal-500' :
            'bg-gradient-to-b from-primary to-blue-500'
          }`} />
          
          <div className="flex items-center gap-2 mb-3 ml-3">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              {stage === "intro" ? "First Question" : "Current Question"}
            </span>
            {meta?.current_question_index !== undefined && meta?.total_questions && (
              <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                {(meta.current_question_index || 0) + 1}/{meta.total_questions}
              </span>
            )}
          </div>
          <p className="text-base md:text-lg text-foreground font-normal leading-relaxed tracking-tight ml-3">
            "{currentQuestionText}"
          </p>
        </motion.div>

        {/* Transcript Area - Commented out as requested
        <div ref={transcriptContainerRef} className="glass-card p-3.5 md:p-4 min-h-[68px] max-h-[120px] overflow-y-auto relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${
              isListening ? 'bg-emerald-400 animate-pulse' : 'bg-primary/40'
            }`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Live Transcript
            </span>
          </div>
          <p className={`text-sm md:text-base tracking-wide leading-relaxed ${
            (finalTranscript || interimTranscript || transcript)
              ? 'text-foreground'
              : 'text-muted-foreground/60 italic'
          }`}>
            {finalTranscript && (
              <span className="font-medium mr-1">{finalTranscript}</span>
            )}
            {interimTranscript && (
              <span className="text-muted-foreground/80 italic">{interimTranscript}</span>
            )}
            {!finalTranscript && !interimTranscript && (
              <span>{transcript || (isSpeaking ? "Interviewer speaking..." : "Waiting for your response...")}</span>
            )}
            {isListening && (finalTranscript || interimTranscript || transcript) && (
              <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="inline-block w-0.5 h-4 bg-emerald-400 ml-0.5 align-text-bottom"
              />
            )}
          </p>
        </div>
        */}

        {/* Main Action Button */}
        <div className="flex flex-col items-center gap-2 pb-2 md:pb-0">
          {/* Sentence Wrap-Up Capsule Indicator */}
          {isFinishingSentence && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-semibold shadow-sm backdrop-blur-sm"
            >
              <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span>Assessment time reached • <strong>{sentenceWrapUpSeconds}s</strong> left to conclude</span>
            </motion.div>
          )}

          {isSpeaking ? (
            /* Completely remove tap answer button while speaking */
            <div className="h-14" />
          ) : isThinking || isTranscribing ? (
            <div className="flex items-center gap-4 px-8 py-4 rounded-full glass-card text-muted-foreground font-bold uppercase tracking-[0.2em] text-[11px] cursor-not-allowed">
              <div className="flex gap-1.5">
                <motion.span animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                  className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                <motion.span animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }}
                  className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                <motion.span animate={{ y: [0, -4, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.3 }}
                  className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400' : 'bg-cyan-400'}`} />
              </div>
              {isTranscribing ? "Syncing..." : "Thinking..."}
            </div>
          ) : isListening ? (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => stopAndSendRef.current()}
                className={`flex flex-col items-center justify-center gap-1 px-8 md:px-12 py-2.5 md:py-3 rounded-full shadow-sm backdrop-blur-sm transition-all cursor-pointer group hover:scale-105 active:scale-95 ${
                  isFinishingSentence
                    ? "bg-amber-500/10 border border-amber-500/50 hover:bg-amber-500/20"
                    : "bg-emerald-500/10 border border-emerald-500/50 hover:bg-emerald-500/20"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Mic className={`w-4 h-4 animate-pulse group-hover:animate-none ${isFinishingSentence ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className={`text-[12px] font-black uppercase tracking-[0.2em] ${isFinishingSentence ? 'text-amber-500' : 'text-emerald-500'}`}>
                    Finish Answering
                  </span>
                </div>
                <span className={`text-[9px] uppercase tracking-widest font-mono font-semibold ${
                  isFinishingSentence
                    ? 'text-amber-600/80 dark:text-amber-400/80'
                    : 'text-emerald-600/70 dark:text-emerald-400/70'
                }`}>
                  Click when done speaking
                </span>
              </button>
            </div>
          ) : (
            <div className="h-14" />
          )}
        </div>
      </div>
    </div>
  );
}
