import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  HelpCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
}

interface StatusConfig {
  label: string;
  level: 'covered' | 'restricted' | 'not_covered' | 'unclear';
  icon: typeof CheckCircle2;
  border: string;
  badge: string;
  text: string;
}

function normalizeConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function getSimpleStatus(confidence: number, answer: string): StatusConfig {
  const lower = answer.toLowerCase();
  if (confidence < 0.35 || lower.includes('insufficient evidence')) {
    return {
      level: 'unclear',
      label: 'Not clear yet',
      icon: HelpCircle,
      border: 'border-slate-200',
      badge: 'bg-slate-100 text-slate-700',
      text: 'text-slate-800',
    };
  }
  if (lower.includes('not covered') || lower.includes('excluded')) {
    return {
      level: 'not_covered',
      label: 'Likely not covered',
      icon: XCircle,
      border: 'border-red-200',
      badge: 'bg-red-100 text-red-700',
      text: 'text-red-800',
    };
  }
  if (lower.includes('restricted') || lower.includes('prior auth') || lower.includes('conditions')) {
    return {
      level: 'restricted',
      label: 'Covered with conditions',
      icon: AlertTriangle,
      border: 'border-amber-200',
      badge: 'bg-amber-100 text-amber-700',
      text: 'text-amber-800',
    };
  }
  return {
    level: 'covered',
    label: 'Likely covered',
    icon: CheckCircle2,
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    text: 'text-emerald-800',
  };
}

export default function AnswerCard({ result }: Props) {
  const [copied, setCopied] = useState(false);
  const confidence = normalizeConfidence(result.confidence);
  const confidencePct = Math.round(confidence * 100);
  const status = getSimpleStatus(confidence, result.answer);
  const Icon = status.icon;

  const handleCopy = async () => {
    if (typeof window === 'undefined' || !window.navigator?.clipboard) return;
    try {
      await window.navigator.clipboard.writeText(result.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className={`app-surface border-2 ${status.border} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`rounded-xl p-2 ${status.badge}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className={`text-base font-semibold ${status.text}`}>{status.label}</p>
            <p className="text-xs text-slate-500">Model interpretation from policy evidence</p>
          </div>
        </div>

        <button onClick={() => void handleCopy()} className="app-button-secondary text-xs">
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? 'Copied' : 'Copy Answer'}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm leading-relaxed text-slate-700">{result.answer}</p>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/90 p-4">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.1em] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            Confidence
          </span>
          <span className="font-semibold text-slate-700">{confidencePct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status.level === 'covered'
                ? 'bg-emerald-500'
                : status.level === 'restricted'
                  ? 'bg-amber-500'
                  : status.level === 'not_covered'
                    ? 'bg-red-500'
                    : 'bg-slate-400'
            }`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>
    </article>
  );
}
