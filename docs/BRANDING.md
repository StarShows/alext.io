# Branding assets

The site serves a vector favicon, PNG and ICO fallbacks, an iOS touch icon,
Android home-screen icons, and a 1200 x 630 JPEG social sharing image.

- Editable vector: `images/favicon.svg`.
- Mobile manifest: `images/site-manifest.json`.
- Generated assets (untracked): `favicon.ico`, `favicon-16.png`,
  `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`,
  `icon-512.png`, `social-preview.jpg` in `images/`.
- Generation: `python3 -m pip install Pillow==11.3.0` and then
  `python3 scripts/deploy/generate_brand_assets.py`.

Both the PR validation and the production build generate these binaries in an
isolated Python virtual environment before packaging. Only the explicit seven
generated filenames are allowed into the deployment archive; unrelated
untracked files remain excluded. The release fails if an OG card is referenced
but its required assets are missing.

Metadata in `index.html` uses absolute HTTPS image URLs for Open Graph and
Twitter cards. Social networks can cache old images, so refresh their preview
caches after the approved release has been deployed.
