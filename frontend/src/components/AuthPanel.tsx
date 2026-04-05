import { useAuth0 } from '@auth0/auth0-react';
import { Loader2, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { auth0Config } from '../auth/config';

function AuthPanelDisabled() {
  return (
    <div className="app-surface space-y-2 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <ShieldCheck className="h-4 w-4 text-slate-400" />
        Authentication
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Auth0 is not configured in this frontend environment. Add `VITE_AUTH0_*` variables to enable hosted login.
      </p>
    </div>
  );
}

function AuthPanelEnabled() {
  const { isLoading, isAuthenticated, user, loginWithRedirect, logout } = useAuth0();

  return (
    <div className="app-surface space-y-3 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        Authentication
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking session...
        </div>
      )}

      {!isLoading && !isAuthenticated && (
        <button
          onClick={() => void loginWithRedirect()}
          className="app-button-primary w-full text-xs"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in with Auth0
        </button>
      )}

      {!isLoading && isAuthenticated && (
        <>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <UserRound className="h-4 w-4 text-emerald-700" />
              <p className="text-xs font-semibold text-emerald-800">Signed In</p>
            </div>
            <p className="text-xs text-emerald-900">
              {user?.name || user?.email || 'Authenticated user'}
            </p>
            {user?.email && <p className="mt-1 text-[11px] text-emerald-700/90">{user.email}</p>}
          </div>

          <button
            onClick={() =>
              void logout({
                logoutParams: {
                  returnTo: window.location.origin,
                },
              })
            }
            className="app-button-secondary w-full text-xs"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </>
      )}
    </div>
  );
}

export default function AuthPanel() {
  if (!auth0Config) {
    return <AuthPanelDisabled />;
  }
  return <AuthPanelEnabled />;
}
