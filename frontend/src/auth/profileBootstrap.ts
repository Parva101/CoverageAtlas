export interface Auth0ProfileBootstrap {
  fullName: string;
  email: string;
  phone: string;
}

const STORAGE_KEY = 'coverageatlas_auth0_profile';

interface Auth0UserLike {
  name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  nickname?: string | null;
  email?: string | null;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim();
}

function deriveFullName(user: Auth0UserLike | null | undefined): string {
  if (!user) return '';

  const name = normalize(user.name);
  if (name) return name;

  const given = normalize(user.given_name);
  const family = normalize(user.family_name);
  const combined = `${given} ${family}`.trim();
  if (combined) return combined;

  return normalize(user.nickname);
}

export function clearAuth0ProfileBootstrap(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function readAuth0ProfileBootstrap(): Auth0ProfileBootstrap | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Auth0ProfileBootstrap>;
    const fullName = normalize(parsed.fullName);
    const email = normalize(parsed.email);
    const phone = normalize(parsed.phone);
    if (!fullName && !email && !phone) return null;
    return { fullName, email, phone };
  } catch {
    return null;
  }
}

function persistBootstrap(data: Auth0ProfileBootstrap): void {
  if (typeof window === 'undefined') return;
  if (!data.fullName && !data.email && !data.phone) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function saveSignupProfileBootstrap(
  data: Pick<Auth0ProfileBootstrap, 'fullName' | 'phone'>,
): void {
  const existing = readAuth0ProfileBootstrap() || { fullName: '', email: '', phone: '' };
  const incomingFullName = normalize(data.fullName);
  const incomingPhone = normalize(data.phone);
  persistBootstrap({
    fullName: incomingFullName || existing.fullName,
    email: existing.email,
    phone: incomingPhone || existing.phone,
  });
}

export function saveAuth0ProfileBootstrap(user: Auth0UserLike | null | undefined): void {
  const existing = readAuth0ProfileBootstrap() || { fullName: '', email: '', phone: '' };
  const fullName = deriveFullName(user) || existing.fullName;
  const email = normalize(user?.email) || existing.email;
  persistBootstrap({
    fullName: normalize(fullName),
    email: normalize(email),
    phone: existing.phone,
  });
}
