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
  FileText,
} from 'lucide-react';
import { postQuery } from '../../api/client';
import type { QueryResponse } from '../../types';

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

// Derive a simple coverage level from the answer text + confidence
type CoverageLevel = 'covered' | 'restricted' | 'not_covered' | 'unclear';

function inferCoverage(confidence: number, answer: string): CoverageLevel {
  const l = answer.toLowerCase();
  if (confidence < 0.35 || l.includes('insufficient evidence') || l.includes('not enough'))
    return 'unclear';
  if (l.includes('not covered') || l.includes('excluded') || l.includes('does not cover'))
    return 'not_covered';
  if (
    l.includes('restricted') ||
    l.includes('prior auth') ||
    l.includes('step therapy') ||
    l.includes('conditions') ||
    l.includes('requires')
  )
    return 'restricted';
  if (l.includes('covered') || l.includes('covers') || l.includes('approved'))
    return 'covered';
  return 'unclear';
}

const LEVEL_SCORE: Record<CoverageLevel, number> = {
  covered: 3,
  restricted: 2,
  not_covered: 0,
  unclear: 1,
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
  payer: string;
  level: CoverageLevel;
  answer: string;
  confidence: number;
  citations: QueryResponse['citations'];
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

  return (
    <div
      className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} p-5 flex-1 space-y-3`}
    >
      {/* Tag */}
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
        <h3 className="text-base font-semibold text-slate-900">{result.payer}</h3>
      </div>

      {/* Status badge */}
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {cfg.label}
      </span>

      {/* Answer */}
      <p className="text-sm text-slate-700 leading-relaxed">{result.answer}</p>

      {/* Top citation */}
      {result.citations.length > 0 && (
        <div className="border-t border-slate-200 pt-3">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-500 leading-relaxed italic">
              "{result.citations[0].snippet}"
              <span className="not-italic ml-1 text-slate-400">
                — {result.citations[0].section}, p.{result.citations[0].page}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Confidence */}
      <p className="text-xs text-slate-400">
        Confidence:{' '}
        <span
          className={
            result.confidence >= 0.7
              ? 'text-emerald-600 font-medium'
              : result.confidence >= 0.5
              ? 'text-amber-600 font-medium'
              : 'text-red-500 font-medium'
          }
        >
          {Math.round(result.confidence * 100)}%
        </span>
      </p>
    </div>
  );
}

export default function ComparePlans() {
  const [drugName, setDrugName] = useState('');
  const [myPayer, setMyPayer] = useState('');
  const [loading, setLoading] = useState(false);
  const [myResult, setMyResult] = useState<PlanResult | null>(null);
  const [bestResult, setBestResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState('');

  const handleCompare = async () => {
    if (!drugName.trim() || !myPayer) return;
    setLoading(true);
    setError('');
    setMyResult(null);
    setBestResult(null);

    const question = `Does ${myPayer} cover ${drugName}? What are the requirements?`;

    try {
      // Query 1: user's payer
      const myRes = await postQuery({
        question,
        filters: { payer_ids: [myPayer] },
        retrieval: { top_k: 6 },
      });
      const myLevel = inferCoverage(myRes.confidence, myRes.answer);
      setMyResult({ payer: myPayer, level: myLevel, answer: myRes.answer, confidence: myRes.confidence, citations: myRes.citations });

      // Query 2: all other payers in parallel — pick the best scoring one
      const otherPayers = PAYERS.filter(p => p !== myPayer);
      const results = await Promise.allSettled(
        otherPayers.map(p =>
          postQuery({
            question: `Does ${p} cover ${drugName}? What are the requirements?`,
            filters: { payer_ids: [p] },
            retrieval: { top_k: 6 },
          }).then(res => ({ payer: p, res })),
        ),
      );

      const scored: PlanResult[] = results
        .filter((r): r is PromiseFulfilledResult<{ payer: string; res: QueryResponse }> => r.status === 'fulfilled')
        .map(r => ({
          payer: r.value.payer,
          level: inferCoverage(r.value.res.confidence, r.value.res.answer),
          answer: r.value.res.answer,
          confidence: r.value.res.confidence,
          citations: r.value.res.citations,
        }))
        .filter(r => r.level !== 'unclear')
        .sort((a, b) => {
          const scoreDiff = LEVEL_SCORE[b.level] - LEVEL_SCORE[a.level];
          if (scoreDiff !== 0) return scoreDiff;
          return b.confidence - a.confidence;
        });

      if (scored.length > 0) setBestResult(scored[0]);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isSamePlan = myResult && bestResult && myResult.payer === bestResult.payer;
  const myIsBest =
    myResult &&
    bestResult &&
    LEVEL_SCORE[myResult.level] >= LEVEL_SCORE[bestResult.level] &&
    myResult.confidence >= bestResult.confidence;

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
            See how your insurance compares to the best available coverage for a
            specific medication.
          </p>
        </div>

        {/* Inputs */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Your insurance plan
            </label>
            <select
              value={myPayer}
              onChange={e => setMyPayer(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select your plan...</option>
              {PAYERS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Medication name
            </label>
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
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GitCompareArrows className="w-4 h-4" />
            )}
            {loading ? 'Checking all plans...' : 'Compare Plans'}
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
            <p className="text-sm text-slate-500">
              Checking coverage across all plans — this takes a few seconds...
            </p>
          </div>
        )}

        {/* Your plan is already best */}
        {!loading && myResult && (isSamePlan || myIsBest) && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 text-center">
            <Trophy className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <h3 className="text-lg font-semibold text-emerald-800">Great news!</h3>
            <p className="text-sm text-emerald-700 mt-1">
              Your plan (<strong>{myPayer}</strong>) already has the best
              coverage we found for <strong>{drugName}</strong>.
            </p>
            <div className="mt-4">
              <ResultCard result={myResult} tag="yours" />
            </div>
          </div>
        )}

        {/* Side-by-side comparison */}
        {!loading && myResult && bestResult && !isSamePlan && !myIsBest && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {drugName} — Your Plan vs. Best Available
            </h2>

            <div className="flex gap-4 items-stretch">
              <ResultCard result={myResult} tag="yours" />
              <div className="flex items-center shrink-0">
                <ArrowRight className="w-5 h-5 text-slate-300" />
              </div>
              <ResultCard result={bestResult} tag="best" />
            </div>

            {/* Plain-language summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-blue-900">
                What this means for you
              </h3>
              <ul className="space-y-1.5 text-sm text-blue-800">
                {LEVEL_SCORE[bestResult.level] > LEVEL_SCORE[myResult.level] && (
                  <li className="flex items-start gap-2">
                    <span className="shrink-0">•</span>
                    <span>
                      <strong>{bestResult.payer}</strong> offers better base
                      coverage ({bestResult.level.replace('_', ' ')} vs.{' '}
                      {myResult.level.replace('_', ' ')}).
                    </span>
                  </li>
                )}
                {bestResult.confidence > myResult.confidence + 0.1 && (
                  <li className="flex items-start gap-2">
                    <span className="shrink-0">•</span>
                    <span>
                      We're more confident about{' '}
                      <strong>{bestResult.payer}</strong>'s policy (
                      {Math.round(bestResult.confidence * 100)}% vs.{' '}
                      {Math.round(myResult.confidence * 100)}%).
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span className="shrink-0">•</span>
                  <span>
                    This comparison is based on published policy documents.
                    Contact your insurer to confirm your specific benefits.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Only your plan result, no best found */}
        {!loading && myResult && !bestResult && !myIsBest && (
          <div className="space-y-4">
            <ResultCard result={myResult} tag="yours" />
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-500">
                We couldn't find clearer coverage data at other plans to compare against.
              </p>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        {!loading && myResult && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-xs text-amber-700 leading-relaxed">
              Informational only. Based on published policy documents — not a
              guarantee of coverage or a recommendation to switch plans. Always
              confirm with your insurance company.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
