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
    err.body = body;
    throw err;
  }
  return body;
}

export function loadPortfolio() {
  return request('/api/portfolio');
}

export function savePortfolio(portfolio, expectedUpdatedAt, force = false) {
  // expectedUpdatedAt is the token from the last load/save (string, or null if
  // the portfolio was empty). Sending it engages the server's OCC guard; force
  // overrides it for an explicit overwrite.
  const payload = { ...portfolio, expectedUpdatedAt };
  if (force) payload.force = true;
  return request('/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
