import { useAuth0 } from '@auth0/auth0-react';
import { Loader2, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { auth0Config } from '../auth/config';

interface AuthPanelProps {
  variant?: 'default' | 'sidebar';
}

function AuthPanelDisabled({ variant = 'default' }: AuthPanelProps) {
  const panelClass = variant === 'sidebar' ? 'app-sidebar-card' : 'app-surface';
  const titleClass = variant === 'sidebar' ? 'text-slate-100' : 'text-slate-700';
  const iconClass = variant === 'sidebar' ? 'text-slate-500' : 'text-slate-400';
  const bodyClass = variant === 'sidebar' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`${panelClass} space-y-2 p-4`}>
      <div className={`flex items-center gap-2 text-xs font-semibold ${titleClass}`}>
        <ShieldCheck className={`h-4 w-4 ${iconClass}`} />
        Authentication
      </div>
      <p className={`text-xs leading-relaxed ${bodyClass}`}>
        Auth0 is not configured in this frontend environment. Add `VITE_AUTH0_*` variables to enable hosted login.
      </p>
    </div>
  );
}

function AuthPanelEnabled({ variant = 'default' }: AuthPanelProps) {
  const panelClass = variant === 'sidebar' ? 'app-sidebar-card' : 'app-surface';
  const titleClass = variant === 'sidebar' ? 'text-slate-100' : 'text-slate-700';
  const loadingClass = variant === 'sidebar' ? 'text-slate-400' : 'text-slate-500';
  const identityCardClass =
    variant === 'sidebar'
      ? 'rounded-xl border border-emerald-800/70 bg-emerald-500/12 p-3'
      : 'rounded-xl border border-emerald-200 bg-emerald-50/70 p-3';
  const identityTitleClass = variant === 'sidebar' ? 'text-emerald-300' : 'text-emerald-800';
  const identityNameClass = variant === 'sidebar' ? 'text-emerald-200' : 'text-emerald-900';
  const identityEmailClass = variant === 'sidebar' ? 'text-emerald-300/90' : 'text-emerald-700/90';

  const { isLoading, isAuthenticated, user, loginWithRedirect, logout } = useAuth0();

  return (
    <div className={`${panelClass} space-y-3 p-4`}>
      <div className={`flex items-center gap-2 text-xs font-semibold ${titleClass}`}>
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        Authentication
      </div>

      {isLoading && (
        <div className={`flex items-center gap-2 text-xs ${loadingClass}`}>
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
          <div className={identityCardClass}>
            <div className="mb-1.5 flex items-center gap-2">
              <UserRound className="h-4 w-4 text-emerald-700" />
              <p className={`text-xs font-semibold ${identityTitleClass}`}>Signed In</p>
            </div>
            <p className={`text-xs ${identityNameClass}`}>
              {user?.name || user?.email || 'Authenticated user'}
            </p>
            {user?.email && <p className={`mt-1 text-[11px] ${identityEmailClass}`}>{user.email}</p>}
          </div>

          <button
            onClick={() =>
              void logout({
                logoutParams: {
                  returnTo: window.location.origin,
                },
              })
            }
            className={`w-full text-xs ${variant === 'sidebar' ? 'app-button-primary' : 'app-button-secondary'}`}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </>
      )}
    </div>
  );
}

export default function AuthPanel({ variant = 'default' }: AuthPanelProps) {
  if (!auth0Config) {
    return <AuthPanelDisabled variant={variant} />;
  }
  return <AuthPanelEnabled variant={variant} />;
}
