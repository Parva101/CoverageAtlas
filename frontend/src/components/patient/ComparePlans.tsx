import { useState } from 'react';
import {
  GitCompareArrows,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Trophy,
  ArrowRight,
  Shield,
} from 'lucide-react';
import type { CompareResponse, CompareRow, CoverageStatus } from '../../types';
import { postCompare } from '../../api/client';

const PAYERS = [
  'UnitedHealthcare',
  'Aetna',
  'Cigna',
  'Humana',
  'BCBS Massachusetts',
  'CareFirst BCBS',
  'Excellus BCBS',
  'BCBS Michigan',
  'BCBS Texas',
  'Horizon BCBS NJ',
  'Medicare',
  'Medicaid',
];

const STATUS_SCORE: Record<CoverageStatus, number> = {
  covered: 3,
  restricted: 2,
  not_covered: 0,
  unknown: 1,
};

function pickBest(rows: CompareRow[], myPayer: string): CompareRow | null {
  const others = rows.filter(
    r => r.payer_name.toLowerCase() !== myPayer.toLowerCase(),
  );
  if (others.length === 0) return null;
  return others.reduce((best, row) => {
    const bestScore = scoreRow(best);
    const rowScore = scoreRow(row);
    return rowScore > bestScore ? row : best;
  });
}

function scoreRow(row: CompareRow): number {
  let s = STATUS_SCORE[row.coverage_status] * 10;
  if (row.prior_auth_required === false) s += 3;
  if (row.step_therapy_required === false) s += 3;
  if (!row.quantity_limit_text) s += 1;
  s += row.extraction_confidence * 2;
  return s;
}

function StatusBadge({ status }: { status: CoverageStatus }) {
  const config: Record<CoverageStatus, { icon: typeof CheckCircle2; bg: string; text: string; label: string }> = {
    covered: { icon: CheckCircle2, bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Covered' },
    restricted: { icon: AlertTriangle, bg: 'bg-amber-100', text: 'text-amber-800', label: 'Covered with conditions' },
    not_covered: { icon: XCircle, bg: 'bg-red-100', text: 'text-red-800', label: 'Not covered' },
    unknown: { icon: HelpCircle, bg: 'bg-slate-100', text: 'text-slate-600', label: 'Not sure yet' },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {c.label}
    </span>
  );
}

function BoolLine({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <HelpCircle className="w-4 h-4" /> {label}: Unknown
    </div>
  );
  return (
    <div className={`flex items-center gap-2 text-sm ${value ? 'text-amber-700' : 'text-emerald-700'}`}>
      {value ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
      {label}: {value ? 'Yes' : 'No'}
    </div>
  );
}

function PlanCard({ row, highlight }: { row: CompareRow; highlight?: 'yours' | 'best' }) {
  const border = highlight === 'best' ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200';
  return (
    <div className={`rounded-xl border-2 ${border} bg-white p-5 space-y-4 flex-1`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {highlight === 'yours' && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Your Plan</span>
            )}
            {highlight === 'best' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">
                <Trophy className="w-3 h-3" /> Best Coverage
              </span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{row.payer_name}</h3>
          <p className="text-xs text-slate-500">{row.policy_title}</p>
        </div>
      </div>

      {/* Status */}
      <StatusBadge status={row.coverage_status} />

      {/* Details */}
      <div className="space-y-2">
        <BoolLine label="Prior authorization needed" value={row.prior_auth_required} />
        <BoolLine label="Must try other meds first" value={row.step_therapy_required} />
        {row.quantity_limit_text && (
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <Shield className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <span>Quantity limit: {row.quantity_limit_text}</span>
          </div>
        )}
        {row.site_of_care_text && (
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <Shield className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <span>Where: {row.site_of_care_text}</span>
          </div>
        )}
      </div>

      {/* Criteria */}
      {row.criteria_summary.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1.5">What's required</p>
          <ul className="space-y-1">
            {row.criteria_summary.map((c, i) => (
              <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                <span className="text-slate-400 mt-1">&#8226;</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-slate-400">
        Effective: {row.effective_date} &middot; Version: {row.version_label}
      </div>
    </div>
  );
}

export default function ComparePlans() {
  const [drugName, setDrugName] = useState('');
  const [myPayer, setMyPayer] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState('');

  const myRow = result?.rows.find(
    r => r.payer_name.toLowerCase() === myPayer.toLowerCase(),
  ) ?? null;
  const bestRow = result ? pickBest(result.rows, myPayer) : null;
  const isSamePlan = myRow && bestRow && myRow.payer_name === bestRow.payer_name;

  const handleCompare = async () => {
    if (!drugName.trim() || !myPayer) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await postCompare({ drug_name: drugName });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white">
      <div className="max-w-4xl mx-auto px-5 py-10 space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <GitCompareArrows className="w-7 h-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Compare Your Plan</h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed max-w-lg mx-auto">
            See how your insurance plan compares to the best available coverage for a specific medication.
          </p>
        </div>

        {/* Inputs */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Your insurance plan</label>
            <select
              value={myPayer}
              onChange={e => setMyPayer(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select your plan...</option>
              {PAYERS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Medication name</label>
            <input
              type="text"
              value={drugName}
              onChange={e => setDrugName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCompare()}
              placeholder="e.g. Ozempic, Humira, semaglutide"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={handleCompare}
            disabled={loading || !drugName.trim() || !myPayer}
            className="w-full py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />}
            Compare Plans
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Comparing coverage across all plans...</p>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <>
            {/* No data for user's plan */}
            {!myRow && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
                <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                <p className="text-sm text-amber-800">
                  We don't have coverage data for <strong>{myPayer}</strong> and <strong>{result.drug_name}</strong> yet.
                </p>
                {bestRow && (
                  <p className="text-xs text-amber-600 mt-1">
                    But we found data for {result.rows.length} other plan{result.rows.length > 1 ? 's' : ''}.
                  </p>
                )}
              </div>
            )}

            {/* Your plan is already the best */}
            {myRow && isSamePlan && (
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 text-center">
                <Trophy className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <h3 className="text-lg font-semibold text-emerald-800">Great news!</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  Your plan (<strong>{myPayer}</strong>) already has the best coverage we found for <strong>{result.drug_name}</strong>.
                </p>
              </div>
            )}

            {/* Side by side comparison */}
            {myRow && bestRow && !isSamePlan && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {result.drug_name} — Your Plan vs. Best Available
                  </h2>
                </div>

                <div className="flex gap-4 items-stretch">
                  <PlanCard row={myRow} highlight="yours" />
                  <div className="flex items-center shrink-0">
                    <ArrowRight className="w-5 h-5 text-slate-300" />
                  </div>
                  <PlanCard row={bestRow} highlight="best" />
                </div>

                {/* Plain-language summary */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">What this means for you</h3>
                  <ul className="space-y-2 text-sm text-blue-800">
                    {STATUS_SCORE[bestRow.coverage_status] > STATUS_SCORE[myRow.coverage_status] && (
                      <li className="flex items-start gap-2">
                        <span>&#8226;</span>
                        <strong>{bestRow.payer_name}</strong> has better base coverage status ({bestRow.coverage_status.replace('_', ' ')} vs. {myRow.coverage_status.replace('_', ' ')}).
                      </li>
                    )}
                    {myRow.prior_auth_required === true && bestRow.prior_auth_required === false && (
                      <li className="flex items-start gap-2">
                        <span>&#8226;</span>
                        <strong>{bestRow.payer_name}</strong> doesn't require prior authorization, while your plan does.
                      </li>
                    )}
                    {myRow.step_therapy_required === true && bestRow.step_therapy_required === false && (
                      <li className="flex items-start gap-2">
                        <span>&#8226;</span>
                        <strong>{bestRow.payer_name}</strong> doesn't require trying other medications first, while your plan does.
                      </li>
                    )}
                    {myRow.quantity_limit_text && !bestRow.quantity_limit_text && (
                      <li className="flex items-start gap-2">
                        <span>&#8226;</span>
                        <strong>{bestRow.payer_name}</strong> has no quantity limits, while your plan limits to: {myRow.quantity_limit_text}.
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <span>&#8226;</span>
                      This comparison is based on published policy documents. Your actual coverage depends on your specific plan details and enrollment.
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* No results at all */}
            {result.rows.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                <HelpCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">
                  No coverage data found for "<strong>{result.drug_name}</strong>" in any plan.
                </p>
                <p className="text-xs text-slate-400 mt-1">Try a different spelling or the generic drug name.</p>
              </div>
            )}

            {/* Show best even if user's plan has no data */}
            {!myRow && bestRow && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Best coverage we found:</h3>
                <PlanCard row={bestRow} highlight="best" />
              </div>
            )}

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-xs text-amber-700 leading-relaxed">
                This comparison is informational only, based on published policy documents. It is not a guarantee of coverage or a recommendation to switch plans. Contact your insurance company to confirm your specific benefits.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
