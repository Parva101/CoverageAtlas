import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import AskQuestion from './components/patient/AskQuestion';
import ComparePlans from './components/patient/ComparePlans';
import VoiceCall from './components/patient/VoiceCall';
import ProtectedRoute from './components/ProtectedRoute';
import AuthPage from './pages/AuthPage';

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
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/ask" element={<AskQuestion />} />
        <Route path="/compare" element={<ComparePlans />} />
        <Route path="/voice" element={<VoiceCall />} />
      </Route>
      <Route path="/" element={<RootEntry />} />
      <Route path="*" element={<Navigate to="/ask" replace />} />
    </Routes>
  );
}
