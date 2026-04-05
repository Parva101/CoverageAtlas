import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { Link, useLocation } from 'react-router-dom';
import { clearAuthToken } from '../api/client';
import { auth0ConfigError, hasAuth0CoreConfig, isAuth0Enabled } from '../auth/config';

function LocalBypassPanel() {
  return (
    <div className="p-4 border-t border-slate-700/60 space-y-2">
      <p className="text-xs font-semibold text-slate-300">Authentication</p>
      <p className="text-xs text-slate-400 leading-relaxed">
        Auth0 is disabled. Backend routes run in local bypass mode.
      </p>
    </div>
  );
}

function InvalidConfigPanel() {
  return (
    <div className="p-4 border-t border-slate-700/60 space-y-2">
      <p className="text-xs font-semibold text-amber-300">Authentication</p>
      <p className="text-xs text-amber-200/90 leading-relaxed">{auth0ConfigError}</p>
    </div>
  );
}

function Auth0Panel() {
  const { isAuthenticated, isLoading, user, logout } = useAuth0();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  if (isLoading) {
    return (
      <div className="p-4 border-t border-slate-700/60">
        <p className="text-xs text-slate-400">Checking session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 border-t border-slate-700/60 space-y-2">
        <p className="text-xs font-semibold text-slate-300">Authentication</p>
        <Link
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="inline-flex items-center justify-center w-full px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
        >
          Log in
        </Link>
      </div>
    );
  }

  const displayName = user?.name || user?.nickname || user?.email || 'Authenticated user';

  return (
    <div className="p-4 border-t border-slate-700/60 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-600/30 text-blue-300 grid place-items-center">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100 truncate">{displayName}</p>
          <p className="text-[11px] text-slate-400 truncate">{user?.email || 'Signed in via Auth0'}</p>
        </div>
      </div>
      <button
        onClick={() => {
          clearAuthToken();
          logout({ logoutParams: { returnTo: window.location.origin } });
        }}
        className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-slate-700 text-slate-200 text-xs font-semibold hover:bg-slate-600 transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
        Log out
      </button>
    </div>
  );
}

export default function AuthPanel() {
  if (!isAuth0Enabled) {
    return <LocalBypassPanel />;
  }

  if (!hasAuth0CoreConfig) {
    return <InvalidConfigPanel />;
  }

  return <Auth0Panel />;
}
