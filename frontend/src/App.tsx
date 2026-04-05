import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AskQuestion from './components/patient/AskQuestion';
import ComparePlans from './components/patient/ComparePlans';
import VoiceCall from './components/patient/VoiceCall';
import PolicyTimeline from './components/patient/PolicyTimeline';
import Profile from './components/patient/Profile';
import AccessLab from './components/patient/AccessLab';
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
        <Route path="/access-lab" element={<AccessLab />} />
        <Route path="/compare" element={<ComparePlans />} />
        <Route path="/voice" element={<VoiceCall />} />
        <Route path="/changes" element={<PolicyTimeline />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/ask" replace />} />
      </Route>
    </Routes>
  );
}
