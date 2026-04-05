import { ShieldCheck, ShieldAlert, Gauge, FileText } from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
}

function qualityColor(q?: string) {
  if (q === 'strong') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (q === 'moderate') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

export default function ReasonEvidencePanel({ result }: Props) {
  const reasoning = result.reasoning || {};
  const cards = result.evidence_cards || [];
  const strength = Math.round((reasoning.evidence_strength || 0) * 100);
  const supported = reasoning.verifier_supported ?? false;

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {supported ? (
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-600" />
          )}
          <h3 className="text-sm font-semibold text-slate-900">Why This Answer</h3>
        </div>
        <span className={`px-2.5 py-1 text-xs border rounded-full ${qualityColor(reasoning.evidence_quality)}`}>
          Evidence: {reasoning.evidence_quality || 'unknown'}
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200/60 bg-white/60 backdrop-blur-sm p-3">
          <div className="text-[11px] uppercase text-slate-500 tracking-wide">Route</div>
          <div className="text-sm text-slate-800 mt-1">{reasoning.route || 'policy'}</div>
        </div>
        <div className="rounded-lg border border-slate-200/60 bg-white/60 backdrop-blur-sm p-3">
          <div className="text-[11px] uppercase text-slate-500 tracking-wide">Verifier</div>
          <div className="text-sm text-slate-800 mt-1">{supported ? 'Supported' : 'Needs caution'}</div>
        </div>
        <div className="rounded-lg border border-slate-200/60 bg-white/60 backdrop-blur-sm p-3">
          <div className="text-[11px] uppercase text-slate-500 tracking-wide">Evidence Count</div>
          <div className="text-sm text-slate-800 mt-1">{reasoning.supporting_evidence_count ?? 0}</div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="w-4 h-4 text-blue-600" />
          <span className="text-xs text-slate-600">Evidence strength: {strength}%</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${strength >= 65 ? 'bg-emerald-500' : strength >= 40 ? 'bg-amber-500' : 'bg-slate-400'}`}
            style={{ width: `${Math.max(4, strength)}%` }}
          />
        </div>
      </div>

      {cards.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <span className="text-xs font-medium text-slate-700">Top Evidence</span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {cards.slice(0, 4).map(card => (
              <div key={`${card.source_index}-${card.policy_version_id || ''}`} className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500 mb-1">
                  {card.payer_name || 'Unknown payer'} · {card.policy_title || 'Policy'} · {card.section_title || 'Section'} · page {card.page_number || 0}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{card.snippet}</p>
                <div className="text-[11px] text-slate-400 mt-1">Relevance: {card.relevance}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

