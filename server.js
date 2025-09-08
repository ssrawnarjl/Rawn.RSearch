require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';
const PROVIDER = (process.env.SEARCH_PROVIDER || 'serper').toLowerCase();

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(corsOrigins.length ? cors({ origin: corsOrigins }) : cors());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: PROVIDER, time: new Date().toISOString() });
});

// ---- Web search endpoint ----
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'query `q` is required' });
  const hl = (req.query.hl || 'hi').toString();
  const gl = (req.query.gl || 'in').toString();
  const num = Math.max(1, Math.min(parseInt(req.query.num || '10', 10), 20));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));

  const started = Date.now();
  try {
    let payload;
    if (PROVIDER === 'serper') {
      payload = await querySerper({ q, hl, gl, num, page });
    } else {
      payload = await queryDDG({ q });
    }
    res.json({ provider: PROVIDER, query: q, params: { hl, gl, num, page }, took_ms: Date.now() - started, ...payload });
  } catch (err) {
    console.error('search error', err);
    res.status(500).json({ error: 'search_failed', message: err?.message || String(err) });
  }
});

// ---- Images search endpoint ----
app.get('/api/images', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'query `q` is required' });
  const hl = (req.query.hl || 'hi').toString();
  const gl = (req.query.gl || 'in').toString();
  const num = Math.max(1, Math.min(parseInt(req.query.num || '24', 10), 50));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));

  const started = Date.now();
  try {
    if (PROVIDER !== 'serper') {
      return res.status(501).json({ error: 'images_unavailable', message: 'Images are supported only with Serper provider.' });
    }
    const payload = await querySerperImages({ q, hl, gl, num, page });
    res.json({ provider: PROVIDER, query: q, params: { hl, gl, num, page }, took_ms: Date.now() - started, ...payload });
  } catch (err) {
    console.error('images error', err);
    res.status(500).json({ error: 'images_failed', message: err?.message || String(err) });
  }
});

// ---- Provider: Serper Search (Google) ----
async function querySerper({ q, hl, gl, num, page }) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing in .env');
  const body = { q, hl, gl, num, page, autocorrect: true };
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const txt = await r.text(); throw new Error(`Serper API ${r.status}: ${txt}`); }
  const data = await r.json();
  const results = (data.organic || []).map((it, idx) => normalizeResult(it, idx));
  const paa = (data.peopleAlsoAsk || []).map(it => ({ question: it.question, snippet: it.snippet, link: it.link }));
  return { results, answerBox: normalizeAnswerBox(data.answerBox), knowledgePanel: normalizeKG(data.knowledgeGraph), peopleAlsoAsk: paa };
}

async function querySerperImages({ q, hl, gl, num, page }) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing in .env');
  const body = { q, hl, gl, num, page };
  const r = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const txt = await r.text(); throw new Error(`Serper Images ${r.status}: ${txt}`); }
  const data = await r.json();
  const images = (data.images || []).map((it, idx) => ({
    title: it.title || '',
    imageUrl: it.imageUrl || it.url || '',
    thumbnailUrl: it.thumbnailUrl || it.imageUrl || '',
    source: it.source || '',
    link: it.link || it.imageUrl || '',
    position: idx + 1
  }));
  return { images };
}

// ---- Provider: DuckDuckGo fallback ----
async function queryDDG({ q }) {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_redirect', '1');
  url.searchParams.set('no_html', '1');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`DDG API ${r.status}`);
  const data = await r.json();
  let results = [];
  if (Array.isArray(data.RelatedTopics)) {
    results = data.RelatedTopics.flatMap(rt => (rt.Topics ? rt.Topics : [rt]))
      .filter(x => x.FirstURL && x.Text)
      .map((x, idx) => ({
        title: x.Text, link: x.FirstURL, snippet: x.Text, displayLink: safeHostname(x.FirstURL),
        position: idx + 1, favicon: makeFavicon(x.FirstURL)
      }));
  }
  const answerBox = data.AbstractText ? { title: data.Heading, snippet: data.AbstractText, link: data.AbstractURL } : null;
  return { results, answerBox, knowledgePanel: null, peopleAlsoAsk: [] };
}

// ---- Helpers ----
function normalizeResult(it, idx) {
  const url = it.link || it.url || '';
  return {
    title: it.title || it.name || '', link: url, snippet: it.snippet || it.description || '',
    displayLink: safeHostname(url), position: typeof it.position === 'number' ? it.position : (idx + 1),
    date: it.date || null, favicon: makeFavicon(url),
    sitelinks: Array.isArray(it.sitelinks) ? it.sitelinks.map(s => ({ title: s.title, link: s.link })) : []
  };
}
function normalizeAnswerBox(ab) {
  if (!ab) return null;
  return { title: ab.title || ab.type || '', snippet: ab.answer || ab.snippet || ab.extracted_answer || '', link: ab.link || ab.url || '' };
}
function normalizeKG(kg) {
  if (!kg) return null;
  return { title: kg.title || kg.name || '', type: kg.type || '', description: kg.description || '', url: kg.url || '', imageUrl: kg.imageUrl || '' };
}
function makeFavicon(u) {
  try { const origin = new URL(u).origin; return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=64`; }
  catch(_) { return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; }
}
function safeHostname(u) { try { return new URL(u).hostname; } catch(_) { return ''; } }

app.listen(PORT, HOST, () => {
  console.log(`\n Rawna.RSearch running on http://${HOST}:${PORT}`);
  console.log(` Provider: ${PROVIDER}`);
});