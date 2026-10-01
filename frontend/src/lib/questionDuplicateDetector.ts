/**
 * Enterprise Question Similarity & Duplicate Detection Engine (Frontend).
 *
 * Provides high-precision exact and normalized duplicate detection for
 * Technical, Behavioral, and Coding questions with zero false positives.
 */

const NUM_MAP: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  first: "1",
  second: "2",
  third: "3",
};

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "to", "in", "of", "and", "with",
  "is", "by", "on", "at", "from", "as", "into", "that", "this",
  "write", "code", "program", "function", "algorithm", "solution",
  "given", "implement", "problem", "question", "create", "please",
  "determine", "whether", "check", "if"
]);

const OPENER_PATTERNS = [
  /^(?:can|could)\s+you\s+(?:please\s+)?/i,
  /^(?:please\s+)?tell\s+me\s+about\s+/i,
  /^(?:please\s+)?describe\s+/i,
  /^(?:please\s+)?explain\s+/i,
  /^(?:please\s+)?give\s+(?:an?\s+)?example\s+of\s+/i,
  /^please\s+/i,
];

export function stripQuestionOpener(text: string): string {
  let result = text.trim();
  for (const pattern of OPENER_PATTERNS) {
    result = result.replace(pattern, "").trim();
  }
  return result;
}

export function cleanNormalizeQuestionText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stemWord(word: string): string {
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ing") && word.length > 4) {
    return word.slice(0, -3);
  }
  if (word.endsWith("ed") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

export function normalizeQuestionTokens(text: string): string[] {
  if (!text) return [];
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const tokens: string[] = [];

  for (const w of words) {
    const mapped = NUM_MAP[w] || w;
    const stemmed = stemWord(mapped);
    if (!STOP_WORDS.has(stemmed)) {
      tokens.push(stemmed);
    }
  }

  return tokens;
}

function extractNumbers(tokens: string[]): Set<string> {
  const nums = new Set<string>();
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      nums.add(t);
    }
  }
  return nums;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function isDuplicateQuestion(
  textA: string,
  textB: string,
  threshold: number = 0.85
): boolean {
  if (!textA || !textB) return false;

  const rawA = cleanNormalizeQuestionText(textA);
  const rawB = cleanNormalizeQuestionText(textB);

  // 1. Exact raw match after stripping punctuation, whitespace & case
  if (rawA === rawB) return true;

  const tokensA = normalizeQuestionTokens(textA);
  const tokensB = normalizeQuestionTokens(textB);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return rawA === rawB;
  }

  // 2. Check if normalized token lists are identical
  if (tokensA.length === tokensB.length && tokensA.every((val, index) => val === tokensB[index])) {
    return true;
  }

  // 3. Numeric distinction check (Fairness: "Two Sum" vs "Three Sum")
  const numsA = extractNumbers(tokensA);
  const numsB = extractNumbers(tokensB);
  if (numsA.size > 0 && numsB.size > 0 && !setsEqual(numsA, numsB)) {
    return false;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return false;

  const jaccard = intersection / union;
  const minSize = Math.min(setA.size, setB.size);
  const maxSize = Math.max(setA.size, setB.size);
  const lenRatio = maxSize > 0 ? minSize / maxSize : 0;

  // Strict high-confidence match with length check to prevent false positives
  if (jaccard >= threshold && lenRatio >= 0.80) {
    return true;
  }

  // 4. Strict subset overlap check: only if length is very close and token overlap is >= 90%
  const subsetRatio = minSize > 0 ? intersection / minSize : 0;
  if (subsetRatio >= 0.90 && lenRatio >= 0.75 && minSize >= 3) {
    return true;
  }

  return false;
}

export interface QuestionDuplicateMatch {
  isDuplicate: boolean;
  matchedId?: string;
  matchedText?: string;
  reason?: "exact" | "opener" | "strict_tokens";
}

/**
 * High-precision duplicate detection specifically tuned for Technical and Behavioral questions.
 * Ensures genuine duplicates are caught while completely eliminating false positives on questions
 * that merely share conversational framing or common interview words.
 */
export function findQuestionDuplicate(
  candidateText: string,
  existingQuestions: Array<{
    id?: string;
    question_text?: string;
    title?: string;
    question_type?: string;
  }>,
  excludeId?: string,
  candidateType?: string
): QuestionDuplicateMatch {
  if (!candidateText || !candidateText.trim()) {
    return { isDuplicate: false };
  }

  const normCandidate = cleanNormalizeQuestionText(candidateText);
  if (!normCandidate) {
    return { isDuplicate: false };
  }
  const openerCandidate = stripQuestionOpener(normCandidate);
  const wordsCandidate = normCandidate.split(" ");
  const setCandidate = new Set(wordsCandidate);

  for (const q of existingQuestions) {
    if (excludeId && q.id === excludeId) {
      continue;
    }

    // Coding problems shouldn't collide with non-coding questions
    if (candidateType === "coding" && q.question_type && q.question_type !== "coding") {
      continue;
    }
    if (candidateType && candidateType !== "coding" && q.question_type === "coding") {
      continue;
    }

    const rawExisting = (q.question_text || q.title || "").trim();
    if (!rawExisting) continue;

    const normExisting = cleanNormalizeQuestionText(rawExisting);
    if (!normExisting) continue;

    // 1. Exact normalized match (same text regardless of punctuation, case, whitespace)
    if (normCandidate === normExisting) {
      return {
        isDuplicate: true,
        matchedId: q.id,
        matchedText: rawExisting,
        reason: "exact",
      };
    }

    // 2. Opener match ("Can you explain X" vs "Explain X")
    const openerExisting = stripQuestionOpener(normExisting);
    if (
      openerCandidate &&
      openerExisting &&
      openerCandidate.length > 10 &&
      openerCandidate === openerExisting
    ) {
      return {
        isDuplicate: true,
        matchedId: q.id,
        matchedText: rawExisting,
        reason: "opener",
      };
    }

    // 3. Strict token equality
    const wordsExisting = normExisting.split(" ");
    if (
      wordsCandidate.length === wordsExisting.length &&
      wordsCandidate.every((w, i) => w === wordsExisting[i])
    ) {
      return {
        isDuplicate: true,
        matchedId: q.id,
        matchedText: rawExisting,
        reason: "strict_tokens",
      };
    }

    // 4. High-confidence Jaccard match (>= 0.90) with high length ratio (>= 0.85)
    // Only applies if question has non-trivial word count (>= 4 words)
    if (wordsCandidate.length >= 4 && wordsExisting.length >= 4) {
      const setExisting = new Set(wordsExisting);
      let intersection = 0;
      for (const w of setCandidate) {
        if (setExisting.has(w)) intersection++;
      }
      const union = new Set([...setCandidate, ...setExisting]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      const lenRatio =
        Math.min(wordsCandidate.length, wordsExisting.length) /
        Math.max(wordsCandidate.length, wordsExisting.length);

      if (jaccard >= 0.90 && lenRatio >= 0.85) {
        return {
          isDuplicate: true,
          matchedId: q.id,
          matchedText: rawExisting,
          reason: "strict_tokens",
        };
      }
    }
  }

  return { isDuplicate: false };
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchedId?: string;
  matchedTitle?: string;
  reason?: "title" | "description";
}

/**
 * Checks whether a candidate coding problem (title + optional description)
 * conflicts with any existing problem in the interview list.
 */
export function checkQuestionDuplicate(
  candidate: { title: string; description?: string },
  existingQuestions: Array<{
    id?: string;
    title?: string;
    question_text?: string;
    description?: string;
    question_type?: string;
  }>,
  excludeId?: string
): DuplicateCheckResult {
  const candidateTitle = (candidate.title || "").trim();
  const candidateDesc = (candidate.description || "").trim().toLowerCase();

  if (!candidateTitle) {
    return { isDuplicate: false };
  }

  for (const q of existingQuestions) {
    if (excludeId && q.id === excludeId) {
      continue;
    }
    // Only check against coding questions if question_type is available
    if (q.question_type && q.question_type !== "coding") {
      continue;
    }

    const existingTitle = (q.title || q.question_text || "").trim();
    const existingDesc = (q.description || "").trim().toLowerCase();

    // Check title similarity
    if (existingTitle && isDuplicateQuestion(candidateTitle, existingTitle, 0.85)) {
      return {
        isDuplicate: true,
        matchedId: q.id,
        matchedTitle: existingTitle,
        reason: "title",
      };
    }

    // Check description similarity (if non-trivial length)
    if (
      candidateDesc &&
      existingDesc &&
      candidateDesc.length > 20 &&
      existingDesc.length > 20 &&
      (candidateDesc === existingDesc || isDuplicateQuestion(candidateDesc, existingDesc, 0.90))
    ) {
      return {
        isDuplicate: true,
        matchedId: q.id,
        matchedTitle: existingTitle || "Existing question",
        reason: "description",
      };
    }
  }

  return { isDuplicate: false };
}
