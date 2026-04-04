import { NavLink, Outlet } from 'react-router-dom';
import {
  Search,
  GitCompareArrows,
  History,
  Upload,
  Radar,
  MessageCircle,
  Phone,
  Heart,
  Shield,
} from 'lucide-react';
import type { AppMode } from '../types';

const proNav = [
  { to: '/pro/query', label: 'Query', icon: Search },
  { to: '/pro/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/pro/changes', label: 'Changes', icon: History },
  { to: '/pro/upload', label: 'Upload', icon: Upload },
  { to: '/pro/sources', label: 'Sources', icon: Radar },
];

const patientNav = [
  { to: '/patient/ask', label: 'Ask', icon: MessageCircle },
  { to: '/patient/voice', label: 'Voice', icon: Phone },
];

interface Props {
  mode: AppMode;
  onModeChange: (m: AppMode) => void;
}

export default function Layout({ mode, onModeChange }: Props) {
  const nav = mode === 'professional' ? proNav : patientNav;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900 leading-tight">
                CoverageAtlas
              </h1>
              <p className="text-xs text-slate-500">Policy Intelligence</p>
            </div>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="p-3">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => onModeChange('professional')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-md transition-colors ${
                mode === 'professional'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Professional
            </button>
            <button
              onClick={() => onModeChange('patient')}
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-md transition-colors ${
                mode === 'patient'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              Patient
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-0.5">
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
            Informational only. Not medical or legal advice.
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
