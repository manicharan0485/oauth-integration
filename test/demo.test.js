import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makePkce, buildAuthorizeUrl } from '../src/oauth.js';
import { verifyGithubSignature, handleGraphNotification } from '../src/webhooks.js';
import { providers } from '../src/providers.js';
import { createApp } from '../src/server.js';

test('PKCE challenge is base64url(SHA256(verifier))', () => {
  const { verifier, challenge } = makePkce();
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(verifier.length >= 43);
});

test('authorize URL carries state, PKCE and scopes', () => {
  process.env.MS_CLIENT_ID = 'cid';
  const u = new URL(buildAuthorizeUrl(providers.microsoft, { redirectUri: 'http://x/cb', state: 's1', challenge: 'c1' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), 's1');
  assert.match(u.searchParams.get('scope'), /User\.Read/);
});

test('GitHub webhook signature', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 'k').update(body).digest('hex');
  assert.equal(verifyGithubSignature(body, sig, 'k'), true);
  assert.equal(verifyGithubSignature(body, sig, 'wrong'), false);
  assert.equal(verifyGithubSignature(body, 'sha256=00', 'k'), false);
  assert.equal(verifyGithubSignature(body, undefined, 'k'), false);
});

test('Graph validation handshake and clientState check', () => {
  assert.deepEqual(handleGraphNotification({ query: { validationToken: 'abc' }, body: {}, clientState: 's' }).body, 'abc');
  assert.equal(handleGraphNotification({ query: {}, body: { value: [{ clientState: 'bad' }] }, clientState: 's' }).status, 401);
  assert.equal(handleGraphNotification({ query: {}, body: { value: [{ clientState: 's' }] }, clientState: 's' }).status, 202);
});

test('end to end: webhook endpoint + state rejection', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'sek';
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const body = JSON.stringify({ action: 'opened', repository: { full_name: 'o/r' } });
    const sig = 'sha256=' + crypto.createHmac('sha256', 'sek').update(body).digest('hex');
    const ok = await fetch(`${base}/webhooks/github`, { method: 'POST', body, headers: { 'x-hub-signature-256': sig, 'x-github-event': 'issues' } });
    assert.equal(ok.status, 204);
    const bad = await fetch(`${base}/webhooks/github`, { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=00' } });
    assert.equal(bad.status, 401);
    const events = await (await fetch(`${base}/events`)).json();
    assert.equal(events[0].repo, 'o/r');
    const cb = await fetch(`${base}/auth/github/callback?code=x&state=forged`);
    assert.equal(cb.status, 400);
    const v = await fetch(`${base}/webhooks/graph?validationToken=tok`, { method: 'POST' });
    assert.equal(await v.text(), 'tok');
  } finally { srv.close(); }
});
