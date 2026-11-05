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
                check(page.locator("#portalGrid .portal-card").count() == 8, "eight portfolio cards")
                check(page.locator(".portal-snapshot").count() == 8, "eight local preview images")
                check(page.locator(".nav-actions .btn").evaluate(
                    """(el) => {
                      const button = el.getBoundingClientRect();
                      const nav = el.closest('nav').getBoundingClientRect();
                      return getComputedStyle(el).whiteSpace === 'nowrap' &&
                        button.left >= nav.left - 1 && button.right <= nav.right + 1;
                    }"""
                ), "desktop contact button fits its navigation without wrapping")
                check(page.locator(".nav-links a:visible").count() >= 3,
                      "desktop keeps primary navigation accessible")
                check(page.locator(".portal-iframe[src]").count() == 0, "third-party iframes are opt-in")
                check(page.locator("#case-studies .case-study").count() == 5, "five fully readable build stories")
                check(page.locator("#case-studies .case-flow-step").count() == 23, "architectural flow for all five projects")
                check(page.locator("#build-learn a[href='https://alext.io/learn/']").count() >= 1,
                      "live Learning Lab linked from its case study")
                check(page.locator("#build-dinnerradar .case-dinner-mode").count() == 2,
                      "DinnerRadar explains two separate product journeys")
                check(page.locator("#build-dinnerradar .case-flow-step").count() == 5,
                      "DinnerRadar architecture explains five major components")
                check(page.locator("#build-realtor-studio .case-wp-era").count() == 2,
                      "Realtor Studio contrasts pre-AI engineering and AI-enhanced workflows")
                check(page.locator("#build-realtor-studio .case-flow-step").count() == 5,
                      "Realtor Studio documents classic and headless WordPress architecture")
                check(page.locator("#build-realtor-studio").inner_text().find("more than eight custom WordPress plugins and themes") >= 0,
                      "Realtor Studio demonstrates eight-plus custom plugin/theme builds")
                check(page.locator("#portalGrid .portal-card").filter(
                    has_text="Realtor Studio").locator('a[href="#build-realtor-studio"]').count() == 1,
                      "Realtor Studio preview links to its engineering story")
                check(page.locator("#portalGrid .portal-card").first.locator(
                    'a[href="#build-dinnerradar"]').count() == 1,
                      "DinnerRadar public card links to full engineering story")

                check(page.locator("#build-titan").inner_text().find("Airtable") >= 0 and
                      page.locator("#build-titan").inner_text().find("Bedrock") >= 0,
                      "Titan distinguishes Airtable POC from full AI-enabled platform")
                check(page.locator("#build-hoag").inner_text().find("FHIR") >= 0 and
                      page.locator("#build-hoag").inner_text().find("Cloverleaf") >= 0,
                      "Hoag explains FHIR and Cloverleaf interoperability")
                page.locator(".skill-search-trigger").click()
                check(page.locator("#skillSearchDialog").is_visible(), "desktop skill finder opens")
                page.locator("#skillSearchInput").fill("React")
                page.locator(".skill-search-result").first.wait_for()
                (ROOT / "tests/screenshots").mkdir(parents=True, exist_ok=True)
                page.wait_for_timeout(750)  # Let liquid entrance settle before visual QA
                page.screenshot(path=str(ROOT / "tests/screenshots/recruiter-desktop.png"))
                check(page.locator(".skill-search-result").count() >= 2, "React matches real evidence")
                page.locator("#skillSearchInput").press("Enter")
                check(not page.locator("#skillSearchDialog").is_visible(), "search closes on selection")
                check(page.locator(".recruiter-spotlight").count() == 1, "evidence card is spotlighted")
                page.keyboard.press("Control+k")
                check(page.locator("#skillSearchDialog").is_visible(), "keyboard shortcut opens search")
                page.locator("#skillSearchInput").fill("quantum-fabrication-xyz")
                page.locator(".skill-search-empty").wait_for()
                check(page.locator(".skill-search-empty").count() == 1, "unknown skill is not invented")
                page.locator("#skillSearchInput").fill("DynamoDB")
                page.locator(".skill-search-result").first.wait_for()
                check(page.locator(".skill-search-result").count() >= 1,
                      "less prominent technologies in the complete stack summary are searchable")
                page.locator("#skillSearchInput").fill("Bedrock")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('The POC proved');
                }""")
                check("The POC proved" in page.locator(".skill-search-result").first.inner_text(),
                      "Bedrock search ranks Titan's real implementation story")
                page.locator("#skillSearchInput").fill("cost analysis")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('The POC proved');
                }""")
                check(page.locator(".skill-search-result").first.count() == 1,
                      "cost analysis search ranks Titan architecture story")
                page.locator("#skillSearchInput").fill("schema normalization")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('The POC proved');
                }""")
                check(page.locator(".skill-search-result").first.count() == 1,
                      "schema normalization search surfaces cross-team ETL case study")
                page.locator("#skillSearchInput").fill("OpenStreetMap")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('One question. Two ways');
                }""")
                check("One question. Two ways" in page.locator(".skill-search-result").first.inner_text(),
                      "restaurant data search ranks the DinnerRadar case study")
                page.locator("#skillSearchInput").fill("SSE")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('One question. Two ways');
                }""")
                check("One question. Two ways" in page.locator(".skill-search-result").first.inner_text(),
                      "SSE alias finds DinnerRadar recipe progress architecture")
                page.locator("#skillSearchInput").fill("headless WordPress")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('From hand-coded themes');
                }""")
                check("From hand-coded themes" in page.locator(".skill-search-result").first.inner_text(),
                      "headless WordPress query ranks Realtor Studio's architecture first")
                page.locator("#skillSearchInput").fill("FHIR")
                page.wait_for_function("""() => {
                    const first = document.querySelector('#skillSearchResults .skill-search-result');
                    return first && first.textContent.includes('scheduling experience');
                }""")
                check("scheduling experience" in page.locator(".skill-search-result").first.inner_text(),
                      "FHIR search surfaces Hoag integration evidence")
                page.keyboard.press("Escape")
                check(not page.locator("#skillSearchDialog").is_visible(), "Escape dismisses modal")
                check(not errors, "no uncaught desktop JavaScript errors: " + ";".join(errors[:2]))
                page.locator("#portalGrid").scroll_into_view_if_needed()
                page.wait_for_timeout(650)
                page.screenshot(path=str(ROOT / "tests/screenshots/project-previews-desktop.png"))
                # Tall articles must not depend on IntersectionObserver's
                # 10% visibility threshold: otherwise they can stay invisible.
                page.evaluate("""() => {
                    const target = document.getElementById('build-titan');
                    window.scrollTo({top: target.getBoundingClientRect().top +
                        window.scrollY - 115, behavior: 'instant'});
                }""")
                page.wait_for_timeout(350)
                check(page.locator("#build-titan").evaluate(
                    "(el) => Number(getComputedStyle(el).opacity) > 0.99"
                ), "desktop full-length article is actually painted")
                page.screenshot(path=str(ROOT / "tests/screenshots/build-story-titan-desktop.png"))
                page.locator("#build-titan").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-titan-full.png"))
                page.locator("#build-dinnerradar").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-dinnerradar-full.png"))
                page.locator("#build-realtor-studio").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-realtor-studio-desktop.png"))
                check(page.locator("#build-dinnerradar").evaluate(
                    "(el) => el.scrollWidth <= el.clientWidth + 2"
                ), "DinnerRadar long-form card fits desktop width")
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
                phone.screenshot(path=str(ROOT / "tests/screenshots/recruiter-mobile.png"))
                check(phone.locator(".skill-search-result").count() >= 1, "mobile HIPAA evidence found")
                phone.locator("#skillSearchClose").click()
                # The fixed mobile header can be moving during viewport reflow after
                # dismissing a focused search field; dispatch the intended tap.
                phone.locator("#menuButton").click(force=True, timeout=5000)
                check(phone.locator(".skill-search-mobile-launch").is_visible(), "mobile menu search entry")
                phone.locator(".skill-search-mobile-launch").click()
                phone.wait_for_function("document.activeElement === document.getElementById('skillSearchInput')")
                check(True, "mobile input receives focus")
                phone.keyboard.press("Escape")
                check(not phone.locator("#skillSearchDialog").is_visible(), "mobile modal closes")
                phone.evaluate("""() => {
                    const target = document.getElementById('build-learn');
                    window.scrollTo({top: target.getBoundingClientRect().top +
                        window.scrollY - 90, behavior: 'instant'});
                }""")
                phone.wait_for_timeout(350)
                check(phone.locator("#build-learn").evaluate(
                    "(el) => Number(getComputedStyle(el).opacity) > 0.99"
                ), "mobile case study is truly visible, not hidden by scroll reveal")
                check(phone.locator("#build-learn .case-architecture").is_visible(),
                      "mobile learning case study architecture is accessible")
                phone.locator("#build-dinnerradar").scroll_into_view_if_needed()
                check(phone.locator("#build-dinnerradar").evaluate(
                    "(el) => Number(getComputedStyle(el).opacity) > .99 && el.scrollWidth <= el.clientWidth + 2"
                ), "DinnerRadar story is visible without mobile horizontal overflow")
                check(phone.locator("#build-dinnerradar .case-dinner-mode").count() == 2,
                      "two DinnerRadar user journeys remain readable on mobile")
                phone.locator("#build-dinnerradar").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-dinnerradar-mobile.png"))
                phone.locator("#build-realtor-studio").scroll_into_view_if_needed()
                check(phone.locator("#build-realtor-studio").evaluate(
                    "(el) => Number(getComputedStyle(el).opacity) > .99 && el.scrollWidth <= el.clientWidth + 2"
                ), "Realtor Studio story stays visible without horizontal overflow")
                phone.locator("#build-realtor-studio").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-realtor-studio-mobile.png"))
                phone.locator("#build-titan").scroll_into_view_if_needed()
                check(phone.locator("#build-titan .case-practice").count() == 4,
                      "Titan architecture, cost, quality and Agile delivery practices render on mobile")
                check(phone.locator("#build-titan .case-practice-grid").evaluate(
                    "(el) => el.scrollWidth <= el.clientWidth + 2"
                ), "Titan engineering practice matrix does not overflow mobile width")
                phone.screenshot(path=str(ROOT / "tests/screenshots/build-story-learn-mobile.png"))
                phone.locator("#build-learn").screenshot(
                    path=str(ROOT / "tests/screenshots/build-story-learn-full-mobile.png"))
                check(not phone_errors, "no uncaught mobile JavaScript errors: " + ";".join(phone_errors[:2]))
                mobile.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    run()
