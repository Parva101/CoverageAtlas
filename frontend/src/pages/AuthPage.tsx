import { useEffect, useState } from 'react';
import { LockKeyhole, Shield, UserPlus } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { auth0Config, auth0ConfigError, hasAuth0CoreConfig, isAuth0Enabled } from '../auth/config';
import { readAuth0ProfileBootstrap, saveSignupProfileBootstrap } from '../auth/profileBootstrap';

interface AuthPageProps {
  mode: 'login' | 'signup';
}

function AuthDisabledPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-white grid place-items-center px-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl shadow-sm p-8 space-y-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 grid place-items-center mx-auto">
          <Shield className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Auth0 is currently disabled</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          This app is running in local bypass mode. Protected pages are available without sign-in.
        </p>
        <Link
          to="/ask"
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          Continue to app
        </Link>
      </div>
    </div>
  );
}

function Auth0AuthPage({ mode }: AuthPageProps) {
  const { isAuthenticated, isLoading, loginWithRedirect, error } = useAuth0();
  const navigate = useNavigate();
  const location = useLocation();
  const [signupFullName, setSignupFullName] = useState(() => readAuth0ProfileBootstrap()?.fullName || '');
  const [signupPhone, setSignupPhone] = useState(() => readAuth0ProfileBootstrap()?.phone || '');
  const [signupError, setSignupError] = useState('');

  const params = new URLSearchParams(location.search);
  const returnTo = params.get('returnTo') || '/ask';
  const auth0Error = params.get('error');
  const auth0ErrorDescription = params.get('error_description');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, returnTo]);

  const startAuth = async (targetMode: 'login' | 'signup') => {
    if (targetMode === 'signup') {
      const fullName = signupFullName.trim().replace(/\s+/g, ' ');
      const phone = signupPhone.trim();
      if (!fullName || !phone) {
        setSignupError('Please enter your full name and phone number to continue.');
        return;
      }
      saveSignupProfileBootstrap({ fullName, phone });
    } else {
      setSignupError('');
    }

    await loginWithRedirect({
      appState: { returnTo },
      authorizationParams: {
        audience: auth0Config.audience,
        scope: auth0Config.scope,
        ...(targetMode === 'signup' ? { screen_hint: 'signup' } : {}),
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center">
        <p className="text-sm text-slate-500">Preparing sign-in...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-white grid place-items-center px-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-3xl shadow-sm p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-600 grid place-items-center mx-auto">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to CoverageAtlas</h1>
          <p className="text-sm text-slate-600">
            Sign in to access your plan insights and coverage tools.
          </p>
        </div>

        <div className="space-y-3">
          {mode === 'signup' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Full Name
                </label>
                <input
                  value={signupFullName}
                  onChange={event => setSignupFullName(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Jane Doe"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  Phone Number
                </label>
                <input
                  value={signupPhone}
                  onChange={event => setSignupPhone(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="+1 555 123 4567"
                  autoComplete="tel"
                />
                <p className="mt-1 text-xs text-slate-500">
                  We&apos;ll use this to pre-fill your profile after signup.
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => startAuth('login')}
            className={`w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-900 text-white hover:bg-slate-950'
            }`}
          >
            <LockKeyhole className="w-4 h-4" />
            Log in
          </button>
          <button
            onClick={() => startAuth('signup')}
            className={`w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
              mode === 'signup'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Sign up
          </button>
        </div>

        {(signupError || error || auth0Error || auth0ErrorDescription) && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-700">Authentication error</p>
            <p className="text-xs text-red-600 mt-1 leading-relaxed break-words">
              {signupError || auth0ErrorDescription || auth0Error || error?.message || 'Unable to sign in right now.'}
            </p>
          </div>
        )}

        <p className="text-xs text-slate-400 text-center">
          You&apos;ll be redirected to Auth0 to continue securely.
        </p>
      </div>
    </div>
  );
}

export default function AuthPage({ mode }: AuthPageProps) {
  if (!isAuth0Enabled) {
    return <AuthDisabledPage />;
  }

  if (!hasAuth0CoreConfig) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-6">
        <div className="w-full max-w-lg bg-white border border-red-200 rounded-2xl p-6 space-y-2">
          <h1 className="text-base font-semibold text-red-800">Auth0 configuration is incomplete</h1>
          <p className="text-sm text-red-700">{auth0ConfigError}</p>
          <p className="text-xs text-slate-500">Set the missing `VITE_AUTH0_*` variables and refresh.</p>
        </div>
      </div>
    );
  }

  return <Auth0AuthPage mode={mode} />;
}
