import subprocess
import os
import tempfile
import uuid
import shutil
from typing import Dict, List, Optional, Tuple

class LocalExecutor:
    """
    Executes code locally in a temporary directory.
    Supports Python, C++, Java, and JavaScript (Node.js).
    """

    @staticmethod
    def run(language: str, code: str, stdin: str = "", timeout: float = 5.0) -> Tuple[str, bool, int]:
        """
        Runs code and returns (output, is_error, execution_time_ms).
        IMPORTANT: Only stdout is returned as output. stderr is only used
        when the process fails AND stdout is empty, to report the error.
        """
        import time
        start_time = time.time()
        
        # Normalize language name
        language = language.lower()
        if language in ("cpp", "c++"):
            language = "cpp"
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            try:
                if language == "python":
                    import sys
                    file_path = os.path.join(tmp_dir, "solution.py")
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(code)
                    proc = subprocess.run(
                        [sys.executable, "solution.py"],
                        input=stdin,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=tmp_dir
                    )
                    is_error = proc.returncode != 0
                    output = proc.stdout if proc.stdout.strip() else proc.stderr

                elif language == "c":
                    file_path = os.path.join(tmp_dir, "solution.c")
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(code)
                    
                    import sys
                    is_win = sys.platform == "win32"
                    exe_name = "solution.exe" if is_win else "solution"
                    gcc_path = shutil.which("gcc") or "C:\\msys64\\ucrt64\\bin\\gcc.exe"
                    
                    # Environment with MinGW in PATH for DLLs
                    env = os.environ.copy()
                    if is_win:
                        env["PATH"] = "C:\\msys64\\ucrt64\\bin;" + env.get("PATH", "")

                    compile_cmd = [gcc_path, "solution.c", "-o", exe_name]
                    print(f"[Executor] C Compile CMD: {compile_cmd}")
                    
                    # Compile
                    compile_proc = subprocess.run(
                        compile_cmd,
                        capture_output=True,
                        text=True,
                        cwd=tmp_dir,
                        env=env
                    )
                    
                    exe_path = os.path.join(tmp_dir, exe_name)
                    if compile_proc.returncode != 0 or not os.path.exists(exe_path):
                        err_msg = compile_proc.stderr.strip() or compile_proc.stdout.strip()
                        if not err_msg:
                            err_msg = "Compilation failed silently or executable was not produced."
                        return err_msg, True, int((time.time() - start_time) * 1000)
                    
                    run_cmd = [exe_path]
                    print(f"[Executor] C Run CMD: {run_cmd}")
                    
                    # Execute
                    proc = subprocess.run(
                        run_cmd,
                        input=stdin,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=tmp_dir,
                        env=env
                    )
                    is_error = proc.returncode != 0
                    output = proc.stdout if proc.stdout.strip() else proc.stderr

                elif language == "cpp":
                    file_path = os.path.join(tmp_dir, "solution.cpp")
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(code)
                    
                    import sys
                    is_win = sys.platform == "win32"
                    exe_name = "solution.exe" if is_win else "solution"
                    gpp_path = shutil.which("g++") or "C:\\msys64\\ucrt64\\bin\\g++.exe"
                    
                    # Environment with MinGW in PATH for DLLs
                    env = os.environ.copy()
                    if is_win:
                        env["PATH"] = "C:\\msys64\\ucrt64\\bin;" + env.get("PATH", "")

                    compile_cmd = [gpp_path, "-std=c++17", "solution.cpp", "-o", exe_name]
                    print(f"[Executor] C++ Compile CMD: {compile_cmd}")
                    
                    # Compile
                    compile_proc = subprocess.run(
                        compile_cmd,
                        capture_output=True,
                        text=True,
                        cwd=tmp_dir,
                        env=env
                    )
                    
                    exe_path = os.path.join(tmp_dir, exe_name)
                    if compile_proc.returncode != 0 or not os.path.exists(exe_path):
                        err_msg = compile_proc.stderr.strip() or compile_proc.stdout.strip()
                        if not err_msg:
                            err_msg = "Compilation failed silently or executable was not produced."
                        return err_msg, True, int((time.time() - start_time) * 1000)
                    
                    run_cmd = [exe_path]
                    print(f"[Executor] C++ Run CMD: {run_cmd}")
                    
                    # Execute
                    proc = subprocess.run(
                        run_cmd,
                        input=stdin,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=tmp_dir,
                        env=env
                    )
                    is_error = proc.returncode != 0
                    output = proc.stdout if proc.stdout.strip() else proc.stderr

                elif language == "java":
                    file_path = os.path.join(tmp_dir, "SolutionHarness.java")
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(code)
                    
                    # Compile
                    compile_proc = subprocess.run(
                        ["javac", "SolutionHarness.java"],
                        capture_output=True,
                        text=True,
                        cwd=tmp_dir
                    )
                    if compile_proc.returncode != 0:
                        return compile_proc.stderr, True, int((time.time() - start_time) * 1000)
                    
                    # Execute
                    proc = subprocess.run(
                        ["java", "SolutionHarness"],
                        input=stdin,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                        cwd=tmp_dir
                    )
                    is_error = proc.returncode != 0
                    output = proc.stdout if proc.stdout.strip() else proc.stderr

                else:
                    return f"Unsupported language: {language}", True, 0

            except subprocess.TimeoutExpired:
                return "Error: Execution Timeout (5s)", True, int(timeout * 1000)
            except Exception as e:
                return f"Internal Error: {str(e)}", True, 0

        execution_time = int((time.time() - start_time) * 1000)
        return output, is_error, execution_time
