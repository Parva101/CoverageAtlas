import { useEffect, useState } from 'react';
import { clearAuthToken, getAuthMe, getAuthToken, setAuthToken } from '../api/client';

interface AuthState {
  sub: string | null;
  scopes: string[];
  auth_enabled: boolean;
}

export default function AuthPanel() {
  const [tokenInput, setTokenInput] = useState(getAuthToken() ?? '');
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const refreshAuth = async () => {
    setChecking(true);
    setError('');
    try {
      const me = await getAuthMe();
      setAuthState({
        sub: me.sub,
        scopes: me.scopes,
        auth_enabled: me.auth_enabled,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unable to validate auth right now.';
      setError(message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const handleSave = async () => {
    setAuthToken(tokenInput);
    await refreshAuth();
  };

  const handleClear = async () => {
    clearAuthToken();
    setTokenInput('');
    await refreshAuth();
  };

  return (
    <div className="p-4 border-t border-slate-200 space-y-3">
      <p className="text-xs font-semibold text-slate-700">API Auth</p>
      <input
        type="password"
        value={tokenInput}
        onChange={e => setTokenInput(e.target.value)}
        placeholder="Paste bearer token (optional)"
        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Save
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
        >
          Clear
        </button>
      </div>

      <button
        onClick={refreshAuth}
        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
        disabled={checking}
      >
        {checking ? 'Checking...' : 'Check /auth/me'}
      </button>

      {authState && (
        <div className="text-xs text-slate-500 leading-relaxed space-y-1">
          <p>
            Auth mode: <span className="font-medium text-slate-700">{authState.auth_enabled ? 'enabled' : 'local bypass'}</span>
          </p>
          <p>
            User: <span className="font-mono text-[11px] text-slate-700">{authState.sub || 'unknown'}</span>
          </p>
          {authState.scopes.length > 0 && (
            <p>
              Scopes: <span className="font-mono text-[11px] text-slate-700">{authState.scopes.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 break-words">{error}</p>}
    </div>
  );
}
