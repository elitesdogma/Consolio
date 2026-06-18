/* Thin client over the server API. Each call returns parsed JSON or throws
   an Error carrying the server's message so the UI can surface it. */

async function request(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

export function loadPortfolio() {
  return request('/api/portfolio');
}

export function savePortfolio(portfolio) {
  return request('/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(portfolio),
  });
}

export function fetchQuotes(tickers) {
  if (tickers.length === 0) return Promise.resolve({ quotes: {}, errors: {} });
  return request('/api/quotes?symbols=' + encodeURIComponent(tickers.join(',')));
}

export function fetchFx(base, quote) {
  return request(`/api/fx?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}`);
}

export function fetchSparks(tickers) {
  if (tickers.length === 0) return Promise.resolve({ sparks: {} });
  return request('/api/sparks?symbols=' + encodeURIComponent(tickers.join(',')));
}
