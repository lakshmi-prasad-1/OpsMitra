import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'system', setTheme: () => {} });
const KEY = 'opsmitra_theme';

function stored() { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } }

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(stored);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  }, [theme]);
  const setTheme = useCallback(next => { setThemeState(next); try { localStorage.setItem(KEY, next); } catch { /* storage blocked: keep in memory */ } }, []);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
