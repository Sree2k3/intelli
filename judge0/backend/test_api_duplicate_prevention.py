"""
Integration test for backend duplicate question validation in coding_questions endpoint.
"""
from question_similarity import find_duplicate_in_list, is_duplicate_question


def test_similarity_cases():
    existing = ["Write a function to add two numbers"]
    
    # 1. Exact match
    assert find_duplicate_in_list("Write a function to add two numbers", existing) is not None

    # 2. Number word vs digit
    assert find_duplicate_in_list("Write a function to add 2 numbers", existing) is not None

    # 3. User examples:
    # "write a code for adding 2 number"
    # "write a code for adding two number"
    # "WRITE a code for 2 numbers"
    user_q1 = "write a code for adding 2 number"
    user_q2 = "write a code for adding two number"
    user_q3 = "WRITE a code for 2 numbers"

    user_existing = [user_q1]
    assert find_duplicate_in_list(user_q2, user_existing) is not None
    assert find_duplicate_in_list(user_q3, user_existing) is not None

    # 4. Distinct questions (Fairness: distinct problem variants must be allowed)
    distinct_questions = [
        "Two Sum",
        "Three Sum",
        "4 Sum",
        "Reverse Linked List",
        "Reverse String",
        "Binary Tree Inorder Traversal",
        "Binary Tree Postorder Traversal"
    ]
    for i, q_a in enumerate(distinct_questions):
        for j, q_b in enumerate(distinct_questions):
            if i != j:
                assert not is_duplicate_question(q_a, q_b), f"'{q_a}' and '{q_b}' should NOT be duplicates"


if __name__ == "__main__":
    test_similarity_cases()
    print("API Duplicate Prevention test suite completed successfully!")
