#!/usr/bin/env python3
"""Capture public project pages as same-origin WebP fallbacks for portfolio cards.

Runs in an ephemeral, secret-free CI build. Fixed HTTPS URLs only; output is
stored in the static release under images/previews, not fetched in the visitor's
browser. If a site is inaccessible, create an explicitly labeled placeholder,
never a fabricated screenshot.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "images" / "previews"
OUTPUT.mkdir(parents=True, exist_ok=True)

SITES = (
    ("dinnerradar", "https://dinnerradar.com/", "DinnerRadar"),
    ("realtor-studio", "https://realtor-studio.com/", "Realtor Studio"),
    ("creamed", "https://justgetcreamed.com/", "Creamed"),
    ("chopt", "https://www.choptsalad.com/locations", "CHOPT"),
    ("resume", "https://alext.io/public/files/AlexTannenbaum_resume_SE_August_2026.pdf", "Resume PDF"),
    ("alext", "https://alext.io/public/files/old.html", "AlexT.io Archive"),
    ("dinner", "https://alext.io/dinner", "What's for dinner?"),
)
WIDTH, HEIGHT = 1200, 750
BG = (5, 6, 17)
TEXT = (251, 252, 255)
CYAN = (97, 243, 255)
PINK = (255, 139, 212)


def font(size, bold=False):
    base = "/usr/share/fonts/truetype/dejavu/"
    target = base + ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    try:
        return ImageFont.truetype(target, size)
    except OSError:
        return ImageFont.load_default()


def unavailable_image(name: str, url: str):
    """Visually honest, branded placeholder. This is not a screenshot."""
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        shade = int(7 + 19 * y / HEIGHT)
        draw.line((0, y, WIDTH, y), fill=(shade, 9 + shade // 2, 26 + shade))
    for x in range(0, WIDTH, 60):
        draw.line((x, 0, x, HEIGHT), fill=(26, 30, 49), width=1)
    for y in range(0, HEIGHT, 60):
        draw.line((0, y, WIDTH, y), fill=(26, 30, 49), width=1)
    draw.ellipse((920, -240, 1470, 310), outline=CYAN, width=4)
    draw.ellipse((960, -200, 1440, 280), outline=PINK, width=3)
    draw.line((82, 190, 164, 190), fill=CYAN, width=6)
    draw.text((80, 235), name, fill=TEXT, font=font(58, True))
    draw.text((82, 341), "PREVIEW UNAVAILABLE", fill=CYAN, font=font(23, True))
    draw.text((82, 395), "This site did not provide a capturable page.", fill=(188, 199, 222), font=font(24))
    draw.text((82, 443), "Open the live website using the link below.", fill=(188, 199, 222), font=font(24))
    draw.text((82, 659), url[:75], fill=(164, 174, 198), font=font(19))
    return image


def capture(context, url: str, output: Path) -> bool:
    # The resume URL is a PDF, not a website. Headless browsers often render
    # PDF viewers as a blank frame. Never ship a misleading screenshot of one.
    if url.lower().split("?")[0].endswith(".pdf"):
        return False
    page = context.new_page()
    page.set_default_timeout(20000)
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=24000)
        if not response or not 200 <= response.status < 400:
            print("  rejected non-success HTTP response")
            return False
        page.wait_for_timeout(1700)
        title = page.title().lower().strip()
        body = page.locator("body").inner_text(timeout=6000).strip()
        bad = ("access denied", "just a moment", "not found",
               "404 error", "403 forbidden", "this site can", "captcha")
        if len(body) < 55 or any(value in title for value in bad):
            print("  rejected error, challenge, or empty content")
            return False
        png = output.with_suffix(".png")
        page.screenshot(path=str(png), type="png", animations="disabled",
                        caret="hide", timeout=15000)
        with Image.open(png) as screenshot:
            screenshot = screenshot.convert("RGB")
            if screenshot.width < 500 or screenshot.height < 400:
                return False
            screenshot = screenshot.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
            screenshot.save(output, "WEBP", quality=77, method=6)
        png.unlink(missing_ok=True)
        return True
    except Exception as exc:
        print("  capture failed:", type(exc).__name__, str(exc)[:160])
        return False
    finally:
        page.close()


def generate(mode: str):
    browser = context = playwright = None
    if mode == "capture":
        try:
            from playwright.sync_api import sync_playwright
            playwright = sync_playwright().start()
            browser = playwright.chromium.launch(headless=True, channel="chrome",
                                                 args=["--no-sandbox", "--disable-dev-shm-usage"])
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1,
                reduced_motion="reduce",
                java_script_enabled=True,
                locale="en-US",
            )
        except Exception as exc:
            print("Screenshot browser unavailable, serving honest placeholders:", exc)
            if browser:
                browser.close()
            if playwright:
                playwright.stop()
            browser = context = playwright = None

    status = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items": {},
    }
    try:
        for slug, url, name in SITES:
            target = OUTPUT / (slug + ".webp")
            ok = False
            if context:
                print("Capturing", name, url, flush=True)
                ok = capture(context, url, target)
            if not ok:
                unavailable_image(name, url).save(target, "WEBP", quality=82, method=6)
            status["items"][slug] = {"status": "captured" if ok else "unavailable", "url": url}
            print(slug, "captured" if ok else "unavailable", target.stat().st_size, flush=True)
    finally:
        if context:
            context.close()
        if browser:
            browser.close()
        if playwright:
            playwright.stop()
    (OUTPUT / "capture-status.json").write_text(
        json.dumps(status, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["offline", "capture"], default="offline")
    args = parser.parse_args()
    generate(args.mode)
