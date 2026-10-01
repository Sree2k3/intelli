import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Send, CheckCircle2, XCircle, Loader2, ChevronRight,
  Code2, Lightbulb, AlertTriangle, Clock, Terminal, ChevronDown,
  ChevronUp, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeCode, submitCodingRound, getCodingQuestions } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const LANGUAGE_OPTIONS = [
  { label: "Python", value: "python", monacoLang: "python" },
  { label: "C++", value: "cpp", monacoLang: "cpp" },
  { label: "C", value: "c", monacoLang: "c" },
  { label: "Java", value: "java", monacoLang: "java" },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "text-emerald-400 bg-emerald-400/10",
  medium: "text-amber-400 bg-amber-400/10",
  hard: "text-rose-400 bg-rose-400/10",
};

interface CodingRoundProps {
  interviewId: string;
  inviteToken: string;
  onComplete: (results: any) => void;
}

interface TestResult {
  testIndex: number;
  passed: boolean;
  output: string;
  expected?: string;
  error?: string;
}

export default function CodingRound({ interviewId, inviteToken, onComplete }: CodingRoundProps) {
  const { toast } = useToast();
  const [codingQuestions, setCodingQuestions] = useState<any[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runResults, setRunResults] = useState<any>(null);
  const [consoleOutput, setConsoleOutput] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timer, setTimer] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [userCodes, setUserCodes] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(`xevyte_progress_${interviewId}`);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Error loading saved progress:", e);
      return {};
    }
  });

  // Persist userCodes to localStorage
  useEffect(() => {
    if (interviewId) {
      localStorage.setItem(`xevyte_progress_${interviewId}`, JSON.stringify(userCodes));
    }
  }, [userCodes, interviewId]);

  // Sync state when interviewId changes (prevents stale carry-over if component is reused)
  useEffect(() => {
    if (interviewId) {
      try {
        const saved = localStorage.getItem(`xevyte_progress_${interviewId}`);
        const parsed = saved ? JSON.parse(saved) : {};
        setUserCodes(parsed);
      } catch (e) {
        console.error("Error syncing progress:", e);
        setUserCodes({});
      }
    }
  }, [interviewId]);
  // Load coding questions
  useEffect(() => {
    const loadQuestions = async () => {
      try {
        console.log("Fetching coding questions for interview:", interviewId);
        const questions = await getCodingQuestions(interviewId, inviteToken);
        console.log("Questions received:", questions);
        
        if (questions && Array.isArray(questions) && questions.length > 0) {
          setCodingQuestions(questions);
          // Load saved code or starter code for the first question
          const q = questions[0];
          const key = `${q.id}_${language}`;
          
          // Re-fetch progress from storage to be absolutely sure we are using the right context
          const savedProgress = localStorage.getItem(`xevyte_progress_${interviewId}`);
          const currentProgress = savedProgress ? JSON.parse(savedProgress) : {};
          
          const initialCode = currentProgress[key] || q.starter_code?.[language] || getDefaultStarter(language);
          setCode(initialCode);
        } else {
          console.warn("No coding questions found or invalid format:", questions);
          setCodingQuestions([]);
        }
      } catch (err: any) {
        console.error("Error loading questions:", err);
        toast({ title: "Error loading coding questions", description: err.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    loadQuestions();
  }, [interviewId, inviteToken]);

  // Timer
  useEffect(() => {
    if (loading || submitted) return;
    const interval = setInterval(() => setTimer(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [loading, submitted]);

  // Update code when language changes
  useEffect(() => {
    if (codingQuestions && codingQuestions.length > 0 && currentQIndex < codingQuestions.length) {
      const q = codingQuestions[currentQIndex];
      const key = `${q.id}_${language}`;
      const savedCode = userCodes[key];
      
      if (savedCode !== undefined) {
        setCode(savedCode);
      } else {
        const starter = q?.starter_code?.[language] || getDefaultStarter(language);
        setCode(starter);
      }
    }
  }, [language, currentQIndex, codingQuestions]); // Added codingQuestions as dependency

  // Debug logs for state tracking
  useEffect(() => {
    console.log("CodingRound state - Questions:", codingQuestions.length, "Index:", currentQIndex);
    if (codingQuestions.length > 0) {
      console.log("Current Question:", codingQuestions[currentQIndex]);
    }
  }, [codingQuestions, currentQIndex]);

  const currentQuestion = (codingQuestions && codingQuestions.length > 0 && currentQIndex < codingQuestions.length) 
    ? codingQuestions[currentQIndex] 
    : null;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleRun = async () => {
    if (!currentQuestion) return;
    setIsRunning(true);
    setShowConsole(true);
    setConsoleOutput("Running tests...\n");
    setRunResults(null);

    try {
      // Get visible test cases safely
      const testCases = Array.isArray(currentQuestion.test_cases) ? currentQuestion.test_cases : [];
      const visibleTests = testCases.filter((tc: any) => !tc.is_hidden);

      const result = await executeCode(
        interviewId,
        code,
        language,
        visibleTests.map((tc: any) => ({
          input: tc.input ?? tc.Input ?? "",
          // Try all possible field name variants the AI might have used
          expectedOutput: tc.expected_output ?? tc.expectedOutput ?? tc.output ?? tc.Output ?? "",
        })),
        inviteToken,
      );

      setRunResults(result);
      
      // Display the formatted output from the backend, or build it from results
      if (result.output) {
        setConsoleOutput(result.output);
      } else if (result.results && result.results.length > 0) {
        const lines = [`${result.passedTests}/${result.totalTests} test cases passed`, "─".repeat(40)];
        result.results.forEach((r: any, i: number) => {
          const icon = r.status === "passed" ? "✓" : "✗";
          lines.push(`${icon} Test Case ${i + 1}: ${r.status.toUpperCase()}`);
          lines.push(`  Input:    ${r.input}`);
          lines.push(`  Expected: ${r.expectedOutput || "N/A"}`);
          lines.push(`  Output:   ${r.actualOutput || "(empty)"}`);
          lines.push("");
        });
        setConsoleOutput(lines.join("\n"));
      } else {
        setConsoleOutput("No test results returned.");
      }
    } catch (err: any) {
      setConsoleOutput(`Error: ${err.message}`);
      toast({ title: "Execution Error", description: err.message, variant: "destructive" });
    }
    setIsRunning(false);
  };

  const handleSubmit = async () => {
    if (!currentQuestion) return;
    setIsSubmitting(true);

    try {
      const result = await submitCodingRound(
        interviewId,
        currentQuestion.id,
        code,
        language,
        inviteToken,
      );

      setSubmitted(true);
      setRunResults(result);
      setShowConsole(true);

      // Build console output from per-test results if available
      if (result.results && result.results.length > 0) {
        const lines = [`${result.passedTests ?? 0}/${result.totalTests ?? result.results.length} test cases passed`, "─".repeat(40)];
        result.results.forEach((r: any, i: number) => {
          const icon = r.status === "passed" ? "✓" : "✗";
          lines.push(`${icon} Test Case ${i + 1}: ${r.status.toUpperCase()}`);
          lines.push(`  Input:    ${r.input}`);
          lines.push(`  Expected: ${r.expectedOutput || "N/A"}`);
          lines.push(`  Output:   ${r.actualOutput || "(empty)"}`);
          lines.push("");
        });
        setConsoleOutput(lines.join("\n"));
      } else {
        setConsoleOutput(`Score: ${result.score ?? 0}%\nSubmission complete.`);
      }

      const passed = result.passedTests ?? 0;
      const total = result.totalTests ?? 0;
      const score = result.score ?? 0;

      toast({
        title: "Solution Submitted! 🎉",
        description: total > 0
          ? `${passed}/${total} test cases passed (${score}%)`
          : `Score: ${score}%`,
      });

      const isLast = currentQIndex === codingQuestions.length - 1;
      if (isLast) {
        // Clear progress when successfully completed
        localStorage.removeItem(`xevyte_progress_${interviewId}`);
        setTimeout(() => {
          onComplete(result);
        }, 3000);
      }
    } catch (err: any) {
      toast({ title: "Submission Error", description: err.message, variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const handleChangeIndex = (newIdx: number) => {
    if (!codingQuestions || codingQuestions.length === 0) return;
    
    // Clamp index between 0 and length - 1
    const clampedIdx = Math.max(0, Math.min(newIdx, codingQuestions.length - 1));
    console.log(`Switching question from ${currentQIndex} to ${clampedIdx}`);
    
    setCurrentQIndex(clampedIdx);
    setSubmitted(false);
    setRunResults(null);
    setConsoleOutput("");
    
    // Code will be updated by the useEffect hook watching currentQIndex
    toast({ title: `Moving to Problem ${clampedIdx + 1}` });
  };

  const handleNext = () => handleChangeIndex(currentQIndex + 1);
  const handlePrev = () => handleChangeIndex(currentQIndex - 1);
  const handleReset = () => {
    if (!currentQuestion) return;
    const starter = currentQuestion?.starter_code?.[language] || getDefaultStarter(language);
    setCode(starter);
    const key = `${currentQuestion.id}_${language}`;
    setUserCodes(prev => ({ ...prev, [key]: starter }));
    toast({ title: "Code Reset", description: "Reverted to starter boilerplate." });
  };

  if (loading) {
    return (
      <div className="min-h-[600px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <h2 className="text-xl font-semibold">Loading Coding Challenge...</h2>
          <p className="text-sm text-muted-foreground">Preparing your coding environment</p>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-[600px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-warning mx-auto" />
          <h2 className="text-xl font-semibold">No Coding Questions</h2>
          <p className="text-sm text-muted-foreground">No coding challenges are configured for this interview.</p>
          <Button variant="hero" onClick={() => onComplete(null)}>
            Continue to Results
          </Button>
        </div>
      </div>
    );
  }

  if (submitted) {
    const isLast = currentQIndex === codingQuestions.length - 1;
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="min-h-[600px] flex items-center justify-center"
      >
        <div className="text-center space-y-6 max-w-md mx-auto">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2 }}
            className="h-20 w-20 rounded-full bg-success/10 flex items-center justify-center mx-auto"
          >
            <CheckCircle2 className="h-10 w-10 text-success" />
          </motion.div>
          <h2 className="text-2xl font-bold">Solution Submitted!</h2>
          <div className="space-y-2">
            <div className="text-4xl font-bold gradient-text">
              {runResults?.passedTests}/{runResults?.totalTests}
            </div>
            <p className="text-sm text-muted-foreground">Test Cases Passed</p>
          </div>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatTime(timer)}
            </span>
            <span className="flex items-center gap-1">
              <Code2 className="h-4 w-4" />
              {LANGUAGE_OPTIONS.find(l => l.value === language)?.label}
            </span>
          </div>
          
          {isLast ? (
            <p className="text-sm text-muted-foreground animate-pulse">
              Completing interview...
            </p>
          ) : (
            <Button variant="hero" onClick={handleNext} className="gap-2 px-8">
              Next Challenge
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </motion.div>
    );
  }

  const monacoLang = LANGUAGE_OPTIONS.find((l) => l.value === language)?.monacoLang || "python";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-h-[900px]">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center">
            <Code2 className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Coding Round</h3>
            <span className="text-xs text-muted-foreground">
              Problem {currentQIndex + 1} of {codingQuestions.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Timer */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary/50 border border-border/50">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-mono font-medium">{formatTime(timer)}</span>
          </div>

          {/* Language Selector */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-8 rounded-md bg-secondary border border-border/50 px-3 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleReset}
            className="h-8 px-2 text-muted-foreground hover:text-rose-400 hover:bg-rose-400/10 gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Reset</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Left Panel — Problem Description */}
        <div className="w-full lg:w-[420px] border-b lg:border-b-0 lg:border-r border-border/50 flex flex-col bg-card/30 overflow-y-auto max-h-[30vh] lg:max-h-none shrink-0">
          <div className="p-5 space-y-5">
            {/* Title & Difficulty */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-bold">{currentQuestion.title}</h2>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${DIFFICULTY_COLORS[currentQuestion.difficulty] || ""}`}>
                  {currentQuestion.difficulty}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {currentQuestion.description}
            </div>

            {/* Examples */}
            {Array.isArray(currentQuestion.examples) && currentQuestion.examples.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Examples</h4>
                {currentQuestion.examples.map((ex: any, i: number) => (
                  <div key={i} className="rounded-md border border-border/50 bg-secondary/30 p-3 space-y-1.5">
                    <div className="text-xs">
                      <span className="font-semibold text-muted-foreground">Input: </span>
                      <code className="font-mono text-foreground">{ex.input}</code>
                    </div>
                    <div className="text-xs">
                      <span className="font-semibold text-muted-foreground">Output: </span>
                      <code className="font-mono text-foreground">{ex.output}</code>
                    </div>
                    {ex.explanation && (
                      <div className="text-xs text-muted-foreground mt-1">
                        <span className="font-semibold">Explanation: </span>
                        {ex.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Constraints */}
            {Array.isArray(currentQuestion.constraints) && currentQuestion.constraints.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Constraints</h4>
                <ul className="space-y-1">
                  {currentQuestion.constraints.map((c: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <code className="font-mono">{c}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Hints */}
            {Array.isArray(currentQuestion.hints) && currentQuestion.hints.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHints(!showHints)}
                  className="flex items-center gap-2 text-sm font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                >
                  <Lightbulb className="h-4 w-4" />
                  {showHints ? "Hide Hints" : "Show Hints"}
                  {showHints ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <AnimatePresence>
                  {showHints && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-2">
                        {currentQuestion.hints.map((hint: string, i: number) => (
                          <div key={i} className="text-xs text-amber-400/80 bg-amber-400/5 rounded-md p-3 border border-amber-400/10">
                            💡 {hint}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel — Editor + Console */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Monaco Editor */}
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              language={monacoLang}
              theme="vs-dark"
              value={code}
              onChange={(v) => {
                const newCode = v || "";
                setCode(newCode);
                if (currentQuestion) {
                  const key = `${currentQuestion.id}_${language}`;
                  setUserCodes(prev => ({ ...prev, [key]: newCode }));
                }
              }}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 },
                lineNumbers: "on",
                renderLineHighlight: "all",
                bracketPairColorization: { enabled: true },
                autoClosingBrackets: "always",
                autoClosingQuotes: "always",
                formatOnPaste: true,
                tabSize: 4,
                wordWrap: "on",
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                cursorBlinking: "smooth",
                smoothScrolling: true,
              }}
            />
          </div>

          {/* Console Output */}
          <div className="border-t border-border/50">
            <button
              onClick={() => setShowConsole(!showConsole)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors bg-card/50"
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5" />
                Console Output
                {runResults && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    runResults.status === "error"
                      ? "bg-destructive/10 text-destructive"
                      : runResults.passedTests === runResults.totalTests
                        ? "bg-emerald-400/10 text-emerald-400"
                        : "bg-amber-400/10 text-amber-400"
                  }`}>
                    {runResults.passedTests}/{runResults.totalTests} passed
                  </span>
                )}
              </div>
              {showConsole ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>

            <AnimatePresence>
              {showConsole && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 180 }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <pre className="h-[180px] overflow-auto bg-[#1a1a2e] px-4 py-3 text-xs font-mono text-slate-300 whitespace-pre-wrap">
                    {consoleOutput || "Run your code to see output here..."}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-start gap-2 px-4 py-3 border-t border-border/50 bg-card/50">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRun}
              disabled={isRunning || isSubmitting}
              className="gap-1.5"
            >
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isRunning ? "Running..." : "Run Tests"}
            </Button>

            {codingQuestions.length > 1 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrev}
                  disabled={currentQIndex === 0 || isRunning || isSubmitting}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNext}
                  disabled={currentQIndex === codingQuestions.length - 1 || isRunning || isSubmitting}
                >
                  Next
                </Button>
              </>
            )}

            <Button
              variant="hero"
              size="sm"
              onClick={handleSubmit}
              disabled={isRunning || isSubmitting || !code.trim()}
              className="gap-1.5 px-6 ml-2"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isSubmitting ? "Submitting..." : "Submit Solution"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getDefaultStarter(language: string): string {
  switch (language) {
    case "python":
      return '# Write your solution here\ndef solution():\n    pass\n';
    case "javascript":
      return '// Write your solution here\nfunction solution() {\n  \n}\n';
    case "java":
      return '// Write your solution here\nclass Solution {\n    public String solution(String input) {\n        return "";\n    }\n}\n';
    case "cpp":
      return '// Write your solution here\n#include <iostream>\n#include <string>\nusing namespace std;\n\nclass Solution {\npublic:\n    string solution(string input) {\n        return "";\n    }\n};\n';
    case "c":
      return '// Write your solution here\n#include <stdio.h>\n#include <string.h>\n\nvoid solution(char* input) {\n    \n}\n';
    default:
      return '# Write your solution here\n';
  }
}
