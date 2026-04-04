// API request/response types matching docs/06-api-contract.md

export type CoverageStatus = 'covered' | 'restricted' | 'not_covered' | 'unknown';
export type PayerType = 'commercial' | 'medicare' | 'medicaid' | 'other';
export type PolicyCategory = 'medical_benefit' | 'pharmacy_benefit' | 'general_um';
export type ChangeType = 'added' | 'removed' | 'modified';
export type Channel = 'web' | 'voice';

export interface Citation {
  document_id: string | null;
  page: number | null;
  section: string | null;
  snippet: string;
}

// POST /query
export interface QueryRequest {
  question: string;
  filters?: {
    payer_ids?: string[];
    plan_ids?: string[];
    policy_categories?: PolicyCategory[];
    version_labels?: string[];
    coverage_statuses?: CoverageStatus[];
    policy_version_ids?: string[];
    effective_on?: string;
  };
  retrieval?: {
    top_k?: number;
    hybrid?: boolean;
  };
}

export interface QueryResponse {
  answer: string;
  confidence: number;
  citations: Citation[];
  retrieval_trace: {
    chunks_used: number;
    vector_store: string;
    applied_filters?: {
      plan_ids?: string[];
      payer_ids?: string[];
      policy_categories?: string[];
      version_labels?: string[];
      coverage_statuses?: string[];
      policy_version_ids_count?: number;
      effective_on?: string | null;
    };
  };
  disclaimer: string;
}

// POST /compare
export interface CompareRequest {
  drug_name: string;
  plan_ids: string[];
  effective_on?: string;
}

export interface CompareRow {
  plan_id: string;
  coverage_status: CoverageStatus;
  prior_auth_required: boolean | null;
  step_therapy_required: boolean | null;
  criteria_summary: string[];
  citations: Citation[];
}

export interface CompareResponse {
  drug_name: string;
  rows: CompareRow[];
}

// GET /policies/{id}/changes
export interface PolicyChange {
  id: string;
  policy_id: string;
  from_version_id: string | null;
  to_version_id: string;
  change_type: ChangeType;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  citations: Citation[];
  detected_at: string;
  from_version?: string;
  to_version?: string;
}

// GET /metadata/plans
export interface MetadataPayer {
  payer_id: string;
  name: string;
  payer_type: PayerType;
  region: string | null;
}

export interface MetadataPlan {
  plan_id: string;
  payer_id: string;
  payer_name: string;
  plan_name: string;
  plan_type: string | null;
  market: string | null;
  is_virtual?: boolean;
}

export interface PlanMetadataResponse {
  payers: MetadataPayer[];
  plans: MetadataPlan[];
}

// POST /documents/upload
export interface DocumentStatus {
  id?: string;
  document_id?: string;
  file_name?: string;
  file_type?: string;
  ingestion_status: 'queued' | 'processing' | 'completed' | 'failed';
  ingestion_error?: string | null;
  ingested_at?: string | null;
  created_at?: string;
  current_step?: string;
}

// Voice session
export interface VoiceSession {
  id: string;
  status: 'active' | 'ended';
  messages: VoiceMessage[];
  summary?: string;
}

export interface VoiceMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

