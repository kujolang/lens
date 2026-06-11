#!/usr/bin/env python3
"""Lens visual diff tool — pixel-level screenshot comparison.

Usage:
  python3 visual-diff.py <current.png> <baseline.png> [--threshold 0.01] [--diff-output diff.png] [--json]

Output: JSON with comparison results.
"""
import json
import sys
import os

def compare_images(current_path, baseline_path, threshold=0.01, diff_output=None):
    """Compare two images pixel by pixel. Returns a result dict."""
    result = {
        "status": "error",
        "difference_ratio": 1.0,
        "threshold": threshold,
        "changed_pixels": 0,
        "total_pixels": 0,
        "dimensions_match": False,
        "current_dimensions": None,
        "baseline_dimensions": None,
        "error": ""
    }

    # Check files exist
    if not os.path.exists(current_path):
        result["error"] = f"Current screenshot not found: {current_path}"
        return result
    if not os.path.exists(baseline_path):
        result["error"] = f"Baseline not found: {baseline_path}"
        result["status"] = "missing_baseline"
        return result

    try:
        from PIL import Image
        import numpy as np

        current = Image.open(current_path).convert("RGB")
        baseline = Image.open(baseline_path).convert("RGB")

        result["current_dimensions"] = list(current.size)
        result["baseline_dimensions"] = list(baseline.size)
        result["dimensions_match"] = current.size == baseline.size

        if not result["dimensions_match"]:
            result["status"] = "dimension_mismatch"
            result["error"] = f"Dimension mismatch: current {current.size} vs baseline {baseline.size}"
            return result

        # Convert to numpy arrays for fast comparison
        curr_arr = np.array(current)
        base_arr = np.array(baseline)

        total_pixels = curr_arr.size // 3  # RGB channels
        result["total_pixels"] = int(total_pixels)

        # Count changed pixels
        diff = np.abs(curr_arr.astype(int) - base_arr.astype(int))
        # A pixel is "changed" if any channel differs significantly
        changed = np.any(diff > 10, axis=2)  # threshold of 10 per channel
        changed_pixels = int(np.sum(changed))
        result["changed_pixels"] = changed_pixels

        difference_ratio = changed_pixels / total_pixels if total_pixels > 0 else 0
        result["difference_ratio"] = round(difference_ratio, 6)

        if difference_ratio <= threshold:
            result["status"] = "pass"
        else:
            result["status"] = "fail"

        # Generate diff image if requested
        if diff_output and changed_pixels > 0:
            # Create a diff highlight image
            diff_img = Image.new("RGB", current.size, (0, 0, 0))
            diff_arr = np.array(diff_img)
            # Mark changed pixels in red
            diff_arr[changed] = [255, 0, 0]
            # Overlay with dimmed current image for context
            dimmed = (curr_arr * 0.5).astype(np.uint8)
            combined = np.where(changed[..., None], diff_arr, dimmed)
            result_img = Image.fromarray(combined)
            os.makedirs(os.path.dirname(diff_output) or ".", exist_ok=True)
            result_img.save(diff_output)
            result["diff_path"] = diff_output

    except ImportError as e:
        result["error"] = f"Missing dependency: {e}. Install Pillow and numpy."
    except Exception as e:
        result["error"] = str(e)

    return result


if __name__ == "__main__":
    args = sys.argv[1:]

    current_path = None
    baseline_path = None
    threshold = 0.01
    diff_output = None
    output_json = False

    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--threshold" and i + 1 < len(args):
            threshold = float(args[i + 1])
            i += 2
        elif arg == "--diff-output" and i + 1 < len(args):
            diff_output = args[i + 1]
            i += 2
        elif arg == "--json":
            output_json = True
            i += 1
        elif not arg.startswith("--") and current_path is None:
            current_path = arg
            i += 1
        elif not arg.startswith("--") and baseline_path is None:
            baseline_path = arg
            i += 1
        else:
            i += 1

    if not current_path or not baseline_path:
        result = {"status": "error", "error": "Usage: visual-diff.py <current> <baseline> [--threshold 0.01] [--diff-output diff.png] [--json]"}
    else:
        result = compare_images(current_path, baseline_path, threshold, diff_output)

    if output_json:
        print(json.dumps(result))
    else:
        print(result["status"])
