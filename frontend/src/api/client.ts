import type {
  QueryRequest,
  QueryResponse,
  CompareRequest,
  CompareResponse,
  PolicyChange,
  DocumentStatus,
  VoiceSession,
} from '../types';

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// ── Health ──
export const getHealth = () => request<{ status: string }>('/health');

// ── Query (Q&A) ──
export const postQuery = (body: QueryRequest) =>
  request<QueryResponse>('/query', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ── Compare ──
export const postCompare = (body: CompareRequest) =>
  request<CompareResponse>('/compare', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ── Policy Changes ──
export const getPolicyChanges = (policyId: string, from: string, to: string) =>
  request<{ policy_id: string; from_version: string; to_version: string; changes: PolicyChange[] }>(
    `/policies/${policyId}/changes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

// ── Documents ──
export const uploadDocument = async (
  file: File,
  payerId: string,
  policyTitle: string,
): Promise<DocumentStatus> => {
  const form = new FormData();
  form.append('file', file);
  form.append('payer_id', payerId);
  form.append('policy_title', policyTitle);

  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
};

export const getDocumentStatus = (docId: string) =>
  request<DocumentStatus>(`/documents/${docId}/status`);

// ── Source Scan ──
export const triggerScan = (sourceGroup = 'default') =>
  request<{ scan_id: string; status: string }>('/sources/scan', {
    method: 'POST',
    body: JSON.stringify({ source_group: sourceGroup }),
  });

// ── Voice ──
// Backend returns { session_id, status } — we normalize to { id, status }
export const startVoiceSession = async (): Promise<VoiceSession> => {
  const res = await request<{ session_id: string; status: string }>(
    '/voice/session/start',
    { method: 'POST', body: JSON.stringify({}) },
  );
  return { id: res.session_id, status: res.status as 'active' | 'ended', messages: [] };
};

// Backend expects { utterance } not { text }
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
