import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
test('container and tunnel templates do not publish local services or grant host privileges', async () => {
  const compose = await readFile(new URL('../compose.yml', import.meta.url), 'utf8');
  assert(!/^\s+ports:/m.test(compose));
  assert(
    !/privileged:\s*true|network_mode:\s*host|docker\.sock|\/Users\/|\/var\/run\/docker/.test(
      compose,
    ),
  );
  assert.match(compose, /internal: true/);
  assert.match(compose, /OLLAMA_NO_CLOUD: '1'/);
  assert.match(compose, /models:\/models:ro/);
  const tunnel = await readFile(new URL('../ops/cloudflared.yml.example', import.meta.url), 'utf8');
  assert.match(tunnel, /hostname: ai\.alext\.io/);
  assert.match(tunnel, /service: http_status:404/);
  assert(!/11434|19091|ssh:/.test(tunnel));
});
test('evaluation dataset contains at least 50 unique cases spanning important boundaries', async () => {
  const { cases } = JSON.parse(
    await readFile(new URL('../knowledge/evaluation.json', import.meta.url), 'utf8'),
  );
  assert(cases.length >= 50);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  for (const category of [
    'recruiting',
    'project',
    'approach',
    'followup',
    'scope',
    'injection',
    'missing',
    'confidential',
    'contact',
  ])
    assert(cases.some((item) => item.category === category));
});
test('operator shell scripts parse without executing or changing the host', () => {
  for (const name of ['inspect-mac.sh', 'start-approved.sh'])
    execFileSync('sh', ['-n', new URL(`../scripts/${name}`, import.meta.url).pathname]);
});
