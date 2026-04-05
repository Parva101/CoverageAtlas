function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readEnv(name: string): string {
  const value = (import.meta.env[name] as string | undefined) ?? '';
  return value.trim();
}

const rawEnabled = readEnv('VITE_AUTH0_ENABLED');
const domain = readEnv('VITE_AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const clientId = readEnv('VITE_AUTH0_CLIENT_ID');
const audience = readEnv('VITE_AUTH0_AUDIENCE');
const scope = readEnv('VITE_AUTH0_SCOPE') || 'openid profile email';
const redirectUri =
  readEnv('VITE_AUTH0_REDIRECT_URI') ||
  (typeof window !== 'undefined' ? window.location.origin : '');
const cacheLocationRaw = readEnv('VITE_AUTH0_CACHE_LOCATION').toLowerCase();
const useRefreshTokensRaw = readEnv('VITE_AUTH0_USE_REFRESH_TOKENS');

export const hasAuth0CoreConfig = Boolean(domain && clientId && audience);
export const isAuth0Enabled = rawEnabled ? parseBoolean(rawEnabled) : hasAuth0CoreConfig;
export const auth0ConfigError =
  isAuth0Enabled && !hasAuth0CoreConfig
    ? 'Auth0 is enabled but missing one or more required frontend values: VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE.'
    : null;

export const auth0Config = {
  domain,
  clientId,
  audience,
  scope,
  redirectUri,
  cacheLocation:
    cacheLocationRaw === 'memory' ? ('memory' as const) : ('localstorage' as const),
  useRefreshTokens: useRefreshTokensRaw ? parseBoolean(useRefreshTokensRaw) : true,
};
