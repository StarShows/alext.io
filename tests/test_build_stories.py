"""Static-content regressions for portfolio engineering build stories.

The public case studies must remain accessible in the HTML source, not
dependent on JavaScript or a third-party model to render.
"""
import unittest
from html.parser import HTMLParser
from pathlib import Path

PAGE = (Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8")


class DocumentOutline(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = {}
        self.links = []

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if "id" in props:
            self.ids[props["id"]] = {"tag": tag, "attrs": props}
        if tag == "a":
            self.links.append(props.get("href", ""))


class BuildStoryTests(unittest.TestCase):
    def setUp(self):
        self.tree = DocumentOutline()
        self.tree.feed(PAGE)

    def test_three_public_engineering_case_studies(self):
        self.assertEqual(self.tree.ids["case-studies"]["tag"], "section")
        for story in ("build-learn", "build-titan", "build-hoag"):
            with self.subTest(story=story):
                self.assertEqual(self.tree.ids[story]["tag"], "article")
                self.assertEqual(self.tree.ids[story]["attrs"]["tabindex"], "-1")
                self.assertIn("#" + story, self.tree.links)
        self.assertEqual(PAGE.count('class="case-architecture"'), 3)
        self.assertEqual(PAGE.count('class="case-flow-step"'), 11)
        self.assertEqual(PAGE.count('class="case-flow-step case-flow-step--split"'), 1)

    def test_evidence_and_architecture_are_explained(self):
        learn = PAGE.split('id="build-learn"', 1)[1].split('id="build-titan"', 1)[0]
        titan = PAGE.split('id="build-titan"', 1)[1].split('id="build-hoag"', 1)[0]
        hoag = PAGE.split('id="build-hoag"', 1)[1].split('<!-- ===================== AI SECTION', 1)[0]
        for term in ("React", "SQLite", "Node.js", "OAuth", "exercise", "https://alext.io/learn/"):
            self.assertIn(term, learn)
        for term in ("Airtable", "MongoDB", "Snowflake", "ServiceNow", "Bedrock", "MCP", "DAG"):
            self.assertIn(term, titan)
        for term in ("Epic", "FHIR", "Cloverleaf", "HL7", "React", "Next.js"):
            self.assertIn(term, hoag)
        # Avoid repeating any private server addresses in public case studies.
        self.assertNotIn("ieprod.hoag.org", hoag)
        self.assertNotIn("premium99.web-hosting.com", PAGE)

    def test_project_preview_and_search_routes_are_static(self):
        self.assertIn('snapshot:"learning-lab", caseId:"build-learn"', PAGE)
        self.assertIn('href="#case-studies"', PAGE)
        self.assertIn('href="https://alext.io/learn/"', PAGE)


if __name__ == "__main__":
    unittest.main()
