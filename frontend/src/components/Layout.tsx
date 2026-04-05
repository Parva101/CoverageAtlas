import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  MessageCircle,
  GitCompareArrows,
  FlaskConical,
  Phone,
  Clock3,
  UserRound,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import AuthPanel from './AuthPanel';
import ProfileButton from './ProfileButton';
import ThemeToggle from './ThemeToggle';

const nav = [
  { to: '/ask', label: 'Coverage Assistant', icon: MessageCircle, description: 'Ask, chat, or switch to phone call' },
  { to: '/access-lab', label: 'Access Lab', icon: FlaskConical, description: 'Plan switch and denial strategy' },
  { to: '/compare', label: 'Compare Plans', icon: GitCompareArrows, description: 'Find the best plan' },
  { to: '/voice', label: 'Voice Assistant', icon: Phone, description: 'Chat about coverage' },
  { to: '/changes', label: 'Policy Timeline', icon: Clock3, description: 'Track policy changes over time' },
  { to: '/profile', label: 'My Profile', icon: UserRound, description: 'Manage your details and preferences' },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[270px] flex flex-col shrink-0 transition-transform duration-300 ease-out lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar background layers */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 rounded-r-2xl lg:rounded-r-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgb(99_102_241/0.12),transparent_60%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-[radial-gradient(ellipse_at_bottom,rgb(6_182_212/0.08),transparent_70%)]" />

        {/* Logo */}
        <div className="relative p-5 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 opacity-50 blur-md group-hover:opacity-75 transition-opacity" />
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                <Shield className="w-5 h-5 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight tracking-tight">
                CoverageAtlas
              </h1>
              <p className="text-[11px] text-slate-500 mt-0.5 tracking-wide">Policy Intelligence</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.18em] px-3 mb-3">
            Features
          </p>
          {nav.map(({ to, label, icon: Icon, description }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600/20 to-indigo-600/10 text-blue-300 shadow-[inset_0_0_0_1px_rgb(96_165_250/0.2)] shadow-[0_0_20px_-8px_rgb(96_165_250/0.2)]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 ${
                    isActive
                      ? 'bg-blue-500/20 shadow-[0_0_12px_-2px_rgb(96_165_250/0.3)]'
                      : 'bg-white/[0.04] group-hover:bg-white/[0.08]'
                  }`}>
                    <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-blue-400' : ''}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate leading-tight">{label}</p>
                    <p className={`text-[11px] truncate mt-0.5 transition-colors ${isActive ? 'text-blue-400/50' : 'text-slate-600'}`}>
                      {description}
                    </p>
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="relative">
          <AuthPanel />
        </div>

        {/* Footer */}
        <div className="relative p-4 border-t border-white/[0.04]">
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Informational only. Not medical or legal advice. Always confirm with your insurer.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto min-w-0 bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-50">
        <div className="sticky top-0 z-20 flex items-center justify-between px-6 py-3 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden w-9 h-9 rounded-xl border border-slate-200/80 bg-white/90 flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm transition-all"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="lg:hidden" />
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <ProfileButton />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

