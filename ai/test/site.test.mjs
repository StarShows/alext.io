import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildSite } from '../scripts/build-site.mjs';
test('site integration preserves every original homepage byte and stays lightweight', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alext-site-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = pathToFileURL(directory + '/');
  const result = await buildSite({
    enabled: true,
    testing: true,
    siteKey: '1x00000000000000000000AA',
    output,
  });
  assert.equal(result.html.replace(result.insertion, ''), result.original);
  assert(result.html.includes('data-alext-ai="v1"'));
  assert(gzipSync(result.insertion).length < 15000);
  assert(result.manifest.widgetBytes < 40000);
  assert(!result.html.includes('fixture-secret-never-used-in-production'));
  assert.equal(
    (await readFile(new URL('manifest.json', output), 'utf8')).includes('integratedSha256'),
    true,
  );
});
test('disabled integration produces the exact original homepage; production rejects test site keys', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alext-disabled-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = pathToFileURL(directory + '/');
  const result = await buildSite({ output });
  assert.equal(result.html, result.original);
  await assert.rejects(buildSite({ enabled: true, siteKey: '1x00000000000000000000AA', output }));
});
