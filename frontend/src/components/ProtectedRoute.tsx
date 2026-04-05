import type { ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Navigate, useLocation } from 'react-router-dom';
import { auth0ConfigError, hasAuth0CoreConfig, isAuth0Enabled } from '../auth/config';

interface Props {
  children: ReactNode;
}

function Auth0ProtectedRoute({ children }: Props) {
  const { isAuthenticated, isLoading } = useAuth0();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center">
        <p className="text-sm text-slate-500">Checking your session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

export default function ProtectedRoute({ children }: Props) {
  if (!isAuth0Enabled) {
    return <>{children}</>;
  }

  if (!hasAuth0CoreConfig) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="max-w-lg bg-white border border-red-200 rounded-2xl p-6 text-sm text-red-700 space-y-2">
          <h1 className="text-base font-semibold text-red-800">Auth0 configuration is incomplete</h1>
          <p>{auth0ConfigError}</p>
          <p>Set the missing `VITE_AUTH0_*` variables and reload the frontend.</p>
        </div>
      </div>
    );
  }

  return <Auth0ProtectedRoute>{children}</Auth0ProtectedRoute>;
}
