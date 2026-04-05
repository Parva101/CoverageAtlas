import { useState } from 'react';
import { FlaskConical, Layers3, Sparkles } from 'lucide-react';
import PlanSwitchSimulator from './access/PlanSwitchSimulator';
import NextBestAccess from './access/NextBestAccess';
import DenialRiskMeter from './access/DenialRiskMeter';
import AppealLetterBuilder from './access/AppealLetterBuilder';

type LabTabId = 'plan-switch' | 'next-best' | 'risk-meter' | 'appeal-letter';

const TABS: Array<{
  id: LabTabId;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'plan-switch',
    label: 'Plan Switch Simulator',
    subtitle: 'Model annual cost and disruption risk before switching.',
  },
  {
    id: 'next-best',
    label: 'Next Best Access',
    subtitle: 'Rank denial response pathways by readiness and ETA.',
  },
  {
    id: 'risk-meter',
    label: 'Denial Risk Meter',
    subtitle: 'Estimate denial friction and test mitigation impact.',
  },
  {
    id: 'appeal-letter',
    label: 'Appeal Letter Builder',
    subtitle: 'Generate payer-ready appeal draft with supporting checklist.',
  },
];

export default function AccessLab() {
  const [activeTab, setActiveTab] = useState<LabTabId>('plan-switch');

  return (
    <div className="space-y-6">
      <section className="app-surface relative overflow-hidden border-indigo-100/90 bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-7 text-white">
        <div className="absolute -right-8 top-0 h-28 w-28 rounded-full bg-white/20" />
        <div className="absolute -bottom-10 left-1/3 h-24 w-24 rounded-full bg-cyan-300/20" />
        <div className="relative grid gap-4 md:grid-cols-[1.6fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-100">Action Studio</p>
            <h1 className="mt-2 text-3xl font-semibold">Access Lab</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100">
              A frontend simulation workspace for advanced access planning. Use it to test plan switches, triage denials, and draft structured appeals.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-xs text-indigo-100">Modules</p>
              <p className="mt-1 text-xl font-semibold">4</p>
            </div>
            <div className="rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-xs text-indigo-100">Mode</p>
              <p className="mt-1 text-sm font-semibold">Frontend Only</p>
            </div>
            <div className="col-span-2 rounded-xl border border-white/25 bg-white/10 p-3 text-xs text-indigo-100">
              Designed for quick iteration while backend agents and services are being finalized.
            </div>
          </div>
        </div>
      </section>

      <section className="app-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <FlaskConical className="h-5 w-5 text-indigo-600" />
            Access Workflow Modules
          </h2>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            Select a module to start
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-2xl border p-3 text-left transition ${
                activeTab === tab.id
                  ? 'border-indigo-300 bg-indigo-50/80 shadow-[0_10px_24px_-18px_rgba(79,70,229,0.8)]'
                  : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40'
              }`}
            >
              <p className="text-sm font-semibold text-slate-900">{tab.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{tab.subtitle}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="animate-fade-up">
        {activeTab === 'plan-switch' && <PlanSwitchSimulator />}
        {activeTab === 'next-best' && <NextBestAccess />}
        {activeTab === 'risk-meter' && <DenialRiskMeter />}
        {activeTab === 'appeal-letter' && <AppealLetterBuilder />}
      </section>

      <section className="app-surface border-slate-200 bg-slate-50/80 p-4">
        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <Layers3 className="h-3.5 w-3.5 text-indigo-600" />
          Integration note: all modules currently run local UI logic only and are ready for backend API wiring later.
        </p>
      </section>
    </div>
  );
}
