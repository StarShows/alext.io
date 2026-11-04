#!/usr/bin/env python3
"""Stress the recruiter search with real Chromium at desktop and phone sizes.

Verifies UI stability, not just a passing JavaScript parser. Run after
browser_smoke.py using the existing secret-free GitHub Actions environment.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def require(ok, message):
    if not ok:
        raise AssertionError(message)
    print("PASS", message, flush=True)


def exercise(page, terms, mobile=False):
    faults = []
    crashes = []
    page.on("pageerror", lambda exc: faults.append(str(exc)))
    page.on("crash", lambda _: crashes.append("renderer crashed"))
    page.locator("#portalGrid .portal-card").first.wait_for()
    page.locator("#build-dinnerradar").wait_for()
    trigger = page.locator(".skill-search-trigger")
    field = page.locator("#skillSearchInput")

    # One immediate Enter per query. This tests the race where the 65ms
    # debounce has not yet updated the result set after the input changes.
    for term in terms:
        trigger.click()
        field.fill(term)
        field.press("Enter")
        require(not page.locator("#skillSearchDialog").is_visible(),
                "rapid Enter selects the current query: " + term)
        matches = page.locator(".recruiter-spotlight")
        require(matches.count() == 1, "one active evidence spotlight: " + term)
        size = matches.evaluate("(el) => el.getBoundingClientRect().height")
        require(0 < size < 800,
                "bounded evidence highlight (%.0fpx): %s" % (size, term))
        require(page.locator("mark.recruiter-keyword").count() <= 8,
                "bounded keyword DOM marks: " + term)
        # The matching part of a long article should be targeted, not the
        # entire tall card. This avoids multi-megapixel filter animations.
        if term in ("OpenStreetMap", "Bedrock", "FHIR", "schema normalization", "cost analysis"):
            require(matches.evaluate(
                "(el) => !!el.closest('.case-study') && !el.classList.contains('case-study')"
            ), "only a subsection of the long story is spotlighted: " + term)

    # A new search must retain focus even if a prior selection scheduled a
    # delayed focus. This was especially fragile on mobile browsers.
    trigger.click()
    field.fill("React")
    field.press("Enter")
    trigger.click()
    page.wait_for_timeout(420)
    require(page.evaluate(
        "document.activeElement === document.getElementById('skillSearchInput')"
    ), "late focus cannot escape from open search")
    page.keyboard.press("Escape")

    # Regex-looking user input is treated as ordinary text and cannot inject
    # markup, construct malformed matchers, or navigate away unexpectedly.
    trigger.click()
    field.fill("[(){}*+?.^$")
    page.locator(".skill-search-empty").wait_for()
    require(page.locator(".skill-search-empty").count() == 1,
            "special-character input is handled as plain text")
    page.keyboard.press("Escape")

    if mobile:
        trigger.click()
        require(page.locator("#skillSearchScrim").evaluate(
            "(el) => getComputedStyle(el).backdropFilter === 'none'"
        ), "mobile scrim avoids expensive backdrop blur")
        page.keyboard.press("Escape")

    require(not faults, "no JavaScript exceptions: " + "; ".join(faults[:2]))
    require(not crashes, "no Chromium renderer crashes")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(
        QuietHandler, directory=str(ROOT)
    ))
    Thread(target=server.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:" + str(server.server_port) + "/"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                channel="chrome", headless=True, args=["--no-sandbox"]
            )
            try:
                for mobile, terms in (
                    (False, (
                        "OpenStreetMap", "Bedrock", "FHIR", "SSE",
                        "schema normalization", "React", "cost analysis",
                        "Cloverleaf", "TypeScript", "DAG",
                    )),
                    (True, (
                        "OpenStreetMap", "Bedrock", "FHIR", "SSE",
                        "SQLite", "Next.js", "schema normalization", "React",
                    )),
                ):
                    ctx = browser.new_context(
                        viewport={"width": 390, "height": 844} if mobile else
                                 {"width": 1360, "height": 900},
                        is_mobile=mobile, has_touch=mobile,
                        reduced_motion="reduce" if mobile else "no-preference",
                    )
                    try:
                        page = ctx.new_page()
                        page.goto(url, wait_until="domcontentloaded", timeout=25000)
                        exercise(page, terms, mobile)
                    finally:
                        ctx.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
