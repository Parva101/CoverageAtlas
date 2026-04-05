import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

const TERMS = [
  {
    term: 'Prior Authorization',
    short: 'PA',
    definition: 'Pre-approval your doctor gets from your insurance before you can receive a treatment or medication.',
  },
  {
    term: 'Step Therapy',
    short: 'ST',
    definition: 'A requirement to try a less expensive medication first before your insurance will cover the one your doctor prescribed.',
  },
  {
    term: 'Formulary',
    short: 'RX',
    definition: 'The list of drugs your insurance plan covers. Drugs not on the list may cost more or not be covered.',
  },
  {
    term: 'Coverage Status',
    short: 'CS',
    definition: '"Covered" means the plan pays for it. "Restricted" means it\'s covered with conditions. "Not covered" means you\'d pay out-of-pocket.',
  },
  {
    term: 'Quantity Limit',
    short: 'QL',
    definition: 'A cap on how much medication your plan will cover in a given time period.',
  },
  {
    term: 'Site of Care',
    short: 'SC',
    definition: 'Where the treatment must be given (doctor\'s office, hospital outpatient, home infusion) for insurance to cover it.',
  },
  {
    term: 'Appeal',
    short: 'AP',
    definition: 'A formal request to your insurance to reconsider a denied claim. You have a legal right to appeal.',
  },
  {
    term: 'Medical vs. Pharmacy Benefit',
    short: 'MB',
    definition: 'Some drugs are covered under your medical insurance (usually infusions) while others go through your pharmacy plan (usually pills/injectables).',
  },
];

export default function TermHelper() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-violet-600" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-slate-900">Insurance Terms Explained</h3>
            <p className="text-xs text-slate-400 mt-0.5">{TERMS.length} terms defined</p>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-2 border-t border-slate-100">
          {TERMS.map(t => (
            <div key={t.term} className="flex items-start gap-3 py-2 group">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-violet-600">{t.short}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold text-slate-800">{t.term}</span>
                  <ChevronRight className="w-3 h-3 text-slate-300" />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{t.definition}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
