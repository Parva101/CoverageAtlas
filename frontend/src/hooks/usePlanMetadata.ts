import { useEffect, useRef, useState } from 'react';
import { getPlanMetadata } from '../api/client';
import type { MetadataPayer, MetadataPlan } from '../types';

interface PlanMetadataState {
  payers: MetadataPayer[];
  plans: MetadataPlan[];
  loading: boolean;
  error: string;
}

let cachedPayers: MetadataPayer[] | null = null;
let cachedPlans: MetadataPlan[] | null = null;
let inflight: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function notifyAll() {
  subscribers.forEach(fn => fn());
}

function fetchIfNeeded(): Promise<void> {
  if (cachedPayers !== null) return Promise.resolve();
  if (inflight) return inflight;

  inflight = getPlanMetadata()
    .then(res => {
      cachedPayers = res.payers;
      cachedPlans = res.plans;
      notifyAll();
    })
    .catch(() => {
      cachedPayers = [];
      cachedPlans = [];
      notifyAll();
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function usePlanMetadata(): PlanMetadataState {
  const [, forceRender] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const rerender = () => {
      if (mountedRef.current) forceRender(n => n + 1);
    };

    subscribers.add(rerender);
    void fetchIfNeeded();

    return () => {
      mountedRef.current = false;
      subscribers.delete(rerender);
    };
  }, []);

  if (cachedPayers !== null && cachedPlans !== null) {
    return {
      payers: cachedPayers,
      plans: cachedPlans,
      loading: false,
      error: cachedPayers.length === 0 && cachedPlans.length === 0
        ? 'Unable to load plan list right now.'
        : '',
    };
  }

  return { payers: [], plans: [], loading: true, error: '' };
}
