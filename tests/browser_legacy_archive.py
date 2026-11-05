#!/usr/bin/env python3
"""Real-browser visual smoke checks for the restored original portfolio."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/screenshots"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print("PASS legacy archive:", label, flush=True)


def run():
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT))
    )
    Thread(target=server.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/public/files/old.html" % server.server_port
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                channel="chrome", headless=True, args=["--no-sandbox"]
            )
            try:
                for label, viewport in [
                    ("desktop", {"width": 1440, "height": 900}),
                    ("mobile", {"width": 390, "height": 844}),
                ]:
                    context = browser.new_context(
                        viewport=viewport,
                        is_mobile=label == "mobile",
                        has_touch=label == "mobile",
                    )
                    context.route(
                        "https://www.googletagmanager.com/**",
                        lambda route: route.abort(),
                    )
                    errors = []
                    failed = []
                    page = context.new_page()
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on(
                        "response",
                        lambda response: failed.append(
                            "%d %s" % (response.status, response.url)
                        ) if response.status >= 400 and
                             response.url.startswith(
                                 "http://127.0.0.1:%d/" % server.server_port
                             ) else None,
                    )
                    response = page.goto(url, wait_until="load", timeout=25000)
                    check(response is not None and response.status == 200,
                          label + " archive returns HTTP 200")
                    image = page.locator(".avatar_image")
                    image.wait_for(state="visible")
                    check(image.evaluate(
                        "(el) => el.complete && el.naturalWidth > 0"
                    ), label + " historic portrait resolves and renders")
                    check(page.locator("#sky .star").count() == 100,
                          label + " 100-star animation initializes")
                    check(page.locator(".container").evaluate(
                        "(el) => getComputedStyle(el).backgroundImage.includes('gradient')"
                    ), label + " historic CSS renders gradient")
                    check(not failed, label + " no local assets fail: " +
                          "; ".join(failed[:3]))
                    page.screenshot(
                        path=str(OUT / ("legacy-portfolio-" + label + ".png")),
                        full_page=True, animations="disabled",
                    )
                    check(not errors, label + " no uncaught JS exceptions: " +
                          "; ".join(errors[:2]))
                    context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
