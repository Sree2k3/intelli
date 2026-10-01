"""
Unit tests for Question Similarity & Duplicate Detection Engine.
"""

from question_similarity import (
    is_duplicate_question,
    find_duplicate_in_list,
    normalize_question_tokens,
)


def test_user_examples():
    q1 = "write a code for adding 2 number"
    q2 = "write a code for adding two number"
    q3 = "WRITE a code for 2 numbers"

    assert is_duplicate_question(q1, q2), "q1 and q2 must be duplicates"
    assert is_duplicate_question(q1, q3), "q1 and q3 must be duplicates"
    assert is_duplicate_question(q2, q3), "q2 and q3 must be duplicates"


def test_case_insensitivity_and_whitespace():
    assert is_duplicate_question("Two Sum", "  two sum  ")
    assert is_duplicate_question("REVERSE A LINKED LIST", "reverse a linked list")
    assert is_duplicate_question("Fibonacci Series", "fibonacci series")


def test_number_word_variants():
    assert is_duplicate_question("Find 3 largest numbers", "Find three largest numbers")
    assert is_duplicate_question("Merge 2 sorted lists", "Merge two sorted lists")
    assert is_duplicate_question("Top 5 frequent elements", "Top five frequent elements")


def test_fairness_distinct_problems_not_flagged():
    # Two Sum vs Three Sum must NOT be flagged as duplicates
    assert not is_duplicate_question("Two Sum", "Three Sum")
    assert not is_duplicate_question("Find 2 largest numbers", "Find 3 largest numbers")
    assert not is_duplicate_question("Binary Tree Inorder Traversal", "Binary Tree Preorder Traversal")
    assert not is_duplicate_question("Reverse Linked List", "Reverse String")
    assert not is_duplicate_question("Valid Palindrome", "Valid Anagram")


def test_find_duplicate_in_list():
    existing = [
        "Reverse a Linked List",
        "Two Sum",
        "Valid Parentheses",
    ]
    assert find_duplicate_in_list("write a code for two sum", existing) is not None
    assert find_duplicate_in_list("2 sum", existing) is not None
    assert find_duplicate_in_list("Merge K Sorted Lists", existing) is None
    assert find_duplicate_in_list("Three Sum", existing) is None


if __name__ == "__main__":
    test_user_examples()
    test_case_insensitivity_and_whitespace()
    test_number_word_variants()
    test_fairness_distinct_problems_not_flagged()
    test_find_duplicate_in_list()
    print("All enterprise duplicate detection unit tests passed successfully!")
