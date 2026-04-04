import { useState } from 'react';
import { Send, Loader2, Heart } from 'lucide-react';
import { postQuery } from '../../api/client';
import type { QueryResponse } from '../../types';
import AnswerCard from './AnswerCard';
import NextSteps from './NextSteps';
import TermHelper from './TermHelper';

const SIMPLE_PAYERS = [
  'UnitedHealthcare', 'Aetna', 'Cigna', 'Humana', 'Medicare', 'Medicaid',
  'BCBS Massachusetts', 'BCBS Michigan', 'BCBS Texas',
];

export default function AskQuestion() {
  const [question, setQuestion] = useState('');
  const [payer, setPayer] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState('');

  const handleAsk = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await postQuery({
        question,
        filters: payer ? { payer_ids: [payer] } : undefined,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    'Will my insurance cover Ozempic?',
    'Does my plan require prior authorization for Humira?',
    'Is bariatric surgery covered under my plan?',
    'What do I need for Wegovy approval?',
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <Heart className="w-7 h-7 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Ask about your coverage
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            Ask in your own words. We'll check your plan's policy and explain what we find.
          </p>
        </div>

        {/* Plan selector */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-2 block">
            Your insurance plan (optional)
          </label>
          <select
            value={payer}
            onChange={e => setPayer(e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">I'm not sure / check all plans</option>
            {SIMPLE_PAYERS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Question input */}
        <div>
          <div className="relative">
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              placeholder="Type your question here..."
              rows={3}
              className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-14"
            />
            <button
              onClick={handleAsk}
              disabled={loading || !question.trim()}
              className="absolute right-3 bottom-3 w-9 h-9 bg-blue-600 text-white rounded-lg flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Suggestions */}
        {!result && !loading && (
          <div>
            <p className="text-xs text-slate-500 mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => { setQuestion(s); }}
                  className="px-3.5 py-2 bg-white border border-slate-200 rounded-full text-xs text-slate-600 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={handleAsk}
              className="mt-2 text-xs text-red-600 underline hover:text-red-800"
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Checking coverage policies...</p>
          </div>
        )}

        {/* Answer */}
        {result && (
          <div className="space-y-5">
            <AnswerCard result={result} />
            <NextSteps result={result} />
            <TermHelper />

            {/* Citation snippet */}
            {result.citations.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium text-slate-500 mb-2">Source</p>
                <p className="text-xs text-slate-600 leading-relaxed italic">
                  "{result.citations[0].snippet}"
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {result.citations[0].section} &middot; Page {result.citations[0].page}
                </p>
              </div>
            )}

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-xs text-amber-700 leading-relaxed">
                {result.disclaimer ||
                  'This is informational only based on policy documents. It is not a guarantee of coverage. Contact your insurance company to confirm.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
