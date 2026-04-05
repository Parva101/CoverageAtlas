import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  MessageCircle,
  GitCompareArrows,
  Phone,
  Shield,
  ShieldCheck,
  Sparkles,
  Activity,
  Clock3,
  UserRound,
  ChevronRight,
} from 'lucide-react';
import AuthPanel from './AuthPanel';

const nav = [
  {
    to: '/ask',
    label: 'Coverage Q&A',
    subtitle: 'Ask policy questions in plain language',
    icon: MessageCircle,
  },
  {
    to: '/compare',
    label: 'Plan Compare',
    subtitle: 'Find stronger options for a medication',
    icon: GitCompareArrows,
  },
  {
    to: '/voice',
    label: 'Voice Agent',
    subtitle: 'Chat in call-style mode with transcript',
    icon: Phone,
  },
  {
    to: '/changes',
    label: 'Change Timeline',
    subtitle: 'Track added, removed, and modified policy fields',
    icon: Clock3,
  },
  {
    to: '/profile',
    label: 'My Profile',
    subtitle: 'Store member details and personalization settings',
    icon: UserRound,
  },
];

function getPageMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith('/compare')) {
    return {
      title: 'Plan Comparison',
      subtitle: 'Contrast policy restrictions and likely coverage across plans.',
    };
  }
  if (pathname.startsWith('/voice')) {
    return {
      title: 'Voice Assistant',
      subtitle: 'Conversation-style insurance support with a real-time transcript.',
    };
  }
  if (pathname.startsWith('/changes')) {
    return {
      title: 'Policy Timeline',
      subtitle: 'Inspect policy version deltas and recent payer-side updates.',
    };
  }
  if (pathname.startsWith('/profile')) {
    return {
      title: 'My Profile',
      subtitle: 'Manage your personal details, plan context, and preferences.',
    };
  }
  return {
    title: 'Coverage Q&A',
    subtitle: 'Ask coverage questions and get source-grounded answers with next steps.',
  };
}

export default function Layout() {
  const location = useLocation();
  const pageMeta = getPageMeta(location.pathname);

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-[1520px]">
        <aside className="app-sidebar-shell hidden w-[320px] shrink-0 flex-col lg:flex">
          <div className="border-b border-slate-800 p-6">
            <div className="app-sidebar-card relative overflow-hidden bg-gradient-to-br from-indigo-600/95 to-cyan-600/95 p-4 text-white">
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/20" />
              <div className="absolute -bottom-12 -left-10 h-24 w-24 rounded-full bg-cyan-300/20" />
              <div className="relative flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/30 bg-white/15 shadow-sm">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">CoverageAtlas</h1>
                  <p className="text-xs text-blue-100/95">Navigate coverage with confidence.</p>
                </div>
              </div>

              <div className="relative mt-4 flex items-center gap-2 text-xs text-blue-50/95">
                <Sparkles className="h-3.5 w-3.5" />
                Evidence-grounded RAG assistant
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1.5 px-4 py-5">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Workflows
            </p>
            {nav.map(({ to, label, subtitle, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `group block rounded-2xl border px-4 py-3 transition ${
                    isActive
                      ? 'border-indigo-400/70 bg-indigo-500/18 text-indigo-100 shadow-[0_12px_24px_-20px_rgba(99,102,241,0.95)]'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800/65 hover:text-slate-100'
                  }`
                }
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-slate-800/95 p-2 ring-1 ring-slate-700 transition group-hover:ring-indigo-400/40">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-xs leading-relaxed text-slate-400">{subtitle}</div>
                  </div>
                  <ChevronRight className="ml-auto mt-1 h-4 w-4 text-slate-500 group-hover:text-slate-300" />
                </div>
              </NavLink>
            ))}
          </nav>

          <div className="space-y-3 px-4 pb-4">
            <div className="app-sidebar-card p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Trust Signals
              </div>
              <div className="space-y-2 text-xs text-slate-400">
                <p className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-indigo-300" />
                  Authenticated access supported
                </p>
                <p>Metadata-aware filtering and citation-backed answers.</p>
              </div>
            </div>
            <AuthPanel variant="sidebar" />
          </div>
        </aside>

        <div className="relative flex min-h-screen flex-1 flex-col pb-24 lg:pb-0">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/70 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-indigo-300">Patient Workspace</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">{pageMeta.title}</h2>
                <p className="mt-1 text-sm text-slate-300">{pageMeta.subtitle}</p>
              </div>

              <div className="hidden rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-right shadow-sm sm:block">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">Mode</p>
                <p className="text-sm font-semibold text-slate-100">Coverage Intelligence</p>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl animate-fade-up">
              <Outlet />
            </div>
          </main>

          <div className="px-4 pb-4 sm:px-6 lg:hidden">
            <div className="mx-auto w-full max-w-6xl">
              <AuthPanel />
            </div>
          </div>

          <nav className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-1.75rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-900/95 p-1.5 shadow-xl backdrop-blur-xl lg:hidden">
            <ul className="grid gap-1" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
              {nav.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition ${
                        isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label.split(' ')[0]}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
