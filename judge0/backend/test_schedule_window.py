import os
import sys
from datetime import datetime, timedelta, timezone

# Add parent directory/backend to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from utils import check_access_status

class MockInterview:
    def __init__(self, **kwargs):
        self.status = kwargs.get("status", "pending")
        self.actual_started_at = kwargs.get("actual_started_at", None)
        self.available_from = kwargs.get("available_from", None)
        self.available_until = kwargs.get("available_until", None)
        self.invite_expires_at = kwargs.get("invite_expires_at", None)
        self.timezone = kwargs.get("timezone", "Asia/Kolkata")
        self.grace_period_minutes = kwargs.get("grace_period_minutes", 0)

def test_access_statuses():
    now_utc = datetime.now(timezone.utc)

    # Case 1: Explicitly completed/submitted -> ALREADY_COMPLETED
    completed_int = MockInterview(status="completed")
    assert check_access_status(completed_int, completed_int) == "ALREADY_COMPLETED"
    
    # Case 2: Legitimately started -> AVAILABLE (even if now outside from/until window)
    started_int = MockInterview(
        status="in_progress",
        actual_started_at=now_utc - timedelta(minutes=10),
        available_from=now_utc + timedelta(hours=1),
        available_until=now_utc + timedelta(hours=2)
    )
    assert check_access_status(started_int, started_int) == "AVAILABLE"

    # Case 3: Before available_from -> NOT_YET_AVAILABLE
    before_from_int = MockInterview(
        available_from=now_utc + timedelta(minutes=10),
        available_until=now_utc + timedelta(hours=1)
    )
    assert check_access_status(before_from_int, before_from_int) == "NOT_YET_AVAILABLE"

    # Case 4: After available_until -> EXPIRED
    expired_until_int = MockInterview(
        available_from=now_utc - timedelta(hours=2),
        available_until=now_utc - timedelta(minutes=10)
    )
    assert check_access_status(expired_until_int, expired_until_int) == "EXPIRED"

    # Case 5: Otherwise -> AVAILABLE
    default_available = MockInterview(
        available_from=now_utc - timedelta(minutes=10),
        available_until=now_utc + timedelta(hours=1)
    )
    assert check_access_status(default_available, default_available) == "AVAILABLE"

    print("All access status check test cases PASSED!")

if __name__ == "__main__":
    test_access_statuses()
