import crypto from 'node:crypto';

const b64url = (buf) => buf.toString('base64url');

export const randomToken = (bytes = 32) => b64url(crypto.randomBytes(bytes));

// PKCE (RFC 7636): verifier is secret, challenge = BASE64URL(SHA256(verifier)).
export function makePkce() {
  const verifier = randomToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(provider, { redirectUri, state, challenge }) {
  const url = new URL(provider.authorizeUrl());
  url.search = new URLSearchParams({
    client_id: provider.clientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: provider.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...provider.extraAuthParams,
  }).toString();
  return url.toString();
}

async function tokenRequest(provider, params) {
  const r = await fetch(provider.tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: provider.clientId(),
      client_secret: provider.clientSecret(),
      ...params,
    }),
  });
  const body = await r.json().catch(() => ({}));
  // GitHub returns HTTP 200 with an "error" field on failure.
  if (!r.ok || body.error) {
    throw new Error(`Token endpoint error: ${body.error || r.status} ${body.error_description || ''}`.trim());
  }
  return body;
}

export const exchangeCode = (provider, { code, redirectUri, verifier }) =>
  tokenRequest(provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

export const refreshAccessToken = (provider, refreshToken) =>
  tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: refreshToken });
