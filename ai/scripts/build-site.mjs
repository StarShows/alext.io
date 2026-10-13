import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = (text) => createHash('sha256').update(text).digest('hex');
export async function buildSite({ enabled = false, siteKey = '', testing = false, output = new URL('../release/', import.meta.url) } = {}) {
  if (enabled && (!/^[A-Za-z0-9_-]{20,100}$/.test(siteKey) || (!testing && /^[123]x000/.test(siteKey)))) throw new Error('A verified production Turnstile site key is required');
  const original = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  if (!original.toLowerCase().includes('</body>') || original.includes('data-alext-ai="v1"')) throw new Error('Homepage integration point is invalid');
  const js = await readFile(new URL('../widget/widget.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../widget/widget.css', import.meta.url), 'utf8');
  if (!js.includes("/* CSS_INJECT */ ''")) throw new Error('Widget stylesheet integration point is invalid');
  const bundle = js.replace("/* CSS_INJECT */ ''", JSON.stringify(css));
  const publicConfig = { enabled, endpoint: 'https://ai.alext.io', siteKey };
  const script = `window.ALEXT_AI_CONFIG = ${JSON.stringify(publicConfig)};\n${bundle}`.replace(/<\/script/gi, '<\\/script');
  const insertion = enabled ? `\n<!-- alext.io AI assistant: opt-in release integration -->\n<script data-alext-ai="v1">\n${script}\n</script>\n` : '';
  const position = original.toLowerCase().lastIndexOf('</body>');
  const html = original.slice(0, position) + insertion + original.slice(position);
  if (html.replace(insertion, '') !== original) throw new Error('Existing homepage bytes changed');
  const manifest = { schemaVersion: 1, enabled, testing, sourceCommit: process.env.GITHUB_SHA ?? 'local-unverified', originalSha256: hash(original), integratedSha256: hash(html), widgetSha256: hash(bundle), widgetBytes: Buffer.byteLength(bundle), generatedAt: new Date().toISOString() };
  await mkdir(output, { recursive: true }); await writeFile(new URL('index.html', output), html); await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
  return { html, insertion, original, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const testing = process.argv.includes('--test');
  const result = await buildSite({ enabled: testing || process.env.AI_WIDGET_ENABLED === 'true', siteKey: testing ? '1x00000000000000000000AA' : process.env.TURNSTILE_SITE_KEY ?? '', testing });
  console.log(JSON.stringify(result.manifest, null, 2));
}
