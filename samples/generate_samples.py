#!/usr/bin/env python3
"""
Generate sample embroidery files for testing Embroidery Converter.

This script creates minimal test files in various embroidery formats.
Requires: pyembroidery (installed via pip)

Usage:
    python generate_samples.py
"""

import sys
import os

# Try to import pyembroidery
try:
    import pyembroidery
except ImportError:
    print("❌ Error: pyembroidery not installed")
    print("\nTo install, run:")
    print("  pip install pyembroidery")
    print("\nOr in macOS:")
    print("  pip3 install pyembroidery")
    sys.exit(1)


def create_simple_pattern():
    """Create a simple heart-shaped pattern."""
    pattern = pyembroidery.EmbPattern()
    
    # Set thread color (red)
    pattern.add_thread(
        pyembroidery.EmbThread(0xFF0000, description="Red")
    )
    
    # Simple heart outline using bezier curves
    # Heart shape: simple version
    points = [
        # Top left curve
        (50, 100),
        (50, 80),
        (40, 60),
        (30, 60),
        (20, 70),
        (20, 85),
        # Bottom left curve
        (20, 95),
        (35, 110),
        (50, 125),
        # Bottom right curve
        (65, 110),
        (80, 95),
        (80, 85),
        (80, 70),
        (70, 60),
        (60, 60),
        (50, 80),
        # Back to start
        (50, 100),
    ]
    
    # Jump to start
    pattern.move_abs(points[0][0], points[0][1])
    
    # Draw the pattern
    for x, y in points[1:]:
        pattern.sew_abs(x, y)
    
    # End pattern
    pattern.end()
    
    return pattern


def create_simple_square():
    """Create a simple square pattern."""
    pattern = pyembroidery.EmbPattern()
    
    # Set thread color (blue)
    pattern.add_thread(
        pyembroidery.EmbThread(0x0000FF, description="Blue")
    )
    
    # Square pattern
    square_points = [
        (20, 20),
        (80, 20),
        (80, 80),
        (20, 80),
        (20, 20),
    ]
    
    # Jump to start
    pattern.move_abs(square_points[0][0], square_points[0][1])
    
    # Draw square
    for x, y in square_points[1:]:
        pattern.sew_abs(x, y)
    
    # End pattern
    pattern.end()
    
    return pattern


def create_colorful_pattern():
    """Create a multi-color pattern."""
    pattern = pyembroidery.EmbPattern()
    
    # Add multiple thread colors
    colors = [
        (0xFF0000, "Red"),
        (0x00FF00, "Green"),
        (0x0000FF, "Blue"),
        (0xFFFF00, "Yellow"),
    ]
    
    for color_hex, name in colors:
        pattern.add_thread(pyembroidery.EmbThread(color_hex, description=name))
    
    # Create a simple pattern with color changes
    size = 30
    
    for i, (color_hex, _) in enumerate(colors):
        # Move to new position
        x = 20 + (i % 2) * size
        y = 20 + (i // 2) * size
        
        pattern.move_abs(x, y)
        
        # Draw small square with current color
        pattern.sew_abs(x + size, y)
        pattern.sew_abs(x + size, y + size)
        pattern.sew_abs(x, y + size)
        pattern.sew_abs(x, y)
    
    # End pattern
    pattern.end()
    
    return pattern


def save_samples(output_dir="."):
    """Save sample files to disk."""
    
    print("🧵 Generating sample embroidery files...\n")
    
    samples = [
        {
            "name": "sample_heart",
            "pattern": create_simple_pattern(),
            "formats": ["pes", "dst", "jef", "exp", "vip"]
        },
        {
            "name": "sample_square",
            "pattern": create_simple_square(),
            "formats": ["pes", "dst", "jef", "exp"]
        },
        {
            "name": "sample_colorful",
            "pattern": create_colorful_pattern(),
            "formats": ["pes", "dst", "jef"]
        },
    ]
    
    created_files = []
    
    for sample in samples:
        name = sample["name"]
        pattern = sample["pattern"]
        formats = sample["formats"]
        
        print(f"📝 {name}:")
        
        for fmt in formats:
            try:
                filename = os.path.join(output_dir, f"{name}.{fmt}")
                pyembroidery.write_eme(filename, pattern)
                pyembroidery.write(filename, pattern)
                file_size = os.path.getsize(filename)
                print(f"  ✅ {fmt.upper():5} → {os.path.basename(filename)} ({file_size} bytes)")
                created_files.append(filename)
            except Exception as e:
                print(f"  ❌ {fmt.upper():5} → Error: {e}")
    
    print(f"\n✨ Created {len(created_files)} sample files!")
    print(f"\n📁 Location: {os.path.abspath(output_dir)}/")
    
    print("\n🚀 Next steps:")
    print("1. Open Embroidery Converter")
    print("2. Drag & drop one of these sample files")
    print("3. Select a different format")
    print("4. Click 'Convert All Files'")
    print("5. Verify the converted file!")


if __name__ == "__main__":
    # Use samples directory if available, otherwise current directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = script_dir if os.path.basename(script_dir) == "samples" else "."
    
    try:
        save_samples(output_dir)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
