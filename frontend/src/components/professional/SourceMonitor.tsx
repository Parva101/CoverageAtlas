import { useState } from 'react';
import { Radar, Loader2, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { triggerScan } from '../../api/client';

interface ScanLog {
  id: string;
  triggeredAt: string;
  jobId: string;
  message: string;
  status: 'running' | 'completed' | 'failed';
}

export default function SourceMonitor() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<ScanLog[]>([]);

  const handleScan = async () => {
    setScanning(true);
    setError('');
    try {
      const res = await triggerScan();
      setLogs(prev => [
        {
          id: res.job_id,
          triggeredAt: new Date().toISOString(),
          jobId: res.job_id,
          message: res.message,
          status: 'running',
        },
        ...prev,
      ]);
    } catch (e: any) {
      setError(e.message || 'Scan trigger failed');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Source Monitor</h2>
        <p className="text-sm text-slate-500 mt-1">
          Trigger payer website scans and view discovered updates.
        </p>
      </div>

      {/* Trigger */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Manual Source Scan</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Crawl all configured payer sites for new or updated policy documents.
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Start Scan
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Scan Logs */}
      {logs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Scan History</h3>
          <div className="space-y-2">
            {logs.map(log => (
              <div
                key={log.id}
                className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4"
              >
                {log.status === 'running' ? (
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                ) : log.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{log.message}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">Job: {log.jobId}</p>
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(log.triggeredAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Monitored Payers</h3>
        <div className="grid grid-cols-3 gap-2">
          {[
            'UnitedHealthcare', 'Aetna', 'Cigna', 'Humana',
            'BCBS Massachusetts', 'CareFirst BCBS', 'Excellus BCBS',
            'BCBS Michigan', 'BCBS Texas', 'Horizon BCBS NJ',
          ].map(p => (
            <div key={p} className="flex items-center gap-2 text-xs text-slate-600">
              <Radar className="w-3 h-3 text-slate-400" />
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
