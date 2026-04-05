import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react';
import { getPlanMetadata } from '../../../api/client';
import type { MetadataPlan } from '../../../types';

interface SimulatorInputs {
  currentPlanId: string;
  targetPlanId: string;
  monthlyPremiumCurrent: number;
  monthlyPremiumTarget: number;
  deductibleCurrent: number;
  deductibleTarget: number;
  coinsuranceCurrentPct: number;
  coinsuranceTargetPct: number;
  oopMaxCurrent: number;
  oopMaxTarget: number;
  expectedMedicalSpend: number;
  specialtyMedicationMonthlyCost: number;
  specialtyCoverageCurrentPct: number;
  specialtyCoverageTargetPct: number;
  networkDisruptionRiskPct: number;
}

interface PlanCostBreakdown {
  annualPremium: number;
  outOfPocketMedical: number;
  specialtyAnnualPatientShare: number;
  totalAnnualCost: number;
}

const FALLBACK_PLANS: MetadataPlan[] = [
  {
    plan_id: 'mock-plan-a',
    payer_id: 'mock-payer-a',
    payer_name: 'Blue Cross',
    plan_name: 'Blue Cross PPO Plus',
    plan_type: 'PPO',
    market: 'Individual',
    is_virtual: true,
  },
  {
    plan_id: 'mock-plan-b',
    payer_id: 'mock-payer-b',
    payer_name: 'Aetna',
    plan_name: 'Aetna Open Access',
    plan_type: 'EPO',
    market: 'Individual',
    is_virtual: true,
  },
];

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculatePlanCost(input: {
  monthlyPremium: number;
  deductible: number;
  coinsurancePct: number;
  oopMax: number;
  expectedMedicalSpend: number;
  specialtyMedicationMonthlyCost: number;
  specialtyCoveragePct: number;
}): PlanCostBreakdown {
  const annualPremium = input.monthlyPremium * 12;
  const medicalAfterDeductible = Math.max(input.expectedMedicalSpend - input.deductible, 0);
  const coinsuranceAmount = medicalAfterDeductible * (input.coinsurancePct / 100);
  const outOfPocketMedical = Math.min(input.deductible + coinsuranceAmount, input.oopMax);

  const annualSpecialtyTotal = input.specialtyMedicationMonthlyCost * 12;
  const specialtyAnnualPatientShare = annualSpecialtyTotal * (1 - input.specialtyCoveragePct / 100);

  const nonPremiumCost = Math.min(outOfPocketMedical + specialtyAnnualPatientShare, input.oopMax);
  const totalAnnualCost = annualPremium + nonPremiumCost;

  return {
    annualPremium,
    outOfPocketMedical: nonPremiumCost,
    specialtyAnnualPatientShare,
    totalAnnualCost,
  };
}

export default function PlanSwitchSimulator() {
  const [plans, setPlans] = useState<MetadataPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [metadataError, setMetadataError] = useState('');

  const [inputs, setInputs] = useState<SimulatorInputs>({
    currentPlanId: '',
    targetPlanId: '',
    monthlyPremiumCurrent: 420,
    monthlyPremiumTarget: 365,
    deductibleCurrent: 1400,
    deductibleTarget: 2200,
    coinsuranceCurrentPct: 20,
    coinsuranceTargetPct: 30,
    oopMaxCurrent: 9000,
    oopMaxTarget: 7500,
    expectedMedicalSpend: 12000,
    specialtyMedicationMonthlyCost: 550,
    specialtyCoverageCurrentPct: 75,
    specialtyCoverageTargetPct: 60,
    networkDisruptionRiskPct: 25,
  });

  useEffect(() => {
    let mounted = true;
    const loadPlans = async () => {
      setLoadingPlans(true);
      setMetadataError('');
      try {
        const metadata = await getPlanMetadata();
        if (!mounted) return;
        const available = metadata.plans.length > 1 ? metadata.plans : FALLBACK_PLANS;
        setPlans(available);
      } catch {
        if (!mounted) return;
        setMetadataError('Using local sample plans because metadata is unavailable.');
        setPlans(FALLBACK_PLANS);
      } finally {
        if (mounted) setLoadingPlans(false);
      }
    };
    void loadPlans();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (plans.length === 0) return;
    setInputs(prev => {
      const currentPlanId = prev.currentPlanId || plans[0].plan_id;
      const targetFallback = plans.find(plan => plan.plan_id !== currentPlanId)?.plan_id || plans[0].plan_id;
      const targetPlanId = prev.targetPlanId || targetFallback;
      return { ...prev, currentPlanId, targetPlanId };
    });
  }, [plans]);

  const updateNumber = (key: keyof SimulatorInputs, value: string, min = 0, max = 999999) => {
    const parsed = Number(value);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : min;
    setInputs(prev => ({ ...prev, [key]: next }));
  };

  const updatePlanIds = (key: 'currentPlanId' | 'targetPlanId', value: string) => {
    setInputs(prev => ({ ...prev, [key]: value }));
  };

  const currentBreakdown = useMemo(
    () =>
      calculatePlanCost({
        monthlyPremium: inputs.monthlyPremiumCurrent,
        deductible: inputs.deductibleCurrent,
        coinsurancePct: inputs.coinsuranceCurrentPct,
        oopMax: inputs.oopMaxCurrent,
        expectedMedicalSpend: inputs.expectedMedicalSpend,
        specialtyMedicationMonthlyCost: inputs.specialtyMedicationMonthlyCost,
        specialtyCoveragePct: inputs.specialtyCoverageCurrentPct,
      }),
    [inputs],
  );

  const targetBreakdown = useMemo(
    () =>
      calculatePlanCost({
        monthlyPremium: inputs.monthlyPremiumTarget,
        deductible: inputs.deductibleTarget,
        coinsurancePct: inputs.coinsuranceTargetPct,
        oopMax: inputs.oopMaxTarget,
        expectedMedicalSpend: inputs.expectedMedicalSpend,
        specialtyMedicationMonthlyCost: inputs.specialtyMedicationMonthlyCost,
        specialtyCoveragePct: inputs.specialtyCoverageTargetPct,
      }),
    [inputs],
  );

  const financialDelta = targetBreakdown.totalAnnualCost - currentBreakdown.totalAnnualCost;
  const riskPenalty = inputs.networkDisruptionRiskPct * 30;
  const adjustedDelta = financialDelta + riskPenalty;
  const recommendation =
    adjustedDelta < -400
      ? 'Switch likely saves money even after accounting for disruption risk.'
      : adjustedDelta > 400
        ? 'Switch may increase annual cost; validate clinical and network reasons first.'
        : 'Costs are close. Use coverage quality and provider network fit as decision drivers.';

  const currentPlan = plans.find(plan => plan.plan_id === inputs.currentPlanId);
  const targetPlan = plans.find(plan => plan.plan_id === inputs.targetPlanId);

  return (
    <div className="space-y-4">
      <div className="app-surface border-indigo-200 bg-gradient-to-r from-indigo-600 to-blue-600 p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-100">Financial Planning</p>
        <h3 className="mt-1 text-xl font-semibold">Plan Switch Simulator</h3>
        <p className="mt-1 text-sm text-indigo-100">
          Estimate annual cost impact before switching plans by combining premium, deductible, and medication exposure.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="app-surface space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Current plan</label>
              <select
                value={inputs.currentPlanId}
                onChange={event => updatePlanIds('currentPlanId', event.target.value)}
                className="app-input"
                disabled={loadingPlans}
              >
                {plans.map(plan => (
                  <option key={plan.plan_id} value={plan.plan_id}>
                    {plan.plan_name} - {plan.payer_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Target plan</label>
              <select
                value={inputs.targetPlanId}
                onChange={event => updatePlanIds('targetPlanId', event.target.value)}
                className="app-input"
                disabled={loadingPlans}
              >
                {plans.map(plan => (
                  <option key={plan.plan_id} value={plan.plan_id}>
                    {plan.plan_name} - {plan.payer_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loadingPlans && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading plan options...
            </p>
          )}
          {metadataError && <p className="text-xs text-amber-700">{metadataError}</p>}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Current monthly premium
              </label>
              <input
                type="number"
                value={inputs.monthlyPremiumCurrent}
                onChange={event => updateNumber('monthlyPremiumCurrent', event.target.value, 0, 2000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Target monthly premium
              </label>
              <input
                type="number"
                value={inputs.monthlyPremiumTarget}
                onChange={event => updateNumber('monthlyPremiumTarget', event.target.value, 0, 2000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Current deductible
              </label>
              <input
                type="number"
                value={inputs.deductibleCurrent}
                onChange={event => updateNumber('deductibleCurrent', event.target.value, 0, 20000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Target deductible
              </label>
              <input
                type="number"
                value={inputs.deductibleTarget}
                onChange={event => updateNumber('deductibleTarget', event.target.value, 0, 20000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Current coinsurance %
              </label>
              <input
                type="number"
                value={inputs.coinsuranceCurrentPct}
                onChange={event => updateNumber('coinsuranceCurrentPct', event.target.value, 0, 100)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Target coinsurance %
              </label>
              <input
                type="number"
                value={inputs.coinsuranceTargetPct}
                onChange={event => updateNumber('coinsuranceTargetPct', event.target.value, 0, 100)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Current out-of-pocket max
              </label>
              <input
                type="number"
                value={inputs.oopMaxCurrent}
                onChange={event => updateNumber('oopMaxCurrent', event.target.value, 0, 50000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Target out-of-pocket max
              </label>
              <input
                type="number"
                value={inputs.oopMaxTarget}
                onChange={event => updateNumber('oopMaxTarget', event.target.value, 0, 50000)}
                className="app-input"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Expected annual medical spend
              </label>
              <input
                type="number"
                value={inputs.expectedMedicalSpend}
                onChange={event => updateNumber('expectedMedicalSpend', event.target.value, 0, 150000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Specialty medication monthly list cost
              </label>
              <input
                type="number"
                value={inputs.specialtyMedicationMonthlyCost}
                onChange={event => updateNumber('specialtyMedicationMonthlyCost', event.target.value, 0, 10000)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Current specialty coverage %
              </label>
              <input
                type="number"
                value={inputs.specialtyCoverageCurrentPct}
                onChange={event => updateNumber('specialtyCoverageCurrentPct', event.target.value, 0, 100)}
                className="app-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Target specialty coverage %
              </label>
              <input
                type="number"
                value={inputs.specialtyCoverageTargetPct}
                onChange={event => updateNumber('specialtyCoverageTargetPct', event.target.value, 0, 100)}
                className="app-input"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
              <span>Network disruption risk</span>
              <span>{inputs.networkDisruptionRiskPct}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={inputs.networkDisruptionRiskPct}
              onChange={event => updateNumber('networkDisruptionRiskPct', event.target.value, 0, 100)}
              className="w-full accent-indigo-600"
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="app-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Cost Snapshot</p>
            <div className="mt-3 grid gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Current annual total</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">{currency(currentBreakdown.totalAnnualCost)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Target annual total</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">{currency(targetBreakdown.totalAnnualCost)}</p>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Net annual change (target - current)</p>
              <p
                className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${
                  financialDelta < 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {financialDelta < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                {currency(financialDelta)}
              </p>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Risk-adjusted delta</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{currency(adjustedDelta)}</p>
              <p className="mt-1 text-xs text-slate-500">includes network disruption penalty</p>
            </div>
          </div>

          <div className="app-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Recommendation</p>
            <div className="mt-2 flex items-start gap-2 text-sm text-slate-700">
              <ArrowRightLeft className="mt-0.5 h-4 w-4 text-indigo-600" />
              <p>{recommendation}</p>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              <p>Current: {currentPlan ? `${currentPlan.plan_name} (${currentPlan.payer_name})` : 'Not selected'}</p>
              <p className="mt-1">
                Target: {targetPlan ? `${targetPlan.plan_name} (${targetPlan.payer_name})` : 'Not selected'}
              </p>
            </div>
          </div>

          <div className="app-surface border-amber-200 bg-amber-50/80 p-4">
            <p className="flex items-center gap-1.5 text-xs text-amber-900">
              <PiggyBank className="h-3.5 w-3.5 text-amber-700" />
              Simulation is for planning only and does not replace official plan documents or broker advice.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
