import { useState, useRef } from 'react';
import { Upload, FileUp, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import type { DocumentStatus } from '../../types';
import { uploadDocument, getDocumentStatus } from '../../api/client';

const PAYERS = [
  'UnitedHealthcare', 'Aetna', 'Cigna', 'Humana',
  'BCBS Massachusetts', 'CareFirst BCBS', 'Excellus BCBS',
  'BCBS Michigan', 'BCBS Texas', 'Horizon BCBS NJ',
  'Medicare', 'Medicaid',
];

function StatusIcon({ status }: { status: DocumentStatus['ingestion_status'] }) {
  switch (status) {
    case 'queued': return <Clock className="w-4 h-4 text-slate-400" />;
    case 'processing': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
  }
}

function statusColor(status: DocumentStatus['ingestion_status']) {
  return {
    queued: 'bg-slate-100 text-slate-700',
    processing: 'bg-blue-100 text-blue-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
  }[status];
}

export default function UploadPipeline() {
  const [payerId, setPayerId] = useState('');
  const [policyTitle, setPolicyTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<DocumentStatus[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file || !payerId || !policyTitle) return;
    setUploading(true);
    setError('');
    try {
      const doc = await uploadDocument(file, payerId, policyTitle);
      setUploads(prev => [doc, ...prev]);
      setFile(null);
      setPolicyTitle('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const refreshStatus = async (docId: string) => {
    try {
      const updated = await getDocumentStatus(docId);
      setUploads(prev => prev.map(u => (u.id === docId ? updated : u)));
    } catch {
      // silent
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Upload & Pipeline</h2>
        <p className="text-sm text-slate-500 mt-1">
          Upload policy documents and track ingestion progress.
        </p>
      </div>

      {/* Upload Form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        {/* File drop */}
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
        >
          <FileUp className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          {file ? (
            <p className="text-sm text-slate-700 font-medium">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-slate-600">Click to select a PDF, HTML, or DOCX file</p>
              <p className="text-xs text-slate-400 mt-1">Accepted: .pdf, .html, .docx</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.html,.docx"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Payer</label>
            <select
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select payer...</option>
              {PAYERS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Policy Title</label>
            <input
              type="text"
              value={policyTitle}
              onChange={e => setPolicyTitle(e.target.value)}
              placeholder="e.g. Ozempic Medical Benefit Policy"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !file || !payerId || !policyTitle}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Upload & Start Ingestion
        </button>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Upload History */}
      {uploads.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Pipeline Status</h3>
          <div className="space-y-2">
            {uploads.map(doc => (
              <div
                key={doc.id}
                className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4"
              >
                <StatusIcon status={doc.ingestion_status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{doc.file_name}</p>
                  <p className="text-xs text-slate-400 font-mono">{doc.id}</p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor(doc.ingestion_status)}`}>
                  {doc.ingestion_status}
                </span>
                {(doc.ingestion_status === 'queued' || doc.ingestion_status === 'processing') && (
                  <button
                    onClick={() => refreshStatus(doc.id)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Refresh
                  </button>
                )}
                {doc.ingestion_error && (
                  <span className="text-xs text-red-500 max-w-60 truncate" title={doc.ingestion_error}>
                    {doc.ingestion_error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
