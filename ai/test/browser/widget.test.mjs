import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { buildSite } from '../../scripts/build-site.mjs';
const require = createRequire(import.meta.url);
const { html } = await buildSite({
  enabled: true,
  testing: true,
  siteKey: '1x00000000000000000000AA',
});
await mkdir(new URL('../../reports/', import.meta.url), { recursive: true });
async function pageFixture(t, browserType, viewport) {
  const browser = await browserType.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const calls = [];
  let mode = 'success';
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url === 'https://alext.io/')
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js'))
      return route.fulfill({
        contentType: 'application/javascript',
        body: 'window.turnstile={render:function(el,options){setTimeout(function(){options.callback("browser-fixture-token")},10);return "fixture"},remove:function(){}};',
      });
    if (url.startsWith('https://ai.alext.io/')) {
      calls.push({ url, method: request.method(), data: request.postData() });
      const cors = {
        'access-control-allow-origin': 'https://alext.io',
        'access-control-allow-methods': 'POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization,content-type',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (request.method() === 'DELETE') return route.fulfill({ status: 204, headers: cors });
      if (url.endsWith('/v1/session'))
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify({ token: 'a'.repeat(43), expiresAt: Date.now() + 900000 }),
        });
      if (mode === 'offline')
        return route.fulfill({
          status: 503,
          headers: cors,
          contentType: 'application/json',
          body: '{}',
        });
      const block =
        mode === 'malicious'
          ? {
              id: 'b0',
              kind: 'notice',
              text: '<img src=x onerror="window.__xss=true"> [click](javascript:alert(1)) **bold** `code`',
              citations: [],
            }
          : {
              id: 'b0',
              kind: 'evidence',
              text: 'Alex builds React and Node.js applications.',
              citations: [
                {
                  id: 'portfolio',
                  label: 'Portfolio source',
                  url: 'https://github.com/StarShows/alext.io',
                },
              ],
            };
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'text/event-stream',
        body: `event: meta\ndata: {"status":"working"}\n\nevent: block\ndata: ${JSON.stringify(block)}\n\nevent: done\ndata: {"completed":true}\n\n`,
      });
    }
    return route.abort();
  });
  await page.goto('https://alext.io/');
  return {
    page,
    calls,
    setMode: (value) => {
      mode = value;
    },
  };
}
for (const [name, browserType, viewport] of [
  ['desktop-chromium', chromium, { width: 1440, height: 1000 }],
  ['mobile-webkit', webkit, { width: 390, height: 844 }],
]) {
  test(`${name}: consent, grounded response, focus, layout and accessibility`, async (t) => {
    const { page, calls } = await pageFixture(t, browserType, viewport);
    await page.getByRole('button', { name: 'Ask about Alex' }).click();
    await page.getByLabel('Your question', { exact: true }).fill('What has Alex built with React?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    assert.equal(calls.length, 0);
    assert.match(await page.getByRole('status').textContent(), /privacy/);
    await page.getByLabel('I understand and agree').check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Copy assistant response' }).waitFor();
    assert.match(await page.getByRole('log').textContent(), /React and Node/);
    assert(
      (await page.getByRole('link', { name: 'Portfolio source' }).getAttribute('href')) ===
        'https://github.com/StarShows/alext.io',
    );
    const rect = await page.getByRole('dialog').boundingBox();
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= viewport.width + 1 &&
        rect.y + rect.height <= viewport.height + 1,
    );
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(
          document.querySelector('alext-assistant').shadowRoot.querySelector('dialog'),
          { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } },
        )
      ).violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        description: item.description,
      })),
    );
    assert.deepEqual(violations, []);
    await page.screenshot({ path: new URL(`../../reports/${name}.png`, import.meta.url).pathname });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert(
      await page
        .getByRole('button', { name: 'Ask about Alex' })
        .evaluate((node) => node.getRootNode().activeElement === node),
    );
  });
}
test('browser treats malicious Markdown as inert and provides offline recovery', async (t) => {
  const { page, setMode } = await pageFixture(t, chromium, { width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Ask about Alex' }).click();
  await page.getByLabel('I understand and agree').check();
  setMode('malicious');
  await page.getByLabel('Your question', { exact: true }).fill('Test safe rendering');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Copy assistant response' }).waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('alext-assistant').locator('img').count(), 0);
  assert.equal(await page.locator('alext-assistant').locator('a[href^="javascript:"]').count(), 0);
  setMode('offline');
  await page.getByLabel('Your question', { exact: true }).fill('React experience');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('alext-assistant')
      .shadowRoot.querySelector('[role="status"]')
      .textContent.includes('unavailable'),
  );
  assert(await page.getByRole('link', { name: 'Email Alex', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('alext-assistant').shadowRoot.querySelector('[role="log"]').children
        .length === 0,
  );
});
