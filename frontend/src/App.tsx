import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { AppMode } from './types';
import Layout from './components/Layout';

// Professional screens
import QueryWorkspace from './components/professional/QueryWorkspace';
import CompareTable from './components/professional/CompareTable';
import ChangeTracker from './components/professional/ChangeTracker';
import UploadPipeline from './components/professional/UploadPipeline';
import SourceMonitor from './components/professional/SourceMonitor';

// Patient screens
import AskQuestion from './components/patient/AskQuestion';
import VoiceCall from './components/patient/VoiceCall';

export default function App() {
  const [mode, setMode] = useState<AppMode>('professional');
  const navigate = useNavigate();
  const location = useLocation();

  // Sync mode from URL on mount
  useEffect(() => {
    if (location.pathname.startsWith('/patient')) setMode('patient');
    else setMode('professional');
  }, []);

  const handleModeChange = (m: AppMode) => {
    setMode(m);
    navigate(m === 'professional' ? '/pro/query' : '/patient/ask');
  };

  return (
    <Routes>
      <Route element={<Layout mode={mode} onModeChange={handleModeChange} />}>
        {/* Professional */}
        <Route path="/pro/query" element={<QueryWorkspace />} />
        <Route path="/pro/compare" element={<CompareTable />} />
        <Route path="/pro/changes" element={<ChangeTracker />} />
        <Route path="/pro/upload" element={<UploadPipeline />} />
        <Route path="/pro/sources" element={<SourceMonitor />} />

        {/* Patient */}
        <Route path="/patient/ask" element={<AskQuestion />} />
        <Route path="/patient/voice" element={<VoiceCall />} />

        {/* Default */}
        <Route path="*" element={<Navigate to="/pro/query" replace />} />
      </Route>
    </Routes>
  );
}
