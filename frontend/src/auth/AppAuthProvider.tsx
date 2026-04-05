import type { PropsWithChildren } from 'react';
import { Auth0Provider } from '@auth0/auth0-react';
import { auth0Config } from './config';

export default function AppAuthProvider({ children }: PropsWithChildren) {
  if (!auth0Config) {
    return <>{children}</>;
  }

  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      cacheLocation="localstorage"
      useRefreshTokens
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Config.audience,
        scope: auth0Config.scope,
      }}
    >
      {children}
    </Auth0Provider>
  );
}
