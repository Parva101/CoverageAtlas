import type {
  QueryRequest,
  QueryResponse,
  CompareRequest,
  CompareResponse,
  PolicyChange,
  PoliciesMetadataResponse,
  RecentPolicyChangesResponse,
  UserProfileResponse,
  UserProfileUpdateRequest,
  DocumentStatus,
  VoiceSession,
  PlanMetadataResponse,
} from '../types';

const DEFAULT_BASE = '/api/v1';
const rawEnvBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
const BASE = (rawEnvBase && rawEnvBase.length > 0 ? rawEnvBase : DEFAULT_BASE).replace(/\/+$/, '');
const TOKEN_STORAGE_KEY = 'coverageatlas_access_token';

let accessToken: string | null =
  typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
let accessTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthToken(token: string) {
  const normalized = token.trim();
  accessToken = normalized || null;
  if (typeof window !== 'undefined') {
    if (accessToken) window.localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function clearAuthToken() {
  setAuthToken('');
}

export function getAuthToken(): string | null {
  return accessToken;
}

export function setAuthTokenProvider(provider: (() => Promise<string | null>) | null) {
  accessTokenProvider = provider;
}

async function resolveAccessToken(): Promise<string | null> {
  if (accessTokenProvider) {
    try {
      const provided = await accessTokenProvider();
      const normalized = provided?.trim() || '';
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall back to any manually stored token if the provider errors.
    }
  }
  return accessToken;
}

async function withAuthHeaders(init?: RequestInit, includeJsonContentType = true): Promise<Headers> {
  const headers = new Headers(init?.headers || {});
  if (includeJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = await resolveAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await withAuthHeaders(init, true);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// Health
export const getHealth = () => request<{ status: string }>('/health');

// Auth
export const getAuthMe = () =>
  request<{
    sub: string | null;
    scope: string;
    permissions: string[];
    scopes: string[];
    auth_enabled: boolean;
  }>('/auth/me');

// Metadata
export const getPlanMetadata = () => request<PlanMetadataResponse>('/metadata/plans');
export const getPolicyMetadata = () => request<PoliciesMetadataResponse>('/metadata/policies');

// Query (Q&A)
export const postQuery = (body: QueryRequest) =>
  request<QueryResponse>('/query', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// Compare
export const postCompare = (body: CompareRequest) =>
  request<CompareResponse>('/compare', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// Policy Changes
export const getPolicyChanges = (policyId: string, from: string, to: string) =>
  request<{ policy_id: string; from_version: string; to_version: string; changes: PolicyChange[] }>(
    `/policies/${policyId}/changes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
export const getRecentPolicyChanges = (limit = 30, policyId?: string) => {
  const policyFilter = policyId ? `&policy_id=${encodeURIComponent(policyId)}` : '';
  return request<RecentPolicyChangesResponse>(`/policies/changes/recent?limit=${limit}${policyFilter}`);
};

// Profile
export const getMyProfile = () => request<UserProfileResponse>('/profile/me');
export const updateMyProfile = (body: UserProfileUpdateRequest) =>
  request<UserProfileResponse>('/profile/me', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

// Documents
export const uploadDocument = async (
  file: File,
  payerId: string,
  policyTitle: string,
): Promise<DocumentStatus> => {
  const form = new FormData();
  form.append('file', file);
  form.append('payer_id', payerId);
  form.append('policy_title', policyTitle);

  const headers = await withAuthHeaders(undefined, false);
  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    body: form,
    headers,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
};

export const getDocumentStatus = (docId: string) =>
  request<DocumentStatus>(`/documents/${docId}/status`);

// Source Scan
export const triggerScan = (sourceGroup = 'default') =>
  request<{ scan_id: string; status: string }>('/sources/scan', {
    method: 'POST',
    body: JSON.stringify({ source_group: sourceGroup }),
  });

// Voice
export const startVoiceSession = async (): Promise<VoiceSession> => {
  const res = await request<{ session_id: string; status: string }>('/voice/session/start', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    id: res.session_id,
    status: res.status === 'ended' ? 'ended' : 'active',
    messages: [],
  };
};

export const sendVoiceTurn = (sessionId: string, text: string) =>
  request<{ session_id: string; answer: string; confidence: number; citations: unknown[]; disclaimer: string }>(
    `/voice/session/${sessionId}/turn`,
    { method: 'POST', body: JSON.stringify({ utterance: text }) },
  );

export const endVoiceSession = (sessionId: string) =>
  request<{ session_id: string; status: string; summary?: string }>(
    `/voice/session/${sessionId}/end`,
    { method: 'POST', body: JSON.stringify({}) },
  );

