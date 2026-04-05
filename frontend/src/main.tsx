import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import AppAuthProvider from './auth/AuthProvider';
import AuthTokenBridge from './auth/AuthTokenBridge';
import ThemeProvider from './theme/ThemeProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AppAuthProvider>
          <AuthTokenBridge />
          <App />
        </AppAuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
