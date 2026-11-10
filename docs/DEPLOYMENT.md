# alext.io: secure static-site delivery

## What this pipeline deploys

The repository contains a static portfolio served by Namecheap. The production workflow publishes the tracked `index.html`, JavaScript under `js/`, static files under `images/` and `fonts/`, and allowlisted static assets within `public/css/`, `public/files/`, `public/fonts/`, and `public/images/`. SCSS is compiled in the build job, and the resulting `public/css/styles.css` is included in the release.

**It does not deploy or delete `public/sites/`, `/learn`, Node.js applications, the AI assistant service, server configuration, `.env`, WordPress, or content that is only on Namecheap.** New server-side applications need a separate, isolated pipeline, service account, and health checks. A commit removing a static asset will not delete the previously deployed file; do explicit cleanup after reviewing which files are owned by the portfolio.

## Activation checklist (requires repository owner)

1. In GitHub **Settings > Environments**, create `production`. Restrict deployment to `main`. Set a required reviewer, if your review workflow allows it. Deployments can access production secrets only after applicable protection rules are satisfied. Ensure these rules actually exist before enabling automatic deployment.
2. In GitHub **Settings > Rules > Rulesets**, protect `main`: require a pull request, successful `Validate static site and deployment safety` checks, reject force pushes and deletions, and limit bypass permissions. GitHub's availability of some rules depends on the repository plan.
3. Confirm the existing repository variables: `NC_SSH_HOST`, `NC_SSH_USER`, `NC_SSH_PORT`, `NC_WEB_ROOT=/home/realtorstudio/alext.io`. Confirm `NC_SSH_PRIVATE_KEY` and `NC_SSH_KNOWN_HOSTS` secrets. Prefer migrating the secrets to the `production` environment so pull-request jobs have no path to them. Do not paste secret values into issues, pull requests, or chat.
4. Verify the SSH host-key fingerprint against Namecheap through a trusted channel. Do not obtain and trust a new host key from an unauthenticated `ssh-keyscan` alone. Use a dedicated, unprivileged SSH account/key with write access only to the static site and its private deployment state, as practical on the host.
5. Merge the pipeline PR after the `Site security and quality checks` workflow passes. The first merge will build a release but **will not auto-deploy**, because the `NC_AUTO_DEPLOY` variable is absent by default.
6. Manually run **Actions > Deploy alext.io to Namecheap > Run workflow**, choose `deploy`, and confirm the site still works. This confirms SSH, `tar`, `flock`, and checksum verification on the actual host.
7. Once the environment and protections are verified, add repository variable `NC_AUTO_DEPLOY=true`. Then every relevant merge/push to `main` builds a fresh release and deploys through the protected `production` environment.

## Deployment and recovery

- The build job has read-only repository permissions and **no production secrets**. The deploy job runs separately, downloads the artifact from the same workflow run, verifies the artifact checksum, and uses strict SSH host-key verification.
- On the Namecheap host, the deployer extracts a validated release outside the document root (`$HOME/.alext-deploy`). Before changing files, it backs up every destination file that will be touched. It then installs assets and atomically replaces `index.html` last. Both the upload and the installed files are verified. No `rsync --delete` is used.
- A deployment error triggers a best-effort restore of the previous files. If the public HTTPS homepage fails the post-deployment smoke check, the workflow invokes rollback automatically. Backups are held outside the web root and are pruned after 30 days.
- To manually undo the **most recent successful deployment only**, open **Actions > Deploy alext.io to Namecheap > Run workflow**. Choose `rollback` and supply the release ID shown in the successful deployment run, formatted `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT`, such as `123456789-1`. A rollback restores the immediately prior file state, including files created by that release. It cannot skip several releases.
- A simple HTTP smoke check does not prove that every page or client-side feature works. Verify key links and workflows after changing the site. GitHub Actions status cannot establish that the live Namecheap application services are healthy.

## Security boundaries and requirements

- Allowlist plus extension checks prevent accidentally uploading build scripts, credentials, private source files, or directory trees such as `public/sites/`.
- Filenames are checked against unsafe paths; symlinks and unsafe deployment destinations are rejected.
- The workflow uses official GitHub actions pinned to exact commit SHAs, avoids persistent checkout credentials, and disables npm install scripts during the build. No production SSH secrets are available to pull-request jobs.
- The remote host needs `bash`, `tar`, `sha256sum`, `flock`, `find`, `cmp`, `cp`, `mv`, and writable `$HOME/alext.io`. If these requirements are not met, the first deployment will fail safely; inspect the logs before making server changes.
- Static application code is deployed as a unit, but individual assets are updated before the final HTML switch rather than using a fully versioned release-directory/symlink switch. Avoid incompatible in-place asset changes and prefer versioned file names for breaking frontend updates.

## Local verification

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build-css
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/deploy/package_site.py --out /tmp/alext-site-release.tar.gz
```

Do not run the remote deploy scripts directly against a live host unless the archive has been built and verified. Use GitHub Actions for production releases and rollbacks.
