import { useEffect, useMemo, useState } from 'react';
import {
  HeartPulse,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { getMyProfile, getPlanMetadata, updateMyProfile } from '../../api/client';
import type { MetadataPlan, UserProfileUpdateRequest } from '../../types';

interface ProfileFormState {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  state: string;
  member_id: string;
  preferred_language: string;
  preferred_channel: 'web' | 'voice' | 'email';
  primary_plan_id: string;
  chronic_conditions: string[];
  medications: string[];
  notes: string;
}

function normalizeItem(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export default function Profile() {
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [plans, setPlans] = useState<MetadataPlan[]>([]);
  const [conditionInput, setConditionInput] = useState('');
  const [medicationInput, setMedicationInput] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [profileRes, planRes] = await Promise.all([getMyProfile(), getPlanMetadata()]);
        if (!mounted) return;
        setPlans(planRes.plans);
        setForm({
          user_id: profileRes.profile.user_id,
          full_name: profileRes.profile.full_name || '',
          email: profileRes.profile.email || '',
          phone: profileRes.profile.phone || '',
          date_of_birth: profileRes.profile.date_of_birth || '',
          state: profileRes.profile.state || '',
          member_id: profileRes.profile.member_id || '',
          preferred_language: profileRes.profile.preferred_language || '',
          preferred_channel: profileRes.profile.preferred_channel || 'web',
          primary_plan_id: profileRes.profile.primary_plan_id || '',
          chronic_conditions: profileRes.profile.chronic_conditions || [],
          medications: profileRes.profile.medications || [],
          notes: profileRes.profile.notes || '',
        });
      } catch {
        if (!mounted) return;
        setError('Unable to load profile details right now.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedPlan = useMemo(
    () => plans.find(plan => plan.plan_id === form?.primary_plan_id) || null,
    [form?.primary_plan_id, plans],
  );

  const updateField = <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => {
    setForm(prev => (prev ? { ...prev, [field]: value } : prev));
  };

  const addCondition = () => {
    const value = normalizeItem(conditionInput);
    if (!value || !form) return;
    if (form.chronic_conditions.some(item => item.toLowerCase() === value.toLowerCase())) {
      setConditionInput('');
      return;
    }
    updateField('chronic_conditions', [...form.chronic_conditions, value]);
    setConditionInput('');
  };

  const addMedication = () => {
    const value = normalizeItem(medicationInput);
    if (!value || !form) return;
    if (form.medications.some(item => item.toLowerCase() === value.toLowerCase())) {
      setMedicationInput('');
      return;
    }
    updateField('medications', [...form.medications, value]);
    setMedicationInput('');
  };

  const removeCondition = (index: number) => {
    if (!form) return;
    updateField(
      'chronic_conditions',
      form.chronic_conditions.filter((_, i) => i !== index),
    );
  };

  const removeMedication = (index: number) => {
    if (!form) return;
    updateField(
      'medications',
      form.medications.filter((_, i) => i !== index),
    );
  };

  const saveProfile = async () => {
    if (!form) return;
    setSaving(true);
    setError('');
    setSavedAt(null);

    const payload: UserProfileUpdateRequest = {
      full_name: normalizeItem(form.full_name) || null,
      email: normalizeItem(form.email) || null,
      phone: normalizeItem(form.phone) || null,
      date_of_birth: normalizeItem(form.date_of_birth) || null,
      state: normalizeItem(form.state) || null,
      member_id: normalizeItem(form.member_id) || null,
      preferred_language: normalizeItem(form.preferred_language) || null,
      preferred_channel: form.preferred_channel,
      primary_plan_id: normalizeItem(form.primary_plan_id) || null,
      chronic_conditions: form.chronic_conditions,
      medications: form.medications,
      notes: form.notes.trim() || null,
    };

    try {
      const result = await updateMyProfile(payload);
      setForm({
        user_id: result.profile.user_id,
        full_name: result.profile.full_name || '',
        email: result.profile.email || '',
        phone: result.profile.phone || '',
        date_of_birth: result.profile.date_of_birth || '',
        state: result.profile.state || '',
        member_id: result.profile.member_id || '',
        preferred_language: result.profile.preferred_language || '',
        preferred_channel: result.profile.preferred_channel || 'web',
        primary_plan_id: result.profile.primary_plan_id || '',
        chronic_conditions: result.profile.chronic_conditions || [],
        medications: result.profile.medications || [],
        notes: result.profile.notes || '',
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save profile changes.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="app-surface py-12 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
        <p className="mt-2 text-sm text-slate-600">Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="app-surface border-cyan-100/90 bg-gradient-to-r from-cyan-600 to-teal-600 p-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100">Personal Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold">Your Profile</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cyan-100">
          Each user keeps their own profile, plan context, and care preferences so responses stay relevant and personal.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="app-surface space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <UserRound className="h-5 w-5 text-blue-600" />
            Identity & Coverage Details
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
              <input
                value={form.full_name}
                onChange={event => updateField('full_name', event.target.value)}
                className="app-input"
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Email</label>
              <input
                value={form.email}
                onChange={event => updateField('email', event.target.value)}
                className="app-input"
                type="email"
                placeholder="name@example.com"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Phone</label>
              <input
                value={form.phone}
                onChange={event => updateField('phone', event.target.value)}
                className="app-input"
                placeholder="+1..."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Date of birth</label>
              <input
                value={form.date_of_birth}
                onChange={event => updateField('date_of_birth', event.target.value)}
                className="app-input"
                type="date"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">State</label>
              <input
                value={form.state}
                onChange={event => updateField('state', event.target.value)}
                className="app-input"
                placeholder="AZ, CA, NY..."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Member ID</label>
              <input
                value={form.member_id}
                onChange={event => updateField('member_id', event.target.value)}
                className="app-input"
                placeholder="Insurance member id"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Preferred language</label>
              <input
                value={form.preferred_language}
                onChange={event => updateField('preferred_language', event.target.value)}
                className="app-input"
                placeholder="English, Spanish..."
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Preferred channel</label>
              <select
                value={form.preferred_channel}
                onChange={event =>
                  updateField('preferred_channel', event.target.value as ProfileFormState['preferred_channel'])
                }
                className="app-input"
              >
                <option value="web">Web</option>
                <option value="voice">Voice</option>
                <option value="email">Email</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Primary plan</label>
            <select
              value={form.primary_plan_id}
              onChange={event => updateField('primary_plan_id', event.target.value)}
              className="app-input"
            >
              <option value="">Not selected</option>
              {plans.map(plan => (
                <option key={plan.plan_id} value={plan.plan_id}>
                  {plan.plan_name} - {plan.payer_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <section className="app-surface space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <HeartPulse className="h-4 w-4 text-blue-600" />
              Care Context
            </h3>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Chronic Conditions
              </label>
              <div className="flex gap-2">
                <input
                  value={conditionInput}
                  onChange={event => setConditionInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addCondition();
                    }
                  }}
                  className="app-input"
                  placeholder="Add condition"
                />
                <button onClick={addCondition} className="app-button-secondary shrink-0">
                  Add
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {form.chronic_conditions.map((item, index) => (
                  <span key={`${item}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {item}
                    <button onClick={() => removeCondition(index)} className="text-blue-700/80 hover:text-blue-900">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                Medications
              </label>
              <div className="flex gap-2">
                <input
                  value={medicationInput}
                  onChange={event => setMedicationInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addMedication();
                    }
                  }}
                  className="app-input"
                  placeholder="Add medication"
                />
                <button onClick={addMedication} className="app-button-secondary shrink-0">
                  Add
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {form.medications.map((item, index) => (
                  <span key={`${item}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    {item}
                    <button onClick={() => removeMedication(index)} className="text-emerald-700/80 hover:text-emerald-900">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="app-surface space-y-3 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
            <textarea
              value={form.notes}
              onChange={event => updateField('notes', event.target.value)}
              className="app-input min-h-[120px] resize-y"
              placeholder="Anything your care team should remember..."
            />
          </section>
        </div>
      </section>

      <section className="app-surface flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm text-slate-600">
          <p className="font-medium text-slate-800">Profile ID: {form.user_id}</p>
          <p className="mt-1">
            Primary plan: {selectedPlan ? `${selectedPlan.plan_name} (${selectedPlan.payer_name})` : 'Not selected'}
          </p>
          {savedAt && <p className="mt-1 text-emerald-700">Saved at {savedAt}</p>}
          {error && <p className="mt-1 text-red-700">{error}</p>}
        </div>

        <button onClick={() => void saveProfile()} disabled={saving} className="app-button-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </section>

      <section className="app-surface border-slate-200 bg-slate-50/70 p-4">
        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
          Profile data is scoped per authenticated user and used only for personalization inside CoverageAtlas.
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          Keep this updated for better plan guidance and timeline relevance.
        </p>
      </section>
    </div>
  );
}
