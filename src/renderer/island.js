'use strict';

/*
 * La isla. Solo dibuja el estado que manda la app y devuelve tus decisiones; no tiene acceso a
 * Node ni a la red. Todo el texto entra con textContent.
 */

const FRAMES = { idle: 2, work: 3, ask: 2, done: 2, error: 2 };
/** La mascota celebra este tiempo después de terminar y luego vuelve a reposo. */
const DONE_MS = 12 * 1000;
const COLLAPSE_DELAY_MS = 350;

function relTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}

function activity(s) {
  return s.detail ? `${s.verb}: ${s.detail}` : s.verb || 'Lista';
}

/** Qué mostrar a partir del estado de la app. Sin DOM, para poder probarlo. */
function viewModel(state, now, hover) {
  const sessions = state.sessions || [];
  const pending = state.pending || [];
  const top = sessions[0] || null;
  // El reloj de la app y el de la isla son el mismo equipo, pero el estado llega con retraso.
  const age = (t) => now - t;

  let mascot = 'idle';
  if (pending.length) mascot = 'ask';
  else if (top) mascot = top.state === 'done' && age(top.since) > DONE_MS ? 'idle' : top.state;

  let title = 'Hoshii';
  let line = state.installed ? 'Sin sesiones de Claude Code' : 'Sin conectar';
  if (pending.length) {
    title = pending[0].project;
    line = 'Necesita tu permiso';
  } else if (top) {
    title = top.project;
    line = activity(top);
  }

  let badge = null;
  if (pending.length) badge = { text: String(pending.length), ask: true };
  else if (sessions.length > 1) badge = { text: String(sessions.length), ask: false };

  const showConnect = !state.installed;
  const showList = Boolean(hover) && sessions.length > 0 && !pending.length;
  const error = state.error || null;
  return {
    mascot,
    title,
    line,
    badge,
    ask: pending[0] || null,
    askCount: pending.length,
    showConnect,
    showList,
    error,
    wide: Boolean(pending.length || showList || showConnect || error),
    sessions: sessions.map((s) => ({
      id: s.id,
      state: s.state,
      name: s.project,
      act: activity(s),
      time: relTime(age(s.updatedAt)),
    })),
  };
}

/* ---------- DOM ---------- */

function startIsland() {
  const $ = (id) => document.getElementById(id);
  const island = $('island');
  let state = { sessions: [], pending: [], installed: true, approvals: true, shortcuts: true, waitMs: 90000 };
  let hover = false;
  let collapseTimer = null;
  let frameTimer = null;
  let mascotState = null;
  let frame = 0;
  let busy = false;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Precarga de cuadros para que la animación no parpadee.
  for (const [st, n] of Object.entries(FRAMES)) {
    for (let f = 0; f < n; f++) new Image().src = `sprites/${st}-${f}.png`;
  }

  function showFrame() {
    $('mascot').src = `sprites/${mascotState}-${frame}.png`;
  }

  /** Ritmo por estado: parpadeo ocasional en reposo, tecleo rápido al trabajar. */
  function nextFrame() {
    const n = FRAMES[mascotState];
    if (mascotState === 'idle') {
      frame = frame === 0 ? 1 : 0;
      showFrame();
      frameTimer = setTimeout(nextFrame, frame === 1 ? 140 : 2800 + Math.random() * 2400);
      return;
    }
    frame = (frame + 1) % n;
    showFrame();
    frameTimer = setTimeout(nextFrame, { work: 320, ask: 520, done: 420, error: 700 }[mascotState]);
  }

  function setMascot(next) {
    if (next === mascotState) return;
    mascotState = next;
    frame = 0;
    clearTimeout(frameTimer);
    showFrame();
    island.classList.toggle('bob', next === 'ask');
    island.classList.remove('shake');
    if (next === 'error') {
      void island.offsetWidth; // reinicia la animación
      island.classList.add('shake');
    }
    if (!reduceMotion) frameTimer = setTimeout(nextFrame, 400);
  }

  function renderList(items) {
    const list = $('list');
    list.replaceChildren(
      ...items.map((s) => {
        const li = document.createElement('li');
        const dot = document.createElement('span');
        dot.className = `dot ${s.state}`;
        const name = document.createElement('span');
        name.className = 's-name';
        name.textContent = s.name;
        const time = document.createElement('span');
        time.className = 's-time';
        time.textContent = s.time;
        const act = document.createElement('span');
        act.className = 's-act';
        act.textContent = s.act;
        li.append(dot, name, time, act);
        return li;
      }),
    );
  }

  function renderTimer() {
    const p = state.pending[0];
    if (!p) return;
    const left = Math.max(0, p.expiresAt - Date.now());
    $('timer-bar').style.width = `${(left / Math.max(1, p.expiresAt - p.createdAt)) * 100}%`;
  }

  function render() {
    const vm = viewModel(state, Date.now(), hover);
    setMascot(vm.mascot);
    $('title').textContent = vm.title;
    $('line').textContent = vm.line;
    const badge = $('badge');
    badge.hidden = !vm.badge;
    if (vm.badge) {
      badge.textContent = vm.badge.text;
      badge.classList.toggle('ask', vm.badge.ask);
    }

    $('ask').hidden = !vm.ask;
    if (vm.ask) {
      $('ask-project').textContent = vm.ask.project;
      $('ask-action').textContent = `${vm.ask.action}:`;
      $('ask-count').textContent = vm.askCount > 1 ? `(1 de ${vm.askCount})` : '';
      $('ask-text').textContent = vm.ask.text || '(sin detalle)';
      $('ask-keys').hidden = !state.shortcuts;
      renderTimer();
    }
    $('connect').hidden = !vm.showConnect;
    $('list').hidden = !vm.showList;
    if (vm.showList) renderList(vm.sessions);
    $('error').hidden = !vm.error;
    $('error').textContent = vm.error || '';
    island.classList.toggle('wide', vm.wide);
  }

  async function decide(decision) {
    const p = state.pending[0];
    if (!p || busy) return;
    busy = true;
    try {
      await window.hoshii.decide(p.id, decision);
    } finally {
      busy = false;
    }
  }

  $('btn-allow').addEventListener('click', () => decide('allow'));
  $('btn-deny').addEventListener('click', () => decide('deny'));
  $('btn-terminal').addEventListener('click', () => decide('none'));
  $('btn-connect').addEventListener('click', async () => {
    $('btn-connect').disabled = true;
    try {
      await window.hoshii.connect();
    } finally {
      $('btn-connect').disabled = false;
    }
  });

  // Clic derecho: el menú de ajustes (en GNOME sin AppIndicator no hay ícono de bandeja).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.hoshii.menu();
  });

  island.addEventListener('mouseenter', () => {
    clearTimeout(collapseTimer);
    hover = true;
    render();
  });
  island.addEventListener('mouseleave', () => {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      hover = false;
      render();
    }, COLLAPSE_DELAY_MS);
  });

  // La ventana mide exactamente lo que mide la isla (más el margen de la sombra).
  new ResizeObserver(() => {
    const r = document.body.getBoundingClientRect();
    window.hoshii.resize(Math.ceil(r.width), Math.ceil(r.height));
  }).observe(document.body);

  window.hoshii.onState((next) => {
    state = next;
    render();
  });
  setInterval(renderTimer, 250);
  setInterval(render, 15 * 1000); // tiempos relativos y fin de la celebración
  render();
}

if (typeof module !== 'undefined') module.exports = { viewModel, relTime, DONE_MS };
else startIsland();
