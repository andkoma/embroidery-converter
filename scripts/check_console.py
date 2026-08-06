#!/usr/bin/env python3
"""
Console-error smoke test. Reuses the screenshot harness' window.api stub,
walks every view (with emphasis on the new Settings→AI provider registry and
Collections AI flow), and fails if any pageerror / console.error fires.
"""
import os, sys
from playwright.sync_api import sync_playwright
import make_screenshots as ms

RENDERER = ms.RENDERER


def main():
    data = ms.build_data()
    errors = []
    index_url = "file://" + os.path.join(RENDERER, "index.html")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport=ms.VIEWPORT, device_scale_factor=1)
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.add_init_script(ms.init_script(data))
        page.goto(index_url)
        page.wait_for_selector(".nav-item", timeout=8000)
        page.wait_for_timeout(600)

        for view in ["convert", "batch", "gallery", "simulator", "transfer", "collections", "settings"]:
            page.click(f'.nav-item[data-view="{view}"]')
            page.wait_for_timeout(900)

        # Settings -> AI, expand a provider, toggle checkboxes, poke secret buttons
        page.click('[data-topic="ai"]'); page.wait_for_timeout(400)
        page.click('[data-edit="prov-openai"]'); page.wait_for_timeout(500)
        for sel in ['[data-cap="chat"]', '[data-allow="sendExternal"]',
                    '[data-secret-set="prov-openai"]', '[data-secret-del="prov-openai"]',
                    '[data-test="prov-openai"]']:
            try:
                page.click(sel, timeout=1500); page.wait_for_timeout(300)
            except Exception as e:
                print("poke skipped", sel, e)
        # add a new provider then remove it
        try:
            page.select_option('#st-prov-kind', 'lmstudio'); page.wait_for_timeout(200)
            page.click('#st-prov-add'); page.wait_for_timeout(500)
        except Exception as e:
            print("add provider skipped:", e)

        # Collections -> try the AI button (active provider is ollama, vision-capable)
        page.click('.nav-item[data-view="collections"]'); page.wait_for_timeout(900)
        try:
            page.click('[data-toggle]', timeout=1500); page.wait_for_timeout(300)
        except Exception:
            pass

        browser.close()

    real = [e for e in errors if e]
    if real:
        print("CONSOLE ERRORS FOUND:")
        for e in real:
            print("  ", e)
        sys.exit(1)
    print("OK - no console errors across all views")


if __name__ == "__main__":
    main()
