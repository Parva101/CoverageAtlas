import { useEffect, useState } from 'react';
import { Send, Loader2, Pill, ShieldCheck, Stethoscope, ClipboardCheck } from 'lucide-react';
import { getPlanMetadata, postQuery } from '../../api/client';
import type { MetadataPayer, QueryResponse } from '../../types';
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
  const [payers, setPayers] = useState<MetadataPayer[]>([]);
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState('');
  const [metadataError, setMetadataError] = useState('');

  useEffect(() => {
    let mounted = true;
    const loadMetadata = async () => {
      setLoadingMetadata(true);
      setMetadataError('');
      try {
        const metadata = await getPlanMetadata();
        if (!mounted) return;
        setPayers(metadata.payers);
      } catch {
        if (!mounted) return;
        setPayers([]);
        setMetadataError('Unable to load plan list right now. You can still ask across all plans.');
      } finally {
        if (mounted) setLoadingMetadata(false);
      }
    };

    loadMetadata();
    return () => {
      mounted = false;
    };
  }, []);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-white">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
        {/* Hero */}
        <div className="text-center animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold mb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            Powered by real policy documents
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Ask about your coverage
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed max-w-md mx-auto">
            Ask in plain language. We&apos;ll search your plan&apos;s actual policy and explain what we find.
          </p>
        </div>

        {/* Input card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 space-y-4 animate-fade-in-up stagger-1">
          {/* Plan selector */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
              Your insurance plan (optional)
            </label>
            <select
              value={payerId}
              onChange={e => setPayerId(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
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
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
              Your question
            </label>
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
                placeholder="e.g. Will my plan cover Ozempic for weight loss?"
                rows={3}
                className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-14 transition-shadow"
              />
              <button
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                className="absolute right-3 bottom-3 w-9 h-9 bg-blue-600 text-white rounded-lg flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 shadow-md shadow-blue-500/20"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">Press Enter to submit · Shift+Enter for new line</p>
          </div>
        </div>

        {/* Suggestion pills */}
        {!result && !loading && (
          <div className="animate-fade-in-up stagger-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Common questions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.map(({ text, icon: Icon }) => (
                <button
                  key={text}
                  onClick={() => setQuestion(text)}
                  className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 transition-all text-left group"
                >
                  <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0 transition-colors">
                    <Icon className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-600 transition-colors" />
                  </div>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center animate-fade-in">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleAsk} className="mt-2 text-xs text-red-600 underline hover:text-red-800">
              Try again
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-10 animate-fade-in">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
              <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 animate-spin" />
              <ShieldCheck className="absolute inset-0 m-auto w-6 h-6 text-blue-500" />
            </div>
            <p className="text-sm font-medium text-slate-600">Searching coverage policies...</p>
            <p className="text-xs text-slate-400 mt-1">Checking plan documents for your answer</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="animate-fade-in-up">
              <AnswerCard result={result} />
            </div>
            <div className="animate-fade-in-up stagger-1">
              <NextSteps result={result} />
            </div>
            <div className="animate-fade-in-up stagger-2">
              <TermHelper />
            </div>

            {result.citations.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 animate-fade-in-up stagger-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Source</p>
                <p className="text-xs text-slate-600 leading-relaxed italic">&quot;{result.citations[0].snippet}&quot;</p>
                <p className="text-xs text-slate-400 mt-1.5">
                  {result.citations[0].section || 'Policy text'}
                  {result.citations[0].page ? ` · Page ${result.citations[0].page}` : ''}
                </p>
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center animate-fade-in-up stagger-4">
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
