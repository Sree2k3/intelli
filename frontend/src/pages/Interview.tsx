import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { QuestionSkeletonLoader } from "@/components/interview/QuestionSkeletonLoader";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, ArrowRight, Loader2, CheckCircle2, Copy, Link as LinkIcon,
  Upload, FileText, Trash2, Check, X, Code2, MessageSquare, Lightbulb, Pencil,
  Plus, RotateCcw, Bot, UserPen, Settings, Clock, Mail, Send, Shield, AlertTriangle, AlertCircle,
  Sparkles, Sliders, ShieldCheck, Calendar, Video, Layers, Target, Scale, SlidersHorizontal,
  Search, Edit2, ArrowLeft, Wand2, Info, Minus, Briefcase, Tag, Globe, Users, Lock, ChevronDown, Eye
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  createInterviewFromJD,
  updateInterview,
  updateInterviewSettings,
  generateQuestions,
  updateQuestionSelection,
  getInterviewQuestions,
  generateInterviewLink,
  extractText,
  parseCodingQuestions,
  generateCodingQuestions,
  createCodingQuestions,
  editCodingQuestion,
  deleteCodingQuestion,
  addCodingQuestion,
  editQuestion as apiEditQuestion,
  addCustomQuestion as apiAddCustomQuestion,
  deleteQuestion as apiDeleteQuestion,
  addInterviewCandidate,
  resendInterviewCandidate,
  getCustomizationSuggestions,
  recommendCodingChallengeTypes,
  getRolesMaster,
  getDepartmentsMaster,
  InterviewSetupMetadata,
} from "@/lib/api";
import { checkQuestionDuplicate, isDuplicateQuestion, findQuestionDuplicate } from "@/lib/questionDuplicateDetector";

const typeIcons: Record<string, any> = {
  technical: Lightbulb,
  coding: Code2,
  behavioral: MessageSquare,
};

const typeColors: Record<string, string> = {
  technical: "bg-primary/10 text-primary",
  coding: "bg-accent/10 text-accent",
  behavioral: "bg-success/10 text-success",
};

const difficultyColors: Record<string, string> = {
  easy: "text-success",
  medium: "text-warning",
  hard: "text-destructive",
};

const INVALID_JD_MESSAGE = "We couldn't detect meaningful content in this text. Make sure it contains valid text from a job description, resume, or role requirements (without random gibberish characters) — or upload a PDF/DOCX/TXT file instead.";

export function validateJobDescription(text: string): { isValid: boolean; message?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { isValid: false, message: "" };
  }

  // 1. Minimum character length (real JDs contain substantial information, at least 50 chars)
  if (trimmed.length < 50) {
    return { isValid: false, message: INVALID_JD_MESSAGE };
  }

  // 2. Minimum word count
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 10) {
    return { isValid: false, message: INVALID_JD_MESSAGE };
  }

  // 3. Gibberish / random character smash check (token with > 40 consecutive chars that is not a URL, email, or path)
  const hasAbnormallyLongWord = words.some((w) => {
    if (w.length <= 40) return false;
    // Allow valid URLs, email addresses, and file paths
    if (/^(https?:\/\/|www\.|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i.test(w)) return false;
    return true;
  });
  if (hasAbnormallyLongWord) {
    return { isValid: false, message: INVALID_JD_MESSAGE };
  }

  // 4. Low character diversity (e.g. repeated single characters "aaaaa bbbbb ccccc")
  const uniqueChars = new Set(trimmed.toLowerCase().replace(/\s+/g, ""));
  if (uniqueChars.size < 8) {
    return { isValid: false, message: INVALID_JD_MESSAGE };
  }

  // 5. Letter character ratio (real JD or resume text is mostly words/letters, not pure symbols/numbers)
  const letters = trimmed.match(/[a-zA-Z]/g) || [];
  if (letters.length / trimmed.length < 0.35) {
    return { isValid: false, message: INVALID_JD_MESSAGE };
  }

  return { isValid: true };
}

export function generateDynamicSuggestions(content: string, role?: string): string[] {
  const text = `${role || ""} ${content || ""}`.toLowerCase();

  // If no content provided yet, return empty list - do not show hardcoded suggestions before JD is provided
  if (!content?.trim() || content.trim().length < 25) {
    return [];
  }

  const suggestions: string[] = [];
  const matches = (keywords: string[]) => keywords.some((k) => text.includes(k));

  if (matches(["react", "next.js", "nextjs", "vue", "angular", "frontend", "redux", "tailwind"])) {
    if (matches(["react", "next.js", "nextjs"])) {
      suggestions.push("React state architecture & performance");
    } else {
      suggestions.push("Component design & frontend performance");
    }
  }

  if (matches(["typescript", " ts ", "ts,", "type safety"])) {
    suggestions.push("TypeScript typing & design patterns");
  }

  if (matches(["python", "django", "fastapi", "flask", "pandas", "numpy"])) {
    suggestions.push("Python async patterns & API architecture");
  }

  if (matches(["java", "spring", "spring boot", "springboot", "hibernate", "jvm"])) {
    suggestions.push("Spring Boot & concurrent multithreading");
  }

  if (matches(["node", "express", "nestjs"])) {
    suggestions.push("Node.js event loop & API design");
  }

  if (matches(["golang", " go ", "go/", "go,", "goroutine"])) {
    suggestions.push("Go concurrency, goroutines & channels");
  }

  if (matches(["c#", ".net", "dotnet", "asp.net"])) {
    suggestions.push(".NET enterprise architecture & async");
  }

  if (matches(["aws", "cloud", "azure", "gcp", "serverless", "lambda"])) {
    suggestions.push("Cloud resilience & auto-scaling");
  }

  if (matches(["kubernetes", "k8s", "docker", "devops", "ci/cd", "terraform", "helm"])) {
    suggestions.push("Container orchestration & CI/CD");
  }

  if (matches(["sql", "postgres", "mysql", "database", "rdbms", "oracle"])) {
    suggestions.push("Database schema & query optimization");
  }

  if (matches(["nosql", "mongodb", "redis", "cassandra", "dynamodb", "elasticsearch"])) {
    suggestions.push("NoSQL modeling & caching strategies");
  }

  if (matches(["system design", "architecture", "microservices", "distributed", "scalability"])) {
    suggestions.push("Distributed systems & architecture");
  }

  if (matches(["kafka", "rabbitmq", "event-driven", "sqs", "pubsub", "streaming"])) {
    suggestions.push("Event streaming & async messaging");
  }

  if (matches(["machine learning", "ai", "llm", "nlp", "rag", "deep learning", "langchain", "openai"])) {
    suggestions.push("AI/LLM pipelines & vector search");
  }

  if (matches(["security", "oauth", "jwt", "owasp", "auth", "cryptography"])) {
    suggestions.push("API security & authentication");
  }

  if (matches(["test", "testing", "jest", "cypress", "unit test", "tdd", "qa"])) {
    suggestions.push("Automated testing & test coverage");
  }

  if (matches(["lead", "principal", "staff", "architect", "manager", "director", "mentor"])) {
    suggestions.push("Architectural trade-offs & tech debt");
    suggestions.push("Engineering leadership & mentoring");
  }

  // If no specific tech was detected from the JD, return role-calibrated suggestions
  if (suggestions.length === 0) {
    suggestions.push(
      "Distributed systems & architecture",
      "Scenario-driven technical questions",
      "Hands-on incident debugging",
      "Behavioral & leadership scenarios",
      "Depth of experience over trivia"
    );
  }

  return Array.from(new Set(suggestions)).slice(0, 5);
}

export function generateDynamicCodingTopics(content: string, role?: string): string[] {
  const text = `${role || ""} ${content || ""}`.toLowerCase();
  const topics: string[] = [];
  const matches = (keywords: string[]) => keywords.some((k) => text.includes(k));

  if (!content?.trim() || content.trim().length < 25) {
    return [
      "Arrays & Strings",
      "HashMaps & Sets",
      "Two Pointers & Sliding Window",
      "Trees & Binary Search",
      "Dynamic Programming",
      "REST / JSON Data Logic",
    ];
  }

  // Tech stack & role-aware coding topics:
  if (matches(["react", "next.js", "nextjs", "vue", "angular", "frontend"])) {
    topics.push("React Hooks & State", "Async Fetch & Debounce", "Component Tree Logic");
  }

  if (matches(["typescript", "javascript", " ts ", "js"])) {
    topics.push("Type Safety & Generics", "Object & Array Transforms");
  }

  if (matches(["python", "django", "fastapi", "flask", "pandas", "numpy"])) {
    topics.push("FastAPI / REST Data Logic", "Pandas & Data Processing", "Async Queues & Coroutines");
  }

  if (matches(["java", "spring", "spring boot", "springboot", "jvm"])) {
    topics.push("Spring REST & DTOs", "Multithreading & Concurrency", "Collections & Stream API");
  }

  if (matches(["node", "express", "nestjs"])) {
    topics.push("Express APIs & Middleware", "Event Loop & Promises");
  }

  if (matches(["sql", "postgres", "mysql", "database", "rdbms"])) {
    topics.push("SQL Aggregations & Joins", "Schema Queries & Indexing");
  }

  if (matches(["nosql", "mongodb", "redis", "caching"])) {
    topics.push("Cache Eviction & Key-Value Logic", "Document Aggregation Pipelines");
  }

  if (matches(["golang", " go ", "go/"])) {
    topics.push("Goroutines & Channel Workers", "JSON Decoding & Interfaces");
  }

  if (matches(["c#", ".net", "dotnet"])) {
    topics.push("LINQ Queries & Async/Await", "ASP.NET Minimal APIs");
  }

  // Algorithmic foundation topics:
  if (matches(["algorithm", "dsa", "leetcode", "problem solving", "structures"])) {
    topics.push("Sliding Window & Pointers", "Binary Trees & Graphs", "Dynamic Programming");
  } else {
    topics.push("HashMaps & Frequency Counting", "Two Pointers & Arrays");
  }

  return Array.from(new Set(topics)).slice(0, 6);
}

export function generateRecommendedCodingTypes(params: {
  content?: string;
  role?: string;
  skills?: string[];
  seniority?: string;
  minExp?: number | "";
  maxExp?: number | "";
  customInstructions?: string;
}): string[] {
  const { content = "", role = "", skills = [], seniority = "", minExp = "", maxExp = "", customInstructions = "" } = params;
  const combinedText = `${role} ${content} ${skills.join(" ")} ${customInstructions}`.toLowerCase();

  if (!combinedText.trim() || combinedText.trim().length < 15) {
    return [];
  }

  const matches = (keywords: string[]) => keywords.some((k) => combinedText.includes(k));

  const isSenior =
    seniority === "senior" ||
    seniority === "lead" ||
    (typeof minExp === "number" && minExp >= 5) ||
    matches(["senior", "lead", "architect", "staff", "principal", "expert"]);

  const isJunior =
    seniority === "entry" ||
    seniority === "junior" ||
    (typeof maxExp === "number" && maxExp <= 2 && maxExp > 0) ||
    matches(["junior", "intern", "entry-level", "fresher", "graduate"]);

  const candidateTypes: { type: string; priority: number }[] = [];
  const add = (type: string, priority: number) => {
    candidateTypes.push({ type, priority });
  };

  // 1. Python & Data Science & ML & AI
  if (matches(["python", "pandas", "numpy", "dataframe", "data science", "machine learning", "ml", "ai", "etl", "analytics", "data engineer", "scikit", "pytorch", "tensorflow"])) {
    if (matches(["pandas", "numpy", "dataframe", "data engineer", "data science", "analytics", "etl"])) {
      add("Pandas & Data Processing", 100);
      add("Data Pipelines & Transformations", 95);
    }
    if (matches(["fastapi", "flask", "django", "rest", "api", "backend"])) {
      add("FastAPI / REST Data Logic", 92);
    }
    if (matches(["asyncio", "coroutine", "generator", "async", "queue"])) {
      add("Async Queues & Coroutines", 88);
    }
    add("Data Pipelines & Transformations", 82);
  }

  // 2. React & Frontend Web UI
  if (matches(["react", "next.js", "nextjs", "vue", "angular", "frontend", "front-end", "ui", "css", "html", "tailwind", "redux", "zustand"])) {
    add("React Hooks & State", 100);
    add("Async Fetch & Debounce", 95);
    add("Frontend State & DOM Logic", 92);
    add("Component Tree Logic", 88);
  }

  // 3. TypeScript & Modern JavaScript
  if (matches(["typescript", "javascript", " ts ", " js ", "es6", "ecmascript"])) {
    add("Type Safety & Generics", 92);
    add("Object & Array Transforms", 90);
    if (!candidateTypes.some((t) => t.type === "Async Fetch & Debounce")) {
      add("Async Fetch & Debounce", 85);
    }
  }

  // 4. Java & Spring Ecosystem
  if (matches(["java", "spring", "spring boot", "springboot", "jvm", "hibernate", "jpa"])) {
    add("Spring REST & DTOs", 100);
    add("Multithreading & Concurrency", 95);
    add("Collections & Stream API", 92);
  }

  // 5. Node.js & Express & NestJS Backend
  if (matches(["node", "nodejs", "express", "nestjs"])) {
    add("Express APIs & Middleware", 95);
    add("REST API & JSON Transforms", 90);
    add("Event Loop & Promises", 88);
  }

  // 6. Databases & SQL & RDBMS
  if (matches(["sql", "postgres", "postgresql", "mysql", "database", "rdbms", "queries"])) {
    add("SQL Aggregations & Joins", 92);
    add("Database Queries & Data Modeling", 88);
    add("Schema Queries & Indexing", 82);
  }

  // 7. NoSQL & Caching
  if (matches(["redis", "cache", "caching", "mongodb", "nosql", "dynamodb"])) {
    add("Cache Eviction & Key-Value Logic", 90);
    add("Document Aggregation Pipelines", 85);
  }

  // 8. Go / Golang
  if (matches(["golang", " go ", "go/"])) {
    add("Goroutines & Channel Workers", 100);
    add("JSON Decoding & Interfaces", 92);
  }

  // 9. C# / .NET
  if (matches(["c#", ".net", "dotnet", "asp.net"])) {
    add("LINQ Queries & Async/Await", 95);
    add("ASP.NET Minimal APIs", 90);
  }

  // 10. DevOps, Cloud & Systems
  if (matches(["devops", "cloud", "aws", "docker", "kubernetes", "k8s", "sre", "linux", "bash", "worker", "kafka", "rabbitmq"])) {
    add("Log Parsing & Metrics Aggregation", 90);
    add("Retry & Exponential Backoff", 85);
    add("Worker Queue Scheduling", 82);
  }

  // 11. Senior Architecture vs Junior Foundations
  if (isSenior) {
    add("System & Architecture Design", 86);
    add("Code Refactoring & Clean Architecture", 82);
  } else if (isJunior) {
    add("Data Structures & HashMaps", 78);
    add("Two Pointers & Arrays", 74);
  }

  // 12. General Algorithmic & Problem Solving
  if (matches(["algorithm", "algorithms", "dsa", "leetcode", "problem solving", "dynamic programming", "tree", "graph"])) {
    add("Tree & Graph Traversals", 84);
    add("Dynamic Programming & Optimization", 80);
    add("Sliding Window & Pointers", 76);
  } else {
    add("HashMaps & Frequency Counting", 72);
    add("Two Pointers & Arrays", 68);
  }

  // Fallbacks if fewer than 6 candidates
  const fallbacks = [
    "REST API & JSON Transforms",
    "Data Structures & HashMaps",
    "Async Queues & Concurrency",
    "Two Pointers & Sliding Window",
    "Database Queries & Data Modeling",
    "System & Architecture Design",
  ];
  for (const fb of fallbacks) {
    add(fb, 10);
  }

  // Deduplicate preserving highest priority
  const seen = new Set<string>();
  const sorted = candidateTypes
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (seen.has(item.type)) return false;
      seen.add(item.type);
      return true;
    })
    .map((item) => item.type);

  return sorted.slice(0, 6);
}

type Step = "upload" | "questions" | "evaluation" | "link";

export interface EvaluationParameter {
  id: string;
  name: string;
  description: string;
  weight: number;
  enabled: boolean;
  is_custom?: boolean;
  category?: "technical" | "architecture" | "soft_skills" | "custom";
}

export interface EvaluationPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  rubric: { id: string; weight: number }[];
}

export const EVALUATION_PRESETS: EvaluationPreset[] = [
  {
    id: "balanced",
    name: "Balanced Enterprise",
    description: "Holistic 360° evaluation across technical depth, completeness, and communication.",
    icon: "⚖️",
    rubric: [
      { id: "technical_correctness", weight: 40 },
      { id: "completeness", weight: 20 },
      { id: "relevance", weight: 15 },
      { id: "practical_knowledge", weight: 10 },
      { id: "communication_quality", weight: 10 },
      { id: "confidence", weight: 5 },
    ],
  },
  {
    id: "hands_on_dev",
    name: "Hands-on Engineering",
    description: "Heavily weights clean code standards, practical debugging, and technical accuracy.",
    icon: "💻",
    rubric: [
      { id: "technical_correctness", weight: 35 },
      { id: "code_quality", weight: 25 },
      { id: "practical_knowledge", weight: 20 },
      { id: "problem_solving", weight: 20 },
    ],
  },
  {
    id: "system_architect",
    name: "System Architecture & Lead",
    description: "Emphasizes distributed design, high-availability architecture, and trade-offs.",
    icon: "🏗️",
    rubric: [
      { id: "system_design", weight: 35 },
      { id: "practical_knowledge", weight: 25 },
      { id: "technical_correctness", weight: 25 },
      { id: "communication_quality", weight: 15 },
    ],
  },
  {
    id: "culture_fit",
    name: "Behavioral & Leadership",
    description: "Evaluates cultural adaptability, cross-functional collaboration, and communication.",
    icon: "🤝",
    rubric: [
      { id: "adaptability", weight: 40 },
      { id: "communication_quality", weight: 30 },
      { id: "relevance", weight: 15 },
      { id: "confidence", weight: 15 },
    ],
  },
  {
    id: "junior_grad",
    name: "Graduate & Problem Solving",
    description: "Focuses on analytical reasoning, structured logic, and clarity of explanation.",
    icon: "🎓",
    rubric: [
      { id: "problem_solving", weight: 35 },
      { id: "technical_correctness", weight: 30 },
      { id: "communication_quality", weight: 20 },
      { id: "completeness", weight: 15 },
    ],
  },
  {
    id: "security_domain",
    name: "Security & Domain Specialist",
    description: "Focuses on security standards (OWASP), data privacy compliance, and industry domain logic.",
    icon: "🛡️",
    rubric: [
      { id: "security_compliance", weight: 35 },
      { id: "technical_correctness", weight: 25 },
      { id: "domain_expertise", weight: 20 },
      { id: "code_quality", weight: 20 },
    ],
  },
];

export const RUBRIC_PALETTE_COLORS = [
  { bg: "bg-blue-500", text: "text-blue-500", border: "border-blue-500/30", lightBg: "bg-blue-500/10" },
  { bg: "bg-emerald-500", text: "text-emerald-500", border: "border-emerald-500/30", lightBg: "bg-emerald-500/10" },
  { bg: "bg-violet-500", text: "text-violet-500", border: "border-violet-500/30", lightBg: "bg-violet-500/10" },
  { bg: "bg-amber-500", text: "text-amber-500", border: "border-amber-500/30", lightBg: "bg-amber-500/10" },
  { bg: "bg-cyan-500", text: "text-cyan-500", border: "border-cyan-500/30", lightBg: "bg-cyan-500/10" },
  { bg: "bg-rose-500", text: "text-rose-500", border: "border-rose-500/30", lightBg: "bg-rose-500/10" },
  { bg: "bg-indigo-500", text: "text-indigo-500", border: "border-indigo-500/30", lightBg: "bg-indigo-500/10" },
  { bg: "bg-teal-500", text: "text-teal-500", border: "border-teal-500/30", lightBg: "bg-teal-500/10" },
  { bg: "bg-fuchsia-500", text: "text-fuchsia-500", border: "border-fuchsia-500/30", lightBg: "bg-fuchsia-500/10" },
  { bg: "bg-sky-500", text: "text-sky-500", border: "border-sky-500/30", lightBg: "bg-sky-500/10" },
];

export const INITIAL_EVALUATION_RUBRIC: EvaluationParameter[] = [
  {
    id: "technical_correctness",
    name: "Technical Correctness",
    description: "Accuracy of technical concepts, correct terminology, and implementation depth.",
    weight: 0,
    enabled: false,
  },
  {
    id: "problem_solving",
    name: "Problem Solving & Logic",
    description: "Methodical breakdown of complex problems, trade-off evaluation, and structured analytical reasoning.",
    weight: 0,
    enabled: false,
  },
  {
    id: "code_quality",
    name: "Code Quality & Best Practices",
    description: "Clean code structure, modularity, maintainability, and defensive programming patterns.",
    weight: 0,
    enabled: false,
  },
  {
    id: "practical_knowledge",
    name: "Practical Experience",
    description: "Demonstrates real project experience, production use cases, debugging, or lessons learned.",
    weight: 0,
    enabled: false,
  },
  {
    id: "communication_quality",
    name: "Communication Quality",
    description: "Clear and logical explanation, professional language, and structured flow.",
    weight: 0,
    enabled: false,
  },
  {
    id: "system_design",
    name: "System Design & Architecture",
    description: "High-level architecture, scalability principles, latency/throughput trade-offs, and resilience.",
    weight: 0,
    enabled: false,
  },
];

function convertLocalToUTCString(localDateTimeStr: string, timeZone: string): string | null {
  if (!localDateTimeStr) return null;
  if (timeZone === 'Asia/Kolkata') {
    return new Date(`${localDateTimeStr}:00+05:30`).toISOString();
  }
  return new Date(localDateTimeStr).toISOString();
}

function formatToTimeZoneDateTimeLocal(dateStr: string, timeZone: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch (e) {
    const d = new Date(dateStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

function parseISTDateTimeToTimestamp(dateTimeStr: string): number | null {
  if (!dateTimeStr) return null;
  const clean = dateTimeStr.length === 16 ? `${dateTimeStr}:00` : dateTimeStr;
  const d = new Date(`${clean}+05:30`);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function validateAvailabilityWindow(fromStr: string, untilStr: string): {
  startPast: boolean;
  untilPast: boolean;
  endBeforeStart: boolean;
} {
  const now = Date.now();
  // 60-second grace buffer for start time to prevent false errors while filling the form
  const graceMs = 60 * 1000;

  const fromTs = parseISTDateTimeToTimestamp(fromStr);
  const untilTs = parseISTDateTimeToTimestamp(untilStr);

  const startPast = fromTs !== null && fromTs < (now - graceMs);
  const untilPast = untilTs !== null && untilTs <= now;
  const endBeforeStart = fromTs !== null && untilTs !== null && untilTs <= fromTs;

  return { startPast, untilPast, endBeforeStart };
}

function getMinISTDateTime(): string {
  return formatToTimeZoneDateTimeLocal(new Date().toISOString(), "Asia/Kolkata");
}

const durationOptions = [5, 10, 30, 60, 90, 120, 180];

export default function Interview() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const minDateTime = getMinISTDateTime();

  const candId = searchParams.get("candId") || searchParams.get("candidateId");
  const candidateName = searchParams.get("candidateName");
  const candidateEmail = searchParams.get("candidateEmail");
  const jobId = searchParams.get("jobId");
  const initialJobRole = searchParams.get("jobRole") || "";

  const handleReturnToXevHire = () => {
    const xevhireUrl = import.meta.env.VITE_XEVHIRE_URL || "http://local-test-company.localhost:3000";
    const resultUrl = `${window.location.origin}/results?id=${interviewId}`;
    const params = new URLSearchParams({
      interviewId: interviewId || "",
      interviewLink: generatedLink,
      resultUrl: resultUrl,
      candidateId: candId || "",
      candidateName: candidateName || "",
      candidateEmail: candidateEmail || "",
      jobId: jobId || ""
    });
    window.location.href = `${xevhireUrl}/ai-interview-created?${params.toString()}`;
  };

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [jdText, setJdText] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [jdValidationError, setJdValidationError] = useState<string | null>(null);
  const [isJdDismissed, setIsJdDismissed] = useState(false);
  const [loadingJd, setLoadingJd] = useState(false);
  const [jdInputTab, setJdInputTab] = useState<"upload" | "paste">("upload");
  const [previewText, setPreviewText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [saveVideoRecording, setSaveVideoRecording] = useState(true);
  const [showCandidateVideo, setShowCandidateVideo] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [interviewName, setInterviewName] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [scheduleErrors, setScheduleErrors] = useState<{
    startPast: boolean;
    untilPast: boolean;
    endBeforeStart: boolean;
  }>({ startPast: false, untilPast: false, endBeforeStart: false });
  const timezone = "Asia/Kolkata";
  const gracePeriodMinutes = 0;
  const [proctoringEnabled, setProctoringEnabled] = useState(true);
  const [proctoringMaxStrikes, setProctoringMaxStrikes] = useState(3);
  const [proctoringMaxStrikesAction, setProctoringMaxStrikesAction] = useState("auto_terminate");
  const [evaluationScoreCutoff, setEvaluationScoreCutoff] = useState(60);
  const [evaluationCutoffAction, setEvaluationCutoffAction] = useState("manual_review");

  // ── New Structured Screening & Setup Fields ──
  const [selectedJobRole, setSelectedJobRole] = useState(initialJobRole);
  const [selectedJobRoleId, setSelectedJobRoleId] = useState<string | null>(null);
  const [rolesMasterList, setRolesMasterList] = useState<Array<{ id: string; name: string; department?: string }>>([]);
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [roleSearchFilter, setRoleSearchFilter] = useState("");
  const jobRole = selectedJobRole;

  const [skillTags, setSkillTags] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");

  const [difficultyLevel, setDifficultyLevel] = useState<"Easy" | "Medium" | "Hard" | "Adaptive">("Medium");
  const [questionCount, setQuestionCount] = useState<number>(5);
  const [codingCount, setCodingCount] = useState<number>(2);
  const [interviewStage, setInterviewStage] = useState<string>("Screening");

  const [department, setDepartment] = useState<string>("Engineering");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departmentsMasterList, setDepartmentsMasterList] = useState<Array<{ id: string; name: string }>>([]);

  const [seniorityLevel, setSeniorityLevel] = useState<"Intern" | "Junior" | "Mid" | "Senior" | "Lead">("Mid");
  const [experienceMin, setExperienceMin] = useState<number | "">("");
  const [experienceMax, setExperienceMax] = useState<number | "">("");

  const [interviewLanguage, setInterviewLanguage] = useState<string>("English");
  const [linkExpiryDays, setLinkExpiryDays] = useState<number>(7);

  const [requireCamera, setRequireCamera] = useState<boolean>(true);
  const [detectTabSwitch, setDetectTabSwitch] = useState<boolean>(true);
  const [blockCopyPaste, setBlockCopyPaste] = useState<boolean>(true);
  const [maxRetakeAttempts, setMaxRetakeAttempts] = useState<number>(1);

  const filteredRoles = useMemo(() => {
    if (!roleSearchFilter.trim()) return rolesMasterList;
    return rolesMasterList.filter((r) =>
      r.name.toLowerCase().includes(roleSearchFilter.toLowerCase())
    );
  }, [rolesMasterList, roleSearchFilter]);

  // Coding question management & AI generation state
  const [codingFile, setCodingFile] = useState<File | null>(null);
  const [parsingCoding, setParsingCoding] = useState(false);
  const [codingQuestions, setCodingQuestions] = useState<any[]>([]);
  const [codingParsed, setCodingParsed] = useState(false);
  const [codingInputTab, setCodingInputTab] = useState<"ai" | "upload">("ai");
  const [generatingAiCoding, setGeneratingAiCoding] = useState(false);
  const [aiCodingDifficulty, setAiCodingDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [aiCodingCount, setAiCodingCount] = useState<number>(2);
  const [aiCodingCustomTopic, setAiCodingCustomTopic] = useState("");
  const [pastedCodingText, setPastedCodingText] = useState("");
  const [customSuggestions, setCustomSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const dynamicSuggestions = useMemo(() => {
    const hasContent = Boolean((jdText && jdText.trim().length >= 25) || (previewText && previewText.trim().length >= 25));
    if (!hasContent) return [];
    if (customSuggestions.length > 0) return customSuggestions;
    return generateDynamicSuggestions(jdText || previewText, jobRole || undefined);
  }, [customSuggestions, jdText, previewText, jobRole]);

  // AI-recommended coding challenge types state
  const [aiSemanticCodingTypes, setAiSemanticCodingTypes] = useState<string[] | null>(null);
  const [isAnalyzingCodingTypes, setIsAnalyzingCodingTypes] = useState(false);
  const [codingTypesClarification, setCodingTypesClarification] = useState<string | null>(null);

  // Synchronous fallback dictionary (instant responsiveness and offline fallback)
  const fallbackCodingTypes = useMemo(() => {
    return generateRecommendedCodingTypes({
      content: (jdText?.trim() || previewText?.trim() || ""),
      role: selectedJobRole,
      skills: skillTags,
      seniority: seniorityLevel,
      minExp: experienceMin,
      maxExp: experienceMax,
      customInstructions: customInstructions,
    });
  }, [jdText, previewText, selectedJobRole, skillTags, seniorityLevel, experienceMin, experienceMax, customInstructions]);

  // Debounced effect for AI Semantic Analysis of full JD/resume, paragraphs, projects, and skills
  useEffect(() => {
    const rawContent = (jdText?.trim() || previewText?.trim() || "");
    const role = (selectedJobRole || "").trim();
    const skills = skillTags || [];

    // If completely empty or less than 15 chars and no role/skills
    if (!rawContent && !role && skills.length === 0) {
      setAiSemanticCodingTypes(null);
      setCodingTypesClarification(null);
      setIsAnalyzingCodingTypes(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      setIsAnalyzingCodingTypes(true);
      try {
        const res = await recommendCodingChallengeTypes({
          content: rawContent,
          jobRole: role || undefined,
          skills: skills.length > 0 ? skills : undefined,
          seniority: seniorityLevel || undefined,
          minExp: experienceMin !== "" ? experienceMin : undefined,
          maxExp: experienceMax !== "" ? experienceMax : undefined,
          customInstructions: customInstructions || undefined,
        });

        if (!isMounted) return;

        if (res.needs_clarification) {
          setCodingTypesClarification(res.message || "Insufficient technical details provided to recommend challenge types.");
          setAiSemanticCodingTypes(null);
        } else if (res.types && res.types.length > 0) {
          setAiSemanticCodingTypes(res.types);
          setCodingTypesClarification(null);
        } else {
          setAiSemanticCodingTypes(null);
          setCodingTypesClarification(null);
        }
      } catch (err) {
        console.warn("[CodingTypes] AI recommendation error:", err);
        if (isMounted) {
          setAiSemanticCodingTypes(null);
          setCodingTypesClarification(null);
        }
      } finally {
        if (isMounted) {
          setIsAnalyzingCodingTypes(false);
        }
      }
    }, 600);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [jdText, previewText, selectedJobRole, skillTags, seniorityLevel, experienceMin, experienceMax, customInstructions]);

  // Active recommended types (uses AI semantic types if available, otherwise fallback dictionary unless clarification is needed)
  const recommendedCodingTypes = useMemo(() => {
    const hasDocContent = Boolean(
      (jdText && jdText.trim().length >= 25) ||
      (previewText && previewText.trim().length >= 25) ||
      file !== null
    );

    // By default, no question types should appear in UI until user uploads data (matching the Hint above)
    if (!hasDocContent) {
      return [];
    }

    if (codingTypesClarification) {
      // If clarification is requested due to insufficient info, do NOT invent types
      return [];
    }
    if (aiSemanticCodingTypes && aiSemanticCodingTypes.length > 0) {
      return aiSemanticCodingTypes;
    }
    return fallbackCodingTypes;
  }, [file, jdText, previewText, codingTypesClarification, aiSemanticCodingTypes, fallbackCodingTypes]);

  const [customCodingTypes, setCustomCodingTypes] = useState<string[]>([]);
  const [removedCodingTypes, setRemovedCodingTypes] = useState<string[]>([]);
  const [selectedCodingTypes, setSelectedCodingTypes] = useState<string[]>([]);
  const [newChallengeTypeInput, setNewChallengeTypeInput] = useState("");
  const [isAddingCustomType, setIsAddingCustomType] = useState(false);

  // Active coding challenge types: strictly max 6 AI recommendations + any custom types added by user
  const codingChallengeTypes = useMemo(() => {
    const activeRecs = recommendedCodingTypes.filter((t) => !removedCodingTypes.includes(t)).slice(0, 6);
    return Array.from(new Set([...activeRecs, ...customCodingTypes]));
  }, [recommendedCodingTypes, removedCodingTypes, customCodingTypes]);

  const prevRecsKeyRef = useRef<string>("");

  // Keep selection synchronized with available types, updating to new recommendations when document changes
  useEffect(() => {
    const recsKey = recommendedCodingTypes.join("|");
    if (prevRecsKeyRef.current !== recsKey) {
      prevRecsKeyRef.current = recsKey;
      const activeRecs = recommendedCodingTypes.filter((t) => !removedCodingTypes.includes(t)).slice(0, 6);
      const combined = Array.from(new Set([...activeRecs, ...customCodingTypes]));
      setSelectedCodingTypes(combined.slice(0, 2));
    } else {
      setSelectedCodingTypes((prev) => {
        if (prev.length === 0) {
          return codingChallengeTypes.slice(0, 2);
        }
        const valid = prev.filter((t) => codingChallengeTypes.includes(t));
        return valid.length > 0 ? valid : codingChallengeTypes.slice(0, 2);
      });
    }
  }, [recommendedCodingTypes, codingChallengeTypes, removedCodingTypes, customCodingTypes]);

  const toggleCodingType = (type: string) => {
    setSelectedCodingTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const removeCodingType = (typeToRemove: string) => {
    setRemovedCodingTypes((prev) => [...prev, typeToRemove]);
    setCustomCodingTypes((prev) => prev.filter((t) => t !== typeToRemove));
    setSelectedCodingTypes((prev) => prev.filter((t) => t !== typeToRemove));
  };

  const handleAddCustomCodingType = () => {
    const trimmed = newChallengeTypeInput.trim();
    if (!trimmed) return;
    setCustomCodingTypes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setRemovedCodingTypes((prev) => prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase()));
    setSelectedCodingTypes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setNewChallengeTypeInput("");
    setIsAddingCustomType(false);
  };

  const handleResetCodingTypes = () => {
    setRemovedCodingTypes([]);
    setCustomCodingTypes([]);
    setSelectedCodingTypes(recommendedCodingTypes.slice(0, 2));
  };

  const handleFetchAiSuggestions = async () => {
    const content = (jdText || previewText || "").trim();
    if (!content) {
      toast({ title: "Please upload or paste a JD/Resume first", variant: "destructive" });
      return;
    }
    setLoadingSuggestions(true);
    try {
      const res = await getCustomizationSuggestions(content, jobRole || undefined);
      if (res && res.length > 0) {
        setCustomSuggestions(res);
        toast({ title: "Fresh suggestions generated from your document" });
      } else {
        toast({ title: "Using auto-detected suggestions" });
      }
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
      toast({ title: "Failed to fetch suggestions", variant: "destructive" });
    } finally {
      setLoadingSuggestions(false);
    }
  };

  type CreationMode = "hybrid" | "jd" | "coding";
  const [creationMode, setCreationMode] = useState<CreationMode>("hybrid");

  // ── Question Editing State ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editType, setEditType] = useState("technical");
  const [editDifficulty, setEditDifficulty] = useState("medium");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Coding Question Editing State ──
  const [editCodingTitle, setEditCodingTitle] = useState("");
  const [editCodingDescription, setEditCodingDescription] = useState("");
  const [editCodingTestCases, setEditCodingTestCases] = useState<Array<{ input: string; expected_output: string }>>([]);

  // ── Add Custom Question State ──
  const [addingType, setAddingType] = useState<string | null>(null);
  const [newQText, setNewQText] = useState("");
  const [newQDifficulty, setNewQDifficulty] = useState("medium");
  const [savingNew, setSavingNew] = useState(false);

  // ── Add Custom Coding Question State ──
  const [newCodingTitle, setNewCodingTitle] = useState("");
  const [newCodingDescription, setNewCodingDescription] = useState("");
  const [newCodingDifficulty, setNewCodingDifficulty] = useState("medium");
  const [newCodingTestCases, setNewCodingTestCases] = useState<Array<{ input: string; expected_output: string }>>([]);
  const [codingError, setCodingError] = useState<{ field: "title" | "description"; message: string; matchedTitle?: string } | null>(null);
  const [customQError, setCustomQError] = useState<{ message: string; matchedTitle?: string } | null>(null);
  const [editError, setEditError] = useState<{ field: "title" | "description" | "text"; message: string; matchedTitle?: string } | null>(null);
  const [duplicateConflictId, setDuplicateConflictId] = useState<string | null>(null);

  // ── Evaluation Rubric State ──
  const [rubricParameters, setRubricParameters] = useState<EvaluationParameter[]>(INITIAL_EVALUATION_RUBRIC);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [rubricSearchQuery, setRubricSearchQuery] = useState<string>("");
  const [editingParamId, setEditingParamId] = useState<string | null>(null);
  const [editingParamDesc, setEditingParamDesc] = useState<string>("");
  const [showAddCustomParamModal, setShowAddCustomParamModal] = useState(false);
  const [customParamName, setCustomParamName] = useState("");
  const [customParamDesc, setCustomParamDesc] = useState("");
  const [customParamWeight, setCustomParamWeight] = useState(10);
  const [savingRubric, setSavingRubric] = useState(false);

  const handleApplyPreset = (preset: EvaluationPreset) => {
    setActivePreset(preset.id);
    const presetMap = new Map(preset.rubric.map(r => [r.id, r.weight]));
    setRubricParameters(prev => prev.map(p => {
      if (presetMap.has(p.id)) {
        return { ...p, enabled: true, weight: presetMap.get(p.id)! };
      }
      return { ...p, enabled: false, weight: 0 };
    }));
    toast({ title: `Applied "${preset.name}" profile`, description: "Evaluation parameters and weights updated." });
  };

  const handleStartEditParamDesc = (param: EvaluationParameter) => {
    setEditingParamId(param.id);
    setEditingParamDesc(param.description);
  };

  const handleSaveParamDesc = (paramId: string) => {
    if (!editingParamDesc.trim()) return;
    setRubricParameters(prev => prev.map(p => p.id === paramId ? { ...p, description: editingParamDesc.trim() } : p));
    setEditingParamId(null);
    toast({ title: "Evaluation guidelines updated" });
  };

  const handleResetParamDesc = (paramId: string) => {
    const original = INITIAL_EVALUATION_RUBRIC.find(p => p.id === paramId);
    if (original) {
      setRubricParameters(prev => prev.map(p => p.id === paramId ? { ...p, description: original.description } : p));
      setEditingParamId(null);
      toast({ title: "Restored default guidelines" });
    }
  };

  const handleAutoBalanceWeights = () => {
    const active = rubricParameters.filter(p => p.enabled);
    if (active.length === 0) return;
    const baseWeight = Math.floor(100 / active.length);
    let remainder = 100 - (baseWeight * active.length);

    setRubricParameters(prev => prev.map(p => {
      if (!p.enabled) return { ...p, weight: 0 };
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      return { ...p, weight: baseWeight + extra };
    }));
    toast({ title: "Weights auto-balanced to 100%" });
  };

  const handleToggleParameter = (id: string) => {
    setActivePreset("custom");
    setRubricParameters(prev => {
      const target = prev.find(p => p.id === id);
      if (!target) return prev;
      const willEnable = !target.enabled;
      return prev.map(p => {
        if (p.id === id) {
          return {
            ...p,
            enabled: willEnable,
            weight: willEnable ? (p.weight > 0 ? p.weight : 20) : 0,
          };
        }
        return p;
      });
    });
  };

  const handleWeightChange = (id: string, newWeight: number) => {
    setActivePreset("custom");
    const clamped = Math.max(0, Math.min(100, isNaN(newWeight) ? 0 : newWeight));
    setRubricParameters(prev => prev.map(p => p.id === id ? { ...p, weight: clamped } : p));
  };

  const handleAddCustomParameter = () => {
    const trimmedName = customParamName.trim();
    if (!trimmedName) {
      toast({ title: "Please enter a parameter name", variant: "destructive" });
      return;
    }
    // Duplicate name check (case-insensitive)
    const nameExists = rubricParameters.some(
      p => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (nameExists) {
      toast({ title: "A parameter with this name already exists", variant: "destructive" });
      return;
    }
    const cleanId = "custom_" + trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (rubricParameters.some(p => p.id === cleanId)) {
      toast({ title: "A parameter with this name already exists", variant: "destructive" });
      return;
    }
    const newParam: EvaluationParameter = {
      id: cleanId,
      name: trimmedName,
      description: customParamDesc.trim() || `Assess candidate performance on ${trimmedName}`,
      weight: Math.max(1, Math.min(100, customParamWeight || 10)),
      enabled: true,
      is_custom: true,
    };
    setRubricParameters(prev => [...prev, newParam]);
    setActivePreset("custom");
    setCustomParamName("");
    setCustomParamDesc("");
    setCustomParamWeight(10);
    setShowAddCustomParamModal(false);
    toast({ title: "Custom parameter added!" });
  };

  const handleDeleteCustomParameter = (id: string) => {
    setRubricParameters(prev => prev.filter(p => p.id !== id));
    toast({ title: "Custom parameter removed" });
  };

  const handleResetRubric = () => {
    setRubricParameters(INITIAL_EVALUATION_RUBRIC);
    setActivePreset(null);
    toast({ title: "Evaluation rubric cleared" });
  };

  // ── Send Email State ──
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [candidateEmails, setCandidateEmails] = useState<{ email: string; name?: string }[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [editingEmailIndex, setEditingEmailIndex] = useState<number | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSentSuccessfully, setEmailSentSuccessfully] = useState(false);
  const [emailSendFailed, setEmailSendFailed] = useState(false);
  const [failedCandidateEmails, setFailedCandidateEmails] = useState<string[]>([]);
  const [lastEmailError, setLastEmailError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [attemptedSend, setAttemptedSend] = useState(false);
  const emailInterviewIdRef = useRef<string | null>(null);
  const extractAbortRef = useRef<AbortController | null>(null);
  const extractCodingAbortRef = useRef<AbortController | null>(null);

  const openSendEmailDialog = () => {
    setDialogError(null);
    const activeRole = (jobRole && jobRole.trim()) ? jobRole : (creationMode === "coding" ? "Coding Assessment" : "Software Engineer");

    // If opening for a brand-new/different interview, reset candidate emails list completely
    const isNewInterview = interviewId && emailInterviewIdRef.current !== interviewId;
    if (isNewInterview) {
      emailInterviewIdRef.current = interviewId;
      if (candidateEmail) {
        setCandidateEmails([{ email: candidateEmail, name: candidateName || "" }]);
      } else {
        setCandidateEmails([]);
      }
      setEmailInput("");
      setFailedCandidateEmails([]);
      setEmailSentSuccessfully(false);
      setEmailSendFailed(false);
      setLastEmailError(null);
    } else if (candidateEmails.length > 0) {
      // Retain existing/failed candidate emails for retry on current interview
    } else if (candidateEmail) {
      setCandidateEmails([{ email: candidateEmail, name: candidateName || "" }]);
    } else {
      setCandidateEmails([]);
    }
    setEmailSubject(`AI Interview Invitation - ${activeRole}`);
    const companyDisplayName = user?.tenant_name || "Our Company";
    const formatIST = (dtStr: string) => {
      if (!dtStr) return "";
      try {
        const d = new Date(`${dtStr}:00+05:30`);
        return d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: "medium", timeStyle: "short" }) + " IST";
      } catch (e) {
        return dtStr;
      }
    };
    const accessNote = (availableFrom && availableUntil)
      ? `- You can access the interview only within the scheduled window (${formatIST(availableFrom)} – ${formatIST(availableUntil)}).`
      : `- You can access the interview anytime using the link below.`;
    setEmailBody(
      `Dear Candidate,\n\n` +
      `You have been invited to participate in an AI Interview for the ${activeRole} position.\n\n` +
      `Interview Details:\n` +
      `- Job Role: ${activeRole}\n` +
      `- Interview Duration: ${durationMinutes} minutes\n\n` +
      `Interview Link:\n` +
      `${generatedLink}\n\n` +
      `Please ensure that:\n` +
      `- You have a stable internet connection.\n` +
      `- Your camera and microphone are enabled.\n` +
      `${accessNote}\n\n` +
      `We wish you all the best.\n\n` +
      `Regards,\n` +
      `${companyDisplayName} Recruitment Team`
    );
    // Reset state on every open
    setAttemptedSend(false);
    setEmailSentSuccessfully(false);
    setEmailInput("");
    setEditingEmailIndex(null);
    setShowEmailDialog(true);
  };

  // ── Multi-Candidate Email Helpers ──
  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const hasValidEmailInput = (input: string) => {
    const raw = input.trim();
    if (!raw) return false;
    const emails = raw.split(/[,;\n\s]+/).map(e => e.trim()).filter(Boolean);
    return emails.some(e => isValidEmail(e));
  };

  const emailInputHasError = attemptedSend && (candidateEmails.length === 0 || hasValidEmailInput(emailInput));
  const subjectHasError = attemptedSend && !emailSubject.trim();

  const handleAddCandidateEmail = () => {
    const raw = emailInput.trim().toLowerCase();
    if (!raw) return;

    // Support bulk paste: split by comma, semicolon, newline, or space
    const emails = raw.split(/[,;\n\s]+/).map(e => e.trim()).filter(Boolean);
    const newEntries: { email: string; name?: string }[] = [];
    const errors: string[] = [];

    for (const e of emails) {
      if (!isValidEmail(e)) {
        errors.push(e);
        continue;
      }
      if (candidateEmails.some(c => c.email === e)) {
        errors.push(`${e} (duplicate)`);
        continue;
      }
      newEntries.push({ email: e });
    }

    if (newEntries.length > 0) {
      setCandidateEmails(prev => [...prev, ...newEntries]);
    }
    if (errors.length > 0) {
      toast({ title: `Skipped: ${errors.join(", ")}`, variant: "destructive" });
    }
    setEmailInput("");
  };

  const handleRemoveCandidateEmail = (index: number) => {
    setCandidateEmails(prev => prev.filter((_, i) => i !== index));
    toast({ title: "Candidate email removed successfully." });
  };

  const handleEditCandidateEmail = (index: number, newEmail: string) => {
    const cleaned = newEmail.trim().toLowerCase();
    if (!isValidEmail(cleaned)) {
      toast({ title: "Invalid email format", variant: "destructive" });
      return;
    }
    if (candidateEmails.some((c, i) => i !== index && c.email === cleaned)) {
      toast({ title: "Duplicate email", variant: "destructive" });
      return;
    }
    setCandidateEmails(prev => prev.map((c, i) => i === index ? { ...c, email: cleaned } : c));
    setEditingEmailIndex(null);
  };

  const handleSendEmail = async () => {
    setAttemptedSend(true);

    // If no emails added yet, try to use whatever is typed in the input as the single recipient
    let effectiveEmails = candidateEmails;
    if (candidateEmails.length === 0) {
      const raw = emailInput.trim().toLowerCase();
      if (!raw) {
        toast({ title: "Please enter a candidate email.", variant: "destructive" });
        return;
      }
      if (!isValidEmail(raw)) {
        toast({ title: "Invalid email format.", variant: "destructive" });
        return;
      }
      effectiveEmails = [{ email: raw }];
      setCandidateEmails(effectiveEmails);
      setEmailInput("");
    } else if (hasValidEmailInput(emailInput)) {
      // There are already emails in the list but user hasn't clicked Add for the new one
      toast({ title: "Please click + Add to add the pending email.", variant: "destructive" });
      return;
    }

    if (!emailSubject.trim()) {
      toast({ title: "Subject is required", variant: "destructive" });
      return;
    }
    if (!interviewId) return;

    setSendingEmail(true);
    setDialogError(null);
    setEmailSendFailed(false);
    try {
      // Mark as multi-candidate so session-based access works
      await updateInterviewSettings(interviewId, { is_multi_candidate: true } as any);

      // Add each candidate (skip if already exists) then send email
      let successCount = 0;
      const failedEmails: string[] = [];
      let failureReason = "";

      for (const cand of effectiveEmails) {
        try {
          // Add to backend — ignore 400 "already added" errors
          try {
            await addInterviewCandidate(interviewId, cand.email, cand.name);
          } catch (addErr: any) {
            const msg = String(addErr?.message || "").toLowerCase();
            if (!msg.includes("already added") && !msg.includes("duplicate")) {
              throw addErr; // re-throw real errors
            }
            // else: candidate already exists — still send email
          }

          // Send / resend the invitation email
          await resendInterviewCandidate(interviewId, cand.email, emailSubject.trim(), emailBody);
          successCount++;
        } catch (err: any) {
          console.error(`Failed for ${cand.email}:`, err);
          failedEmails.push(cand.email);
          if (!failureReason) {
            failureReason = err?.message || "Failed to send email invitation";
          }
        }
      }

      if (failedEmails.length > 0) {
        // Failed candidates must NOT be treated as successfully invited!
        setEmailSendFailed(true);
        setFailedCandidateEmails(failedEmails);
        setLastEmailError(failureReason);
        setDialogError(`Invitation failed to send to: ${failedEmails.join(", ")}.${failureReason ? ` (${failureReason})` : ""}`);

        // Retain only failed emails so user can retry directly
        setCandidateEmails(effectiveEmails.filter(c => failedEmails.includes(c.email)));

        if (successCount === 0) {
          // All failed!
          setEmailSentSuccessfully(false);
          toast({
            title: "Invitation Not Sent",
            description: `Could not send email to: ${failedEmails.join(", ")}.${failureReason ? ` (${failureReason})` : ""}`,
            variant: "destructive",
          });
        } else {
          // Partial failure
          setEmailSentSuccessfully(false);
          toast({
            title: "Partial Invitation Delivery",
            description: `Sent to ${successCount} candidate(s). Failed for: ${failedEmails.join(", ")}.`,
            variant: "destructive",
          });
        }
      } else {
        // All succeeded!
        setEmailSentSuccessfully(true);
        setEmailSendFailed(false);
        setFailedCandidateEmails([]);
        setLastEmailError(null);
        setDialogError(null);
        setCandidateEmails([]);
        setEmailInput("");
        toast({ title: `✓ Invitations sent successfully to ${successCount} candidate(s)!` });
        setShowEmailDialog(false);
      }
    } catch (err: any) {
      setEmailSentSuccessfully(false);
      setEmailSendFailed(true);
      setLastEmailError(err.message || "Failed to send invitations");
      setDialogError(err.message || "Failed to send invitations");
      toast({ title: "Invitation Not Sent", description: err.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };


  useEffect(() => {
    const fetchJobDescription = async () => {
      if (!jobId) return;

      setLoadingJd(true);
      try {
        const xevhireApiUrl = import.meta.env.VITE_XEVHIRE_API_URL || "http://localhost:8080/api";
        const token = localStorage.getItem("xeviewer_token");
        const headers: Record<string, string> = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`${xevhireApiUrl}/jobs/${jobId}`, { headers });
        if (!res.ok) {
          throw new Error(`Failed to fetch job description (Status: ${res.status})`);
        }
        const data = await res.json();
        if (data && data.description) {
          setJdText(data.description);
          toast({ title: "Job Description loaded successfully" });
        } else {
          throw new Error("No description found in job details");
        }
      } catch (err: any) {
        console.error("Error fetching job description:", err);
        toast({
          title: "Failed to load Job Description",
          description: "Could not fetch details from XevHire. Please paste or upload it manually.",
          variant: "destructive"
        });
      } finally {
        setLoadingJd(false);
      }
    };

    fetchJobDescription();
  }, [jobId]);

  // Master catalog loader: fetch roles and departments from DB
  useEffect(() => {
    async function loadMasterData() {
      try {
        const [roles, depts] = await Promise.all([
          getRolesMaster(),
          getDepartmentsMaster(),
        ]);
        if (roles && roles.length > 0) {
          setRolesMasterList(roles);
          if (initialJobRole) {
            const match = roles.find((r) => r.name.toLowerCase() === initialJobRole.toLowerCase());
            if (match) {
              setSelectedJobRoleId(match.id);
              if (match.department) {
                setDepartment(match.department);
              }
            }
          }
        }
        if (depts && depts.length > 0) {
          setDepartmentsMasterList(depts);
          const eng = depts.find((d) => d.name === "Engineering");
          if (eng && !departmentId) {
            setDepartmentId(eng.id);
          }
        }
      } catch (err) {
        console.warn("Could not load master catalog data:", err);
      }
    }
    loadMasterData();
  }, []);

  // Tech skills dictionary for candidate skill tags auto-extraction
  const TECH_SKILLS_DICTIONARY = useMemo(
    () => [
      "React", "TypeScript", "JavaScript", "Node.js", "Python", "Java", "Spring Boot", "Go", "Golang",
      "C++", "C#", ".NET", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes", "AWS",
      "Azure", "GCP", "GraphQL", "REST APIs", "CI/CD", "Git", "Tailwind CSS", "Next.js", "Vue.js",
      "Angular", "Microservices", "System Design", "Kafka", "RabbitMQ", "Elasticsearch", "Machine Learning",
      "Data Engineering", "TensorFlow", "PyTorch", "Pandas", "NumPy", "Django", "FastAPI", "Express.js",
      "Unit Testing", "Jest", "Cypress", "Linux", "Terraform", "DevOps", "SQL", "NoSQL", "Snowflake",
      "OAuth", "OWASP", "Security", "Agile", "Scrum"
    ],
    []
  );

  const extractCandidateSkillTags = (content: string): string[] => {
    if (!content || content.trim().length < 20) return [];
    const found: string[] = [];
    for (const skill of TECH_SKILLS_DICTIONARY) {
      const sLower = skill.toLowerCase();
      const regex = new RegExp(`(?:^|[\\s,/()])${sLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s,/()]|$)`, "i");
      if (regex.test(content)) {
        found.push(skill);
      }
      if (found.length >= 12) break;
    }
    return found;
  };

  const extractJobRoleTitle = (content: string): string | null => {
    if (!content || content.trim().length < 20) return null;
    const lines = content.slice(0, 2000).split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/(?:job\s+title|role|position|designation)\s*[:\-]\s*([A-Za-z0-9\s/+#\.\-]{3,50})/i);
      if (match && match[1]?.trim()) {
        const title = match[1].trim();
        if (title.length > 2 && title.length < 50 && !title.includes("http")) {
          return title;
        }
      }
    }
    for (const r of rolesMasterList) {
      if (new RegExp(`\\b${r.name}\\b`, "i").test(content.slice(0, 1500))) {
        return r.name;
      }
    }
    return null;
  };

  const autoExtractFromText = (content: string) => {
    if (!content || content.trim().length < 25) return;
    const extractedSkills = extractCandidateSkillTags(content);
    if (extractedSkills.length > 0) {
      setSkillTags((prev) => Array.from(new Set([...prev, ...extractedSkills])));
    }
    if (!selectedJobRole.trim()) {
      const detectedRole = extractJobRoleTitle(content);
      if (detectedRole) {
        setSelectedJobRole(detectedRole);
        const match = rolesMasterList.find((r) => r.name.toLowerCase() === detectedRole.toLowerCase());
        if (match) {
          setSelectedJobRoleId(match.id);
          if (match.department) {
            setDepartment(match.department);
            const dMatch = departmentsMasterList.find((d) => d.name.toLowerCase() === match.department?.toLowerCase());
            if (dMatch) setDepartmentId(dMatch.id);
          }
        }
      }
    }
  };

  useEffect(() => {
    if (!authLoading && user && user.role === 'super_admin') {
      navigate("/admin");
    }
  }, [user, authLoading, navigate]);

  // Always scroll to top when changing steps so the user sees the top of the next step
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  // Real-time debounced validation for Job Description input (~500ms)
  useEffect(() => {
    if (creationMode === "coding") {
      setJdValidationError(null);
      setIsJdDismissed(false);
      return;
    }

    const trimmed = jdText.trim();
    if (!trimmed) {
      setJdValidationError(null);
      return;
    }

    const timer = setTimeout(() => {
      const res = validateJobDescription(trimmed);
      if (!res.isValid && res.message) {
        setJdValidationError(res.message);
        setIsJdDismissed(false);
      } else {
        setJdValidationError(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [jdText, creationMode]);

  const handleJdBlur = () => {
    if (creationMode === "coding") return;
    const trimmed = jdText.trim();
    if (!trimmed) return;
    const res = validateJobDescription(trimmed);
    if (!res.isValid && res.message) {
      setJdValidationError(res.message);
      setIsJdDismissed(false);
    } else {
      setJdValidationError(null);
    }
  };

  const handleJdPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted || creationMode === "coding") return;
    setTimeout(() => {
      const targetVal = ((e.target as HTMLTextAreaElement).value || pasted).trim();
      autoExtractFromText(targetVal);
      setRemovedCodingTypes([]);
      setCustomCodingTypes([]);
      const res = validateJobDescription(targetVal);
      if (!res.isValid && res.message) {
        setJdValidationError(res.message);
        setIsJdDismissed(false);
      } else {
        setJdValidationError(null);
      }
    }, 50);
  };

  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit for document uploads

  const processJdFile = async (f: File) => {
    if (f.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
      toast({
        title: "File exceeds 5MB limit",
        description: `Selected file is ${sizeMb}MB. Please upload a file smaller than 5MB or paste the text directly.`,
        variant: "destructive",
      });
      return false;
    }

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    const fileName = f.name.toLowerCase();
    const hasValidExt = fileName.endsWith(".pdf") || fileName.endsWith(".docx") || fileName.endsWith(".txt");
    if (!validTypes.includes(f.type) && !hasValidExt) {
      toast({ title: "Invalid file type", description: "Please upload a PDF, DOCX, or TXT file.", variant: "destructive" });
      return false;
    }
    const abortCtrl = new AbortController();
    extractAbortRef.current = abortCtrl;
    setFile(f);
    setParsing(true);

    try {
      const text = await extractText(f, abortCtrl.signal);
      setPreviewText("");
      setJdText(text); // Automatically use extracted text
      autoExtractFromText(text);
      setCustomSuggestions([]); // Trigger fresh dynamic suggestions from extracted document
      setRemovedCodingTypes([]); // Reveal fresh AI recommendations for this document
      setCustomCodingTypes([]); // Reset custom additions
      setShowPreview(false);
      
      const validation = validateJobDescription(text.trim());
      if (!validation.isValid && validation.message) {
        setJdValidationError(validation.message);
        setIsJdDismissed(false);
      } else {
        setJdValidationError(null);
        toast({ title: "File parsed successfully" });
      }
      return true;
    } catch (err: any) {
      if (err.name === "AbortError" || abortCtrl.signal.aborted) {
        toast({ title: "Extraction cancelled" });
        return false;
      }
      toast({ title: "Error reading file", description: err.message, variant: "destructive" });
      setFile(null);
      setJdValidationError(null);
      return false;
    } finally {
      setParsing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await processJdFile(f);
    e.target.value = "";
  };

  const processCodingFile = async (f: File) => {
    if (f.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
      toast({
        title: "File exceeds 5MB limit",
        description: `Selected file is ${sizeMb}MB. Please upload a coding problem file smaller than 5MB.`,
        variant: "destructive",
      });
      return false;
    }

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    const fileName = f.name.toLowerCase();
    const hasValidExt = fileName.endsWith(".pdf") || fileName.endsWith(".docx") || fileName.endsWith(".txt");
    if (!validTypes.includes(f.type) && !hasValidExt) {
      toast({ title: "Invalid file type", description: "Please upload a PDF, DOCX, or TXT file.", variant: "destructive" });
      return false;
    }

    const abortCtrl = new AbortController();
    extractCodingAbortRef.current = abortCtrl;
    setCodingFile(f);
    setCodingQuestions([]);
    setCodingParsed(false);
    setParsingCoding(true);

    try {
      const result = await parseCodingQuestions(f, abortCtrl.signal);
      const rawParsed = result.questions || [];
      const uniqueParsed: any[] = [];
      for (const q of rawParsed) {
        const check = checkQuestionDuplicate(
          { title: q.title, description: q.description },
          uniqueParsed
        );
        if (!check.isDuplicate) {
          uniqueParsed.push(q);
        }
      }
      setCodingQuestions(uniqueParsed);
      setCodingParsed(true);
      if (uniqueParsed.length > 0) {
        toast({ title: `Successfully extracted ${uniqueParsed.length} coding problem(s)` });
      } else {
        toast({
          title: "No coding problems detected",
          description: "Could not identify structured problems in this file.",
          variant: "destructive"
        });
      }
      return true;
    } catch (err: any) {
      if (err.name === "AbortError" || abortCtrl.signal.aborted) {
        toast({ title: "Extraction cancelled" });
        setCodingFile(null);
        return false;
      }
      toast({ title: "Error parsing coding file", description: err.message, variant: "destructive" });
      setCodingFile(null);
      return false;
    } finally {
      setParsingCoding(false);
    }
  };

  const handleGenerateAiCoding = async (isRawProblem: boolean = false) => {
    let sourceText = "";
    if (isRawProblem) {
      sourceText = pastedCodingText.trim();
      if (!sourceText) {
        toast({
          title: "Problem text required",
          description: "Please paste a problem description, requirements, or test cases.",
          variant: "destructive",
        });
        return;
      }
    } else {
      const parts: string[] = [];
      const activeRole = (jobRole?.trim() || selectedJobRole?.trim() || "");
      if (activeRole) parts.push(`Role / Title: ${activeRole}`);
      if (department?.trim()) parts.push(`Department: ${department.trim()}`);
      if (seniorityLevel) parts.push(`Target Seniority Level: ${seniorityLevel}`);
      if (experienceMin !== "" || experienceMax !== "") {
        parts.push(`Experience Range: ${experienceMin || 0} to ${experienceMax || "+"} years`);
      }
      if (skillTags && skillTags.length > 0) {
        parts.push(`Required Technical Skills & Technologies:\n${skillTags.join(", ")}`);
      }

      const activeJd = (jdText?.trim() || previewText?.trim() || "");
      if (activeJd) {
        parts.push(`Job Description / Candidate Resume Context:\n${activeJd}`);
      }

      if (selectedCodingTypes.length > 0) {
        parts.push(`Target Coding Challenge Types (MANDATORY REQUIREMENT):\n${selectedCodingTypes.map((t) => `• ${t}`).join("\n")}`);
      }
      if (aiCodingCustomTopic?.trim()) parts.push(`Focus Topics & Requirements: ${aiCodingCustomTopic.trim()}`);
      if (customInstructions?.trim()) parts.push(`General Instructions: ${customInstructions.trim()}`);

      sourceText = parts.join("\n\n").trim();
      if (!sourceText) {
        toast({
          title: "Context required for AI Generation",
          description: "Please enter a Job Title or Description above, or specify Focus Topics below.",
          variant: "destructive",
        });
        return;
      }
    }

    setGeneratingAiCoding(true);
    try {
      const combinedCustomInstructions = [
        selectedCodingTypes.length > 0 ? `Target Challenge Types: ${selectedCodingTypes.join(", ")}` : "",
        skillTags.length > 0 ? `Key Technical Skills: ${skillTags.join(", ")}` : "",
        aiCodingCustomTopic.trim(),
        customInstructions.trim(),
      ].filter(Boolean).join(" • ");

      const resp = await generateCodingQuestions({
        sourceText: sourceText,
        difficulty: aiCodingDifficulty,
        count: isRawProblem ? 1 : aiCodingCount,
        customInstructions: isRawProblem ? undefined : (combinedCustomInstructions || undefined),
        challengeTypes: isRawProblem ? undefined : (selectedCodingTypes.length > 0 ? selectedCodingTypes : undefined),
        isRawProblem: isRawProblem,
      });

      const rawQuestions = resp.questions || [];
      if (rawQuestions.length === 0) {
        toast({
          title: "No coding problems generated",
          description: "The AI could not generate coding problems. Please try different focus topics or paste the problem text directly.",
          variant: "destructive",
        });
        return;
      }

      // Deduplicate with existing coding questions
      const uniqueNew: any[] = [];
      for (const q of rawQuestions) {
        const check = checkQuestionDuplicate(
          { title: q.title, description: q.description },
          [...codingQuestions, ...uniqueNew]
        );
        if (!check.isDuplicate) {
          uniqueNew.push(q);
        }
      }

      if (uniqueNew.length === 0) {
        toast({
          title: "Duplicate problem detected",
          description: "The generated problem is already present in your list.",
        });
        return;
      }

      const combined = [...codingQuestions, ...uniqueNew];
      setCodingQuestions(combined);
      setCodingParsed(true);
      setCodingFile(null);

      toast({
        title: isRawProblem
          ? "Problem parsed successfully!"
          : `Generated ${uniqueNew.length} coding challenge${uniqueNew.length !== 1 ? "s" : ""}!`,
        description: "Review and customize them in Step 2.",
      });

      if (isRawProblem) {
        setPastedCodingText("");
      }
    } catch (err: any) {
      toast({
        title: "Coding generation failed",
        description: err.message || "Failed to generate coding challenges. Please check backend connection.",
        variant: "destructive",
      });
    } finally {
      setGeneratingAiCoding(false);
    }
  };

  const handleGenerateQuestions = async () => {
    // Validation based on mode
    if (creationMode !== "coding") {
      const trimmed = jdText?.trim() || "";
      if (!trimmed) {
        setJdValidationError(INVALID_JD_MESSAGE);
        setIsJdDismissed(false);
        document.getElementById("jd-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const validation = validateJobDescription(trimmed);
      if (!validation.isValid && validation.message) {
        setJdValidationError(validation.message);
        setIsJdDismissed(false);
        document.getElementById("jd-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (creationMode !== "jd" && codingQuestions.length === 0 && !codingFile) {
      toast({
        title: "Please add coding problems",
        description: "Generate with AI, upload a file, or paste a challenge to proceed.",
        variant: "destructive",
      });
      return;
    }
    const availabilityValidation = validateAvailabilityWindow(availableFrom, availableUntil);
    if (availabilityValidation.startPast || availabilityValidation.untilPast || availabilityValidation.endBeforeStart) {
      setScheduleErrors(availabilityValidation);
      toast({
        title: "Invalid Availability Window",
        description: availabilityValidation.startPast
          ? "Interview start time cannot be in the past."
          : availabilityValidation.untilPast
            ? "Interview end time cannot be in the past."
            : "Availability end time must be after start time.",
        variant: "destructive"
      });
      return;
    } else {
      setScheduleErrors({ startPast: false, untilPast: false, endBeforeStart: false });
    }
    if (!user) return;

    // 1. Mandatory validation checks before Step 2
    const finalRole = (selectedJobRole || "").trim();
    if (!finalRole) {
      toast({
        title: "Job Role is Required",
        description: "Please specify a Job Role or Title before proceeding.",
        variant: "destructive"
      });
      document.getElementById("job-role-field")?.focus();
      return;
    }

    const finalInterviewName = (interviewName || "").trim() || `${finalRole} Assessment`;

    if (questionCount <= 0) {
      toast({
        title: "Question Count Invalid",
        description: "Number of questions must be greater than 0.",
        variant: "destructive"
      });
      return;
    }

    if ((creationMode === "hybrid" || creationMode === "coding") && codingCount <= 0) {
      toast({
        title: "Coding Problems Count Invalid",
        description: "Number of coding problems must be greater than 0 when coding format is active.",
        variant: "destructive"
      });
      return;
    }

    if (experienceMin !== "" && experienceMax !== "" && Number(experienceMin) > Number(experienceMax)) {
      toast({
        title: "Experience Range Invalid",
        description: "Minimum experience years cannot exceed maximum experience years.",
        variant: "destructive"
      });
      return;
    }

    const setupMetadata: InterviewSetupMetadata = {
      jobRoleId: selectedJobRoleId,
      departmentId: departmentId,
      department: department,
      skillTags: skillTags,
      difficultyLevel: difficultyLevel,
      questionCount: questionCount,
      codingCount: codingCount,
      interviewStage: interviewStage,
      seniorityLevel: seniorityLevel,
      experienceMin: experienceMin === "" ? 0 : Number(experienceMin),
      experienceMax: experienceMax === "" ? 0 : Number(experienceMax),
      interviewLanguage: interviewLanguage,
      linkExpiryDays: linkExpiryDays,
      requireCamera: requireCamera,
      detectTabSwitch: detectTabSwitch,
      blockCopyPaste: blockCopyPaste,
      maxRetakeAttempts: maxRetakeAttempts,
    };

    setGenerating(true);
    setStep("questions");
    window.scrollTo({ top: 0, behavior: "instant" });
    try {
      let currentInterviewId = "";
      let interview;

      if (interviewId) {
        const roleName = creationMode === "coding" ? "Coding-Only Assessment" : finalRole;
        const formattedFrom = availableFrom ? convertLocalToUTCString(availableFrom, timezone) : null;
        const formattedUntil = availableUntil ? convertLocalToUTCString(availableUntil, timezone) : null;
        interview = await updateInterviewSettings(interviewId, {
          interview_name: finalInterviewName,
          save_video_recording: saveVideoRecording,
          show_candidate_video: showCandidateVideo,
          duration_minutes: durationMinutes,
          job_role: roleName,
          job_role_id: selectedJobRoleId,
          department_id: departmentId,
          department: department,
          skill_tags: skillTags,
          difficulty_level: difficultyLevel,
          question_count: questionCount,
          coding_count: codingCount,
          interview_stage: interviewStage,
          seniority_level: seniorityLevel,
          experience_min: experienceMin === "" ? 0 : Number(experienceMin),
          experience_max: experienceMax === "" ? 0 : Number(experienceMax),
          interview_language: interviewLanguage,
          link_expiry_days: linkExpiryDays,
          require_camera: requireCamera,
          detect_tab_switch: detectTabSwitch,
          block_copy_paste: blockCopyPaste,
          max_retake_attempts: maxRetakeAttempts,
          jd_file_path: jdText.substring(0, 500),
          candidate_experience: experienceLevel || seniorityLevel.toLowerCase(),
          proctoring_enabled: proctoringEnabled,
          proctoring_max_strikes: proctoringMaxStrikes,
          proctoring_max_strikes_action: proctoringMaxStrikesAction,
          evaluation_score_cutoff: evaluationScoreCutoff,
          evaluation_cutoff_action: evaluationCutoffAction,
          available_from: formattedFrom,
          available_until: formattedUntil,
        });
      } else {
        // 1. Create Interview Record
        const roleName = creationMode === "coding" ? "Coding-Only Assessment" : jdText;
        const formattedFrom = availableFrom ? convertLocalToUTCString(availableFrom, timezone) : undefined;
        const formattedUntil = availableUntil ? convertLocalToUTCString(availableUntil, timezone) : undefined;
        interview = await createInterviewFromJD(
          roleName,
          saveVideoRecording,
          showCandidateVideo,
          durationMinutes,
          candidateName || undefined,
          candidateEmail || undefined,
          finalRole,
          experienceLevel || seniorityLevel.toLowerCase(),
          proctoringEnabled,
          proctoringMaxStrikes,
          70, // legacy proctoring cutoff
          proctoringMaxStrikesAction,
          "manual_review", // legacy proctoring action
          evaluationScoreCutoff,
          evaluationCutoffAction,
          formattedFrom,
          formattedUntil,
          finalInterviewName,
          undefined,
          setupMetadata
        );
        setInterviewId(interview.id);
        emailInterviewIdRef.current = interview.id;
        setCandidateEmails(candidateEmail ? [{ email: candidateEmail, name: candidateName || "" }] : []);
        setEmailInput("");
        setFailedCandidateEmails([]);
        setEmailSentSuccessfully(false);
        setEmailSendFailed(false);
      }
      currentInterviewId = interview.id;

      // Helper: convert parsed coding questions into selectable items for Step 2
      // Select the first one by default; deselect the rest so recruiter must consciously pick.
      const toCodingSelectable = (cqs: any[]) =>
        cqs.map((q, idx) => ({
          ...q,
          // Give each a stable temporary id keyed by index (real id comes after DB save)
          id: q.id ?? `coding-draft-${idx}`,
          question_type: "coding",
          difficulty: q.difficulty ?? "medium",
          source: q.source ?? "uploaded",
          original_title: q.title || q.question_text,
          original_description: q.description,
          original_difficulty: q.difficulty ?? "medium",
          original_test_cases: q.test_cases,
          selected: idx === 0, // pre-select only the first by default
        }));

      // 2. Handle technical/behavioral question generation
      if (creationMode !== "coding") {
        const result = await generateQuestions(interview.id, jdText, customInstructions);
        const jdQs = result.questions.map((q: any) => ({ ...q, selected: q.selected ?? false }));

        // For hybrid mode: also append uploaded coding questions into the selection panel
        const codingSelectables = creationMode === "hybrid" && codingQuestions.length > 0
          ? toCodingSelectable(codingQuestions)
          : [];

        setQuestions([...jdQs, ...codingSelectables]);
        setStep("questions");
      } else {
        // Coding-only: show coding questions in selection step — don't auto-save yet
        setQuestions(toCodingSelectable(codingQuestions));
        setStep("questions");
      }
    } catch (err: any) {
      setStep("upload");
      const msg = err.message || "";
      if (
        msg.includes("invalid or nonsensical") ||
        msg.includes("Invalid JD") ||
        msg.includes("Invalid Content") ||
        msg.includes("valid job description") ||
        msg.includes("real job description") ||
        msg.includes("meaningful content")
      ) {
        setJdValidationError(INVALID_JD_MESSAGE);
        setIsJdDismissed(false);
        document.getElementById("jd-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
    setGenerating(false);
  };

  const toggleQuestion = (id: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, selected: !q.selected } : q))
    );
  };

  const selectAll = (type: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.question_type === type ? { ...q, selected: true } : q))
    );
  };

  const deselectAll = (type: string) => {
    setQuestions((prev) =>
      prev.map((q) => (q.question_type === type ? { ...q, selected: false } : q))
    );
  };

  // ── Edit Handlers ──
  const startEditing = (q: any) => {
    setEditingId(q.id);
    setEditError(null);
    setDuplicateConflictId(null);
    if (q.question_type === "coding") {
      setEditCodingTitle(q.title || q.question_text || "");
      setEditCodingDescription(q.description || "");
      setEditDifficulty(q.difficulty || "medium");
      setEditCodingTestCases(
        Array.isArray(q.test_cases)
          ? q.test_cases.map((tc: any) => ({
              input: tc.input ?? tc.Input ?? "",
              expected_output: tc.expected_output ?? tc.expectedOutput ?? tc.output ?? tc.Output ?? "",
            }))
          : []
      );
    } else {
      setEditText(q.question_text);
      setEditType(q.question_type);
      setEditDifficulty(q.difficulty);
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditError(null);
    setDuplicateConflictId(null);
    setEditText("");
    setEditCodingTitle("");
    setEditCodingDescription("");
    setEditCodingTestCases([]);
  };

  const saveEdit = async (qId: string) => {
    if (!editText.trim()) return;

    // Strict duplicate check against other questions in the interview
    const dup = findQuestionDuplicate(editText.trim(), questions, qId, editType);
    if (dup.isDuplicate) {
      setEditError({
        field: "text",
        message: "This question has already been added.",
        matchedTitle: dup.matchedText,
      });
      setDuplicateConflictId(dup.matchedId || null);
      if (dup.matchedId) {
        setTimeout(() => {
          const el = document.getElementById(`question-card-${dup.matchedId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    setDuplicateConflictId(null);
    try {
      const updated = await apiEditQuestion(qId, {
        question_text: editText.trim(),
        question_type: editType,
        difficulty: editDifficulty,
      });
      setQuestions((prev) => prev.map((q) => (q.id === qId ? { ...q, ...updated } : q)));
      setEditingId(null);
      toast({ title: "Question updated" });
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("already exists")) {
        setEditError({
          field: "text",
          message: "Another question with this wording already exists in this interview.",
        });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    }
    setSavingEdit(false);
  };

  const saveCodingEdit = async (qId: string) => {
    if (!editCodingTitle.trim() || !editCodingDescription.trim()) return;

    // Check for duplicate question against other questions in the interview
    const dupCheck = checkQuestionDuplicate(
      { title: editCodingTitle.trim(), description: editCodingDescription.trim() },
      questions,
      qId
    );
    if (dupCheck.isDuplicate) {
      const field = dupCheck.reason || "title";
      setEditError({
        field,
        message: "This question has already been added.",
        matchedTitle: dupCheck.matchedTitle,
      });
      setDuplicateConflictId(dupCheck.matchedId || null);
      if (dupCheck.matchedId) {
        setTimeout(() => {
          const el = document.getElementById(`question-card-${dupCheck.matchedId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    setDuplicateConflictId(null);
    try {
      const isDraft = String(qId).startsWith("coding-draft-");
      const validTestCases = editCodingTestCases.filter(
        (tc) => tc.input.trim() || tc.expected_output.trim()
      );
      const updates = {
        title: editCodingTitle.trim(),
        description: editCodingDescription.trim(),
        difficulty: editDifficulty,
        test_cases: validTestCases,
        source: "edited",
      };

      if (!isDraft) {
        const updated = await editCodingQuestion(qId, updates);
        setQuestions((prev) =>
          prev.map((q) => (q.id === qId ? { ...q, ...updated, source: "edited" } : q))
        );
      } else {
        setQuestions((prev) =>
          prev.map((q) => (q.id === qId ? { ...q, ...updates } : q))
        );
      }
      setEditingId(null);
      setEditError(null);
      setDuplicateConflictId(null);
      toast({ title: "Coding problem updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSavingEdit(false);
  };

  const revertQuestion = async (q: any) => {
    if (!q.original_text) return;
    setSavingEdit(true);
    try {
      const updated = await apiEditQuestion(q.id, { question_text: q.original_text });
      setQuestions((prev) => prev.map((qn) => (qn.id === q.id ? { ...qn, ...updated } : qn)));
      toast({ title: "Question reverted to original" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSavingEdit(false);
  };

  const revertCodingQuestion = async (q: any) => {
    if (!q.original_title && !q.original_description) return;
    setSavingEdit(true);
    try {
      const updates = {
        title: q.original_title || q.title,
        description: q.original_description || q.description,
        difficulty: q.original_difficulty || q.difficulty,
        test_cases: q.original_test_cases || q.test_cases,
        source: "uploaded",
      };
      const isDraft = String(q.id).startsWith("coding-draft-");
      if (!isDraft) {
        await editCodingQuestion(q.id, updates);
      }
      setQuestions((prev) =>
        prev.map((item) => (item.id === q.id ? { ...item, ...updates } : item))
      );
      setEditingId(null);
      toast({ title: "Coding problem reverted to original" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSavingEdit(false);
  };

  const handleDeleteQuestion = async (qId: string) => {
    const q = questions.find((item) => item.id === qId);
    try {
      if (q?.question_type === "coding") {
        const isDraft = String(qId).startsWith("coding-draft-");
        if (!isDraft) {
          await deleteCodingQuestion(qId);
        }
        setQuestions((prev) => prev.filter((item) => item.id !== qId));
        toast({ title: "Coding problem deleted" });
      } else {
        await apiDeleteQuestion(qId);
        setQuestions((prev) => prev.filter((item) => item.id !== qId));
        toast({ title: "Question deleted" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleAddCustomQuestion = async (type: string) => {
    if (!newQText.trim() || !interviewId) return;

    // High-precision duplicate check: flags only genuine duplicates
    const dup = findQuestionDuplicate(newQText.trim(), questions, undefined, type);
    if (dup.isDuplicate) {
      setCustomQError({
        message: "This question has already been added.",
        matchedTitle: dup.matchedText,
      });
      setDuplicateConflictId(dup.matchedId || null);
      if (dup.matchedId) {
        setTimeout(() => {
          const el = document.getElementById(`question-card-${dup.matchedId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return;
    }

    setSavingNew(true);
    setCustomQError(null);
    setDuplicateConflictId(null);
    try {
      const created = await apiAddCustomQuestion(interviewId, newQText.trim(), type, newQDifficulty);
      setQuestions((prev) => [...prev, { ...created, selected: true }]);
      setNewQText("");
      setAddingType(null);
      toast({ title: "Custom question added" });
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("already added")) {
        setCustomQError({
          message: "This question has already been added to this interview.",
        });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    }
    setSavingNew(false);
  };

  const handleAddCodingQuestion = async () => {
    if (!newCodingTitle.trim() || !newCodingDescription.trim()) return;

    // Enterprise duplicate check
    const dupCheck = checkQuestionDuplicate(
      { title: newCodingTitle.trim(), description: newCodingDescription.trim() },
      questions
    );
    if (dupCheck.isDuplicate) {
      const field = dupCheck.reason || "title";
      setCodingError({
        field,
        message: "This question has already been added.",
        matchedTitle: dupCheck.matchedTitle,
      });
      setDuplicateConflictId(dupCheck.matchedId || null);
      if (dupCheck.matchedId) {
        setTimeout(() => {
          const el = document.getElementById(`question-card-${dupCheck.matchedId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return;
    }

    setSavingNew(true);
    setCodingError(null);
    setDuplicateConflictId(null);
    try {
      const validTestCases = newCodingTestCases.filter(
        (tc) => tc.input.trim() || tc.expected_output.trim()
      );
      const newDraft = {
        id: `coding-draft-${Date.now()}`,
        question_type: "coding",
        title: newCodingTitle.trim(),
        description: newCodingDescription.trim(),
        difficulty: newCodingDifficulty,
        test_cases: validTestCases,
        source: "custom",
        selected: true,
      };
      setQuestions((prev) => [...prev, newDraft]);
      setNewCodingTitle("");
      setNewCodingDescription("");
      setNewCodingDifficulty("medium");
      setNewCodingTestCases([]);
      setAddingType(null);
      setCodingError(null);
      setDuplicateConflictId(null);
      toast({ title: "Custom coding problem added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSavingNew(false);
  };

  const handleProceedToEvaluation = async () => {
    const selectedQs = questions.filter((q) => q.selected);
    const selectedCoding = questions.filter((q) => q.question_type === "coding" && q.selected);

    if (creationMode === "coding" && selectedCoding.length === 0) {
      toast({ title: "Please select at least one coding problem", variant: "destructive" });
      return;
    }
    if (selectedQs.length === 0) {
      toast({ title: "Please select at least one question", variant: "destructive" });
      return;
    }
    if (!interviewId) return;

    setGeneratingLink(true);
    try {
      // Update selection for technical/behavioral questions in DB (these have real DB ids)
      const dbQuestions = questions.filter((q) => q.question_type !== "coding" && !String(q.id).startsWith("coding-draft-"));
      if (dbQuestions.length > 0) {
        await updateQuestionSelection(interviewId, dbQuestions);
      }

      // Save ONLY selected coding questions (from both hybrid and coding-only modes)
      const selectedCodingToSave = selectedCoding.map((q) => {
        // Strip the temporary draft id and tracking fields before saving — backend assigns real id
        const { id, selected, source, original_title, original_description, original_difficulty, original_test_cases, ...rest } = q;
        return rest;
      });

      // Deduplicate before saving to backend
      const uniqueCodingToSave: any[] = [];
      for (const q of selectedCodingToSave) {
        const check = checkQuestionDuplicate(
          { title: q.title, description: q.description },
          uniqueCodingToSave
        );
        if (!check.isDuplicate) {
          uniqueCodingToSave.push(q);
        }
      }

      if (uniqueCodingToSave.length > 0) {
        await createCodingQuestions(interviewId, uniqueCodingToSave, true);
      }

      setStep("evaluation");
    } catch (err: any) {
      toast({ title: "Error saving questions", description: err.message, variant: "destructive" });
    }
    setGeneratingLink(false);
  };

  const handleFinishAndGenerateLink = async () => {
    const activeParams = rubricParameters.filter(p => p.enabled);
    if (activeParams.length === 0) {
      toast({ title: "Please enable at least one evaluation parameter", variant: "destructive" });
      return;
    }

    const totalWeight = activeParams.reduce((sum, p) => sum + (p.weight || 0), 0);
    if (totalWeight !== 100) {
      toast({
        title: `Rubric weights sum to ${totalWeight}%`,
        description: "Evaluation weights must equal exactly 100%. Click 'Auto-Balance' to adjust automatically.",
        variant: "destructive",
      });
      return;
    }

    if (!interviewId) return;

    setSavingRubric(true);
    try {
      const rubricPayload = activeParams.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        weight: p.weight,
        is_custom: !!p.is_custom,
      }));

      // Update interview with enterprise evaluation criteria & benchmark thresholds
      await updateInterview(interviewId, {
        evaluation_rubric: rubricPayload,
        evaluation_score_cutoff: evaluationScoreCutoff,
        evaluation_cutoff_action: evaluationCutoffAction,
      });

      // Generate interview dispatch link
      const link = await generateInterviewLink(interviewId);
      setGeneratedLink(link);
      setStep("link");
    } catch (err: any) {
      toast({ title: "Error saving evaluation rubric", description: err.message, variant: "destructive" });
    }
    setSavingRubric(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast({ title: "Link copied to clipboard!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    emailInterviewIdRef.current = null;
    setCandidateEmails([]);
    setEmailInput("");
    setEmailSubject("");
    setEmailBody("");
    setStep("upload");
    setJdInputTab("upload");
    setFile(null);
    setJdText("");
    setCustomInstructions("");
    setPreviewText("");
    setShowPreview(false);
    setQuestions([]);
    setInterviewId(null);
    setGeneratedLink("");
    setCopied(false);
    setCodingFile(null);
    setCodingQuestions([]);
    setCodingParsed(false);
    setCodingInputTab("ai");
    setGeneratingAiCoding(false);
    setAiCodingDifficulty("medium");
    setAiCodingCount(2);
    setAiCodingCustomTopic("");
    setRemovedCodingTypes([]);
    setCustomCodingTypes([]);
    setAiSemanticCodingTypes(null);
    setCodingTypesClarification(null);
    setIsAnalyzingCodingTypes(false);
    setSelectedCodingTypes(recommendedCodingTypes.slice(0, 2));
    setNewChallengeTypeInput("");
    setIsAddingCustomType(false);
    setPastedCodingText("");
    setEmailSentSuccessfully(false);
    setEmailSendFailed(false);
    setFailedCandidateEmails([]);
    setLastEmailError(null);
    setDialogError(null);
    setAttemptedSend(false);
    setSaveVideoRecording(true);
    setShowCandidateVideo(true);
    setDurationMinutes(30);
    setProctoringEnabled(true);
    setProctoringMaxStrikes(3);
    setProctoringMaxStrikesAction("flag_review");
    setEvaluationScoreCutoff(60);
    setEvaluationCutoffAction("manual_review");
    setAvailableFrom("");
    setAvailableUntil("");
    setRubricParameters(INITIAL_EVALUATION_RUBRIC);
    setActivePreset(null);
    setSearchParams({}, { replace: true });
  };

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] w-full bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const selectedCount = questions.filter((q) => q.selected).length;
  const groupedQuestions = {
    technical: questions.filter((q) => q.question_type === "technical"),
    coding: questions.filter((q) => q.question_type === "coding"),
    behavioral: questions.filter((q) => q.question_type === "behavioral"),
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background flex flex-col">
      <Navbar />

      <div className="flex-1 px-4 pt-20 pb-12">
        <div className={`container mx-auto transition-all duration-300 ${step === "upload" ? "max-w-7xl px-2 sm:px-4" : (step === "questions" || step === "evaluation") ? "max-w-5xl px-4" : "max-w-2xl px-4"}`}>
          {/* Enterprise Progress Steps */}
          <div className="mb-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between relative">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-border/60 -translate-y-1/2 z-0" />
              <div
                className="absolute top-1/2 left-0 h-0.5 bg-primary transition-all duration-500 -translate-y-1/2 z-0"
                style={{
                  width: step === "upload" ? "0%" : step === "questions" ? "33%" : step === "evaluation" ? "66%" : "100%",
                }}
              />

              {[
                { key: "upload", stepNum: "01", label: "Interview Setup" },
                { key: "questions", stepNum: "02", label: "Question Review" },
                { key: "evaluation", stepNum: "03", label: "Evaluation Criteria" },
                { key: "link", stepNum: "04", label: "Invite & Share" },
              ].map((s, i) => {
                const isActive = step === s.key;
                const isCompleted =
                  (step === "questions" && i === 0) ||
                  (step === "evaluation" && i <= 1) ||
                  (step === "link" && i <= 2);

                return (
                  <div key={s.key} className="relative z-10 flex flex-col items-center">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 shadow-sm ${
                        isActive
                          ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-105"
                          : isCompleted
                          ? "bg-emerald-600 text-white shadow-emerald-500/20"
                          : "bg-card text-muted-foreground border border-border"
                      }`}
                    >
                      {isCompleted ? <Check className="h-4 w-4 stroke-[2.5]" /> : s.stepNum}
                    </div>
                    <div className="mt-2 text-center">
                      <span className={`text-xs sm:text-sm font-semibold block transition-colors ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 1: Upload & Configure Studio */}
          {step === "upload" && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="w-full">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* ── LEFT COLUMN: Interview Structure (7 cols) ── */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="pb-1.5 border-b border-border/40">
                    <h2 className="text-sm font-semibold text-foreground">
                      Interview Structure
                    </h2>
                  </div>
                  
                  {/* Interview Format Card */}
                  {/* Role & Candidate Profile (Unified 2-Column Grid Card) */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
                      
                      {/* Left Column: Job Title & Experience Range */}
                      <div className="space-y-3.5">
                        {/* Job Title */}
                        <div className="space-y-1.5">
                          <label htmlFor="job-role-field" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Briefcase className="h-3.5 w-3.5 text-primary" />
                            Job Title
                            <span className="text-destructive font-bold text-xs" title="Required">*</span>
                          </label>

                          <div className="relative">
                            <input
                              type="text"
                              id="job-role-field"
                              value={selectedJobRole}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedJobRole(val);
                                const matched = rolesMasterList.find(
                                  (r) => r.name.toLowerCase() === val.trim().toLowerCase()
                                );
                                setSelectedJobRoleId(matched ? matched.id : null);
                                if (val.trim()) {
                                  setInterviewName(`${val.trim()} Assessment`);
                                }
                              }}
                              placeholder="e.g. Senior Frontend Engineer"
                              className="w-full text-xs px-3 py-2 pr-8 rounded-lg bg-background border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors"
                            />
                            {selectedJobRole && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedJobRole("");
                                  setSelectedJobRoleId(null);
                                }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded"
                                title="Clear role"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Experience Range */}
                        <div className="space-y-1.5 pt-2 border-t border-border/40">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-primary" />
                              Experience Range
                            </label>
                            {(experienceMin !== "" || experienceMax !== "") && (
                              <span className="text-[11px] font-semibold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                                {experienceMin !== "" && experienceMax !== ""
                                  ? `${experienceMin} – ${experienceMax} yrs`
                                  : experienceMin !== ""
                                  ? `${experienceMin}+ yrs`
                                  : `Up to ${experienceMax} yrs`}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="relative flex items-center">
                              <span className="absolute left-2.5 text-[11px] font-semibold text-muted-foreground select-none">
                                Min:
                              </span>
                              <input
                                type="number"
                                min="0"
                                max="30"
                                placeholder="e.g. 2"
                                value={experienceMin}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0);
                                  setExperienceMin(val);
                                }}
                                className="w-full text-xs pl-11 pr-8 py-2 rounded-lg bg-background border border-border/70 text-foreground font-semibold placeholder:font-normal focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors"
                              />
                              <span className="absolute right-2.5 text-[10px] font-medium text-muted-foreground select-none">
                                yrs
                              </span>
                            </div>
                            <div className="relative flex items-center">
                              <span className="absolute left-2.5 text-[11px] font-semibold text-muted-foreground select-none">
                                Max:
                              </span>
                              <input
                                type="number"
                                min="0"
                                max="30"
                                placeholder="e.g. 5"
                                value={experienceMax}
                                onChange={(e) => {
                                  const val = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0);
                                  setExperienceMax(val);
                                }}
                                className="w-full text-xs pl-12 pr-8 py-2 rounded-lg bg-background border border-border/70 text-foreground font-semibold placeholder:font-normal focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors"
                              />
                              <span className="absolute right-2.5 text-[10px] font-medium text-muted-foreground select-none">
                                yrs
                              </span>
                            </div>
                          </div>
                          {experienceMin !== "" && experienceMax !== "" && Number(experienceMin) > Number(experienceMax) && (
                            <p className="text-[10px] text-destructive mt-1 font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" /> Minimum experience cannot exceed maximum experience.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Skill Tags */}
                      <div className="space-y-2">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5 text-primary" />
                              Skill Tags
                              {skillTags.length > 0 && (
                                <span className="text-[11px] font-normal text-muted-foreground">
                                  ({skillTags.length})
                                </span>
                              )}
                            </label>
                            {skillTags.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setSkillTags([])}
                                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                              >
                                Clear all
                              </button>
                            )}
                          </div>

                          {/* Chips Display */}
                          <div className="flex flex-wrap items-center content-start gap-1.5 min-h-[64px] max-h-[96px] overflow-y-auto p-2 rounded-lg bg-background border border-border/70">
                            {skillTags.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic px-1">
                                No skills added. Type below or upload a JD to auto-extract.
                              </span>
                            ) : (
                              skillTags.map((skill) => (
                                <span
                                  key={skill}
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium group transition-all"
                                >
                                  <span>{skill}</span>
                                  <button
                                    type="button"
                                    onClick={() => setSkillTags((prev) => prev.filter((s) => s !== skill))}
                                    className="text-primary/70 hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5 transition-colors"
                                    title={`Remove ${skill}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Add Custom Skill Input */}
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={newSkillInput}
                            onChange={(e) => setNewSkillInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const trimmed = newSkillInput.trim();
                                if (trimmed && !skillTags.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                                  setSkillTags((prev) => [...prev, trimmed]);
                                  setNewSkillInput("");
                                }
                              }
                            }}
                            placeholder="Add skill tag (e.g. React, Docker)..."
                            className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-background border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-colors"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const trimmed = newSkillInput.trim();
                              if (trimmed && !skillTags.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                                setSkillTags((prev) => [...prev, trimmed]);
                                setNewSkillInput("");
                              }
                            }}
                            disabled={!newSkillInput.trim()}
                            className="h-8 text-xs font-medium px-3 rounded-lg"
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add
                          </Button>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Interview Format Card */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
                      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        Interview Format
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {/* Option 1: Hybrid */}
                      <button
                        type="button"
                        onClick={() => setCreationMode("hybrid")}
                        className={`relative p-3 rounded-lg text-left transition-all duration-150 flex flex-col justify-between active:scale-[0.99] focus:outline-none bg-card ${
                          creationMode === "hybrid"
                            ? "border-2 border-primary ring-2 ring-primary/20 shadow-sm"
                            : "border-2 border-border/60 hover:border-border hover:bg-secondary/10"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-2">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                            creationMode === "hybrid"
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-secondary text-muted-foreground border border-border/50"
                          }`}>
                            <Brain className="h-4 w-4" />
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">AI Interview &amp; Coding</div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                            AI spoken interview + live coding challenges.
                          </p>
                        </div>
                      </button>

                      {/* Option 2: Job Description Only */}
                      <button
                        type="button"
                        onClick={() => setCreationMode("jd")}
                        className={`relative p-3 rounded-lg text-left transition-all duration-150 flex flex-col justify-between active:scale-[0.99] focus:outline-none bg-card ${
                          creationMode === "jd"
                            ? "border-2 border-primary ring-2 ring-primary/20 shadow-sm"
                            : "border-2 border-border/60 hover:border-border hover:bg-secondary/10"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-2">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                            creationMode === "jd"
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-secondary text-muted-foreground border border-border/50"
                          }`}>
                            <FileText className="h-4 w-4" />
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">AI Interview</div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                            Technical &amp; behavioral questions from JD or Resume.
                          </p>
                        </div>
                      </button>

                      {/* Option 3: Coding Only */}
                      <button
                        type="button"
                        onClick={() => setCreationMode("coding")}
                        className={`relative p-3 rounded-lg text-left transition-all duration-150 flex flex-col justify-between active:scale-[0.99] focus:outline-none bg-card ${
                          creationMode === "coding"
                            ? "border-2 border-primary ring-2 ring-primary/20 shadow-sm"
                            : "border-2 border-border/60 hover:border-border hover:bg-secondary/10"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-2">
                          <div className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
                            creationMode === "coding"
                              ? "bg-primary/10 text-primary border border-primary/20"
                              : "bg-secondary text-muted-foreground border border-border/50"
                          }`}>
                            <Code2 className="h-4 w-4" />
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">Coding Only</div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                            Hands-on challenges with automated test suites.
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Job Description Studio (Only if hybrid or jd) */}
                  {(creationMode === "hybrid" || creationMode === "jd") && (
                    <div id="jd-section" className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-border/50">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary" />
                          Job Description or Resume
                        </h3>

                        {/* Segmented Control: Upload vs Paste */}
                        <div className="flex items-center p-0.5 bg-secondary/50 rounded-lg border border-border/50 self-start sm:self-auto">
                          <button
                            type="button"
                            onClick={() => setJdInputTab("upload")}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                              jdInputTab === "upload"
                                ? "bg-background text-foreground shadow-sm border border-border/40"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <Upload className="h-3 w-3" /> Upload File
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setJdInputTab("paste")}
                            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                              jdInputTab === "paste"
                                ? "bg-background text-foreground shadow-sm border border-border/40"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <Pencil className="h-3 w-3" /> Paste Text
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* TAB CONTENT: Upload File */}
                      {jdInputTab === "upload" && (
                        <div className="space-y-3">
                          <div className="relative group">
                            <input
                              type="file"
                              accept=".pdf,.docx,.txt"
                              onChange={handleFileUpload}
                              className="hidden"
                              id="jd-upload"
                            />
                            <label
                              htmlFor="jd-upload"
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const droppedFile = e.dataTransfer.files?.[0];
                                if (droppedFile) {
                                  await processJdFile(droppedFile);
                                }
                              }}
                              className={`flex flex-col items-center justify-center gap-2.5 w-full rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
                                file
                                  ? "p-4 bg-primary/[0.02] border-primary/40 hover:border-primary"
                                  : "py-6 px-4 border-border/70 hover:border-primary/60 hover:bg-primary/[0.02]"
                              }`}
                            >
                              {parsing ? (
                                <div className="flex flex-col items-center justify-center py-6 px-4 w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.02] text-center transition-all">
                                  <div className="relative mb-2.5 flex items-center justify-center">
                                    <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
                                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    </div>
                                  </div>
                                  <span className="text-xs font-bold text-foreground">Extracting role requirements from file...</span>
                                  <span className="text-[11px] text-muted-foreground mt-0.5 max-w-sm leading-relaxed">Parsing document structure and text</span>
                                  {file && (
                                    <div className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full bg-background border border-border/70 text-[11px] font-medium text-muted-foreground shadow-2xs">
                                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span className="truncate max-w-[200px] text-foreground font-medium">{file.name}</span>
                                      <span className="text-muted-foreground/60">•</span>
                                      <span>{(file.size / 1024).toFixed(0)} KB</span>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      extractAbortRef.current?.abort();
                                      setParsing(false);
                                      setFile(null);
                                    }}
                                    className="text-[11px] text-muted-foreground hover:text-destructive transition-colors font-medium mt-3 px-2.5 py-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : file ? (
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full bg-background border border-border/60 p-3.5 rounded-lg">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                                      <FileText className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0 text-left">
                                      <div className="text-xs font-bold text-foreground truncate max-w-xs sm:max-w-sm">
                                        {file.name}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                        <span>{(file.size / 1024).toFixed(0)} KB</span>
                                        <span>•</span>
                                        <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                                          <Check className="h-3 w-3" /> Extracted successfully
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setJdInputTab("paste");
                                      }}
                                      className="text-xs font-semibold text-primary hover:underline px-2 py-1"
                                    >
                                      View Text
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setFile(null);
                                        setJdText("");
                                        setCustomSuggestions([]);
                                        setJdValidationError(null);
                                        setIsJdDismissed(false);
                                      }}
                                      className="text-xs font-medium text-destructive hover:bg-destructive/10 px-2.5 py-1 rounded-md border border-destructive/20 transition-colors flex items-center gap-1"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" /> Remove
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center">
                                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2 group-hover:scale-105 transition-transform">
                                    <Upload className="h-4 w-4" />
                                  </div>
                                  <div className="text-xs font-semibold text-foreground">
                                    Click to upload or drag &amp; drop JD or Resume
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Supports PDF, DOCX, or TXT (Max size 5MB)
                                  </p>
                                </div>
                              )}
                            </label>
                          </div>

                          {/* Inline validation message directly below file dropzone */}
                          {file && jdValidationError && !isJdDismissed && (
                            <div
                              role="status"
                              aria-live="polite"
                              className="p-3 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 flex items-start justify-between gap-2.5 text-xs leading-relaxed"
                            >
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <span>{jdValidationError}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsJdDismissed(true)}
                                className="text-amber-700/70 hover:text-amber-900 dark:text-amber-400/70 dark:hover:text-amber-200 p-0.5 rounded transition-colors shrink-0"
                                aria-label="Dismiss validation message"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* TAB CONTENT: Paste Text */}
                      {jdInputTab === "paste" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Paste role summary, requirements, or candidate resume</span>
                            <div className="flex items-center gap-2.5">
                              {loadingJd && (
                                <span className="text-xs text-primary flex items-center gap-1 font-semibold animate-pulse">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Loading from ATS...
                                </span>
                              )}
                              {jdText && (
                                <span className="text-[11px] font-mono">
                                  {jdText.trim().split(/\s+/).filter(Boolean).length} words • {jdText.length} chars
                                </span>
                              )}
                              {jdText && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setJdText("");
                                    setFile(null);
                                    setCustomSuggestions([]);
                                    setJdValidationError(null);
                                  }}
                                  className="text-muted-foreground hover:text-destructive text-[11px]"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>

                          <textarea
                            value={loadingJd ? "Loading content..." : jdText}
                            onChange={(e) => setJdText(e.target.value)}
                            onBlur={handleJdBlur}
                            onPaste={handleJdPaste}
                            disabled={loadingJd}
                            placeholder={loadingJd ? "Loading content..." : "Paste job description, candidate resume, or role requirements here (Skills, Responsibilities, Experience, Tech Stack)..."}
                            className={`w-full h-36 rounded-xl bg-background border p-3.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 transition-all resize-y shadow-sm disabled:opacity-50 ${
                              !file && jdValidationError && !isJdDismissed
                                ? "border-amber-400 dark:border-amber-600 focus:ring-amber-500/40"
                                : "border-border/70 focus:ring-primary/30"
                            }`}
                          />

                          {/* Inline validation message directly below textarea */}
                          {!file && jdValidationError && !isJdDismissed && (
                            <div
                              role="status"
                              aria-live="polite"
                              className="p-3.5 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 flex items-start justify-between gap-3 text-xs leading-relaxed"
                            >
                              <div className="flex items-start gap-2.5">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                <span>{jdValidationError}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsJdDismissed(true)}
                                className="text-amber-700/70 hover:text-amber-900 dark:text-amber-400/70 dark:hover:text-amber-200 p-0.5 rounded transition-colors shrink-0"
                                aria-label="Dismiss validation message"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Hint Natural Language Layer ── */}
                      <div className="mt-3.5 pt-3.5 border-t border-border/50 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                              <Sparkles className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <label
                                htmlFor="customize-questions-input"
                                className="text-xs font-semibold text-foreground flex items-center gap-1.5 cursor-pointer"
                              >
                                Hint
                              </label>
                            </div>
                          </div>
                        </div>

                        <div className="relative">
                          <input
                            type="text"
                            id="customize-questions-input"
                            value={customInstructions}
                            onChange={(e) => setCustomInstructions(e.target.value)}
                            placeholder="e.g. Focus on hands-on architecture • Ask more scenario questions • Emphasize production debugging..."
                            disabled={parsing}
                            className="w-full h-9 rounded-lg border border-border/70 bg-background px-3 pr-8 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
                          />
                          {customInstructions && !parsing && (
                            <button
                              type="button"
                              onClick={() => setCustomInstructions("")}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                              title="Clear instructions"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Quick Suggestion Pills: Only shown once the user uploads or enters a JD */}
                        {dynamicSuggestions.length > 0 && (
                          <div className="space-y-1.5 pt-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <Wand2 className="h-3 w-3 text-primary/70" /> Quick suggestions:
                              </span>
                              <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 flex items-center gap-1">
                                <Sparkles className="h-2.5 w-2.5" />
                                AI Recommended
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                              {dynamicSuggestions.map((suggestion) => {
                                const isSelected = customInstructions.includes(suggestion);
                                return (
                                  <button
                                    key={suggestion}
                                    type="button"
                                    disabled={parsing}
                                    title={suggestion}
                                    onClick={() => {
                                      if (!customInstructions.trim()) {
                                        setCustomInstructions(suggestion);
                                      } else if (!customInstructions.includes(suggestion)) {
                                        setCustomInstructions((prev) => `${prev.trim()}; ${suggestion}`);
                                      }
                                    }}
                                    className={`group flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border transition-all cursor-pointer disabled:opacity-50 text-left select-none shadow-2xs min-h-[26px] ${
                                      isSelected
                                        ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
                                        : "bg-background text-foreground hover:bg-secondary/40 hover:border-primary/50 border-border/70"
                                    }`}
                                  >
                                    <span className="text-primary shrink-0 font-bold text-[11px] leading-none select-none">+</span>
                                    <span className="leading-tight break-words">{suggestion}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Coding Problems Section (hybrid or coding) */}
                  {(creationMode === "hybrid" || creationMode === "coding") && (
                    <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
                      {/* Section Header */}
                      <div className="flex items-center justify-between gap-4 pb-3 border-b border-border/50">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Code2 className="h-4 w-4 text-primary shrink-0" />
                            Coding Challenges &amp; Problems
                          </h3>
                        </div>
                        {codingQuestions.length > 0 && (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/25 shadow-2xs">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                              {codingQuestions.length} Problem{codingQuestions.length !== 1 ? "s" : ""} Loaded
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setCodingQuestions([]);
                                setCodingFile(null);
                                setCodingParsed(false);
                              }}
                              className="text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-md hover:bg-destructive/10 flex items-center gap-1 cursor-pointer font-medium shrink-0"
                              title="Clear all coding problems"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Clear
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Display loaded coding questions if any */}
                      {codingQuestions.length > 0 && (
                        <div className="space-y-2.5">
                          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            <span>Loaded Problems ({codingQuestions.length})</span>
                            <span className="text-[10px] text-muted-foreground font-normal">Editable in Step 2</span>
                          </div>
                          <div className="space-y-2">
                            {codingQuestions.map((q, idx) => {
                              const tcCount = Array.isArray(q.test_cases) ? q.test_cases.length : 0;
                              return (
                                <div
                                  key={q.id || `coding-item-${idx}`}
                                  className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-border/80 bg-secondary/25 hover:bg-secondary/45 transition-colors shadow-2xs"
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold font-mono border border-primary/20">
                                      #{idx + 1}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-bold text-foreground truncate max-w-xs sm:max-w-md">
                                          {q.title || `Coding Challenge ${idx + 1}`}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                        {q.description || "Structured problem statement with starter code and test cases"}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2.5 shrink-0">
                                    <span className="text-[11px] font-medium text-foreground bg-background px-2.5 py-1 rounded-md border border-border/70 shadow-2xs whitespace-nowrap">
                                      {tcCount} Test Case{tcCount !== 1 ? "s" : ""}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCodingQuestions((prev) => prev.filter((_, i) => i !== idx));
                                        if (codingQuestions.length <= 1) {
                                          setCodingFile(null);
                                          setCodingParsed(false);
                                        }
                                      }}
                                      className="text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-destructive/10 transition-colors cursor-pointer"
                                      title="Remove this problem"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Mode Segmented Controls */}
                      <div className="space-y-3">
                        {codingQuestions.length > 0 && (
                          <div className="flex items-center justify-between pt-1 border-t border-border/40">
                            <span className="text-xs font-medium text-foreground">Add more coding problems:</span>
                          </div>
                        )}

                        <div className="flex items-center p-0.5 rounded-lg bg-secondary/80 border border-border/60 max-w-[280px]">
                          <button
                            type="button"
                            onClick={() => setCodingInputTab("ai")}
                            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              codingInputTab === "ai"
                                ? "bg-background text-foreground shadow-xs border border-border/40"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            <span>AI Generate</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCodingInputTab("upload")}
                            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              codingInputTab === "upload"
                                ? "bg-background text-foreground shadow-xs border border-border/40"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <Upload className="h-3.5 w-3.5" />
                            <span>Upload File</span>
                          </button>
                        </div>

                        {/* TAB 1: AI Generate */}
                        {codingInputTab === "ai" && (
                          <div className="rounded-xl border border-border/70 bg-gradient-to-b from-primary/[0.02] to-transparent p-4 sm:p-5 space-y-4">
                            {/* Coding Challenge Types (AI Recommended) - Only appears when data is uploaded or types exist, matching Hint above */}
                            {(codingChallengeTypes.length > 0 || codingTypesClarification) && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                      Coding Challenge Types
                                    </label>
                                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 flex items-center gap-1">
                                      {isAnalyzingCodingTypes ? (
                                        <>
                                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                          Analyzing Context...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="h-2.5 w-2.5" />
                                          AI Recommended
                                        </>
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {codingChallengeTypes.length < recommendedCodingTypes.length && (
                                      <button
                                        type="button"
                                        onClick={handleResetCodingTypes}
                                        className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
                                        title="Reset to AI recommendations"
                                      >
                                        <RotateCcw className="h-2.5 w-2.5" />
                                        Reset
                                      </button>
                                    )}
                                    <span className="text-[10px] font-semibold text-primary">
                                      {selectedCodingTypes.length} Selected
                                    </span>
                                  </div>
                                </div>

                                {/* Clarification Notice if Document Information is Insufficient */}
                                {codingTypesClarification && (
                                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs">
                                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                    <div className="space-y-1">
                                      <p className="font-semibold text-foreground">Clarification Needed</p>
                                      <p className="text-[11px] leading-relaxed text-muted-foreground">{codingTypesClarification}</p>
                                      <p className="text-[11px] text-muted-foreground/80">
                                        Tip: Upload a technical JD/Resume, enter focus topics below, or click <strong className="text-foreground">+ Add Type</strong> to specify custom challenge types.
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {/* Selectable Chips Grid (2 equal columns filling right side) */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                                  {codingChallengeTypes.map((type) => {
                                    const isSelected = selectedCodingTypes.includes(type);
                                    return (
                                      <div
                                        key={type}
                                        className={`group flex items-center justify-between gap-1.5 text-[11px] rounded-md border transition-all select-none pl-2 pr-1 py-1 min-h-[28px] ${
                                          isSelected
                                            ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
                                            : "bg-background text-foreground border-border/70 hover:border-primary/50 hover:bg-secondary/40"
                                        }`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleCodingType(type)}
                                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left focus:outline-none cursor-pointer"
                                        >
                                          {isSelected ? (
                                            <Check className="h-2.5 w-2.5 shrink-0 stroke-[2.5]" />
                                          ) : (
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 group-hover:bg-primary transition-colors" />
                                          )}
                                          <span className="leading-tight break-words">{type}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeCodingType(type);
                                          }}
                                          className={`p-0.5 shrink-0 rounded transition-colors cursor-pointer ${
                                            isSelected
                                              ? "hover:bg-primary-foreground/20 text-primary-foreground/80 hover:text-primary-foreground"
                                              : "hover:bg-muted text-muted-foreground hover:text-destructive"
                                          }`}
                                          title={`Remove ${type}`}
                                          aria-label={`Remove ${type}`}
                                        >
                                          <X className="h-2.5 w-2.5" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Add Custom Type Inline */}
                                <div className="pt-0.5 flex items-center justify-between">
                                  {isAddingCustomType ? (
                                    <div className="inline-flex items-center gap-1 bg-background border border-primary/50 rounded-md p-0.5 pl-2 shadow-2xs h-7">
                                      <input
                                        type="text"
                                        autoFocus
                                        value={newChallengeTypeInput}
                                        onChange={(e) => setNewChallengeTypeInput(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleAddCustomCodingType();
                                          } else if (e.key === "Escape") {
                                            setIsAddingCustomType(false);
                                            setNewChallengeTypeInput("");
                                          }
                                        }}
                                        placeholder="Custom type..."
                                        className="text-[11px] bg-transparent border-none outline-none w-32 sm:w-44 text-foreground placeholder:text-muted-foreground/60 h-5"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleAddCustomCodingType}
                                        disabled={!newChallengeTypeInput.trim()}
                                        className="px-2 py-0.5 text-[10px] bg-primary text-primary-foreground rounded font-medium disabled:opacity-50 cursor-pointer"
                                      >
                                        Add
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setIsAddingCustomType(false);
                                          setNewChallengeTypeInput("");
                                        }}
                                        className="p-1 text-muted-foreground hover:text-foreground rounded cursor-pointer"
                                      >
                                        <X className="h-2.5 w-2.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setIsAddingCustomType(true)}
                                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-dashed border-border/80 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer h-6.5"
                                    >
                                      <Plus className="h-2.5 w-2.5" />
                                      <span>Add Custom Type</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Number of Challenges */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between h-4">
                                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                  Number of Challenges
                                </label>
                                <span className="text-[10px] font-semibold text-primary">
                                  {aiCodingCount} Problem{aiCodingCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-1 p-1 h-9 rounded-lg bg-background border border-border/70 text-xs items-center max-w-xs">
                                {[1, 2, 3].map((count) => (
                                  <button
                                    key={count}
                                    type="button"
                                    onClick={() => setAiCodingCount(count)}
                                    className={`h-full flex items-center justify-center font-medium rounded transition-all cursor-pointer ${
                                      aiCodingCount === count
                                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                                    }`}
                                    title={`${count} Problem${count !== 1 ? "s" : ""}`}
                                  >
                                    {count}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ── Hint Natural Language Layer (Coding) ── */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="h-6 w-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                                    <Sparkles className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <label
                                      htmlFor="ai-coding-topic-input"
                                      className="text-xs font-semibold text-foreground flex items-center gap-1.5 cursor-pointer"
                                    >
                                      Hint
                                    </label>
                                    <span className="text-[10px] font-normal text-muted-foreground/70 lowercase bg-secondary px-1.5 py-0.5 rounded border border-border/40">optional</span>
                                  </div>
                                </div>
                                {aiCodingCustomTopic && (
                                  <button
                                    type="button"
                                    onClick={() => setAiCodingCustomTopic("")}
                                    className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer font-medium"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              <input
                                id="ai-coding-topic-input"
                                type="text"
                                value={aiCodingCustomTopic}
                                onChange={(e) => setAiCodingCustomTopic(e.target.value)}
                                placeholder="e.g., Specific problem areas, custom algorithms, constraints, or company guidelines..."
                                className="w-full h-9 px-3 text-xs rounded-lg border border-border/70 bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-2xs"
                                disabled={generatingAiCoding}
                              />
                            </div>

                            {/* Action Button */}
                            <div className="pt-1">
                              <Button
                                type="button"
                                onClick={() => handleGenerateAiCoding(false)}
                                disabled={generatingAiCoding || parsingCoding}
                                variant="hero"
                                className="w-full h-10 rounded-lg text-xs font-semibold gap-2 shadow-xs cursor-pointer"
                              >
                                {generatingAiCoding ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
                                    Synthesizing Coding Challenges with AI...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4" />
                                    Generate Coding Challenges with AI
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* TAB 2: Upload File */}
                        {codingInputTab === "upload" && (
                          <div className="relative group">
                            <input
                              type="file"
                              accept=".pdf,.docx,.txt"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                await processCodingFile(f);
                                e.target.value = "";
                              }}
                              className="hidden"
                              id="coding-upload"
                            />

                            {parsingCoding ? (
                              <div className="flex flex-col items-center justify-center py-6 px-4 w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.02] text-center transition-all">
                                <div className="relative mb-2.5 flex items-center justify-center">
                                  <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-foreground">
                                  Extracting Coding Problems with AI...
                                </span>
                                <span className="text-[11px] text-muted-foreground mt-0.5 max-w-sm leading-relaxed">
                                  Analyzing problem statements, starter code, and test cases
                                </span>
                                {codingFile && (
                                  <div className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full bg-background border border-border/70 text-[11px] font-medium text-muted-foreground shadow-2xs">
                                    <Code2 className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span className="truncate max-w-[200px] text-foreground font-medium">{codingFile.name}</span>
                                    <span className="text-muted-foreground/60">•</span>
                                    <span>{(codingFile.size / 1024).toFixed(0)} KB</span>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    extractCodingAbortRef.current?.abort();
                                    setParsingCoding(false);
                                    setCodingFile(null);
                                  }}
                                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors font-medium mt-3 px-2.5 py-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : codingFile && codingQuestions.length === 0 ? (
                              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.04]">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-9 w-9 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                                    <AlertTriangle className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0 text-left">
                                    <div className="text-xs font-bold text-foreground truncate max-w-xs sm:max-w-sm">
                                      {codingFile.name}
                                    </div>
                                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                      No coding problems could be detected in this file. Please ensure it contains problem descriptions.
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setCodingFile(null);
                                    setCodingQuestions([]);
                                    setCodingParsed(false);
                                  }}
                                  className="text-xs font-medium text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-md border border-destructive/20 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Try Another File
                                </button>
                              </div>
                            ) : (
                              <label
                                htmlFor="coding-upload"
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                onDrop={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const droppedFile = e.dataTransfer.files?.[0];
                                  if (droppedFile) {
                                    await processCodingFile(droppedFile);
                                  }
                                }}
                                className="flex flex-col items-center justify-center gap-2 py-5 px-4 rounded-xl border-2 border-dashed border-border/70 hover:border-primary/60 hover:bg-primary/[0.02] transition-all cursor-pointer text-center"
                              >
                                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1">
                                  <Upload className="h-4 w-4" />
                                </div>
                                <div className="text-xs font-semibold text-foreground">
                                  Upload Coding Problems File
                                </div>
                                <p className="text-[11px] text-muted-foreground max-w-sm">
                                  Upload PDF, DOCX, or TXT with coding descriptions and test cases (Max 5MB)
                                </p>
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                </div>

                {/* ── RIGHT COLUMN: Session Settings (5 cols, sticky) ── */}
                <div className="lg:col-span-5 space-y-3 lg:sticky lg:top-24">
                  <div className="pb-1.5 border-b border-border/40">
                    <h2 className="text-sm font-semibold text-foreground">
                      Session Settings
                    </h2>
                  </div>
                  
                  {/* Duration Card */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        Duration
                      </h3>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-secondary text-foreground border border-border/50 shrink-0">
                        {durationMinutes} min
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5 pt-0.5">
                      {[15, 30, 45, 60, 90].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => setDurationMinutes(mins)}
                          className={`py-1.5 text-xs font-medium rounded-md border transition-all ${
                            durationMinutes === mins
                              ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                              : "border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/30"
                          }`}
                        >
                          {mins}m
                        </button>
                      ))}
                    </div>

                    <div className="pt-1">
                      <input
                        type="range"
                        id="interview-duration"
                        min="5"
                        max="180"
                        step="5"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                        <span>5 min</span>
                        <span>60 min</span>
                        <span>180 min</span>
                      </div>
                    </div>
                  </div>

                  {/* Availability Window */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        Availability Window
                        <span className="text-[11px] font-normal text-muted-foreground ml-1">(Optional)</span>
                      </h3>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-secondary text-foreground border border-border/50 shrink-0">
                        IST (UTC+5:30)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                          Available From
                        </label>
                        <input
                          type="datetime-local"
                          value={availableFrom}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAvailableFrom(val);
                            setScheduleErrors(validateAvailabilityWindow(val, availableUntil));
                          }}
                          min={getMinISTDateTime()}
                          className={`w-full bg-background border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 transition-all ${
                            scheduleErrors.startPast
                              ? "border-red-500 focus:ring-red-200"
                              : "border-border/70 focus:ring-primary/30"
                          }`}
                        />
                        {scheduleErrors.startPast && (
                          <p className="text-[10px] text-red-500 mt-1 font-medium">Start time cannot be in the past.</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                          Available Until
                        </label>
                        <input
                          type="datetime-local"
                          value={availableUntil}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAvailableUntil(val);
                            setScheduleErrors(validateAvailabilityWindow(availableFrom, val));
                          }}
                          min={availableFrom || getMinISTDateTime()}
                          className={`w-full bg-background border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 transition-all ${
                            scheduleErrors.untilPast || scheduleErrors.endBeforeStart
                              ? "border-red-500 focus:ring-red-200"
                              : "border-border/70 focus:ring-primary/30"
                          }`}
                        />
                        {scheduleErrors.untilPast && (
                          <p className="text-[10px] text-red-500 mt-1 font-medium">End time cannot be in the past.</p>
                        )}
                        {scheduleErrors.endBeforeStart && !scheduleErrors.untilPast && (
                          <p className="text-[10px] text-red-500 mt-1 font-medium">End time must be after start time.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Proctoring & Guardrails Card */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Proctoring &amp; Guardrails
                      </h3>
                      
                      {/* Master Switch */}
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={proctoringEnabled}
                            onChange={(e) => setProctoringEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-muted rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/30 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                        <span className={`text-xs font-semibold ${proctoringEnabled ? "text-primary" : "text-muted-foreground"}`}>
                          {proctoringEnabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 pt-0.5">
                      {/* Violation Strike Limit */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <label className="text-xs font-medium text-foreground block">
                            Violation Strike Limit
                          </label>
                          <span className="text-[11px] text-muted-foreground">
                            Candidate warnings before auto-flagging
                          </span>
                        </div>
                        <select
                          value={proctoringMaxStrikes}
                          onChange={(e) => setProctoringMaxStrikes(parseInt(e.target.value))}
                          disabled={!proctoringEnabled}
                          className="h-8 px-2.5 rounded-lg border border-border/70 bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        >
                          <option value="1">1 Strike (Strict)</option>
                          <option value="2">2 Strikes</option>
                          <option value="3">3 Strikes (Standard)</option>
                          <option value="4">4 Strikes</option>
                          <option value="5">5 Strikes (Lenient)</option>
                        </select>
                      </div>

                      {/* Security Guardrails Toggles */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/40">
                        {/* Require Camera */}
                        <label className={`flex items-center gap-2.5 select-none p-2 rounded-lg border transition-colors ${
                          !proctoringEnabled ? "opacity-50 cursor-not-allowed border-border/40" : "cursor-pointer border-border/50 hover:bg-secondary/20"
                        }`}>
                          <div className="relative flex items-center justify-center h-4 w-4 shrink-0">
                            <input
                              type="checkbox"
                              checked={requireCamera}
                              disabled={!proctoringEnabled}
                              onChange={(e) => setRequireCamera(e.target.checked)}
                              className="peer h-full w-full appearance-none rounded border-2 border-slate-300 dark:border-slate-600 bg-background checked:bg-primary checked:border-primary transition-all cursor-pointer focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed"
                            />
                            <Check className="absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                          </div>
                          <div>
                            <span className="text-xs font-medium text-foreground block">
                              Require Camera
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              Mandatory webcam feed
                            </span>
                          </div>
                        </label>

                        {/* Detect Tab Switch */}
                        <label className={`flex items-center gap-2.5 select-none p-2 rounded-lg border transition-colors ${
                          !proctoringEnabled ? "opacity-50 cursor-not-allowed border-border/40" : "cursor-pointer border-border/50 hover:bg-secondary/20"
                        }`}>
                          <div className="relative flex items-center justify-center h-4 w-4 shrink-0">
                            <input
                              type="checkbox"
                              checked={detectTabSwitch}
                              disabled={!proctoringEnabled}
                              onChange={(e) => setDetectTabSwitch(e.target.checked)}
                              className="peer h-full w-full appearance-none rounded border-2 border-slate-300 dark:border-slate-600 bg-background checked:bg-primary checked:border-primary transition-all cursor-pointer focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed"
                            />
                            <Check className="absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                          </div>
                          <div>
                            <span className="text-xs font-medium text-foreground block">
                              Tab-Switch Alert
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              Track window blur &amp; focus
                            </span>
                          </div>
                        </label>

                        {/* Block Copy-Paste */}
                        <label className={`flex items-center gap-2.5 select-none p-2 rounded-lg border transition-colors ${
                          !proctoringEnabled ? "opacity-50 cursor-not-allowed border-border/40" : "cursor-pointer border-border/50 hover:bg-secondary/20"
                        }`}>
                          <div className="relative flex items-center justify-center h-4 w-4 shrink-0">
                            <input
                              type="checkbox"
                              checked={blockCopyPaste}
                              disabled={!proctoringEnabled}
                              onChange={(e) => setBlockCopyPaste(e.target.checked)}
                              className="peer h-full w-full appearance-none rounded border-2 border-slate-300 dark:border-slate-600 bg-background checked:bg-primary checked:border-primary transition-all cursor-pointer focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed"
                            />
                            <Check className="absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                          </div>
                          <div>
                            <span className="text-xs font-medium text-foreground block">
                              Block Copy / Paste
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              Prevent clipboard cheating
                            </span>
                          </div>
                        </label>

                        {/* Record Video */}
                        <label className={`flex items-center gap-2.5 select-none p-2 rounded-lg border transition-colors ${
                          !proctoringEnabled ? "opacity-50 cursor-not-allowed border-border/40" : "cursor-pointer border-border/50 hover:bg-secondary/20"
                        }`}>
                          <div className="relative flex items-center justify-center h-4 w-4 shrink-0">
                            <input
                              type="checkbox"
                              id="save-video"
                              checked={saveVideoRecording}
                              disabled={!proctoringEnabled}
                              onChange={(e) => setSaveVideoRecording(e.target.checked)}
                              className="peer h-full w-full appearance-none rounded border-2 border-slate-300 dark:border-slate-600 bg-background checked:bg-primary checked:border-primary transition-all cursor-pointer focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed"
                            />
                            <Check className="absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                          </div>
                          <div>
                            <span className="text-xs font-medium text-foreground block">
                              Record Video
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              Archive for recruiter audit
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Scoring Threshold Card */}
                  <div className="bg-card border border-border/70 rounded-xl p-4 sm:p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-border/50">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        Scoring Threshold
                      </h3>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-secondary text-foreground border border-border/50 shrink-0">
                        {evaluationScoreCutoff}% Cutoff
                      </span>
                    </div>

                    <div className="space-y-3 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <label htmlFor="evaluation-cutoff" className="text-xs font-medium text-foreground block">
                            Passing Score Cutoff
                          </label>
                          <span className="text-[11px] text-muted-foreground">
                            Minimum score required to qualify
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            id="evaluation-cutoff"
                            min="0"
                            max="100"
                            value={evaluationScoreCutoff}
                            onChange={(e) => {
                              const val = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                              setEvaluationScoreCutoff(val);
                            }}
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-14 h-7 px-2 rounded-md border border-border/70 bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono text-center font-bold"
                          />
                          <span className="text-xs text-muted-foreground font-mono">%</span>
                          <div className="flex gap-1 ml-1">
                            {[50, 60, 70, 80].map((score) => (
                              <button
                                key={score}
                                type="button"
                                onClick={() => setEvaluationScoreCutoff(score)}
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-all ${
                                  evaluationScoreCutoff === score
                                    ? "bg-primary/15 border-primary text-primary"
                                    : "bg-secondary/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary"
                                }`}
                              >
                                {score}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Primary Action CTA */}
                  <div className="pt-1">
                    <Button
                      variant="hero"
                      className="w-full h-12 text-sm font-bold tracking-tight rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-[0.99]"
                      onClick={handleGenerateQuestions}
                      disabled={
                        generating ||
                        loadingJd ||
                        parsing ||
                        parsingCoding ||
                        generatingAiCoding ||
                        (creationMode === "coding" && (codingQuestions.length === 0 || parsingCoding || generatingAiCoding)) ||
                        ((creationMode === "hybrid" || creationMode === "jd") && (!jdText?.trim() || !!jdValidationError)) ||
                        scheduleErrors.startPast ||
                        scheduleErrors.untilPast ||
                        scheduleErrors.endBeforeStart
                      }
                    >
                      {generating || parsingCoding ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <Brain className="h-5 w-5 mr-2.5" />
                      )}
                      {generating
                        ? "Generating Interview Questions..."
                        : parsingCoding
                          ? "Extracting Coding Problems..."
                          : creationMode === "coding"
                            ? `Review ${codingQuestions.length} Coding Problems →`
                            : "Generate Interview Questions →"}
                    </Button>
                  </div>

                  {((creationMode === "hybrid" || creationMode === "jd") && !!jdValidationError) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 text-center font-medium flex items-center justify-center gap-1.5" aria-live="polite">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Content needs review before proceeding
                    </p>
                  )}
                  </div>

                </div>
              </motion.div>
            )}

          {/* Step 2: Select & Customize Questions */}
          {step === "questions" && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Studio Question Top Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    Select &amp; Customize Questions
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {generating
                      ? "AI is generating questions tailored to your job description or resume..."
                      : creationMode === "coding"
                      ? "Review and customize coding challenges tailored to this role before setting up evaluation criteria."
                      : "Review and customize AI-generated questions tailored to this role before setting up scoring criteria."}
                  </p>
                </div>
                {!generating && questions.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                    <Button variant="outline" size="sm" onClick={() => setStep("upload")} className="rounded-lg h-9">
                      ← Back
                    </Button>
                  </div>
                )}
              </div>

              {/* Active Custom Instructions Indicator */}
              {customInstructions?.trim() && !generating && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-primary/[0.05] border border-primary/20 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-foreground">Custom Instructions Applied:</span>
                      <span className="text-muted-foreground italic truncate max-w-xl">
                        "{customInstructions.trim()}"
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep("upload")}
                    className="text-xs text-primary hover:text-primary/80 hover:bg-primary/10 h-7 px-2 shrink-0 font-medium"
                  >
                    Adjust Instructions
                  </Button>
                </div>
              )}

              {generating ? (
                <QuestionSkeletonLoader creationMode={creationMode} jobRole={jobRole || undefined} />
              ) : (
                <div className="space-y-6">
                {(["technical", "behavioral", "coding"] as const).map((type) => {
                  const qs = groupedQuestions[type];
                  if (creationMode === "coding" && type !== "coding" && !qs.length) return null;
                  if (creationMode === "jd" && type === "coding") return null;
                  const Icon = typeIcons[type];
                  const allSelected = qs.length > 0 && qs.every((q: any) => q.selected);
                  const typeSubtitle =
                    type === "coding"
                      ? "Hands-on coding & unit tests"
                      : null;
                  return (
                    <div key={type} className="card-elevated rounded-md border border-border/50 overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-md flex items-center justify-center ${typeColors[type]}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold capitalize">
                                {type === "coding" ? "Coding Problems" : `${type} Questions`}
                              </h3>
                              {typeSubtitle && (
                                <span className="hidden sm:inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border/50">
                                  {typeSubtitle}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">{qs.filter((q: any) => q.selected).length}/{qs.length} selected</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1"
                            onClick={() => {
                              setAddingType(type);
                              setCustomQError(null);
                              setCodingError(null);
                              setDuplicateConflictId(null);
                              if (type === "coding") {
                                setNewCodingTitle("");
                                setNewCodingDescription("");
                                setNewCodingDifficulty("medium");
                                setNewCodingTestCases([]);
                              } else {
                                setNewQText("");
                                setNewQDifficulty("medium");
                              }
                            }}
                          >
                            <Plus className="h-3 w-3" /> Add
                          </Button>
                          {qs.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => allSelected ? deselectAll(type) : selectAll(type)}
                            >
                              {allSelected ? "Deselect All" : "Select All"}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="divide-y divide-border/30">
                        {qs.map((q: any) => (
                          <div key={q.id}>
                            {/* Coding problems card */}
                            {type === "coding" ? (
                              <div>
                                {editingId === q.id ? (
                                  /* ── CODING INLINE EDIT MODE ── */
                                  <div className="px-5 py-4 bg-primary/5 border-l-2 border-primary space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                        <Pencil className="h-3 w-3" /> Editing Coding Problem
                                      </div>
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                        <Code2 className="h-2.5 w-2.5" /> Coding Problem
                                      </span>
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-medium text-muted-foreground">Problem Title</label>
                                        {editError?.field === "title" && (
                                          <span className="text-[11px] text-destructive font-medium flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                          </span>
                                        )}
                                      </div>
                                      <input
                                        type="text"
                                        value={editCodingTitle}
                                        onChange={(e) => {
                                          setEditCodingTitle(e.target.value);
                                          if (editError?.field === "title") setEditError(null);
                                          if (duplicateConflictId) setDuplicateConflictId(null);
                                        }}
                                        placeholder="e.g., Two Sum, Reverse Linked List"
                                        className={`w-full h-9 rounded-md bg-background border px-3 text-sm text-foreground focus:outline-none focus:ring-2 transition-all ${
                                          editError?.field === "title"
                                            ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40 shadow-sm shadow-destructive/10"
                                            : "border-border/50 focus:ring-primary/40"
                                        }`}
                                      />
                                      {editError?.field === "title" && (
                                        <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                          <div>
                                            <p className="font-semibold">{editError.message}</p>
                                            {editError.matchedTitle && (
                                              <p className="text-[11px] opacity-90 mt-0.5">
                                                Conflicts with existing question: <span className="font-semibold underline decoration-destructive/40">"{editError.matchedTitle}"</span> (highlighted in the list above). Please change this title to make it distinct.
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-medium text-muted-foreground">Problem Description & Details</label>
                                        {editError?.field === "description" && (
                                          <span className="text-[11px] text-destructive font-medium flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                          </span>
                                        )}
                                      </div>
                                      <textarea
                                        value={editCodingDescription}
                                        onChange={(e) => {
                                          setEditCodingDescription(e.target.value);
                                          if (editError?.field === "description") setEditError(null);
                                          if (duplicateConflictId) setDuplicateConflictId(null);
                                        }}
                                        placeholder="Describe the problem, input format, output format, and constraints..."
                                        className={`w-full h-24 rounded-md bg-background border p-3 text-sm text-foreground focus:outline-none focus:ring-2 resize-y transition-all ${
                                          editError?.field === "description"
                                            ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40 shadow-sm shadow-destructive/10"
                                            : "border-border/50 focus:ring-primary/40"
                                        }`}
                                      />
                                      {editError?.field === "description" && (
                                        <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                          <div>
                                            <p className="font-semibold">{editError.message}</p>
                                            {editError.matchedTitle && (
                                              <p className="text-[11px] opacity-90 mt-0.5">
                                                Description is identical to <span className="font-semibold underline decoration-destructive/40">"{editError.matchedTitle}"</span>. Please update the description.
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Test Cases Editor */}
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-muted-foreground">Test Cases (Optional)</label>
                                        <button
                                          type="button"
                                          onClick={() => setEditCodingTestCases((prev) => [...prev, { input: "", expected_output: "" }])}
                                          className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1"
                                        >
                                          <Plus className="h-3 w-3" /> Add Test Case
                                        </button>
                                      </div>
                                      {editCodingTestCases.map((tc, tcIdx) => (
                                        <div key={tcIdx} className="flex items-center gap-2 bg-secondary/30 p-2 rounded-md border border-border/40">
                                          <input
                                            type="text"
                                            value={tc.input}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setEditCodingTestCases((prev) =>
                                                prev.map((item, i) => i === tcIdx ? { ...item, input: val } : item)
                                              );
                                            }}
                                            placeholder="Input (e.g., [2, 7, 11, 15], 9)"
                                            className="flex-1 h-7 text-xs bg-background border border-border/50 rounded px-2 font-mono"
                                          />
                                          <input
                                            type="text"
                                            value={tc.expected_output}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setEditCodingTestCases((prev) =>
                                                prev.map((item, i) => i === tcIdx ? { ...item, expected_output: val } : item)
                                              );
                                            }}
                                            placeholder="Expected Output (e.g., [0, 1])"
                                            className="flex-1 h-7 text-xs bg-background border border-border/50 rounded px-2 font-mono"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => setEditCodingTestCases((prev) => prev.filter((_, i) => i !== tcIdx))}
                                            className="h-6 w-6 text-muted-foreground hover:text-destructive flex items-center justify-center"
                                            title="Remove test case"
                                          >
                                            <X className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="flex items-center gap-3 pt-1">
                                      <select
                                        value={editDifficulty}
                                        onChange={(e) => setEditDifficulty(e.target.value)}
                                        className="h-8 rounded-md bg-secondary border border-border/50 px-2 text-xs font-medium"
                                      >
                                        <option value="easy">Easy</option>
                                        <option value="medium">Medium</option>
                                        <option value="hard">Hard</option>
                                      </select>
                                      <div className="flex-1" />
                                      {(q.original_title || q.original_description) && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-xs gap-1"
                                          onClick={() => { revertCodingQuestion(q); setEditingId(null); }}
                                        >
                                          <RotateCcw className="h-3 w-3" /> Revert
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="sm" className="text-xs" onClick={cancelEditing}>
                                        Cancel
                                      </Button>
                                      <Button
                                        variant="hero"
                                        size="sm"
                                        className="text-xs"
                                        onClick={() => saveCodingEdit(q.id)}
                                        disabled={savingEdit || !editCodingTitle.trim() || !editCodingDescription.trim()}
                                      >
                                        {savingEdit ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  /* ── CODING DISPLAY MODE ── */
                                  <div
                                    id={`question-card-${q.id}`}
                                    className={`flex items-start gap-3 px-5 py-4 transition-all cursor-pointer hover:bg-primary/5 group relative ${
                                      q.selected ? "bg-primary/5 border-l-2 border-primary" : ""
                                    } ${
                                      duplicateConflictId === q.id
                                        ? "border-2 border-destructive bg-destructive/10 ring-2 ring-destructive/30 rounded-md my-1 shadow-sm"
                                        : ""
                                    }`}
                                    onClick={() => toggleQuestion(q.id)}
                                  >
                                    <div className="mt-1">
                                      <div className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                                        duplicateConflictId === q.id
                                          ? "border-destructive bg-destructive text-destructive-foreground"
                                          : q.selected
                                          ? "bg-primary border-primary"
                                          : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500"
                                      }`}>
                                        {q.selected && <Check className="h-3.5 w-3.5 text-white" />}
                                      </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      {duplicateConflictId === q.id && (
                                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-[11px] font-semibold mb-1.5 shadow-sm animate-pulse">
                                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                          <span>This question is already added and conflicts with your current edit</span>
                                        </div>
                                      )}
                                      <p className={`text-sm font-semibold leading-snug ${duplicateConflictId === q.id ? "text-destructive font-bold" : "text-foreground"}`}>
                                        {q.title || q.question_text || "Untitled Problem"}
                                      </p>
                                      {q.description && (
                                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                                          {q.description}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                          <Code2 className="h-2.5 w-2.5" /> Coding Problem
                                        </span>
                                        {(q.source === "edited" || q.source === "custom") && (
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                            q.source === "edited"
                                              ? "bg-amber-500/10 text-amber-500"
                                              : "bg-blue-500/10 text-blue-500"
                                          }`}>
                                            {q.source === "edited" ? <><Pencil className="h-2.5 w-2.5" /> Modified</> : <><UserPen className="h-2.5 w-2.5" /> Custom</>}
                                          </span>
                                        )}
                                        {q.source === "uploaded" && (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 px-1.5 py-0.5 rounded-full bg-secondary/50">
                                            <Upload className="h-2.5 w-2.5" /> Uploaded
                                          </span>
                                        )}
                                        {Array.isArray(q.test_cases) && q.test_cases.length > 0 && (
                                          <span className="text-[10px] text-muted-foreground/60">
                                            {q.test_cases.length} test case{q.test_cases.length !== 1 ? "s" : ""}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Action Buttons (visible on hover) */}
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); startEditing(q); }}
                                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                        title="Edit question"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteQuestion(q.id); }}
                                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                        title="Delete question"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              /* ── TECHNICAL / BEHAVIORAL ── */
                              <div>
                                {editingId === q.id ? (
                                  /* ── INLINE EDIT MODE ── */
                                  <div className="px-5 py-4 bg-primary/5 border-l-2 border-primary space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                        <Pencil className="h-3 w-3" /> Editing Question
                                      </div>
                                      {editError?.field === "text" && (
                                        <span className="text-[11px] text-destructive font-medium flex items-center gap-1 animate-in fade-in">
                                          <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                        </span>
                                      )}
                                    </div>
                                    <textarea
                                      value={editText}
                                      onChange={(e) => {
                                        setEditText(e.target.value);
                                        if (editError?.field === "text") setEditError(null);
                                        if (duplicateConflictId) setDuplicateConflictId(null);
                                      }}
                                      className={`w-full h-20 rounded-md bg-background border p-3 text-sm text-foreground focus:outline-none focus:ring-2 resize-none transition-all ${
                                        editError?.field === "text"
                                          ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40 shadow-sm shadow-destructive/10"
                                          : "border-border/50 focus:ring-primary/40"
                                      }`}
                                    />
                                    {editError?.field === "text" && (
                                      <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium animate-in fade-in slide-in-from-top-1">
                                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                        <div>
                                          <p className="font-semibold">{editError.message}</p>
                                          {editError.matchedTitle && (
                                            <p className="text-[11px] opacity-90 mt-0.5">
                                              Conflicts with existing question: <span className="font-semibold underline decoration-destructive/40">"{editError.matchedTitle}"</span> (highlighted in the list above). Please change this to make it distinct.
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-3">
                                      <select
                                        value={editType}
                                        onChange={(e) => setEditType(e.target.value)}
                                        className="h-8 rounded-md bg-secondary border border-border/50 px-2 text-xs font-medium"
                                      >
                                        <option value="technical">Technical</option>
                                        <option value="behavioral">Behavioral</option>
                                      </select>
                                      <div className="flex-1" />
                                      {q.original_text && (
                                        <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { revertQuestion(q); setEditingId(null); setEditError(null); setDuplicateConflictId(null); }}>
                                          <RotateCcw className="h-3 w-3" /> Revert
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => { cancelEditing(); setEditError(null); setDuplicateConflictId(null); }}>
                                        Cancel
                                      </Button>
                                      <Button variant="hero" size="sm" className="text-xs" onClick={() => saveEdit(q.id)} disabled={savingEdit}>
                                        {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  /* ── DISPLAY MODE ── */
                                  <div
                                    id={`question-card-${q.id}`}
                                    className={`flex items-start gap-3 px-5 py-4 transition-all hover:bg-primary/5 group relative ${
                                      q.selected ? "bg-primary/5 border-l-2 border-primary" : ""
                                    } ${
                                      duplicateConflictId === q.id
                                        ? "border-2 border-destructive bg-destructive/10 ring-2 ring-destructive/30 rounded-md my-1 shadow-sm"
                                        : ""
                                    }`}
                                  >
                                    <div
                                      className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                                        duplicateConflictId === q.id
                                          ? "border-destructive bg-destructive text-destructive-foreground"
                                          : q.selected
                                          ? "bg-primary border-primary"
                                          : "border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500"
                                      }`}
                                      onClick={() => toggleQuestion(q.id)}
                                    >
                                      {q.selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                                    </div>
                                    <div className="flex-1 min-w-0" onClick={() => toggleQuestion(q.id)}>
                                      {duplicateConflictId === q.id && (
                                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-[11px] font-semibold mb-1.5 shadow-sm animate-pulse">
                                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                          <span>This question is already added and conflicts with your current question</span>
                                        </div>
                                      )}
                                      <p className={`text-sm leading-relaxed cursor-pointer ${duplicateConflictId === q.id ? "text-destructive font-bold" : "text-foreground"}`}>{q.question_text}</p>
                                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        {/* Source Badge */}
                                        {(q.source === "edited" || q.source === "custom") && (
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                            q.source === "edited"
                                              ? "bg-amber-500/10 text-amber-500"
                                              : "bg-blue-500/10 text-blue-500"
                                          }`}>
                                            {q.source === "edited" ? <><Pencil className="h-2.5 w-2.5" /> Modified</> : <><UserPen className="h-2.5 w-2.5" /> Custom</>}
                                          </span>
                                        )}
                                        {q.source === "generated" && (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60 px-1.5 py-0.5 rounded-full bg-secondary/50">
                                            <Bot className="h-2.5 w-2.5" /> AI
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {/* Action Buttons (visible on hover) */}
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); startEditing(q); }}
                                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                        title="Edit question"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteQuestion(q.id); }}
                                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                        title="Delete question"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}

                        {/* ── ADD CUSTOM QUESTION FORM ── */}
                        {addingType === type && (
                          type === "coding" ? (
                            <div className="px-5 py-4 bg-primary/5 border-l-2 border-primary space-y-3">
                              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                <Plus className="h-3 w-3" /> Add Custom Coding Problem
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-xs font-medium text-muted-foreground">Problem Title</label>
                                  {codingError?.field === "title" && (
                                    <span className="text-[11px] text-destructive font-medium flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                    </span>
                                  )}
                                </div>
                                <input
                                  type="text"
                                  value={newCodingTitle}
                                  onChange={(e) => {
                                    setNewCodingTitle(e.target.value);
                                    if (codingError?.field === "title") setCodingError(null);
                                    if (duplicateConflictId) setDuplicateConflictId(null);
                                  }}
                                  placeholder="e.g., Valid Parentheses, Binary Search"
                                  className={`w-full h-9 rounded-md bg-background border px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-all ${
                                    codingError?.field === "title"
                                      ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40"
                                      : "border-border/50 focus:ring-primary/40"
                                  }`}
                                  autoFocus
                                />
                                {codingError?.field === "title" && (
                                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                    <div>
                                      <p className="font-semibold">{codingError.message}</p>
                                      {codingError.matchedTitle && (
                                        <p className="text-[11px] opacity-90 mt-0.5">
                                          Conflicts with existing problem: <span className="font-semibold underline decoration-destructive/40">"{codingError.matchedTitle}"</span> (highlighted in the list above). Please change this title.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-xs font-medium text-muted-foreground">Problem Description & Details</label>
                                  {codingError?.field === "description" && (
                                    <span className="text-[11px] text-destructive font-medium flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                    </span>
                                  )}
                                </div>
                                <textarea
                                  value={newCodingDescription}
                                  onChange={(e) => {
                                    setNewCodingDescription(e.target.value);
                                    if (codingError?.field === "description") setCodingError(null);
                                    if (duplicateConflictId) setDuplicateConflictId(null);
                                  }}
                                  placeholder="Describe the task, inputs, expected outputs, and constraints..."
                                  className={`w-full h-24 rounded-md bg-background border p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 resize-y transition-all ${
                                    codingError?.field === "description"
                                      ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40"
                                      : "border-border/50 focus:ring-primary/40"
                                  }`}
                                />
                                {codingError?.field === "description" && (
                                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                    <div>
                                      <p className="font-semibold">{codingError.message}</p>
                                      {codingError.matchedTitle && (
                                        <p className="text-[11px] opacity-90 mt-0.5">
                                          Description is identical to <span className="font-semibold underline decoration-destructive/40">"{codingError.matchedTitle}"</span>. Please update the description.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              {/* Test Cases */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-medium text-muted-foreground">Test Cases (Optional)</label>
                                  <button
                                    type="button"
                                    onClick={() => setNewCodingTestCases((prev) => [...prev, { input: "", expected_output: "" }])}
                                    className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1"
                                  >
                                    <Plus className="h-3 w-3" /> Add Test Case
                                  </button>
                                </div>
                                {newCodingTestCases.map((tc, tcIdx) => (
                                  <div key={tcIdx} className="flex items-center gap-2 bg-secondary/30 p-2 rounded-md border border-border/40">
                                    <input
                                      type="text"
                                      value={tc.input}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setNewCodingTestCases((prev) =>
                                          prev.map((item, i) => i === tcIdx ? { ...item, input: val } : item)
                                        );
                                      }}
                                      placeholder="Input (e.g., [2, 7, 11, 15], 9)"
                                      className="flex-1 h-7 text-xs bg-background border border-border/50 rounded px-2 font-mono"
                                    />
                                    <input
                                      type="text"
                                      value={tc.expected_output}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setNewCodingTestCases((prev) =>
                                          prev.map((item, i) => i === tcIdx ? { ...item, expected_output: val } : item)
                                        );
                                      }}
                                      placeholder="Expected Output (e.g., [0, 1])"
                                      className="flex-1 h-7 text-xs bg-background border border-border/50 rounded px-2 font-mono"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setNewCodingTestCases((prev) => prev.filter((_, i) => i !== tcIdx))}
                                      className="h-6 w-6 text-muted-foreground hover:text-destructive flex items-center justify-center"
                                      title="Remove test case"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-3 pt-1">
                                <select
                                  value={newCodingDifficulty}
                                  onChange={(e) => setNewCodingDifficulty(e.target.value)}
                                  className="h-8 rounded-md bg-secondary border border-border/50 px-2 text-xs font-medium"
                                >
                                  <option value="easy">Easy</option>
                                  <option value="medium">Medium</option>
                                  <option value="hard">Hard</option>
                                </select>
                                <div className="flex-1" />
                                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setAddingType(null); setCodingError(null); setDuplicateConflictId(null); }}>
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                                  onClick={handleAddCodingQuestion}
                                  disabled={savingNew || !newCodingTitle.trim() || !newCodingDescription.trim()}
                                >
                                  {savingNew ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                                  Add Coding Problem
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="px-5 py-4 bg-blue-500/5 border-l-2 border-blue-500 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-xs font-semibold text-blue-500">
                                  <Plus className="h-3 w-3" /> Add Custom {type.charAt(0).toUpperCase() + type.slice(1)} Question
                                </div>
                                {customQError && (
                                  <span className="text-[11px] text-destructive font-medium flex items-center gap-1 animate-in fade-in">
                                    <AlertTriangle className="h-3 w-3" /> Duplicate detected
                                  </span>
                                )}
                              </div>
                              <textarea
                                value={newQText}
                                onChange={(e) => {
                                  setNewQText(e.target.value);
                                  if (customQError) setCustomQError(null);
                                  if (duplicateConflictId) setDuplicateConflictId(null);
                                }}
                                placeholder="Type your question here..."
                                className={`w-full h-20 rounded-md bg-background border p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 resize-none transition-all ${
                                  customQError
                                    ? "border-destructive bg-destructive/5 text-destructive focus:ring-destructive/40 shadow-sm shadow-destructive/10"
                                    : "border-border/50 focus:ring-blue-500/40"
                                }`}
                                autoFocus
                              />
                              {customQError && (
                                <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium mt-1.5 animate-in fade-in slide-in-from-top-1">
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                                  <div>
                                    <p className="font-semibold">{customQError.message}</p>
                                    {customQError.matchedTitle && (
                                      <p className="text-[11px] opacity-90 mt-0.5">
                                        Conflicts with existing question: <span className="font-semibold underline decoration-destructive/40">"{customQError.matchedTitle}"</span> (highlighted in the list above). Please change this to make it distinct.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center gap-3">
                                <div className="flex-1" />
                                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setAddingType(null); setCustomQError(null); setDuplicateConflictId(null); }}>
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="text-xs bg-blue-500 hover:bg-blue-600 text-white"
                                  onClick={() => handleAddCustomQuestion(type)}
                                  disabled={savingNew || !newQText.trim()}
                                >
                                  {savingNew ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                                  Add Question
                                </Button>
                              </div>
                            </div>
                          )
                        )}

                        {/* Bottom "+ Add Question" button (shown only if there are existing questions) */}
                        {qs.length > 0 && addingType !== type && (
                          <div className="p-3 border-t border-border/10 flex justify-center bg-secondary/[0.02] hover:bg-secondary/[0.05] transition-colors">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-primary hover:text-primary/80 gap-1.5 font-bold"
                              onClick={() => {
                                setAddingType(type);
                                setCustomQError(null);
                                setCodingError(null);
                                setDuplicateConflictId(null);
                                if (type === "coding") {
                                  setNewCodingTitle("");
                                  setNewCodingDescription("");
                                  setNewCodingDifficulty("medium");
                                  setNewCodingTestCases([]);
                                } else {
                                  setNewQText("");
                                  setNewQDifficulty("medium");
                                }
                              }}
                            >
                              <Plus className="h-4 w-4" /> Add Custom {type === "coding" ? "Coding Problem" : "Question"}
                            </Button>
                          </div>
                        )}

                        {/* Empty state */}
                        {qs.length === 0 && addingType !== type && (
                          <div className="px-5 py-8 text-center text-muted-foreground">
                            <p className="text-sm">No {type === "coding" ? "coding problems" : `${type} questions`} yet.</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 text-xs text-primary gap-1"
                              onClick={() => {
                                setAddingType(type);
                                if (type === "coding") {
                                  setNewCodingTitle("");
                                  setNewCodingDescription("");
                                  setNewCodingDifficulty("medium");
                                  setNewCodingTestCases([]);
                                } else {
                                  setNewQText("");
                                  setNewQDifficulty("medium");
                                }
                              }}
                            >
                              <Plus className="h-3 w-3" /> Add one
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}

              {/* Studio Question Footer Action Box */}
              {!generating && questions.length > 0 && (
                <div className="bg-card border border-border/70 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-foreground">
                        Question Selection Summary
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                        {selectedCount} of {questions.length} Selected
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {creationMode === "coding"
                        ? "Only selected coding problems will appear in the candidate coding environment."
                        : "Only selected questions will appear in the candidate interview rounds."}
                    </p>
                    
                    {/* Category counts pills */}
                    <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
                      {groupedQuestions.technical.length > 0 && (
                        <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 font-medium">
                          {groupedQuestions.technical.filter((q: any) => q.selected).length}/{groupedQuestions.technical.length} Technical
                        </span>
                      )}
                      {groupedQuestions.coding.length > 0 && (
                        <span className="px-2.5 py-1 rounded-md bg-accent/20 text-accent-foreground border border-accent/40 font-medium">
                          {groupedQuestions.coding.filter((q: any) => q.selected).length}/{groupedQuestions.coding.length} Coding
                        </span>
                      )}
                      {groupedQuestions.behavioral.length > 0 && (
                        <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                          {groupedQuestions.behavioral.filter((q: any) => q.selected).length}/{groupedQuestions.behavioral.length} Behavioral
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 self-start md:self-auto">
                    <Button
                      variant="hero"
                      onClick={handleProceedToEvaluation}
                      disabled={generating || generatingLink || selectedCount === 0}
                      className="rounded-lg shadow-md shadow-primary/20"
                    >
                      {generatingLink ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : generating ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ArrowRight className="h-4 w-4 mr-2" />
                      )}
                      Next: Evaluation Criteria ({selectedCount})
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 3: Enterprise Parameter-Based Evaluation Criteria */}
          {step === "evaluation" && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="w-full space-y-6">
              {/* Step 3 Top Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground">
                    Customize Scoring Rubric &amp; Weights
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
                    Select the parameters on which candidate responses will be evaluated. Weights are mathematically calibrated to 100%.
                  </p>
                </div>

                {/* Top Navigation */}
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStep("questions")}
                    disabled={savingRubric}
                    className="rounded-lg h-9 text-xs"
                  >
                    ← Back to Questions
                  </Button>
                </div>
              </div>

              {/* Weight Distribution Dashboard */}
              {(() => {
                const active = rubricParameters.filter(p => p.enabled);
                const totalWeight = active.reduce((sum, p) => sum + (p.weight || 0), 0);
                const isBalanced = totalWeight === 100;
                const isEmpty = active.length === 0;

                return (
                  <div className={`rounded-xl border p-4 transition-all shadow-xs space-y-3 ${
                    isEmpty
                      ? "bg-card border-border/80"
                      : isBalanced
                      ? "bg-card border-emerald-500/30 ring-1 ring-emerald-500/10"
                      : totalWeight > 100
                      ? "bg-destructive/5 border-destructive/30 ring-1 ring-destructive/10"
                      : "bg-amber-500/5 border-amber-500/30 ring-1 ring-amber-500/10"
                  }`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          Rubric Balance &amp; Distribution
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1 ${
                          isEmpty
                            ? "bg-secondary text-muted-foreground border-border"
                            : isBalanced
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                            : totalWeight > 100
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                        }`}>
                          {isEmpty ? (
                            <>
                              <AlertCircle className="h-3 w-3" /> 0% Configured • Select criteria below
                            </>
                          ) : isBalanced ? (
                            <>
                              <Check className="h-3 w-3" /> 100% Balanced
                            </>
                          ) : totalWeight > 100 ? (
                            <>
                              <AlertTriangle className="h-3 w-3" /> Overallocated ({totalWeight}% / 100%)
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3" /> {100 - totalWeight}% Unallocated ({totalWeight}% / 100%)
                            </>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAutoBalanceWeights}
                          disabled={isEmpty}
                          className="h-7 text-xs px-2.5 gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Evenly distribute 100% across all enabled criteria"
                        >
                          <Wand2 className="h-3 w-3 text-primary" />
                          Auto-Balance Weights
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowAddCustomParamModal(true)}
                          className="h-7 text-xs px-2.5 gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/10 transition-colors font-medium"
                        >
                          <Plus className="h-3 w-3" />
                          Add Custom
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleResetRubric}
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          title="Restore default evaluation criteria"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Segmented Progress Bar */}
                    <div className="w-full h-3 rounded-full bg-secondary/80 overflow-hidden flex shadow-inner">
                      {isEmpty ? (
                        <div
                          className="h-full w-full bg-muted-foreground/10"
                          title="No criteria active. Select from Evaluation Criteria."
                        />
                      ) : (
                        <>
                          {active.map((p, idx) => {
                            const color = RUBRIC_PALETTE_COLORS[idx % RUBRIC_PALETTE_COLORS.length];
                            if (p.weight <= 0) return null;
                            return (
                              <div
                                key={p.id}
                                className={`${color.bg} h-full transition-all duration-300 relative group cursor-pointer border-r border-background/20 last:border-r-0`}
                                style={{ width: `${Math.min(100, p.weight)}%` }}
                                title={`${p.name}: ${p.weight}%`}
                              />
                            );
                          })}
                          {totalWeight < 100 && (
                            <div
                              className="h-full bg-muted-foreground/15 transition-all duration-300"
                              style={{ width: `${100 - totalWeight}%` }}
                              title={`${100 - totalWeight}% unallocated`}
                            />
                          )}
                        </>
                      )}
                    </div>

                    {/* Active Parameter Legend Chips */}
                    {active.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        {active.map((p, idx) => {
                          const color = RUBRIC_PALETTE_COLORS[idx % RUBRIC_PALETTE_COLORS.length];
                          return (
                            <div key={p.id} className="flex items-center gap-1.5 text-[11px] bg-card border border-border/60 px-2 py-0.5 rounded-md">
                              <span className={`h-2 w-2 rounded-full ${color.bg}`} />
                              <span className="font-medium text-foreground">{p.name}</span>
                              <span className="font-mono font-bold text-primary">{p.weight}%</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 2-Column Enterprise Evaluation Studio */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left Column (lg:col-span-7): Active Scorecard Matrix */}
                <div className="lg:col-span-7 space-y-3">
                  <div className="flex items-center justify-between px-0.5">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        Active Evaluation Rubric
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                          {rubricParameters.filter(p => p.enabled).length} Selected
                        </span>
                      </h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Candidates will be evaluated strictly on these criteria.
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const active = rubricParameters.filter(p => p.enabled);
                    if (active.length === 0) {
                      return (
                        <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center bg-card/40 space-y-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
                          <h4 className="text-xs font-bold text-foreground">No Evaluation Criteria Active</h4>
                          <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                            Click on any criterion from Evaluation Criteria on the right to add it to your candidate evaluation scorecard.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1.5">
                        {active.map((param, idx) => {
                          const defaultOriginal = INITIAL_EVALUATION_RUBRIC.find(p => p.id === param.id);
                          const isCustomized = defaultOriginal ? param.description !== defaultOriginal.description : param.is_custom;

                          return (
                            <div
                              key={param.id}
                              className="group flex items-center gap-3 bg-card border border-border/60 hover:border-border rounded-lg px-3 py-2.5 transition-colors"
                            >
                              {/* Index number */}
                              <span className="text-xs font-mono text-muted-foreground/60 w-5 shrink-0 text-right">
                                {String(idx + 1).padStart(2, "0")}
                              </span>

                              {/* Name */}
                              <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                                {param.name}
                                {param.is_custom && (
                                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">(custom)</span>
                                )}
                                {isCustomized && (
                                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">(modified)</span>
                                )}
                              </span>

                              {/* Weight % */}
                              <span className="text-sm font-semibold text-foreground tabular-nums shrink-0 w-10 text-right">
                                {param.weight}%
                              </span>

                              {/* Stepper */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleWeightChange(param.id, param.weight - 5)}
                                  className="h-6 w-6 rounded border border-border bg-background hover:bg-secondary text-foreground text-sm font-medium flex items-center justify-center transition-colors"
                                  title="Decrease by 5%"
                                >−</button>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={param.weight}
                                  onChange={(e) => handleWeightChange(param.id, parseInt(e.target.value) || 0)}
                                  className="w-11 h-6 text-center text-xs font-mono rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleWeightChange(param.id, param.weight + 5)}
                                  className="h-6 w-6 rounded border border-border bg-background hover:bg-secondary text-foreground text-sm font-medium flex items-center justify-center transition-colors"
                                  title="Increase by 5%"
                                >+</button>
                              </div>

                              {/* Edit guidelines */}
                              <button
                                type="button"
                                onClick={() => handleStartEditParamDesc(param)}
                                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                                title="Edit AI guidelines for this parameter"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>

                              {/* Remove */}
                              <button
                                type="button"
                                onClick={() => handleToggleParameter(param.id)}
                                className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 transition-colors shrink-0"
                                title="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>


                {/* Right Column (lg:col-span-5): Evaluation Criteria */}
                <div className="lg:col-span-5 space-y-3">
                  <div className="bg-card border border-border/80 rounded-2xl shadow-sm overflow-hidden">
                    {/* Library Header */}
                    <div className="px-4 pt-4 pb-3 border-b border-border/60 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Evaluation Criteria</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Click any item to add or remove it
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddCustomParamModal(true)}
                        className="h-8 text-xs px-3 gap-1.5 rounded-xl border-primary/30 text-primary hover:bg-primary/10 font-semibold"
                      >
                        <Plus className="h-3.5 w-3.5" /> Custom
                      </Button>
                    </div>

                    {/* Search */}
                    <div className="px-3 py-2.5 border-b border-border/40">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Search criteria..."
                          value={rubricSearchQuery}
                          onChange={(e) => setRubricSearchQuery(e.target.value)}
                          className="w-full h-9 pl-9 pr-8 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        {rubricSearchQuery && (
                          <button
                            onClick={() => setRubricSearchQuery("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Library List */}
                    <div className="max-h-[520px] overflow-y-auto divide-y divide-border/40">
                      {rubricParameters
                        .filter((param) => {
                          if (rubricSearchQuery) {
                            const q = rubricSearchQuery.toLowerCase();
                            return param.name.toLowerCase().includes(q) || param.description.toLowerCase().includes(q);
                          }
                          return true;
                        })
                        .map((param) => (
                          <div
                            key={param.id}
                            onClick={() => handleToggleParameter(param.id)}
                            className={`px-4 py-3 transition-colors cursor-pointer ${
                              param.enabled
                                ? "bg-secondary/30"
                                : "bg-card hover:bg-secondary/30"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {param.enabled
                                  ? <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                                  : <span className="h-3.5 w-3.5 rounded border border-border/80 shrink-0 inline-block" />
                                }
                                <span className={`text-sm font-medium truncate ${
                                  param.enabled ? "text-foreground" : "text-foreground"
                                }`}>
                                  {param.name}
                                </span>
                                {param.is_custom && (
                                  <span className="text-[10px] text-muted-foreground shrink-0">(custom)</span>
                                )}
                              </div>
                              {param.enabled ? (
                                <span className="text-[11px] font-medium text-primary shrink-0">Selected</span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground shrink-0">Add</span>
                              )}
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground pl-5">
                              {param.description}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 Enterprise Action Footer */}
              <div className="bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6 sticky bottom-4 z-20 backdrop-blur-md bg-card/95">
                {/* Left: Summary & Health Indicator */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground">
                      {rubricParameters.filter(p => p.enabled).length} Active Criteria
                    </span>
                    <span className="text-muted-foreground/40 text-xs">•</span>

                    {/* Weight Status */}
                    {(() => {
                      const active = rubricParameters.filter(p => p.enabled);
                      const totalWeight = active.reduce((sum, p) => sum + (p.weight || 0), 0);
                      const isBalanced = totalWeight === 100;
                      const isEmpty = active.length === 0;

                      return (
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-md text-xs font-bold border flex items-center gap-1.5 ${
                            isEmpty
                              ? "bg-secondary text-muted-foreground border-border"
                              : isBalanced
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : totalWeight > 100
                              ? "bg-destructive/10 text-destructive border-destructive/30"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          }`}>
                            {isEmpty ? (
                              <>
                                <AlertCircle className="h-3 w-3" /> Select at least 1 criteria
                              </>
                            ) : isBalanced ? (
                              <>
                                <Check className="h-3 w-3" /> 100% Balanced
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3 w-3" /> {totalWeight}% / 100%
                              </>
                            )}
                          </span>

                          {!isBalanced && !isEmpty && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleAutoBalanceWeights}
                              className="h-6 text-[11px] px-2 gap-1 rounded border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                              title="Auto-balance weights to exactly 100%"
                            >
                              <Wand2 className="h-3 w-3" />
                              Auto-Balance
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Candidate answers will be evaluated strictly using your active parameters and assigned weights.
                  </p>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
                  <Button
                    variant="hero"
                    onClick={handleFinishAndGenerateLink}
                    disabled={savingRubric || rubricParameters.filter(p => p.enabled).length === 0}
                    className="rounded-lg shadow-md shadow-primary/20 h-10 px-5 text-xs font-semibold"
                  >
                    {savingRubric ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    {savingRubric ? "Saving Criteria..." : "Save & Create Interview Link →"}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: Link Generated */}
          {step === "link" && (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="max-w-lg mx-auto">
              <div className="bg-card rounded-xl border border-border/80 shadow-lg p-6 text-center space-y-5">
                {/* Status icon + title */}
                <div className="flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-foreground">Interview Ready to Dispatch</h2>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {creationMode === "coding"
                        ? `${selectedCount} coding problem${selectedCount !== 1 ? "s" : ""} configured with test execution cases.`
                        : creationMode === "jd"
                        ? `${selectedCount} questions selected across Technical & Behavioral rounds.`
                        : `${selectedCount} questions selected across Technical, Coding & Behavioral rounds.`}
                    </p>
                  </div>
                </div>

                <div className="bg-secondary/30 rounded-lg p-5 border border-border/60 text-left space-y-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Candidate Interview Link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={generatedLink}
                        className="flex-1 h-9 rounded-md bg-background border border-border/70 px-3 text-xs text-foreground font-mono truncate focus:outline-none"
                      />
                      <Button
                        variant="hero"
                        size="sm"
                        onClick={handleCopy}
                        className="h-9 px-4 rounded-md font-semibold shrink-0 gap-1.5 text-sm"
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/40">
                    {emailSentSuccessfully ? (
                      <div className="space-y-1.5">
                        <Button
                          variant="hero"
                          disabled
                          className="w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-2 cursor-not-allowed font-semibold h-10 rounded-md text-sm"
                        >
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" /> Invitation Sent Successfully
                        </Button>
                        <button
                          type="button"
                          onClick={openSendEmailDialog}
                          className="text-xs text-muted-foreground hover:text-primary transition-all font-semibold flex items-center justify-center gap-1 mx-auto hover:underline"
                        >
                          <RotateCcw className="h-3 w-3" /> Resend or Dispatch to More Candidates
                        </button>
                      </div>
                    ) : emailSendFailed ? (
                      <div className="space-y-2">
                        <div className="rounded-md bg-destructive/10 border border-destructive/25 p-2.5 text-left space-y-0.5">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-destructive">Invitation Not Sent</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                                {failedCandidateEmails.length > 0
                                  ? `Email delivery failed for ${failedCandidateEmails.join(", ")}.`
                                  : "The email invitation could not be sent."}
                                {lastEmailError ? ` (${lastEmailError})` : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="hero"
                          className="w-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-2 h-10 rounded-md font-semibold text-sm"
                          onClick={openSendEmailDialog}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Retry / Resend Invitation
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="hero"
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 h-10 rounded-md font-semibold text-sm shadow-md shadow-blue-600/20"
                        onClick={openSendEmailDialog}
                        disabled={!interviewId || !generatedLink}
                      >
                        <Mail className="h-3.5 w-3.5" /> Send Email Invitation to Candidates
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 h-9 rounded-md text-sm font-medium" onClick={() => setStep("evaluation")}>
                    ← Back
                  </Button>
                  <Button variant="outline" className="flex-1 h-9 rounded-md text-sm font-medium" onClick={handleReset}>
                    Create Another
                  </Button>
                  {(candidateEmail || candidateName || candId) ? (
                    <Button variant="hero" className="flex-1 h-9 rounded-md text-sm font-medium" onClick={handleReturnToXevHire}>
                      <ArrowRight className="h-3.5 w-3.5 mr-1" /> Return to XevHire
                    </Button>
                  ) : (
                    <Button variant="hero" className="flex-1 h-9 rounded-md text-sm font-medium" onClick={() => navigate("/dashboard")}>
                      <ArrowRight className="h-3.5 w-3.5 mr-1" /> Dashboard
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

        </div>
      </div>

      <AnimatePresence>
        {showEmailDialog && (
          <div className="fixed inset-0 bg-background/40 dark:bg-black/60 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="w-full max-w-lg bg-card border border-border shadow-2xl rounded-xl p-6 relative flex flex-col max-h-[90vh] overflow-hidden transition-colors duration-200"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-border/60 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-bold text-foreground tracking-tight">Send Email Invitation</h3>
                    <p className="text-xs text-muted-foreground">Customize and send the interview invitation</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowEmailDialog(false)}
                  disabled={sendingEmail}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto py-5 space-y-5 pr-1 text-left">
                {/* Delivery Failure Alert */}
                {dialogError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-rose-500 dark:text-rose-400">Email Invitation Not Sent</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{dialogError}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5">

                  {/* Candidate Email(s) */}
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Candidate Emails <span className="text-destructive">*</span>
                    </label>
                    <p className="text-[11px] text-muted-foreground mb-2">
                      {candidateEmails.length === 0
                        ? "Type an email and click Send, or add multiple emails using + Add."
                        : "Add more emails using + Add, or send to the listed candidates."}
                    </p>

                      {/* Add Email Input */}
                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (emailInput.trim()) handleAddCandidateEmail(); } }}
                          placeholder="candidate@email.com or paste multiple"
                          className={`flex-1 h-10 rounded-md bg-background border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 transition-all shadow-sm ${
                            emailInputHasError 
                              ? "border-destructive focus:ring-destructive/30" 
                              : "border-border focus:ring-primary/30"
                          }`}
                        />
                        {emailInput.trim() && (
                          <Button
                            type="button"
                            variant="hero"
                            size="sm"
                            className="h-10 px-4 shrink-0"
                            onClick={handleAddCandidateEmail}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add
                          </Button>
                        )}
                      </div>

                      {/* Candidate Email List */}
                      {candidateEmails.length > 0 && (
                        <div className="rounded-lg border border-border/50 overflow-hidden max-h-48 overflow-y-auto">
                          {candidateEmails.map((cand, idx) => (
                            <div
                              key={idx}
                              className={`flex items-center gap-2 px-3 py-2.5 text-sm group transition-colors ${
                                idx % 2 === 0 ? "bg-background" : "bg-secondary/20"
                              } hover:bg-primary/5`}
                            >
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
                                {idx + 1}
                              </div>
                              {editingEmailIndex === idx ? (
                                <input
                                  autoFocus
                                  defaultValue={cand.email}
                                  onBlur={(e) => handleEditCandidateEmail(idx, e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleEditCandidateEmail(idx, (e.target as HTMLInputElement).value);
                                    if (e.key === "Escape") setEditingEmailIndex(null);
                                  }}
                                  className="flex-1 h-7 rounded bg-background border border-primary/30 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                                />
                              ) : (
                                <span className="flex-1 text-xs text-foreground truncate font-medium">{cand.email}</span>
                              )}
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => setEditingEmailIndex(idx)}
                                  className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                  title="Edit email"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCandidateEmail(idx)}
                                  className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Remove candidate"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                    {candidateEmails.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">
                        {candidateEmails.length} candidate{candidateEmails.length !== 1 ? "s" : ""} added
                      </p>
                    )}
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Subject <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="AI Interview Invitation"
                      className={`w-full h-10 rounded-md bg-background border px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 transition-all shadow-sm ${
                        subjectHasError 
                          ? "border-destructive focus:ring-destructive/30" 
                          : "border-border focus:ring-primary/30"
                      }`}
                    />
                  </div>

                  {/* Access Window Info (read-only — set in Interview Settings) */}
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className="text-base mt-0.5">📅</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground mb-0.5">Interview Access Window</p>
                        {availableFrom && availableUntil ? (
                          <>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">Start:</span>{" "}
                              {new Date(availableFrom).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} IST
                            </p>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              <span className="font-medium text-foreground">End:</span>{" "}
                              {new Date(availableUntil).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} IST
                            </p>
                          </>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            No access window configured. Candidates can access the interview anytime.
                            <br />
                            <span className="text-primary/80">To restrict access, configure Start &amp; End Date in Interview Settings.</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Footer */}
              <div className="pt-4 border-t border-border/60 flex justify-end gap-3 shrink-0">
                <Button
                  variant="outline"
                  onClick={() => setShowEmailDialog(false)}
                  disabled={sendingEmail}
                  className="h-10 px-5 border-border hover:bg-muted/50 text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  variant="hero"
                  onClick={handleSendEmail}
                  disabled={sendingEmail}
                  className={`h-10 px-5 flex items-center gap-2 shadow-lg active:scale-95 transition-all ${
                    emailSendFailed
                      ? "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20"
                      : "bg-primary hover:bg-primary/95 text-primary-foreground shadow-primary/10"
                  }`}
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : emailSendFailed ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" />
                      {candidateEmails.length > 0 
                        ? `Retry Sending to ${candidateEmails.length} Candidate${candidateEmails.length !== 1 ? "s" : ""}`
                        : "Retry Sending Invitation"
                      }
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      {candidateEmails.length > 0 
                        ? `Send to ${candidateEmails.length} Candidate${candidateEmails.length !== 1 ? "s" : ""}`
                        : "Send Invitation"
                      }
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddCustomParamModal && (
          <div className="fixed inset-0 bg-background/40 dark:bg-black/60 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="w-full max-w-lg bg-card border border-border shadow-2xl rounded-xl p-6 relative flex flex-col space-y-4 transition-colors duration-200"
            >
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <SlidersHorizontal className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">Add Custom Evaluation Parameter</h3>
                    <p className="text-xs text-muted-foreground">Define targeted evaluation guidelines for the AI evaluator</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddCustomParamModal(false)}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Parameter Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., HIPAA Compliance & Healthcare Security"
                    value={customParamName}
                    onChange={(e) => setCustomParamName(e.target.value)}
                    className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    AI Evaluation Instructions / Criteria *
                  </label>
                  <textarea
                    rows={3}
                    placeholder="e.g., Evaluate if candidate explains PHI data encryption, audit trails, and access controls under healthcare regulatory requirements..."
                    value={customParamDesc}
                    onChange={(e) => setCustomParamDesc(e.target.value)}
                    className="w-full p-3 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    The LLM evaluator will directly use these instructions when assessing candidate answers.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-foreground">
                      Weight Percentage
                    </label>
                    <span className="text-xs font-bold text-primary font-mono">{customParamWeight}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={customParamWeight}
                      onChange={(e) => setCustomParamWeight(parseInt(e.target.value) || 10)}
                      className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={customParamWeight}
                        onChange={(e) => setCustomParamWeight(parseInt(e.target.value) || 10)}
                        className="w-14 h-8 text-center text-xs font-bold rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-xs text-muted-foreground ml-1 font-semibold">%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddCustomParamModal(false)}
                  className="rounded-lg"
                >
                  Cancel
                </Button>
                <Button
                  variant="hero"
                  size="sm"
                  onClick={handleAddCustomParameter}
                  className="rounded-lg"
                >
                  Add Parameter
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {editingParamId && (() => {
          const targetParam = rubricParameters.find(p => p.id === editingParamId);
          if (!targetParam) return null;
          const defaultOriginal = INITIAL_EVALUATION_RUBRIC.find(p => p.id === targetParam.id);

          return (
            <div className="fixed inset-0 bg-background/40 dark:bg-black/60 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                className="w-full max-w-xl bg-card border border-border shadow-2xl rounded-2xl p-6 relative flex flex-col space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Sparkles className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">
                        Configure AI Evaluation Guidelines
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Targeted rubric instructions for <strong className="text-foreground">{targetParam.name}</strong>
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingParamId(null)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-xs space-y-1">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-primary" /> How this works
                    </span>
                    <p className="text-muted-foreground leading-relaxed">
                      The AI evaluator will strictly grade candidate answers using these instructions. Leave default for standard industry scoring, or customize with specific technologies, algorithms, or standards.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        AI Instructions / Prompt Rubric *
                      </label>
                      {defaultOriginal && editingParamDesc !== defaultOriginal.description && (
                        <button
                          type="button"
                          onClick={() => handleResetParamDesc(targetParam.id)}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                        >
                          <RotateCcw className="h-3 w-3" /> Restore Default
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={4}
                      value={editingParamDesc}
                      onChange={(e) => setEditingParamDesc(e.target.value)}
                      placeholder="Enter specific AI evaluation instructions..."
                      className="w-full p-3 text-xs rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed font-sans"
                    />
                  </div>

                  {defaultOriginal && (
                    <div className="pt-1">
                      <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
                        Standard Industry Benchmark:
                      </span>
                      <p className="text-[11px] text-muted-foreground/80 bg-secondary/30 p-2.5 rounded-lg border border-border/40 italic leading-relaxed">
                        "{defaultOriginal.description}"
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/60">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingParamId(null)}
                    className="rounded-lg text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="hero"
                    size="sm"
                    onClick={() => handleSaveParamDesc(targetParam.id)}
                    className="rounded-lg text-xs"
                  >
                    <Check className="h-3.5 w-3.5 mr-1.5" /> Save Guidelines
                  </Button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

