import { useState } from 'react';
import { Send, Loader2, Pill, ShieldCheck, Stethoscope, ClipboardCheck } from 'lucide-react';
import { postQuery } from '../../api/client';
import type { QueryResponse } from '../../types';
import { usePlanMetadata } from '../../hooks/usePlanMetadata';
import AnswerCard from './AnswerCard';
import NextSteps from './NextSteps';
import TermHelper from './TermHelper';

const suggestions = [
  { text: 'Will my insurance cover Ozempic?', icon: Pill },
  { text: 'Does my plan require prior authorization for Humira?', icon: ClipboardCheck },
  { text: 'Is bariatric surgery covered under my plan?', icon: Stethoscope },
  { text: 'What do I need for Wegovy approval?', icon: ShieldCheck },
];

export default function AskQuestion() {
  const [question, setQuestion] = useState('');
  const [payerId, setPayerId] = useState('');
  const { payers, loading: loadingMetadata, error: metadataError } = usePlanMetadata();
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
        filters: payerId ? { payer_ids: [payerId] } : undefined,
      });
      setResult(res);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
        {/* Hero */}
        <div className="text-center animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-xs font-semibold mb-5 border border-blue-200/50 shadow-sm">
            <ShieldCheck className="w-3.5 h-3.5" />
            Powered by real policy documents
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight glow-heading">
            Ask about your coverage
          </h1>
          <p className="text-slate-500 mt-3 text-sm leading-relaxed max-w-md mx-auto">
            Ask in plain language. We&apos;ll search your plan&apos;s actual policy and explain what we find.
          </p>
        </div>

        {/* Input card */}
        <div className="glass-card p-6 space-y-4 animate-fade-in-scale stagger-1">
          <div className="accent-line mb-1" />
          {/* Plan selector */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2 block">
              Your insurance plan (optional)
            </label>
            <select
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200/70 rounded-xl text-sm bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition-all"
              disabled={loadingMetadata}
            >
              <option value="">Search across all plans</option>
              {payers.map(p => (
                <option key={p.payer_id} value={p.payer_id}>
                  {p.name}
                </option>
              ))}
            </select>
            {loadingMetadata && <p className="mt-1.5 text-xs text-slate-400">Loading plans...</p>}
            {metadataError && <p className="mt-1.5 text-xs text-amber-600">{metadataError}</p>}
          </div>

          {/* Question input */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2 block">
              Your question
            </label>
            <div className="relative group">
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                placeholder="e.g. Will my plan cover Ozempic for weight loss?"
                rows={3}
                className="w-full px-4 py-3.5 border border-slate-200/70 rounded-xl text-sm bg-white/80 backdrop-blur-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 pr-14 transition-all"
              />
              <button
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                className="absolute right-3 bottom-3 w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-xl flex items-center justify-center hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-500/25"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Press Enter to submit · Shift+Enter for new line</p>
          </div>
        </div>

        {/* Suggestion pills */}
        {!result && !loading && (
          <div className="animate-fade-in-up stagger-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-3">Common questions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {suggestions.map(({ text, icon: Icon }) => (
                <button
                  key={text}
                  onClick={() => setQuestion(text)}
                  className="flex items-center gap-3 px-4 py-3.5 glass-card text-xs text-slate-600 hover:border-blue-300/60 hover:shadow-[0_4px_20px_-6px_rgb(59_130_246/0.2)] hover:text-blue-700 transition-all duration-200 text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 group-hover:from-blue-100 group-hover:to-indigo-50 flex items-center justify-center shrink-0 transition-all duration-200">
                    <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
                  </div>
                  <span className="leading-relaxed">{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50/80 border border-red-200/60 rounded-2xl p-5 text-center animate-fade-in-scale backdrop-blur-sm">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleAsk} className="mt-3 text-xs font-medium text-red-600 underline decoration-red-300 underline-offset-2 hover:text-red-800 transition-colors">
              Try again
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 animate-fade-in">
            <div className="relative w-20 h-20 mx-auto mb-5">
              <div className="absolute inset-0 rounded-full bg-blue-100/50 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 border-r-transparent animate-spin" />
              <ShieldCheck className="absolute inset-0 m-auto w-7 h-7 text-blue-500" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Searching coverage policies...</p>
            <p className="text-xs text-slate-400 mt-1.5">Analyzing plan documents for your answer</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="animate-fade-in-scale">
              <AnswerCard result={result} />
            </div>
            <div className="animate-fade-in-up stagger-1">
              <NextSteps result={result} />
            </div>
            <div className="animate-fade-in-up stagger-2">
              <TermHelper />
            </div>

            {result.citations.length > 0 && (
              <div className="glass-card p-5 animate-fade-in-up stagger-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.12em] mb-2.5">Source</p>
                <p className="text-xs text-slate-600 leading-relaxed italic">&quot;{result.citations[0].snippet}&quot;</p>
                <p className="text-[11px] text-slate-400 mt-2">
                  {result.citations[0].section || 'Policy text'}
                  {result.citations[0].page ? ` · Page ${result.citations[0].page}` : ''}
                </p>
              </div>
            )}

            <div className="bg-amber-50/70 border border-amber-200/50 rounded-2xl p-4 text-center animate-fade-in-up stagger-4 backdrop-blur-sm">
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
