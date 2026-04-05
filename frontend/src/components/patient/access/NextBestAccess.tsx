import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Route, ShieldCheck, Sparkles } from 'lucide-react';
import { postQuery } from '../../../api/client';
import { usePlanMetadata } from '../../../hooks/usePlanMetadata';
import type { QueryResponse } from '../../../types';

type DenialType =
  | 'prior_auth_missing'
  | 'step_therapy'
  | 'non_formulary'
  | 'medical_necessity'
  | 'quantity_limit'
  | 'out_of_network';

interface Strategy {
  id: string;
  title: string;
  lane: 'clinical' | 'administrative' | 'financial';
  etaDays: number;
  baseScore: number;
  requirements: Array<{
    key: keyof EvidenceState;
    label: string;
    bonus: number;
  }>;
  steps: string[];
}

interface EvidenceState {
  hasRecentLabs: boolean;
  hasFailedAlternatives: boolean;
  hasSpecialistNote: boolean;
  hasGuidelineSupport: boolean;
  hasUrgencyFlag: boolean;
  hasContinuityOfCare: boolean;
}

const DENIAL_LABELS: Record<DenialType, string> = {
  prior_auth_missing: 'Missing / incomplete prior authorization',
  step_therapy: 'Step therapy requirement not met',
  non_formulary: 'Medication not on formulary',
  medical_necessity: 'Medical necessity not established',
  quantity_limit: 'Exceeded quantity limits',
  out_of_network: 'Out-of-network service/medication',
};

const STRATEGIES_BY_DENIAL: Record<DenialType, Strategy[]> = {
  prior_auth_missing: [
    {
      id: 'pa-resubmit',
      title: 'PA resubmission with checklist',
      lane: 'administrative',
      etaDays: 5,
      baseScore: 58,
      requirements: [
        { key: 'hasRecentLabs', label: 'Recent labs', bonus: 10 },
        { key: 'hasSpecialistNote', label: 'Specialist note', bonus: 12 },
        { key: 'hasGuidelineSupport', label: 'Guideline citation', bonus: 8 },
      ],
      steps: [
        'Re-submit PA with complete diagnosis and medication history.',
        'Attach the insurer-specific criteria checklist.',
        'Request expedited handling if clinically urgent.',
      ],
    },
    {
      id: 'peer-to-peer',
      title: 'Peer-to-peer clinical review',
      lane: 'clinical',
      etaDays: 3,
      baseScore: 52,
      requirements: [
        { key: 'hasSpecialistNote', label: 'Specialist support', bonus: 14 },
        { key: 'hasUrgencyFlag', label: 'Urgency documented', bonus: 10 },
      ],
      steps: [
        'Schedule provider-to-medical-director discussion.',
        'Prepare concise clinical rationale and treatment timeline.',
        'Document outcomes and requested next action.',
      ],
    },
    {
      id: 'expedited-appeal',
      title: 'Expedited first-level appeal',
      lane: 'administrative',
      etaDays: 7,
      baseScore: 49,
      requirements: [
        { key: 'hasUrgencyFlag', label: 'Urgency/health risk', bonus: 14 },
        { key: 'hasGuidelineSupport', label: 'Guideline support', bonus: 9 },
      ],
      steps: [
        'File an expedited appeal with supporting records.',
        'Include timeline of failed alternatives and risk of delay.',
        'Track turnaround SLA and follow up proactively.',
      ],
    },
  ],
  step_therapy: [
    {
      id: 'step-documentation',
      title: 'Document failed step therapies',
      lane: 'clinical',
      etaDays: 6,
      baseScore: 61,
      requirements: [
        { key: 'hasFailedAlternatives', label: 'Failed alternatives evidence', bonus: 18 },
        { key: 'hasSpecialistNote', label: 'Specialist attestation', bonus: 10 },
      ],
      steps: [
        'Submit prior med trials, dosing, and adverse effects.',
        'Attach clinician note explaining why additional steps are unsafe.',
        'Request medical exception to step protocol.',
      ],
    },
    {
      id: 'medical-exception',
      title: 'Medical exception request',
      lane: 'clinical',
      etaDays: 8,
      baseScore: 55,
      requirements: [
        { key: 'hasGuidelineSupport', label: 'Evidence guideline match', bonus: 12 },
        { key: 'hasContinuityOfCare', label: 'Continuity of care evidence', bonus: 10 },
      ],
      steps: [
        'Prepare exception request citing contraindications or treatment failure.',
        'Attach guideline references and continuity concerns.',
        'Escalate to peer review if denied.',
      ],
    },
    {
      id: 'bridge-therapy',
      title: 'Bridge pathway + re-authorization',
      lane: 'financial',
      etaDays: 4,
      baseScore: 45,
      requirements: [
        { key: 'hasUrgencyFlag', label: 'Urgent clinical need', bonus: 10 },
        { key: 'hasSpecialistNote', label: 'Provider justification', bonus: 10 },
      ],
      steps: [
        'Use short-term bridge therapy to avoid treatment gap.',
        'Collect outcomes and re-submit authorization packet.',
        'Transition to preferred access pathway once approved.',
      ],
    },
  ],
  non_formulary: [
    {
      id: 'formulary-exception',
      title: 'Formulary exception request',
      lane: 'administrative',
      etaDays: 7,
      baseScore: 57,
      requirements: [
        { key: 'hasFailedAlternatives', label: 'Covered alternatives failed', bonus: 15 },
        { key: 'hasGuidelineSupport', label: 'Guideline support', bonus: 10 },
      ],
      steps: [
        'Submit formulary exception form with clinical rationale.',
        'Document why covered alternatives are ineffective/unsafe.',
        'Attach peer-reviewed or guideline evidence.',
      ],
    },
    {
      id: 'therapeutic-bridge',
      title: 'Therapeutic bridge option',
      lane: 'financial',
      etaDays: 3,
      baseScore: 42,
      requirements: [
        { key: 'hasSpecialistNote', label: 'Specialist recommendation', bonus: 8 },
        { key: 'hasUrgencyFlag', label: 'Urgent treatment window', bonus: 10 },
      ],
      steps: [
        'Use nearest covered alternative temporarily.',
        'Track response and side effects closely.',
        'Escalate exception with new objective evidence.',
      ],
    },
    {
      id: 'manufacturer-assistance',
      title: 'Manufacturer assistance / copay support',
      lane: 'financial',
      etaDays: 2,
      baseScore: 38,
      requirements: [{ key: 'hasUrgencyFlag', label: 'Urgency criteria', bonus: 6 }],
      steps: [
        'Check PAP/copay eligibility criteria.',
        'Submit enrollment with proof of denial.',
        'Coordinate bridge fill with provider/pharmacy.',
      ],
    },
  ],
  medical_necessity: [
    {
      id: 'necessity-package',
      title: 'Medical necessity package rebuild',
      lane: 'clinical',
      etaDays: 7,
      baseScore: 60,
      requirements: [
        { key: 'hasRecentLabs', label: 'Objective clinical metrics', bonus: 12 },
        { key: 'hasSpecialistNote', label: 'Specialist rationale', bonus: 12 },
        { key: 'hasGuidelineSupport', label: 'Clinical guideline references', bonus: 10 },
      ],
      steps: [
        'Compile diagnosis severity, history, and response data.',
        'Map criteria one-by-one to payer policy language.',
        'Submit with signed provider attestation.',
      ],
    },
    {
      id: 'peer-review',
      title: 'Peer review escalation',
      lane: 'clinical',
      etaDays: 4,
      baseScore: 51,
      requirements: [
        { key: 'hasSpecialistNote', label: 'Specialist support', bonus: 10 },
        { key: 'hasUrgencyFlag', label: 'Urgency documented', bonus: 10 },
      ],
      steps: [
        'Request attending-to-reviewer consultation.',
        'Summarize patient-specific risk of delay.',
        'Document reviewer response for appeal packet.',
      ],
    },
    {
      id: 'appeal-track',
      title: 'Structured first-level appeal',
      lane: 'administrative',
      etaDays: 10,
      baseScore: 47,
      requirements: [
        { key: 'hasContinuityOfCare', label: 'Continuity of care argument', bonus: 8 },
        { key: 'hasGuidelineSupport', label: 'Guideline support', bonus: 10 },
      ],
      steps: [
        'Submit concise appeal letter with indexed attachments.',
        'Reference policy clauses and supporting medical records.',
        'Escalate to external review if internally denied.',
      ],
    },
  ],
  quantity_limit: [
    {
      id: 'dose-override',
      title: 'Quantity limit override request',
      lane: 'administrative',
      etaDays: 4,
      baseScore: 56,
      requirements: [
        { key: 'hasRecentLabs', label: 'Objective control metrics', bonus: 10 },
        { key: 'hasSpecialistNote', label: 'Dose necessity note', bonus: 12 },
      ],
      steps: [
        'Submit dose rationale and treatment response evidence.',
        'Attach fill history showing adherence.',
        'Request temporary override pending review.',
      ],
    },
    {
      id: 'split-dispense',
      title: 'Split-dispense + rapid follow-up',
      lane: 'financial',
      etaDays: 2,
      baseScore: 40,
      requirements: [{ key: 'hasUrgencyFlag', label: 'Time-sensitive treatment', bonus: 8 }],
      steps: [
        'Use partial supply under current limit.',
        'Book urgent reassessment with provider.',
        'Re-file override with updated treatment data.',
      ],
    },
    {
      id: 'appeal-quantity',
      title: 'Quantity limit appeal',
      lane: 'administrative',
      etaDays: 8,
      baseScore: 46,
      requirements: [
        { key: 'hasGuidelineSupport', label: 'Guideline dosing support', bonus: 10 },
        { key: 'hasContinuityOfCare', label: 'Continuity impact', bonus: 7 },
      ],
      steps: [
        'Submit formal appeal against quantity cap.',
        'Cite clinical evidence and dosing standards.',
        'Escalate to external review if needed.',
      ],
    },
  ],
  out_of_network: [
    {
      id: 'single-case',
      title: 'Single-case agreement request',
      lane: 'administrative',
      etaDays: 9,
      baseScore: 55,
      requirements: [
        { key: 'hasContinuityOfCare', label: 'Continuity of care evidence', bonus: 14 },
        { key: 'hasSpecialistNote', label: 'Specialist necessity', bonus: 10 },
      ],
      steps: [
        'Request one-time in-network exception for provider/facility.',
        'Show absence of equivalent in-network option.',
        'Attach treatment disruption risk details.',
      ],
    },
    {
      id: 'network-gap',
      title: 'Network adequacy gap filing',
      lane: 'administrative',
      etaDays: 7,
      baseScore: 50,
      requirements: [
        { key: 'hasUrgencyFlag', label: 'Urgency evidence', bonus: 8 },
        { key: 'hasGuidelineSupport', label: 'Clinical requirements', bonus: 8 },
      ],
      steps: [
        'Document in-network access gap with dates and outreach proof.',
        'File network adequacy complaint with payer.',
        'Request temporary in-network benefit status.',
      ],
    },
    {
      id: 'financial-support',
      title: 'Financial assistance bridge',
      lane: 'financial',
      etaDays: 3,
      baseScore: 35,
      requirements: [{ key: 'hasUrgencyFlag', label: 'Urgent access need', bonus: 8 }],
      steps: [
        'Explore provider payment plans or assistance programs.',
        'Coordinate temporary access while exception is reviewed.',
        'Reconcile claims once network status changes.',
      ],
    },
  ],
};

function laneStyle(lane: Strategy['lane']): string {
  if (lane === 'clinical') return 'bg-indigo-100 text-indigo-700';
  if (lane === 'administrative') return 'bg-blue-100 text-blue-700';
  return 'bg-emerald-100 text-emerald-700';
}

function buildPolicyQuestion(denialLabel: string, serviceName: string): string {
  return [
    `For this denial scenario: "${denialLabel}"`,
    `for service/drug "${serviceName}", identify the best access strategy.`,
    'Explain what evidence will strengthen approval and the highest-impact next 3 steps.',
  ].join(' ');
}

function policyLaneBoost(strategy: Strategy, analysis: QueryResponse | null): number {
  if (!analysis) return 0;
  const answer = analysis.answer.toLowerCase();
  let boost = Math.round((analysis.confidence || 0) * 12) + Math.min(analysis.citations.length, 4) * 2;

  if (strategy.lane === 'administrative' && /(prior auth|authorization|appeal|resubmit)/.test(answer)) {
    boost += 6;
  }
  if (strategy.lane === 'clinical' && /(medical necessity|clinical|guideline|specialist|peer)/.test(answer)) {
    boost += 6;
  }
  if (strategy.lane === 'financial' && /(copay|assistance|bridge|cost|afford)/.test(answer)) {
    boost += 6;
  }
  if (/insufficient evidence/.test(answer)) {
    boost -= 8;
  }
  return Math.max(-10, Math.min(14, boost));
}

export default function NextBestAccess() {
  const [denialType, setDenialType] = useState<DenialType>('prior_auth_missing');
  const [serviceName, setServiceName] = useState('Wegovy');
  const [payerId, setPayerId] = useState('');
  const [evidence, setEvidence] = useState<EvidenceState>({
    hasRecentLabs: true,
    hasFailedAlternatives: true,
    hasSpecialistNote: false,
    hasGuidelineSupport: false,
    hasUrgencyFlag: false,
    hasContinuityOfCare: true,
  });
  const { payers, loading: loadingMetadata, error: metadataError } = usePlanMetadata();
  const [analysis, setAnalysis] = useState<QueryResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  const scoredStrategies = useMemo(() => {
    const base = STRATEGIES_BY_DENIAL[denialType];
    return base
      .map(strategy => {
        const evidenceBonus = strategy.requirements.reduce(
          (sum, req) => sum + (evidence[req.key] ? req.bonus : 0),
          0,
        );
        const policyBoost = policyLaneBoost(strategy, analysis);
        const score = Math.max(0, Math.min(98, strategy.baseScore + evidenceBonus + policyBoost));
        return { ...strategy, score, policyBoost };
      })
      .sort((a, b) => b.score - a.score);
  }, [denialType, evidence, analysis]);

  const top = scoredStrategies[0];

  const runPolicyAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysisError('');
    try {
      const response = await postQuery({
        question: buildPolicyQuestion(DENIAL_LABELS[denialType], serviceName.trim() || 'requested therapy'),
        filters: payerId ? { payer_ids: [payerId] } : undefined,
      });
      setAnalysis(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retrieve policy evidence.';
      setAnalysisError(message);
      setAnalysis(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="app-surface border-blue-200 bg-gradient-to-r from-blue-600 to-cyan-600 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-100">Action Orchestration</p>
        <h3 className="mt-1 text-xl font-semibold">Next Best Access</h3>
        <p className="mt-1 text-sm text-blue-100">
          Prioritize the strongest access path after a denial using evidence-aware strategy ranking.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="app-surface space-y-4 p-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Denial category</label>
            <select
              value={denialType}
              onChange={event => setDenialType(event.target.value as DenialType)}
              className="app-input"
            >
              {Object.entries(DENIAL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Available evidence</p>
            <div className="grid gap-2 md:grid-cols-2">
              {[
                { key: 'hasRecentLabs', label: 'Recent labs/clinical metrics' },
                { key: 'hasFailedAlternatives', label: 'Failed alternatives documented' },
                { key: 'hasSpecialistNote', label: 'Specialist attestation' },
                { key: 'hasGuidelineSupport', label: 'Guideline references' },
                { key: 'hasUrgencyFlag', label: 'Urgency or harm-from-delay' },
                { key: 'hasContinuityOfCare', label: 'Continuity of care argument' },
              ].map(item => {
                const checked = evidence[item.key as keyof EvidenceState];
                return (
                  <label
                    key={item.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                      checked ? 'border-indigo-200 bg-indigo-50/70 text-indigo-700' : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={event =>
                        setEvidence(prev => ({ ...prev, [item.key]: event.target.checked }))
                      }
                      className="accent-indigo-600"
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">Policy evidence calibration</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <input
                value={serviceName}
                onChange={event => setServiceName(event.target.value)}
                placeholder="Drug / service (e.g. Wegovy)"
                className="app-input"
              />
              <select
                value={payerId}
                onChange={event => setPayerId(event.target.value)}
                className="app-input"
                disabled={loadingMetadata}
              >
                <option value="">All payers</option>
                {payers.map(payer => (
                  <option key={payer.payer_id} value={payer.payer_id}>
                    {payer.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => void runPolicyAnalysis()}
              disabled={analysisLoading}
              className="mt-2 app-button-secondary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {analysisLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Analyze with policy data
            </button>
            {metadataError && <p className="mt-2 text-xs text-amber-700">{metadataError}</p>}
            {analysisError && <p className="mt-2 text-xs text-rose-700">{analysisError}</p>}
          </div>
        </div>

        <div className="app-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Top pathway</p>
          {top && (
            <div className="mt-2 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">{top.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-semibold ${laneStyle(top.lane)}`}>{top.lane}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                    ETA: {top.etaDays} days
                  </span>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>Success likelihood</span>
                    <span>{top.score}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                      style={{ width: `${top.score}%` }}
                    />
                  </div>
                </div>
                {analysis && (
                  <p className="mt-2 text-xs text-slate-600">
                    Policy signal boost applied from live evidence and confidence.
                  </p>
                )}
              </div>
              <ul className="space-y-2">
                {top.steps.map(step => (
                  <li key={step} className="flex items-start gap-2 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="app-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">
            <Route className="h-4 w-4 text-indigo-600" />
            Ranked access paths
          </h4>
          <p className="text-xs text-slate-500">{DENIAL_LABELS[denialType]}</p>
        </div>

        <div className="space-y-3">
          {scoredStrategies.map(strategy => (
            <article key={strategy.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{strategy.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-1 font-semibold ${laneStyle(strategy.lane)}`}>
                      {strategy.lane}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                      ETA {strategy.etaDays}d
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Readiness score</p>
                  <p className="text-lg font-semibold text-slate-800">{strategy.score}%</p>
                  {analysis && (
                    <p className="text-[11px] text-slate-500">
                      Policy boost {strategy.policyBoost >= 0 ? '+' : ''}
                      {strategy.policyBoost}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-200">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500"
                  style={{ width: `${strategy.score}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Best boosted by:{' '}
                {strategy.requirements
                  .filter(req => !evidence[req.key])
                  .slice(0, 2)
                  .map(req => req.label)
                  .join(', ') || 'current evidence set is already strong'}
              </p>
            </article>
          ))}
        </div>
      </div>

      {analysis && (
        <div className="app-surface p-5">
          <h4 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">Live policy evidence used</h4>
          <p className="mt-2 text-sm text-slate-700">{analysis.answer}</p>
          {!!analysis.citations.length && (
            <p className="mt-2 text-xs text-slate-500">
              Source: {analysis.citations[0].section || 'Policy text'}
              {analysis.citations[0].page ? ` - p.${analysis.citations[0].page}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="app-surface border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900">
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-amber-700" />
          Strategy ranking is a support tool and not legal advice. Final appeal route should be validated with your plan rules.
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-700" />
          Pair this with the appeal letter builder for a complete resubmission package.
        </p>
      </div>
    </div>
  );
}
