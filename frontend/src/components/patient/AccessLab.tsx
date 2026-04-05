import { useState } from 'react';
import { FlaskConical, Layers3, Radar, Sparkles, Wand2 } from 'lucide-react';
import PlanSwitchSimulator from './access/PlanSwitchSimulator';
import NextBestAccess from './access/NextBestAccess';
import DenialRiskMeter from './access/DenialRiskMeter';
import AppealLetterBuilder from './access/AppealLetterBuilder';

type LabTabId = 'plan-switch' | 'next-best' | 'risk-meter' | 'appeal-letter';

const TABS: Array<{
  id: LabTabId;
  label: string;
  subtitle: string;
  tone: string;
}> = [
  {
    id: 'plan-switch',
    label: 'Plan Switch Simulator',
    subtitle: 'Model annual cost and disruption risk before switching.',
    tone: 'from-indigo-500 to-blue-500',
  },
  {
    id: 'next-best',
    label: 'Next Best Access',
    subtitle: 'Rank denial response pathways by readiness and ETA.',
    tone: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'risk-meter',
    label: 'Denial Risk Meter',
    subtitle: 'Estimate denial friction and test mitigation impact.',
    tone: 'from-rose-500 to-orange-500',
  },
  {
    id: 'appeal-letter',
    label: 'Appeal Letter Builder',
    subtitle: 'Generate payer-ready appeal draft with supporting checklist.',
    tone: 'from-violet-500 to-indigo-500',
  },
];

export default function AccessLab() {
  const [activeTab, setActiveTab] = useState<LabTabId>('plan-switch');
  const active = TABS.find(tab => tab.id === activeTab) || TABS[0];

  return (
    <div className="space-y-6">
      <section className="app-page-hero">
        <div className="app-page-hero-content grid gap-4 md:grid-cols-[1.6fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-100">Action Studio</p>
            <h1 className="mt-2 text-3xl font-semibold">Access Lab</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-sky-100">
              A frontend simulation workspace for advanced access planning. Use it to test plan switches, triage denials, and draft structured appeals.
            </p>
            <div className="app-page-hero-chip mt-5 inline-flex items-center gap-2">
              <Wand2 className="h-3.5 w-3.5 text-cyan-100" />
              Active module: {active.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="app-page-hero-stat">
              <p className="text-xs text-sky-100">Modules</p>
              <p className="mt-1 flex items-center gap-1.5 text-xl font-semibold">
                <FlaskConical className="h-4 w-4 text-cyan-100" />
                4
              </p>
            </div>
            <div className="app-page-hero-stat">
              <p className="text-xs text-sky-100">Mode</p>
              <p className="mt-1 text-sm font-semibold">Simulation Ready</p>
            </div>
            <div className="app-page-hero-stat col-span-2 text-sky-100">
              Designed for fast demo iteration now, with backend API hooks planned for real-time execution.
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
              className={`group rounded-2xl border p-3 text-left transition duration-200 ${
                activeTab === tab.id
                  ? 'border-cyan-300/70 bg-gradient-to-br from-cyan-50 to-blue-50 shadow-[0_12px_30px_-20px_rgba(14,165,233,0.75)]'
                  : 'border-slate-200/90 bg-white/90 hover:border-cyan-200 hover:bg-cyan-50/50'
              }`}
            >
              <span className={`mb-2 inline-flex h-1.5 w-14 rounded-full bg-gradient-to-r ${tab.tone}`} />
              <p className="text-sm font-semibold text-slate-900">{tab.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{tab.subtitle}</p>
              <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-slate-500 group-hover:text-cyan-700">
                <Radar className="h-3.5 w-3.5" />
                {activeTab === tab.id ? 'Selected' : 'Tap to open'}
              </div>
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
