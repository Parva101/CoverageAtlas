import { useMemo, useState } from 'react';
import { ClipboardCheck, Copy, Download, FileText, Mail, Sparkles } from 'lucide-react';

type UrgencyLevel = 'standard' | 'urgent' | 'expedited';
type RequestType = 'medication' | 'procedure' | 'therapy' | 'diagnostic';

interface LetterFormState {
  patientName: string;
  memberId: string;
  payerName: string;
  planName: string;
  providerName: string;
  providerNpi: string;
  requestType: RequestType;
  serviceName: string;
  denialReason: string;
  denialDate: string;
  claimNumber: string;
  clinicalSummary: string;
  failedAlternatives: string;
  urgencyStatement: string;
  urgencyLevel: UrgencyLevel;
}

type AttachmentKey =
  | 'denial_notice'
  | 'clinical_notes'
  | 'lab_results'
  | 'guideline_citations'
  | 'medication_history'
  | 'provider_letter';

const REQUEST_LABELS: Record<RequestType, string> = {
  medication: 'Medication',
  procedure: 'Procedure',
  therapy: 'Therapy',
  diagnostic: 'Diagnostic service',
};

const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  standard: 'Standard appeal',
  urgent: 'Urgent review requested',
  expedited: 'Expedited review requested',
};

const ATTACHMENT_LABELS: Record<AttachmentKey, string> = {
  denial_notice: 'Denial notice copy',
  clinical_notes: 'Recent clinical notes',
  lab_results: 'Lab results or objective findings',
  guideline_citations: 'Guideline citations',
  medication_history: 'Medication / trial history',
  provider_letter: 'Provider specialist support letter',
};

function formatDate(date: string): string {
  if (!date) return '[Denial Date]';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function sanitizeForFilename(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'patient';
}

export default function AppealLetterBuilder() {
  const [form, setForm] = useState<LetterFormState>({
    patientName: 'Ari Patel',
    memberId: 'M-398117',
    payerName: 'Blue Cross Health',
    planName: 'PPO Plus Silver',
    providerName: 'Dr. Elena Morales',
    providerNpi: '1902457811',
    requestType: 'medication',
    serviceName: 'Semaglutide (Wegovy)',
    denialReason: 'Denied for insufficient demonstration of medical necessity.',
    denialDate: '',
    claimNumber: 'CLM-2026-00421',
    clinicalSummary:
      'Patient has obesity with associated metabolic risk and has completed supervised lifestyle intervention without adequate response.',
    failedAlternatives:
      'Failed alternatives include phentermine and intensive nutrition-only protocol; both had limited efficacy and adverse tolerability.',
    urgencyStatement:
      'Delay in therapy is likely to worsen cardiometabolic risk and increase downstream utilization.',
    urgencyLevel: 'urgent',
  });

  const [attachments, setAttachments] = useState<Record<AttachmentKey, boolean>>({
    denial_notice: true,
    clinical_notes: true,
    lab_results: false,
    guideline_citations: true,
    medication_history: true,
    provider_letter: false,
  });

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const selectedAttachments = useMemo(
    () =>
      (Object.entries(attachments) as Array<[AttachmentKey, boolean]>)
        .filter(([, enabled]) => enabled)
        .map(([key]) => ATTACHMENT_LABELS[key]),
    [attachments],
  );

  const letterText = useMemo(() => {
    const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const denialDate = formatDate(form.denialDate);

    return [
      `${today}`,
      '',
      'To: Appeals Department',
      `${form.payerName || '[Payer Name]'}`,
      '',
      `Re: ${URGENCY_LABELS[form.urgencyLevel]} - ${REQUEST_LABELS[form.requestType]} Appeal`,
      `Patient: ${form.patientName || '[Patient Name]'}`,
      `Member ID: ${form.memberId || '[Member ID]'}`,
      `Plan: ${form.planName || '[Plan Name]'}`,
      `Claim/Reference: ${form.claimNumber || '[Claim Number]'}`,
      '',
      'Dear Appeals Reviewer,',
      '',
      `I am submitting this appeal regarding the denial dated ${denialDate} for ${REQUEST_LABELS[form.requestType].toLowerCase()} request "${form.serviceName || '[Service Name]'}".`,
      `The denial reason provided was: "${form.denialReason || '[Denial Reason]'}".`,
      '',
      'Clinical Summary:',
      `${form.clinicalSummary || '[Insert concise clinical summary]'}`,
      '',
      'Prior Treatment / Alternatives:',
      `${form.failedAlternatives || '[Insert failed alternatives and outcomes]'}`,
      '',
      'Medical Necessity and Risk of Delay:',
      `${form.urgencyStatement || '[Insert urgency and harm-from-delay statement]'}`,
      '',
      `Attending Provider: ${form.providerName || '[Provider Name]'} (NPI: ${form.providerNpi || '[Provider NPI]'})`,
      '',
      'Attached Supporting Documents:',
      ...(selectedAttachments.length > 0
        ? selectedAttachments.map((item, index) => `${index + 1}. ${item}`)
        : ['1. [Add supporting documents]']),
      '',
      'Based on the enclosed clinical evidence and continuity-of-care concerns, I respectfully request reconsideration and approval.',
      '',
      'Sincerely,',
      `${form.providerName || '[Provider Name]'}`,
      `${form.patientName || '[Patient Name]'}`,
    ].join('\n');
  }, [form, selectedAttachments]);

  const copyLetter = async () => {
    try {
      await navigator.clipboard.writeText(letterText);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  const downloadLetter = () => {
    const blob = new Blob([letterText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `appeal-letter-${sanitizeForFilename(form.patientName)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="app-surface border-violet-200 bg-gradient-to-r from-violet-600 to-indigo-600 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-100">Narrative Automation</p>
        <h3 className="mt-1 text-xl font-semibold">Appeal Letter Builder</h3>
        <p className="mt-1 text-sm text-violet-100">
          Generate a payer-ready appeal draft with patient details, denial context, and attachment checklist.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="app-surface space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Patient Name
              </label>
              <input
                value={form.patientName}
                onChange={event => setForm(prev => ({ ...prev, patientName: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Member ID
              </label>
              <input
                value={form.memberId}
                onChange={event => setForm(prev => ({ ...prev, memberId: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Payer
              </label>
              <input
                value={form.payerName}
                onChange={event => setForm(prev => ({ ...prev, payerName: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Plan
              </label>
              <input
                value={form.planName}
                onChange={event => setForm(prev => ({ ...prev, planName: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Provider Name
              </label>
              <input
                value={form.providerName}
                onChange={event => setForm(prev => ({ ...prev, providerName: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Provider NPI
              </label>
              <input
                value={form.providerNpi}
                onChange={event => setForm(prev => ({ ...prev, providerNpi: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Request Type
              </label>
              <select
                value={form.requestType}
                onChange={event => setForm(prev => ({ ...prev, requestType: event.target.value as RequestType }))}
                className="app-input"
              >
                {Object.entries(REQUEST_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Urgency
              </label>
              <select
                value={form.urgencyLevel}
                onChange={event => setForm(prev => ({ ...prev, urgencyLevel: event.target.value as UrgencyLevel }))}
                className="app-input"
              >
                {Object.entries(URGENCY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Service / Medication Requested
              </label>
              <input
                value={form.serviceName}
                onChange={event => setForm(prev => ({ ...prev, serviceName: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Denial Date
              </label>
              <input
                type="date"
                value={form.denialDate}
                onChange={event => setForm(prev => ({ ...prev, denialDate: event.target.value }))}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Claim / Reference Number
              </label>
              <input
                value={form.claimNumber}
                onChange={event => setForm(prev => ({ ...prev, claimNumber: event.target.value }))}
                className="app-input"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Denial Reason
              </label>
              <textarea
                value={form.denialReason}
                onChange={event => setForm(prev => ({ ...prev, denialReason: event.target.value }))}
                className="app-input min-h-[80px] resize-y"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Clinical Summary
              </label>
              <textarea
                value={form.clinicalSummary}
                onChange={event => setForm(prev => ({ ...prev, clinicalSummary: event.target.value }))}
                className="app-input min-h-[100px] resize-y"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Failed Alternatives
              </label>
              <textarea
                value={form.failedAlternatives}
                onChange={event => setForm(prev => ({ ...prev, failedAlternatives: event.target.value }))}
                className="app-input min-h-[90px] resize-y"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Urgency / Harm-from-delay Statement
              </label>
              <textarea
                value={form.urgencyStatement}
                onChange={event => setForm(prev => ({ ...prev, urgencyStatement: event.target.value }))}
                className="app-input min-h-[90px] resize-y"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Attachments</p>
            <div className="grid gap-2 md:grid-cols-2">
              {(Object.keys(ATTACHMENT_LABELS) as AttachmentKey[]).map(key => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    attachments[key]
                      ? 'border-violet-200 bg-violet-50/70 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={attachments[key]}
                    onChange={event => setAttachments(prev => ({ ...prev, [key]: event.target.checked }))}
                    className="accent-violet-600"
                  />
                  <span>{ATTACHMENT_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="app-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-slate-500">
                <FileText className="h-4 w-4 text-violet-600" />
                Generated Draft
              </h4>
              <div className="flex gap-2">
                <button onClick={() => void copyLetter()} className="app-button-secondary text-xs">
                  {copyStatus === 'copied' ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copyStatus === 'copied' ? 'Copied' : 'Copy'}
                </button>
                <button onClick={downloadLetter} className="app-button-secondary text-xs">
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </div>
            {copyStatus === 'failed' && (
              <p className="mt-2 text-xs text-amber-700">Clipboard access failed. Use Download instead.</p>
            )}
            <textarea
              value={letterText}
              readOnly
              className="mt-3 min-h-[520px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700"
            />
          </div>

          <div className="app-surface border-emerald-200 bg-emerald-50/80 p-4 text-xs text-emerald-900">
            <p className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-emerald-700" />
              Ready to share with provider ops for review and submission.
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
              Pair with Next Best Access to choose the strongest escalation path.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
