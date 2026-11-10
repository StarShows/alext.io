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
                        "https://alext.io/public/files/images/avitannenbaum.jpeg",
                        lambda route: route.fulfill(
                            status=200,
                            content_type="image/jpeg",
                            path=str(ROOT / "images/avitannenbaum.jpeg"),
                        ),
                    )
                    context.route(
                        "https://raw.githubusercontent.com/StarShows/avitannenbaum.com/**",
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
                    # The inline archive deliberately paints the gradient on
                    # the sky wrapper so the transparent content doesn't cover
                    # its 100 white stars.
                    check(page.locator("#sky").evaluate(
                        "(el) => getComputedStyle(el).backgroundImage.includes('linear-gradient')"
                    ), label + " historic gradient renders on the sky layer")
                    check(page.locator("#sky .container").evaluate(
                        "(el) => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'"
                    ), label + " content stays transparent above the stars")
                    # A loaded CSS file is not enough. The archived HTML uses
                    # selectors that the recompiled Sass stylesheet lacked.
                    check(page.locator(".container .header").first.evaluate(
                        """(el) => {
                            const style = getComputedStyle(el);
                            return style.backgroundColor === 'rgb(0, 0, 0)' &&
                                style.borderTopWidth === '2px' &&
                                style.fontFamily.includes('Century Gothic');
                        }"""
                    ), label + " historical boxed header and typography render")
                    check(page.locator(".container .header.h2").first.evaluate(
                        "(el) => getComputedStyle(el).fontSize === '20px'"
                    ), label + " historical secondary heading font size")
                    check(page.locator(".container .header").first.evaluate(
                        "(el) => getComputedStyle(el).fontFamily.includes('Century Gothic')"
                    ), label + " original heading font is not overwritten")
                    check(page.locator(".content .portfolio_item .button").first.evaluate(
                        "(el) => getComputedStyle(el).fontFamily.includes('Century Gothic')"
                    ), label + " original button font is not overwritten")
                    check(page.locator(".container .header.mobile_only").is_visible() == (label == "mobile"),
                          label + " original responsive heading behavior")
                    check(page.locator("style").count() == 1,
                          label + " archive CSS is embedded inline")
                    check(page.locator("script[src]").count() == 0,
                          label + " archive JavaScript is embedded inline")
                    banner = page.locator(".box_yellow")
                    check(banner.count() == 1, label + " 2025 project banner exists")
                    check(banner.evaluate(
                        "(el) => getComputedStyle(el).backgroundColor === 'rgb(255, 255, 0)'"
                    ), label + " original inline yellow banner renders")
                    check(page.locator(".box_yellow .box_yellowa").first.evaluate(
                        "(el) => getComputedStyle(el).color === 'rgb(255, 0, 0)'"
                    ), label + " original inline banner link color renders")
                    check(page.locator(".container .header").first.is_visible(),
                          label + " original headers render")
                    check(page.evaluate(
                        "() => document.documentElement.scrollWidth <= window.innerWidth + 2"
                    ), label + " archive has no horizontal scroll overflow")
                    check(not failed, label + " all requested legacy assets return 200")
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
