# Recruiter skill search and project previews

## Recruiter search

The navigation's Search skills control opens an accessible command-style search
dialog. It is also available from the mobile menu and with Ctrl+K, Cmd+K, or
the / shortcut when the visitor is not typing.

- Indexes only evidence already displayed on the homepage: experience cards,
  role history, project cards, AI engineering examples, skill-map nodes, and
  relevant static sections.
- Searches technology names and keywords, with aliases such as TS for
  TypeScript, ReactJS for React, and Node for Node.js.
- Prioritizes exact matching skills and concrete experience, never invented
  confidence percentages or fabricated capabilities.
- Clicking a result selects the graph node where relevant, scrolls to the
  specific proof card, and temporarily highlights matching words.
- Queries remain entirely in the visitor's browser with no external API.
- Includes keyboard shortcuts, arrow navigation, Escape, mobile layouts,
  visible focus styles, and reduced-motion support.

## Resilient previews

Cross-origin iframe restrictions cannot reliably be detected from the parent
page. In many browsers, an iframe can fire its load event even if the
destination refused embedding using X-Frame-Options or frame-ancestors.
Previously, that left empty or broken frames.

Every card now starts with a locally hosted visual fallback. Visitors can try
an interactive view or open the live production website in a separate tab.
The saved visual remains available behind interactive mode, and Back to snapshot
is always reachable. Preview images have subtle scroll-based, transform-only
parallax; reduced-motion preferences are respected.

The fixed source list lives in scripts/deploy/generate_portal_previews.py and
covers eight public portfolio destinations. On each approved production build,
headless Chrome attempts screenshots and compresses successful captures into
1200 x 750 WebP files. If a source cannot be captured, or is a PDF viewer,
the build creates an explicitly labeled Preview unavailable graphic. This is
NOT described as a screenshot. The machine-readable capture-status.json
records captured versus unavailable for each site. Nothing is sent to a
third-party screenshot service at visitor time.

### Deployment and verification

The approved Namecheap release serves images from /images/previews/ on
alext.io. The static packager includes only eight fixed WebP names and the
status manifest. It rejects missing files and continues to exclude protected
or unrelated site areas such as /learn.

CI performs desktop/mobile browser smoke testing and publishes a temporary
recruiter-project-previews artifact for review. Production verification fetches
and validates each WebP and its manifest. The screenshots refresh only during
an approved release, never via an unreviewed scheduled deploy.

Some older portfolio destinations, including the PDF resume and archived site,
may no longer be available at their referenced paths. This change preserves
the original URLs rather than substituting unrelated content. When a source
cannot be captured, the UI labels it accurately and retains the direct link.

### Public screenshot permissions

The SSH deploy script intentionally runs with umask 077 to protect private
staging and backup files. Newly created public directories otherwise inherit
mode 0700 and cannot be traversed by the static web server. The deploy script
now explicitly sets only the allowlisted images/previews directory to 0755,
including when a prior failed deployment left it mode 0700. WebP and JSON files
remain mode 0644. No private state directory has its permissions widened.
Regression tests cover fresh and previously existing private preview folders.

### Engineering build stories

The homepage has three static, SEO-readable, keyboard-accessible engineering
case studies for the Learning Lab, Disney Titan, and Hoag/Epic. They describe
the engineering story, implementation boundaries, conceptual request/data
flows and stack without exposing private project source or patient details.

The Learning Lab also appears as a public project card with a locally captured
screenshot from https://alext.io/learn/. The fixed capture allowlist now has
eight destinations. The recruiter search indexes all three article bodies as
high-confidence "Engineering case study" records. They are sourced solely
from site content, with no external search service.

Production deployments remain owner-approved. PR validation generates eight
WebP assets and tests both desktop and mobile case study accessibility.


### DinnerRadar engineering story

The build-stories section now includes a fourth static, SEO-accessible story
for DinnerRadar, based on the private implementation repository's actual
Next.js/React/TypeScript, SQLite WAL + FTS5, OpenStreetMap/Overpass worker
pipeline, local LLM with user-priority leases, SSE progress streaming,
success-only usage quotas, passwordless authentication, Stripe billing,
and versioned CI + QA releases with rollback.

The existing DinnerRadar portfolio card links to the corresponding story;
no new screenshot source, backend integration, or production dependency is
introduced. Recruiter search indexes the case study and maps short terms
such as OSM and SSE to the demonstrated architecture.

## Recruiter search stability and performance

The public evidence finder originally spotlighted entire long case-study
articles. Some of those articles exceed 2,900 CSS pixels on phones. Styling
their full surfaces with animated filters, glows and scaling borders creates
an unusually large paint/compositing workload, which can make mobile browsers
stutter or terminate under memory pressure. This is a credible risk, but
a production-device crash has not been independently reproduced.

The optimized implementation:

- Finds the smallest relevant evidence block inside a case study and scrolls
  to that block instead of highlighting the entire multi-screen article.
- Uses a lightweight outline and short border pulse instead of animated
  brightness filters and scaling multi-megapixel card layers.
- Removes full-viewport backdrop blur on phones and reduced-motion devices,
  limits blurred surfaces on desktop, and contains modal paint work.
- Updates pointer-driven liquid effects at most once per animation frame and
  never scrolls result items when the pointer merely passes over them.
- Caps DOM keyword marks and scanned text nodes.
- Cancels pending search and focus timers on closing or reopening, and
  refreshes the result set synchronously when Enter beats debounce.
- Versions the JS and CSS URLs to prevent stale browser caches on release.

In addition to regular browser smoke tests, the CI suite performs quick
successive search-and-select cycles on real Chromium desktop and mobile
viewports, checks for page errors and browser crashes, verifies tiny spotlight
surfaces, checks mobile blur fallbacks, and exercises paste-style input.

This is a front-end robustness improvement. No new endpoint, telemetry,
external service, permission, or private data is introduced.

### Realtor Studio and WordPress engineering story

The homepage includes a fifth long-form case study on the developer's
WordPress experience, including the first paid custom theme/plugin work in
2008, more than eight custom plugins and themes built across WordPress work,
traditional PHP themes, and headless WordPress CMS implementations.

The case study contrasts hand-coded, pre-AI design and development with
present-day AI-assisted exploration without implying that earlier work was
AI-generated. Its conceptual architecture explicitly presents traditional
WordPress theme rendering and headless CMS API delivery as **alternatives**,
not consecutive processing steps.

The existing Realtor Studio card links to `#build-realtor-studio`. The
local recruiter search automatically indexes the article's details on
PHP, themes, WordPress hooks, headless CMS, APIs, design and integrations.
Static content regressions and desktop/mobile browser smoke tests verify
the story, deep link, search relevance, and responsive layout. No new
screenshot target, API dependency or private client code is introduced.
