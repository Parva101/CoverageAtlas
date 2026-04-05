import type { ReactNode } from 'react';
import { Auth0Provider } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { auth0Config, hasAuth0CoreConfig, isAuth0Enabled } from './config';

interface Props {
  children: ReactNode;
}

interface RedirectState {
  returnTo?: string;
}

function Auth0ProviderBridge({ children }: Props) {
  const navigate = useNavigate();

  const onRedirectCallback = (appState?: RedirectState) => {
    const returnTo = appState?.returnTo || '/ask';
    navigate(returnTo, { replace: true });
  };

  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        redirect_uri: auth0Config.redirectUri,
        audience: auth0Config.audience,
        scope: auth0Config.scope,
      }}
      cacheLocation={auth0Config.cacheLocation}
      useRefreshTokens={auth0Config.useRefreshTokens}
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}

export default function AppAuthProvider({ children }: Props) {
  if (!isAuth0Enabled || !hasAuth0CoreConfig) {
    return <>{children}</>;
  }

  return <Auth0ProviderBridge>{children}</Auth0ProviderBridge>;
}
