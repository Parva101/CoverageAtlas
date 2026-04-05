import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, PhoneCall, Send, Shield, Sparkles, User } from 'lucide-react';
import { getPlanMetadata, postQuery } from '../../api/client';
import type { MetadataPayer, QueryResponse } from '../../types';
import AnswerCard from './AnswerCard';
import NextSteps from './NextSteps';
import TermHelper from './TermHelper';
import ReasonEvidencePanel from './ReasonEvidencePanel';
import CustomerCoach from './CustomerCoach';

interface ChatTurn {
  id: string;
  question: string;
  response?: QueryResponse;
  error?: string;
}

const MASCOT_NAME = 'Atlas';
const DEFAULT_TWILIO_NUMBER = '+1 (602) 610-0653';
const SUGGESTIONS = [
  'What documents should I prepare before asking for prior authorization?',
  'Does my plan likely cover Wegovy and what restrictions should I expect?',
  'How do I explain medical necessity when a claim gets denied?',
  'Give me a short script I can use when calling my insurance plan.',
];

function toTel(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

export default function MascotChatbot() {
  const [question, setQuestion] = useState('');
  const [payerId, setPayerId] = useState('');
  const [payers, setPayers] = useState<MetadataPayer[]>([]);
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [metadataError, setMetadataError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const twilioNumber = (import.meta.env.VITE_TWILIO_NUMBER as string | undefined)?.trim() || DEFAULT_TWILIO_NUMBER;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    let mounted = true;
    const loadMetadata = async () => {
      setLoadingMetadata(true);
      setMetadataError('');
      try {
        const metadata = await getPlanMetadata();
        if (!mounted) return;
        setPayers(metadata.payers || []);
      } catch {
        if (!mounted) return;
        setPayers([]);
        setMetadataError('Plan list unavailable. Atlas will search across all available plans.');
      } finally {
        if (mounted) setLoadingMetadata(false);
      }
    };
    void loadMetadata();
    return () => {
      mounted = false;
    };
  }, []);

  const latestResponse = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].response) return turns[i].response;
    }
    return null;
  }, [turns]);

  const handleSend = async () => {
    const clean = question.trim();
    if (!clean || loading) return;

    const turnId = crypto.randomUUID();
    setQuestion('');
    setError('');
    setTurns(prev => [...prev, { id: turnId, question: clean }]);
    setLoading(true);

    try {
      const response = await postQuery({
        question: clean,
        filters: payerId ? { payer_ids: [payerId] } : undefined,
      });
      setTurns(prev => prev.map(turn => (turn.id === turnId ? { ...turn, response } : turn)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong while asking Atlas.';
      setError(message);
      setTurns(prev => prev.map(turn => (turn.id === turnId ? { ...turn, error: message } : turn)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-sky-50/40 to-white">
      <div className="max-w-7xl mx-auto px-5 py-8 space-y-6">
        <section className="rounded-3xl border border-cyan-200/70 bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 p-6 text-white shadow-[0_20px_60px_-30px_rgba(2,132,199,0.7)]">
          <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100">Mascot Assistant</p>
              <h1 className="mt-2 text-3xl font-semibold">{MASCOT_NAME} AI Concierge</h1>
              <p className="mt-2 text-sm text-cyan-100 max-w-2xl">
                Ask policy questions in natural language, get evidence-backed answers, and switch to voice instantly when you want to talk on a real call.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">RAG-powered answers</span>
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">Evidence and confidence</span>
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">Voice fallback with Twilio</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/25 bg-white/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-cyan-100" />
                <p className="text-sm font-semibold">Talk to {MASCOT_NAME} on call</p>
              </div>
              <p className="text-xs text-cyan-100">Prefer voice? Call the Twilio number and continue the same assistant experience by phone.</p>
              <a
                href={`tel:${toTel(twilioNumber)}`}
                className="inline-flex items-center gap-2 rounded-xl bg-white text-sky-700 px-3.5 py-2 text-sm font-semibold hover:bg-cyan-50 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                {twilioNumber}
              </a>
              <p className="text-[11px] text-cyan-100">If this is a laptop demo, show this number as the “call Atlas now” action.</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-cyan-100 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-cyan-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{MASCOT_NAME} Chat</p>
                  <p className="text-xs text-slate-500">Policy Q&A with citations</p>
                </div>
              </div>

              <div className="min-w-[210px]">
                <select
                  value={payerId}
                  onChange={event => setPayerId(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  disabled={loadingMetadata}
                >
                  <option value="">All plans</option>
                  {payers.map(payer => (
                    <option key={payer.payer_id} value={payer.payer_id}>
                      {payer.name}
                    </option>
                  ))}
                </select>
                {metadataError && <p className="text-[11px] text-amber-700 mt-1">{metadataError}</p>}
              </div>
            </div>

            <div className="p-4 h-[30rem] overflow-y-auto space-y-4">
              {turns.length === 0 && (
                <div className="h-full flex flex-col justify-center">
                  <div className="text-center mb-5">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-100 flex items-center justify-center">
                      <Sparkles className="w-7 h-7 text-cyan-700" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800">Ask {MASCOT_NAME} anything about coverage policy.</p>
                    <p className="text-xs text-slate-500 mt-1">Example prompts to start:</p>
                  </div>
                  <div className="grid gap-2">
                    {SUGGESTIONS.map(item => (
                      <button
                        key={item}
                        onClick={() => setQuestion(item)}
                        className="text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 hover:border-cyan-300 hover:bg-cyan-50/60 transition-colors"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map(turn => (
                <div key={turn.id} className="space-y-2">
                  <div className="flex justify-end">
                    <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-sky-600 text-white px-3.5 py-2.5 text-sm leading-relaxed shadow-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-3.5 h-3.5" />
                        <span className="text-[11px] uppercase tracking-wide text-sky-100">You</span>
                      </div>
                      {turn.question}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-cyan-700" />
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">{MASCOT_NAME}</span>
                      </div>
                      {turn.response && <p className="leading-relaxed">{turn.response.answer}</p>}
                      {!turn.response && !turn.error && <p className="text-slate-400">Thinking...</p>}
                      {turn.error && <p className="text-red-600">{turn.error}</p>}
                      {turn.response?.citations?.length ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Source: {turn.response.citations[0].section || 'Policy text'}
                          {turn.response.citations[0].page ? ` · p.${turn.response.citations[0].page}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-600" />
                  {MASCOT_NAME} is reviewing policy evidence...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-100 p-3 bg-slate-50/70">
              <div className="flex gap-2">
                <textarea
                  value={question}
                  onChange={event => setQuestion(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={`Ask ${MASCOT_NAME} about policy coverage, prior auth, denials...`}
                  rows={2}
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={loading || !question.trim()}
                  className="w-11 h-11 rounded-xl bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>
          </section>

          <section className="space-y-4">
            {latestResponse ? (
              <>
                <AnswerCard result={latestResponse} />
                <ReasonEvidencePanel result={latestResponse} />
                <CustomerCoach
                  result={latestResponse}
                  onUseQuestion={nextQ => setQuestion(nextQ)}
                />
                <NextSteps result={latestResponse} />
                <TermHelper />
              </>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-500">
                Ask a question to see confidence, evidence quality, coach suggestions, and next steps.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

