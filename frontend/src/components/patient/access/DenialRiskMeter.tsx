import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck, TrendingDown } from 'lucide-react';

type DenialType =
  | 'prior_auth_missing'
  | 'step_therapy'
  | 'non_formulary'
  | 'medical_necessity'
  | 'quantity_limit'
  | 'out_of_network';

interface RiskInputs {
  denialType: DenialType;
  documentationCompleteness: number;
  priorDenials: number;
  daysSinceSubmission: number;
  historicalApprovalRate: number;
  hasSpecialistSupport: boolean;
  hasRecentLabs: boolean;
  hasUrgencyDocumented: boolean;
  isOutOfNetwork: boolean;
  isHighCostTherapy: boolean;
}

interface RiskDriver {
  label: string;
  points: number;
}

const DENIAL_LABELS: Record<DenialType, string> = {
  prior_auth_missing: 'Missing / incomplete prior authorization',
  step_therapy: 'Step therapy requirement not met',
  non_formulary: 'Medication not on formulary',
  medical_necessity: 'Medical necessity not established',
  quantity_limit: 'Exceeded quantity limits',
  out_of_network: 'Out-of-network service/medication',
};

const DENIAL_BASE_RISK: Record<DenialType, number> = {
  prior_auth_missing: 54,
  step_therapy: 61,
  non_formulary: 65,
  medical_necessity: 68,
  quantity_limit: 50,
  out_of_network: 72,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bucket(score: number): { label: 'Low' | 'Moderate' | 'High' | 'Critical'; style: string } {
  if (score < 35) return { label: 'Low', style: 'bg-emerald-100 text-emerald-700' };
  if (score < 55) return { label: 'Moderate', style: 'bg-blue-100 text-blue-700' };
  if (score < 75) return { label: 'High', style: 'bg-amber-100 text-amber-700' };
  return { label: 'Critical', style: 'bg-red-100 text-red-700' };
}

function riskBarStyle(score: number): string {
  if (score < 35) return 'from-emerald-500 to-emerald-400';
  if (score < 55) return 'from-blue-500 to-cyan-500';
  if (score < 75) return 'from-amber-500 to-orange-500';
  return 'from-rose-600 to-red-500';
}

export default function DenialRiskMeter() {
  const [inputs, setInputs] = useState<RiskInputs>({
    denialType: 'medical_necessity',
    documentationCompleteness: 62,
    priorDenials: 1,
    daysSinceSubmission: 6,
    historicalApprovalRate: 47,
    hasSpecialistSupport: true,
    hasRecentLabs: false,
    hasUrgencyDocumented: false,
    isOutOfNetwork: false,
    isHighCostTherapy: true,
  });

  const updateNumber = (key: keyof RiskInputs, value: string, min = 0, max = 100) => {
    const parsed = Number(value);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : min;
    setInputs(prev => ({ ...prev, [key]: next }));
  };

  const updateBoolean = (key: keyof RiskInputs, value: boolean) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  const riskComputation = useMemo(() => {
    const drivers: RiskDriver[] = [
      { label: 'Denial category baseline', points: DENIAL_BASE_RISK[inputs.denialType] },
      { label: 'Missing documentation', points: (100 - inputs.documentationCompleteness) * 0.34 },
      { label: 'Prior denials', points: inputs.priorDenials * 4.6 },
      { label: 'Days without resolution', points: Math.min(inputs.daysSinceSubmission, 21) * 0.38 },
      { label: 'Lower historical approval rate', points: Math.max(0, 70 - inputs.historicalApprovalRate) * 0.22 },
      { label: 'Out-of-network complexity', points: inputs.isOutOfNetwork ? 11 : 0 },
      { label: 'High-cost therapy exposure', points: inputs.isHighCostTherapy ? 7 : 0 },
      { label: 'Specialist support present', points: inputs.hasSpecialistSupport ? -10 : 7 },
      { label: 'Recent labs or objective metrics', points: inputs.hasRecentLabs ? -7 : 5 },
      { label: 'Urgency documented', points: inputs.hasUrgencyDocumented ? -5 : 4 },
    ];

    const scoreRaw = drivers.reduce((sum, item) => sum + item.points, 0);
    const score = clamp(scoreRaw, 0, 100);

    const rankedDrivers = drivers
      .filter(driver => driver.points > 1)
      .sort((a, b) => b.points - a.points)
      .slice(0, 4);

    const projectedScore = clamp(
      score -
        (100 - inputs.documentationCompleteness) * 0.16 -
        (inputs.hasRecentLabs ? 0 : 6) -
        (inputs.hasUrgencyDocumented ? 0 : 5) -
        (inputs.hasSpecialistSupport ? 0 : 9),
      0,
      100,
    );

    return { score, rankedDrivers, projectedScore };
  }, [inputs]);

  const riskTier = bucket(riskComputation.score);
  const projectedTier = bucket(riskComputation.projectedScore);

  const mitigationSteps = useMemo(() => {
    const steps: string[] = [];
    if (inputs.documentationCompleteness < 80) {
      steps.push('Attach payer-specific criteria checklist and complete all missing fields.');
    }
    if (!inputs.hasRecentLabs) {
      steps.push('Add objective labs or clinical metrics that map directly to policy criteria.');
    }
    if (!inputs.hasUrgencyDocumented) {
      steps.push('Document harm-from-delay and request expedited review when appropriate.');
    }
    if (!inputs.hasSpecialistSupport) {
      steps.push('Add specialist attestation or peer-to-peer escalation notes.');
    }
    if (inputs.isOutOfNetwork) {
      steps.push('Prepare a single-case agreement or network adequacy exception packet.');
    }
    if (steps.length === 0) {
      steps.push('Package current evidence into a structured appeal and track SLA follow-ups.');
    }
    return steps.slice(0, 4);
  }, [inputs]);

  return (
    <div className="space-y-4">
      <div className="app-surface border-rose-200 bg-gradient-to-r from-rose-600 to-orange-500 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-100">Predictive Triage</p>
        <h3 className="mt-1 text-xl font-semibold">Denial Risk Meter</h3>
        <p className="mt-1 text-sm text-rose-100">
          Estimate denial risk before submitting appeal artifacts so teams can prioritize mitigation quickly.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="app-surface space-y-4 p-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Denial category</label>
            <select
              value={inputs.denialType}
              onChange={event => setInputs(prev => ({ ...prev, denialType: event.target.value as DenialType }))}
              className="app-input"
            >
              {Object.entries(DENIAL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Documentation completeness
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={inputs.documentationCompleteness}
                onChange={event => updateNumber('documentationCompleteness', event.target.value, 0, 100)}
                className="w-full accent-rose-600"
              />
              <p className="text-xs text-slate-600">{inputs.documentationCompleteness}%</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Historical approval rate
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={inputs.historicalApprovalRate}
                onChange={event => updateNumber('historicalApprovalRate', event.target.value, 0, 100)}
                className="w-full accent-rose-600"
              />
              <p className="text-xs text-slate-600">{inputs.historicalApprovalRate}%</p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Prior denials
              </label>
              <input
                type="number"
                value={inputs.priorDenials}
                onChange={event => updateNumber('priorDenials', event.target.value, 0, 10)}
                className="app-input"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Days since submission
              </label>
              <input
                type="number"
                value={inputs.daysSinceSubmission}
                onChange={event => updateNumber('daysSinceSubmission', event.target.value, 0, 60)}
                className="app-input"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Case signals</p>
            <div className="grid gap-2 md:grid-cols-2">
              {[
                { key: 'hasSpecialistSupport', label: 'Specialist support letter' },
                { key: 'hasRecentLabs', label: 'Recent labs or objective evidence' },
                { key: 'hasUrgencyDocumented', label: 'Urgency documented' },
                { key: 'isOutOfNetwork', label: 'Out-of-network case' },
                { key: 'isHighCostTherapy', label: 'High-cost therapy' },
              ].map(item => {
                const checked = inputs[item.key as keyof RiskInputs] as boolean;
                return (
                  <label
                    key={item.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                      checked ? 'border-rose-200 bg-rose-50/70 text-rose-700' : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event => updateBoolean(item.key as keyof RiskInputs, event.target.checked)}
                      className="accent-rose-600"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="app-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Current risk</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-4xl font-semibold text-slate-900">{Math.round(riskComputation.score)}</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskTier.style}`}>
                {riskTier.label}
              </span>
            </div>
            <div className="mt-3 h-3 rounded-full bg-slate-200">
              <div
                className={`h-3 rounded-full bg-gradient-to-r ${riskBarStyle(riskComputation.score)}`}
                style={{ width: `${riskComputation.score}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Higher score means higher probability of denial friction without mitigation.
            </p>
          </div>

          <div className="app-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Top risk drivers</p>
            <ul className="mt-2 space-y-2">
              {riskComputation.rankedDrivers.map(driver => (
                <li key={driver.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">{driver.label}</span>
                  <span className="font-semibold text-slate-900">+{Math.round(driver.points)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="app-surface border-emerald-200 bg-emerald-50/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700">Projected score after mitigation</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-semibold text-emerald-900">{Math.round(riskComputation.projectedScore)}</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${projectedTier.style}`}>
                {projectedTier.label}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-800">
              <TrendingDown className="h-3.5 w-3.5" />
              Potential reduction: {Math.round(riskComputation.score - riskComputation.projectedScore)} points
            </p>
          </div>
        </aside>
      </div>

      <div className="app-surface p-5">
        <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">Mitigation playbook</h4>
        <ul className="mt-3 space-y-2">
          {mitigationSteps.map(step => (
            <li key={step} className="flex items-start gap-2 text-sm text-slate-700">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
              <span>{step}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="app-surface border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900">
        <p className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
          Risk meter is a planning aid and not a guarantee of payer outcome.
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
          Pair this score with plan-specific criteria and legal/compliance review before filing.
        </p>
      </div>
    </div>
  );
}
