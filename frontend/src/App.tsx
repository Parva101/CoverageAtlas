import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

const AtlasAssistantChat = lazy(() => import('./components/patient/AtlasAssistantChat'));
const ComparePlans = lazy(() => import('./components/patient/ComparePlans'));
const AccessLab = lazy(() => import('./components/patient/AccessLab'));
const PolicyTimeline = lazy(() => import('./components/patient/PolicyTimeline'));
const Profile = lazy(() => import('./components/patient/Profile'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

function PageLoader() {
  return (
    <div className="min-h-[300px] grid place-items-center">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    </div>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function RootEntry() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const isAuthCallback =
    params.has('code') || params.has('state') || params.has('error') || params.has('error_description');

  if (isAuthCallback) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center">
        <p className="text-sm text-slate-500">Finishing sign-in...</p>
      </div>
    );
  }

  return <Navigate to="/ask" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Lazy><AuthPage mode="login" /></Lazy>} />
      <Route path="/signup" element={<Lazy><AuthPage mode="signup" /></Lazy>} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/ask" element={<Lazy><AtlasAssistantChat /></Lazy>} />
        <Route path="/assistant" element={<Navigate to="/ask" replace />} />
        <Route path="/access-lab" element={<Lazy><AccessLab /></Lazy>} />
        <Route path="/compare" element={<Lazy><ComparePlans /></Lazy>} />
        <Route path="/voice" element={<Navigate to="/ask" replace />} />
        <Route path="/changes" element={<Lazy><PolicyTimeline /></Lazy>} />
        <Route path="/profile" element={<Lazy><Profile /></Lazy>} />
      </Route>
      <Route path="/" element={<RootEntry />} />
      <Route path="*" element={<Navigate to="/ask" replace />} />
    </Routes>
  );
}
