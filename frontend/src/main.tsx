import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import AppAuthProvider from './auth/AppAuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppAuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppAuthProvider>
  </StrictMode>,
);
