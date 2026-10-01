import asyncio
import base64
import cv2
import math
import numpy as np
import mediapipe as mp
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Form, Depends, Header
from typing import Dict, Any, Optional
import os
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import settings
from database import get_db
from models import Interview
import boto3
from botocore.client import Config
from logging_config import logger as log

router = APIRouter()

# Initialize MediaPipe Solutions
import mediapipe as mp
mp_face_mesh = mp.solutions.face_mesh
mp_face_detection = mp.solutions.face_detection
# Patch torch.load for PyTorch 2.6+ compatibility with older ultralytics weights
import torch
original_torch_load = torch.load
def patched_torch_load(*args, **kwargs):
    if "weights_only" not in kwargs:
        kwargs["weights_only"] = False
    return original_torch_load(*args, **kwargs)
torch.load = patched_torch_load

from ultralytics import YOLO

# Load YOLO model once at startup
# Load YOLO model once at startup - Using 's' (small) instead of 'n' (nano) for better accuracy
yolo_model = YOLO("yolov8s.pt")

def extract_valid_faces(multi_face_landmarks):
    """
    Filters out phantom face proposals (e.g. hand gestures, lighting glare, clothing folds)
    and deduplicates overlapping detections of the same individual.
    Returns a list of valid, distinct face data dicts sorted by face area descending.
    """
    if not multi_face_landmarks:
        return []

    valid_faces = []

    for lms in multi_face_landmarks:
        points = lms.landmark
        if len(points) < 468:
            continue

        xs = [p.x for p in points]
        ys = [p.y for p in points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w = max_x - min_x
        h = max_y - min_y
        area = w * h

        # 1. Reject tiny noise or hand patches
        # A real face in webcam view must occupy at least 8% width and 9% height
        if w < 0.08 or h < 0.09 or area < 0.008:
            continue

        # 2. Reject unnatural aspect ratios (extremely elongated or flat shapes)
        aspect = h / w if w > 0 else 0
        if aspect < 0.6 or aspect > 2.2:
            continue

        # 3. Eye separation check (outer eyes: landmark 33 and 263)
        l_eye = points[33]
        r_eye = points[263]
        eye_dist = math.hypot(r_eye.x - l_eye.x, r_eye.y - l_eye.y)
        if eye_dist < 0.035:
            continue

        # 4. Anatomical plausibility: mouth (landmark 13) should be below eyes
        upper_lip = points[13]
        if upper_lip.y < l_eye.y - 0.05 or upper_lip.y < r_eye.y - 0.05:
            continue

        cx = (min_x + max_x) / 2.0
        cy = (min_y + max_y) / 2.0

        valid_faces.append({
            "box": (min_x, min_y, max_x, max_y),
            "area": area,
            "center": (cx, cy),
            "eye_dist": eye_dist,
            "landmarks": points
        })

    if len(valid_faces) <= 1:
        return valid_faces

    # Deduplication & Non-Maximum Suppression between faces:
    # If two detected face boxes overlap significantly or centers are very close,
    # they are double-detections of the SAME person (e.g. glasses, chin shift).
    distinct_faces = []
    # Primary candidate face is the largest one
    valid_faces.sort(key=lambda f: f["area"], reverse=True)
    distinct_faces.append(valid_faces[0])

    for f in valid_faces[1:]:
        fx1, fy1, fx2, fy2 = f["box"]
        cx_f, cy_f = f["center"]
        is_same_person = False

        for df in distinct_faces:
            dx1, dy1, dx2, dy2 = df["box"]
            cx_d, cy_d = df["center"]

            # Center distance check: if centers are within 0.18 of each other, same head
            center_dist = math.hypot(cx_f - cx_d, cy_f - cy_d)
            if center_dist < 0.18:
                is_same_person = True
                break

            # Bounding box intersection over smaller area
            ix1 = max(fx1, dx1)
            iy1 = max(fy1, dy1)
            ix2 = min(fx2, dx2)
            iy2 = min(fy2, dy2)
            if ix2 > ix1 and iy2 > iy1:
                inter_area = (ix2 - ix1) * (iy2 - iy1)
                overlap = inter_area / min(f["area"], df["area"])
                if overlap > 0.25:
                    is_same_person = True
                    break

        if not is_same_person:
            distinct_faces.append(f)

    return distinct_faces


class ProctoringManager:
    def __init__(self):
        # Maps connection (or interview_id) to strike state
        # { "interview_id": {"warnings": 0, "consecutive_no_face": 0, "consecutive_multi_face": 0} }
        self.sessions = {}

    def get_session(self, session_id: str) -> Dict[str, Any]:
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "warnings": 0,
                "consecutive_no_face": 0,
                "consecutive_multi_face": 0,
                "consecutive_look_away": 0,
                # V2.0 Smooth States
                "smooth_nose_x": None,
                "smooth_nose_y": None,
                "alpha": 0.4 # Smoothing factor (EMA)
            }
        return self.sessions[session_id]

    def record_violation(self, session_id: str, reason: str = None, max_strikes: int = 3, action: str = "flag_review") -> Dict[str, Any]:
        """Customizable strike violation system with cooldown to prevent false cascade strikes."""
        import time
        now = time.time()
        session = self.get_session(session_id)
        
        # Enforce minimum 15 seconds cooldown between backend strikes
        last_time = session.get("last_violation_time", 0)
        if now - last_time < 15.0:
            return {"status": "normal", "strikes": min(max_strikes, session["warnings"]), "message": "Monitoring active", "violation_type": "none"}
            
        session["last_violation_time"] = now
        if session["warnings"] < max_strikes:
            session["warnings"] += 1
        strikes = min(max_strikes, session["warnings"])
        
        status = "warning"
        base_message = reason or "Violation detected. Please ensure your face is clearly visible."
        
        # Determine violation type from reason
        violation_type = "gaze"
        if base_message and "multiple" in base_message.lower():
            violation_type = "multi_person"
        elif base_message and "mobile" in base_message.lower():
            violation_type = "mobile"
            
        if strikes == 1:
            message = f"Warning: {base_message}"
        elif strikes < max_strikes:
            status = "warning"
            if strikes == max_strikes - 1:
                status = "final_warning"
                message = f"Final Warning: {base_message}. Another violation will terminate your interview." if action == "auto_terminate" else f"Final Warning: {base_message}."
            else:
                message = f"Warning: {base_message}"
        elif strikes >= max_strikes:
            if action == "auto_terminate":
                status = "terminate"
                message = f"Interview Terminated: {base_message} ({max_strikes} strikes)."
            else:
                status = "warning"
                message = f"Warning: {base_message} ({max_strikes} strikes reached)."
            
        return {"status": status, "strikes": strikes, "message": message, "violation_type": violation_type}

manager = ProctoringManager()

@router.websocket("/api/ws/face-monitor")
async def face_monitor_websocket(websocket: WebSocket, interview_id: Optional[str] = None):
    await websocket.accept()
    session_id = interview_id or str(uuid.uuid4())
    manager.get_session(session_id) # init

    # Load proctoring settings from DB
    proctoring_enabled = True
    proctoring_max_strikes = 3
    proctoring_max_strikes_action = "flag_review"
    
    if interview_id:
        try:
            from database import AsyncSessionLocal
            from sqlalchemy import select
            from models import Interview, InterviewSession
            import uuid as py_uuid
            
            async with AsyncSessionLocal() as db:
                db_id = None
                try:
                    db_id = py_uuid.UUID(interview_id)
                except ValueError:
                    pass
                
                if db_id:
                    res = await db.execute(select(Interview).where(Interview.id == db_id))
                    interview = res.scalar_one_or_none()
                    if interview:
                        proctoring_enabled = getattr(interview, "proctoring_enabled", True)
                        proctoring_max_strikes = getattr(interview, "proctoring_max_strikes", 3)
                        proctoring_max_strikes_action = getattr(interview, "proctoring_max_strikes_action", "flag_review")
                else:
                    res_sess = await db.execute(select(InterviewSession).where(InterviewSession.session_token == interview_id))
                    sess = res_sess.scalar_one_or_none()
                    if sess:
                        res_int = await db.execute(select(Interview).where(Interview.id == sess.interview_id))
                        interview = res_int.scalar_one_or_none()
                        if interview:
                            proctoring_enabled = getattr(interview, "proctoring_enabled", True)
                            proctoring_max_strikes = getattr(interview, "proctoring_max_strikes", 3)
                            proctoring_max_strikes_action = getattr(interview, "proctoring_max_strikes_action", "flag_review")
                    else:
                        res_int = await db.execute(select(Interview).where(Interview.invite_token == interview_id))
                        interview = res_int.scalar_one_or_none()
                        if interview:
                            proctoring_enabled = getattr(interview, "proctoring_enabled", True)
                            proctoring_max_strikes = getattr(interview, "proctoring_max_strikes", 3)
                            proctoring_max_strikes_action = getattr(interview, "proctoring_max_strikes_action", "flag_review")
        except Exception as db_err:
            print(f"[Proctor WebSocket] DB error: {db_err}")

    # Face Mesh for attention monitoring (cpu-friendly, no heavy refinement)
    try:
        with mp_face_mesh.FaceMesh(
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.55,
            min_tracking_confidence=0.55
        ) as face_mesh:
            try:
                while True:
                    data = await websocket.receive_text()
                    if not data: continue
                    
                    if not proctoring_enabled:
                        await websocket.send_json({"face_count": 1, "status": "normal", "message": "Proctoring is disabled for this interview."})
                        continue
                    
                    if "," in data:
                        b64_data = data.split(",")[1]
                    else:
                        b64_data = data
                    
                    state = manager.get_session(session_id)
                    try:
                        import json
                        try:
                            payload = json.loads(data)
                            b64_image = payload.get("image", "")
                            signals = payload.get("signals", {})
                            frontend_strikes = signals.get("strikes", 0)
                            
                            # Sync strike count from frontend if it's higher
                            state = manager.get_session(session_id)
                            if frontend_strikes > state["warnings"]:
                                state["warnings"] = min(proctoring_max_strikes, frontend_strikes)
                                
                        except (json.JSONDecodeError, TypeError):
                            # Fallback for raw legacy data
                            if "," in data:
                                b64_image = data.split(",")[1]
                            else:
                                b64_image = data
                            signals = {}

                        if not b64_image: continue
                        
                        img_bytes = base64.b64decode(b64_image.split(",")[-1] if "," in b64_image else b64_image)
                        np_arr = np.frombuffer(img_bytes, np.uint8)
                        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                        if img is None: continue
                        
                        h, w, _ = img.shape
                        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                        results = face_mesh.process(img_rgb)
                        
                        face_count = 0
                        look_away = False
                        
                        valid_faces = extract_valid_faces(results.multi_face_landmarks)
                        face_count = len(valid_faces)
                        
                        if face_count >= 1:
                            # Primary candidate face is valid_faces[0] (largest face in frame)
                            face_lms = valid_faces[0]["landmarks"]
                            nose = face_lms[1]
                            l_eye = face_lms[33]
                            r_eye = face_lms[263]
                            
                            eye_dist = abs(r_eye.x - l_eye.x)
                            if eye_dist > 0:
                                relative_nose_x = (nose.x - l_eye.x) / eye_dist
                                relative_nose_y = (nose.y - l_eye.y) / eye_dist
                                
                                if state["smooth_nose_x"] is None:
                                    state["smooth_nose_x"] = relative_nose_x
                                    state["smooth_nose_y"] = relative_nose_y
                                else:
                                    alpha = state["alpha"]
                                    state["smooth_nose_x"] = (alpha * relative_nose_x) + (1 - alpha) * state["smooth_nose_x"]
                                    state["smooth_nose_y"] = (alpha * relative_nose_y) + (1 - alpha) * state["smooth_nose_y"]

                                snx = state["smooth_nose_x"]
                                sny = state["smooth_nose_y"]

                                # Relaxed thresholds: allow normal eye reading across screen and downward reading of questions
                                if snx < 0.18 or snx > 0.82 or sny > 2.10:
                                    look_away = True

                                # Iris-Based Gaze Refinement check (Backend)
                                if len(face_lms) > 473 and eye_dist > 0:
                                    l_iris = face_lms[468]
                                    r_iris = face_lms[473]
                                    iris_center_x = (l_iris.x + r_iris.x) / 2
                                    if abs(iris_center_x - nose.x) / eye_dist > 0.65:
                                        look_away = True

                        response = {"face_count": face_count, "status": "normal", "message": "Monitoring active"}

                        # --- Strike Logic ---
                        if face_count == 1:
                            state["consecutive_no_face"] = 0
                            state["consecutive_multi_face"] = 0
                            
                            if look_away:
                                state["consecutive_look_away"] += 1
                                # Require sustained look-away (>= 8 consecutive frames, ~3-4s) before issuing strike
                                if state["consecutive_look_away"] >= 8:
                                    violation = manager.record_violation(session_id, "Please maintain focus on the screen", proctoring_max_strikes, proctoring_max_strikes_action)
                                    response.update(violation)
                                    state["consecutive_look_away"] = 0
                            else:
                                state["consecutive_look_away"] = max(0, state["consecutive_look_away"] - 1)
                                
                        elif face_count == 0:
                            state["consecutive_multi_face"] = 0
                            state["consecutive_no_face"] += 1
                            if state["consecutive_no_face"] >= 6:
                                violation = manager.record_violation(session_id, "Face not detected", proctoring_max_strikes, proctoring_max_strikes_action)
                                response.update(violation)
                                state["consecutive_no_face"] = 0
                                
                        elif face_count > 1:
                            state["consecutive_multi_face"] += 1
                            # Immediately record violation on multi-face detection
                            if state["consecutive_multi_face"] >= 1:
                                violation = manager.record_violation(session_id, "Multiple people detected", proctoring_max_strikes, proctoring_max_strikes_action)
                                response.update(violation)
                                state["consecutive_multi_face"] = 0
 
                        # Final sync: if frontend says status is cheating, ensure backend knows
                        # 🔑 Dynamic threshold check
                        if signals.get("status") == "CHEATING_DETECTED" or state["warnings"] >= proctoring_max_strikes:
                            if proctoring_max_strikes_action == "auto_terminate":
                                response["status"] = "terminate"
                                response["message"] = f"Interview Terminated: Proctoring violations detected ({proctoring_max_strikes} strikes)."
                            else:
                                if not state.get("limit_warned", False):
                                    state["limit_warned"] = True
                                    response["status"] = "warning"
                                    response["message"] = f"Proctoring strikes limit reached ({proctoring_max_strikes} strikes). Incident logged."
                                else:
                                    response["status"] = "normal"
                                    response["message"] = "Monitoring active"
 
                        await websocket.send_json(response)

                        
                    except Exception as e:
                        print(f"Face processing error: {e}")
                        # Keep connection alive despite bad frame
                        pass

            except WebSocketDisconnect:
                print(f"WebSocket closed for session {session_id}")
    except WebSocketDisconnect:
        # BUG-3 FIX: Client disconnected during FaceMesh initialization window (~100-500ms)
        # Previously this caused: RuntimeError: WebSocket is not connected. Need to call "accept" first.
        print(f"[Proctor] Client disconnected during FaceMesh init for session {session_id}")



@router.post("/api/upload-video")
async def upload_video(
    video: UploadFile = File(...),
    interview_id: str = Form(...),
    token: Optional[str] = Header(None, alias="x-invite-token"),
    db: AsyncSession = Depends(get_db)
):
    print(f"DEBUG: /api/upload-video reached! interview_id={interview_id}")
    """
    Upload interview recording to private AWS S3.
    """
    execution_obj = None

    if token:
        from utils import resolve_interview_context
        try:
            execution_obj, _ = await resolve_interview_context(db, token)
        except Exception as e:
            log.warning(f"Failed to resolve context from token in /upload-video: {e}")
            
    if not execution_obj:
        try:
            i_id = uuid.UUID(interview_id)
        except ValueError:
            raise HTTPException(400, "Invalid interview_id")
    
        from models import InterviewSession
        res_sess = await db.execute(select(InterviewSession).where(InterviewSession.id == i_id))
        session = res_sess.scalar_one_or_none()
        
        if session:
            execution_obj = session
        else:
            res_inter = await db.execute(select(Interview).where(Interview.id == i_id))
            interview = res_inter.scalar_one_or_none()
            if interview:
                execution_obj = interview

    if not execution_obj:
        raise HTTPException(404, "Interview or Session not found")

    ext = "webm"
    if video.filename and "." in video.filename:
        ext = video.filename.rsplit(".", 1)[-1].lower()

    # ── Hard size guard (200 MB) ───────────────────────────────────────────────
    MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB
    video_bytes = await video.read()
    if len(video_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            detail=f"Video too large ({len(video_bytes) // (1024*1024)} MB). Maximum is 200 MB. "
                   "Interview recording is compressed automatically — this should not happen in normal use."
        )
    print(f"[Upload] File size: {len(video_bytes) / (1024*1024):.1f} MB")

    try:
        from webm_fixer import fix_webm_stream
        video_bytes = fix_webm_stream(video_bytes)
    except Exception as fe:
        log.warning(f"Failed to fix uploaded WebM stream in proctoring: {fe}")

    # ── Upload to private S3 bucket or fallback to local ──────────────────────
    if settings.STORAGE_MODE != "s3":
        log.info(f"Local storage fallback: Saving {len(video_bytes)} bytes to disk for interview/session {interview_id}")
        if len(video_bytes) == 0:
            log.warning(f"Received 0 bytes for video upload of interview/session {interview_id}")
            
        os.makedirs("uploads", exist_ok=True)
        local_filename = f"{interview_id}.{ext}"
        local_path = os.path.join("uploads", local_filename)
        
        try:
            with open(local_path, "wb") as f:
                f.write(video_bytes)
            
            execution_obj.video_url = f"/uploads/{local_filename}"
            if hasattr(execution_obj, "interview_id") and execution_obj.interview_id:
                parent = await db.get(Interview, execution_obj.interview_id)
                if parent:
                    parent.video_url = execution_obj.video_url
            await db.commit()
            
            return {
                "message": "Video saved locally (S3 not configured)",
                "video_key": local_filename,
                "private": False
            }
        except Exception as e:
            log.error(f"Failed to save video locally for {interview_id}: {e}")
            raise HTTPException(500, f"Local upload failed: {str(e)}")

    try:
        import io
        from boto3.s3.transfer import TransferConfig
        from utils import get_s3_client
        s3_key = f"interviews/{interview_id}/recording.{ext}"

        s3_client = get_s3_client()
        if not s3_client:
            raise Exception("S3 Client initialization failed")

        transfer_cfg = TransferConfig(
            multipart_threshold=8 * 1024 * 1024,
            max_concurrency=5,
            multipart_chunksize=8 * 1024 * 1024,
            use_threads=True,
        )

        file_obj = io.BytesIO(video_bytes)

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: s3_client.upload_fileobj(
                file_obj,
                settings.S3_BUCKET_NAME,
                s3_key,
                ExtraArgs={"ContentType": "video/webm"},
                Config=transfer_cfg,
            )
        )

        execution_obj.video_url = f"s3://{s3_key}"
        if hasattr(execution_obj, "interview_id") and execution_obj.interview_id:
            parent = await db.get(Interview, execution_obj.interview_id)
            if parent:
                parent.video_url = execution_obj.video_url
        await db.commit()

        log.info(f"[Upload] S3 success: s3://{settings.S3_BUCKET_NAME}/{s3_key}")
        return {
            "message": "Video uploaded to S3 successfully",
            "video_key": s3_key,
            "private": True
        }

    except Exception as e:
        log.error(f"!!! S3 Upload Error: {e}")
        raise HTTPException(500, f"S3 upload failed: {str(e)}")

@router.post("/api/detect-object")
async def detect_object(image: str = Form(...)):
    """
    YOLOv8 Object Detection Endpoint.
    """
    try:
        # Decode base64 image
        if "," in image:
            header, encoded = image.split(",", 1)
        else:
            encoded = image
            
        img_bytes = base64.b64decode(encoded)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        import asyncio
        # Run YOLO detection with a lower base threshold
        # Offloaded to a thread pool to prevent blocking the FastAPI event loop under heavy load
        results = await asyncio.to_thread(yolo_model, img, conf=0.20, verbose=False) # Lowered to catch 'potential' bottles better
        
        detections = []
        potential_bottles = False
        img_h, img_w = img.shape[:2]
        
        # First pass: check for inhibitors (bottles, cups, etc.)
        for result in results:
            for box in result.boxes:
                label = yolo_model.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                if label in ["bottle", "cup", "vase", "suitcase", "backpack"] and confidence > 0.2:
                    potential_bottles = True
                    break
        
        # Second pass: gather detections with strict rules
        person_candidates = []
        other_detections = []
        
        for result in results:
            for box in result.boxes:
                label = yolo_model.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                
                # Get bounding box info
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                box_h = y2 - y1
                box_w = x2 - x1
                box_area = box_h * box_w
                
                # Skip items we definitely don't want to strike for
                if label in ["bottle", "cup", "vase", "chair", "potted plant", "suitcase", "backpack"]:
                    continue

                if label == "person":
                    # Filter out weak detections and tiny background patches (< 4% of frame)
                    if confidence >= 0.55 and box_area >= (img_h * img_w * 0.04):
                        person_candidates.append({
                            "box": (x1, y1, x2, y2),
                            "conf": confidence,
                            "area": box_area,
                            "cx": (x1 + x2) / 2.0,
                            "cy": (y1 + y2) / 2.0
                        })
                    continue
                
                if label in ["cell phone", "remote"]:
                    # Rule 1: Confidence threshold - lowered for better responsiveness with YOLOv8s
                    required_conf = 0.55 if potential_bottles else 0.45
                    
                    if confidence < required_conf:
                        continue
                        
                    # Rule 2: Size check
                    if box_h > (img_h * 0.85):
                        log.info(f"PROCTORING: Rejected {label} due to excessive size (likely bottle): {box_h/img_h:.2f}")
                        continue

                    # Log detections for debugging
                    log.info(f"PROCTORING: Valid {label} detected: {confidence:.2f} (size: {box_h/img_h:.2f})")
                    other_detections.append({
                        "label": label,
                        "confidence": confidence
                    })

        # Person Deduplication & Spatial Non-Maximum Suppression:
        # Prevents office chairs behind candidate, wall designs, or moving arms from counting as multiple people
        accepted_persons = []
        if person_candidates:
            # Sort by conf * area descending: the primary candidate is top
            person_candidates.sort(key=lambda p: p["conf"] * p["area"], reverse=True)
            accepted_persons.append(person_candidates[0])
            
            # Evaluate any candidate for a distinct SECOND person
            for p in person_candidates[1:]:
                # Responsive threshold for second person
                if p["conf"] < 0.55:
                    continue
                if p["area"] < (img_h * img_w * 0.04):
                    continue
                    
                is_duplicate = False
                px1, py1, px2, py2 = p["box"]
                
                for main_p in accepted_persons:
                    mx1, my1, mx2, my2 = main_p["box"]
                    
                    ix1 = max(mx1, px1)
                    iy1 = max(my1, py1)
                    ix2 = min(mx2, px2)
                    iy2 = min(my2, py2)
                    
                    inter_w = max(0.0, ix2 - ix1)
                    inter_h = max(0.0, iy2 - iy1)
                    inter_area = inter_w * inter_h
                    
                    min_area = min(main_p["area"], p["area"])
                    union_area = main_p["area"] + p["area"] - inter_area
                    iou = inter_area / union_area if union_area > 0 else 0
                    containment = inter_area / min_area if min_area > 0 else 0
                    center_dist_x = abs(main_p["cx"] - p["cx"])
                    center_dist_y = abs(main_p["cy"] - p["cy"])
                    
                    # If high overlap with candidate (same torso/body detection)
                    if iou > 0.35 or containment > 0.45 or (center_dist_x < (img_w * 0.12) and center_dist_y < (img_h * 0.15)):
                        is_duplicate = True
                        break
                        
                if not is_duplicate:
                    accepted_persons.append(p)

        for p in accepted_persons:
            detections.append({
                "label": "person",
                "confidence": p["conf"]
            })
        detections.extend(other_detections)
        
        if detections:
            log.info(f"YOLO Object Detection Result: {detections}")
            
        return {"detections": detections}

    except Exception as e:
        print(f"Object detection error: {e}")
        return {"detections": [], "error": str(e)}
