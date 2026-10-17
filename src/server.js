import express from 'express';
import cookieSession from 'cookie-session';
import { providers } from './providers.js';
import { makePkce, randomToken, buildAuthorizeUrl, exchangeCode, refreshAccessToken } from './oauth.js';
import { verifyGithubSignature, handleGraphNotification } from './webhooks.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const redirectUri = (name) => `${BASE_URL}/auth/${name}/callback`;

// In-memory stores: fine for a demo. Use Redis/DB in production.
const pending = new Map();  // state -> { provider, verifier, sid }
const sessions = new Map(); // sid -> { [provider]: { tokens, profile } }
const events = [];          // last webhook events, shown at /events

export function createApp() {
  const app = express();
  app.use(cookieSession({
    name: 'sid-cookie',
    keys: [process.env.SESSION_SECRET || 'dev-only-change-me'],
    httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https://'), maxAge: 3600_000,
  }));
  app.use((req, _res, next) => {
    if (!req.session.sid) req.session.sid = randomToken(16);
    if (!sessions.has(req.session.sid)) sessions.set(req.session.sid, {});
    req.store = sessions.get(req.session.sid);
    next();
  });

  // ---- Webhooks: need the RAW body for signature checks, so mounted before any JSON parser.
  app.post('/webhooks/github', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!verifyGithubSignature(req.body, req.get('x-hub-signature-256'), process.env.GITHUB_WEBHOOK_SECRET)) {
      return res.status(401).send('bad signature');
    }
    const payload = JSON.parse(req.body.toString('utf8'));
    events.unshift({ at: new Date().toISOString(), source: 'github', type: req.get('x-github-event'), repo: payload.repository?.full_name, action: payload.action });
    events.length = Math.min(events.length, 50);
    res.status(204).end();
  });

  app.post('/webhooks/graph', express.json(), (req, res) => {
    const out = handleGraphNotification({ query: req.query, body: req.body, clientState: process.env.GRAPH_CLIENT_STATE });
    if (out.contentType) res.type(out.contentType);
    if (out.events) for (const n of out.events) events.unshift({ at: new Date().toISOString(), source: 'graph', type: n.changeType, resource: n.resource });
    res.status(out.status).send(out.body);
  });

  // ---- OAuth 2.0 authorization code flow + PKCE
  app.get('/auth/:provider', (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider) return res.status(404).send('unknown provider');
    if (!provider.clientId()) return res.status(500).send('missing client id, see .env.example');
    const { verifier, challenge } = makePkce();
    const state = randomToken(24); // CSRF protection, bound to this browser session
    pending.set(state, { provider: req.params.provider, verifier, sid: req.session.sid });
    setTimeout(() => pending.delete(state), 10 * 60_000).unref();
    res.redirect(buildAuthorizeUrl(provider, { redirectUri: redirectUri(req.params.provider), state, challenge }));
  });

  app.get('/auth/:provider/callback', async (req, res) => {
    const name = req.params.provider;
    const provider = providers[name];
    const entry = pending.get(req.query.state);
    if (!provider || !entry || entry.provider !== name || entry.sid !== req.session.sid) {
      return res.status(400).send('invalid or expired state');
    }
    pending.delete(req.query.state);
    if (req.query.error) return res.status(400).send(`${req.query.error}: ${req.query.error_description || ''}`);
    try {
      const tokens = await exchangeCode(provider, { code: req.query.code, redirectUri: redirectUri(name), verifier: entry.verifier });
      const profile = await provider.fetchProfile(tokens.access_token);
      req.store[name] = { tokens: { ...tokens, obtainedAt: Date.now() }, profile };
      res.redirect('/');
    } catch (e) {
      res.status(502).send(e.message);
    }
  });

  app.post('/auth/:provider/refresh', async (req, res) => {
    const provider = providers[req.params.provider];
    const rt = req.store[req.params.provider]?.tokens?.refresh_token;
    if (!provider || !rt) return res.status(400).send('no refresh token (GitHub OAuth apps do not issue one by default)');
    try {
      const t = await refreshAccessToken(provider, rt);
      const cur = req.store[req.params.provider];
      cur.tokens = { ...cur.tokens, ...t, obtainedAt: Date.now() };
      res.redirect('/');
    } catch (e) { res.status(502).send(e.message); }
  });

  app.post('/logout', (req, res) => { sessions.delete(req.session.sid); req.session = null; res.redirect('/'); });

  // ---- Tiny UI + JSON API
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  app.get('/', (req, res) => {
    const rows = Object.entries(providers).map(([name, p]) => {
      const s = req.store[name];
      const who = s ? esc(s.profile.displayName || s.profile.login) : null;
      return `<li><b>${esc(p.label)}</b>: ${s
        ? `signed in as ${who} (scopes: ${esc(s.tokens.scope || p.scopes.join(' '))}) <form method=post action=/auth/${name}/refresh style=display:inline><button>Refresh token</button></form>`
        : `<a href="/auth/${name}">Sign in</a>`}</li>`;
    }).join('');
    res.type('html').send(`<!doctype html><meta charset=utf-8><title>OAuth Integration Demo</title>
<body style="font:16px system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem"><h1>OAuth 2.0 Integration Demo</h1>
<ul>${rows}</ul><p><a href=/api/me>/api/me</a> · <a href=/events>/events</a></p>
<form method=post action=/logout><button>Sign out</button></form></body>`);
  });

  app.get('/api/me', (req, res) => {
    res.json(Object.fromEntries(Object.entries(req.store).map(([k, v]) => [k, v.profile])));
  });
  app.get('/events', (_req, res) => res.json(events));
  app.get('/healthz', (_req, res) => res.send('ok'));
  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createApp().listen(PORT, () => console.log(`Listening on ${BASE_URL}`));
}
