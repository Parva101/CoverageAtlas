import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Clipboard,
  Loader2,
  Mic,
  Phone,
  PhoneOff,
  Sparkles,
  User,
} from 'lucide-react';
import { endVoiceSession, sendVoiceTurn, startVoiceSession } from '../../api/client';
import type { VoiceMessage } from '../../types';

const QUICK_PROMPTS = [
  'Do I need prior authorization for Humira?',
  'Can you summarize what this plan requires for Ozempic?',
  'What should I ask my insurer before submitting a claim?',
];

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function VoiceCall() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<'api' | 'demo' | null>(null);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [input, setInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!sessionId || !startedAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sessionId, startedAt]);

  const elapsedSeconds = useMemo(() => {
    if (!startedAt || !sessionId) return 0;
    return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  }, [nowMs, sessionId, startedAt]);

  const startConversation = async () => {
    setStarting(true);
    setSummary(null);
    setMessages([]);
    try {
      const session = await startVoiceSession();
      setSessionId(session.id);
      setSessionMode('api');
    } catch {
      setSessionId('demo-session');
      setSessionMode('demo');
    } finally {
      setStartedAt(Date.now());
      setNowMs(Date.now());
      setStarting(false);
    }
  };

  const submitUtterance = async (utterance: string) => {
    const normalized = utterance.trim();
    if (!normalized || !sessionId) return;

    const userMessage: VoiceMessage = {
      role: 'user',
      text: normalized,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await sendVoiceTurn(sessionId, normalized);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: response.answer,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: 'I could not fetch policy details right now. Please try again or verify with your insurer directly.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const endConversation = async () => {
    if (!sessionId) return;

    try {
      if (sessionMode === 'api') {
        const ended = await endVoiceSession(sessionId);
        setSummary(ended.summary || 'Call ended. Review transcript details below.');
      } else {
        setSummary('Demo call ended. Review transcript details below.');
      }
    } catch {
      setSummary('Call ended. Review transcript details below.');
    } finally {
      setSessionId(null);
      setSessionMode(null);
      setStartedAt(null);
    }
  };

  const copyTranscript = async () => {
    if (typeof window === 'undefined' || !window.navigator?.clipboard || messages.length === 0) return;
    const transcript = messages
      .map(message => `${message.role === 'user' ? 'You' : 'Atlas'}: ${message.text}`)
      .join('\n');
    try {
      await window.navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="app-surface border-cyan-100/90 bg-gradient-to-r from-cyan-600 to-blue-600 p-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100">Conversational Assistant</p>
        <h1 className="mt-2 text-3xl font-semibold">Voice-Style Coverage Agent</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cyan-100">
          Ask coverage questions in a natural back-and-forth format. Use this for fast clarifications before contacting your insurer.
        </p>
      </section>

      {!sessionId && !summary && (
        <section className="app-surface p-8 text-center">
          <div className="mx-auto flex h-20 w-20 animate-float-soft items-center justify-center rounded-full bg-blue-100">
            <Phone className="h-9 w-9 text-blue-600" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">Start a conversation</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            The voice endpoint responds in turn-based chat. You can type questions now and plug in real speech capture later.
          </p>

          <button onClick={() => void startConversation()} disabled={starting} className="app-button-primary mt-6">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            {starting ? 'Starting...' : 'Start Conversation'}
          </button>
        </section>
      )}

      {sessionId && (
        <section className="space-y-4">
          <div className="app-surface flex flex-wrap items-center justify-between gap-3 border-emerald-200 bg-emerald-50/80 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-sm font-semibold text-emerald-800">Session Active</p>
              <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {formatDuration(elapsedSeconds)}
              </span>
              <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs text-emerald-700">
                {sessionMode === 'api' ? 'Backend' : 'Demo fallback'}
              </span>
            </div>

            <button onClick={() => void endConversation()} className="app-button-secondary text-xs text-red-700">
              <PhoneOff className="h-3.5 w-3.5" />
              End Call
            </button>
          </div>

          <div className="app-surface max-h-[440px] min-h-[340px] space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="pt-10 text-center text-sm text-slate-500">Ask your first question to begin the transcript.</p>
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
                    <Bot className="h-4 w-4 text-blue-600" />
                  </div>
                )}

                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-blue-600 text-white'
                      : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {message.text}
                </div>

                {message.role === 'user' && (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200">
                    <User className="h-4 w-4 text-slate-600" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <Bot className="h-4 w-4 text-blue-600" />
                </div>
                <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                onClick={() => void submitUtterance(prompt)}
                disabled={loading}
                className="app-chip"
              >
                <Sparkles className="mr-1 inline h-3 w-3" />
                {prompt}
              </button>
            ))}
          </div>

          <div className="app-surface flex items-end gap-3 p-4">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitUtterance(input);
                }
              }}
              placeholder="Type your question..."
              className="app-input min-h-[82px] flex-1 resize-none"
            />
            <button
              onClick={() => void submitUtterance(input)}
              disabled={loading || !input.trim()}
              className="app-button-primary h-[46px] min-w-[56px] px-3"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            </button>
          </div>

          <p className="text-center text-xs text-slate-500">
            Informational only. Confirm final coverage and authorization criteria with your insurance provider.
          </p>
        </section>
      )}

      {summary && (
        <section className="app-surface space-y-4 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Call Summary</h3>
          <p className="text-sm leading-relaxed text-slate-700">{summary}</p>

          {messages.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-blue-700">View transcript</summary>
              <div className="mt-3 space-y-2 text-slate-600">
                {messages.map((message, index) => (
                  <p key={`${message.timestamp}-${index}`}>
                    <strong className="text-slate-800">{message.role === 'user' ? 'You' : 'Atlas'}:</strong> {message.text}
                  </p>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void copyTranscript()} className="app-button-secondary">
              <Clipboard className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy Transcript'}
            </button>
            <button
              onClick={() => {
                setSummary(null);
                setMessages([]);
                setInput('');
              }}
              className="app-button-primary"
            >
              Start New Conversation
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
