import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { clearAuthToken, setAuthTokenProvider } from '../api/client';
import { auth0Config, hasAuth0CoreConfig, isAuth0Enabled } from './config';
import { clearAuth0ProfileBootstrap, saveAuth0ProfileBootstrap } from './profileBootstrap';

function Auth0TokenBridgeInner() {
  const { isAuthenticated, getAccessTokenSilently, user } = useAuth0();

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

  useEffect(() => {
    if (!isAuthenticated) {
      clearAuth0ProfileBootstrap();
      return;
    }
    saveAuth0ProfileBootstrap(user);
  }, [isAuthenticated, user]);

  return null;
}

export default function AuthTokenBridge() {
  if (!isAuth0Enabled || !hasAuth0CoreConfig) {
    return null;
  }

  return <Auth0TokenBridgeInner />;
}
