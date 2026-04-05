export interface Auth0FrontendConfig {
  domain: string;
  clientId: string;
  audience?: string;
  scope?: string;
}

function getEnv(name: string): string {
  return (import.meta.env[name] as string | undefined)?.trim() ?? '';
}

const domain = getEnv('VITE_AUTH0_DOMAIN');
const clientId = getEnv('VITE_AUTH0_CLIENT_ID');
const audience = getEnv('VITE_AUTH0_AUDIENCE');
const scope = getEnv('VITE_AUTH0_SCOPE');

export const auth0Config: Auth0FrontendConfig | null =
  domain && clientId
    ? {
        domain,
        clientId,
        audience: audience || undefined,
        scope: scope || undefined,
      }
    : null;

export function isAuth0EnabledOnFrontend(): boolean {
  return auth0Config !== null;
}
