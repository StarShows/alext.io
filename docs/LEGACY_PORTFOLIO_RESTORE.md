# Original portfolio archive restore

## Historical source

The current homepage is intentionally not changed by this restoration. The
original pre-redesign HTML was saved from the last commit before the
October 12, 2026 homepage replacement:

- Original source: Git commit a3658018^, index.html (blob
  71d3821201f88c972fba27753f21bbea04365883).
- Restored archive path: /public/files/old.html.
- Current homepage retains its existing old-site links.

The production old.html was historically an untracked, manually copied
file. There is therefore no dated Git snapshot of that exact archive on
October 28, 2026. We used the last documented original website source in Git
instead of guessing at edits or replacing it with the new homepage.

## Why the subfolder copy broke

The old document contains relative references to images/avitannenbaum.jpeg,
js/scripts.js, and js/starBackground.js. Under /public/files/old.html
these resolve to /public/files/images/ and /public/files/js/, which
do not match the tracked static assets at the repository root.

A second issue was found by the browser test: the original gradient
was present in the checked-in public/css/styles.css but commented out in
scss/styles.scss. Because CI always compiles SCSS to CSS, every new release
silently erased the original gradient. The source SCSS now explicitly
retains the original 148-degree red-to-blue background.

One HTML base href="/" makes those paths resolve correctly while keeping
the historic design, copy, CSS and animation scripts intact. The legacy
scripts.js also had assumptions about optional DOM elements, which could
throw errors. Those are now guarded. No changes to the modern site's scripts
or styles were necessary.

## Font and stylesheet compatibility (follow-up)

The previous archive restoration still looked wrong because it paired a later
HTML revision (using .container .header, .container .header.h2 and
.container .header.mobile_only) with older SCSS that did not define these
selectors. Every deployment compiled that mismatched SCSS over the original
CSS. The original gradient test passed without validating header typography.

old.html now loads /public/files/old.css, a pinned historical stylesheet
copied from the matching original compiled CSS. It does not rely on the Sass
build, and its original header styles, type sizes, responsive rules and
backgrounds are retained. Its font URL references the existing tracked
/public/fonts/Franklin Gothic Condensed.woff file.

The remote deployment now repairs 0700 permissions only on traversed public
directory ancestors of allowlisted installed files, setting them to 0755.
Private SSH staging and backup directories retain umask 077, and public
asset files retain 0644. Tests verify no private directories are widened.

Browser tests assert the original boxed headings, typography, responsive
mobile-only heading, nonempty WOFF font load, and absence of failed assets.
The HTTPS production smoke check now fetches the archived stylesheet and
font and verifies selectors and font signature before release acceptance.

## Safety

Both archive HTML and assets are part of the allowlisted, checksum-verified
Namecheap release archive. The existing remote deployment backs up any
currently deployed old.html before overwriting it, so automatic rollback
can restore it if smoke checks fail.

CI runs headless Chromium at desktop and phone widths, checking the original
portrait, stylesheet, 100-star field and browser errors. The production
workflow checks HTTPS responses for the archive and its required assets
before accepting a release.

The original site and its historical copy intentionally remain separate from
the modern portfolio and its recruiter search.
