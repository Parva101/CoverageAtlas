import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Search } from 'lucide-react';

const TERMS = [
  {
    term: 'Prior Authorization',
    definition: 'Pre-approval your doctor gets from your insurer before a treatment or medication is covered.',
  },
  {
    term: 'Step Therapy',
    definition: 'A requirement to try lower-cost options first before the prescribed treatment is approved.',
  },
  {
    term: 'Formulary',
    definition: 'The drug list your plan covers. Non-formulary medications may cost more or be denied.',
  },
  {
    term: 'Coverage Status',
    definition: '"Covered" means likely payable, "Restricted" means conditional, and "Not covered" means likely denied.',
  },
  {
    term: 'Quantity Limit',
    definition: 'A cap on how much medication is covered within a given time period.',
  },
  {
    term: 'Site of Care',
    definition: 'Where treatment must happen for coverage (clinic, hospital outpatient, or home infusion).',
  },
  {
    term: 'Appeal',
    definition: 'A formal request asking the insurer to reconsider a denial. Members are generally entitled to this process.',
  },
  {
    term: 'Medical Benefit vs Pharmacy Benefit',
    definition: 'Some medications are billed under medical claims while others are processed through the pharmacy benefit.',
  },
];

export default function TermHelper() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const filteredTerms = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return TERMS;
    return TERMS.filter(item => {
      const term = item.term.toLowerCase();
      const definition = item.definition.toLowerCase();
      return term.includes(normalized) || definition.includes(normalized);
    });
  }, [query]);

  return (
    <section className="app-surface p-5">
      <button onClick={() => setExpanded(prev => !prev)} className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-cyan-600" />
          <h3 className="text-sm font-semibold text-slate-900">Insurance terms explained</h3>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="animate-fade-up mt-4 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search terms..."
              className="app-input pl-9"
            />
          </div>

          {filteredTerms.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              No glossary terms matched your search.
            </p>
          )}

          {filteredTerms.map(item => (
            <div key={item.term} className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="inline-flex rounded-lg bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700">
                {item.term}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.definition}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
