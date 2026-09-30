const { URL } = require('url');

const COLLINFO = 'https://index.commoncrawl.org/collinfo.json';

function normalizeTarget(target) {
  let value = String(target || '').trim();
  if (!value) throw new Error('Enter a domain or URL.');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const u = new URL(value);
  if (!u.hostname.includes('.')) throw new Error('Enter a valid domain or URL.');
  return u;
}

async function fetchText(url, timeoutMs = 20000, onBytes = () => {}, externalSignal = null) {
  const controller = new AbortController();
  const abortFromOutside = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromOutside, { once:true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ZaxisWorker/1.0 (+local web intelligence)' } });
    const text = await res.text();
    onBytes(Buffer.byteLength(text));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0,180)}`);
    return text;
  } finally { clearTimeout(timer); if (externalSignal) externalSignal.removeEventListener('abort', abortFromOutside); }
}

async function getCollections(onBytes, signal = null) {
  const raw = await fetchText(COLLINFO, 20000, onBytes, signal);
  const list = JSON.parse(raw);
  return list.map(x => ({ id: x.id, name: x.name, index: x['cdx-api'], timegate: x.timegate })).filter(x => x.id && x.index);
}

async function resolveCollection(dataset, onBytes, signal = null) {
  const collections = await getCollections(onBytes, signal);
  if (!collections.length) throw new Error('Common Crawl returned no collections.');
  if (!dataset || dataset === 'latest') return collections[0];
  return collections.find(c => c.id === dataset) || collections[0];
}

function parseNdjson(raw) {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

async function captureLookup({ target, dataset = 'latest', limit = 500, onProgress = () => {}, onBytes = () => {}, signal }) {
  const u = normalizeTarget(target);
  onProgress({ stage: 'Loading Common Crawl datasets', progress: 8, processed: 0, total: null });
  const collection = await resolveCollection(dataset, onBytes, signal);
  if (signal?.aborted) throw new Error('Cancelled');

  const domainPattern = `${u.hostname}/*`;
  const api = new URL(collection.index);
  api.searchParams.set('url', domainPattern);
  api.searchParams.set('output', 'json');
  api.searchParams.set('filter', 'status:200');
  api.searchParams.set('collapse', 'urlkey');
  api.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 5000)));

  onProgress({ stage: 'Querying crawl index', progress: 20, processed: 0, total: null, meta: { dataset: collection.id } });
  const raw = await fetchText(api.toString(), 30000, onBytes, signal);
  if (signal?.aborted) throw new Error('Cancelled');
  const rows = parseNdjson(raw);
  const total = rows.length;
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    items.push({
      url: r.url,
      timestamp: r.timestamp,
      status: Number(r.status || 0),
      mime: r.mime || r['mime-detected'] || '',
      digest: r.digest || '',
      filename: r.filename || '',
      offset: r.offset || '',
      length: r.length || '',
      dataset: collection.id,
      source: 'Common Crawl Index'
    });
    if (i % 50 === 0) onProgress({ stage: 'Processing captures', progress: 25 + Math.round((i / Math.max(total,1)) * 60), processed: i + 1, total });
  }
  onProgress({ stage: 'Saving results', progress: 94, processed: total, total });
  return { items, collection };
}

async function urlHistory({ target, dataset = 'latest', limit = 1000, onProgress = () => {}, onBytes = () => {}, signal }) {
  const u = normalizeTarget(target);
  const collection = await resolveCollection(dataset, onBytes, signal);
  const api = new URL(collection.index);
  api.searchParams.set('url', u.toString());
  api.searchParams.set('output', 'json');
  api.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 5000)));
  onProgress({ stage: 'Querying URL history', progress: 30, processed: 0, total: null, meta: { dataset: collection.id } });
  const raw = await fetchText(api.toString(), 30000, onBytes, signal);
  if (signal?.aborted) throw new Error('Cancelled');
  const rows = parseNdjson(raw).map(r => ({
    url: r.url, timestamp: r.timestamp, status: Number(r.status || 0), mime: r.mime || r['mime-detected'] || '',
    digest: r.digest || '', filename: r.filename || '', offset: r.offset || '', length: r.length || '', dataset: collection.id,
    source: 'Common Crawl Index'
  }));
  onProgress({ stage: 'Saving results', progress: 94, processed: rows.length, total: rows.length });
  return { items: rows, collection };
}

module.exports = { getCollections, captureLookup, urlHistory, normalizeTarget };
