import { useEffect, useMemo, useState } from 'react';
import {
  GitCompareArrows,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Trophy,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { getPlanMetadata, postCompare } from '../../api/client';
import type { CompareRow, CoverageStatus, MetadataPlan } from '../../types';

type CoverageLevel = 'covered' | 'restricted' | 'not_covered' | 'unclear';

const LEVEL_SCORE: Record<CoverageLevel, number> = {
  covered: 3,
  restricted: 2,
  unclear: 1,
  not_covered: 0,
};

const LEVEL_CONFIG: Record<
  CoverageLevel,
  { icon: typeof CheckCircle2; bg: string; border: string; text: string; label: string }
> = {
  covered: {
    icon: CheckCircle2,
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
    label: 'Likely covered',
  },
  restricted: {
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    label: 'Covered with conditions',
  },
  not_covered: {
    icon: XCircle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    label: 'Likely not covered',
  },
  unclear: {
    icon: HelpCircle,
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-600',
    label: 'Not clear yet',
  },
};

interface PlanResult {
  plan: MetadataPlan;
  row: CompareRow;
  level: CoverageLevel;
  summary: string;
}

function statusToLevel(status: CoverageStatus): CoverageLevel {
  if (status === 'covered') return 'covered';
  if (status === 'restricted') return 'restricted';
  if (status === 'not_covered') return 'not_covered';
  return 'unclear';
}

function statusText(status: CoverageStatus): string {
  if (status === 'covered') return 'Policy indicates this medication is covered.';
  if (status === 'restricted') return 'Policy indicates coverage with restrictions.';
  if (status === 'not_covered') return 'Policy indicates this medication is not covered.';
  return 'Coverage is not clearly stated in the available policy evidence.';
}

function rowSummary(row: CompareRow): string {
  const parts: string[] = [statusText(row.coverage_status)];

  if (row.prior_auth_required === true) parts.push('Prior authorization is required.');
  if (row.prior_auth_required === false) parts.push('No prior authorization requirement was found.');

  if (row.step_therapy_required === true) parts.push('Step therapy is required.');
  if (row.step_therapy_required === false) parts.push('No step therapy requirement was found.');

  if (row.criteria_summary.length > 0) {
    parts.push(row.criteria_summary.slice(0, 2).join(' '));
  }

  return parts.join(' ');
}

function emptyRow(planId: string): CompareRow {
  return {
    plan_id: planId,
    coverage_status: 'unknown',
    prior_auth_required: null,
    step_therapy_required: null,
    criteria_summary: [],
    citations: [],
  };
}

function ResultCard({
  result,
  tag,
}: {
  result: PlanResult;
  tag?: 'yours' | 'best';
}) {
  const cfg = LEVEL_CONFIG[result.level];
  const Icon = cfg.icon;
  const citation = result.row.citations[0];

  return (
    <div className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} p-5 flex-1 space-y-3`}>
      <div className="flex items-center gap-2 flex-wrap">
        {tag === 'yours' && (
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
            Your Plan
          </span>
        )}
        {tag === 'best' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">
            <Trophy className="w-3 h-3" /> Best Coverage
          </span>
        )}
        <h3 className="text-base font-semibold text-slate-900">{result.plan.plan_name}</h3>
      </div>

      <p className="text-xs text-slate-500">{result.plan.payer_name}</p>

      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {cfg.label}
      </span>

      <p className="text-sm text-slate-700 leading-relaxed">{result.summary}</p>

      {citation && (
        <div className="border-t border-slate-200 pt-3">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-500 leading-relaxed italic">
              &quot;{citation.snippet}&quot;
              {(citation.section || citation.page) && (
                <span className="not-italic ml-1 text-slate-400">
                  {citation.section || 'Policy'}
                  {citation.page ? `, p.${citation.page}` : ''}
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComparePlans() {
  const [plans, setPlans] = useState<MetadataPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [metadataError, setMetadataError] = useState('');

  const [drugName, setDrugName] = useState('');
  const [myPlanId, setMyPlanId] = useState('');
  const [loading, setLoading] = useState(false);
  const [myResult, setMyResult] = useState<PlanResult | null>(null);
  const [bestResult, setBestResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadMetadata = async () => {
      setLoadingPlans(true);
      setMetadataError('');
      try {
        const metadata = await getPlanMetadata();
        if (!mounted) return;
        setPlans(metadata.plans);
      } catch {
        if (!mounted) return;
        setPlans([]);
        setMetadataError('Unable to load plans right now.');
      } finally {
        if (mounted) setLoadingPlans(false);
      }
    };

    loadMetadata();
    return () => {
      mounted = false;
    };
  }, []);

  const planById = useMemo(() => {
    const byId = new Map<string, MetadataPlan>();
    plans.forEach(plan => byId.set(plan.plan_id, plan));
    return byId;
  }, [plans]);

  const handleCompare = async () => {
    if (!drugName.trim() || !myPlanId) return;
    setLoading(true);
    setError('');
    setMyResult(null);
    setBestResult(null);

    try {
      const planIds = [myPlanId, ...plans.filter(p => p.plan_id !== myPlanId).map(p => p.plan_id)];
      const response = await postCompare({
        drug_name: drugName.trim(),
        plan_ids: planIds,
      });

      const rowsByPlan = new Map<string, CompareRow>();
      response.rows.forEach(row => rowsByPlan.set(row.plan_id, row));

      const buildResult = (plan: MetadataPlan): PlanResult => {
        const row = rowsByPlan.get(plan.plan_id) || emptyRow(plan.plan_id);
        return {
          plan,
          row,
          level: statusToLevel(row.coverage_status),
          summary: rowSummary(row),
        };
      };

      const myPlan = planById.get(myPlanId);
      if (!myPlan) {
        throw new Error('Selected plan is no longer available. Please choose again.');
      }

      const mine = buildResult(myPlan);
      const others = plans
        .filter(plan => plan.plan_id !== myPlanId)
        .map(buildResult)
        .sort((a, b) => {
          const scoreDelta = LEVEL_SCORE[b.level] - LEVEL_SCORE[a.level];
          if (scoreDelta !== 0) return scoreDelta;
          return b.row.criteria_summary.length - a.row.criteria_summary.length;
        });

      const best = others.find(candidate => candidate.level !== 'unclear') || null;

      setMyResult(mine);
      setBestResult(best);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const isSamePlan = myResult && bestResult && myResult.plan.plan_id === bestResult.plan.plan_id;
  const myIsBest =
    myResult &&
    bestResult &&
    LEVEL_SCORE[myResult.level] >= LEVEL_SCORE[bestResult.level] &&
    myResult.row.criteria_summary.length >= bestResult.row.criteria_summary.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white">
      <div className="max-w-4xl mx-auto px-5 py-10 space-y-8">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <GitCompareArrows className="w-7 h-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Compare Your Plan</h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed max-w-lg mx-auto">
            Compare your selected plan with other plans using normalized backend policy data.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Your insurance plan</label>
            <select
              value={myPlanId}
              onChange={e => setMyPlanId(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loadingPlans || plans.length === 0}
            >
              <option value="">Select your plan...</option>
              {plans.map(plan => (
                <option key={plan.plan_id} value={plan.plan_id}>
                  {plan.plan_name} - {plan.payer_name}
                </option>
              ))}
            </select>
            {loadingPlans && <p className="mt-2 text-xs text-slate-400">Loading plans...</p>}
            {metadataError && <p className="mt-2 text-xs text-amber-600">{metadataError}</p>}
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
            disabled={loading || !drugName.trim() || !myPlanId}
            className="w-full py-3 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompareArrows className="w-4 h-4" />}
            {loading ? 'Comparing plans...' : 'Compare Plans'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {!loading && plans.length === 0 && !metadataError && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-sm text-amber-700">
              No plans are available yet. Add plan records in the backend DB to enable structured comparisons.
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Comparing coverage across plans...</p>
          </div>
        )}

        {!loading && myResult && (isSamePlan || myIsBest) && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 text-center">
            <Trophy className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <h3 className="text-lg font-semibold text-emerald-800">Great news</h3>
            <p className="text-sm text-emerald-700 mt-1">
              Your selected plan already appears to be the strongest match we found for <strong>{drugName}</strong>.
            </p>
            <div className="mt-4">
              <ResultCard result={myResult} tag="yours" />
            </div>
          </div>
        )}

        {!loading && myResult && !bestResult && (
          <div className="space-y-4">
            <ResultCard result={myResult} tag="yours" />
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-500">
                We could not find a clearly stronger alternative plan for this medication.
              </p>
            </div>
          </div>
        )}

        {!loading && myResult && bestResult && !isSamePlan && !myIsBest && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">{drugName} - Your Plan vs. Best Available</h2>

            <div className="flex gap-4 items-stretch">
              <ResultCard result={myResult} tag="yours" />
              <div className="flex items-center shrink-0">
                <ArrowRight className="w-5 h-5 text-slate-300" />
              </div>
              <ResultCard result={bestResult} tag="best" />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-blue-900">What this means for you</h3>
              <ul className="space-y-1.5 text-sm text-blue-800">
                <li className="flex items-start gap-2">
                  <span className="shrink-0">*</span>
                  <span>
                    <strong>{bestResult.plan.plan_name}</strong> currently looks stronger for <strong>{drugName}</strong> based on available policy evidence.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0">*</span>
                  <span>Use this as a starting point only and confirm details with your insurer.</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {!loading && myResult && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-xs text-amber-700 leading-relaxed">
              Informational only. Based on published policy documents; not a guarantee of coverage or a recommendation to switch plans.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}


