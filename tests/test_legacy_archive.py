"""Regression coverage for the original, pre-redesign portfolio archive.

The historical page is deliberately kept separate from the current homepage.
Relative asset URLs must resolve from /, because it lives under /public/files/.
"""
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

from scripts.deploy.package_site import is_deployable

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "public/files/old.html"


class LegacyDocument(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.base = None
        self.resources = []

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if tag == "base":
            self.base = props.get("href")
        if tag in ("script", "img") and props.get("src"):
            self.resources.append(props["src"])
        if tag == "link" and props.get("rel") == "stylesheet":
            self.resources.append(props.get("href"))


class LegacyPortfolioTests(unittest.TestCase):
    def test_archive_is_tracked_deployable_static_html(self):
        self.assertTrue(ARCHIVE.is_file())
        self.assertTrue(is_deployable("public/files/old.html"))
        content = ARCHIVE.read_text(encoding="utf-8")
        self.assertIn("<title>Alex T - Sr. Full Stack Software Engineer</title>", content)
        self.assertIn("Currently busy with the following projects", content)
        self.assertIn("Thanks for visiting my site!", content)
        self.assertIn('id="sky"', content)

    def test_archived_style_is_pinned_and_contains_historical_typography(self):
        css_file = ROOT / "public/files/old.css"
        self.assertTrue(css_file.is_file(), "Legacy stylesheet must be tracked")
        self.assertTrue(is_deployable("public/files/old.css"))
        html = ARCHIVE.read_text(encoding="utf-8")
        self.assertIn("<style>", html)
        self.assertIn("</style>", html)
        self.assertNotIn('<link rel="stylesheet"', html)
        css = css_file.read_text(encoding="utf-8")
        # These were absent from compiled 2023-era Sass despite the archive
        # being a later HTML revision. The mismatch made text look unstyled.
        for rule in (".container .header {", ".container .header.h2 {",
                     ".container .header.mobile_only {",
                     ".container .content .portfolio_item .button {"):
            with self.subTest(rule=rule):
                self.assertIn(rule, css)
        self.assertIn('url("/public/fonts/Franklin%20Gothic%20Condensed.woff")', css)
        self.assertTrue((ROOT / "public/fonts/Franklin Gothic Condensed.woff").is_file())

    def test_newer_html_has_a_separate_style_compatibility_layer(self):
        html = ARCHIVE.read_text(encoding="utf-8")
        css_file = ROOT / "public/files/old-compat.css"
        self.assertTrue(css_file.is_file())
        self.assertTrue(is_deployable("public/files/old-compat.css"))
        self.assertIn(".box_yellow", html)
        css = css_file.read_text(encoding="utf-8")
        for selector in (".container .box_yellow {",
                         ".container .box_yellow .box_yellowa {",
                         ".container .content .portfolio_item > p,",
                         ".container .footer .paragraph_footer,",
                         "@media (max-width: 736px)"):
            with self.subTest(selector=selector):
                self.assertIn(selector, css)
        # Archived CSS remains tracked, but this page is now self-contained.
        self.assertNotIn('old-compat.css?v=', html)

    def test_inline_archive_has_no_local_script_or_stylesheet_dependencies(self):
        html = ARCHIVE.read_text(encoding="utf-8")
        doc = LegacyDocument()
        doc.feed(html)
        self.assertIsNone(doc.base, "Standalone archive should not need a base URL")
        self.assertFalse([url for url in doc.resources
                          if url.startswith("js/") or url.endswith(".css")])
        self.assertIn("const numStars = 100", html)
        self.assertIn("board.prepend(sky)", html)
        self.assertIn("function generateStars()", html)
        self.assertIn("window.navigateTo = function", html)
        self.assertEqual(html.count("<style>"), 1)
        self.assertEqual(html.count("</style>"), 1)
        self.assertIn("https://alext.io/public/files/images/avitannenbaum.jpeg", html)
        self.assertIn("https://raw.githubusercontent.com/StarShows/avitannenbaum.com/main/", html)
        self.assertTrue((ROOT / "images/avitannenbaum.jpeg").is_file())




if __name__ == "__main__":
    unittest.main()
