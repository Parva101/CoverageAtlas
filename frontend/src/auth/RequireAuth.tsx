import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { clearAuthToken, setAuthToken } from '../api/client';
import { auth0Config } from './config';

function RequireAuthEnabled({ children }: PropsWithChildren) {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently } = useAuth0();
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    let mounted = true;

    const syncToken = async () => {
      if (isLoading) return;

      if (!isAuthenticated) {
        clearAuthToken();
        if (mounted) {
          setTokenReady(false);
          setTokenError('');
        }
        return;
      }

      try {
        const token = await getAccessTokenSilently();
        if (!mounted) return;
        setAuthToken(token);
        setTokenReady(true);
        setTokenError('');
      } catch (e: unknown) {
        if (!mounted) return;
        clearAuthToken();
        setTokenReady(false);
        setTokenError(e instanceof Error ? e.message : 'Unable to fetch access token.');
      }
    };

    void syncToken();
    return () => {
      mounted = false;
    };
  }, [isLoading, isAuthenticated, getAccessTokenSilently]);

  if (isLoading || (isAuthenticated && !tokenReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Loading CoverageAtlas...</h1>
          <p className="text-sm text-slate-500 mt-2">Verifying your login and access token.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-semibold text-slate-900">Sign in to continue</h1>
          <p className="text-sm text-slate-500 mt-2">
            CoverageAtlas uses Auth0 login to protect policy query APIs.
          </p>
          <button
            onClick={() => void loginWithRedirect()}
            className="mt-5 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Sign in with Auth0
          </button>
        </div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center">
        <div className="max-w-lg">
          <h1 className="text-xl font-semibold text-slate-900">Token Error</h1>
          <p className="text-sm text-slate-600 mt-2">{tokenError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 px-5 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function RequireAuth({ children }: PropsWithChildren) {
  if (!auth0Config) {
    return <>{children}</>;
  }
  return <RequireAuthEnabled>{children}</RequireAuthEnabled>;
}
