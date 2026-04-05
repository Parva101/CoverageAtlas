import { NavLink, Outlet } from 'react-router-dom';
import {
  MessageCircle,
  GitCompareArrows,
  Phone,
  Heart,
} from 'lucide-react';

const nav = [
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/compare', label: 'Compare Plans', icon: GitCompareArrows },
  { to: '/voice', label: 'Voice', icon: Phone },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900 leading-tight">
                CoverageAtlas
              </h1>
              <p className="text-xs text-slate-500">Your Coverage Guide</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <Icon className="w-4.5 h-4.5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200">
          <p className="text-xs text-slate-400 leading-relaxed">
            Informational only. Not medical or legal advice. Always confirm with your insurer.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

