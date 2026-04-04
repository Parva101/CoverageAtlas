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

const colorMap: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-500' },
  red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'text-red-500' },
  slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', icon: 'text-slate-400' },
};

export default function AnswerCard({ result }: Props) {
  const status = getSimpleStatus(result.confidence, result.answer);
  const colors = colorMap[status.color];
  const Icon = status.icon;

  return (
    <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} p-5`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-6 h-6 ${colors.icon}`} />
        <h3 className={`text-lg font-semibold ${colors.text}`}>{status.label}</h3>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{result.answer}</p>
    </div>
  );
}
