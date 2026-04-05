import { useMemo, useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Loader2, PhoneCall, Send, Shield, Sparkles, User } from 'lucide-react';
import { getChatHints, postQuery } from '../../api/client';
import type { QueryResponse } from '../../types';
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

const ASSISTANT_NAME = 'Atlas';
const DEFAULT_TWILIO_NUMBER = '+1 (602) 610-0653';
const DEMO_SUGGESTIONS = [
  'Does my plan cover rituximab for rheumatoid arthritis, and what are the criteria?',
  'What prior authorization requirements apply to my treatment and what documents are needed?',
  'What changed in my payer policy this quarter for my drug under medical benefit?',
  'Compare policy requirements for this drug across two payers and explain the differences.',
];

function toTel(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

export default function AtlasAssistantChat() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>(DEMO_SUGGESTIONS);
  const [usingDemoSuggestions, setUsingDemoSuggestions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const twilioNumber = (import.meta.env.VITE_TWILIO_NUMBER as string | undefined)?.trim() || DEFAULT_TWILIO_NUMBER;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    let cancelled = false;

    void getChatHints()
      .then(payload => {
        if (cancelled) return;
        const liveEnabled = payload.use_live_examples ?? true;
        const live = liveEnabled ? (payload.live_example_questions || []).filter(Boolean) : [];
        const demos = (payload.demo_example_questions || []).filter(Boolean);
        const next = (live.length ? live : demos.length ? demos : DEMO_SUGGESTIONS).slice(0, 6);
        setSuggestions(next);
        setUsingDemoSuggestions(live.length === 0 || !liveEnabled);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions(DEMO_SUGGESTIONS);
        setUsingDemoSuggestions(true);
      });

    return () => {
      cancelled = true;
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
      });
      setTurns(prev => prev.map(turn => (turn.id === turnId ? { ...turn, response } : turn)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong while asking the assistant.';
      setError(message);
      setTurns(prev => prev.map(turn => (turn.id === turnId ? { ...turn, error: message } : turn)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-5 py-8 space-y-6">
        <section className="relative overflow-hidden rounded-3xl border border-indigo-100/90 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-6 text-white shadow-xl shadow-indigo-500/15">
          <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-300/15 blur-2xl" />
          <div className="relative grid gap-5 lg:grid-cols-[1.35fr_1fr] items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-100">Coverage Assistant</p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Ask About Your Coverage</h1>
              <p className="mt-2 text-sm text-indigo-100 max-w-2xl">
                Ask policy questions in natural language, get evidence-backed answers, and switch to voice instantly when you want to talk on a real call.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">RAG-powered answers</span>
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">Evidence and confidence</span>
                <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1">Voice fallback with Twilio</span>
              </div>
            </div>
            <div className="rounded-2xl border border-white/25 bg-white/10 backdrop-blur-md p-4 space-y-3">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-indigo-100" />
                <p className="text-sm font-semibold">Talk to {ASSISTANT_NAME} on call</p>
              </div>
              <p className="text-xs text-indigo-100">Prefer voice? Call the Twilio number and continue the same assistant experience by phone.</p>
              <a
                href={`tel:${toTel(twilioNumber)}`}
                className="inline-flex items-center gap-2 rounded-xl bg-white text-indigo-700 px-3.5 py-2 text-sm font-semibold hover:bg-indigo-50 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                {twilioNumber}
              </a>
              <p className="text-[11px] text-indigo-100">If this is a laptop demo, show this number as the "call Atlas now" action.</p>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="glass-card overflow-hidden animate-fade-in-up stagger-1">
            <div className="border-b border-slate-200/40 bg-white/50 backdrop-blur-sm px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-indigo-400 to-blue-500 opacity-30 blur-sm" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-indigo-700" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{ASSISTANT_NAME} Chat</p>
                  <p className="text-xs text-slate-500">Profile-aware policy Q&A with citations</p>
                </div>
              </div>
            </div>

            <div className="p-4 h-[30rem] overflow-y-auto space-y-4">
              {turns.length === 0 && (
                <div className="h-full flex flex-col justify-center">
                  <div className="text-center mb-5">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-100 flex items-center justify-center">
                      <Sparkles className="w-7 h-7 text-indigo-700" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800">Ask {ASSISTANT_NAME} about medical-benefit policy criteria.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {usingDemoSuggestions ? 'Demo prompts (static sample):' : 'Live prompts from your current policy data:'}
                    </p>
                  </div>
                  <div className="grid gap-2">
                    {suggestions.map(item => (
                      <button
                        key={item}
                        onClick={() => setQuestion(item)}
                        className="text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/60 transition-colors"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map(turn => (
                <div key={turn.id} className="space-y-2.5">
                  <div className="flex justify-end animate-slide-in-right">
                    <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-gradient-to-br from-sky-600 to-blue-600 text-white px-4 py-3 text-sm leading-relaxed shadow-md shadow-blue-500/10">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-3.5 h-3.5" />
                        <span className="text-[11px] uppercase tracking-wide text-sky-100">You</span>
                      </div>
                      {turn.question}
                    </div>
                  </div>

                  <div className="flex justify-start animate-slide-in-left">
                    <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200/50 bg-white/70 backdrop-blur-sm px-4 py-3 text-sm text-slate-700 shadow-sm">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-700" />
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">{ASSISTANT_NAME}</span>
                      </div>
                      {turn.response && <p className="leading-relaxed">{turn.response.answer}</p>}
                      {turn.response?.needs_profile_completion && (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                          <p className="text-xs font-semibold text-amber-800">Missing profile details</p>
                          <p className="mt-1 text-xs text-amber-700">
                            {(turn.response.missing_profile_field_labels || turn.response.missing_profile_fields || []).join(', ')}
                          </p>
                          <Link
                            to={turn.response.profile_completion_url || '/profile'}
                            className="mt-2 inline-flex rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
                          >
                            Complete Profile
                          </Link>
                        </div>
                      )}
                      {!turn.response && !turn.error && <p className="text-slate-400">Thinking...</p>}
                      {turn.error && <p className="text-red-600">{turn.error}</p>}
                      {turn.response?.citations?.length ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Source: {turn.response.citations[0].section || 'Policy text'}
                          {turn.response.citations[0].page ? ` - p.${turn.response.citations[0].page}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-500 animate-fade-in">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span className="text-slate-500">{ASSISTANT_NAME} is reviewing policy evidence</span>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-indigo-500 rounded-full animate-typing-dot-1" />
                    <span className="w-1 h-1 bg-indigo-500 rounded-full animate-typing-dot-2" />
                    <span className="w-1 h-1 bg-indigo-500 rounded-full animate-typing-dot-3" />
                  </span>
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
                  placeholder={`Ask ${ASSISTANT_NAME} about policy coverage, prior auth, denials...`}
                  rows={2}
                  className="flex-1 px-3 py-2.5 border border-slate-200/60 rounded-xl text-sm bg-white/80 backdrop-blur-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition-all"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={loading || !question.trim()}
                  className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all hover:shadow-lg hover:shadow-indigo-500/25 active:scale-95"
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
              <div className="glass-card p-5 text-sm text-slate-500">
                Ask a question to see confidence, evidence quality, coach suggestions, and next steps.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
