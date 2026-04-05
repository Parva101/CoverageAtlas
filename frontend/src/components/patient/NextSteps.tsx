import { ClipboardList, ArrowRight } from 'lucide-react';
import type { QueryResponse } from '../../types';

interface Props {
  result: QueryResponse;
}

export default function NextSteps({ result }: Props) {
  const answer = result.answer.toLowerCase();

  const steps: string[] = [];

  if (answer.includes('prior auth') || answer.includes('prior authorization'))
    steps.push('Your doctor may need to submit a prior authorization request.');
  if (answer.includes('step therapy') || answer.includes('tried') || answer.includes('first-line'))
    steps.push('Your insurer may require you to try another medication first.');
  if (answer.includes('diagnosis') || answer.includes('bmi') || answer.includes('type 2'))
    steps.push('Have your diagnosis documentation ready (labs, records).');
  if (answer.includes('specialist') || answer.includes('referral'))
    steps.push('A specialist referral may be needed.');
  if (answer.includes('appeal'))
    steps.push('If denied, you have the right to appeal the decision.');

  steps.push('Call the number on the back of your insurance card to confirm.');
  steps.push('Ask your doctor\'s office about helping with the authorization process.');

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <ClipboardList className="w-4 h-4 text-blue-600" />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">What you may need to do</h3>
      </div>
      <ul className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3 group">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0 mt-0.5">
              {i + 1}
            </div>
            <div className="flex-1 flex items-start justify-between gap-2">
              <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
              <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-400 shrink-0 mt-1 transition-colors" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
