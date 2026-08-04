#!/usr/bin/env python3
"""
Embroidery Converter - Python backend

Uses the `pyembroidery` library to read, transform and write embroidery
stitch files. Invoked by the Electron main process as a subprocess.

Two modes:

  1. Inspect a file and return its metadata:
        convert.py inspect '<json>'
     where <json> = {"input_path": "..."}

  2. Convert a file:
        convert.py convert '<json>'
     where <json> = {
        "input_path":       "/abs/path/in.dst",
        "output_path":      "/abs/path/out.pes",
        "output_format":    "pes",
        "options": {
            "resize_width_mm":   120.0,   # optional target width  (mm)
            "resize_height_mm":  80.0,    # optional target height (mm)
            "resample_stitches": true,    # re-space stitches to keep density
            "color_limit":       15       # cap number of color blocks
        }
     }

All results are printed to stdout as a single JSON object:
    {
      "success": true/false,
      "stitch_count": int,
      "color_count": int,
      "width_mm": float,
      "height_mm": float,
      "warnings": [str, ...],
      "error": str            # only when success == false
    }

pyembroidery works in units of 1/10 mm, so 1 mm == 10 internal units.
"""

import sys
import os
import json
import math
import traceback

UNITS_PER_MM = 10.0  # pyembroidery uses 1/10 mm units


def _emit(obj):
    """Print a JSON object to stdout and exit."""
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()


def _fail(message, warnings=None):
    _emit({
        "success": False,
        "error": str(message),
        "warnings": warnings or [],
    })
    sys.exit(0)  # exit 0 so the parent parses JSON rather than a crash


def _bounds_mm(pattern):
    """Return (width_mm, height_mm) for a pattern."""
    try:
        left, top, right, bottom = pattern.bounds()
    except Exception:
        return 0.0, 0.0
    w = (right - left) / UNITS_PER_MM
    h = (bottom - top) / UNITS_PER_MM
    return round(w, 2), round(h, 2)


def _thread_list(pattern):
    """Return a list of {index, hex, description, catalog} for each thread."""
    out = []
    try:
        threads = pattern.threadlist
    except Exception:
        threads = []
    for i, t in enumerate(threads):
        try:
            color = t.get_red() << 16 | t.get_green() << 8 | t.get_blue()
            hex_color = "#%06X" % (color & 0xFFFFFF)
        except Exception:
            hex_color = "#000000"
        out.append({
            "index": i,
            "hex": hex_color,
            "description": getattr(t, "description", None) or "",
            "catalog": getattr(t, "catalog_number", None) or "",
        })
    return out


def _load(input_path):
    import pyembroidery as pe
    if not os.path.isfile(input_path):
        raise FileNotFoundError("Input file not found: %s" % input_path)
    pattern = pe.read(input_path)
    if pattern is None:
        raise ValueError("Unsupported or unreadable file: %s" % input_path)
    return pattern


def _metadata(pattern):
    w, h = _bounds_mm(pattern)
    return {
        "stitch_count": pattern.count_stitches(),
        "color_count": max(pattern.count_threads(), 1),
        "color_changes": pattern.count_color_changes(),
        "width_mm": w,
        "height_mm": h,
        "threads": _thread_list(pattern),
    }


def cmd_inspect(args):
    input_path = args.get("input_path")
    if not input_path:
        _fail("inspect requires 'input_path'")
    try:
        pattern = _load(input_path)
    except Exception as e:
        _fail(e)
    meta = _metadata(pattern)
    meta["success"] = True
    meta["warnings"] = []
    _emit(meta)


# --------------------------------------------------------------------------- #
#  Transform helpers
# --------------------------------------------------------------------------- #
def _scale_pattern(pattern, sx, sy):
    """Scale stitch coordinates about the origin by (sx, sy)."""
    import pyembroidery as pe
    scaled = pe.EmbPattern()
    # copy metadata + threads
    for t in pattern.threadlist:
        scaled.add_thread(t)
    try:
        scaled.extras.update(pattern.extras)
    except Exception:
        pass
    for x, y, cmd in pattern.stitches:
        scaled.add_stitch_absolute(cmd, x * sx, y * sy)
    return scaled


def _resample_pattern(pattern, max_stitch_len_units):
    """
    Re-space stitches so the distance between consecutive stitch points does
    not greatly exceed max_stitch_len_units. This keeps stitch *density*
    roughly constant after a resize (true resampling, not just scaling).

    Only real STITCH -> STITCH segments are subdivided; control commands
    (JUMP / TRIM / COLOR_CHANGE / STOP / END / SEQUIN ...) are preserved.
    """
    import pyembroidery as pe
    from pyembroidery import STITCH

    if max_stitch_len_units <= 0:
        return pattern

    out = pe.EmbPattern()
    for t in pattern.threadlist:
        out.add_thread(t)
    try:
        out.extras.update(pattern.extras)
    except Exception:
        pass

    prev = None  # previous (x, y, cmd)
    for x, y, cmd in pattern.stitches:
        base_cmd = cmd & 0xFF
        if prev is not None and (prev[2] & 0xFF) == STITCH and base_cmd == STITCH:
            px, py = prev[0], prev[1]
            dx, dy = x - px, y - py
            dist = math.hypot(dx, dy)
            if dist > max_stitch_len_units:
                steps = int(math.ceil(dist / max_stitch_len_units))
                for s in range(1, steps):
                    t = s / float(steps)
                    out.add_stitch_absolute(STITCH, px + dx * t, py + dy * t)
        out.add_stitch_absolute(cmd, x, y)
        prev = (x, y, cmd)
    return out


def _reduce_colors(pattern, color_limit, warnings):
    """
    Cap the number of distinct color blocks. When the pattern has more color
    changes than the target format / user allows, extra color changes are
    dropped (their stitches merge into the previous color block).
    """
    import pyembroidery as pe
    from pyembroidery import COLOR_CHANGE, NEEDLE_SET

    if color_limit is None or color_limit < 1:
        return pattern

    current_blocks = pattern.count_color_changes() + 1
    if current_blocks <= color_limit:
        return pattern

    warnings.append(
        "Color count reduced from %d to %d; extra color changes were merged."
        % (current_blocks, color_limit)
    )

    out = pe.EmbPattern()
    # keep only the first `color_limit` threads
    for i, t in enumerate(pattern.threadlist):
        if i < color_limit:
            out.add_thread(t)
    try:
        out.extras.update(pattern.extras)
    except Exception:
        pass

    blocks_used = 1
    for x, y, cmd in pattern.stitches:
        base = cmd & 0xFF
        if base in (COLOR_CHANGE, NEEDLE_SET):
            if blocks_used >= color_limit:
                # skip this color change -> merge into previous block
                continue
            blocks_used += 1
        out.add_stitch_absolute(cmd, x, y)
    return out


def cmd_convert(args):
    warnings = []
    input_path = args.get("input_path")
    output_path = args.get("output_path")
    output_format = (args.get("output_format") or "").lower().lstrip(".")
    options = args.get("options") or {}

    if not input_path:
        _fail("convert requires 'input_path'")
    if not output_path:
        _fail("convert requires 'output_path'")

    try:
        import pyembroidery as pe
    except Exception as e:
        _fail("pyembroidery is not installed: %s" % e)

    # Validate the target format is writable.
    writable = {f["extension"] for f in pe.supported_formats() if f.get("writer")}
    if output_format and output_format not in writable:
        _fail(
            "Output format '.%s' is not writable by pyembroidery. "
            "Writable formats: %s" % (output_format, ", ".join(sorted(writable)))
        )

    try:
        pattern = _load(input_path)
    except Exception as e:
        _fail(e)

    orig_w, orig_h = _bounds_mm(pattern)

    # ----- Resize (+ optional resampling) --------------------------------- #
    target_w = options.get("resize_width_mm")
    target_h = options.get("resize_height_mm")
    resample = bool(options.get("resample_stitches"))

    if (target_w or target_h) and (orig_w > 0 and orig_h > 0):
        sx = (float(target_w) / orig_w) if target_w else None
        sy = (float(target_h) / orig_h) if target_h else None
        # if only one dimension given, keep aspect ratio
        if sx is None:
            sx = sy
        if sy is None:
            sy = sx

        # Determine a reasonable target stitch length BEFORE scaling so we can
        # keep density constant. Use the median-ish average segment length.
        avg_len_units = _avg_segment_length(pattern)

        pattern = _scale_pattern(pattern, sx, sy)

        if resample:
            # After scaling, the average stitch length grew by roughly the
            # scale factor. Resample back toward the original density.
            target_len = avg_len_units if avg_len_units > 0 else 30.0
            before = pattern.count_stitches()
            pattern = _resample_pattern(pattern, target_len)
            after = pattern.count_stitches()
            warnings.append(
                "Resampled stitches to preserve density (%d -> %d stitches)."
                % (before, after)
            )
        else:
            warnings.append(
                "Pattern scaled by (%.3f, %.3f) without stitch resampling."
                % (sx, sy)
            )

    # ----- Color reduction ------------------------------------------------ #
    color_limit = options.get("color_limit")
    if color_limit is not None:
        try:
            color_limit = int(color_limit)
            pattern = _reduce_colors(pattern, color_limit, warnings)
        except (TypeError, ValueError):
            warnings.append("Ignored invalid color_limit: %r" % color_limit)

    # ----- Write out ------------------------------------------------------ #
    try:
        settings = {}
        if output_format:
            pe.write(pattern, output_path, settings)
        else:
            pattern.write(output_path)
    except Exception as e:
        _fail("Failed to write '%s': %s" % (output_path, e), warnings)

    if not os.path.isfile(output_path):
        _fail("Conversion produced no output file.", warnings)

    final_w, final_h = _bounds_mm(pattern)
    _emit({
        "success": True,
        "stitch_count": pattern.count_stitches(),
        "color_count": max(pattern.count_threads(), 1),
        "width_mm": final_w,
        "height_mm": final_h,
        "output_path": output_path,
        "warnings": warnings,
    })


def _avg_segment_length(pattern):
    """Average distance between consecutive real STITCH points (units)."""
    from pyembroidery import STITCH
    total = 0.0
    count = 0
    prev = None
    for x, y, cmd in pattern.stitches:
        base = cmd & 0xFF
        if prev is not None and (prev[2] & 0xFF) == STITCH and base == STITCH:
            total += math.hypot(x - prev[0], y - prev[1])
            count += 1
        prev = (x, y, cmd)
    if count == 0:
        return 0.0
    return total / count


def cmd_formats(_args):
    """List supported formats and their read/write capability."""
    import pyembroidery as pe
    formats = []
    for f in pe.supported_formats():
        formats.append({
            "extension": f.get("extension"),
            "description": f.get("description"),
            "read": bool(f.get("reader")),
            "write": bool(f.get("writer")),
        })
    _emit({"success": True, "formats": formats, "warnings": []})


def main():
    if len(sys.argv) < 2:
        _fail("Usage: convert.py <inspect|convert|formats> '<json args>'")

    command = sys.argv[1]
    raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
    try:
        args = json.loads(raw)
    except Exception as e:
        _fail("Invalid JSON arguments: %s" % e)

    try:
        if command == "inspect":
            cmd_inspect(args)
        elif command == "convert":
            cmd_convert(args)
        elif command == "formats":
            cmd_formats(args)
        else:
            _fail("Unknown command: %s" % command)
    except SystemExit:
        raise
    except Exception as e:
        _fail("%s\n%s" % (e, traceback.format_exc()))


if __name__ == "__main__":
    main()
