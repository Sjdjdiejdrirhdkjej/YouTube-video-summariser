import React from 'react'
import { ThemeProvider } from './theme'
import { ErrorProvider } from './context/ErrorContext'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorProvider>
  </React.StrictMode>
)
