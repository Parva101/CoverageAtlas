import { Moon, Sun } from 'lucide-react';
import { useThemeMode } from '../theme/useThemeMode';

export default function ThemeToggle() {
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === 'dark';

  return (
    <button
      onClick={toggleMode}
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white hover:shadow-md"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4 text-indigo-600" />}
      <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'} mode</span>
    </button>
  );
}
