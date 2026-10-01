"""
Judge0 Client for IntelliHire
Replaces LocalExecutor with sandboxed, scalable code execution via Judge0.
"""
import asyncio
import httpx
import logging
from typing import Optional, List, Dict, Any

from config import settings

log = logging.getLogger(__name__)


class Judge0Client:
    """Async client for Judge0 code execution API."""
    
    def __init__(self):
        self.base_url = getattr(settings, "JUDGE0_URL", "http://judge0:2358")
        self.auth_token = getattr(settings, "JUDGE0_AUTH_TOKEN", None)
        self.headers = {"Content-Type": "application/json"}
        if self.auth_token:
            self.headers["X-Auth-Token"] = self.auth_token
        
        # Language ID mapping from Judge0 CE /languages endpoint
        self.language_map = {
            "python": 71, "python3": 71, "py": 71,
            "javascript": 63, "js": 63, "node": 63, "nodejs": 63,
            "java": 62,
            "cpp": 54, "c++": 54, "cxx": 54, "cc": 54,
            "c": 50,
            "csharp": 51, "cs": 51,
            "go": 60, "golang": 60,
            "rust": 73,
            "typescript": 74, "ts": 74,
        }
        
        # Default resource limits
        self.default_cpu_time_limit = 2.0
        self.default_memory_limit = 128000  # KB
        self.default_wall_time_limit = 5.0
    
    def _get_language_id(self, language: str) -> int:
        """Map language name to Judge0 language_id."""
        lang = language.lower().strip()
        # Normalize common aliases
        if lang in ("cpp", "c++"):
            lang = "cpp"
        return self.language_map.get(lang, 71)  # Default to Python 3.8.1
    
    async def run(self, source_code: str, language: str, 
                  stdin: str = "", expected_output: str = "",
                  cpu_time_limit: Optional[float] = None,
                  memory_limit: Optional[int] = None,
                  wall_time_limit: Optional[float] = None) -> Dict[str, Any]:
        """
        Execute single submission, wait for result.
        
        Returns normalized result dict compatible with existing LocalExecutor format.
        """
        language_id = self._get_language_id(language)
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Create submission
            payload = {
                "source_code": source_code,
                "language_id": language_id,
                "stdin": stdin,
                "expected_output": expected_output,
                "cpu_time_limit": cpu_time_limit or self.default_cpu_time_limit,
                "memory_limit": memory_limit or self.default_memory_limit,
                "wall_time_limit": wall_time_limit or self.default_wall_time_limit,
                "enable_network": False,
            }
            
            try:
                resp = await client.post(
                    f"{self.base_url}/submissions?wait=false",
                    json=payload,
                    headers=self.headers
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                log.error(f"Judge0 submission creation failed: {e.response.text}")
                raise RuntimeError(f"Judge0 API error: {e.response.status_code}")
            except httpx.RequestError as e:
                log.error(f"Judge0 connection failed: {e}")
                raise RuntimeError(f"Cannot connect to Judge0 at {self.base_url}")
            
            token = resp.json()["token"]
            
            # Poll for result (max 30s)
            for _ in range(150):
                await asyncio.sleep(0.2)
                try:
                    result = await client.get(
                        f"{self.base_url}/submissions/{token}",
                        headers=self.headers
                    )
                    result.raise_for_status()
                except httpx.RequestError as e:
                    log.warning(f"Judge0 poll failed: {e}")
                    continue
                
                data = result.json()
                if data["status"]["id"] not in (1, 2):  # Not In Queue / Processing
                    return self._normalize_result(data)
            
            raise TimeoutError("Judge0 execution timeout after 30s")
    
    async def run_batch(self, submissions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Execute multiple test cases in parallel.
        
        Each submission dict should have:
        - source_code (required)
        - language (required)
        - stdin (optional)
        - expected_output (optional)
        - cpu_time_limit (optional)
        - memory_limit (optional)
        - wall_time_limit (optional)
        """
        if not submissions:
            return []
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Build batch payload
            payload = {"submissions": []}
            for sub in submissions:
                payload["submissions"].append({
                    "source_code": sub["source_code"],
                    "language_id": self._get_language_id(sub["language"]),
                    "stdin": sub.get("stdin", ""),
                    "expected_output": sub.get("expected_output", ""),
                    "cpu_time_limit": sub.get("cpu_time_limit", self.default_cpu_time_limit),
                    "memory_limit": sub.get("memory_limit", self.default_memory_limit),
                    "wall_time_limit": sub.get("wall_time_limit", self.default_wall_time_limit),
                    "enable_network": False
                })
            
            try:
                resp = await client.post(
                    f"{self.base_url}/submissions/batch",
                    json=payload,
                    headers=self.headers
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                log.error(f"Judge0 batch creation failed: {e.response.text}")
                raise RuntimeError(f"Judge0 batch API error: {e.response.status_code}")
            except httpx.RequestError as e:
                log.error(f"Judge0 batch connection failed: {e}")
                raise RuntimeError(f"Cannot connect to Judge0 at {self.base_url}")
            
            tokens = [s["token"] for s in resp.json()]
            
            # Poll all submissions
            return await self._poll_batch(client, tokens)
    
    async def _poll_batch(self, client: httpx.AsyncClient, tokens: List[str]) -> List[Dict[str, Any]]:
        """Poll multiple submissions until all complete."""
        pending = set(tokens)
        results = {}
        
        for _ in range(150):  # 30s max
            await asyncio.sleep(0.2)
            remaining = []
            
            for token in pending:
                try:
                    result = await client.get(
                        f"{self.base_url}/submissions/{token}",
                        headers=self.headers
                    )
                    result.raise_for_status()
                except httpx.RequestError as e:
                    log.warning(f"Judge0 batch poll failed for {token}: {e}")
                    remaining.append(token)
                    continue
                
                data = result.json()
                if data["status"]["id"] not in (1, 2):
                    results[token] = self._normalize_result(data)
                else:
                    remaining.append(token)
            
            pending = set(remaining)
            if not pending:
                break
        
        # Return in original order, with timeout placeholder for any remaining
        return [
            results.get(t, {"status": "timeout", "status_id": 0, "is_error": True, "output": "", "stdout": "", "stderr": "Execution timeout", "time": 0, "memory": 0})
            for t in tokens
        ]
    
    def _normalize_result(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert Judge0 response to internal format compatible with LocalExecutor.
        
        LocalExecutor returns: (output: str, is_error: bool, execution_time_ms: int)
        We return a richer dict that the endpoints can use.
        """
        status_id = data["status"]["id"]
        
        # Judge0 status codes
        # 1: In Queue, 2: Processing, 3: Accepted, 4: Wrong Answer
        # 5: TLE, 6: Compile Error, 7-12: Runtime Errors, 13: Internal Error, 14: Exec Format Error
        is_error = status_id not in (3, 4)  # Accepted or Wrong Answer = not system error
        
        stdout = data.get("stdout") or ""
        stderr = data.get("stderr") or ""
        compile_output = data.get("compile_output") or ""
        
        # Combine outputs for backward compatibility
        output_parts = []
        if compile_output:
            output_parts.append(f"Compilation:\n{compile_output}")
        if stdout:
            output_parts.append(stdout)
        if stderr and stderr != compile_output:
            output_parts.append(f"Stderr:\n{stderr}")
        
        output = "\n".join(output_parts).strip()
        
        return {
            "status": data["status"]["description"],
            "status_id": status_id,
            "is_error": is_error,
            "output": output,
            "stdout": stdout,
            "stderr": stderr,
            "compile_output": compile_output,
            "time": float(data.get("time", 0) or 0),
            "wall_time": float(data.get("wall_time", 0) or 0),
            "memory": data.get("memory"),
            "exit_code": data.get("exit_code"),
            "exit_signal": data.get("exit_signal"),
            "message": data.get("message"),
        }
    
    async def health_check(self) -> bool:
        """Check if Judge0 is reachable and healthy."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/about", headers=self.headers)
                return resp.status_code == 200
        except Exception:
            return False


# Global instance
_judge0_client: Optional[Judge0Client] = None


def get_judge0_client() -> Judge0Client:
    """Get or create global Judge0 client instance."""
    global _judge0_client
    if _judge0_client is None:
        _judge0_client = Judge0Client()
    return _judge0_client