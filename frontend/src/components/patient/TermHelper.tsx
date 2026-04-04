import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';

const TERMS = [
  {
    term: 'Prior Authorization',
    definition: 'Pre-approval your doctor gets from your insurance before you can receive a treatment or medication.',
  },
  {
    term: 'Step Therapy',
    definition: 'A requirement to try a less expensive medication first before your insurance will cover the one your doctor prescribed.',
  },
  {
    term: 'Formulary',
    definition: 'The list of drugs your insurance plan covers. Drugs not on the list may cost more or not be covered.',
  },
  {
    term: 'Coverage Status',
    definition: '"Covered" means the plan pays for it. "Restricted" means it\'s covered with conditions. "Not covered" means you\'d pay out-of-pocket.',
  },
  {
    term: 'Quantity Limit',
    definition: 'A cap on how much medication your plan will cover in a given time period.',
  },
  {
    term: 'Site of Care',
    definition: 'Where the treatment must be given (doctor\'s office, hospital outpatient, home infusion) for insurance to cover it.',
  },
  {
    term: 'Appeal',
    definition: 'A formal request to your insurance to reconsider a denied claim. You have a legal right to appeal.',
  },
  {
    term: 'Medical Benefit vs. Pharmacy Benefit',
    definition: 'Some drugs are covered under your medical insurance (usually infusions) while others go through your pharmacy plan (usually pills/injectables).',
  },
];

export default function TermHelper() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-violet-500" />
          <h3 className="text-sm font-semibold text-slate-900">Insurance Terms Explained</h3>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {TERMS.map(t => (
            <div key={t.term} className="flex gap-3">
              <span className="inline-block px-2.5 py-1 bg-violet-50 text-violet-700 rounded-lg text-xs font-semibold shrink-0 h-fit">
                {t.term}
              </span>
              <p className="text-xs text-slate-600 leading-relaxed">{t.definition}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
