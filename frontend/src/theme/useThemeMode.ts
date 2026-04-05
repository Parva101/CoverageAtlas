import { useContext } from 'react';
import { ThemeContext } from './ThemeContext';

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used inside ThemeProvider.');
  }
  return context;
}
