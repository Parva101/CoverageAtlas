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
  badge: string; badgeBg: string; bar: string; glow: string;
}> = {
  emerald: {
    bg: 'bg-emerald-50/60',
    border: 'border-emerald-200/60',
    text: 'text-emerald-900',
    icon: 'text-emerald-500',
    badge: 'text-emerald-700',
    badgeBg: 'bg-gradient-to-br from-emerald-50 to-emerald-100',
    bar: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
    glow: 'shadow-emerald-500/10',
  },
  amber: {
    bg: 'bg-amber-50/60',
    border: 'border-amber-200/60',
    text: 'text-amber-900',
    icon: 'text-amber-500',
    badge: 'text-amber-700',
    badgeBg: 'bg-gradient-to-br from-amber-50 to-amber-100',
    bar: 'bg-gradient-to-r from-amber-400 to-amber-500',
    glow: 'shadow-amber-500/10',
  },
  red: {
    bg: 'bg-red-50/60',
    border: 'border-red-200/60',
    text: 'text-red-900',
    icon: 'text-red-500',
    badge: 'text-red-700',
    badgeBg: 'bg-gradient-to-br from-red-50 to-red-100',
    bar: 'bg-gradient-to-r from-red-400 to-red-500',
    glow: 'shadow-red-500/10',
  },
  slate: {
    bg: 'bg-slate-50/60',
    border: 'border-slate-200/60',
    text: 'text-slate-700',
    icon: 'text-slate-400',
    badge: 'text-slate-600',
    badgeBg: 'bg-gradient-to-br from-slate-50 to-slate-100',
    bar: 'bg-gradient-to-r from-slate-300 to-slate-400',
    glow: 'shadow-slate-500/5',
  },
};

export default function AnswerCard({ result }: Props) {
  const status = getSimpleStatus(result.confidence, result.answer);
  const colors = colorMap[status.color];
  const Icon = status.icon;
  const confidencePct = Math.round(result.confidence * 100);

  return (
    <div className={`rounded-2xl border ${colors.border} ${colors.bg} backdrop-blur-sm p-5 space-y-4 shadow-lg ${colors.glow} animate-fade-in-scale`}>
      {/* Status header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl ${colors.badgeBg} flex items-center justify-center shrink-0 shadow-sm`}>
            <Icon className={`w-5 h-5 ${colors.icon}`} />
          </div>
          <div>
            <h3 className={`text-base font-bold ${colors.text}`}>{status.label}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Based on available policy documents</p>
          </div>
        </div>

        {/* Confidence badge */}
        <div className={`flex flex-col items-end gap-1.5`}>
          <span className="text-xs text-slate-500 font-medium">Confidence</span>
          <div className="flex items-center gap-2.5">
            <div className="w-24 h-2 bg-slate-200/80 rounded-full overflow-hidden">
              <div
                className={`h-full ${colors.bar} rounded-full transition-all duration-700 ease-out`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className={`text-xs font-bold ${colors.badge}`}>{confidencePct}%</span>
          </div>
        </div>
      </div>

      <div className="accent-line" />

      {/* Answer text */}
      <p className="text-sm text-slate-700 leading-relaxed">{result.answer}</p>
    </div>
  );
}
