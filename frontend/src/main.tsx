import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import AppAuthProvider from './auth/AuthProvider';
import AuthTokenBridge from './auth/AuthTokenBridge';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppAuthProvider>
        <AuthTokenBridge />
        <App />
      </AppAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
