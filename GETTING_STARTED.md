# 🏁 Getting Started Guide - After Installation

Welcome to **Embroidery Converter**! 🧵 Here's how to get started after installing the application.

---

## ✅ Installation Verified?

After launching the app for the first time, check:

1. **Application window opens** ✓
2. **Status badge shows "Conversion engine ready"** (green) ✓
3. **Background looks normal** (no error messages) ✓

If all ✓, you're ready to go!

---

## 📥 Step 1: Get Sample Files

Before converting your own designs, test with sample files.

### Option A: Quick Start (No Download Needed)

```bash
# macOS/Linux
cd samples/
python3 generate_samples.py

# Windows
cd samples
python generate_samples.py
```

**Output:** `sample_heart.pes`, `sample_square.dst`, `sample_colorful.jef` (in `samples/` folder)

### Option B: Download Free Samples Online

Visit one of these sites and download a free design:
- 🌟 **[Emblibrary](https://www.emblibrary.com/library)** (Recommended)
- 🎨 [Embird Samples](https://www.embird.net/resources/)
- 🧵 [EmbroideryDesigns.net](https://embroiderydesigns.net/free)

**Tip:** Download in **`.pes`** or **`.dst`** format for best compatibility.

---

## 🚀 Step 2: Test Conversion

### Simple Test

1. **Drag & drop** a stitch file (`.pes`, `.dst`, `.jef`) into the app
   - You should see the file listed and a preview (if available)

2. **Select output format** from the dropdown
   - Example: Convert `PES → DST`, or `DST → JEF`

3. **Click "Convert All Files"** button
   - The app processes the conversion
   - Output file appears in the same folder as the input

4. **Verify the converted file** exists
   - Open it in another embroidery viewer (optional)

---

## 🎯 Supported Formats Reference

| Format | Extension | Use Case |
|--------|-----------|----------|
| **Tajima** | `.dst` | Most universal (works on many machines) |
| **Brother** | `.pes` | Brother embroidery machines |
| **Janome** | `.jef` | Janome and Elna machines |
| **Melco** | `.exp` | Professional embroidery machines |
| **Husqvarna** | `.vip` | Husqvarna/Viking designer machines |

**More formats?** See [samples/README.md](./samples/README.md#-supported-formats) for the complete list (50+ formats supported!).

---

## 💡 Tips for Success

### ✅ Do This
- Start with **small, simple designs** (easier to debug)
- Test **common format conversions** first (PES ↔ DST)
- Keep **file sizes small** (<5 MB for fast processing)
- Try **multiple sample files** to verify consistency

### ❌ Avoid This
- Very large files (>50 MB) – may take time
- Obscure or proprietary formats – may not convert well
- Locked/protected files – no conversion possible

---

## 🔍 Understanding Conversion

### What Gets Converted?

✅ **Stitches** – Movement and sewing commands  
✅ **Colors** – Thread colors (when supported)  
✅ **Density** – Stitch patterns and density  

❌ **Not Converted** – Licensing/DRM protection (intentional)

### Quality Expectations

- **Simple designs** → 95%+ quality preservation
- **Complex designs** → 85-95% quality (some loss of detail)
- **Color-rich designs** → Colors preserved (if target format supports it)

---

## 📚 Learn More

| Topic | Resource |
|-------|----------|
| **Format differences** | [Embroidery File Formats (Wikipedia)](https://en.wikipedia.org/wiki/Embroidery_file_format) |
| **pyembroidery library** | [GitHub: pyembroidery](https://github.com/EmbroidePy/pyembroidery) |
| **Embroidery community** | [StitchFU Forums](https://www.stitchfu.com/forums/) |
| **Free designs** | [Emblibrary Community](https://www.emblibrary.com/community) |
| **Licensing info** | [LICENSES.md](./LICENSES.md) |

---

## ⚙️ Troubleshooting

### "Conversion engine ready" shows red?
- **Problem:** Python backend not running
- **Solution:** Restart the application
- **Windows:** Restart → Check firewall settings
- **macOS:** Restart → Check security settings

### Converted file is corrupted?
- **Problem:** Format not fully compatible
- **Solution:** Try a different target format or check original file

### App crashes during conversion?
- **Problem:** File too large or unsupported format
- **Solution:** Try smaller file, update app, check logs

### Preview not showing?
- **Problem:** Format not supported for preview
- **Normal:** Some formats don't have preview capability

---

## 🎓 Advanced Usage

### Batch Conversion

1. Select **multiple files** (Ctrl+click or Cmd+click)
2. Choose **one output format**
3. Click **"Convert All Files"**
4. All files convert to that format in one batch!

### Format Compatibility

Each format has capabilities and limitations:
- Some support **unlimited colors** (PES, JEF)
- Some support **only 1 color** (DST basic)
- Some support **complex stitches** (EXP)
- Some support **only basic stitches** (VIP)

Check the format details before converting quality-critical designs.

---

## 📋 License & Attributions

This application uses:
- **pyembroidery** (MIT License) – Core conversion engine
- **Electron** (MIT License) – Desktop framework
- **Open-source tools** – See [LICENSES.md](./LICENSES.md)

All licenses respected. See [LICENSES.md](./LICENSES.md) for full details.

---

## ❓ FAQ

**Q: Can I convert `.exe` or other files?**  
A: No, only embroidery format files (`.pes`, `.dst`, etc.)

**Q: Do you keep my files?**  
A: No! All processing happens locally on your computer. No files are uploaded.

**Q: Can I convert protected designs?**  
A: No, protected files have DRM and cannot be converted for legal reasons.

**Q: How many files can I convert at once?**  
A: Unlimited! Drag as many as you want.

**Q: What about very large files?**  
A: Should work, but may take 10-30 seconds depending on file size and your computer.

---

## 🆘 Need Help?

1. **Check:** [samples/README.md](./samples/README.md) for format reference
2. **Read:** [BUILD.md](./BUILD.md) for build/installation troubleshooting
3. **Visit:** [GitHub Issues](https://github.com/andkoma/embroidery-converter/issues)
4. **Email:** andkoma@akopp.de

---

**Happy embroidering!** 🧵✨

*Last updated: August 2024*
