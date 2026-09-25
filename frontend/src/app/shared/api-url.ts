import { environment } from '../../environments/environment';

/** Compare parsed origins and path boundaries before attaching credentials. */
export function isApiUrl(url: string, baseUrl = environment.apiBaseUrl, origin = window.location.origin): boolean {
  try {
    const base = new URL(baseUrl, origin);
    const target = new URL(url, origin);
    const path = base.pathname.replace(/\/$/, '');
    return target.origin === base.origin && (target.pathname === path || target.pathname.startsWith(`${path}/`));
  } catch {
    return false;
  }
}

export function productImageUrl(path: string): string {
  if (!/^\/uploads\/[A-Za-z0-9_.-]+$/.test(path)) return '';
  return `${environment.apiBaseUrl.replace(/\/api\/v1\/?$/, '')}${path}`;
}
