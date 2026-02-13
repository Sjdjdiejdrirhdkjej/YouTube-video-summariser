import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export interface AppError {
  id: string;
  message: string;
  timestamp: number;
  stack?: string;
}

interface ErrorContextType {
  errors: AppError[];
  addError: (error: unknown) => void;
  removeError: (id: string) => void;
  clearErrors: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const useError = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
};

export const ErrorProvider = ({ children }: { children: ReactNode }) => {
  const [errors, setErrors] = useState<AppError[]>([]);

  const addError = useCallback((error: unknown) => {
    console.error('Global Error Caught:', error);
    
    let message = 'An unknown error occurred';
    let stack: string | undefined;

    if (error instanceof Error) {
      message = error.message;
      stack = error.stack;
    } else if (typeof error === 'string') {
      message = error;
    } else if (typeof error === 'object' && error !== null) {
      try {
        message = JSON.stringify(error);
      } catch {
        message = 'Non-serializable error object';
      }
    }

    const newError: AppError = {
      id: Math.random().toString(36).substring(2, 9),
      message,
      stack,
      timestamp: Date.now(),
    };

    setErrors((prev) => [...prev, newError]);
  }, []);

  const removeError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  // Global error listeners
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      addError(event.error || event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addError(event.reason);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Intercept console.error
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      addError(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
      originalConsoleError.apply(console, args);
    };

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      console.error = originalConsoleError;
    };
  }, [addError]);

  return (
    <ErrorContext.Provider value={{ errors, addError, removeError, clearErrors }}>
      {children}
    </ErrorContext.Provider>
  );
};
