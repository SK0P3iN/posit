const bffUrl =
  import.meta.env.VITE_SAAS_BFF_URL ||
  import.meta.env.SAAS_BFF_URL ||
  'http://localhost:3010';

export const SAAS_BFF_URL = bffUrl.replace(/\/$/, '');

export async function bffFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${SAAS_BFF_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}
