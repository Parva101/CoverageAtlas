import { ClipboardList } from 'lucide-react';
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

  // Always add generic steps
  steps.push('Call the number on the back of your insurance card to confirm.');
  steps.push('Ask your doctor\'s office about helping with the authorization process.');

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-5 h-5 text-blue-500" />
        <h3 className="text-sm font-semibold text-slate-900">What you may need to do</h3>
      </div>
      <ul className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
