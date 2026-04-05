import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AskQuestion from './components/patient/AskQuestion';
import ComparePlans from './components/patient/ComparePlans';
import VoiceCall from './components/patient/VoiceCall';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/ask" element={<AskQuestion />} />
        <Route path="/compare" element={<ComparePlans />} />
        <Route path="/voice" element={<VoiceCall />} />
        <Route path="*" element={<Navigate to="/ask" replace />} />
      </Route>
    </Routes>
  );
}
