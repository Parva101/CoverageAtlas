import { NavLink, Outlet } from 'react-router-dom';
import {
  MessageCircle,
  Bot,
  GitCompareArrows,
  FlaskConical,
  Clock3,
  UserRound,
  Shield,
} from 'lucide-react';
import AuthPanel from './AuthPanel';
import ProfileButton from './ProfileButton';
import ThemeToggle from './ThemeToggle';

const nav = [
  { to: '/ask', label: 'Ask a Question', icon: MessageCircle, description: 'Check your coverage' },
  { to: '/mascot', label: 'Atlas Mascot AI', icon: Bot, description: 'Chat or switch to phone call' },
  { to: '/access-lab', label: 'Access Lab', icon: FlaskConical, description: 'Plan switch and denial strategy' },
  { to: '/compare', label: 'Compare Plans', icon: GitCompareArrows, description: 'Find the best plan' },
  { to: '/changes', label: 'Policy Timeline', icon: Clock3, description: 'Track policy changes over time' },
  { to: '/profile', label: 'My Profile', icon: UserRound, description: 'Manage your details and preferences' },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="app-sidebar-shell w-64 flex flex-col shrink-0 shadow-xl">
        {/* Logo */}
        <div className="p-5 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight tracking-tight">
                CoverageAtlas
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Your Coverage Guide</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-5 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-3 mb-3">
            Features
          </p>
          {nav.map(({ to, label, icon: Icon, description }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200 border border-transparent'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isActive ? 'bg-blue-600/30' : 'bg-slate-700/70 group-hover:bg-slate-600/70'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate leading-tight">{label}</p>
                    <p className={`text-xs truncate mt-0.5 ${isActive ? 'text-blue-500/70' : 'text-slate-500'}`}>
                      {description}
                    </p>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <AuthPanel />

        {/* Footer */}
        <div className="p-4 border-t border-slate-700/60">
          <p className="text-xs text-slate-500 leading-relaxed">
            Informational only. Not medical or legal advice. Always confirm with your insurer.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main-canvas">
        <div className="app-topbar">
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ProfileButton />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

