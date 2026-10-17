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

## Demo (GitHub sign-in)

Run locally at `http://localhost:3000`.

**1. Signed out.** Both providers show a Sign in link.

![Signed out](docs/01-signed-out.png)

**2. Redirect to GitHub.** The browser is sent to GitHub's authorize endpoint with `state` and the PKCE challenge. The user logs in at GitHub, so the app never sees the password.

![GitHub redirect](docs/02-github-redirect.png)

**3. Signed in.** The server exchanges the code for a token and calls `GET /user`. The page shows the user and granted scopes.

![Signed in](docs/03-signed-in.png)

GitHub sign-in was verified live. Microsoft Entra ID sign-in is implemented and unit-tested but has not been run against a live tenant.

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

## Architecture

How the modules in `src/` fit together, in two parts. Based on a diagram generated with [GitDiagram](https://gitdiagram.com/manicharan0485/oauth-integration).

### Sign-in and API calls

```mermaid
flowchart LR
  browser(("Browser"))
  idp{{"Entra ID / GitHub"}}
  api{{"Graph / GitHub API"}}

  subgraph app["App (src/)"]
    server["HTTP routes<br/>server.js"]
    session[("Session state<br/>server.js")]
    oauth["OAuth and PKCE<br/>oauth.js"]
    providers["Provider config<br/>providers.js"]
  end

  browser -->|"1. starts sign-in"| server
  server -->|"2. stores state + verifier"| session
  server -->|"3. builds redirect"| oauth
  oauth -->|"reads endpoints"| providers
  browser -->|"4. follows redirect, logs in"| idp
  idp -->|"5. returns code + state"| server
  server -->|"6. checks state"| session
  server -->|"7. exchanges code"| oauth
  oauth -->|"8. token request"| idp
  server -->|"9. fetches profile"| providers
  providers -->|"10. API call with token"| api
  server -->|"11. stores tokens + profile"| session

  classDef blue fill:#dbeafe,stroke:#2563eb,color:#172554
  classDef amber fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef indigo fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  class oauth,providers,browser blue
  class server,session amber
  class idp,api indigo
```

### Webhooks

```mermaid
flowchart LR
  gh(("GitHub"))
  graph(("Microsoft Graph"))

  subgraph app["App (src/)"]
    server["HTTP routes<br/>server.js"]
    ghcheck["Signature check<br/>webhooks.js"]
    graphcheck["Notification check<br/>webhooks.js"]
    events[("In-memory events<br/>server.js")]
  end

  viewer(("Browser /events"))

  gh -->|"POST /webhooks/github"| server
  server -->|"verify HMAC on raw body"| ghcheck
  ghcheck -->|"valid"| events
  graph -->|"POST /webhooks/graph"| server
  server -->|"validationToken or clientState"| graphcheck
  graphcheck -->|"valid events"| events
  events -->|"read"| viewer

  classDef mint fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef amber fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef blue fill:#dbeafe,stroke:#2563eb,color:#172554
  class ghcheck,graphcheck,gh,graph mint
  class server,events amber
  class viewer blue
```

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
