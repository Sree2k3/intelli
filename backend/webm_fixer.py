"""
webm_fixer.py - In-memory EBML patcher for WebM videos recorded by browser MediaRecorder.

MediaRecorder produces live-streaming WebM without:
1. Duration tag in Segment Info
2. Cues (seek index)
3. SeekHead pointing to Cues
4. Finite sizes for Segment and Clusters (marked as 01 ff ff ff ff ff ff ff)

This module parses the EBML structure, extracts timestamps and cluster offsets,
calculates duration, and outputs a 100% compliant Matroska/WebM file with
SeekHead, Info (with Duration), exact Cluster lengths, and Cues index.
This enables timeline scrubbing, seeking, and duration display in Windows Media Player,
VLC, QuickTime, and browsers.
"""

import os
import struct
import logging
from typing import Optional, List, Dict, Tuple

log = logging.getLogger(__name__)

# EBML Element IDs
ID_EBML_HEADER = b"\x1a\x45\xdf\xa3"
ID_SEGMENT = b"\x18\x53\x80\x67"
ID_SEEK_HEAD = b"\x11\x4d\x9b\x74"
ID_SEEK = b"\x4d\xbb"
ID_SEEK_ID = b"\x53\xab"
ID_SEEK_POS = b"\x53\xac"
ID_INFO = b"\x15\x49\xa9\x66"
ID_TIMECODE_SCALE = b"\x2a\xd7\xb1"
ID_DURATION = b"\x44\x89"
ID_TRACKS = b"\x16\x54\xae\x6b"
ID_CLUSTER = b"\x1f\x43\xb6\x75"
ID_TIMECODE = b"\xe7"
ID_SIMPLE_BLOCK = b"\xa3"
ID_BLOCK_GROUP = b"\xa0"
ID_CUES = b"\x1c\x53\xbb\x6b"
ID_CUE_POINT = b"\xbb"
ID_CUE_TIME = b"\xb3"
ID_CUE_TRACK_POS = b"\xb7"
ID_CUE_TRACK = b"\xf7"
ID_CUE_CLUSTER_POS = b"\xf1"


def ebml_vint(val: int, min_bytes: int = 1) -> bytes:
    """Encode an integer as an EBML variable-length integer (VINT)."""
    for n in range(max(1, min_bytes), 9):
        limit = (1 << (7 * n)) - 2
        if val <= limit:
            marker = 1 << (7 * n)
            v = marker | val
            return v.to_bytes(n, "big")
    raise ValueError(f"Value {val} exceeds 8-byte VINT range")


def ebml_uint(val: int, fixed_bytes: Optional[int] = None) -> bytes:
    """Encode an unsigned integer with its VINT length prefix."""
    if fixed_bytes is not None:
        b = val.to_bytes(fixed_bytes, "big")
        return ebml_vint(len(b)) + b
    if val == 0:
        b = b"\x00"
    else:
        length = (val.bit_length() + 7) // 8
        b = val.to_bytes(length, "big")
    return ebml_vint(len(b)) + b


def ebml_float(val: float) -> bytes:
    """Encode a float64 (8 bytes) with its VINT length prefix."""
    b = struct.pack(">d", float(val))
    return ebml_vint(len(b)) + b


def ebml_element(eid_bytes: bytes, payload: bytes) -> bytes:
    """Construct an EBML element from ID and payload."""
    return eid_bytes + ebml_vint(len(payload)) + payload


def build_seek_entry(elem_id_bytes: bytes, position: int) -> bytes:
    """Build a Seek entry in SeekHead using a 4-byte fixed uint for position."""
    seek_id = ID_SEEK_ID + ebml_vint(len(elem_id_bytes)) + elem_id_bytes
    seek_pos = ID_SEEK_POS + ebml_uint(position, fixed_bytes=4)
    return ebml_element(ID_SEEK, seek_id + seek_pos)


def is_webm_seekable(data: bytes) -> bool:
    """Check if a WebM buffer already has a Duration tag, finite Segment, and Cues."""
    if not data.startswith(ID_EBML_HEADER):
        return False

    # Check if Cues element exists
    cues_idx = data.find(ID_CUES)
    if cues_idx == -1:
        return False

    # Check if Duration exists in Info
    duration_idx = data.find(ID_DURATION)
    if duration_idx == -1 or duration_idx > 4096:
        return False

    # Check if Segment size is finite (not 01 ff ff ff ff ff ff ff)
    seg_idx = data.find(ID_SEGMENT)
    if seg_idx != -1 and data[seg_idx + 4 : seg_idx + 12] == b"\x01\xff\xff\xff\xff\xff\xff\xff":
        return False

    return True


def fix_webm_stream(data: bytes) -> bytes:
    """
    Fix a WebM byte stream in-memory by injecting Duration, SeekHead, exact
    Cluster lengths, and Cues seek index.

    Returns the fixed bytes, or the original bytes if fixing fails or is unnecessary.
    """
    if len(data) < 100:
        return data

    if not data.startswith(ID_EBML_HEADER):
        # Not an EBML file
        return data

    try:
        # 1. Parse EBML Header
        p = 4
        b = data[p]
        mask = 0x80
        hlen = 1
        while not (b & mask):
            mask >>= 1
            hlen += 1
        ebml_hdr_len = b & (mask - 1)
        for _ in range(hlen - 1):
            p += 1
            ebml_hdr_len = (ebml_hdr_len << 8) | data[p]
        p += 1
        header_bytes = data[: p + ebml_hdr_len]

        # 2. Locate Segment
        seg_start = len(header_bytes)
        if data[seg_start : seg_start + 4] != ID_SEGMENT:
            log.warning("[WebmFixer] Segment element not found right after header")
            return data

        # Segment length is 8 bytes in MediaRecorder output (01 ff ff ff ff ff ff ff)
        orig_seg_data_start = seg_start + 12

        # 3. Locate Tracks
        tracks_pos = data.find(ID_TRACKS, orig_seg_data_start)
        if tracks_pos == -1:
            log.warning("[WebmFixer] Tracks element not found")
            return data

        # 4. Locate first Cluster
        first_cluster_pos = data.find(ID_CLUSTER, tracks_pos)
        if first_cluster_pos == -1:
            log.warning("[WebmFixer] No clusters found in WebM")
            return data

        tracks_bytes = data[tracks_pos:first_cluster_pos]

        # 5. Scan all Clusters and extract timecodes
        clusters: List[int] = []
        pos = first_cluster_pos
        data_len = len(data)

        while pos < data_len:
            idx = data.find(ID_CLUSTER, pos)
            if idx == -1:
                break
            # Validate that this is a real cluster by checking for Timecode (0xE7) right after cluster length
            tc_check = idx + 12
            if tc_check < data_len and data[tc_check : tc_check + 1] == ID_TIMECODE:
                clusters.append(idx)
            pos = idx + 4

        if not clusters:
            log.warning("[WebmFixer] No valid clusters with timecodes found")
            return data

        cluster_info: List[Dict] = []
        max_timecode = 0

        for i, c_start in enumerate(clusters):
            c_next = clusters[i + 1] if i + 1 < len(clusters) else data_len
            payload_len = c_next - (c_start + 12)
            tc_pos = c_start + 12
            tc = 0
            if data[tc_pos : tc_pos + 1] == ID_TIMECODE:
                tc_len = data[tc_pos + 1] & 0x7F
                tc = int.from_bytes(data[tc_pos + 2 : tc_pos + 2 + tc_len], "big")

            cluster_info.append({
                "orig_offset": c_start,
                "payload_len": payload_len,
                "timecode": tc,
            })
            if tc > max_timecode:
                max_timecode = tc

        # Check last cluster for any SimpleBlocks to get accurate end duration
        last_c = clusters[-1]
        c_pos_scan = last_c + 12
        last_max_rel = 0
        while c_pos_scan < data_len:
            if data[c_pos_scan : c_pos_scan + 1] == ID_SIMPLE_BLOCK:
                sp = c_pos_scan + 1
                b = data[sp]
                mask = 0x80
                l = 1
                while not (b & mask):
                    mask >>= 1
                    l += 1
                s = b & (mask - 1)
                for _ in range(l - 1):
                    sp += 1
                    s = (s << 8) | data[sp]
                sp += 1
                rel_tc = int.from_bytes(data[sp + 1 : sp + 3], "big", signed=True)
                if rel_tc > last_max_rel:
                    last_max_rel = rel_tc
                c_pos_scan = sp + s
            else:
                c_pos_scan += 1

        total_duration_ms = max_timecode + last_max_rel + 40.0  # add ~1 frame margin

        # 6. Build Info payload with Duration and TimecodeScale
        info_children = bytearray()
        info_children.extend(ID_TIMECODE_SCALE + b"\x83\x0f\x42\x40")  # 1,000,000 ns = 1ms
        info_children.extend(ID_DURATION + ebml_float(total_duration_ms))
        info_children.extend(b"\x4d\x80\x86Chrome\x57\x41\x86Chrome")
        new_info_bytes = ebml_element(ID_INFO, bytes(info_children))

        # 7. Compute SeekHead length and segment offsets
        # SeekHead contains 3 entries (Info, Tracks, Cues) with fixed 4-byte uint positions
        sh_dummy = ebml_element(
            ID_SEEK_HEAD,
            build_seek_entry(ID_INFO, 0)
            + build_seek_entry(ID_TRACKS, 0)
            + build_seek_entry(ID_CUES, 0),
        )
        sh_len = len(sh_dummy)

        info_offset = sh_len
        tracks_offset = info_offset + len(new_info_bytes)
        clusters_start_offset = tracks_offset + len(tracks_bytes)

        curr_offset = clusters_start_offset
        new_cluster_offsets: List[int] = []
        for c in cluster_info:
            new_cluster_offsets.append(curr_offset)
            curr_offset += 12 + c["payload_len"]

        cues_offset = curr_offset

        # 8. Build Cues element
        cue_points = bytearray()
        for i, c in enumerate(cluster_info):
            c_pos = new_cluster_offsets[i]
            cue_time = ID_CUE_TIME + ebml_uint(c["timecode"])
            cue_track = ID_CUE_TRACK + b"\x81\x01"  # track 1 (video)
            cue_cluster_pos = ID_CUE_CLUSTER_POS + ebml_uint(c_pos)
            cue_track_pos = ebml_element(ID_CUE_TRACK_POS, cue_track + cue_cluster_pos)
            cue_point = ebml_element(ID_CUE_POINT, cue_time + cue_track_pos)
            cue_points.extend(cue_point)

        cues_bytes = ebml_element(ID_CUES, bytes(cue_points))

        # 9. Build real SeekHead with exact offsets
        real_sh_payload = (
            build_seek_entry(ID_INFO, info_offset)
            + build_seek_entry(ID_TRACKS, tracks_offset)
            + build_seek_entry(ID_CUES, cues_offset)
        )
        real_sh = ebml_element(ID_SEEK_HEAD, real_sh_payload)

        # 10. Total Segment payload length and Segment header
        total_seg_data_len = cues_offset + len(cues_bytes)
        out_seg_header = ID_SEGMENT + ((1 << 56) | total_seg_data_len).to_bytes(8, "big")

        # 11. Assemble final seekable WebM
        out = bytearray()
        out.extend(header_bytes)
        out.extend(out_seg_header)
        out.extend(real_sh)
        out.extend(new_info_bytes)
        out.extend(tracks_bytes)

        for c in cluster_info:
            orig_c = c["orig_offset"]
            plen = c["payload_len"]
            c_hdr = ID_CLUSTER + ((1 << 56) | plen).to_bytes(8, "big")
            out.extend(c_hdr)
            out.extend(data[orig_c + 12 : orig_c + 12 + plen])

        out.extend(cues_bytes)

        log.info(
            f"[WebmFixer] Successfully patched WebM: duration={total_duration_ms:.1f}ms, "
            f"clusters={len(cluster_info)}, size={len(out)} bytes"
        )
        return bytes(out)

    except Exception as e:
        log.error(f"[WebmFixer] Failed to fix WebM stream: {e}", exc_info=True)
        return data


def fix_webm_file(file_path: str, output_path: Optional[str] = None) -> str:
    """
    Reads a WebM file from disk, patches it if not seekable, and writes it back.
    If output_path is omitted, overwrites file_path in-place safely.
    Returns the path to the fixed file.
    """
    if not os.path.exists(file_path):
        return file_path

    try:
        with open(file_path, "rb") as f:
            data = f.read()

        if is_webm_seekable(data):
            log.info(f"[WebmFixer] File {file_path} is already seekable with duration/cues.")
            return file_path

        fixed_data = fix_webm_stream(data)
        if len(fixed_data) == len(data):
            # Stream fix returned original data unchanged
            return file_path

        target = output_path or file_path
        tmp_target = target + ".tmp"
        with open(tmp_target, "wb") as f:
            f.write(fixed_data)
        os.replace(tmp_target, target)

        log.info(f"[WebmFixer] Fixed and saved seekable WebM to {target}")
        return target
    except Exception as e:
        log.error(f"[WebmFixer] Error fixing WebM file {file_path}: {e}")
        return file_path
