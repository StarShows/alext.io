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

    def test_original_assets_resolve_at_site_root(self):
        content = ARCHIVE.read_text(encoding="utf-8")
        doc = LegacyDocument()
        doc.feed(content)
        self.assertEqual(doc.base, "/")
        expected = (
            "public/css/styles.css",
            "images/avitannenbaum.jpeg",
            "js/scripts.js",
            "js/starBackground.js",
        )
        base = urljoin("https://alext.io/public/files/old.html", doc.base)
        resolved = [urljoin(base, asset) for asset in doc.resources]
        for path in expected:
            with self.subTest(path=path):
                self.assertIn("https://alext.io/" + path, resolved)
                self.assertTrue((ROOT / path).is_file(), "Missing legacy asset: " + path)
        for url in resolved:
            if urlparse(url).hostname == "alext.io":
                self.assertNotIn("/public/files/images/", url)
                self.assertNotIn("/public/files/js/", url)


if __name__ == "__main__":
    unittest.main()
