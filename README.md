# OAuth 2.0 Integration Demo

[![Tests](https://github.com/manicharan0485/oauth-integration/actions/workflows/test.yml/badge.svg)](https://github.com/manicharan0485/oauth-integration/actions/workflows/test.yml)

A small Node.js app showing the pieces of a real API integration:

- **OAuth 2.0 authorization code flow with PKCE (S256)** against **Microsoft Entra ID** and **GitHub**
- `state` parameter for CSRF protection, bound to the browser session
- Server-side token exchange with a client secret, plus **refresh-token** handling (Entra ID)
- Authenticated API calls: **Microsoft Graph** `GET /v1.0/me` and **GitHub** `GET /user`
- **Webhooks**
  - GitHub: HMAC-SHA256 signature verification on the raw body, constant-time compare
  - Microsoft Graph change notifications: `validationToken` handshake and `clientState` check
- Tests with `node --test` (no test framework needed)

## Run it

```bash
npm install
cp .env.example .env   # fill in values, then: export $(grep -v '^#' .env | xargs)
npm start              # http://localhost:3000
npm test
```

### Microsoft Entra ID setup
1. Entra ID > App registrations > New registration. Redirect URI (Web): `http://localhost:3000/auth/microsoft/callback`.
2. Certificates & secrets > New client secret. Put the value in `MS_CLIENT_SECRET`, the Application (client) ID in `MS_CLIENT_ID`.
3. API permissions: delegated `User.Read` (already added by default).

### GitHub setup
1. Settings > Developer settings > OAuth Apps > New. Callback URL: `http://localhost:3000/auth/github/callback`.
2. Put the client ID and secret in `.env`.
3. For webhooks, expose the app with a tunnel (e.g. `ngrok http 3000`), add a repo webhook pointing to `https://<tunnel>/webhooks/github`, content type `application/json`, and the same secret as `GITHUB_WEBHOOK_SECRET`. Received events appear at `/events`.

### Graph webhooks (optional)
Create a subscription (`POST /v1.0/subscriptions`) with `notificationUrl` = `https://<tunnel>/webhooks/graph` and `clientState` = `GRAPH_CLIENT_STATE`. Graph first sends a validation request, which the app answers automatically.

## Flow

```
Browser -> /auth/:provider        generate state + PKCE verifier, redirect to authorize endpoint
Provider -> /auth/:provider/callback?code&state
            verify state, POST code + code_verifier + client secret to token endpoint
            call the provider API with the access token, store session server-side
```

## Design notes and limits
- Tokens and sessions live in memory, and only a random session ID is in the (signed, httpOnly) cookie. A production app would use an encrypted store (Redis/DB) and a key vault.
- Delegated (user) flow shown here. For unattended admin scripts, Entra ID's client credentials flow (app-only, certificate preferred) is the equivalent.
- GitHub OAuth Apps do not issue refresh tokens by default; GitHub Apps do.
- The webhook handlers acknowledge quickly; real systems would queue the work and deduplicate by delivery ID.

MIT licensed.
