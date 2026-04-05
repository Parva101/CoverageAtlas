import { PhoneCall, ClipboardCheck, Sparkles } from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
  onUseQuestion?: (question: string) => void;
}

export default function CustomerCoach({ result, onUseQuestion }: Props) {
  const help = result.customer_help || {};
  const nextQs = help.next_best_questions || [];
  const prep = help.what_to_prepare || [];
  const callScript = help.call_script || [];

  if (nextQs.length === 0 && prep.length === 0 && callScript.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-sky-50 to-white rounded-xl border border-sky-200 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-sky-600" />
        <h3 className="text-sm font-semibold text-slate-900">Customer Assistant</h3>
      </div>

      {prep.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ClipboardCheck className="w-4 h-4 text-slate-600" />
            <p className="text-xs font-medium text-slate-700">What to prepare</p>
          </div>
          <ul className="space-y-1">
            {prep.map((item, idx) => (
              <li key={`${item}-${idx}`} className="text-sm text-slate-700">• {item}</li>
            ))}
          </ul>
        </div>
      )}

      {callScript.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <PhoneCall className="w-4 h-4 text-slate-600" />
            <p className="text-xs font-medium text-slate-700">Suggested call script</p>
          </div>
          <ol className="space-y-1">
            {callScript.map((line, idx) => (
              <li key={`${line}-${idx}`} className="text-sm text-slate-700">{idx + 1}. {line}</li>
            ))}
          </ol>
        </div>
      )}

      {nextQs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-700 mb-2">Try these next questions</p>
          <div className="flex flex-wrap gap-2">
            {nextQs.map((q, idx) => (
              <button
                key={`${q}-${idx}`}
                onClick={() => onUseQuestion?.(q)}
                className="px-3 py-1.5 text-xs rounded-full border border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

