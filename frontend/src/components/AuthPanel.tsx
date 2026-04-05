import { useAuth0 } from '@auth0/auth0-react';
import { auth0Config } from '../auth/config';

function AuthPanelDisabled() {
  return (
    <div className="p-4 border-t border-slate-200 space-y-2">
      <p className="text-xs font-semibold text-slate-700">Auth</p>
      <p className="text-xs text-slate-500 leading-relaxed">
        Auth0 frontend login is not configured. Set Vite Auth0 env vars when you want hosted login.
      </p>
    </div>
  );
}

function AuthPanelEnabled() {
  const { isLoading, isAuthenticated, user, loginWithRedirect, logout } = useAuth0();

  return (
    <div className="p-4 border-t border-slate-200 space-y-3">
      <p className="text-xs font-semibold text-slate-700">Auth</p>

      {isLoading && <p className="text-xs text-slate-500">Checking session...</p>}

      {!isLoading && !isAuthenticated && (
        <button
          onClick={() => void loginWithRedirect()}
          className="w-full px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Sign in with Auth0
        </button>
      )}

      {!isLoading && isAuthenticated && (
        <>
          <div className="text-xs text-slate-500 leading-relaxed space-y-1">
            <p>
              Signed in as{' '}
              <span className="font-medium text-slate-700">{user?.name || user?.email || 'user'}</span>
            </p>
            {user?.email && <p className="font-mono text-[11px] text-slate-500">{user.email}</p>}
          </div>

          <button
            onClick={() =>
              void logout({
                logoutParams: {
                  returnTo: window.location.origin,
                },
              })
            }
            className="w-full px-3 py-2 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
          >
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
