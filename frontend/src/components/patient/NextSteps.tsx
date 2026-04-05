import { ClipboardList, Phone, ShieldCheck, Stethoscope } from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
}

interface Step {
  id: string;
  label: string;
  detail: string;
  tone: 'neutral' | 'action' | 'clinical';
}

function extractSteps(result: QueryResponse): Step[] {
  const answer = result.answer.toLowerCase();
  const steps: Step[] = [];

  if (answer.includes('prior auth') || answer.includes('prior authorization')) {
    steps.push({
      id: 'prior-auth',
      label: 'Prepare prior authorization',
      detail: 'Ask your doctor to submit the PA request with chart notes and the diagnosis rationale.',
      tone: 'clinical',
    });
  }

  if (answer.includes('step therapy') || answer.includes('first-line') || answer.includes('tried')) {
    steps.push({
      id: 'step-therapy',
      label: 'Document previous therapies',
      detail: 'Collect evidence of medications you already tried and why they were ineffective or not tolerated.',
      tone: 'clinical',
    });
  }

  if (answer.includes('diagnosis') || answer.includes('bmi') || answer.includes('lab')) {
    steps.push({
      id: 'clinical-docs',
      label: 'Gather clinical documentation',
      detail: 'Keep relevant lab values, diagnosis records, and specialist notes ready before submission.',
      tone: 'clinical',
    });
  }

  if (answer.includes('appeal') || answer.includes('denied') || answer.includes('denial')) {
    steps.push({
      id: 'appeal',
      label: 'Prepare an appeal plan',
      detail: 'If denied, request written denial reasons and ask your provider about next-level appeal language.',
      tone: 'action',
    });
  }

  steps.push({
    id: 'payer-call',
    label: 'Call your insurer to confirm',
    detail: 'Use the member services number on your card and confirm coverage details for your exact benefit year.',
    tone: 'action',
  });

  steps.push({
    id: 'provider-office',
    label: 'Coordinate with provider office',
    detail: 'Your provider team often knows payer-specific forms and can speed up the authorization process.',
    tone: 'neutral',
  });

  const deduplicated = new Map<string, Step>();
  steps.forEach(step => {
    if (!deduplicated.has(step.id)) deduplicated.set(step.id, step);
  });
  return Array.from(deduplicated.values());
}

export default function NextSteps({ result }: Props) {
  const steps = extractSteps(result);

  return (
    <section className="app-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-900">Suggested next steps</h3>
      </div>

      <ul className="space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                {index + 1}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800">{step.label}</p>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      step.tone === 'clinical'
                        ? 'bg-indigo-100 text-indigo-700'
                        : step.tone === 'action'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {step.tone === 'clinical' && <Stethoscope className="h-3 w-3" />}
                    {step.tone === 'action' && <ShieldCheck className="h-3 w-3" />}
                    {step.tone === 'neutral' && <Phone className="h-3 w-3" />}
                    {step.tone}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
