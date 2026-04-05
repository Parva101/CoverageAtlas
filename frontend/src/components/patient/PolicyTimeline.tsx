import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Clock3,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { getPolicyChanges, getPolicyMetadata, getRecentPolicyChanges } from '../../api/client';
import type { ChangeType, PolicyChange, PolicyChangeTimelineItem, PolicyMetadata } from '../../types';

type FeedScope = 'global' | 'selected';
type ChangeFilter = 'all' | ChangeType;

interface PatchGroup {
  key: string;
  policy_id: string;
  policy_title: string;
  payer_name: string;
  from_version: string | null;
  to_version: string | null;
  detected_at: string | null;
  sort_ts: number;
  entries: PolicyChangeTimelineItem[];
  counts: Record<ChangeType, number>;
}

const CHANGE_STYLE: Record<ChangeType, { label: string; pill: string; border: string; bg: string }> = {
  added: {
    label: 'Added',
    pill: 'bg-emerald-100 text-emerald-700',
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/70',
  },
  removed: {
    label: 'Removed',
    pill: 'bg-red-100 text-red-700',
    border: 'border-red-200',
    bg: 'bg-red-50/70',
  },
  modified: {
    label: 'Modified',
    pill: 'bg-amber-100 text-amber-700',
    border: 'border-amber-200',
    bg: 'bg-amber-50/70',
  },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatFieldName(field: string): string {
  return field
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatValue(value: string | null): string {
  if (!value) return 'None';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

function versionLabel(version: { version_id: string; version_label: string | null; effective_date: string | null }): string {
  const label = version.version_label || version.version_id.slice(0, 8);
  const effective = version.effective_date ? ` - ${formatDate(version.effective_date)}` : '';
  return `${label}${effective}`;
}

export default function PolicyTimeline() {
  const [policies, setPolicies] = useState<PolicyMetadata[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [policyError, setPolicyError] = useState('');

  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [fromVersion, setFromVersion] = useState('');
  const [toVersion, setToVersion] = useState('');

  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [diffResult, setDiffResult] = useState<{
    policy_id: string;
    from_version: string;
    to_version: string;
    changes: PolicyChange[];
  } | null>(null);

  const [recentChanges, setRecentChanges] = useState<PolicyChangeTimelineItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState('');
  const [feedScope, setFeedScope] = useState<FeedScope>('global');
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [recentRefreshTick, setRecentRefreshTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadPolicies = async () => {
      setLoadingPolicies(true);
      setPolicyError('');
      try {
        const response = await getPolicyMetadata();
        if (!mounted) return;
        setPolicies(response.policies);

        if (response.policies.length > 0) {
          const preferred = response.policies.find(policy => policy.versions.length >= 2) || response.policies[0];
          setSelectedPolicyId(preferred.policy_id);
        }
      } catch {
        if (!mounted) return;
        setPolicyError('Unable to load policy metadata right now.');
      } finally {
        if (mounted) setLoadingPolicies(false);
      }
    };

    void loadPolicies();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedPolicy = useMemo(
    () => policies.find(policy => policy.policy_id === selectedPolicyId) || null,
    [policies, selectedPolicyId],
  );

  const versions = useMemo(() => selectedPolicy?.versions || [], [selectedPolicy]);

  useEffect(() => {
    if (versions.length === 0) {
      setFromVersion('');
      setToVersion('');
      return;
    }

    if (versions.length === 1) {
      setFromVersion(versions[0].version_id);
      setToVersion(versions[0].version_id);
      return;
    }

    const newest = versions[0];
    const previous = versions[1];
    setToVersion(newest.version_id);
    setFromVersion(previous.version_id);
  }, [versions]);

  useEffect(() => {
    let mounted = true;
    const loadRecent = async () => {
      setLoadingRecent(true);
      setRecentError('');
      try {
        const scopedPolicyId = feedScope === 'selected' ? selectedPolicyId || undefined : undefined;
        const response = await getRecentPolicyChanges(60, scopedPolicyId);
        if (!mounted) return;
        setRecentChanges(response.changes);
      } catch {
        if (!mounted) return;
        setRecentError('Unable to load recent policy changes.');
      } finally {
        if (mounted) setLoadingRecent(false);
      }
    };
    void loadRecent();
    return () => {
      mounted = false;
    };
  }, [feedScope, selectedPolicyId, recentRefreshTick]);

  const filteredRecentChanges = useMemo(() => {
    if (changeFilter === 'all') return recentChanges;
    return recentChanges.filter(change => change.change_type === changeFilter);
  }, [changeFilter, recentChanges]);

  const groupedUpdates = useMemo(() => {
    const map = new Map<string, PatchGroup>();

    for (const change of filteredRecentChanges) {
      const dateBucket = change.detected_at ? change.detected_at.slice(0, 10) : 'unknown';
      const targetVersion = change.to_version || 'latest';
      const key = `${change.policy_id}:${targetVersion}:${dateBucket}`;
      const ts = change.detected_at ? new Date(change.detected_at).getTime() : 0;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          policy_id: change.policy_id,
          policy_title: change.policy_title || 'Policy Update',
          payer_name: change.payer_name || 'Unknown payer',
          from_version: change.from_version,
          to_version: change.to_version,
          detected_at: change.detected_at,
          sort_ts: ts,
          entries: [change],
          counts: { added: change.change_type === 'added' ? 1 : 0, removed: change.change_type === 'removed' ? 1 : 0, modified: change.change_type === 'modified' ? 1 : 0 },
        });
        continue;
      }

      existing.entries.push(change);
      existing.counts[change.change_type] += 1;
      if (ts > existing.sort_ts) {
        existing.sort_ts = ts;
        existing.detected_at = change.detected_at;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.sort_ts - a.sort_ts);
  }, [filteredRecentChanges]);

  const diffCounts = useMemo(() => {
    if (!diffResult) return { added: 0, removed: 0, modified: 0 };
    return diffResult.changes.reduce(
      (acc, change) => {
        acc[change.change_type] += 1;
        return acc;
      },
      { added: 0, removed: 0, modified: 0 } as Record<ChangeType, number>,
    );
  }, [diffResult]);

  const compareVersions = async () => {
    if (!selectedPolicyId || !fromVersion || !toVersion) return;
    if (fromVersion === toVersion) {
      setDiffError('Choose two different versions to compare.');
      return;
    }

    setDiffLoading(true);
    setDiffError('');
    setDiffResult(null);
    try {
      const result = await getPolicyChanges(selectedPolicyId, fromVersion, toVersion);
      setDiffResult(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to compare selected versions.';
      setDiffError(message);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="app-surface border-indigo-100/90 bg-gradient-to-r from-indigo-600 to-blue-600 p-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-indigo-100">Patch Notes</p>
        <h1 className="mt-2 text-3xl font-semibold">Policy Update Timeline</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100">
          See policy changes in an update-feed style experience, then run deep version-to-version comparisons below.
        </p>
      </section>

      <section className="app-surface space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Clock3 className="h-5 w-5 text-blue-600" />
            Latest Updates
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFeedScope('global')}
              className={`app-chip ${feedScope === 'global' ? 'app-chip-active' : ''}`}
            >
              All Policies
            </button>
            <button
              onClick={() => setFeedScope('selected')}
              className={`app-chip ${feedScope === 'selected' ? 'app-chip-active' : ''}`}
              disabled={!selectedPolicyId}
            >
              Selected Policy
            </button>
            <button
              onClick={() => setChangeFilter('all')}
              className={`app-chip ${changeFilter === 'all' ? 'app-chip-active' : ''}`}
            >
              All Changes
            </button>
            {(['added', 'modified', 'removed'] as ChangeType[]).map(type => (
              <button
                key={type}
                onClick={() => setChangeFilter(type)}
                className={`app-chip ${changeFilter === type ? 'app-chip-active' : ''}`}
              >
                {CHANGE_STYLE[type].label}
              </button>
            ))}
            <button
              onClick={() => setRecentRefreshTick(prev => prev + 1)}
              className="app-button-secondary"
              disabled={loadingRecent}
            >
              {loadingRecent ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        </div>

        {recentError && <p className="text-sm text-amber-700">{recentError}</p>}

        {loadingRecent && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
            <p className="mt-2 text-sm text-slate-600">Loading update feed...</p>
          </div>
        )}

        {!loadingRecent && groupedUpdates.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No updates available for this filter.
          </div>
        )}

        {!loadingRecent && groupedUpdates.length > 0 && (
          <div className="space-y-4">
            {groupedUpdates.map(group => (
              <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 bg-slate-900 px-4 py-3 text-slate-100">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Release Update</p>
                    <h3 className="mt-1 text-base font-semibold">{group.policy_title}</h3>
                    <p className="text-xs text-slate-300">{group.payer_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200">
                      <Rocket className="h-3 w-3" />
                      Patch {group.to_version || 'Latest'}
                    </span>
                    <p className="mt-1 text-xs text-slate-300">{formatDate(group.detected_at)}</p>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {(['added', 'modified', 'removed'] as ChangeType[]).map(type => (
                      <span key={type} className={`rounded-full px-2 py-1 font-semibold ${CHANGE_STYLE[type].pill}`}>
                        {CHANGE_STYLE[type].label}: {group.counts[type]}
                      </span>
                    ))}
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                      {group.entries.length} notes
                    </span>
                  </div>

                  <ul className="space-y-2">
                    {group.entries.slice(0, 6).map(entry => (
                      <li
                        key={entry.id}
                        className={`rounded-xl border p-3 ${CHANGE_STYLE[entry.change_type].border} ${CHANGE_STYLE[entry.change_type].bg}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHANGE_STYLE[entry.change_type].pill}`}>
                            {CHANGE_STYLE[entry.change_type].label}
                          </span>
                          <p className="text-sm font-semibold text-slate-800">{formatFieldName(entry.field_name)}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-700">
                          {formatValue(entry.old_value)}
                          {' -> '}
                          {formatValue(entry.new_value)}
                        </p>
                      </li>
                    ))}
                  </ul>

                  {group.entries.length > 6 && (
                    <p className="text-xs font-medium text-slate-500">
                      +{group.entries.length - 6} more changes in this update.
                    </p>
                  )}

                  <p className="text-xs text-slate-500">
                    Version flow: {group.from_version || 'Unknown'}
                    {' -> '}
                    {group.to_version || 'Unknown'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Update feed is informational. Always verify final policy wording before making decisions.
        </p>
      </section>

      <section className="app-surface space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <GitCompareArrows className="h-5 w-5 text-blue-600" />
            Compare Policy Versions
          </h2>
          <button
            onClick={() => void compareVersions()}
            disabled={diffLoading || !selectedPolicyId || !fromVersion || !toVersion}
            className="app-button-primary"
          >
            {diffLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpDown className="h-4 w-4" />}
            {diffLoading ? 'Comparing...' : 'Run Comparison'}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-3">
            <label className="mb-2 block text-sm font-medium text-slate-700">Policy</label>
            <select
              value={selectedPolicyId}
              onChange={event => setSelectedPolicyId(event.target.value)}
              className="app-input"
              disabled={loadingPolicies}
            >
              <option value="">Select a policy...</option>
              {policies.map(policy => (
                <option key={policy.policy_id} value={policy.policy_id}>
                  {policy.policy_title} - {policy.payer_name}
                </option>
              ))}
            </select>
            {loadingPolicies && <p className="mt-2 text-xs text-slate-400">Loading policies...</p>}
            {policyError && <p className="mt-2 text-xs text-amber-700">{policyError}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">From version</label>
            <select value={fromVersion} onChange={event => setFromVersion(event.target.value)} className="app-input">
              <option value="">Select older version...</option>
              {versions.map(version => (
                <option key={version.version_id} value={version.version_id}>
                  {versionLabel(version)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">To version</label>
            <select value={toVersion} onChange={event => setToVersion(event.target.value)} className="app-input">
              <option value="">Select newer version...</option>
              {versions.map(version => (
                <option key={version.version_id} value={version.version_id}>
                  {versionLabel(version)}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Selected Policy</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{selectedPolicy?.policy_title || 'None'}</p>
            <p className="mt-1 text-xs text-slate-500">{selectedPolicy?.payer_name || 'Choose a policy to continue'}</p>
          </div>
        </div>
      </section>

      {diffError && (
        <section className="app-surface border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {diffError}
        </section>
      )}

      {diffResult && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(['added', 'modified', 'removed'] as ChangeType[]).map(type => (
              <div key={type} className={`app-surface p-4 ${CHANGE_STYLE[type].bg} ${CHANGE_STYLE[type].border}`}>
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500">{CHANGE_STYLE[type].label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{diffCounts[type]}</p>
              </div>
            ))}
          </div>

          <div className="app-surface p-5">
            <p className="text-sm font-semibold text-slate-900">
              Deep diff:
              {' '}
              {diffResult.from_version}
              {' -> '}
              {diffResult.to_version}
            </p>
            {diffResult.changes.length === 0 && (
              <p className="mt-2 text-sm text-slate-600">No field-level changes were found between these versions.</p>
            )}
            {diffResult.changes.length > 0 && (
              <div className="mt-4 space-y-3">
                {diffResult.changes.map((change, index) => (
                  <article
                    key={`${change.change_type}-${change.field_name}-${index}`}
                    className={`rounded-xl border p-4 ${CHANGE_STYLE[change.change_type].border} ${CHANGE_STYLE[change.change_type].bg}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHANGE_STYLE[change.change_type].pill}`}>
                        {CHANGE_STYLE[change.change_type].label}
                      </span>
                      <p className="text-sm font-semibold text-slate-800">{formatFieldName(change.field_name)}</p>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Previous</p>
                        <p className="mt-1 text-sm text-slate-700">{change.old_value || 'None'}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Updated</p>
                        <p className="mt-1 text-sm text-slate-700">{change.new_value || 'None'}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
