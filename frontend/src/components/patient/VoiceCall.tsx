import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, Loader2, User, Bot, Send, Sparkles } from 'lucide-react';
import { startVoiceSession, sendVoiceTurn, endVoiceSession } from '../../api/client';
import type { VoiceMessage } from '../../types';

export default function VoiceCall() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const session = await startVoiceSession();
      setSessionId(session.id);
      setMessages([]);
      setSummary(null);
    } catch {
      setSessionId('demo-session');
      setMessages([]);
      setSummary(null);
    } finally {
      setStarting(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;
    const userMsg: VoiceMessage = { role: 'user', text: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await sendVoiceTurn(sessionId, input);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: res.answer, timestamp: new Date().toISOString() },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: "I wasn't able to look that up right now. Please try again or call your insurance directly.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    if (!sessionId) return;
    try {
      const session = await endVoiceSession(sessionId);
      setSummary(session.summary || 'Call ended. See transcript above.');
    } catch {
      setSummary('Call ended. See transcript above.');
    }
    setSessionId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-white">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
        {/* Header */}
        <div className="text-center animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Conversational AI assistant
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Voice Assistant</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
            Have a conversation about your coverage. Ask questions naturally and get plain-language answers.
          </p>
        </div>

        {/* Not started */}
        {!sessionId && !summary && (
          <div className="text-center py-12 animate-fade-in-up stagger-1">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-blue-100 animate-pulse" />
              <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/30">
                <Phone className="w-10 h-10 text-white" />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Ready when you are</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-xs mx-auto">
              Start a conversation to ask about your coverage in plain language.
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-8 py-3.5 bg-blue-600 text-white text-sm font-semibold rounded-full hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2.5 mx-auto transition-all hover:shadow-lg hover:shadow-blue-500/25 active:scale-95"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
              {starting ? 'Starting...' : 'Start Conversation'}
            </button>

            {/* Feature hints */}
            <div className="mt-8 grid grid-cols-3 gap-3 max-w-sm mx-auto">
              {[
                { label: 'Coverage questions' },
                { label: 'Prior auth help' },
                { label: 'Plan comparisons' },
              ].map(f => (
                <div key={f.label} className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-500 text-center">
                  {f.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active session */}
        {sessionId && (
          <>
            {/* Status bar */}
            <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm animate-fade-in">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full block animate-pulse-ring" />
                </div>
                <span className="text-sm font-semibold text-slate-700">Session active</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                  {messages.filter(m => m.role === 'user').length} message{messages.filter(m => m.role === 'user').length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={handleEnd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-semibold hover:bg-red-100 transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End
              </button>
            </div>

            {/* Chat area */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
              <div className="p-4 min-h-80 max-h-[28rem] overflow-y-auto space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                      <Bot className="w-6 h-6 text-blue-500" />
                    </div>
                    <p className="text-sm text-slate-400 text-center">
                      Ask your first question about your coverage...
                    </p>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-2.5 animate-fade-in-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4 text-blue-600" />
                      </div>
                    )}
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-8 h-8 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-4 h-4 text-slate-500" />
                      </div>
                    )}
                  </div>
                ))}

                {loading && (
                  <div className="flex gap-2.5 animate-fade-in">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-slate-100 p-3 bg-slate-50/50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Type your question..."
                    className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                    className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 shadow-md shadow-blue-500/20 shrink-0"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                    className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                    title="Use microphone (coming soon)"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 text-center animate-fade-in">
              Informational only. Not medical advice. Always confirm with your insurer.
            </p>
          </>
        )}

        {/* Post-call summary */}
        {summary && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Conversation Summary</h3>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4 border border-slate-200">
              {summary}
            </p>
            {messages.length > 0 && (
              <details className="text-xs">
                <summary className="text-blue-600 cursor-pointer font-medium hover:text-blue-800">
                  View full transcript ({messages.length} messages)
                </summary>
                <div className="mt-3 space-y-2 pl-3 border-l-2 border-slate-200">
                  {messages.map((m, i) => (
                    <p key={i} className="text-slate-600 leading-relaxed">
                      <strong className="text-slate-800">{m.role === 'user' ? 'You' : 'Atlas'}:</strong>{' '}
                      {m.text}
                    </p>
                  ))}
                </div>
              </details>
            )}
            <button
              onClick={() => { setSummary(null); setMessages([]); }}
              className="w-full py-2.5 bg-blue-50 text-blue-600 text-sm font-semibold rounded-xl hover:bg-blue-100 transition-colors border border-blue-200"
            >
              Start a new conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

