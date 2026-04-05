import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, Loader2, User, Bot } from 'lucide-react';
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
      // If API isn't ready, use a mock session
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
          text: 'I wasn\'t able to look that up right now. Please try again or call your insurance directly.',
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-white">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Voice Assistant</h1>
          <p className="text-sm text-slate-500 mt-1">
            Have a conversation about your coverage instead of reading long documents.
          </p>
        </div>

        {/* Not started */}
        {!sessionId && !summary && (
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-5">
              <Phone className="w-9 h-9 text-blue-600" />
            </div>
            <p className="text-sm text-slate-600 mb-5">
              Start a voice-style conversation. Type or speak your questions and get plain-language answers.
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-8 py-3 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
              Start Conversation
            </button>
          </div>
        )}

        {/* Active session */}
        {sessionId && (
          <>
            {/* Status bar */}
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-emerald-700">Session active</span>
              </div>
              <button
                onClick={handleEnd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End Call
              </button>
            </div>

            {/* Messages */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 min-h-80 max-h-96 overflow-y-auto space-y-4">
              {messages.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">
                  Ask your first question...
                </p>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-blue-600" />
                    </div>
                  )}
                  <div
                    className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-slate-100 text-slate-700 rounded-bl-md'
                    }`}
                  >
                    {msg.text}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-4 h-4 text-slate-600" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl rounded-bl-md px-4 py-3">
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Type your question..."
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:opacity-40"
              >
                <Mic className="w-5 h-5" />
              </button>
            </div>

            {/* Disclaimer */}
            <p className="text-xs text-slate-400 text-center">
              This is an informational tool, not medical advice. Always confirm with your insurer.
            </p>
          </>
        )}

        {/* Post-call summary */}
        {summary && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Call Summary</h3>
            <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
            {messages.length > 0 && (
              <details className="text-xs">
                <summary className="text-blue-600 cursor-pointer font-medium">View transcript</summary>
                <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-slate-200">
                  {messages.map((m, i) => (
                    <p key={i} className="text-slate-600">
                      <strong className="text-slate-800">{m.role === 'user' ? 'You' : 'Atlas'}:</strong> {m.text}
                    </p>
                  ))}
                </div>
              </details>
            )}
            <button
              onClick={() => { setSummary(null); setMessages([]); }}
              className="text-xs text-blue-600 font-medium hover:text-blue-800"
            >
              Start a new conversation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

