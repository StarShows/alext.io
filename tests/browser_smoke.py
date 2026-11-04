#!/usr/bin/env python3
"""Desktop/mobile smoke coverage for the recruiter finder and portal fallbacks."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(condition, description):
    if not condition:
        raise AssertionError(description)
    print("PASS", description, flush=True)


def run():
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(QuietHandler, directory=str(ROOT)),
    )
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    base = "http://127.0.0.1:" + str(server.server_port)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                channel="chrome", headless=True, args=["--no-sandbox"]
            )
            try:
                desktop = browser.new_context(viewport={"width": 1440, "height": 900})
                desktop.route("https://www.googletagmanager.com/**", lambda route: route.abort())
                page = desktop.new_page()
                errors = []
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                page.goto(base + "/", wait_until="domcontentloaded", timeout=25000)
                page.locator("#experienceGrid .experience-card").first.wait_for()
                check(page.locator("#portalGrid .portal-card").count() == 7, "seven portfolio cards")
                check(page.locator(".portal-snapshot").count() == 7, "seven local preview images")
                check(page.locator(".portal-iframe[src]").count() == 0, "third-party iframes are opt-in")
                page.locator(".skill-search-trigger").click()
                check(page.locator("#skillSearchDialog").is_visible(), "desktop skill finder opens")
                page.locator("#skillSearchInput").fill("React")
                page.locator(".skill-search-result").first.wait_for()
                check(page.locator(".skill-search-result").count() >= 2, "React matches real evidence")
                page.locator("#skillSearchInput").press("Enter")
                check(not page.locator("#skillSearchDialog").is_visible(), "search closes on selection")
                check(page.locator(".recruiter-spotlight").count() == 1, "evidence card is spotlighted")
                page.keyboard.press("Control+k")
                check(page.locator("#skillSearchDialog").is_visible(), "keyboard shortcut opens search")
                page.locator("#skillSearchInput").fill("quantum-fabrication-xyz")
                page.locator(".skill-search-empty").wait_for()
                check(page.locator(".skill-search-empty").count() == 1, "unknown skill is not invented")
                page.keyboard.press("Escape")
                check(not page.locator("#skillSearchDialog").is_visible(), "Escape dismisses modal")
                check(not errors, "no uncaught desktop JavaScript errors: " + ";".join(errors[:2]))
                desktop.close()

                mobile = browser.new_context(
                    viewport={"width": 390, "height": 844}, is_mobile=True,
                    device_scale_factor=1, has_touch=True, reduced_motion="reduce",
                )
                mobile.route("https://www.googletagmanager.com/**", lambda route: route.abort())
                phone = mobile.new_page()
                phone_errors = []
                phone.on("pageerror", lambda exc: phone_errors.append(str(exc)))
                phone.goto(base + "/", wait_until="domcontentloaded", timeout=25000)
                phone.locator(".skill-search-trigger").click()
                check(phone.locator("#skillSearchDialog").is_visible(), "mobile search launcher opens")
                phone.locator("#skillSearchInput").fill("HIPAA")
                phone.locator(".skill-search-result").first.wait_for()
                check(phone.locator(".skill-search-result").count() >= 1, "mobile HIPAA evidence found")
                phone.locator("#skillSearchClose").click()
                phone.locator("#menuButton").click()
                check(phone.locator(".skill-search-mobile-launch").is_visible(), "mobile menu search entry")
                phone.locator(".skill-search-mobile-launch").click()
                check(phone.locator("#skillSearchInput").is_focused(), "mobile input receives focus")
                phone.keyboard.press("Escape")
                check(not phone.locator("#skillSearchDialog").is_visible(), "mobile modal closes")
                check(not phone_errors, "no uncaught mobile JavaScript errors: " + ";".join(phone_errors[:2]))
                mobile.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
