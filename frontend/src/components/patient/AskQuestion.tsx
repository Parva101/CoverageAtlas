import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Filter,
  Loader2,
  MessageCircleQuestion,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { getPlanMetadata, postQuery } from '../../api/client';
import type {
  CoverageStatus,
  MetadataPayer,
  PolicyCategory,
  QueryRequest,
  QueryResponse,
} from '../../types';
import AnswerCard from './AnswerCard';
import NextSteps from './NextSteps';
import TermHelper from './TermHelper';

const CATEGORY_OPTIONS: Array<{ key: PolicyCategory; label: string }> = [
  { key: 'pharmacy_benefit', label: 'Pharmacy Benefit' },
  { key: 'medical_benefit', label: 'Medical Benefit' },
  { key: 'general_um', label: 'General Utilization Mgmt' },
];

const STATUS_OPTIONS: Array<{ key: CoverageStatus; label: string }> = [
  { key: 'covered', label: 'Covered' },
  { key: 'restricted', label: 'Restricted' },
  { key: 'not_covered', label: 'Not Covered' },
];

const QUICK_PROMPTS = [
  'Will my insurance cover Ozempic for type 2 diabetes?',
  'Does my plan require prior authorization for Humira?',
  'Is bariatric surgery covered under my plan?',
  'What criteria does my plan require for Wegovy approval?',
];

const RECENT_ASKS_STORAGE_KEY = 'coverageatlas_recent_asks';

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

export default function AskQuestion() {
  const [question, setQuestion] = useState('');
  const [payerId, setPayerId] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [policyCategories, setPolicyCategories] = useState<PolicyCategory[]>([]);
  const [coverageStatuses, setCoverageStatuses] = useState<CoverageStatus[]>([]);
  const [retrievalTopK, setRetrievalTopK] = useState(8);
  const [hybridRetrieval, setHybridRetrieval] = useState(true);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [payers, setPayers] = useState<MetadataPayer[]>([]);
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [metadataError, setMetadataError] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState('');
  const [recentAsks, setRecentAsks] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(RECENT_ASKS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(item => typeof item === 'string').slice(0, 6);
        setRecentAsks(cleaned);
      }
    } catch {
      window.localStorage.removeItem(RECENT_ASKS_STORAGE_KEY);
    }
  }, []);

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
        setMetadataError('Unable to load plan list right now. You can still query across all plans.');
      } finally {
        if (mounted) setLoadingMetadata(false);
      }
    };

    void loadMetadata();
    return () => {
      mounted = false;
    };
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (payerId) count += 1;
    if (effectiveOn) count += 1;
    count += policyCategories.length;
    count += coverageStatuses.length;
    return count;
  }, [coverageStatuses.length, effectiveOn, payerId, policyCategories.length]);

  const saveRecentAsk = (value: string) => {
    setRecentAsks(previous => {
      const normalized = value.trim();
      const next = [
        normalized,
        ...previous.filter(item => item.toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, 6);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RECENT_ASKS_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const clearFilters = () => {
    setPayerId('');
    setEffectiveOn('');
    setPolicyCategories([]);
    setCoverageStatuses([]);
    setRetrievalTopK(8);
    setHybridRetrieval(true);
  };

  const handleAsk = async () => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const filters: QueryRequest['filters'] = {};
      if (payerId) filters.payer_ids = [payerId];
      if (effectiveOn) filters.effective_on = effectiveOn;
      if (policyCategories.length > 0) filters.policy_categories = policyCategories;
      if (coverageStatuses.length > 0) filters.coverage_statuses = coverageStatuses;

      const request: QueryRequest = {
        question: normalizedQuestion,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        retrieval: {
          top_k: retrievalTopK,
          hybrid: hybridRetrieval,
        },
      };

      const res = await postQuery(request);
      setResult(res);
      saveRecentAsk(normalizedQuestion);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const appliedFilters = result?.retrieval_trace.applied_filters;

  return (
    <div className="space-y-6">
      <section className="app-surface relative overflow-hidden border-blue-100/90 bg-gradient-to-br from-blue-600 via-blue-600 to-cyan-600 p-7 text-white">
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/20" />
        <div className="absolute -bottom-10 left-1/3 h-28 w-28 rounded-full bg-cyan-300/20" />
        <div className="relative grid gap-5 md:grid-cols-[1.7fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-100">Question Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold">Ask About Your Coverage</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-blue-100">
              Ask in plain language and refine the query with advanced metadata filters. Answers are backed by policy snippets and retrieval trace metadata.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-xs text-blue-100">Payers loaded</p>
              <p className="mt-1 text-xl font-semibold">{loadingMetadata ? '...' : payers.length}</p>
            </div>
            <div className="rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-xs text-blue-100">Recent asks</p>
              <p className="mt-1 text-xl font-semibold">{recentAsks.length}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-xs text-blue-100">Retrieval mode</p>
              <p className="mt-1 text-sm font-semibold">
                {hybridRetrieval ? 'Hybrid Search' : 'Vector-only'} - Top {retrievalTopK} chunks
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-surface space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-slate-900">Compose your question</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              className={`app-button-secondary ${showAdvancedFilters ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
            </button>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="app-button-secondary text-xs">
                <X className="h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Your insurance payer (optional)</label>
          <select
            value={payerId}
            onChange={event => setPayerId(event.target.value)}
            className="app-input"
            disabled={loadingMetadata}
          >
            <option value="">All payers</option>
            {payers.map(payer => (
              <option key={payer.payer_id} value={payer.payer_id}>
                {payer.name}
              </option>
            ))}
          </select>
          {loadingMetadata && <p className="mt-2 text-xs text-slate-400">Loading payer metadata...</p>}
          {metadataError && <p className="mt-2 text-xs text-amber-700">{metadataError}</p>}
        </div>

        {showAdvancedFilters && (
          <div className="animate-fade-up space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <CalendarDays className="h-4 w-4 text-blue-600" />
                  Effective on date
                </label>
                <input
                  type="date"
                  value={effectiveOn}
                  onChange={event => setEffectiveOn(event.target.value)}
                  className="app-input"
                />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Retrieval Controls</p>
                <div className="mt-3 space-y-2.5">
                  <label className="flex items-center justify-between text-sm text-slate-700">
                    <span>Top K chunks</span>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{retrievalTopK}</span>
                  </label>
                  <input
                    type="range"
                    min={4}
                    max={12}
                    step={1}
                    value={retrievalTopK}
                    onChange={event => setRetrievalTopK(Number(event.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <button
                    onClick={() => setHybridRetrieval(prev => !prev)}
                    className={`app-button-secondary w-full justify-between text-xs ${
                      hybridRetrieval ? 'border-blue-200 bg-blue-50 text-blue-700' : ''
                    }`}
                  >
                    <span>Hybrid Retrieval</span>
                    <span>{hybridRetrieval ? 'Enabled' : 'Disabled'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Filter className="h-4 w-4 text-blue-600" />
                Policy categories
              </p>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map(option => {
                  const active = policyCategories.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      onClick={() => setPolicyCategories(previous => toggleValue(previous, option.key))}
                      className={`app-chip ${active ? 'app-chip-active' : ''}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Coverage status focus</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(option => {
                  const active = coverageStatuses.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      onClick={() => setCoverageStatuses(previous => toggleValue(previous, option.key))}
                      className={`app-chip ${active ? 'app-chip-active' : ''}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <textarea
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleAsk();
              }
            }}
            rows={4}
            placeholder="Example: Does my payer cover semaglutide for obesity, and what documentation is required?"
            className="app-input min-h-[132px] resize-y"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Press Enter to submit. Shift+Enter adds a new line.</p>
            <button
              onClick={() => void handleAsk()}
              disabled={loading || !question.trim()}
              className="app-button-primary"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? 'Checking...' : 'Ask CoverageAtlas'}
            </button>
          </div>
        </div>
      </section>

      {!result && !loading && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="app-surface p-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              Suggested Questions
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => setQuestion(prompt)}
                  className="app-chip text-left"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="app-surface p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Recent Asks</p>
            {recentAsks.length === 0 && (
              <p className="text-sm text-slate-500">Your recent questions will appear here for quick reuse.</p>
            )}
            {recentAsks.length > 0 && (
              <div className="space-y-2">
                {recentAsks.map(ask => (
                  <button
                    key={ask}
                    onClick={() => setQuestion(ask)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    {ask}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {error && (
        <section className="app-surface border-red-200 bg-red-50/80 p-5 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => void handleAsk()} className="mt-2 text-xs font-semibold text-red-700 underline">
            Try again
          </button>
        </section>
      )}

      {loading && (
        <section className="app-surface py-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-3 text-sm text-slate-600">Searching policy chunks and preparing an answer...</p>
        </section>
      )}

      {result && (
        <section className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
          <div className="space-y-5">
            <AnswerCard result={result} />
            <NextSteps result={result} />
            <TermHelper />

            {result.citations.length > 0 && (
              <div className="app-surface p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Primary Sources</p>
                <div className="space-y-3">
                  {result.citations.slice(0, 2).map(citation => (
                    <div
                      key={`${citation.document_id ?? 'unknown'}-${citation.page ?? 0}-${citation.section ?? 's'}`}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <p className="text-sm italic leading-relaxed text-slate-700">&quot;{citation.snippet}&quot;</p>
                      <p className="mt-2 text-xs text-slate-500">
                        {citation.section || 'Policy text'}
                        {citation.page ? ` - Page ${citation.page}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <div className="app-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Retrieval Insight</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Chunks used</p>
                  <p className="mt-1 text-lg font-semibold text-slate-800">{result.retrieval_trace.chunks_used}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Vector store</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{result.retrieval_trace.vector_store}</p>
                </div>
              </div>

              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Applied filters</p>
              {!appliedFilters && (
                <p className="mt-2 text-sm text-slate-500">No metadata filters were applied for this query.</p>
              )}
              {appliedFilters && (
                <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                  <p>
                    Payer IDs: {appliedFilters.payer_ids && appliedFilters.payer_ids.length > 0
                      ? appliedFilters.payer_ids.join(', ')
                      : 'Any'}
                  </p>
                  <p>
                    Categories: {appliedFilters.policy_categories && appliedFilters.policy_categories.length > 0
                      ? appliedFilters.policy_categories.join(', ')
                      : 'Any'}
                  </p>
                  <p>
                    Coverage statuses: {appliedFilters.coverage_statuses && appliedFilters.coverage_statuses.length > 0
                      ? appliedFilters.coverage_statuses.join(', ')
                      : 'Any'}
                  </p>
                  <p>
                    Effective on: {appliedFilters.effective_on || 'Latest available version'}
                  </p>
                </div>
              )}
            </div>

            <div className="app-surface border-amber-200 bg-amber-50/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Disclaimer</p>
              <p className="mt-2 text-sm leading-relaxed text-amber-900">
                {result.disclaimer ||
                  'Informational only and based on available policy evidence. Coverage decisions are made by the payer at claim time.'}
              </p>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}
