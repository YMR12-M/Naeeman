import { createContext, useContext, useEffect, useMemo } from 'react';
import { useLocalStorage } from '../lib/hooks.js';

const ThemeContext = createContext(null);

/** 'light' | 'dark' | 'auto' (يتبع إعداد الجهاز) */
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useLocalStorage('naeeman.theme', 'auto');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = preference === 'dark' || (preference === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F2B28' : '#143C38');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference]);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
