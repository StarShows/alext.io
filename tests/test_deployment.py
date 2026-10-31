"""Offline integration tests for the production deploy contract."""
import io
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.package_site import build, is_deployable

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts" / "deploy"


def write(root: Path, relative: str, content: bytes) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.repo = self.home / "repository"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        write(self.repo, "index.html", b"<html>new homepage</html>")
        write(self.repo, "js/site.js", b"console.log('new');\n")
        write(self.repo, "public/files/Alexander Resume.pdf", b"resume")
        write(self.repo, "public/images/sample.JPG", b"image")
        write(self.repo, "public/sites/learning-lab/index.html", b"DO NOT DEPLOY")
        write(self.repo, "images/editable.xcf", b"DO NOT DEPLOY")
        write(self.repo, ".env", b"DO NOT DEPLOY")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        self.web = self.home / "alext.io"
        self.web.mkdir()
        write(self.web, "index.html", b"<html>old homepage</html>")
        write(self.web, "js/site.js", b"console.log('old');\n")
        write(self.web, "public/sites/learning-lab/index.html", b"live app, keep me")
        self.state = self.home / ".alext-deploy"
        self.env = dict(os.environ, HOME=str(self.home))

    def stage(self, deployment_id="100-1"):
        release = self.state / "staging" / deployment_id / "site.tar.gz"
        selected = build(release, self.repo)
        return release, selected

    def remote(self, script, deployment_id, expect_success=True):
        result = subprocess.run(["bash", str(SCRIPTS / script), deployment_id],
                                env=self.env, capture_output=True, text=True)
        if expect_success:
            self.assertEqual(result.returncode, 0, f"{script}: {result.stdout}\n{result.stderr}")
        else:
            self.assertNotEqual(result.returncode, 0, f"Unexpected success: {script}")
        return result

    def test_allowlist_prevents_deploying_app_or_sensitive_files(self):
        release, names = self.stage()
        self.assertEqual(names, sorted(names))
        self.assertIn("public/files/Alexander Resume.pdf", names)
        self.assertIn("public/images/sample.JPG", names)
        self.assertNotIn("public/sites/learning-lab/index.html", names)
        self.assertNotIn("images/editable.xcf", names)
        self.assertNotIn(".env", names)
        with tarfile.open(release) as archive:
            self.assertEqual(archive.getmember("site/index.html").type, tarfile.REGTYPE)
            self.assertNotIn("site/public/sites/learning-lab/index.html", archive.getnames())

    def test_deploy_and_immediate_rollback_preserve_unmanaged_app(self):
        self.stage()
        self.remote("remote_deploy.sh", "100-1")
        self.assertEqual((self.web / "index.html").read_bytes(), b"<html>new homepage</html>")
        self.assertEqual((self.web / "public/files/Alexander Resume.pdf").read_bytes(), b"resume")
        self.assertEqual((self.web / "public/sites/learning-lab/index.html").read_bytes(), b"live app, keep me")
        self.remote("remote_rollback.sh", "100-1")
        self.assertEqual((self.web / "index.html").read_bytes(), b"<html>old homepage</html>")
        self.assertEqual((self.web / "js/site.js").read_bytes(), b"console.log('old');\n")
        self.assertFalse((self.web / "public/files/Alexander Resume.pdf").exists())
        self.assertEqual((self.web / "public/sites/learning-lab/index.html").read_bytes(), b"live app, keep me")
        self.remote("remote_rollback.sh", "100-1", expect_success=False)

    def test_rollback_requires_latest_release(self):
        self.stage("100-1")
        self.remote("remote_deploy.sh", "100-1")
        self.stage("101-1")
        self.remote("remote_deploy.sh", "101-1")
        self.remote("remote_rollback.sh", "100-1", expect_success=False)
        self.remote("remote_rollback.sh", "101-1")
        self.assertEqual((self.state / "current-deploy-id").read_text(), "100-1\n")
        self.remote("remote_deploy.sh", "101-1", expect_success=False)

    def test_symlink_in_site_blocks_deployment(self):
        self.stage()
        (self.web / "public" / "images").mkdir(parents=True)
        (self.web / "public" / "images" / "sample.JPG").symlink_to(self.home / "outside")
        self.remote("remote_deploy.sh", "100-1", expect_success=False)
        self.assertEqual((self.web / "index.html").read_bytes(), b"<html>old homepage</html>")

    def test_failed_homepage_update_restores_all_prior_files(self):
        self.stage()
        fake = self.home / "fakebin"
        fake.mkdir()
        runner = fake / "mv"
        runner.write_text("#!/bin/sh\ncase \"$*\" in *index.html*) exit 42;; esac\nexec /usr/bin/mv \"$@\"\n")
        runner.chmod(0o755)
        env = self.env.copy()
        env["PATH"] = str(fake) + ":" + os.environ["PATH"]
        result = subprocess.run(["bash", str(SCRIPTS / "remote_deploy.sh"), "100-1"],
                                env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.web / "index.html").read_bytes(), b"<html>old homepage</html>")
        self.assertEqual((self.web / "js/site.js").read_bytes(), b"console.log('old');\n")
        self.assertFalse((self.web / "public/images/sample.JPG").exists())
        self.assertFalse((self.web / "public/files/Alexander Resume.pdf").exists())
        self.assertEqual((self.web / "public/sites/learning-lab/index.html").read_bytes(), b"live app, keep me")

    def test_package_rejects_tracked_symlink(self):
        (self.repo / "js" / "evil.js").symlink_to(self.repo / "index.html")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        with self.assertRaisesRegex(ValueError, "Symlinks are prohibited"):
            build(self.home / "evil.tar.gz", self.repo)

    def test_package_and_remote_reject_unexpected_paths(self):
        self.assertFalse(is_deployable("public/sites/learning-lab/index.html"))
        self.assertFalse(is_deployable(".env"))
        self.assertFalse(is_deployable("js/../../bad.js"))
        release, _ = self.stage()
        with tarfile.open(release, mode="w:gz") as archive:
            payload = b"danger"
            ti = tarfile.TarInfo("site/../../bad.php")
            ti.size = len(payload)
            archive.addfile(ti, io.BytesIO(payload))
        self.remote("remote_deploy.sh", "100-1", expect_success=False)
        self.assertFalse((self.home / "bad.php").exists())


if __name__ == "__main__":
    unittest.main()
