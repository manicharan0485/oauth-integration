// Provider definitions. Both use the OAuth 2.0 authorization code flow with PKCE.
const tenant = () => process.env.MS_TENANT || 'common';

export const providers = {
  microsoft: {
    label: 'Microsoft (Entra ID)',
    authorizeUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`,
    tokenUrl: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
    scopes: ['openid', 'profile', 'offline_access', 'User.Read'],
    clientId: () => process.env.MS_CLIENT_ID,
    clientSecret: () => process.env.MS_CLIENT_SECRET,
    extraAuthParams: { response_mode: 'query' },
    // Calls Microsoft Graph with the delegated access token.
    fetchProfile: async (accessToken) => {
      const r = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw new Error(`Graph /me failed: ${r.status} ${await r.text()}`);
      return r.json();
    },
  },
  github: {
    label: 'GitHub',
    authorizeUrl: () => 'https://github.com/login/oauth/authorize',
    tokenUrl: () => 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    extraAuthParams: {},
    fetchProfile: async (accessToken) => {
      const r = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'oauth-integration-demo',
        },
      });
      if (!r.ok) throw new Error(`GitHub /user failed: ${r.status} ${await r.text()}`);
      return r.json();
    },
  },
};
