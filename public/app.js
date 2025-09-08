const els = {
  form: document.getElementById('searchForm'),
  q: document.getElementById('q'),
  hl: document.getElementById('hl'),
  gl: document.getElementById('gl'),
  results: document.getElementById('results'),
  answerBox: document.getElementById('answerBox'),
  knowledge: document.getElementById('knowledge'),
  info: document.getElementById('info'),
  meta: document.getElementById('meta'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  pageInfo: document.getElementById('pageInfo'),
  tabs: document.querySelectorAll('.tab'),
  imagesGrid: document.getElementById('imagesGrid')
};

const state = {
  q: new URLSearchParams(location.search).get('q') || '',
  hl: localStorage.getItem('hl') || 'hi',
  gl: localStorage.getItem('gl') || 'in',
  page: 1,
  num: 10,
  imgNum: 24,
  activeTab: 'all',
  provider: 'serper'
};

// init
els.q.value = state.q;
els.hl.value = state.hl;
els.gl.value = state.gl;
els.form.addEventListener('submit', onSubmit);
els.prev.addEventListener('click', () => goPage(state.page - 1));
els.next.addEventListener('click', () => goPage(state.page + 1));
els.hl.addEventListener('change', () => { state.hl = els.hl.value; localStorage.setItem('hl', state.hl); if (state.q) searchRouter(); });
els.gl.addEventListener('change', () => { state.gl = els.gl.value; localStorage.setItem('gl', state.gl); if (state.q) searchRouter(); });
for(const t of els.tabs){ t.addEventListener('click', () => { setActiveTab(t.dataset.tab); }); }

if (state.q) searchRouter();

async function onSubmit(e){
  e.preventDefault();
  state.q = (els.q.value || '').trim();
  state.page = 1;
  if (!state.q) return;
  const params = new URLSearchParams({ q: state.q });
  history.replaceState(null, '', `?${params.toString()}`);
  await searchRouter();
}

async function searchRouter(){
  if(state.activeTab === 'images'){
    await searchImages();
  } else {
    await search();
  }
}

function setActiveTab(tab){
  state.activeTab = tab;
  for(const t of els.tabs){ t.classList.toggle('active', t.dataset.tab === tab); }
  const showImages = tab === 'images';
  els.imagesGrid.hidden = !showImages;
  els.results.hidden = showImages;
  els.answerBox.hidden = showImages || els.answerBox.hidden;
  els.knowledge.hidden = showImages || els.knowledge.hidden;
  state.page = 1;
  if(state.q) searchRouter();
}

async function search(){
  setLoading(true);
  clearBlocks();
  try{
    const url = new URL('/api/search', location.origin);
    url.searchParams.set('q', state.q);
    url.searchParams.set('hl', state.hl);
    url.searchParams.set('gl', state.gl);
    url.searchParams.set('page', String(state.page));
    url.searchParams.set('num', String(state.num));
    const r = await fetch(url);
    const data = await r.json();
    state.provider = data.provider || state.provider;

    renderInfo(data);
    renderAnswerBox(data.answerBox);
    renderKnowledge(data.knowledgePanel);
    renderResults(data.results || []);

    const hasNext = (data.results || []).length === state.num;
    els.prev.disabled = state.page <= 1;
    els.next.disabled = !hasNext;
    els.pageInfo.textContent = `Page ${state.page}`;
  } catch(err){
    els.info.textContent = `❌ ${err.message || err}`;
  } finally{
    setLoading(false);
  }
}

async function searchImages(){
  setLoading(true);
  els.imagesGrid.innerHTML = '';
  try{
    const url = new URL('/api/images', location.origin);
    url.searchParams.set('q', state.q);
    url.searchParams.set('hl', state.hl);
    url.searchParams.set('gl', state.gl);
    url.searchParams.set('page', String(state.page));
    url.searchParams.set('num', String(state.imgNum));
    const r = await fetch(url);
    const data = await r.json();
    renderInfo(data);
    if (!r.ok) {
      els.imagesGrid.innerHTML = `<div class="result">Images unavailable: ${escapeHtml(data.message || '')}</div>`;
      els.prev.disabled = true; els.next.disabled = true;
      els.pageInfo.textContent = `Page ${state.page}`;
      return;
    }
    renderImages(data.images || []);
    const hasNext = (data.images || []).length === state.imgNum;
    els.prev.disabled = state.page <= 1;
    els.next.disabled = !hasNext;
    els.pageInfo.textContent = `Page ${state.page}`;
  }catch(err){
    els.imagesGrid.innerHTML = `<div class="result">❌ ${escapeHtml(err.message || String(err))}</div>`;
  } finally{
    setLoading(false);
  }
}

function renderInfo(data){
  const took = (data.took_ms || 0)/1000;
  els.info.innerHTML = `➤ Showing results for <b>${escapeHtml(state.q)}</b> • Provider: <b>${escapeHtml(data.provider)}</b> • ${took.toFixed(2)}s`;
  els.meta.textContent = new Date().toLocaleString();
}

function renderAnswerBox(ab){
  if(!ab){ els.answerBox.hidden = true; els.answerBox.innerHTML = ''; return; }
  els.answerBox.hidden = false;
  const link = ab.link ? `<a href="${ab.link}" target="_blank" rel="noopener">Source</a>` : '';
  els.answerBox.innerHTML = `
    <div class="ab-title">${escapeHtml(ab.title || 'Answer')}</div>
    <div class="ab-snippet">${escapeHtml(ab.snippet || '')}</div>
    <div>${link}</div>
  `;
}

function renderKnowledge(kg){
  if(!kg){ els.knowledge.hidden = true; els.knowledge.innerHTML = ''; return; }
  els.knowledge.hidden = false;
  const img = kg.imageUrl ? `<img src="${kg.imageUrl}" alt="${escapeHtml(kg.title)}"/>` : '<div style="width:120px;height:120px;border-radius:12px;background:#0f1830;border:1px solid var(--border);"></div>';
  const link = kg.url ? `<a href="${kg.url}" target="_blank" rel="noopener">${escapeHtml(kg.url)}</a>` : '';
  els.knowledge.innerHTML = `
    ${img}
    <div>
      <h3 style="margin:4px 0 8px;">${escapeHtml(kg.title)}</h3>
      <div style="color:var(--muted);">${escapeHtml(kg.type || '')}</div>
      <p style="margin-top:8px;">${escapeHtml(kg.description || '')}</p>
      <div>${link}</div>
    </div>
  `;
}

function renderResults(list){
  els.results.innerHTML = '';
  if(!list.length){ els.results.innerHTML = '<div class="result">No results</div>'; return; }
  const frag = document.createDocumentFragment();
  for(const item of list){ frag.appendChild(renderResultCard(item)); }
  els.results.appendChild(frag);
}

function renderResultCard(item){
  const el = document.createElement('article');
  el.className = 'result';
  el.innerHTML = `
    <div class="line1">
      <img class="fav" loading="lazy" src="${item.favicon || ''}" alt=""/>
      <span>${escapeHtml(item.displayLink || '')}</span>
    </div>
    <a class="title" href="${item.link}" target="_blank" rel="noopener">${escapeHtml(item.title || item.link)}</a>
    <div class="snippet">${escapeHtml(item.snippet || '')}</div>
    ${renderSitelinks(item.sitelinks)}
  `;
  return el;
}

function renderSitelinks(sls){
  if(!sls || !sls.length) return '';
  const links = sls.map(s => `<a href="${s.link}" target="_blank" rel="noopener">${escapeHtml(s.title || s.link)}</a>`).join('');
  return `<div class="sitelinks">${links}</div>`;
}

function renderImages(list){
  els.imagesGrid.innerHTML = '';
  if(!list.length){ els.imagesGrid.innerHTML = '<div class="result">No images</div>'; return; }
  const frag = document.createDocumentFragment();
  for(const it of list){
    const card = document.createElement('article');
    card.className = 'img-card';
    card.innerHTML = `
      <a href="${it.link || it.imageUrl}" target="_blank" rel="noopener">
        <img src="${it.thumbnailUrl || it.imageUrl}" alt="${escapeHtml(it.title || '')}" loading="lazy" />
      </a>
      <div class="meta">
        <span class="title" title="${escapeHtml(it.title || '')}">${escapeHtml(it.title || '')}</span>
      </div>
    `;
    frag.appendChild(card);
  }
  els.imagesGrid.appendChild(frag);
}

function setLoading(v){
  document.body.style.cursor = v ? 'progress' : 'default';
  els.q.disabled = v; els.form.querySelector('button[type="submit"]').disabled = v;
}

function goPage(p){ if(p < 1) return; state.page = p; searchRouter(); }

function clearBlocks(){
  els.answerBox.hidden = true; els.answerBox.innerHTML = '';
  els.knowledge.hidden = true; els.knowledge.innerHTML = '';
  els.results.innerHTML = '';
}

function escapeHtml(s){ return (s || '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[c])); }