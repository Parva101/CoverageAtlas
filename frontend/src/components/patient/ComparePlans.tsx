import { useEffect, useMemo, useState } from 'react';
import {
  GitCompareArrows,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Trophy,
  FileText,
  Sparkles,
  TrendingUp,
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
  { icon: typeof CheckCircle2; bg: string; border: string; text: string; iconColor: string; badge: string; badgeBg: string; label: string }
> = {
  covered: {
    icon: CheckCircle2,
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    iconColor: 'text-emerald-500',
    badge: 'text-emerald-700',
    badgeBg: 'bg-emerald-100',
    label: 'Likely covered',
  },
  restricted: {
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-900',
    iconColor: 'text-amber-500',
    badge: 'text-amber-700',
    badgeBg: 'bg-amber-100',
    label: 'Covered with conditions',
  },
  not_covered: {
    icon: XCircle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-900',
    iconColor: 'text-red-500',
    badge: 'text-red-700',
    badgeBg: 'bg-red-100',
    label: 'Likely not covered',
  },
  unclear: {
    icon: HelpCircle,
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-600',
    iconColor: 'text-slate-400',
    badge: 'text-slate-500',
    badgeBg: 'bg-slate-100',
    label: 'Not clear yet',
  },
};

interface PlanResult {
  plan: MetadataPlan;
  row: CompareRow;
  level: CoverageLevel;
  summary: string;
}

interface TableRowModel {
  result: PlanResult;
  priorAuthLabel: string;
  priorAuthClass: string;
  stepTherapyLabel: string;
  stepTherapyClass: string;
  notes: string;
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
    quantity_limit_text: null,
    site_of_care_text: null,
    criteria_summary: [],
    citations: [],
  };
}

function coverageDot(level: CoverageLevel): string {
  if (level === 'covered') return 'bg-emerald-400';
  if (level === 'restricted') return 'bg-amber-400';
  if (level === 'not_covered') return 'bg-red-400';
  return 'bg-slate-400';
}

function authRequirement(value: boolean | null): { label: string; className: string } {
  if (value === true) return { label: 'Required', className: 'text-amber-300' };
  if (value === false) return { label: 'No', className: 'text-emerald-300' };
  return { label: 'Unknown', className: 'text-slate-400' };
}

function summaryNote(row: CompareRow): string {
  if (row.criteria_summary.length > 0) return row.criteria_summary[0];
  if (row.site_of_care_text) return row.site_of_care_text;
  return statusText(row.coverage_status);
}

function toTableRowModel(result: PlanResult): TableRowModel {
  const priorAuth = authRequirement(result.row.prior_auth_required);
  const stepTherapy = authRequirement(result.row.step_therapy_required);
  return {
    result,
    priorAuthLabel: priorAuth.label,
    priorAuthClass: priorAuth.className,
    stepTherapyLabel: stepTherapy.label,
    stepTherapyClass: stepTherapy.className,
    notes: summaryNote(result.row),
  };
}

function StatusPill({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
      value ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {value ? '⚠ ' : '✓ '}{label}
    </span>
  );
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
    <div className={`rounded-2xl border-2 ${cfg.border} ${cfg.bg} p-5 flex-1 space-y-3 transition-all`}>
      {/* Tags */}
      <div className="flex items-center gap-2 flex-wrap">
        {tag === 'yours' && (
          <span className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold">
            Your Plan
          </span>
        )}
        {tag === 'best' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-semibold">
            <Trophy className="w-3 h-3" /> Best Match
          </span>
        )}
      </div>

      {/* Plan name */}
      <div>
        <h3 className="text-base font-bold text-slate-900">{result.plan.plan_name}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{result.plan.payer_name}</p>
      </div>

      {/* Coverage status */}
      <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl ${cfg.badgeBg} border ${cfg.border}`}>
        <Icon className={`w-4 h-4 ${cfg.iconColor} shrink-0`} />
        <span className={`text-sm font-semibold ${cfg.badge}`}>{cfg.label}</span>
      </div>

      {/* Auth pills */}
      <div className="flex flex-wrap gap-1.5">
        <StatusPill label="Prior Auth" value={result.row.prior_auth_required} />
        <StatusPill label="Step Therapy" value={result.row.step_therapy_required} />
      </div>

      {/* Summary */}
      <p className="text-sm text-slate-600 leading-relaxed">{result.summary}</p>

      {/* Citation */}
      {citation && (
        <div className="border-t border-slate-200/80 pt-3">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed italic">
              &quot;{citation.snippet}&quot;
              {(citation.section || citation.page) && (
                <span className="not-italic ml-1 text-slate-300">
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
  const [allResults, setAllResults] = useState<PlanResult[]>([]);
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
    setAllResults([]);

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
      setAllResults([mine, ...others]);
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
    <div className="space-y-6">
      <div className="max-w-4xl mx-auto px-5 py-10 space-y-6">
        <section className="app-page-hero animate-fade-in-up">
          <div className="app-page-hero-content grid gap-4 md:grid-cols-[1.6fr_1fr] items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100">Comparison Workspace</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Compare Plan Coverage</h1>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-sky-100">
                See how your plan stacks up against alternatives for any medication.
              </p>
              <div className="app-page-hero-chip mt-4 inline-flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" />
                Compare across all available plans
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="app-page-hero-stat">
                <p>Plans</p>
                <p className="mt-1 text-lg font-semibold">{loadingPlans ? '...' : plans.length}</p>
              </div>
              <div className="app-page-hero-stat">
                <p>Mode</p>
                <p className="mt-1 text-sm font-semibold">Plan Compare</p>
              </div>
              <div className="app-page-hero-stat col-span-2">
                Coverage status, prior auth, and step-therapy insights in one view.
              </div>
            </div>
          </div>
        </section>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4 animate-fade-in-up stagger-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                Your insurance plan
              </label>
              <select
                value={myPlanId}
                onChange={e => setMyPlanId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loadingPlans || plans.length === 0}
              >
                <option value="">Select your plan...</option>
                {plans.map(plan => (
                  <option key={plan.plan_id} value={plan.plan_id}>
                    {plan.plan_name} — {plan.payer_name}
                  </option>
                ))}
              </select>
              {loadingPlans && <p className="mt-1.5 text-xs text-slate-400">Loading plans...</p>}
              {metadataError && <p className="mt-1.5 text-xs text-amber-600">{metadataError}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                Medication name
              </label>
              <input
                type="text"
                value={drugName}
                onChange={e => setDrugName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCompare()}
                placeholder="e.g. Ozempic, Humira, semaglutide"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={handleCompare}
            disabled={loading || !drugName.trim() || !myPlanId}
            className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.99]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitCompareArrows className="w-4 h-4" />
            )}
            {loading ? 'Comparing plans...' : 'Compare Plans'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center animate-fade-in">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* No plans available */}
        {!loading && plans.length === 0 && !metadataError && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-sm text-amber-700">
              No plans are available yet. Add plan records in the backend DB to enable structured comparisons.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 animate-fade-in">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
              <GitCompareArrows className="absolute inset-0 m-auto w-6 h-6 text-blue-500" />
            </div>
            <p className="text-sm font-medium text-slate-600">Comparing coverage across plans...</p>
            <p className="text-xs text-slate-400 mt-1">Analyzing policy documents</p>
          </div>
        )}

        {/* Your plan is best */}
        {!loading && myResult && (isSamePlan || myIsBest) && (
          <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-300 rounded-2xl p-6 text-center animate-fade-in-up">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <Trophy className="w-7 h-7 text-emerald-500" />
            </div>
            <h3 className="text-lg font-bold text-emerald-900">Your plan looks great</h3>
            <p className="text-sm text-emerald-700 mt-1 max-w-sm mx-auto">
              Your selected plan appears to be the strongest match we found for <strong>{drugName}</strong>.
            </p>
            <div className="mt-5 max-w-md mx-auto">
              <ResultCard result={myResult} tag="yours" />
            </div>
          </div>
        )}

        {/* No better alternative */}
        {!loading && myResult && !bestResult && !(isSamePlan || myIsBest) && (
          <div className="space-y-4 animate-fade-in-up">
            <ResultCard result={myResult} tag="yours" />
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-500">
                We could not find a clearly stronger alternative plan for this medication.
              </p>
            </div>
          </div>
        )}

        {/* Side-by-side comparison */}
        {!loading && myResult && bestResult && !isSamePlan && !myIsBest && (
          <div className="space-y-5 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {drugName} — Plan Comparison
              </h2>
              <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                {plans.length} plans analyzed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ResultCard result={myResult} tag="yours" />
              <ResultCard result={bestResult} tag="best" />
            </div>

            {/* Verdict */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-sm font-bold text-blue-900">What this means for you</h3>
              </div>
              <ul className="space-y-2">
                <li className="flex items-start gap-2.5 text-sm text-blue-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                  <span>
                    <strong>{bestResult.plan.plan_name}</strong> currently looks stronger for <strong>{drugName}</strong> based on available policy evidence.
                  </span>
                </li>
                <li className="flex items-start gap-2.5 text-sm text-blue-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                  <span>Use this as a starting point and confirm details with your insurer before making any decisions.</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        {!loading && allResults.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-xl overflow-hidden animate-fade-in-up">
            <div className="px-5 py-4 border-b border-slate-800">
              <h3 className="text-xl font-semibold">{drugName || 'Medication comparison'}</h3>
              <p className="text-sm text-slate-400 mt-1">
                Detailed coverage snapshot across analyzed plans
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-900/70 text-slate-400 text-xs uppercase tracking-[0.08em]">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 font-semibold">Prior Auth</th>
                    <th className="px-4 py-3 font-semibold">Step Therapy</th>
                    <th className="px-4 py-3 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {allResults.map(result => {
                    const row = toTableRowModel(result);
                    return (
                      <tr key={result.plan.plan_id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-start gap-2.5">
                            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${coverageDot(result.level)}`} />
                            <div>
                              <p className="text-base font-semibold text-slate-100">{result.plan.payer_name}</p>
                              <p className="text-base font-medium text-slate-200">{result.plan.plan_name}</p>
                            </div>
                          </div>
                        </td>
                        <td className={`px-4 py-4 align-top text-sm font-semibold ${row.priorAuthClass}`}>
                          {row.priorAuthLabel}
                        </td>
                        <td className={`px-4 py-4 align-top text-sm font-semibold ${row.stepTherapyClass}`}>
                          {row.stepTherapyLabel}
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-slate-300 max-w-[20rem]">
                          {row.notes}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && myResult && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center animate-fade-in">
            <p className="text-xs text-amber-700 leading-relaxed">
              Informational only. Based on published policy documents; not a guarantee of coverage or a recommendation to switch plans.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
