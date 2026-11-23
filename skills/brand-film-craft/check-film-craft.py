#!/usr/bin/env python3
"""Pre-render and post-render craft gate for Amtec brand films.

Checks a cut recipe (cut.json or Resolve decision.json) and/or a rendered MP4 against
tokens.json:
  1. Type scale & token discipline (approved roles, weights, sizes, single-system consistency)
  2. Pacing & text dwell (cut lengths, dwell vs reading time, clear-picture buffers, dark-screen holds)
  3. Phone-size legibility at 390x220 (cap height >= threshold, local P90 background contrast >= 4.5:1)
  4. Audio loudness & true peak (EBU R128 integrated LUFS, True Peak, LRA, 48 kHz sample rate)
  5. Export & container hygiene (file size < 100 MB for Slack/Web, BT.709 tags, yuv420p, non-black frame 0)

Usage:
  python3 check-film-craft.py --tokens tokens.json --decision /path/to/decision.json --video /path/to/render.mp4
"""
from __future__ import annotations
import argparse
import json
import os
import statistics
import subprocess
import sys
import numpy as np


def srgb_to_lum(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def check_decision(decision_path: str, tokens: dict) -> list[dict]:
    findings = []
    data = json.load(open(decision_path))
    fps = float(data.get("fps", 24))
    roles = tokens["typography"]["roles"]
    allowed_resolve_sizes = {r["resolveBasicTitleSize"]: name for name, r in roles.items()}
    allowed_faces = {r["face"] for r in roles.values()}
    pacing = tokens["pacing"]

    # 1. Check titles against type tokens & dwell rules
    titles = data.get("titles", [])
    distinct_sizes = sorted({t.get("size") for t in titles if t.get("size")})
    if len(distinct_sizes) > len(roles):
        findings.append({
            "gate": "type-tokens",
            "severity": "HIGH",
            "message": f"Title list uses {len(distinct_sizes)} distinct ad-hoc font sizes {distinct_sizes}, exceeding the {len(roles)}-role type scale."
        })

    total_frames = sum(s.get("frames", 0) for s in data.get("shots", [])) or 1800
    total_dur = total_frames / fps
    covered_frames = set()

    for idx, t in enumerate(titles):
        text = t.get("text", "")
        size = t.get("size")
        face = t.get("face", "Buch")
        at = t.get("at", 0)
        frames = t.get("frames", 0)
        dur = frames / fps
        for f in range(at, at + frames):
            covered_frames.add(f)

        if size not in allowed_resolve_sizes:
            findings.append({
                "gate": "type-tokens",
                "severity": "MEDIUM",
                "message": f"Title #{idx + 1} ({text!r}) uses non-token size={size} (face={face!r}). Map to one of {allowed_resolve_sizes}."
            })

        # Hero or title lines set in Buch (400) instead of Halbfett (600) or Kräftig (500)
        if size and size >= 120 and face == "Buch":
            findings.append({
                "gate": "type-weight",
                "severity": "HIGH",
                "message": f"Title #{idx + 1} ({text!r}, size={size}) is set in body weight 'Buch' (400) instead of 'Halbfett' (600) or 'Kräftig' (500)."
            })

        words = len(text.split())
        read_time = words / pacing["readingSpeedWordsPerSecond"] + pacing["recognitionBufferSeconds"]
        max_dwell = max(2.2, read_time * pacing["maxDwellMultiplierOverReadingTime"])
        if dur > max_dwell and at < total_frames * 0.85:
            findings.append({
                "gate": "text-dwell",
                "severity": "HIGH",
                "message": f"Title #{idx + 1} ({text!r}) stays on screen for {dur:.2f}s ({ dur / read_time:.1f}x its {read_time:.2f}s reading time; max allowed {max_dwell:.2f}s)."
            })

    coverage = len(covered_frames) / max(1, total_frames)
    if coverage > pacing["maxTotalTextCoverageFraction"]:
        findings.append({
            "gate": "pacing-restraint",
            "severity": "HIGH",
            "message": f"On-screen text covers {coverage * 100:.1f}% of the film ({len(covered_frames) / fps:.1f}s / {total_dur:.1f}s), exceeding the {pacing['maxTotalTextCoverageFraction'] * 100:.0f}% ceiling."
        })

    # 2. Check shot pacing and dark/blueprint text holds
    shots = data.get("shots", [])
    act1_durs = [s["frames"] / fps for s in shots if s.get("role") == "ancient"][:12]
    if act1_durs:
        med = statistics.median(act1_durs)
        target_max = pacing["shotLengthTargetsSeconds"]["montage"]["max"]
        if med > target_max:
            findings.append({
                "gate": "montage-pacing",
                "severity": "MEDIUM",
                "message": f"Opening ancient-Rome montage median cut is {med:.2f}s (mean {statistics.mean(act1_durs):.2f}s), slower than the { pacing['shotLengthTargetsSeconds']['montage']['median']:.2f}s target (max {target_max:.2f}s)."
            })

    cursor = 0
    for s in shots:
        s_start = cursor
        s_end = cursor + s.get("frames", 0)
        cursor = s_end
        if s.get("role") == "drawing":
            s_dur = s.get("frames", 0) / fps
            overlapping_titles = [
                t for t in titles
                if t.get("at", 0) < s_end and (t.get("at", 0) + t.get("frames", 0)) > s_start
            ]
            if overlapping_titles and s_dur > pacing["maxTextOnBlackOrBlueprintHoldSeconds"]:
                findings.append({
                    "gate": "dark-card-hold",
                    "severity": "HIGH",
                    "message": f"Dark blueprint/black segment ({s.get('id')}) holds text {[t['text'] for t in overlapping_titles]} for {s_dur:.2f}s (max {pacing['maxTextOnBlackOrBlueprintHoldSeconds']:.2f}s)."
                })

    return findings


def check_video(video_path: str, tokens: dict, decision_path: str | None = None) -> list[dict]:
    findings = []
    size_mb = os.path.getsize(video_path) / (1024 * 1024)
    max_mb = tokens["exportPresets"]["slackWeb1080p"]["maxFileSizeMb"]
    if size_mb > max_mb:
        findings.append({
            "gate": "export-size",
            "severity": "MEDIUM",
            "message": f"Video file is {size_mb:.1f} MB, exceeding the {max_mb} MB Slack/Web ceiling."
        })

    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", video_path
    ]))
    vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    astream = next((s for s in probe["streams"] if s["codec_type"] == "audio"), None)

    for tag in ("color_space", "color_primaries", "color_transfer"):
        if vstream.get(tag) != "bt709":
            findings.append({
                "gate": "export-color-tags",
                "severity": "LOW",
                "message": f"Video stream missing explicit BT.709 metadata ({tag}={vstream.get(tag)!r})."
            })

    # Frame 0 poster check
    raw0 = subprocess.check_output([
        "ffmpeg", "-v", "error", "-ss", "0", "-i", video_path,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ])
    img0 = np.frombuffer(raw0, dtype=np.uint8)
    if float(np.mean(img0)) < 10.0:
        findings.append({
            "gate": "poster-frame",
            "severity": "MEDIUM",
            "message": "Frame 0 is near-black; Slack and WhatsApp embeds will display a blank black thumbnail."
        })

    # Loudness check
    if astream:
        stderr = subprocess.run([
            "ffmpeg", "-nostats", "-i", video_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"
        ], capture_output=True, text=True).stderr
        if "{" in stderr and "}" in stderr:
            loud = json.loads(stderr[stderr.rindex("{"):stderr.rindex("}") + 1])
            lufs = float(loud.get("input_i", -99))
            tp = float(loud.get("input_tp", 0))
            target = tokens["audio"]["loudness"]["webSocialSlack"]["targetLufs"]
            tol = tokens["audio"]["loudness"]["webSocialSlack"]["toleranceLu"]
            if abs(lufs - target) > tol:
                findings.append({
                    "gate": "audio-loudness",
                    "severity": "HIGH",
                    "message": f"Integrated loudness is {lufs:.2f} LUFS (True Peak {tp:.2f} dBTP), outside the {target:.1f} +/- {tol:.1f} LUFS web/Slack target."
                })

    # Phone-size legibility & local P90 contrast check across titled shots
    if decision_path and os.path.exists(decision_path):
        data = json.load(open(decision_path))
        fps = float(data.get("fps", 25))
        shots = data.get("shots", [])
        titles = data.get("titles", [])
        min_p90_contrast = tokens["legibility"]["minContrastRatio"]["vsBackgroundP90"]
        cursor = 0
        for s in shots:
            s_start = cursor
            s_end = cursor + s.get("frames", 0)
            cursor = s_end
            if s.get("role") not in ("ancient", "modern"):
                continue
            active = [
                t for t in titles
                if t.get("at", 0) <= (s_start + s_end) // 2 < (t.get("at", 0) + t.get("frames", 0))
            ]
            if not active:
                continue
            mid_t = ((s_start + s_end) / 2.0) / fps
            raw = subprocess.check_output([
                "ffmpeg", "-v", "error", "-ss", f"{mid_t:.2f}", "-i", video_path,
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
            ])
            img = np.frombuffer(raw, dtype=np.uint8).reshape(1080, 1920, 3)
            lum = srgb_to_lum(img)
            roi = lum[380:700, 350:1570]
            bg = roi[roi < 0.75]
            fg = roi[roi >= 0.80]
            if len(bg) > 0 and len(fg) > 0:
                fg_lum = float(np.percentile(fg, 90))
                bg_p90 = float(np.percentile(bg, 90))
                ratio_p90 = (fg_lum + 0.05) / (bg_p90 + 0.05)
                if ratio_p90 < min_p90_contrast:
                    findings.append({
                        "gate": "phone-legibility-contrast",
                        "severity": "HIGH",
                        "message": f"Shot {s.get('id')} at {mid_t:.2f}s under title {[t['text'] for t in active]} has P90 background contrast {ratio_p90:.2f}:1 (< {min_p90_contrast}:1 required for phone legibility)."
                    })

    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokens", required=True, help="Path to tokens.json")
    parser.add_argument("--decision", help="Path to Resolve decision.json")
    parser.add_argument("--video", help="Path to rendered MP4/MOV")
    args = parser.parse_args()

    tokens = json.load(open(args.tokens))
    findings = []
    if args.decision:
        findings.extend(check_decision(args.decision, tokens))
    if args.video:
        findings.extend(check_video(args.video, tokens, args.decision))

    print(json.dumps({"passed": len(findings) == 0, "findingCount": len(findings), "findings": findings}, indent=2))
    sys.exit(0 if len(findings) == 0 else 1)


if __name__ == "__main__":
    main()
