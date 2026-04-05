import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { clearAuthToken, setAuthTokenProvider } from '../api/client';
import { auth0Config, hasAuth0CoreConfig, isAuth0Enabled } from './config';

function Auth0TokenBridgeInner() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    const provider = async () => {
      if (!isAuthenticated) return null;
      try {
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: auth0Config.audience,
            scope: auth0Config.scope,
          },
        });
        const normalized = token.trim();
        return normalized ? normalized : null;
      } catch {
        return null;
      }
    };

    setAuthTokenProvider(provider);
    if (!isAuthenticated) {
      clearAuthToken();
    }

    return () => setAuthTokenProvider(null);
  }, [getAccessTokenSilently, isAuthenticated]);

  return null;
}

export default function AuthTokenBridge() {
  if (!isAuth0Enabled || !hasAuth0CoreConfig) {
    return null;
  }

  return <Auth0TokenBridgeInner />;
}
