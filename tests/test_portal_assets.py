"""Regression tests for the deterministic, same-origin preview asset contract."""
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image
import scripts.deploy.generate_portal_previews as previews
from scripts.deploy.package_site import GENERATED_PORTAL_ASSETS, is_deployable


class PortalAssetTests(unittest.TestCase):
    def test_fixed_public_sources_and_internal_fallbacks(self):
        keys = [slug for slug, _, _ in previews.SITES]
        self.assertEqual(len(keys), 8)
        self.assertEqual(len(set(keys)), len(keys))
        for _, url, _ in previews.SITES:
            self.assertTrue(url.startswith("https://"))
            self.assertNotIn("@", url)
        self.assertEqual(len(GENERATED_PORTAL_ASSETS), 9)
        self.assertTrue(all(is_deployable(path) for path in GENERATED_PORTAL_ASSETS))
        self.assertFalse(is_deployable("images/previews/untrusted.php"))

    def test_offline_mode_produces_honestly_labeled_fallbacks(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = previews.OUTPUT
            previews.OUTPUT = Path(tmp)
            try:
                result = previews.generate("offline")
                self.assertEqual(set(result["items"]), {s[0] for s in previews.SITES})
                for slug, _, _ in previews.SITES:
                    self.assertEqual(result["items"][slug]["status"], "unavailable")
                    path = Path(tmp) / (slug + ".webp")
                    self.assertTrue(path.exists())
                    self.assertGreater(path.stat().st_size, 5000)
                    with Image.open(path) as im:
                        self.assertEqual(im.size, (1200, 750))
                        self.assertEqual(im.format, "WEBP")
                manifest = json.loads((Path(tmp) / "capture-status.json").read_text())
                self.assertEqual(manifest["items"], result["items"])
            finally:
                previews.OUTPUT = old


if __name__ == "__main__":
    unittest.main()
