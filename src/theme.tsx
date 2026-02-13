import React from 'react';
import { useError } from './context/ErrorContext';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { addError } = useError();
  const initErrorRef = React.useRef<unknown>(null);

  const [theme, setTheme] = React.useState<Theme>(() => {
    try {
      const storedTheme = localStorage.getItem('theme') as Theme | null;
      if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
    } catch (e) {
      initErrorRef.current = e;
    }
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      if (!initErrorRef.current) initErrorRef.current = e;
    }
    return 'light';
  });

  React.useEffect(() => {
    if (initErrorRef.current) {
      addError(initErrorRef.current);
      initErrorRef.current = null;
    }
  }, [addError]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem('theme', newTheme);
    } catch (error) {
      addError(error);
      console.error('Failed to save theme to localStorage', error);
    }
    setTheme(newTheme);
  };

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
