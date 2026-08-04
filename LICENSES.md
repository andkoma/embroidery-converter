# 📋 Third-Party Licenses & Attributions

This project includes the following open-source libraries and assets. We respect and comply with all licenses.

---

## 📦 JavaScript Dependencies

### Electron
- **License:** MIT
- **Repository:** https://github.com/electron/electron
- **Version:** 31.0.0
- **Description:** Cross-platform desktop application framework
- **Copyright:** Copyright (c) 2013-2024 GitHub Inc.
- **License Text:** [MIT License](https://opensource.org/licenses/MIT)

### electron-builder
- **License:** MIT
- **Repository:** https://github.com/electron-userland/electron-builder
- **Version:** 24.13.3
- **Description:** Complete solution for packaging and building Electron apps
- **Copyright:** Copyright (c) 2016-2024 electron-builder contributors
- **License Text:** [MIT License](https://opensource.org/licenses/MIT)

---

## 🐍 Python Dependencies

### pyembroidery
- **License:** MIT
- **Repository:** https://github.com/EmbroidePy/pyembroidery
- **Version:** 1.5.1
- **Description:** Embroidery file format library supporting 50+ stitch file formats
- **Copyright:** Copyright (c) 2018-2024 EmbroidePy contributors
- **License Text:** [MIT License](https://opensource.org/licenses/MIT)
- **Status:** Bundled with application (vendored in `scripts/vendor/pyembroidery/`)

---

## 🎨 Assets & Icons

### Application Icon
- **File:** `assets/icon.icns` (macOS), `assets/icon.ico` (Windows)
- **License:** Proprietary / Custom
- **Copyright:** 2024 orgware.ai
- **Description:** Embroidery Converter application icon

### UI Resources
- **Files:** `renderer/styles.css`, `renderer/index.html`
- **License:** MIT
- **Copyright:** 2024 orgware.ai
- **Description:** User interface and styling

---

## 🔤 Fonts & Typography

### System Fonts
This application uses system-default fonts provided by the operating system:
- **macOS:** System fonts (San Francisco, etc.)
- **Windows:** System fonts (Segoe UI, etc.)
- **License:** OS license terms

---

## 📄 License Compliance

### MIT License Terms
All MIT-licensed components are provided "AS IS" WITHOUT WARRANTY. Modifications are permitted under the following conditions:

1. ✅ Include original copyright notice
2. ✅ Include license text
3. ✅ Document modifications
4. ✅ Provide source code availability notice

### License Files Included

MIT-licensed components source code and license texts are:
- Documented in `package.json` and `scripts/requirements.txt`
- Available on their respective GitHub repositories
- Included in vendor directories where applicable

---

## 🔗 Full License Texts

### MIT License (Full Text)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## ✅ Summary

| Component | License | Vendored | Source |
|-----------|---------|----------|--------|
| Electron | MIT | ❌ | npm install |
| electron-builder | MIT | ❌ | npm install |
| pyembroidery | MIT | ✅ | `scripts/vendor/` |
| Embroidery Converter | MIT | - | This project |

---

## 📞 Questions?

For questions about licenses or attribution:
- **Author:** Andrew Kopp (andkoma@akopp.de)
- **Organization:** [orgware.ai](https://orgware.ai)
- **Repository:** https://github.com/andkoma/embroidery-converter

---

**Last Updated:** August 2024
