import { useState } from 'react';
import { Search, FileText, AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import type { QueryResponse } from '../../types';
import { postQuery } from '../../api/client';

const PAYERS = [
  'UnitedHealthcare', 'Aetna', 'Cigna', 'Humana',
  'BCBS Massachusetts', 'CareFirst BCBS', 'Excellus BCBS',
  'BCBS Michigan', 'BCBS Texas', 'Horizon BCBS NJ',
  'Medicare', 'Medicaid',
];

const CATEGORIES = ['medical_benefit', 'pharmacy_benefit', 'general_um'];

export default function QueryWorkspace() {
  const [question, setQuestion] = useState('');
  const [selectedPayers, setSelectedPayers] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [topK, setTopK] = useState(8);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const handleQuery = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await postQuery({
        question,
        filters: {
          payer_ids: selectedPayers.length ? selectedPayers : undefined,
          policy_categories: category ? [category as any] : undefined,
        },
        retrieval: { top_k: topK },
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const togglePayer = (p: string) => {
    setSelectedPayers(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Query Workspace</h2>
        <p className="text-sm text-slate-500 mt-1">
          Ask coverage questions with payer filters and get cited answers.
        </p>
      </div>

      {/* Search Box */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-3 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleQuery()}
                placeholder="Does UHC cover Ozempic for Type 2 diabetes?"
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleQuery}
              disabled={loading || !question.trim()}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="mt-3 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            {showFilters ? 'Hide' : 'Show'} filters
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="border-t border-slate-100 p-4 space-y-4">
            {/* Payer chips */}
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">Payers</label>
              <div className="flex flex-wrap gap-2">
                {PAYERS.map(p => (
                  <button
                    key={p}
                    onClick={() => togglePayer(p)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedPayers.includes(p)
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              {/* Category */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              {/* Top K */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Top K</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={topK}
                  onChange={e => setTopK(Number(e.target.value))}
                  className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Answer Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Answer</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  Confidence: <strong>{Math.round(result.confidence * 100)}%</strong>
                </span>
                <span className="text-xs text-slate-500">
                  Chunks: {result.retrieval_trace.chunks_used}
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {result.answer}
            </p>
            <p className="mt-4 text-xs text-slate-400 italic">{result.disclaimer}</p>
          </div>

          {/* Citations */}
          {result.citations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Citations ({result.citations.length})
              </h3>
              <div className="grid gap-3">
                {result.citations.map((c, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-lg border border-slate-200 p-4 flex items-start gap-3"
                  >
                    <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-700">
                          {c.section}
                        </span>
                        <span className="text-xs text-slate-400">Page {c.page}</span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{c.snippet}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
