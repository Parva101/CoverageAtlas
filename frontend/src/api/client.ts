import type {
  QueryRequest,
  QueryResponse,
  CompareRequest,
  CompareResponse,
  PolicyChange,
  DocumentStatus,
  Payer,
  VoiceSession,
} from '../types';

const BASE = '/api';

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

// ── Payers ──
export const listPayers = () => request<Payer[]>('/payers');

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
export const getPolicyChanges = (policyId: string) =>
  request<PolicyChange[]>(`/policies/${policyId}/changes`);

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
export const triggerScan = () =>
  request<{ job_id: string; message: string }>('/sources/scan', {
    method: 'POST',
  });

// ── Voice ──
export const startVoiceSession = () =>
  request<VoiceSession>('/voice/session/start', { method: 'POST' });

export const sendVoiceTurn = (sessionId: string, text: string) =>
  request<{ answer: string; citations: unknown[] }>(
    `/voice/session/${sessionId}/turn`,
    { method: 'POST', body: JSON.stringify({ text }) },
  );

export const endVoiceSession = (sessionId: string) =>
  request<VoiceSession>(`/voice/session/${sessionId}/end`, { method: 'POST' });
