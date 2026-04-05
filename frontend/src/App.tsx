import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AskQuestion from './components/patient/AskQuestion';
import ComparePlans from './components/patient/ComparePlans';
import VoiceCall from './components/patient/VoiceCall';
import RequireAuth from './auth/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route
        element={(
          <RequireAuth>
            <Layout />
          </RequireAuth>
        )}
      >
        <Route path="/ask" element={<AskQuestion />} />
        <Route path="/compare" element={<ComparePlans />} />
        <Route path="/voice" element={<VoiceCall />} />
        <Route path="*" element={<Navigate to="/ask" replace />} />
      </Route>
    </Routes>
  );
}
