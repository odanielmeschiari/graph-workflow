/* Grafo de tarefas — 100% local: os dados ficam no navegador (localStorage), sem servidor. */
(() => {
  'use strict';

  // ---------- constantes de layout ----------
  const NW = 210, NH = 76, GX = 96, GY = 22, PAD = 24;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- helpers de DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  function el(ns, tag, attrs, kids) {
    const n = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.setAttribute('class', v);
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c != null) n.append(c);
    return n;
  }
  const h = (tag, attrs, ...kids) => el(null, tag, attrs, kids);
  const s = (tag, attrs, ...kids) => el(SVGNS, tag, attrs, kids);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  // ---------- armazenamento local (localStorage) ----------
  const PREFIX = 'grafo-tarefas:graph:';
  const store = {
    ids() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
      }
      return out;
    },
    get(id) {
      try { return JSON.parse(localStorage.getItem(PREFIX + id)); } catch { return null; }
    },
    put(g) {
      g.updatedAt = new Date().toISOString();
      try { localStorage.setItem(PREFIX + g.id, JSON.stringify(g)); }
      catch { throw new Error('Não foi possível salvar: o armazenamento do navegador está cheio ou bloqueado.'); }
      return g;
    },
    list() {
      return this.ids().map((id) => this.get(id)).filter(Boolean)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    create(name) {
      const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      return this.put({ id, name, tasks: [] });
    },
    remove(id) { localStorage.removeItem(PREFIX + id); },
  };

  // ---------- estado ----------
  const state = {
    graph: null,      // último estado salvo
    draft: null,      // cópia de trabalho: o painel edita, os nós marcam concluída
    name: '',         // nome do grafo em edição
    panel: true,      // painel de tarefas visível
    unsaved: false,   // há alterações com erro que ainda não puderam ser salvas
    saveTimer: null,
    owner: '',
    zoom: 1,
  };
  const refs = {};

  const clone = (tasks) => tasks.map((t) => ({ ...t, desc: t.desc || '', deps: [...t.deps] }));
  const viewTasks = () => state.draft;
  const PANEL_KEY = 'grafo-tarefas:panel';

  // ---------- lógica do grafo ----------
  function statusOf(tasks) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const out = new Map();
    for (const t of tasks) {
      const valid = t.deps.filter((d) => byId.has(d));
      if (t.done) out.set(t.id, 'done');
      else if (valid.every((d) => byId.get(d).done)) out.set(t.id, 'ready');
      else out.set(t.id, 'blocked');
    }
    return out;
  }

  // Layout horizontal em camadas: coluna = maior caminho até a tarefa.
  function layout(tasks) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const depth = new Map();
    const visiting = new Set();
    const dfs = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0; // ciclo (só no rascunho): ignora
      visiting.add(id);
      let m = -1;
      for (const d of byId.get(id).deps) if (byId.has(d)) m = Math.max(m, dfs(d));
      visiting.delete(id);
      depth.set(id, m + 1);
      return m + 1;
    };
    tasks.forEach((t) => dfs(t.id));

    const ncol = tasks.length ? Math.max(...depth.values()) + 1 : 0;
    const cols = Array.from({ length: ncol }, () => []);
    tasks.forEach((t) => cols[depth.get(t.id)].push(t.id));
    const dependents = new Map(tasks.map((t) => [t.id, []]));
    tasks.forEach((t) => t.deps.forEach((d) => dependents.has(d) && dependents.get(d).push(t.id)));

    const rows = Math.max(1, ...cols.map((c) => c.length));
    const colH = (n) => n * NH + Math.max(0, n - 1) * GY;
    const totalH = colH(rows);
    const y = new Map();
    const place = () => cols.forEach((c) => {
      const off = (totalH - colH(c.length)) / 2;
      c.forEach((id, i) => y.set(id, off + i * (NH + GY)));
    });
    place();
    const sortBy = (col, neighbours) => {
      const key = new Map(col.map((id) => {
        const ys = neighbours(id).filter((n) => y.has(n)).map((n) => y.get(n));
        return [id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : y.get(id)];
      }));
      col.sort((a, b) => key.get(a) - key.get(b));
    };
    for (let it = 0; it < 4; it++) {
      for (let c = 1; c < ncol; c++) { sortBy(cols[c], (id) => byId.get(id).deps); place(); }
      for (let c = ncol - 2; c >= 0; c--) { sortBy(cols[c], (id) => dependents.get(id)); place(); }
    }
    const pos = new Map();
    cols.forEach((c, ci) => c.forEach((id) => pos.set(id, { x: PAD + ci * (NW + GX), y: PAD + y.get(id) })));
    return {
      pos,
      w: ncol ? PAD * 2 + ncol * NW + (ncol - 1) * GX : 0,
      h: PAD * 2 + totalH,
    };
  }

  function validate(draft) {
    const errors = [];
    const bad = new Set();
    const seen = new Map();
    draft.forEach((t, i) => {
      const id = t.id.trim();
      if (!id) { errors.push(`Linha ${i + 1}: falta a sigla.`); bad.add(i); return; }
      if (!/^[^\s,;|]{1,16}$/.test(id)) { errors.push(`${id}: use até 16 caracteres, sem espaços, vírgulas ou "|".`); bad.add(i); }
      if (seen.has(id)) { errors.push(`Sigla repetida: ${id}.`); bad.add(i); bad.add(seen.get(id)); }
      else seen.set(id, i);
    });
    draft.forEach((t, i) => {
      for (const d of t.deps) {
        if (d === t.id) { errors.push(`${t.id} não pode depender de si mesma.`); bad.add(i); }
        else if (!seen.has(d)) { errors.push(`${t.id || `Linha ${i + 1}`} depende de ${d}, que não existe.`); bad.add(i); }
      }
    });
    if (!errors.length) {
      const indeg = new Map(draft.map((t) => [t.id, t.deps.length]));
      const q = draft.filter((t) => !t.deps.length).map((t) => t.id);
      let n = 0;
      while (q.length) {
        const cur = q.pop(); n++;
        for (const t of draft) if (t.deps.includes(cur)) {
          indeg.set(t.id, indeg.get(t.id) - 1);
          if (indeg.get(t.id) === 0) q.push(t.id);
        }
      }
      if (n !== draft.length) {
        errors.push('Há um ciclo: tarefas que dependem umas das outras em círculo.');
        draft.forEach((t, i) => { if (indeg.get(t.id) > 0) bad.add(i); });
      }
    }
    return { errors, bad };
  }

  // ---------- desenho do grafo ----------
  const trunc = (str, n) => (str.length > n ? str.slice(0, n - 1) + '…' : str);
  const STATE_LABEL = { done: 'concluída', ready: 'liberada', blocked: 'bloqueada' };

  function drawGraph() {
    const tasks = viewTasks();
    const box = refs.canvas;
    box.replaceChildren();
    if (!tasks.length) {
      box.append(h('div', { class: 'none', text: 'Este grafo está vazio. Adicione tarefas no painel: o grafo aparece aqui conforme você digita.' }));
      return;
    }
    const { pos, w, h: ht } = layout(tasks);
    const st = statusOf(tasks);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const svg = s('svg', {
      viewBox: `0 0 ${w} ${ht}`,
      width: Math.round(w * state.zoom),
      height: Math.round(ht * state.zoom),
      role: 'group',
      'aria-label': 'Grafo de dependências das tarefas',
    });
    const marker = (id, cls) => s('marker', {
      id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 11, markerHeight: 11,
      markerUnits: 'userSpaceOnUse', orient: 'auto',
    }, s('path', { d: 'M0 0 L10 5 L0 10 z', class: cls }));
    svg.append(s('defs', {}, marker('arr-gray', 'arrow-gray'), marker('arr-green', 'arrow-green')));

    const dimmed = (t) => state.owner && t.owner !== state.owner;
    const edges = [];
    for (const t of tasks) for (const d of t.deps) {
      if (!byId.has(d) || !pos.has(d)) continue;
      edges.push({ from: byId.get(d), to: t, on: !!byId.get(d).done });
    }
    edges.sort((a, b) => a.on - b.on); // verdes por cima
    const edgeLayer = s('g', {});
    for (const e of edges) {
      const a = pos.get(e.from.id), b = pos.get(e.to.id);
      const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x - 3, y2 = b.y + NH / 2;
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      edgeLayer.append(s('path', {
        d: `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        class: 'edge' + (e.on ? ' on' : '') + (dimmed(e.from) && dimmed(e.to) ? ' dim' : ''),
        'marker-end': `url(#${e.on ? 'arr-green' : 'arr-gray'})`,
      }));
    }
    svg.append(edgeLayer);

    for (const t of tasks) {
      const p = pos.get(t.id);
      const status = st.get(t.id);
      const clickable = status !== 'blocked' || t.done;
      const pending = t.deps.filter((d) => byId.has(d) && !byId.get(d).done);
      const label = `${t.id} ${t.name}${t.owner ? `, responsável ${t.owner}` : ''}: ${STATE_LABEL[status]}${t.desc ? `. ${t.desc}` : ''}`;
      const g = s('g', {
        class: `node ${status}${clickable ? ' clickable' : ''}${dimmed(t) ? ' dim' : ''}`,
        transform: `translate(${p.x} ${p.y})`,
        tabindex: 0,
        role: 'button',
        'aria-label': label,
        'aria-pressed': String(!!t.done),
      },
      s('title', { text: label + (pending.length ? ` — falta: ${pending.join(', ')}` : '') }),
      s('rect', { class: 'box', width: NW, height: NH, rx: 16 }),
      s('text', { class: 't-id', x: 16, y: 27, text: trunc(t.id, 10) }),
      s('text', { class: 't-state', x: NW - 16, y: 27, text: (status === 'done' ? '✓ ' : '') + STATE_LABEL[status] }),
      s('text', { class: 't-name', x: 16, y: 48, text: trunc(t.name || '(sem nome)', 27) }),
      t.owner ? s('text', { class: 't-owner', x: 16, y: 66, text: trunc(t.owner, 30) }) : null);
      g.addEventListener('click', () => toggleDone(t));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleDone(t); }
      });
      svg.append(g);
    }
    box.append(svg);
  }

  function refreshOwners() {
    const sel = refs.ownerSel;
    if (!sel) return;
    const owners = [...new Set(viewTasks().map((t) => t.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (state.owner && !owners.includes(state.owner)) state.owner = '';
    sel.replaceChildren(h('option', { value: '', text: 'Todas as pessoas' }),
      ...owners.map((o) => h('option', { value: o, text: o, selected: o === state.owner })));
    sel.value = state.owner;
  }

  function refreshProgress() {
    const tasks = state.draft;
    const done = tasks.filter((x) => x.done).length;
    refs.progress.replaceChildren(
      h('span', { class: 'bar' }, h('i', { style: `width:${tasks.length ? (done / tasks.length) * 100 : 0}%` })),
      h('span', { text: `${done}/${tasks.length}` }),
    );
    refs.progress.title = `${done} de ${tasks.length} tarefas concluídas`;
  }

  function redraw() {
    refreshOwners();
    drawGraph();
    refreshProgress();
  }

  // ---------- ações ----------
  function refreshSaveState() {
    if (!refs.saveState) return;
    refs.saveState.textContent = state.unsaved ? 'Não salvo: corrija os erros' : 'Salvo neste navegador';
    refs.saveState.classList.toggle('warn', state.unsaved);
  }

  // Grava o rascunho no navegador quando não há erros. Retorna true se gravou.
  function persist() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.graph || validate(state.draft).errors.length) { state.unsaved = true; refreshSaveState(); return false; }
    const tasks = state.draft.map((x) => ({
      id: x.id.trim(),
      name: x.name.trim().slice(0, 120),
      owner: x.owner.trim().slice(0, 60),
      desc: (x.desc || '').trim().slice(0, 1000),
      deps: [...new Set(x.deps)],
      done: !!x.done,
    }));
    // uma tarefa só pode ficar concluída se todas as dependências estiverem
    const byId = new Map(tasks.map((x) => [x.id, x]));
    let cascaded = false, again = true;
    while (again) {
      again = false;
      for (const x of tasks) if (x.done && x.deps.some((d) => !byId.get(d).done)) { x.done = false; again = true; cascaded = true; }
    }
    const g = { ...state.graph, name: state.name.trim().slice(0, 80) || state.graph.name, tasks };
    try { store.put(g); } catch (e) { toast(e.message); state.unsaved = true; refreshSaveState(); return false; }
    state.graph = g;
    state.unsaved = false;
    if (cascaded) { tasks.forEach((x, i) => { state.draft[i].done = x.done; }); redraw(); }
    refreshSaveState();
    return true;
  }
  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(persist, 400);
  }

  function toggleDone(t) {
    const cur = state.draft.find((x) => x.id === t.id);
    if (!cur) return;
    if (!cur.done) {
      const byId = new Map(state.draft.map((x) => [x.id, x]));
      const pending = cur.deps.filter((d) => byId.has(d) && !byId.get(d).done);
      if (pending.length) { toast(`${cur.id} está bloqueada: falta concluir ${pending.join(', ')}.`); return; }
    } else {
      const blocking = state.draft.filter((x) => x.done && x.deps.includes(cur.id)).map((x) => x.id);
      if (blocking.length) { toast(`Desmarque antes: ${blocking.join(', ')} (dependem de ${cur.id}).`); return; }
    }
    cur.done = !cur.done;
    persist();
    redraw();
  }

  // ---------- editor ----------
  const nextId = () => {
    const used = new Set(state.draft.map((t) => t.id));
    for (let i = 1; i < 1000; i++) {
      const id = 'T' + String(i).padStart(2, '0');
      if (!used.has(id)) return id;
    }
    return 'T' + Date.now();
  };
  const parseDeps = (str) => [...new Set(str.split(/[\s,;]+/).filter(Boolean))];

  function onDraftChange() {
    const { errors, bad } = validate(state.draft);
    if (refs.errors) refs.errors.replaceChildren(...errors.slice(0, 6).map((m) => h('li', { text: m })));
    if (refs.rows) [...refs.rows.children].forEach((r, i) => r.classList.toggle('bad', bad.has(i)));
    drawGraph();
    refreshOwners();
    refreshProgress();
    scheduleSave();
  }

  function renderRows() {
    if (!refs.rows) return;
    refs.rows.replaceChildren();
    state.draft.forEach((t, i) => {
      const row = h('div', { class: 'trow' },
        h('input', { name: 'id', value: t.id, placeholder: 'T01', 'aria-label': 'Sigla', maxlength: 16,
          oninput: (e) => { const old = t.id; t.id = e.target.value.trim(); renameDeps(old, t.id); onDraftChange(); } }),
        h('input', { name: 'name', value: t.name, placeholder: 'Nome da tarefa', 'aria-label': 'Nome da tarefa',
          oninput: (e) => { t.name = e.target.value; onDraftChange(); } }),
        h('button', { class: 'rm ghost', title: 'Remover tarefa', 'aria-label': `Remover ${t.id}`, text: '✕',
          onclick: () => {
            const gone = t.id;
            state.draft.splice(i, 1);
            state.draft.forEach((x) => { x.deps = x.deps.filter((d) => d !== gone); });
            renderRows(); onDraftChange();
          } }),
        h('div', { class: 'full' },
          h('input', { name: 'owner', value: t.owner, placeholder: 'Responsável', 'aria-label': 'Responsável',
            oninput: (e) => { t.owner = e.target.value; onDraftChange(); } }),
          h('input', { name: 'deps', value: t.deps.join(', '), placeholder: 'Depende de: T01, T02', 'aria-label': 'Dependências',
            oninput: (e) => { t.deps = parseDeps(e.target.value); onDraftChange(); } })),
        h('textarea', { name: 'desc', class: 'desc', rows: 2, maxlength: 1000, placeholder: 'Descrição (opcional)', 'aria-label': 'Descrição da tarefa',
          oninput: (e) => { t.desc = e.target.value; onDraftChange(); } }, t.desc || ''));
      refs.rows.append(row);
    });
    const { errors, bad } = validate(state.draft);
    refs.errors.replaceChildren(...errors.slice(0, 6).map((m) => h('li', { text: m })));
    [...refs.rows.children].forEach((r, i) => r.classList.toggle('bad', bad.has(i)));
  }

  // Ao trocar a sigla de uma tarefa, atualiza quem dependia dela (se a sigla antiga era válida).
  function renameDeps(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    let changed = false;
    state.draft.forEach((x, i) => {
      if (x.deps.includes(oldId) && !state.draft.some((y) => y.id === oldId)) {
        x.deps = x.deps.map((d) => (d === oldId ? newId : d));
        const inp = refs.rows.children[i] && $('input[name="deps"]', refs.rows.children[i]);
        if (inp) inp.value = x.deps.join(', ');
        changed = true;
      }
    });
    return changed;
  }

  function importText(text) {
    let added = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split('|').map((p) => p.trim());
      const m = parts[0].match(/^(\S+)\s*[-–—:]\s*(.*)$/) || parts[0].match(/^(\S+)\s+(.*)$/);
      if (!m) continue;
      const entry = { id: m[1], name: m[2], owner: parts[1] || '', desc: '', deps: parseDeps(parts[2] || ''), done: false };
      const existing = state.draft.find((t) => t.id === entry.id);
      if (existing) Object.assign(existing, { name: entry.name, owner: entry.owner, deps: entry.deps }); // mantém a descrição
      else state.draft.push(entry);
      added++;
    }
    renderRows();
    onDraftChange();
    toast(added ? `${added} linha(s) importada(s).` : 'Nenhuma linha reconhecida. Use: T07 - Nome | Responsável | T01, T02');
  }

  // ---------- páginas ----------
  function logoMark(size = 20) {
    return s('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' },
      s('path', { d: 'M7.5 12C11 12 12 7 16.5 7M7.5 12C11 12 12 17 16.5 17', fill: 'none', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round' }),
      s('rect', { x: 2, y: 9.2, width: 5.6, height: 5.6, rx: 1.8, fill: '#fff' }),
      s('rect', { x: 16, y: 4.2, width: 5.6, height: 5.6, rx: 1.8, fill: '#fff' }),
      s('rect', { x: 16, y: 14.2, width: 5.6, height: 5.6, rx: 1.8, fill: '#fff' }));
  }

  function renderGraphPage() {
    const g = state.graph;
    const app = $('#app');
    app.replaceChildren();
    const showPanel = state.panel || !state.draft.length;
    const setPanel = (on) => {
      if (!on && !state.draft.length) { toast('Adicione uma tarefa antes de ocultar o painel.'); return; }
      state.panel = on;
      try { localStorage.setItem(PANEL_KEY, on ? '1' : '0'); } catch { /* sem armazenamento: ignora */ }
      renderGraphPage();
    };
    // sai da página sem perder o que foi digitado (ou avisa, se há erros)
    const leave = (e) => {
      if (state.saveTimer) persist();
      if (state.unsaved && !confirm('Há alterações com erro que não serão salvas. Sair mesmo?')) e.preventDefault();
    };
    refs.title = h('h1', { text: state.name || g.name });
    refs.progress = h('span', { class: 'progress' });
    refs.canvas = h('div', { class: 'canvas' });
    refs.saveState = h('span', { class: 'savestate', role: 'status' });
    refs.ownerSel = h('select', { 'aria-label': 'Destacar tarefas de uma pessoa',
      onchange: (e) => { state.owner = e.target.value; drawGraph(); } });

    app.append(h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/grafos', title: 'Todos os grafos', onclick: leave }, h('span', { class: 'logo' }, logoMark()), h('span', { text: 'Grafos' })),
      refs.title,
      refs.progress,
      h('span', { class: 'spacer' }),
      h('span', { class: 'legend' },
        h('span', {}, h('i', { class: 'l-done' }), 'concluída'),
        h('span', {}, h('i', { class: 'l-ready' }), 'liberada'),
        h('span', {}, h('i', { class: 'l-blocked' }), 'bloqueada')),
      refs.ownerSel));

    const main = h('div', { class: 'main' });
    if (showPanel) {
      refs.rows = h('div', { class: 'rows' });
      refs.errors = h('ul', { class: 'errors', role: 'alert' });
      refs.nameInput = h('input', { class: 'gname', value: state.name || g.name, 'aria-label': 'Nome do grafo',
        oninput: (e) => { state.name = e.target.value; refs.title.textContent = state.name.trim() || g.name; scheduleSave(); } });
      const ta = h('textarea', { placeholder: 'T01 - Modelar banco | Ana\nT02 - Criar API | Bruno | T01\nT07 - Construir árvore AVL | Ana | T01, T02, T03' });
      main.append(h('aside', { class: 'editor' },
        h('div', { class: 'head' }, refs.nameInput,
          h('button', { class: 'hide', text: 'Ocultar', title: 'Ocultar o painel de tarefas', onclick: () => setPanel(false) })),
        refs.rows,
        refs.errors,
        h('details', {},
          h('summary', { text: 'Colar várias tarefas de uma vez' }),
          h('p', { class: 'hint', text: 'Uma por linha: sigla - nome | responsável | dependências' }),
          ta,
          h('button', { text: 'Adicionar à lista', onclick: () => { importText(ta.value); ta.value = ''; } })),
        h('div', { class: 'foot' },
          h('button', { class: 'primary', text: '+ Tarefa', onclick: () => {
            state.draft.push({ id: nextId(), name: '', owner: '', desc: '', deps: [], done: false });
            renderRows(); onDraftChange();
            const inputs = refs.rows.querySelectorAll('input[name="name"]');
            inputs[inputs.length - 1].focus();
            refs.rows.scrollTop = refs.rows.scrollHeight;
          } }),
          refs.saveState)));
    } else {
      refs.rows = refs.errors = refs.nameInput = null;
    }
    main.append(h('div', { class: 'stage' }, refs.canvas));
    app.append(main);

    // doca flutuante: painel e zoom
    const setZoom = (z) => { state.zoom = Math.min(2, Math.max(0.3, z)); drawGraph(); };
    app.append(h('nav', { class: 'dock', 'aria-label': 'Painel e zoom' },
      h('a', { href: '#/grafos', text: 'Grafos', onclick: leave }),
      h('span', { class: 'sep' }),
      h('button', { 'aria-pressed': String(showPanel), text: 'Tarefas', title: 'Mostrar ou ocultar o painel de tarefas', onclick: () => setPanel(!showPanel) }),
      h('span', { class: 'sep' }),
      h('button', { text: '−', title: 'Diminuir', 'aria-label': 'Diminuir', onclick: () => setZoom(state.zoom - 0.1) }),
      h('button', { text: '+', title: 'Aumentar', 'aria-label': 'Aumentar', onclick: () => setZoom(state.zoom + 0.1) }),
      h('button', { text: 'Ajustar', title: 'Ajustar à largura', onclick: () => {
        const tasks = viewTasks();
        if (!tasks.length) return;
        setZoom(Math.min(1, (refs.canvas.clientWidth - 40) / layout(tasks).w));
      } })));

    renderRows();
    refreshSaveState();
    redraw();
  }

  // ---------- backup (exportar / importar) ----------
  function exportAll() {
    const data = { app: 'grafo-tarefas', version: 1, exportedAt: new Date().toISOString(), graphs: store.list() };
    const a = h('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
      download: `grafos-tarefas-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importAll(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const graphs = (Array.isArray(data.graphs) ? data.graphs : []).filter((g) =>
          g && typeof g.id === 'string' && /^[a-z0-9-]{3,48}$/.test(g.id) && typeof g.name === 'string' && Array.isArray(g.tasks)
          && g.tasks.every((t) => t && typeof t.id === 'string' && Array.isArray(t.deps))
          && !validate(g.tasks.map((t) => ({ id: t.id, deps: t.deps }))).errors.length);
        if (!graphs.length) { toast('Esse arquivo não tem grafos válidos.'); return; }
        const clash = graphs.filter((g) => store.get(g.id));
        const overwrite = clash.length ? confirm(`${clash.length} grafo(s) já existem aqui. Sobrescrever com os do arquivo?`) : true;
        let n = 0;
        for (const g of graphs) {
          if (store.get(g.id) && !overwrite) continue;
          store.put({ id: g.id, name: g.name.slice(0, 80), tasks: g.tasks.map((t) => ({
            id: t.id, name: String(t.name ?? ''), owner: String(t.owner ?? ''), desc: String(t.desc ?? '').slice(0, 1000), deps: t.deps.map(String), done: !!t.done })) });
          n++;
        }
        toast(`${n} grafo(s) importado(s).`);
        renderHome();
      } catch (e) { toast(e.message || 'Arquivo inválido.'); }
    };
    reader.readAsText(file);
  }

  const GRADS = [['#6b46c1', '#d946a8'], ['#0e9aa7', '#2f5de8'], ['#f0771d', '#d9308a'], ['#1f9d63', '#0f7490'], ['#4338ca', '#0ea5e9']];

  // miniatura do grafo para o cartão da tela inicial
  function thumb(g) {
    const hash = [...g.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    const [c1, c2] = GRADS[hash % GRADS.length];
    const box = h('div', { class: 'thumb', style: `background:linear-gradient(135deg,${c1},${c2})` });
    if (!g.tasks.length) return box;
    const { pos, w, h: ht } = layout(g.tasks);
    const byId = new Map(g.tasks.map((t) => [t.id, t]));
    const svg = s('svg', { viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    for (const t of g.tasks) for (const d of t.deps) {
      if (!pos.has(d)) continue;
      const a = pos.get(d), b = pos.get(t.id);
      const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = (x2 - x1) / 2;
      svg.append(s('path', { d: `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        class: 'm-edge' + (byId.get(d).done ? ' on' : '') }));
    }
    for (const t of g.tasks) {
      const p = pos.get(t.id);
      svg.append(s('rect', { x: p.x, y: p.y, width: NW, height: NH, rx: 18, class: 'm-node' + (t.done ? ' on' : '') }));
    }
    box.append(svg);
    return box;
  }

  function renderWelcome() {
    state.graph = null;
    const start = h('button', { class: 'start primary', text: 'Começar', onclick: () => { location.hash = '#/grafos'; } });
    $('#app').replaceChildren(h('main', { class: 'welcome' },
      h('div', { class: 'welcome-inner' },
        h('span', { class: 'logo big' }, logoMark(36)),
        h('h1', { text: 'Grafo de tarefas' }),
        h('p', { text: 'Veja o que já foi feito e o que está liberado para começar.' }),
        start)));
  }

  function renderHome() {
    state.graph = null;
    const app = $('#app');
    app.replaceChildren();
    const input = h('input', { placeholder: 'Nome do grafo', 'aria-label': 'Nome do novo grafo', maxlength: 80 });
    const create = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      try { location.hash = `#/g/${store.create(name).id}`; } catch (e) { toast(e.message); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    const picker = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
      onchange: (e) => { if (e.target.files[0]) importAll(e.target.files[0]); e.target.value = ''; } });
    const tiles = h('div', { class: 'tiles' },
      h('div', { class: 'tile new' },
        h('strong', { text: 'Novo grafo' }),
        input,
        h('button', { class: 'primary', text: 'Criar', onclick: create })));
    for (const g of store.list()) {
      const done = g.tasks.filter((t) => t.done).length;
      tiles.append(h('div', { class: 'tile' },
        h('a', { class: 'tile-link', href: `#/g/${g.id}` },
          thumb(g),
          h('span', { class: 'tile-name', text: g.name }),
          h('span', { class: 'tile-meta' },
            h('span', { class: 'bar' }, h('i', { style: `width:${g.tasks.length ? (done / g.tasks.length) * 100 : 0}%` })),
            h('span', { text: `${done}/${g.tasks.length}` }))),
        h('button', { class: 'tile-del', title: 'Excluir grafo', 'aria-label': `Excluir ${g.name}`, text: '✕', onclick: () => {
          if (!confirm(`Excluir o grafo "${g.name}"? Isso não pode ser desfeito.`)) return;
          store.remove(g.id);
          renderHome();
        } })));
    }
    app.append(h('main', { class: 'home' },
      h('h1', { text: 'Seus grafos' }),
      h('p', { class: 'lead', text: 'Veja o que já foi feito e o que está liberado para começar. Tudo fica salvo neste navegador, sem internet.' }),
      tiles,
      h('div', { class: 'backup' },
        h('span', { text: 'Limpar os dados do site apaga os grafos.' }),
        h('button', { text: 'Exportar backup', onclick: exportAll }),
        h('button', { text: 'Importar backup', onclick: () => picker.click() }),
        picker)));
  }

  function openGraph(id) {
    const g = store.get(id);
    if (!g) { toast('Grafo não encontrado neste navegador.'); location.hash = '#/grafos'; return; }
    state.graph = g;
    state.draft = clone(g.tasks);
    state.name = g.name;
    state.unsaved = false;
    state.owner = '';
    try { state.panel = localStorage.getItem(PANEL_KEY) !== '0'; } catch { state.panel = true; }
    renderGraphPage();
  }

  function route() {
    if (state.saveTimer) persist();
    try {
      localStorage.getItem(PREFIX);
    } catch {
      $('#app').replaceChildren(h('main', { class: 'home' }, h('h1', { text: 'Armazenamento bloqueado' }),
        h('p', { class: 'lead', text: 'O navegador não permite salvar dados deste site (modo privado ou cookies bloqueados). Abra em uma janela normal.' })));
      return;
    }
    const m = location.hash.match(/^#\/g\/([a-z0-9-]+)$/);
    if (m) openGraph(m[1]);
    else if (location.hash === '#/grafos') renderHome();
    else renderWelcome();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (state.saveTimer) persist();
    if (state.unsaved) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { if (state.saveTimer) persist(); });
  // pede ao navegador para não apagar os dados sozinho quando faltar espaço
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // funciona offline também quando hospedado (http/https); em arquivo local (file://) não é necessário
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
