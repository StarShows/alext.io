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
covers seven public portfolio destinations. On each approved production build,
headless Chrome attempts screenshots and compresses successful captures into
1200 x 750 WebP files. If a source cannot be captured, or is a PDF viewer,
the build creates an explicitly labeled Preview unavailable graphic. This is
NOT described as a screenshot. The machine-readable capture-status.json
records captured versus unavailable for each site. Nothing is sent to a
third-party screenshot service at visitor time.

### Deployment and verification

The approved Namecheap release serves images from /images/previews/ on
alext.io. The static packager includes only seven fixed WebP names and the
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
