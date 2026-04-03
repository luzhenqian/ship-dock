const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      setAccessToken(data.accessToken);
      headers.Authorization = `Bearer ${data.accessToken}`;
      const retryRes = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
      if (!retryRes.ok) throw new Error(`API error: ${retryRes.status}`);
      return retryRes.json();
    }
    setAccessToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `API error: ${res.status}`);
  }

  return res.json();
}
