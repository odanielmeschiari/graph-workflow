/* Grafo de tarefas — 100% local: os dados ficam no navegador (localStorage), sem servidor. */
(() => {
  'use strict';

  // ---------- constantes de layout ----------
  const NW = 210, NH = 76, GX = 96, GY = 22, PAD = 24;
  const LH = 6, LG = 10; // "pista" reservada para setas que pulam colunas: altura e espaço entre pistas
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
    newId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    create(name) { return this.put({ id: this.newId(), name, tasks: [] }); },
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
  // Uma seta que pula colunas (a tarefa depende de outra vários níveis atrás) ganha uma "pista" reservada em
  // cada coluna intermediária, para contornar os nós em vez de passar por cima deles. Setas que saem da mesma
  // tarefa compartilham as pistas e só se separam perto do destino.
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

    // grafo ampliado: tarefas + pistas; `edges` guarda, para cada dependência, as pistas por onde ela passa
    const colOf = new Map(depth);
    const preds = new Map(tasks.map((t) => [t.id, []]));
    const succs = new Map(tasks.map((t) => [t.id, []]));
    const linked = new Set();
    const link = (a, b) => {
      const k = a + '\0>' + b;
      if (linked.has(k)) return;
      linked.add(k);
      succs.get(a).push(b);
      preds.get(b).push(a);
    };
    const laneKey = (src, c) => '\0' + src + '\0' + c;
    const edges = [];
    for (const t of tasks) {
      for (const d of new Set(t.deps)) {
        if (d === t.id || !byId.has(d)) continue;
        const c0 = depth.get(d), c1 = depth.get(t.id);
        const lanes = [];
        for (let c = c0 + 1; c < c1; c++) {
          const k = laneKey(d, c);
          if (!colOf.has(k)) { colOf.set(k, c); preds.set(k, []); succs.set(k, []); cols[c].push(k); }
          lanes.push(k);
        }
        const chain = [d, ...lanes, t.id];
        for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1]);
        edges.push({ from: d, to: t.id, lanes });
      }
    }

    const hOf = (k) => (k.charCodeAt(0) === 0 ? LH : NH);
    const gapOf = (a, b) => (hOf(a) === LH && hOf(b) === LH ? LG : GY);
    const colH = (col) => col.reduce((acc, k, i) => acc + hOf(k) + (i ? gapOf(col[i - 1], k) : 0), 0);
    const totalH = Math.max(NH, ...cols.map(colH));
    const y = new Map(); // topo de cada item
    const place = () => cols.forEach((c) => {
      let at = (totalH - colH(c)) / 2;
      c.forEach((k, i) => { if (i) at += gapOf(c[i - 1], k); y.set(k, at); at += hOf(k); });
    });
    place();
    const mid = (k) => y.get(k) + hOf(k) / 2;
    const sortBy = (col, neighbours) => {
      const key = new Map(col.map((k) => {
        const ys = neighbours(k).filter((n) => y.has(n)).map(mid);
        return [k, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : mid(k)];
      }));
      col.sort((a, b) => key.get(a) - key.get(b));
    };
    for (let it = 0; it < 6; it++) {
      for (let c = 1; c < ncol; c++) { sortBy(cols[c], (k) => preds.get(k)); place(); }
      for (let c = ncol - 2; c >= 0; c--) { sortBy(cols[c], (k) => succs.get(k)); place(); }
    }

    const colX = (c) => PAD + c * (NW + GX);
    const pos = new Map();
    for (const t of tasks) pos.set(t.id, { x: colX(depth.get(t.id)), y: PAD + y.get(t.id) });
    const lane = (k) => ({ x: colX(colOf.get(k)), y: PAD + mid(k) });
    return {
      pos,
      edges: edges.map((e) => ({ from: e.from, to: e.to, lanes: e.lanes.map(lane) })),
      w: ncol ? PAD * 2 + ncol * NW + (ncol - 1) * GX : 0,
      h: PAD * 2 + totalH,
    };
  }

  // Caminho de uma seta: curvas suaves nos vãos entre colunas e trecho reto atravessando cada pista.
  function edgePath(x1, y1, lanes, x2, y2) {
    let d = `M${x1} ${y1}`, cx = x1, cy = y1;
    const curve = (x, y) => {
      const dx = Math.max(40, Math.abs(x - cx) / 2);
      d += ` C${cx + dx} ${cy}, ${x - dx} ${y}, ${x} ${y}`;
      cx = x; cy = y;
    };
    for (const l of lanes) { curve(l.x, l.y); d += ` L${l.x + NW} ${l.y}`; cx = l.x + NW; }
    curve(x2, y2);
    return d;
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
    const { pos, edges: routes, w, h: ht } = layout(tasks);
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
    const edges = routes.map((r) => ({ from: byId.get(r.from), to: byId.get(r.to), lanes: r.lanes, on: !!byId.get(r.from).done }));
    edges.sort((a, b) => a.on - b.on); // verdes por cima
    const edgeLayer = s('g', {});
    const edgeEls = [];
    for (const e of edges) {
      const a = pos.get(e.from.id), b = pos.get(e.to.id);
      const el = s('path', {
        d: edgePath(a.x + NW, a.y + NH / 2, e.lanes, b.x - 3, b.y + NH / 2),
        class: 'edge' + (e.lanes.length ? ' long' : '') + (e.on ? ' on' : '') + (dimmed(e.from) && dimmed(e.to) ? ' dim' : ''),
        'marker-end': `url(#${e.on ? 'arr-green' : 'arr-gray'})`,
      });
      edgeEls.push([el, e]);
      edgeLayer.append(el);
    }
    // ao apontar/focar uma tarefa, realça as setas que entram e saem dela (útil para seguir dependências longas)
    const light = (id) => {
      svg.classList.toggle('hl', !!id);
      for (const [el, e] of edgeEls) el.classList.toggle('hot', !!id && (e.from.id === id || e.to.id === id));
    };
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
      g.addEventListener('pointerenter', () => light(t.id));
      g.addEventListener('pointerleave', () => light(null));
      g.addEventListener('focus', () => light(t.id));
      g.addEventListener('blur', () => light(null));
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

  // ---------- resumo ----------
  const oneLine = (str) => (str || '').replace(/\s+/g, ' ').trim();

  // Agrupa tarefas por responsável (ordem alfabética; sem responsável por último), com a descrição recuada abaixo.
  // `extra(t)` acrescenta um texto ao fim da linha da tarefa.
  function groupedLines(list, extra = () => '') {
    const groups = new Map();
    for (const t of list) {
      const who = oneLine(t.owner);
      if (!groups.has(who)) groups.set(who, []);
      groups.get(who).push(t);
    }
    const names = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'pt-BR'));
    return names.map((who) => [
      who || 'Sem responsável',
      ...groups.get(who).flatMap((t) => [
        '* ' + [t.id, oneLine(t.name) || '(sem nome)'].join(' | ') + extra(t),
        ...(oneLine(t.desc) ? ['    * ' + oneLine(t.desc)] : []),
      ]),
    ].join('\n')).join('\n\n');
  }

  // Texto com as próximas tarefas: só as liberadas (todas as dependências concluídas) e ainda não concluídas.
  function summaryText() {
    const st = statusOf(state.draft);
    const ready = state.draft.filter((x) => st.get(x.id) === 'ready');
    let out = 'Próximas tarefas\n\n' + (ready.length ? groupedLines(ready) : 'Nenhuma tarefa liberada.');
    return out;
  }

  function showSummary() {
    const ta = h('textarea', { class: 'summary-text', readonly: true, rows: 10, 'aria-label': 'Resumo das próximas tarefas' });
    ta.value = summaryText();
    const dlg = h('dialog', { class: 'summary' },
      h('h2', { text: 'Resumo' }),
      ta,
      h('div', { class: 'summary-actions' },
        h('button', { class: 'primary', text: 'Copiar', onclick: async () => {
          try { await navigator.clipboard.writeText(ta.value); }
          catch { ta.select(); document.execCommand('copy'); }
          toast('Resumo copiado.');
        } }),
        h('button', { text: 'Fechar', onclick: () => dlg.close() })));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clique no fundo fecha
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    ta.focus();
  }

  // ---------- distribuição automática ----------
  // Configuração guardada no grafo: { mode: 'number'|'rank', members: [], diff: {id: número}, order: [{id, tie}] }
  function cleanDist(d) {
    if (!d || typeof d !== 'object') return undefined;
    const members = (Array.isArray(d.members) ? d.members : []).map((m) => String(m).trim().slice(0, 60)).filter(Boolean)
      .filter((m, i, a) => a.indexOf(m) === i).slice(0, 50);
    const diff = {};
    if (d.diff && typeof d.diff === 'object') {
      for (const [k, v] of Object.entries(d.diff)) { const x = Number(v); if (Number.isFinite(x) && x > 0) diff[k] = Math.min(x, 1000); }
    }
    const order = (Array.isArray(d.order) ? d.order : []).filter((o) => o && typeof o.id === 'string').map((o) => ({ id: o.id, tie: !!o.tie }));
    return { mode: d.mode === 'rank' ? 'rank' : 'number', members, diff, order };
  }
  function saveDist(d) {
    try { state.graph = store.put({ ...state.graph, dist: cleanDist(d) }); } catch (e) { toast(e.message); }
  }

  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Pesos (dificuldade) das tarefas pendentes a partir da configuração de distribuição.
  function reconcileOrder(d) {
    const pend = state.draft.filter((x) => !x.done);
    const ids = new Set(pend.map((x) => x.id)), seen = new Set();
    d.order = d.order.filter((o) => ids.has(o.id) && !seen.has(o.id) && seen.add(o.id));
    for (const x of pend) if (!seen.has(x.id)) d.order.push({ id: x.id, tie: false });
    if (d.order.length) d.order[0].tie = false;
  }
  function taskWeights(d) {
    const pend = state.draft.filter((x) => !x.done);
    if (!d) return new Map(pend.map((x) => [x.id, 1]));
    if (d.mode === 'number') return new Map(pend.map((x) => [x.id, d.diff[x.id] || 1]));
    reconcileOrder(d);
    const groups = [];
    d.order.forEach((o, i) => { if (o.tie && i > 0) groups[groups.length - 1].push(o.id); else groups.push([o.id]); });
    const out = new Map();
    groups.forEach((g, k) => g.forEach((id) => out.set(id, groups.length - k))); // mais difícil = maior peso
    return out;
  }

  // Distribui as tarefas pendentes entre as pessoas.
  // Cada pessoa é uma "máquina" e a dificuldade é a duração. Custo = 3 × (maior carga − menor carga) + duração total,
  // ou seja, o equilíbrio de carga pesa mais, e a duração total (que cresce quando alguém fica parado esperando
  // outra pessoa) desempata. Começa de uma divisão gulosa (prioridade ao caminho mais longo até o fim) e melhora
  // trocando/movendo tarefas, com algumas partidas aleatórias determinísticas.
  function distribute(tasks, weight, members) {
    const pend = tasks.filter((x) => !x.done);
    const n = pend.length, P = members.length;
    const idx = new Map(pend.map((x, i) => [x.id, i]));
    const w = pend.map((x) => weight.get(x.id) || 1);
    const deps = pend.map((x) => x.deps.filter((d) => idx.has(d)).map((d) => idx.get(d)));
    const succ = pend.map(() => []);
    deps.forEach((ds, i) => ds.forEach((d) => succ[d].push(i)));

    const bl = new Array(n).fill(-1); // caminho mais longo (em dificuldade) daqui até o fim
    const blOf = (i) => (bl[i] >= 0 ? bl[i] : (bl[i] = w[i] + succ[i].reduce((m, j) => Math.max(m, blOf(j)), 0)));
    for (let i = 0; i < n; i++) blOf(i);

    // ordem de escalonamento: respeita dependências, prioriza o caminho mais longo
    const indeg = deps.map((d) => d.length);
    const avail = [];
    indeg.forEach((k, i) => { if (!k) avail.push(i); });
    const order = [];
    while (avail.length) {
      let k = 0;
      for (let a = 1; a < avail.length; a++) {
        if (bl[avail[a]] > bl[avail[k]] || (bl[avail[a]] === bl[avail[k]] && avail[a] < avail[k])) k = a;
      }
      const i = avail.splice(k, 1)[0];
      order.push(i);
      for (const j of succ[i]) if (--indeg[j] === 0) avail.push(j);
    }

    const evaluate = (asg) => {
      const free = new Array(P).fill(0), load = new Array(P).fill(0), cnt = new Array(P).fill(0), fin = new Array(n).fill(0);
      let makespan = 0;
      for (const i of order) {
        const p = asg[i];
        let start = free[p];
        for (const d of deps[i]) if (fin[d] > start) start = fin[d];
        fin[i] = start + w[i];
        free[p] = fin[i];
        load[p] += w[i]; cnt[p]++;
        if (fin[i] > makespan) makespan = fin[i];
      }
      const imb = Math.max(...load) - Math.min(...load);
      const cimb = Math.max(...cnt) - Math.min(...cnt);
      return { cost: 3 * imb + makespan + 0.01 * cimb, makespan, load };
    };

    const improve = (asg, deadline) => {
      let cur = evaluate(asg).cost;
      for (let pass = 0; pass < 100 && performance.now() < deadline; pass++) {
        let better = false;
        for (let i = 0; i < n; i++) {
          for (let p = 0; p < P; p++) {
            if (p === asg[i]) continue;
            const old = asg[i];
            asg[i] = p;
            const c = evaluate(asg).cost;
            if (c < cur - 1e-9) { cur = c; better = true; } else asg[i] = old;
          }
        }
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (asg[i] === asg[j]) continue;
            [asg[i], asg[j]] = [asg[j], asg[i]];
            const c = evaluate(asg).cost;
            if (c < cur - 1e-9) { cur = c; better = true; } else [asg[i], asg[j]] = [asg[j], asg[i]];
          }
        }
        if (!better) break;
      }
      return cur;
    };

    // partida gulosa: cada tarefa vai para quem tem menos carga (empate: quem fica livre antes)
    const greedy = new Array(n).fill(0);
    {
      const free = new Array(P).fill(0), load = new Array(P).fill(0), fin = new Array(n).fill(0);
      for (const i of order) {
        const ready = deps[i].reduce((m, d) => Math.max(m, fin[d]), 0);
        let best = 0;
        for (let p = 1; p < P; p++) {
          const dl = load[p] - load[best];
          if (dl < -1e-9 || (Math.abs(dl) <= 1e-9 && Math.max(free[p], ready) < Math.max(free[best], ready))) best = p;
        }
        greedy[i] = best;
        fin[i] = Math.max(free[best], ready) + w[i];
        free[best] = fin[i]; load[best] += w[i];
      }
    }
    const deadline = performance.now() + 1500;
    let best = greedy, bestCost = improve(best, deadline);
    const rand = rng(12345);
    const starts = n <= 40 ? 24 : n <= 100 ? 6 : 0;
    for (let r = 0; r < starts && performance.now() < deadline; r++) {
      const shuffled = [...order];
      for (let k = shuffled.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]]; }
      const asg = new Array(n).fill(0);
      shuffled.forEach((i, k) => { asg[i] = k % P; });
      const c = improve(asg, deadline);
      if (c < bestCost - 1e-9) { best = asg; bestCost = c; }
    }

    const ev = evaluate(best);
    const total = w.reduce((a, b) => a + b, 0);
    return {
      owners: new Map(pend.map((x, i) => [x.id, members[best[i]]])),
      people: members.map((name, p) => ({ name, load: ev.load[p], ids: order.filter((i) => best[i] === p).map((i) => pend[i].id) })),
      makespan: ev.makespan,
      idle: ev.makespan ? Math.max(0, 1 - total / (ev.makespan * P)) : 0,
    };
  }

  function showDistribute() {
    const pend = () => state.draft.filter((x) => !x.done);
    const d = cleanDist(state.graph.dist) || { mode: 'number', members: [], diff: {}, order: [] };
    if (!d.members.length) d.members = [...new Set(state.draft.map((x) => x.owner.trim()).filter(Boolean))];
    const fmt = (x) => String(Math.round(x * 100) / 100);
    let result = null;
    let dragBusy = false; // arrasto em andamento: Esc cancela só o arrasto, não o diálogo

    const tasksBox = h('div', { class: 'dtasks' });
    const membersBox = h('div', { class: 'chips' });
    const resultBox = h('div', { class: 'dres', 'aria-live': 'polite' });
    const apply = h('button', { class: 'primary', text: 'Aplicar', disabled: true });
    const clearResult = () => { result = null; resultBox.replaceChildren(); apply.disabled = true; };

    const reconcile = () => reconcileOrder(d);

    const renderTasks = () => {
      const byId = new Map(state.draft.map((x) => [x.id, x]));
      if (!pend().length) { tasksBox.replaceChildren(h('p', { class: 'hint', text: 'Não há tarefas pendentes para distribuir.' })); return; }
      if (d.mode === 'number') {
        tasksBox.replaceChildren(...pend().map((x) => h('label', { class: 'drow' },
          h('b', { text: x.id }),
          h('span', { class: 'dname', text: x.name || '(sem nome)' }),
          h('input', { type: 'number', min: 0.1, step: 'any', placeholder: '1', value: d.diff[x.id] ?? '', 'aria-label': `Dificuldade de ${x.id}`,
            oninput: (e) => {
              const v = parseFloat(e.target.value);
              if (v > 0) d.diff[x.id] = Math.min(v, 1000); else delete d.diff[x.id];
              clearResult();
            } }))));
        return;
      }
      reconcile();
      const move = (i, k) => {
        [d.order[i], d.order[i + k]] = [d.order[i + k], d.order[i]];
        d.order[0].tie = false;
        renderTasks(); clearResult();
      };

      // arrastar e soltar (ponteiro: funciona com mouse e toque). Arraste pela linha ou pela alça ⠿.
      const dragRow = (row, i, e) => {
        if (e.button > 0 || e.target.closest('button, input, label')) return;
        const startY = e.clientY, startScroll = tasksBox.scrollTop;
        let dragging = false, drop = i, lastY = e.clientY, timer = null;
        const rows = () => [...tasksBox.querySelectorAll('.drow[data-i]')];
        const update = () => {
          row.style.transform = `translateY(${lastY - startY + (tasksBox.scrollTop - startScroll)}px)`;
          const os = rows().filter((r) => r !== row);
          drop = os.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < lastY; }).length;
          os.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
          if (os.length) os[Math.min(drop, os.length - 1)].classList.add(drop < os.length ? 'drop-before' : 'drop-after');
        };
        const tick = () => { // rola a lista quando o ponteiro chega perto da borda
          const b = tasksBox.getBoundingClientRect();
          if (lastY < b.top + 28) tasksBox.scrollTop -= 12; else if (lastY > b.bottom - 28) tasksBox.scrollTop += 12;
          update();
        };
        const onMove = (ev) => {
          lastY = ev.clientY;
          if (!dragging) {
            if (Math.abs(lastY - startY) < 4) return;
            dragging = true;
            dragBusy = true;
            try { row.setPointerCapture(e.pointerId); } catch { /* ignora */ }
            row.classList.add('dragging');
            timer = setInterval(tick, 40);
          }
          update();
        };
        const finish = (commit) => {
          clearInterval(timer);
          setTimeout(() => { dragBusy = false; });
          row.removeEventListener('pointermove', onMove);
          row.removeEventListener('pointerup', onUp);
          row.removeEventListener('pointercancel', onCancel);
          document.removeEventListener('keydown', onKey, true);
          if (!dragging) return;
          if (commit && drop !== i) {
            const [moved] = d.order.splice(i, 1);
            d.order.splice(drop, 0, moved);
            moved.tie = false;
            d.order[0].tie = false;
            clearResult();
          }
          renderTasks();
        };
        const onUp = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
        row.addEventListener('pointermove', onMove);
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onCancel);
        document.addEventListener('keydown', onKey, true);
      };

      tasksBox.replaceChildren(
        h('p', { class: 'hint', text: 'Da mais difícil (no topo) para a mais fácil. Arraste as tarefas para reordenar (ou use as setas). Marque "= anterior" para empatar com a de cima.' }),
        ...d.order.map((o, i) => {
          const x = byId.get(o.id);
          const row = h('div', { class: 'drow rank', 'data-i': String(i) },
            h('span', { class: 'grip', text: '⠿', title: 'Arraste para reordenar', 'aria-hidden': 'true' }),
            h('button', { class: 'ghost', text: '↑', title: 'Subir', 'aria-label': `Subir ${o.id}`, disabled: i === 0, onclick: () => move(i, -1) }),
            h('button', { class: 'ghost', text: '↓', title: 'Descer', 'aria-label': `Descer ${o.id}`, disabled: i === d.order.length - 1, onclick: () => move(i, 1) }),
            h('b', { text: o.id }),
            h('span', { class: 'dname', text: x.name || '(sem nome)' }),
            h('label', { class: 'opt tie' },
              h('input', { type: 'checkbox', checked: o.tie, disabled: i === 0, onchange: (e) => { o.tie = e.target.checked; clearResult(); } }),
              '= anterior'));
          row.addEventListener('pointerdown', (e) => dragRow(row, i, e));
          return row;
        }));
    };

    const renderMembers = () => {
      membersBox.replaceChildren(...d.members.map((m, i) => h('span', { class: 'chip' }, m,
        h('button', { class: 'ghost', text: '✕', title: 'Remover', 'aria-label': `Remover ${m}`, onclick: () => { d.members.splice(i, 1); renderMembers(); clearResult(); } }))));
      if (!d.members.length) membersBox.append(h('span', { class: 'hint', text: 'Nenhum integrante ainda.' }));
    };
    const nameInput = h('input', { placeholder: 'Nome do integrante', 'aria-label': 'Nome do integrante', maxlength: 60 });
    const addMembers = () => {
      for (const raw of nameInput.value.split(/[,;\n]+/)) {
        const name = raw.trim().slice(0, 60);
        if (name && d.members.length < 50 && !d.members.some((m) => m.toLowerCase() === name.toLowerCase())) d.members.push(name);
      }
      nameInput.value = '';
      renderMembers(); clearResult();
      nameInput.focus();
    };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMembers(); } });

    const weights = () => taskWeights(d);

    const run = () => {
      if (validate(state.draft).errors.length) { toast('Corrija os erros do painel de tarefas antes de distribuir.'); return; }
      if (!pend().length) { toast('Não há tarefas pendentes para distribuir.'); return; }
      if (nameInput.value.trim()) addMembers();
      if (!d.members.length) { toast('Adicione ao menos um integrante.'); nameInput.focus(); return; }
      result = distribute(state.draft, weights(), d.members);
      resultBox.replaceChildren(
        ...result.people.map((p) => h('div', { class: 'p' },
          h('strong', { text: p.name }),
          h('span', { class: 'load', text: `carga ${fmt(p.load)} · ${p.ids.length} tarefa(s)` }),
          h('div', { class: 'ids', text: p.ids.join(', ') || '—' }))),
        h('p', { class: 'hint', text: `Duração estimada ${fmt(result.makespan)} · tempo ocioso ${Math.round(result.idle * 100)}% (considerando dificuldade como tempo)` }));
      apply.disabled = false;
      saveDist(d);
    };

    apply.addEventListener('click', () => {
      if (!result) return;
      for (const x of state.draft) if (result.owners.has(x.id)) x.owner = result.owners.get(x.id);
      saveDist(d);
      dlg.close();
      renderRows();
      onDraftChange();
      toast('Responsáveis atualizados. Você ainda pode editar manualmente.');
    });

    const radio = (value, text) => h('label', { class: 'opt' },
      h('input', { type: 'radio', name: 'dmode', value, checked: d.mode === value,
        onchange: () => { d.mode = value; renderTasks(); clearResult(); } }), text);

    const dlg = h('dialog', { class: 'summary dist' },
      h('h2', { text: 'Distribuir tarefas' }),
      h('p', { class: 'hint', text: 'Divide as tarefas pendentes entre as pessoas, equilibrando a carga e deixando todo mundo com algo para fazer ao mesmo tempo.' }),
      h('h3', { text: '1. Dificuldade das tarefas' }),
      h('div', { class: 'dmodes' }, radio('number', 'Informar um número'), radio('rank', 'Ordenar da mais difícil à mais fácil')),
      tasksBox,
      h('h3', { text: '2. Integrantes da equipe' }),
      membersBox,
      h('div', { class: 'dadd' }, nameInput, h('button', { text: 'Adicionar', onclick: addMembers })),
      h('h3', { text: '3. Resultado' }),
      resultBox,
      h('div', { class: 'summary-actions' },
        h('button', { text: 'Distribuir', onclick: run }),
        apply,
        h('button', { text: 'Fechar', onclick: () => dlg.close() })));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('cancel', (e) => { if (dragBusy) e.preventDefault(); });
    dlg.addEventListener('close', () => { saveDist(d); dlg.remove(); });
    renderTasks();
    renderMembers();
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- trocar o nome de uma pessoa ----------
  const escRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Troca `from` por `to` nos responsáveis das tarefas e na lista de integrantes da distribuição.
  // Com `alsoText`, troca também o nome inteiro (palavra exata) nos nomes e descrições das tarefas.
  // Não altera os objetos recebidos. `n` = tarefas alteradas; `members` = nova lista (ou null se igual).
  function renamePerson(tasks, members, from, to, alsoText) {
    const re = alsoText ? new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(from)}(?![\\p{L}\\p{N}_])`, 'gu') : null;
    const sub = (v) => (re && v ? v.replace(re, () => to) : v);
    let n = 0;
    const out = tasks.map((t) => {
      const r = { ...t };
      if (String(t.owner || '').trim() === from) r.owner = to;
      r.name = sub(t.name); r.desc = sub(t.desc);
      if (r.owner !== t.owner || r.name !== t.name || r.desc !== t.desc) n++;
      return r;
    });
    let mem = null;
    if (members && members.some((m) => m.trim() === from)) {
      mem = members.map((m) => (m.trim() === from ? to : m)).filter((m, i, arr) => arr.indexOf(m) === i);
    }
    return { tasks: out, members: mem, n };
  }

  // Pessoas (responsáveis e integrantes da distribuição) de uma lista de grafos, com a contagem de tarefas.
  function peopleOf(graphs) {
    const out = new Map();
    for (const g of graphs) {
      for (const t of g.tasks) { const o = String(t.owner || '').trim(); if (o) out.set(o, (out.get(o) || 0) + 1); }
      for (const m of (g.dist && g.dist.members) || []) if (!out.has(m)) out.set(m, 0);
    }
    return out;
  }

  function showRenamePerson() {
    const inGraph = !!state.graph;
    // o grafo aberto vale pelo rascunho do painel (pode estar mais novo que o salvo)
    const current = () => ({ ...state.graph, tasks: state.draft });
    const others = () => store.list().filter((g) => !inGraph || g.id !== state.graph.id);
    const scopeGraphs = (all) => (inGraph ? [current(), ...(all ? others() : [])] : others());

    const sel = h('select', { 'aria-label': 'Pessoa a substituir' });
    const input = h('input', { placeholder: 'Novo nome', 'aria-label': 'Novo nome', maxlength: 60 });
    const textOpt = h('input', { type: 'checkbox' });
    const allOpt = h('input', { type: 'checkbox', checked: !inGraph, disabled: !inGraph });
    const info = h('p', { class: 'hint', 'aria-live': 'polite' });
    const go = h('button', { class: 'primary', text: 'Trocar', disabled: true });

    const fill = () => {
      const prev = sel.value;
      const people = peopleOf(scopeGraphs(allOpt.checked));
      sel.replaceChildren(h('option', { value: '', text: people.size ? 'Escolha a pessoa…' : 'Nenhuma pessoa cadastrada' }),
        ...[...people].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([name, k]) =>
          h('option', { value: name, text: `${name} (${k} tarefa${k === 1 ? '' : 's'})` })));
      sel.value = people.has(prev) ? prev : '';
      return people;
    };
    const plan = () => {
      const from = sel.value, to = input.value.trim().slice(0, 60), gs = scopeGraphs(allOpt.checked);
      let tasksN = 0, graphsN = 0;
      if (from && to && to !== from) {
        for (const g of gs) {
          const r = renamePerson(g.tasks, g.dist && g.dist.members, from, to, textOpt.checked);
          if (r.n || r.members) graphsN++;
          tasksN += r.n;
        }
      }
      return { from, to, gs, tasksN, graphsN };
    };
    const update = () => {
      const people = peopleOf(scopeGraphs(allOpt.checked));
      const { from, to, tasksN, graphsN } = plan();
      go.disabled = !from || !to || to === from;
      const merge = from && to && to !== from && people.has(to);
      info.textContent = !from || !to ? 'Escolha quem será substituído e digite o novo nome.'
        : to === from ? 'O novo nome é igual ao atual.'
        : `Vai alterar ${tasksN} tarefa${tasksN === 1 ? '' : 's'} em ${graphsN} grafo${graphsN === 1 ? '' : 's'}.` +
          (merge ? ` "${to}" já existe: as tarefas das duas pessoas ficarão juntas.` : '');
    };
    sel.addEventListener('change', update);
    input.addEventListener('input', update);
    textOpt.addEventListener('change', update);
    allOpt.addEventListener('change', () => { fill(); update(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });

    go.addEventListener('click', () => {
      const { from, to, gs, tasksN } = plan();
      if (!from || !to || to === from) return;
      const failed = [];
      for (const g of gs) {
        const r = renamePerson(g.tasks, g.dist && g.dist.members, from, to, textOpt.checked);
        if (!r.n && !r.members) continue;
        const dist = g.dist && r.members ? { ...g.dist, members: r.members } : g.dist;
        if (inGraph && g.id === state.graph.id) {
          state.draft = r.tasks; // rascunho do painel; o salvamento normal grava (ou avisa dos erros)
          state.graph = { ...state.graph, dist };
        } else {
          try { store.put({ ...g, tasks: r.tasks, dist }); } catch { failed.push(g.name); }
        }
      }
      if (inGraph) {
        if (state.owner === from) state.owner = to;
        renderRows();
        redraw();
        persist();
      }
      dlg.close();
      if (!inGraph) renderHome();
      toast(failed.length ? `Não foi possível salvar: ${failed.join(', ')}.` : `"${from}" trocado por "${to}" em ${tasksN} tarefa${tasksN === 1 ? '' : 's'}.`);
    });

    const dlg = h('dialog', { class: 'summary' },
      h('h2', { text: 'Trocar nome de uma pessoa' }),
      h('p', { class: 'hint', text: 'Substitui o nome nos responsáveis das tarefas e na lista de integrantes da distribuição. Para juntar duas pessoas, use o nome de quem já existe.' }),
      h('label', { class: 'rfield' }, h('span', { text: 'Trocar' }), sel),
      h('label', { class: 'rfield' }, h('span', { text: 'Por' }), input),
      inGraph ? h('label', { class: 'opt' }, allOpt, 'Aplicar em todos os grafos (não só neste)') : null,
      h('label', { class: 'opt' }, textOpt, 'Trocar também nos nomes e descrições das tarefas (palavra exata)'),
      info,
      h('div', { class: 'summary-actions' },
        h('button', { text: 'Fechar', onclick: () => dlg.close() }), go));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    fill();
    update();
    document.body.append(dlg);
    dlg.showModal();
    sel.focus();
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
      h('button', { text: 'Resumo', title: 'Gerar o resumo das próximas tarefas', onclick: showSummary }),
      h('button', { text: 'Distribuir', title: 'Distribuir as tarefas entre a equipe automaticamente', onclick: showDistribute }),
      h('button', { text: 'Trocar nome', title: 'Trocar o nome de uma pessoa em todas as tarefas', onclick: showRenamePerson }),
      h('button', { text: 'Exportar', title: 'Baixar este grafo em um arquivo (para enviar a alguém ou guardar)', onclick: exportCurrent }),
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

  // ---------- exportar / importar ----------
  // Arquivo: { app, version, kind: 'graph' | 'backup', graphs: [...] }. Um grafo avulso usa o mesmo formato do
  // backup completo (com um único item em `graphs`), então os dois tipos de arquivo servem para importar.
  const slug = (str) => (str || 'grafo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'grafo';

  function download(filename, data) {
    const a = h('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
      download: filename,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportAll() {
    const graphs = store.list();
    if (!graphs.length) { toast('Não há grafos para exportar.'); return; }
    download(`grafos-tarefas-${new Date().toISOString().slice(0, 10)}.json`,
      { app: 'grafo-tarefas', version: 1, kind: 'backup', exportedAt: new Date().toISOString(), graphs });
  }

  function exportGraph(g) {
    download(`grafo-${slug(g.name)}-${new Date().toISOString().slice(0, 10)}.json`,
      { app: 'grafo-tarefas', version: 1, kind: 'graph', exportedAt: new Date().toISOString(), graphs: [g] });
    toast(`Grafo "${g.name}" exportado.`);
  }

  // Exporta o grafo aberto (grava antes o que ainda está pendente de salvar).
  function exportCurrent() {
    if (state.saveTimer) persist();
    if (state.unsaved) toast('O painel tem erros: exportando a última versão salva do grafo.');
    exportGraph(state.graph);
  }

  // Valida e limpa um grafo vindo de arquivo. Retorna null se não for aproveitável.
  // Identificador fora do padrão ganha um novo, para o grafo continuar independente dos demais.
  function sanitizeGraph(g) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.tasks)) return null;
    if (!g.tasks.every((t) => t && typeof t.id === 'string' && Array.isArray(t.deps))) return null;
    const tasks = g.tasks.map((t) => ({
      id: t.id.trim(), name: String(t.name ?? '').slice(0, 120), owner: String(t.owner ?? '').trim().slice(0, 60),
      desc: String(t.desc ?? '').slice(0, 1000), deps: [...new Set(t.deps.map((d) => String(d).trim()))], done: !!t.done }));
    if (validate(tasks).errors.length) return null;
    return {
      id: typeof g.id === 'string' && /^[a-z0-9-]{3,48}$/.test(g.id) ? g.id : store.newId(),
      name: (typeof g.name === 'string' && g.name.trim() ? g.name.trim() : 'Grafo importado').slice(0, 80),
      dist: cleanDist(g.dist),
      tasks,
    };
  }

  // Pergunta o que fazer com grafos que já existem aqui. Resolve com 'replace', 'copy' ou null (cancelar).
  function askConflict(names) {
    return new Promise((resolve) => {
      let answer = null;
      const pick = (v) => () => { answer = v; dlg.close(); };
      const dlg = h('dialog', { class: 'summary' },
        h('h2', { text: names.length === 1 ? 'Este grafo já existe' : 'Estes grafos já existem' }),
        h('p', { class: 'hint', text: `${names.map((n) => `"${n}"`).join(', ')} ${names.length === 1 ? 'já está' : 'já estão'} neste navegador. ` +
          'Substituir apaga a versão atual; importar como cópia mantém as duas.' }),
        h('div', { class: 'summary-actions' },
          h('button', { text: 'Cancelar', onclick: pick(null) }),
          h('button', { text: 'Importar como cópia', onclick: pick('copy') }),
          h('button', { class: 'primary', text: 'Substituir', onclick: pick('replace') })));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onerror = () => toast('Não foi possível ler o arquivo.');
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        // aceita backup/grafo exportado ({ graphs: [...] }) e também um grafo solto ({ id, name, tasks })
        const raw = Array.isArray(data && data.graphs) ? data.graphs : data && Array.isArray(data.tasks) ? [data] : [];
        const graphs = raw.map(sanitizeGraph).filter(Boolean);
        if (!graphs.length) { toast('Esse arquivo não tem grafos válidos.'); return; }
        const skipped = raw.length - graphs.length;
        const clash = graphs.filter((g) => store.get(g.id));
        let mode = 'replace';
        if (clash.length) {
          mode = await askConflict(clash.map((g) => g.name));
          if (!mode) { toast('Importação cancelada.'); return; }
        }
        for (const g of graphs) {
          if (mode === 'copy' && store.get(g.id)) store.put({ ...g, id: store.newId(), name: `${g.name} (cópia)`.slice(0, 80) });
          else store.put(g);
        }
        toast(`${graphs.length} grafo(s) importado(s).` + (skipped ? ` ${skipped} ignorado(s) por erro no arquivo.` : ''));
        renderHome();
      } catch (e) { toast(e instanceof SyntaxError ? 'Arquivo inválido: não é um JSON.' : (e.message || 'Arquivo inválido.')); }
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
    const { pos, edges, w, h: ht } = layout(g.tasks);
    const byId = new Map(g.tasks.map((t) => [t.id, t]));
    const svg = s('svg', { viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      svg.append(s('path', { d: edgePath(a.x + NW, a.y + NH / 2, e.lanes, b.x, b.y + NH / 2),
        class: 'm-edge' + (byId.get(e.from).done ? ' on' : '') }));
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
      onchange: (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; } });
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
        h('button', { class: 'tile-act tile-exp', title: 'Exportar este grafo', 'aria-label': `Exportar ${g.name}`, text: '⤓', onclick: () => exportGraph(g) }),
        h('button', { class: 'tile-act tile-del', title: 'Excluir grafo', 'aria-label': `Excluir ${g.name}`, text: '✕', onclick: () => {
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
        h('button', { text: 'Trocar nome de pessoa', title: 'Trocar o nome de uma pessoa em todos os grafos', onclick: showRenamePerson }),
        h('button', { text: 'Exportar backup', title: 'Exporta todos os grafos em um arquivo', onclick: exportAll }),
        h('button', { text: 'Importar', title: 'Importa um grafo exportado ou um backup completo', onclick: () => picker.click() }),
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
