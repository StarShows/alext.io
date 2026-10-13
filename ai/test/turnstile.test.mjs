import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTurnstileVerifier } from '../dist/security.js';
import { config } from './helpers.mjs';
function result(overrides = {}) { return { success: true, hostname: 'alext.io', action: 'portfolio_session', challenge_ts: new Date().toISOString(), ...overrides }; }
test('Turnstile uses the fixed verification URL and rejects token replay', async () => {
  let calls = 0;
  const verifier = makeTurnstileVerifier(config, async (url, options) => { calls++; assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify'); assert.equal(options.redirect, 'error'); assert.equal(JSON.parse(options.body).remoteip, '203.0.113.7'); return new Response(JSON.stringify(result())); });
  assert.equal(await verifier('valid', '203.0.113.7', new AbortController().signal), true);
  assert.equal(await verifier('valid', '203.0.113.7', new AbortController().signal), false); assert.equal(calls, 1);
});
test('Turnstile validates hostname, action, age and success independently', async () => {
  for (const changed of [{ success: false }, { hostname: 'evil.example' }, { action: 'other' }, { challenge_ts: 'not-a-date' }, { challenge_ts: new Date(Date.now() - 301000).toISOString() }, { challenge_ts: new Date(Date.now() + 60000).toISOString() }]) {
    const verifier = makeTurnstileVerifier(config, async () => new Response(JSON.stringify(result(changed))));
    assert.equal(await verifier('token', '203.0.113.7', new AbortController().signal), false);
  }
});
test('Turnstile network errors, invalid JSON and excessive responses fail closed', async () => {
  for (const request of [async () => { throw new Error('network'); }, async () => new Response('bad json'), async () => new Response('a'.repeat(9000)), async () => new Response('', { status: 503 })]) {
    const verifier = makeTurnstileVerifier(config, request); assert.equal(await verifier('token', '203.0.113.7', new AbortController().signal), false);
  }
});
