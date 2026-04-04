import { useState } from 'react';
import { History, Plus, Trash2, Pencil, Loader2, AlertTriangle, FileText } from 'lucide-react';
import type { PolicyChange, ChangeType } from '../../types';
import { getPolicyChanges } from '../../api/client';

function ChangeIcon({ type }: { type: ChangeType }) {
  switch (type) {
    case 'added':
      return <Plus className="w-4 h-4 text-emerald-600" />;
    case 'removed':
      return <Trash2 className="w-4 h-4 text-red-500" />;
    case 'modified':
      return <Pencil className="w-4 h-4 text-amber-600" />;
  }
}

function ChangeTypeBadge({ type }: { type: ChangeType }) {
  const styles: Record<ChangeType, string> = {
    added: 'bg-emerald-100 text-emerald-800',
    removed: 'bg-red-100 text-red-800',
    modified: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[type]}`}>
      {type}
    </span>
  );
}

export default function ChangeTracker() {
  const [policyId, setPolicyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState<PolicyChange[]>([]);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleFetch = async () => {
    if (!policyId.trim()) return;
    setLoading(true);
    setError('');
    setChanges([]);
    setSearched(true);
    try {
      const res = await getPolicyChanges(policyId.trim());
      setChanges(res);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Change Tracker</h2>
        <p className="text-sm text-slate-500 mt-1">
          View diffs between policy versions — what was added, removed, or modified.
        </p>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <History className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={policyId}
              onChange={e => setPolicyId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetch()}
              placeholder="Enter Policy ID (UUID)"
              className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={loading || !policyId.trim()}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />}
            Fetch Changes
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Change Timeline */}
      {changes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">
            {changes.length} change{changes.length > 1 ? 's' : ''} detected
          </h3>
          <div className="space-y-2">
            {changes.map(ch => (
              <div
                key={ch.id}
                className="bg-white rounded-lg border border-slate-200 p-4 flex gap-4"
              >
                <div className="mt-0.5">
                  <ChangeIcon type={ch.change_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ChangeTypeBadge type={ch.change_type} />
                    <span className="text-sm font-medium text-slate-900">{ch.field_name}</span>
                    {ch.from_version && ch.to_version && (
                      <span className="text-xs text-slate-400 ml-auto">
                        {ch.from_version} &rarr; {ch.to_version}
                      </span>
                    )}
                  </div>

                  {ch.change_type === 'modified' && (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div className="bg-red-50 rounded-md p-2.5">
                        <span className="text-xs font-medium text-red-600 block mb-1">Before</span>
                        <p className="text-xs text-red-800">{ch.old_value || '—'}</p>
                      </div>
                      <div className="bg-emerald-50 rounded-md p-2.5">
                        <span className="text-xs font-medium text-emerald-600 block mb-1">After</span>
                        <p className="text-xs text-emerald-800">{ch.new_value || '—'}</p>
                      </div>
                    </div>
                  )}

                  {ch.change_type === 'added' && ch.new_value && (
                    <div className="bg-emerald-50 rounded-md p-2.5 mt-2">
                      <p className="text-xs text-emerald-800">{ch.new_value}</p>
                    </div>
                  )}

                  {ch.change_type === 'removed' && ch.old_value && (
                    <div className="bg-red-50 rounded-md p-2.5 mt-2">
                      <p className="text-xs text-red-800 line-through">{ch.old_value}</p>
                    </div>
                  )}

                  <div className="mt-2 text-xs text-slate-400">
                    Detected: {new Date(ch.detected_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {searched && !loading && changes.length === 0 && !error && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No changes found for this policy.</p>
        </div>
      )}
    </div>
  );
}
