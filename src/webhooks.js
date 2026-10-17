import crypto from 'node:crypto';

// GitHub signs the raw body with HMAC-SHA256: header "X-Hub-Signature-256: sha256=<hex>".
export function verifyGithubSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let given;
  try {
    given = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Microsoft Graph change notifications:
//  1. On subscription creation Graph POSTs ?validationToken=... and expects it echoed back as text/plain.
//  2. Real notifications carry the clientState we chose when subscribing; reject mismatches.
export function handleGraphNotification({ query, body, clientState }) {
  if (query.validationToken) {
    return { status: 200, contentType: 'text/plain', body: query.validationToken };
  }
  const items = Array.isArray(body?.value) ? body.value : [];
  const valid = items.filter((n) => clientState && n.clientState === clientState);
  if (valid.length !== items.length) return { status: 401, body: 'invalid clientState' };
  return { status: 202, events: valid };
}
