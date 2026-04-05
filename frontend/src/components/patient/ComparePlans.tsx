import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  GitCompareArrows,
  HelpCircle,
  Loader2,
  Pill,
  Trophy,
  XCircle,
} from 'lucide-react';
import { getPlanMetadata, postCompare } from '../../api/client';
import type { CompareRow, CoverageStatus, MetadataPlan } from '../../types';

type CoverageLevel = 'covered' | 'restricted' | 'not_covered' | 'unclear';

interface PlanResult {
  plan: MetadataPlan;
  row: CompareRow;
  level: CoverageLevel;
  summary: string;
  score: number;
}

const LEVEL_SCORE: Record<CoverageLevel, number> = {
  covered: 4,
  restricted: 2,
  unclear: 1,
  not_covered: 0,
};

const LEVEL_CONFIG: Record<
  CoverageLevel,
  { icon: typeof CheckCircle2; label: string; bg: string; border: string; text: string }
> = {
  covered: {
    icon: CheckCircle2,
    label: 'Likely covered',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-800',
  },
  restricted: {
    icon: AlertTriangle,
    label: 'Covered with conditions',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
  },
  not_covered: {
    icon: XCircle,
    label: 'Likely not covered',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
  },
  unclear: {
    icon: HelpCircle,
    label: 'Unclear evidence',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-700',
  },
};

const MEDICATION_QUICK_PICKS = ['Ozempic', 'Wegovy', 'Humira', 'Mounjaro', 'Skyrizi'];

function statusToLevel(status: CoverageStatus): CoverageLevel {
  if (status === 'covered') return 'covered';
  if (status === 'restricted') return 'restricted';
  if (status === 'not_covered') return 'not_covered';
  return 'unclear';
}

function rowSummary(row: CompareRow): string {
  const parts: string[] = [];

  if (row.coverage_status === 'covered') {
    parts.push('Policy evidence suggests this medication is covered.');
  } else if (row.coverage_status === 'restricted') {
    parts.push('Coverage is available, but the policy indicates conditions.');
  } else if (row.coverage_status === 'not_covered') {
    parts.push('Policy evidence suggests this medication is excluded.');
  } else {
    parts.push('Coverage is not clearly stated in available evidence.');
  }

  if (row.prior_auth_required === true) parts.push('Prior authorization is required.');
  if (row.prior_auth_required === false) parts.push('No prior authorization requirement detected.');

  if (row.step_therapy_required === true) parts.push('Step therapy requirements were found.');
  if (row.step_therapy_required === false) parts.push('No step therapy requirement detected.');

  return parts.join(' ');
}

function calculateScore(row: CompareRow): number {
  const level = statusToLevel(row.coverage_status);
  let score = LEVEL_SCORE[level] * 10;

  if (row.prior_auth_required === false) score += 2;
  if (row.prior_auth_required === true) score -= 1;

  if (row.step_therapy_required === false) score += 2;
  if (row.step_therapy_required === true) score -= 1;

  score -= Math.min(row.criteria_summary.length, 4);
  return score;
}

function fallbackRow(planId: string): CompareRow {
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
  badge,
}: {
  result: PlanResult;
  badge?: 'mine' | 'best';
}) {
  const cfg = LEVEL_CONFIG[result.level];
  const Icon = cfg.icon;
  const citation = result.row.citations[0];

  return (
    <article className={`app-surface h-full border-2 ${cfg.border} ${cfg.bg} p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        {badge === 'mine' && (
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
            Your Plan
          </span>
        )}
        {badge === 'best' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <Trophy className="h-3 w-3" />
            Top Alternative
          </span>
        )}
        <p className="text-sm font-semibold text-slate-900">{result.plan.plan_name}</p>
      </div>

      <p className="mt-1 text-xs text-slate-500">{result.plan.payer_name}</p>

      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold">
        <Icon className={`h-3.5 w-3.5 ${cfg.text}`} />
        <span className={cfg.text}>{cfg.label}</span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-700">{result.summary}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
          <p className="text-slate-500">PA</p>
          <p className="mt-0.5 font-semibold text-slate-700">
            {result.row.prior_auth_required === null ? 'Unknown' : result.row.prior_auth_required ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
          <p className="text-slate-500">Step</p>
          <p className="mt-0.5 font-semibold text-slate-700">
            {result.row.step_therapy_required === null ? 'Unknown' : result.row.step_therapy_required ? 'Yes' : 'No'}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
          <p className="text-slate-500">Score</p>
          <p className="mt-0.5 font-semibold text-slate-700">{result.score}</p>
        </div>
      </div>

      {citation && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs italic leading-relaxed text-slate-600">
          &quot;{citation.snippet}&quot;
        </p>
      )}
    </article>
  );
}

export default function ComparePlans() {
  const [plans, setPlans] = useState<MetadataPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [metadataError, setMetadataError] = useState('');

  const [myPlanId, setMyPlanId] = useState('');
  const [drugName, setDrugName] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myResult, setMyResult] = useState<PlanResult | null>(null);
  const [bestResult, setBestResult] = useState<PlanResult | null>(null);
  const [rankedAlternatives, setRankedAlternatives] = useState<PlanResult[]>([]);

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

    void loadMetadata();
    return () => {
      mounted = false;
    };
  }, []);

  const planById = useMemo(() => {
    const map = new Map<string, MetadataPlan>();
    plans.forEach(plan => map.set(plan.plan_id, plan));
    return map;
  }, [plans]);

  const myPlan = myPlanId ? planById.get(myPlanId) ?? null : null;

  const handleCompare = async () => {
    if (!myPlanId || !drugName.trim()) return;

    setLoading(true);
    setError('');
    setMyResult(null);
    setBestResult(null);
    setRankedAlternatives([]);

    try {
      const planIds = [myPlanId, ...plans.filter(plan => plan.plan_id !== myPlanId).map(plan => plan.plan_id)];
      const response = await postCompare({
        drug_name: drugName.trim(),
        plan_ids: planIds,
        effective_on: effectiveOn || undefined,
      });

      const rowsByPlan = new Map<string, CompareRow>();
      response.rows.forEach(row => rowsByPlan.set(row.plan_id, row));

      const buildResult = (plan: MetadataPlan): PlanResult => {
        const row = rowsByPlan.get(plan.plan_id) ?? fallbackRow(plan.plan_id);
        return {
          plan,
          row,
          level: statusToLevel(row.coverage_status),
          summary: rowSummary(row),
          score: calculateScore(row),
        };
      };

      const minePlan = planById.get(myPlanId);
      if (!minePlan) {
        throw new Error('Selected plan is no longer available. Please choose your plan again.');
      }

      const mine = buildResult(minePlan);
      const alternatives = plans
        .filter(plan => plan.plan_id !== myPlanId)
        .map(buildResult)
        .sort((a, b) => b.score - a.score);

      setMyResult(mine);
      setBestResult(alternatives[0] ?? null);
      setRankedAlternatives(alternatives.slice(0, 5));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unable to compare plans right now. Please retry.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const myIsStrongest =
    myResult && bestResult ? myResult.score >= bestResult.score && myResult.level !== 'unclear' : false;

  return (
    <div className="space-y-6">
      <section className="app-surface border-blue-100/90 bg-gradient-to-r from-blue-600 to-indigo-600 p-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-100">Decision Support</p>
        <h1 className="mt-2 text-3xl font-semibold">Compare Medication Coverage</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-blue-100">
          Select your current plan and medication to benchmark alternatives. We rank by likely coverage level and policy restriction burden.
        </p>
      </section>

      <section className="app-surface space-y-4 p-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700">Your insurance plan</label>
            <select
              value={myPlanId}
              onChange={event => setMyPlanId(event.target.value)}
              className="app-input"
              disabled={loadingPlans || plans.length === 0}
            >
              <option value="">Select your plan...</option>
              {plans.map(plan => (
                <option key={plan.plan_id} value={plan.plan_id}>
                  {plan.plan_name} - {plan.payer_name}
                </option>
              ))}
            </select>
            {loadingPlans && <p className="mt-2 text-xs text-slate-400">Loading plan metadata...</p>}
            {metadataError && <p className="mt-2 text-xs text-amber-700">{metadataError}</p>}
          </div>

          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              Effective date (optional)
            </label>
            <input
              type="date"
              value={effectiveOn}
              onChange={event => setEffectiveOn(event.target.value)}
              className="app-input"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Medication name</label>
          <input
            type="text"
            value={drugName}
            onChange={event => setDrugName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                void handleCompare();
              }
            }}
            placeholder="e.g., Ozempic, Humira, semaglutide"
            className="app-input"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MEDICATION_QUICK_PICKS.map(name => (
            <button key={name} onClick={() => setDrugName(name)} className="app-chip">
              <Pill className="mr-1 inline h-3 w-3" />
              {name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {myPlan ? `Comparing from your baseline: ${myPlan.plan_name}` : 'Choose your plan to begin.'}
          </p>
          <button
            onClick={() => void handleCompare()}
            disabled={loading || !myPlanId || !drugName.trim()}
            className="app-button-primary"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
            {loading ? 'Comparing...' : 'Compare Plans'}
          </button>
        </div>
      </section>

      {error && (
        <section className="app-surface border-red-200 bg-red-50/80 p-5 text-center">
          <p className="text-sm text-red-700">{error}</p>
        </section>
      )}

      {!loading && plans.length === 0 && !metadataError && (
        <section className="app-surface border-amber-200 bg-amber-50/80 p-5 text-center">
          <p className="text-sm text-amber-800">
            No plan metadata is available yet. Insert plan records in the backend database to enable comparisons.
          </p>
        </section>
      )}

      {loading && (
        <section className="app-surface py-10 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm text-slate-600">Analyzing coverage and restrictions across plans...</p>
        </section>
      )}

      {!loading && myResult && (
        <section className="space-y-5">
          {myIsStrongest && (
            <div className="app-surface border-emerald-200 bg-emerald-50/80 p-5">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <h3 className="text-lg font-semibold text-emerald-900">Your plan appears competitive</h3>
                  <p className="mt-1 text-sm text-emerald-800">
                    Based on available policy evidence, your selected plan currently scores at or above the top alternative for{' '}
                    <strong>{drugName}</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!bestResult && (
            <div className="app-surface p-5 text-center">
              <p className="text-sm text-slate-600">
                We did not find a clearly ranked alternative for this medication. Your plan details are shown below.
              </p>
            </div>
          )}

          <div className={`grid gap-4 ${bestResult ? 'xl:grid-cols-[1fr_auto_1fr]' : 'xl:grid-cols-1'}`}>
            <ResultCard result={myResult} badge="mine" />

            {bestResult && (
              <>
                <div className="hidden items-center justify-center xl:flex">
                  <ArrowRight className="h-5 w-5 text-slate-400" />
                </div>
                <ResultCard result={bestResult} badge="best" />
              </>
            )}
          </div>

          {rankedAlternatives.length > 0 && (
            <div className="app-surface p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">Top Alternatives</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-2 py-2">Plan</th>
                      <th className="px-2 py-2">Coverage</th>
                      <th className="px-2 py-2">PA</th>
                      <th className="px-2 py-2">Step</th>
                      <th className="px-2 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rankedAlternatives.map(candidate => (
                      <tr key={candidate.plan.plan_id} className="text-slate-700">
                        <td className="px-2 py-2">
                          <p className="font-medium text-slate-800">{candidate.plan.plan_name}</p>
                          <p className="text-xs text-slate-500">{candidate.plan.payer_name}</p>
                        </td>
                        <td className="px-2 py-2">{LEVEL_CONFIG[candidate.level].label}</td>
                        <td className="px-2 py-2">
                          {candidate.row.prior_auth_required === null ? 'Unknown' : candidate.row.prior_auth_required ? 'Yes' : 'No'}
                        </td>
                        <td className="px-2 py-2">
                          {candidate.row.step_therapy_required === null ? 'Unknown' : candidate.row.step_therapy_required ? 'Yes' : 'No'}
                        </td>
                        <td className="px-2 py-2 font-semibold">{candidate.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="app-surface border-amber-200 bg-amber-50/80 p-4">
            <p className="text-xs leading-relaxed text-amber-900">
              Informational only. Plan switching decisions should consider premium, network, deductible, and clinical context beyond this policy comparison.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
