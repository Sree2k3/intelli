"""
Enterprise Question Similarity & Duplicate Detection Engine.

Provides smart token normalization, stemming, number-word conversion,
and fuzzy token similarity to detect duplicate coding and interview questions.
"""

import re
from typing import List, Optional, Set, Tuple

NUM_MAP = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "first": "1",
    "second": "2",
    "third": "3",
}

# Common boilerplate and filler words found in interview questions
STOP_WORDS = {
    "a", "an", "the", "for", "to", "in", "of", "and", "with",
    "is", "by", "on", "at", "from", "as", "into", "that", "this",
    "write", "code", "program", "function", "algorithm", "solution",
    "given", "implement", "problem", "question", "create", "please",
    "determine", "whether", "check", "if"
}


def stem_word(word: str) -> str:
    """Apply lightweight stemming for interview problem terminology."""
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("ing") and len(word) > 4:
        return word[:-3]
    if word.endswith("ed") and len(word) > 4:
        return word[:-2]
    if word.endswith("es") and len(word) > 4:
        return word[:-2]
    if word.endswith("s") and len(word) > 3 and not word.endswith("ss"):
        return word[:-1]
    return word


def normalize_question_tokens(text: str) -> List[str]:
    """
    Tokenizes text, converts number words to digits, applies stemming,
    and removes common stop words / instruction boilerplate.
    """
    if not text:
        return []
    words = re.findall(r"[a-z0-9]+", text.lower())
    tokens: List[str] = []
    for w in words:
        mapped = NUM_MAP.get(w, w)
        stemmed = stem_word(mapped)
        if stemmed not in STOP_WORDS:
            tokens.append(stemmed)
    return tokens


def extract_numbers(tokens: List[str]) -> Set[str]:
    """Extract numeric tokens to protect distinct numerical variations."""
    return {t for t in tokens if t.isdigit()}


def is_duplicate_question(
    text_a: str,
    text_b: str,
    threshold: float = 0.70,
) -> bool:
    """
    Determines whether two question titles or texts are duplicates.

    Returns True if:
    - Exact match after trimming & lowercase.
    - Tokenized Jaccard similarity >= threshold.
    - High subset overlap (one prompt is a subset of the other, >= 85%).

    Fairness rule:
    - If both texts contain different numeric identifiers (e.g. "Two Sum" vs "Three Sum"),
      they are explicitly NOT flagged as duplicates.
    """
    if not text_a or not text_b:
        return False

    raw_a = " ".join(text_a.lower().strip().split())
    raw_b = " ".join(text_b.lower().strip().split())

    # 1. Exact raw match
    if raw_a == raw_b:
        return True

    tokens_a = normalize_question_tokens(text_a)
    tokens_b = normalize_question_tokens(text_b)

    if not tokens_a or not tokens_b:
        # Fallback to non-empty raw comparison
        return raw_a == raw_b

    # 2. Check if normalized token lists are identical
    if tokens_a == tokens_b:
        return True

    # 3. Numeric distinction check (Fairness: "Two Sum" vs "Three Sum")
    nums_a = extract_numbers(tokens_a)
    nums_b = extract_numbers(tokens_b)
    if nums_a and nums_b and nums_a != nums_b:
        # Differing numbers indicate distinct problem variants
        return False

    set_a = set(tokens_a)
    set_b = set(tokens_b)

    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    if union == 0:
        return False

    jaccard = intersection / union
    if jaccard >= threshold:
        return True

    # 4. Subset overlap check (e.g. "2 numbers" vs "adding 2 number")
    min_size = min(len(set_a), len(set_b))
    subset_ratio = intersection / min_size if min_size > 0 else 0
    if subset_ratio >= 0.85 and intersection >= 2:
        return True

    return False


def find_duplicate_in_list(
    new_title: str,
    existing_titles: List[str],
    threshold: float = 0.70,
) -> Optional[str]:
    """
    Searches an existing list of titles for any duplicate.
    Returns the matching existing title if found, otherwise None.
    """
    for existing in existing_titles:
        if is_duplicate_question(new_title, existing, threshold):
            return existing
    return None
