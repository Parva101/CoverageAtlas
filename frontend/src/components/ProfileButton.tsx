import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { Link } from 'react-router-dom';
import { clearAuthToken } from '../api/client';
import { hasAuth0CoreConfig, isAuth0Enabled } from '../auth/config';

function getInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export default function ProfileButton() {
  if (!isAuth0Enabled || !hasAuth0CoreConfig) {
    return <LocalProfileButton />;
  }
  return <Auth0ProfileButton />;
}

function Auth0ProfileButton() {
  const { user, logout } = useAuth0();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const displayName = user?.name || user?.nickname || user?.email || 'User';
  const email = user?.email || 'Signed in via Auth0';
  const initials = useMemo(() => getInitials(displayName), [displayName]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold grid place-items-center">
          {initials}
        </span>
        <span className="hidden sm:block font-medium truncate max-w-40">{displayName}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white shadow-lg z-30">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
            <p className="text-xs text-slate-500 truncate">{email}</p>
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="w-full inline-flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserRound className="w-4 h-4 text-slate-500" />
            My profile
          </Link>
          <button
            onClick={() => {
              clearAuthToken();
              logout({ logoutParams: { returnTo: window.location.origin } });
            }}
            className="w-full inline-flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-b-xl border-t border-slate-100"
          >
            <LogOut className="w-4 h-4 text-slate-500" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function LocalProfileButton() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-lg bg-slate-700 text-white text-xs font-bold grid place-items-center">
          LP
        </span>
        <span className="hidden sm:block font-medium">Local Profile</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white shadow-lg z-30">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Local bypass mode</p>
            <p className="text-xs text-slate-500">Auth0 is not enabled.</p>
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="w-full inline-flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserRound className="w-4 h-4 text-slate-500" />
            My profile
          </Link>
          <button
            onClick={() => {
              clearAuthToken();
              setOpen(false);
              window.location.reload();
            }}
            className="w-full inline-flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 rounded-b-xl border-t border-slate-100"
          >
            <LogOut className="w-4 h-4 text-slate-500" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
