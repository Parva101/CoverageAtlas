import { useState } from 'react';
import { GitCompareArrows, Loader2, AlertTriangle, Check, X, Minus, HelpCircle } from 'lucide-react';
import type { CompareResponse, CoverageStatus } from '../../types';
import { postCompare } from '../../api/client';

const PAYERS = [
  'UnitedHealthcare', 'Aetna', 'Cigna', 'Humana',
  'BCBS Massachusetts', 'CareFirst BCBS', 'Excellus BCBS',
  'BCBS Michigan', 'BCBS Texas', 'Horizon BCBS NJ',
  'Medicare', 'Medicaid',
];

function StatusCell({ status }: { status: CoverageStatus }) {
  const config: Record<CoverageStatus, { bg: string; text: string; label: string }> = {
    covered: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Covered' },
    restricted: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Restricted' },
    not_covered: { bg: 'bg-red-100', text: 'text-red-800', label: 'Not Covered' },
    unknown: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Unknown' },
  };
  const c = config[status];
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function BoolCell({ value }: { value: boolean | null }) {
  if (value === true) return <Check className="w-4 h-4 text-amber-600 mx-auto" />;
  if (value === false) return <X className="w-4 h-4 text-slate-300 mx-auto" />;
  return <HelpCircle className="w-3.5 h-3.5 text-slate-300 mx-auto" />;
}

export default function CompareTable() {
  const [drugName, setDrugName] = useState('');
  const [selectedPayers, setSelectedPayers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');

  const handleCompare = async () => {
    if (!drugName.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await postCompare({
        drug_name: drugName,
        plan_ids: selectedPayers.length ? selectedPayers : undefined,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Compare failed');
    } finally {
      setLoading(false);
    }
  };

  const togglePayer = (p: string) => {
    setSelectedPayers(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Compare Coverage</h2>
        <p className="text-sm text-slate-500 mt-1">
          Side-by-side drug coverage comparison across payers.
        </p>
      </div>

      {/* Input */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <GitCompareArrows className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={drugName}
              onChange={e => setDrugName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCompare()}
              placeholder="Enter drug name (e.g., Ozempic, semaglutide, Humira)"
              className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={handleCompare}
            disabled={loading || !drugName.trim()}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />}
            Compare
          </button>
        </div>

        {/* Payer filter chips */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-2 block">Filter payers (optional)</label>
          <div className="flex flex-wrap gap-2">
            {PAYERS.map(p => (
              <button
                key={p}
                onClick={() => togglePayer(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedPayers.includes(p)
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results Table */}
      {result && result.rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              {result.drug_name} — {result.rows.length} payer{result.rows.length > 1 ? 's' : ''}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Payer</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Policy</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Prior Auth</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Step Therapy</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Quantity Limits</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Criteria</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{row.payer_name}</div>
                      <div className="text-xs text-slate-400">{row.version_label}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-48 truncate">{row.policy_title}</td>
                    <td className="px-4 py-3 text-center"><StatusCell status={row.coverage_status} /></td>
                    <td className="px-4 py-3"><BoolCell value={row.prior_auth_required} /></td>
                    <td className="px-4 py-3"><BoolCell value={row.step_therapy_required} /></td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-40 truncate">
                      {row.quantity_limit_text || <Minus className="w-3.5 h-3.5 text-slate-300" />}
                    </td>
                    <td className="px-4 py-3">
                      {row.criteria_summary.length > 0 ? (
                        <ul className="text-xs text-slate-600 space-y-0.5 list-disc list-inside">
                          {row.criteria_summary.slice(0, 3).map((c, j) => (
                            <li key={j}>{c}</li>
                          ))}
                          {row.criteria_summary.length > 3 && (
                            <li className="text-slate-400">+{row.criteria_summary.length - 3} more</li>
                          )}
                        </ul>
                      ) : (
                        <Minus className="w-3.5 h-3.5 text-slate-300" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium ${
                        row.extraction_confidence >= 0.8 ? 'text-emerald-600'
                        : row.extraction_confidence >= 0.6 ? 'text-amber-600'
                        : 'text-red-500'
                      }`}>
                        {Math.round(row.extraction_confidence * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && result.rows.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">No coverage data found for "{result.drug_name}".</p>
        </div>
      )}
    </div>
  );
}
