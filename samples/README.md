# 📂 Sample Embroidery Files

This directory contains sample embroidery files for testing the **Embroidery Converter** application.

---

## 🎯 Purpose

After installing the app, new users can:
1. Test conversion between different formats
2. Verify the application works correctly
3. Explore various embroidery stitch formats

---

## 📥 How to Get Sample Files

### Option 1: Free Online Resources (Recommended)

| Source | URL | Formats | Free? |
|--------|-----|---------|-------|
| **Emblibrary** | https://www.emblibrary.com/library | PES, DST, JEF, EXP, VIP | ✅ (Free & Premium) |
| **Embird Samples** | https://www.embird.net/resources/ | PES, DST, JEF, EXP | ✅ |
| **EmbroideryDesigns.net** | https://embroiderydesigns.net/free | DST, PES, JEF | ✅ |
| **Cute Embroidery** | https://cuteembroidery.com | PES, DST, EXP, JEF | ✅ (Free section) |
| **Taunton Emporium** | https://www.taunton.com/emporium | Various | ✅ Mixed |

### Option 2: Generate Samples with pyembroidery (Advanced)

If you have Python 3 installed, generate minimal test files:

```bash
# Install pyembroidery
pip install pyembroidery

# Run the sample generator script
python generate_samples.py
```

See [generate_samples.py](./generate_samples.py) in this directory.

---

## 📋 Supported Formats

The Embroidery Converter supports **50+ embroidery formats**:

### 🥇 Most Common (Start with these)

| Format | Extension | Machine Type | Best For |
|--------|-----------|--------------|----------|
| **Tajima** | `.dst` | Tajima & Many | Widely compatible |
| **Brother** | `.pes` | Brother machines | Beginner-friendly |
| **Janome** | `.jef` | Janome machines | Common home machines |
| **Melco** | `.exp` | Melco machines | Professional use |
| **Husqvarna** | `.vip` | Husqvarna machines | Designer embroidery |

### 🥈 Also Supported

Bernina, Pfaff, Singer, Viking, Toyota, Barudan, Bits & Volts, Elna, Fortron, Mitsubishi, Janome, Juki, Sunstar, Toyota, ZSK, and many more!

### Full List

See `scripts/vendor/pyembroidery/` for all supported readers/writers.

---

## 🚀 Quick Test Workflow

### Step 1: Download a Sample
1. Visit [Emblibrary](https://www.emblibrary.com/library)
2. Search for a simple design (e.g., "heart", "star")
3. Download in **.pes** format

### Step 2: Launch Embroidery Converter
- Open the installed application
- Check that **"Conversion engine ready"** shows (green status)

### Step 3: Test Conversion
1. **Drag & drop** the `.pes` file into the app
2. **Select output format** (e.g., DST, JEF, EXP)
3. Click **"Convert All Files"**
4. Verify the output file was created

### Step 4: Verify Quality
- Open the converted file in an embroidery viewer
- Check if stitches and colors are preserved
- Try uploading to an embroidery machine (if you have one)

---

## 💡 Tips for Choosing Samples

### For Basic Testing
✅ Start with **simple designs** (5-10 stitches)  
✅ Small file size (~1-5 KB)  
✅ Common formats (PES, DST, JEF)

### For Advanced Testing
✨ Complex designs with many stitches  
✨ Color information  
✨ Multiple file formats for cross-conversion

### Avoid (for initial testing)
❌ Huge files (>10 MB) – slower conversion  
❌ Obscure formats – may not convert perfectly  
❌ Proprietary locked formats

---

## 🐍 Generate Sample Files (Python)

For developers and advanced users, use [generate_samples.py](./generate_samples.py):

```bash
# Create minimal test files
python generate_samples.py

# This creates sample files in common formats:
# - sample_simple.pes
# - sample_simple.dst
# - sample_simple.jef
# - sample_simple.exp
# - sample_simple.vip
```

---

## 📝 File Format Reference

### What's an Embroidery File?

Embroidery files contain:
- **Stitch commands** (move, sew, jump, etc.)
- **Thread colors** (RGB or machine-specific)
- **Metadata** (author, copyright, etc.)
- **Stitch density** and pattern information

Each format has different specifications and capabilities.

### Example: Minimal Stitch Pattern

```
Stitch 1: Jump (0, 0)        → Move needle to start
Stitch 2: Sew (10, 0)        → Sew 10 pixels right
Stitch 3: Sew (10, 10)       → Sew 10 pixels down
Stitch 4: Sew (0, 10)        → Sew 10 pixels left
Stitch 5: Sew (0, 0)         → Close shape
Stitch 6: End (0, 0)         → End pattern
```

---

## 🎨 Color Information

Most embroidery formats support colors:
- **Thread tables** – Predefined machine colors
- **RGB values** – Custom thread colors
- **Manufacturer palettes** – Brand-specific colors

The converter preserves color information when converting between formats.

---

## ⚙️ Troubleshooting

### Sample file won't convert?
- **Issue:** File might be corrupted or unsupported
- **Solution:** Try a different sample from a trusted source

### Converted file looks wrong?
- **Issue:** Format may not support certain features (e.g., variable stitch widths)
- **Solution:** Try converting to a different format

### No sample files appear?
- **Issue:** Python generator not installed
- **Solution:** Download files manually from Emblibrary or other sources

---

## 📚 Learning Resources

- **Embroidery File Formats:** https://en.wikipedia.org/wiki/Embroidery_file_format
- **pyembroidery Docs:** https://github.com/EmbroidePy/pyembroidery
- **Emblibrary Community:** https://www.emblibrary.com/community
- **Embroidery Forums:** https://www.stitchfu.com/forums/

---

## ✅ Sample Files Checklist

After downloading samples, verify:
- ✅ Files have correct extension (`.pes`, `.dst`, etc.)
- ✅ File size is reasonable (~1-100 KB)
- ✅ Can open in another embroidery viewer (optional)
- ✅ Ready to test with Embroidery Converter!

---

**Happy stitching!** 🧵✨
