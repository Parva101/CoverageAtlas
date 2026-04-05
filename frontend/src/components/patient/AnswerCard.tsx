import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
}

function getSimpleStatus(confidence: number, answer: string) {
  const lower = answer.toLowerCase();
  if (confidence < 0.4 || lower.includes('insufficient evidence'))
    return { level: 'unclear', label: 'Not clear yet', color: 'slate', icon: HelpCircle };
  if (lower.includes('not covered') || lower.includes('excluded'))
    return { level: 'not_covered', label: 'Likely not covered', color: 'red', icon: XCircle };
  if (lower.includes('restricted') || lower.includes('prior auth') || lower.includes('conditions'))
    return { level: 'restricted', label: 'Maybe, with conditions', color: 'amber', icon: AlertTriangle };
  return { level: 'covered', label: 'Likely covered', color: 'emerald', icon: CheckCircle2 };
}

const colorMap: Record<string, {
  bg: string; border: string; text: string; icon: string;
  badge: string; badgeBg: string; bar: string;
}> = {
  emerald: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    icon: 'text-emerald-500',
    badge: 'text-emerald-700',
    badgeBg: 'bg-emerald-100',
    bar: 'bg-emerald-500',
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-900',
    icon: 'text-amber-500',
    badge: 'text-amber-700',
    badgeBg: 'bg-amber-100',
    bar: 'bg-amber-500',
  },
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-900',
    icon: 'text-red-500',
    badge: 'text-red-700',
    badgeBg: 'bg-red-100',
    bar: 'bg-red-500',
  },
  slate: {
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-700',
    icon: 'text-slate-400',
    badge: 'text-slate-600',
    badgeBg: 'bg-slate-100',
    bar: 'bg-slate-400',
  },
};

export default function AnswerCard({ result }: Props) {
  const status = getSimpleStatus(result.confidence, result.answer);
  const colors = colorMap[status.color];
  const Icon = status.icon;
  const confidencePct = Math.round(result.confidence * 100);

  return (
    <div className={`rounded-2xl border-2 ${colors.border} ${colors.bg} p-5 space-y-4`}>
      {/* Status header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${colors.badgeBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${colors.icon}`} />
          </div>
          <div>
            <h3 className={`text-base font-bold ${colors.text}`}>{status.label}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Based on available policy documents</p>
          </div>
        </div>

        {/* Confidence badge */}
        <div className={`flex flex-col items-end gap-1`}>
          <span className="text-xs text-slate-500">Confidence</span>
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className={`text-xs font-semibold ${colors.badge}`}>{confidencePct}%</span>
          </div>
        </div>
      </div>

      {/* Answer text */}
      <p className="text-sm text-slate-700 leading-relaxed">{result.answer}</p>
    </div>
  );
}
