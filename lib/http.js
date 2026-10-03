const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...extraHeaders } });
}

export function error(status, message, extraHeaders) {
  return json({ error: message }, status, extraHeaders);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
