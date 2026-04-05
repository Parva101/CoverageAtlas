import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Heart, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
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
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="app-surface max-w-md space-y-3 p-8">
          <div className="mx-auto flex h-14 w-14 animate-float-soft items-center justify-center rounded-2xl bg-blue-100">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Loading CoverageAtlas...</h1>
          <p className="text-sm text-slate-500">Verifying your login and synchronizing your access token.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="app-surface max-w-md p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100">
            <Heart className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Sign in to continue</h1>
          <p className="mt-2 text-sm text-slate-500">
            CoverageAtlas uses Auth0 login to protect policy query APIs.
          </p>
          <button
            onClick={() => void loginWithRedirect()}
            className="app-button-primary mt-6 w-full"
          >
            <ShieldCheck className="h-4 w-4" />
            Sign in with Auth0
          </button>
        </div>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="app-surface max-w-lg p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100">
            <ShieldAlert className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Token Error</h1>
          <p className="mt-2 text-sm text-slate-600">{tokenError}</p>
          <button
            onClick={() => window.location.reload()}
            className="app-button-secondary mt-6"
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
