# 🚀 Automated Builds with GitHub Actions

This project uses **GitHub Actions** to automatically build and release installers for Windows and macOS.

---

## ✨ Features

- ✅ **Automatic builds** on every release tag
- ✅ **Multi-platform** – Windows & macOS (x64 + arm64)
- ✅ **Code signing** support (macOS with certificate)
- ✅ **Artifact storage** – Download from Actions tab
- ✅ **Release automation** – Auto-create GitHub Release with installers

---

## 📋 How It Works

### 1. **Workflow Definition**
File: `.github/workflows/build.yml`

**Triggers:**
- Push a version tag: `git tag v1.0.1 && git push --tags`
- Manual trigger: GitHub Actions tab → "Run workflow"

### 2. **Build Matrix**

| Platform | Architecture | Runner | Status |
|----------|--------------|--------|--------|
| macOS | arm64, x64 | `macos-latest` | ✅ Ready |
| Windows | x64 | `windows-latest` | ✅ Ready |

### 3. **What Happens**

For **each matrix combination**:
1. Checkout code
2. Setup Node.js 18 + Python 3.9
3. Install npm dependencies
4. Install PyInstaller
5. Bundle Python backend (`npm run python:bundle`)
6. Build installer:
   - Windows: NSIS `.exe`
   - macOS: DMG `.dmg`
7. Upload artifact (30-day retention)

### 4. **Release Creation**
After all builds complete, if triggered by a **version tag**:
- Create GitHub Release
- Attach all installers
- Auto-publish

---

## 🎯 Quick Start

### Trigger a Manual Build

1. Go to GitHub repo → **Actions** tab
2. Select **"🏗️ Build & Release"**
3. Click **"Run workflow"** → **"Run workflow"** (blue button)
4. Wait ~10-15 minutes
5. Download artifacts from the workflow run

### Trigger a Release Build

```bash
# Create a version tag
git tag v1.0.1
git push --tags
```

Then:
1. GitHub Actions automatically builds all platforms
2. Creates a Release in the Releases tab
3. Installers appear as release assets

---

## 📥 Download Installers

### From Actions Tab (Temporary)
1. Repo → **Actions**
2. Click latest run
3. **Artifacts** section
4. Download `embroidery-converter-windows` or `embroidery-converter-macos-*`

### From Releases Tab (Permanent)
1. Repo → **Releases**
2. Latest release
3. Download `.exe` or `.dmg`

---

## 🔧 Configuration

### Environment Secrets (Optional)

For **automatic macOS code signing**, configure in **Settings → Secrets and variables → Actions**:

```
APPLE_ID              your-apple-id@example.com
APPLE_PASSWORD        your-app-specific-password (or app password)
APPLE_TEAM_ID         XXXXXXXXXX (from Apple Developer)
```

**Without these:** macOS builds still work, but app won't be code-signed (warning on first launch).

### Customize Build Artifacts

Edit `.github/workflows/build.yml`:

```yaml
- name: Upload macOS artifact
  uses: actions/upload-artifact@v4
  with:
    name: embroidery-converter-macos-${{ matrix.arch }}
    path: release/*.dmg
    retention-days: 30  # ← Change retention here
```

---

## 🐛 Troubleshooting

### Build fails: "Python not found"
- GitHub runners have Python 3.9+ pre-installed
- If missing: Add `actions/setup-python@v4` step (already in workflow)

### Build fails: "npm ERR! 404 Not Found"
- Node modules version conflict
- Solution: Delete `node_modules/`, let GitHub install fresh

### macOS build slower than Windows
- Normal: macOS arm64 build takes longer
- Typical macOS time: 8-12 minutes
- Typical Windows time: 5-8 minutes

### Can't download artifacts
- Artifacts expire after 30 days (configurable)
- For permanent storage, use GitHub Releases (triggered by tags)

---

## 📊 Build Status Badge

Add this to your README.md to show build status:

```markdown
[![Build & Release](https://github.com/andkoma/embroidery-converter/actions/workflows/build.yml/badge.svg)](https://github.com/andkoma/embroidery-converter/actions/workflows/build.yml)
```

---

## 📚 Next Steps

1. **Test locally first:** `npm run build:mac` or `npm run build:win`
2. **Push a tag:** Triggers automated build
3. **Monitor Actions tab:** Watch the build progress
4. **Download & verify:** Test on Windows/macOS
5. **Create Release:** GitHub auto-publishes to Releases tab

---

## 🔗 Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Electron Builder Docs](https://www.electron.build/)
- [PyInstaller Documentation](https://pyinstaller.org/)
- [Electron Code Signing](https://www.electron.build/code-signing)
