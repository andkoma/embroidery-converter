# 🔐 macOS Gatekeeper Issue - Root Cause & Solution

## Problem

App displayed "beschädigte Software" (corrupted software) dialog on both arm64 and x64 macOS instead of launching normally.

## Root Cause Analysis

The issue was in **`package.json` build configuration**:

```json
// ❌ WRONG (was causing the issue)
"afterPack": "scripts/afterSign.js",    // ← Called at wrong time
"afterSign": null,                      // ← Hook disabled!
"mac": {
  "hardenedRuntime": false,             // ← Not strict enough
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist"
}
```

**Why this failed:**

1. **`afterSign: null`** meant the signing hook was DISABLED
2. **`afterPack`** called the script at the WRONG TIME (before signing, not after)
3. Result: Code-signed app had **NO entitlements** embedded in signature
4. macOS Gatekeeper rejected it as "corrupted" because signature was incomplete

## Solution Implemented

### 1. Fixed `package.json` Configuration

```json
// ✅ CORRECT (electron-builder schema)
"mac": {
  "target": ["dmg"],
  "afterSign": "scripts/afterSign.js",  // ← In mac section (platform-specific hook)
  "hardenedRuntime": true,              // ← Runtime security enabled
  "gatekeeperAssess": false,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "signingIdentity": "-"                // ← Explicit ad-hoc signing
}
```

**Key Changes:**
- `afterSign` in **`mac` section** (electron-builder macOS-specific hook)
- `hardenedRuntime: true` → enables runtime security features
- `signingIdentity: "-"` → explicitly enables ad-hoc signing
- Windows/Linux builds nicht beeinträchtigt (afterSign nur auf macOS aktiv)

**Why this works:**
- electron-builder defines `afterSign` als macOS-spezifischen Hook
- Hook wird NUR während macOS-Builds aufgerufen
- Windows und Linux bauen ohne Fehler

### 2. Enhanced `scripts/afterSign.js`

Since `afterSign` is now in the `mac` section, the script:
- Is **only called during macOS builds** (electron-builder guarantee)
- Still checks `process.platform !== 'darwin'` as defensive programming
- Correctly identifies `context.electronApp` (afterSign hook parameter)
- Applies ad-hoc signature with `--strict --options=runtime` flags
- Embeds entitlements in the code signature
- Verifies signature after creation
- Provides detailed logging for CI/CD debugging

### 3. Added CI/CD Verification

GitHub Actions workflow now includes a verification step that:
- Extracts the app from the DMG
- Runs `codesign -dv` to verify signature validity
- Dumps entitlements to confirm they were embedded
- Logs this for debugging failed builds

## Entitlements

The app requires these critical entitlements:

```xml
<!-- JIT compiler support (for Electron's V8 engine) -->
<key>com.apple.security.cs.allow-jit</key>

<!-- Unsigned executable memory (needed for Electron) -->
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>

<!-- Disable library validation (needed for PyInstaller-bundled .dylib files) -->
<key>com.apple.security.cs.disable-library-validation</key>

<!-- File access for open/save dialogs -->
<key>com.apple.security.files.user-selected.read-write</key>

<!-- File access for userData, logs, cache -->
<key>com.apple.security.files.downloads.read-write</key>

<!-- Subprocess support (needed for Python backend) -->
<key>com.apple.security.cs.allow-executable-memory-with-write</key>

<!-- Network access (for future features) -->
<key>com.apple.security.network.client</key>
<key>com.apple.security.network.server</key>
```

## Testing

### Verify Signature (After Extract)

```bash
# Extract app from DMG
hdiutil attach Embroidery\ Converter-1.2.43-arm64.dmg
cd /Volumes/Embroidery\ Converter

# Check signature validity
codesign -dv "Embroidery Converter.app"

# View embedded entitlements
codesign -d --entitlements - "Embroidery Converter.app"

# Verify with xattr (should be empty, no quarantine)
xattr "Embroidery Converter.app"
```

### Expected Output

```
Executable=/Volumes/Embroidery Converter/Embroidery Converter.app/Contents/MacOS/Embroidery Converter
Identifier=ai.orgware.embroideryconverter
Format=Mach-O arm64 (code)
CodeDirectory v=20500 size=12345 flags=0x0(none) hashes=sha256 location=embedded
```

## Deployment

The fix was deployed in commit **234ebe9** with:
- ✅ Corrected `package.json` build configuration
- ✅ Enhanced `scripts/afterSign.js` with better logging
- ✅ Added CI/CD verification step
- ✅ Re-tagged v1.2.43 to trigger new build

Next DMG release should have valid code signature with embedded entitlements.

## References

- [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
- [Electron Security Model](https://www.electronjs.org/docs/tutorial/security)
- [electron-builder macOS configuration](https://www.electron.build/configuration/mac)
- [macOS Entitlements Reference](https://developer.apple.com/documentation/bundleresources/entitlements)
