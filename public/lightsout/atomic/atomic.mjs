/* Copyright 2026 MFENX. All rights reserved. */
import {LEVELS, MODULES, getDemoBoard, getDefaultBoard, boardCost} from './levels.mjs';

const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('en-US').format(value);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = {level: 0, board: getDemoBoard(0), seed: LEVELS[0].seed, selected: 2, busy: false,
  report: null, sequence: 0, revision: 0, worker: null, deadline: null, undo: [], completed: new Set(), paused: reducedMotion.matches, ready: false};
const kernelColors = {q32: '#a5adc1', q24: '#b7a1e8', q16: '#73d8d4', q8: '#efb56d', annihilated: '#b7ec8c'};
const views = [];
let renderingClosed = false;
const world = Object.fromEntries(['setBoard', 'accept', 'invalidate', 'setPaused', 'dispose'].map(method => [method, (...args) => {
  if (method === 'dispose') renderingClosed = true;
  for (const view of views) view[method](...args);
}]));

function rememberDesign() {
  state.undo.push({board: [...state.board], seed: state.seed});
  if (state.undo.length > 64) state.undo.shift();
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

const sound = {
  enabled: false, context: null, gain: null, oscillators: [],
  async toggle() {
    if (!this.enabled) {
      try {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) throw new Error('Sound is unavailable in this browser.');
        if (!this.context) {
          this.context = new Audio(); this.gain = this.context.createGain(); this.gain.gain.value = 0;
          const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220;
          this.gain.connect(filter); filter.connect(this.context.destination);
          for (const frequency of [55, 82.41]) {
            const oscillator = this.context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
            oscillator.connect(this.gain); oscillator.start(); this.oscillators.push(oscillator);
          }
        }
        await this.context.resume(); this.gain.gain.setTargetAtTime(.045, this.context.currentTime, .5); this.enabled = true;
      } catch { $('sound-state').textContent = 'N/A'; $('sound-toggle').disabled = true; return; }
    } else { this.enabled = false; this.gain.gain.setTargetAtTime(0, this.context.currentTime, .15); }
    $('sound-toggle').setAttribute('aria-pressed', String(this.enabled));
    $('sound-toggle').setAttribute('aria-label', this.enabled ? 'Disable reactor sound' : 'Enable reactor sound');
    $('sound-state').textContent = this.enabled ? 'ON' : 'OFF';
  },
  tone(kind) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const frequencies = kind === 'win' ? [220, 330, 440, 660] : kind === 'run' ? [110, 165] : [440];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      const start = this.context.currentTime + index * .09, duration = kind === 'win' ? .65 : .12;
      oscillator.frequency.value = frequency; oscillator.type = 'sine';
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.045, start + .02); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain); gain.connect(this.context.destination); oscillator.start(start); oscillator.stop(start + duration + .01);
      oscillator.addEventListener('ended', () => {oscillator.disconnect(); gain.disconnect();}, {once: true});
    });
  }
};

function buildControls() {
  for (const level of LEVELS) {
    const button = node('button', '', ''); button.type = 'button'; button.dataset.level = String(level.id);
    button.append(node('span', '', String(level.id + 1).padStart(2, '0')), node('b', '', level.name), node('span', 'mission-check', ''));
    button.addEventListener('click', () => setLevel(level.id)); $('mission-tabs').append(button);
  }
  for (const module of MODULES) {
    const button = node('button'); button.type = 'button'; button.dataset.module = String(module.id);
    button.style.setProperty('--module', module.color);
    button.setAttribute('aria-label', `${module.name}: ${module.sign < 0 ? 'negative ' : ''}2 to the ${module.shift}, cost ${module.cost}. ${module.description}`);
    button.title = `${module.description} Cost: ${module.cost}. Shortcut: ${module.id + 1}`;
    button.append(node('span', 'module-key', String(module.id + 1)), node('i', 'module-crystal'), node('span', 'module-name', module.name), node('span', 'module-shift', `${module.sign < 0 ? '−' : ''}2^${module.shift}`));
    button.addEventListener('click', () => selectModule(module.id)); $('module-palette').append(button);
  }
  for (let index = 0; index < 16; index++) {
    const button = node('button'); button.type = 'button'; button.dataset.cell = String(index);
    button.append(node('span', 'cell-coordinate', `${Math.floor(index / 4) + 1}:${index % 4 + 1}`), node('span', 'cell-content'), node('span', 'cell-name'));
    button.addEventListener('click', () => placeModule(index)); $('lattice-grid').append(button);
  }
}

function selectModule(id) {
  if (state.busy) return;
  state.selected = id;
  for (const button of $('module-palette').children) button.setAttribute('aria-pressed', String(Number(button.dataset.module) === id));
  const module = MODULES[id];
  $('selection-help').textContent = `${module.name} selected · cost ${module.cost}. ${module.description}`;
}

function clearResult() {
  state.report = null; world.invalidate();
  $('world-caption').textContent = 'Unverified design. Run the reactor to discover its exact result.';
  $('next-mission').hidden = true;
  for (const id of ['logical-macs', 'executed-macs', 'annihilation-ratio', 'replay-macs', 'stage-one-work', 'stage-two-work', 'stage-one-promotions', 'zero-tiles']) $(id).textContent = '—';
  $('telemetry-state').textContent = 'DESIGN AWAITING REPLAY';
  $('stage-one-ring').textContent = $('stage-two-ring').textContent = 'Q—';
  $('stage-one-bar').replaceChildren(); $('stage-two-bar').replaceChildren();
  $('proof-title').textContent = 'Trust the replay.';
  $('proof-description').textContent = 'This design has not been accepted yet. Run the reactor to execute QQfenx and independently check every word.';
  $('proof-symbol').classList.remove('pass'); $('proof-symbol').querySelector('span').textContent = '≡';
  $('proof-light').classList.remove('pass');
  $('receipt-hash').textContent = 'Run the reactor to create a receipt.';
  $('export-receipt').disabled = true;
  $('timing').textContent = 'Engine and replay timing appears after execution.';
  for (const [id, label] of [['rail-execute', 'READY'], ['rail-replay', 'WAITING'], ['rail-accept', 'LOCKED']]) {$(id).className = ''; $(id).querySelector('b').textContent = label;}
}

function drawObjectives(report = null) {
  const level = LEVELS[state.level];
  const objectives = report?.objectives || [
    {label: `Matter cost ≤ ${level.budget}`, passed: false},
    {label: `${level.targets.zeroTiles} / 16 zero output tiles`, passed: false},
    {label: `${format(level.targets.minAnnihilated)} annihilated MACs`, passed: false},
    {label: `${level.targets.minPromotedTiles} cancellation promotions`, passed: false}
  ];
  $('objectives').replaceChildren(...objectives.map(value => {
    const item = node('li', value.passed ? 'pass' : ''); item.append(node('span', '', value.label));
    if (report) item.append(node('span', 'objective-value', value.target === 0 ? `${format(value.actual)} · optional` : `${format(value.actual)} / ${format(value.target)}`));
    return item;
  }));
}

function drawBoard() {
  const level = LEVELS[state.level], cost = boardCost(state.board);
  $('mission-name').textContent = level.name; $('mission-briefing').textContent = level.briefing;
  $('mission-hint').textContent = level.hint; $('mission-number').textContent = `${String(level.id + 1).padStart(2, '0')} / 04`;
  $('matrix-geometry').textContent = `${level.n} × ${level.n} · tile ${level.tile}`;
  $('matter-cost').textContent = String(cost); $('matter-budget').textContent = String(level.budget);
  $('budget-track').setAttribute('aria-valuemax', String(level.budget)); $('budget-track').setAttribute('aria-valuenow', String(Math.min(cost, level.budget)));
  $('budget-track').setAttribute('aria-valuetext', `${cost} of ${level.budget} matter${cost > level.budget ? ', over budget' : ''}`);
  $('budget-track').classList.toggle('over', cost > level.budget);
  $('budget-fill').style.width = `${Math.min(100, cost / level.budget * 100)}%`;
  for (const button of $('mission-tabs').children) {
    const id = Number(button.dataset.level); button.setAttribute('aria-pressed', String(id === state.level));
    button.querySelector('.mission-check').textContent = state.completed.has(id) ? '✓' : '';
  }
  for (const [index, button] of [...$('lattice-grid').children].entries()) {
    const module = MODULES[state.board[index]];
    button.style.setProperty('--module', module.color);
    button.querySelector('.cell-content').textContent = `${module.sign < 0 ? '−' : ''}2${module.shift === 0 ? '⁰' : module.shift === 8 ? '⁸' : module.shift === 12 ? '¹²' : '¹⁶'}`;
    button.querySelector('.cell-name').textContent = module.name.toUpperCase();
    button.setAttribute('aria-label', `Row ${Math.floor(index / 4) + 1}, column ${index % 4 + 1}: ${module.name}. Place selected module.`);
    button.classList.toggle('zero-tile', state.report?.stages[1].shifts[index] === 32);
  }
  $('undo').disabled = state.busy || !state.undo.length;
  drawObjectives(state.report);
}

function placeModule(index) {
  if (state.busy || !Number.isInteger(index) || index < 0 || index > 15 || state.board[index] === state.selected) return;
  rememberDesign(); state.revision++;
  state.board[index] = state.selected; clearResult(); drawBoard(); world.setBoard(state.board, MODULES);
  $('design-state').textContent = 'CUSTOM DESIGN'; $('run-message').className = 'run-message';
  $('run-message').textContent = 'Lattice changed. Run again to accept this exact design.';
  $('world-caption').textContent = `${MODULES[state.selected].name} placed. The next quotient is yours to discover.`;
  sound.tone('edit');
}

function setLevel(id) {
  if (state.busy || id === state.level) return;
  state.revision++;
  state.level = id; state.seed = LEVELS[id].seed; state.board = getDefaultBoard(id); state.undo = [];
  clearResult(); drawBoard(); world.setBoard(state.board, MODULES);
  $('design-state').textContent = 'OPEN CHALLENGE'; $('run-message').className = 'run-message';
  $('run-message').textContent = 'An uncontained reactor. Build a solution or inspect the guided design.';
  $('world-caption').textContent = `${LEVELS[id].name} · ${LEVELS[id].n} × ${LEVELS[id].n} matrices`;
}

function setPreset(guided) {
  if (state.busy) return;
  rememberDesign(); state.revision++;
  state.board = guided ? getDemoBoard(state.level) : getDefaultBoard(state.level);
  state.seed = LEVELS[state.level].seed; clearResult(); drawBoard(); world.setBoard(state.board, MODULES);
  $('design-state').textContent = guided ? 'GUIDED DESIGN' : 'OPEN CHALLENGE';
  $('run-message').className = 'run-message'; $('run-message').textContent = guided ? 'A guided solution is loaded. Execute it, then experiment with what makes it work.' : 'Lattice reset. Find your own path to containment.';
}

function setBusy(value) {
  state.busy = value; document.body.classList.toggle('busy', value);
  for (const button of document.querySelectorAll('#mission-tabs button, #module-palette button, #lattice-grid button, #demo-design, #reset-design, #import-receipt')) button.disabled = value;
  $('execute').disabled = value; $('hero-run').disabled = value;
  $('undo').disabled = value || !state.undo.length;
  $('execute').firstChild.textContent = value ? 'Reactor executing… ' : 'Run exact collapse ';
}

function fail(message) {
  state.ready = false; state.revision++;
  clearTimeout(state.deadline); state.worker?.terminate(); state.worker = null;
  clearResult(); setBusy(false); drawBoard();
  $('run-message').className = 'run-message error'; $('run-message').textContent = `${message} No result was accepted. Run again to retry.`;
  $('engine-status').dataset.state = 'error'; $('engine-status').lastChild.textContent = ' Reactor awaiting a fresh verified execution';
  $('proof-title').textContent = 'Acceptance withheld.';
  $('proof-description').textContent = 'The engine or independent check did not complete successfully. No score or replay receipt was issued.';
  $('telemetry-state').textContent = 'NO ACCEPTED RESULT';
  $('hero-run').firstChild.textContent = 'Retry the reactor ';
}

function rail(id, status, label) { $(id).className = status; $(id).querySelector('b').textContent = label; }

function ensureWorker() {
  if (state.worker) return;
  const worker = new Worker(new URL('./simulation-worker.mjs?v=1', import.meta.url), {type: 'module', name: 'MFENX exact reactor'});
  state.worker = worker;
  worker.addEventListener('error', event => {event.preventDefault(); if (state.worker === worker) fail('The browser reactor could not start.');});
  worker.addEventListener('messageerror', () => {if (state.worker === worker) fail('The reactor message could not be read.');});
  worker.addEventListener('message', event => {
    if (state.worker !== worker || !state.busy || event.data?.id !== state.sequence) return;
    const message = event.data;
    if (message.type === 'progress') {
      if (message.phase === 'execute') {rail('rail-execute', 'active', 'RUNNING'); $('telemetry-state').textContent = 'EXECUTING QQFENX';}
      if (message.phase === 'replay') {rail('rail-execute', 'pass', 'COMPLETE'); rail('rail-replay', 'active', 'REPLAYING'); $('telemetry-state').textContent = 'INDEPENDENT REPLAY';}
    } else if (message.type === 'error') fail(typeof message.error?.message === 'string' ? message.error.message : 'The exact result was rejected.');
    else if (message.type === 'result') {
      clearTimeout(state.deadline);
      if (message.report?.schema !== 'mfenx.atomic-report.v1' || message.report.verified !== true) {fail('The acceptance report is invalid.'); return;}
      accept(message.report);
    }
  });
}

function run(capsule = null) {
  if (state.busy) return;
  state.revision++;
  clearResult(); drawBoard(); setBusy(true); sound.tone('run');
  $('run-message').className = 'run-message'; $('run-message').textContent = capsule ? 'Rebuilding the shared lattice and independently replaying its result.' : 'Executing two exact contractions, then checking every output word.';
  $('engine-status').dataset.state = 'pending'; $('engine-status').lastChild.textContent = ' C11 execution → independent full-ring replay';
  state.sequence = (state.sequence + 1) >>> 0;
  try {
    ensureWorker();
    state.deadline = setTimeout(() => fail('Execution exceeded the 20-second browser deadline.'), 20000);
    state.worker.postMessage(capsule ? {id: state.sequence, type: 'replay', capsule} : {id: state.sequence, type: 'run', level: state.level, seed: state.seed, board: [...state.board]});
  } catch {fail('WebAssembly workers are unavailable in this browser.');}
}

function kernelBar(id, metrics) {
  const bars = [];
  for (const [name, value] of Object.entries(kernelColors)) if (metrics[name] > 0) {
    const segment = node('i'); segment.style.setProperty('--module', value); segment.style.flexGrow = String(metrics[name]);
    segment.title = `${name === 'annihilated' ? 'Zero payload' : name.toUpperCase()}: ${format(metrics[name])} MACs`; bars.push(segment);
  }
  $(id).replaceChildren(...bars);
  $(id).setAttribute('aria-label', Object.keys(kernelColors).filter(name => metrics[name] > 0).map(name => `${name}: ${metrics[name]} MACs`).join(', '));
}

function ringLabel(metrics) {
  const active = ['q8', 'q16', 'q24', 'q32'].filter(key => metrics[key] > 0);
  if (!active.length) return 'ZERO';
  if (active.length === 1) return active[0].toUpperCase();
  return `${active[0].slice(1)}–${active.at(-1).slice(1)}b`;
}

function accept(report) {
  state.report = report; state.level = report.level; state.board = [...report.board]; state.seed = report.seed; state.ready = true;
  if (report.won) state.completed.add(report.level);
  setBusy(false); drawBoard(); world.setBoard(state.board, MODULES); world.accept(report);
  const totals = report.totals;
  $('logical-macs').textContent = format(totals.requested); $('executed-macs').textContent = format(totals.executed);
  $('annihilation-ratio').textContent = (100 * totals.annihilated / totals.requested).toFixed(1); $('replay-macs').textContent = format(totals.replay_macs);
  $('telemetry-state').textContent = report.won ? 'EXACT / CONTAINED' : 'EXACT / KEEP ENGINEERING';
  $('proof-title').textContent = report.won ? 'Reactor contained.' : 'Exact. Not contained.';
  $('proof-description').textContent = report.won ? 'Every output word matched the independent full-ring replay. Your design meets every mission objective.' : 'Every output word matched. The computation is accepted; the design still needs work to meet its mission objectives.';
  $('proof-symbol').classList.add('pass'); $('proof-symbol').querySelector('span').textContent = '✓'; $('proof-light').classList.add('pass');
  rail('rail-execute', 'pass', 'COMPLETE'); rail('rail-replay', 'pass', 'MATCH'); rail('rail-accept', 'pass', 'ACCEPTED');
  $('receipt-hash').textContent = report.capsule.sha256; $('export-receipt').disabled = false;
  $('engine-status').dataset.state = 'ready'; $('engine-status').lastChild.textContent = ' C11 QQfenx online · independent replay passed';
  $('hero-run').firstChild.textContent = 'Enter the reactor ';
  $('run-message').className = 'run-message';
  $('run-message').textContent = report.won ? `${LEVELS[report.level].name} contained. ${format(totals.annihilated)} payload MACs annihilated; all ${format(totals.replay_macs)} replay MACs checked. Explore another mission or refine your design.` : 'Exact replay passed. Adjust your modules to meet the containment, budget and cancellation objectives.';
  $('next-mission').hidden = !report.won || report.level === LEVELS.length - 1;
  $('world-caption').textContent = `${totals.zero_tiles} / 16 sectors contained · ${report.won ? 'mission accepted' : 'keep engineering'}`;
  report.stages.forEach((stage, index) => {
    const prefix = index ? 'stage-two' : 'stage-one';
    $(prefix + '-ring').textContent = ringLabel(stage.metrics);
    $(prefix + '-work').textContent = `${format(stage.metrics.executed)} / ${format(stage.metrics.requested)}`;
    kernelBar(prefix + '-bar', stage.metrics);
  });
  $('stage-one-promotions').textContent = format(report.stages[0].metrics.promoted_tiles);
  $('zero-tiles').textContent = `${totals.zero_tiles} / 16`;
  $('timing').textContent = `THIS RUN · C11 ${report.timings.engineMs.toFixed(2)} ms · full-ring replay ${report.timings.replayMs.toFixed(2)} ms`;
  $('engine-identity').textContent = `C11 portable scalar · one worker · ${format(report.engine.bytes)}-byte module · ${report.engine.memoryBytes / 1048576} MiB fixed WebAssembly linear memory · ${report.engine.arenaBytes / 1048576} MiB engine arena. SHA-256: ${report.engine.sha256}. Browser rendering and independent replay use separate browser memory.`;
  sound.tone(report.won ? 'win' : 'edit');
}

$('hero-run').addEventListener('click', () => {
  if (!state.ready) run();
  $('reactor').scrollIntoView({behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start'});
  $('reactor').focus({preventScroll: true});
});
$('execute').addEventListener('click', () => run());
$('demo-design').addEventListener('click', () => setPreset(true));
$('reset-design').addEventListener('click', () => setPreset(false));
$('undo').addEventListener('click', () => {
  if (state.busy || !state.undo.length) return;
  const previous = state.undo.pop(); state.board = previous.board; state.seed = previous.seed; state.revision++;
  clearResult(); drawBoard(); world.setBoard(state.board, MODULES);
  $('design-state').textContent = 'CUSTOM DESIGN'; $('run-message').textContent = 'Edit undone. Replay this restored design to accept it.';
});
$('sound-toggle').addEventListener('click', () => {void sound.toggle();});
$('next-mission').addEventListener('click', () => {if (!state.busy && state.level < LEVELS.length - 1) setLevel(state.level + 1);});
function updateMotion() {
  world.setPaused(state.paused); $('motion-toggle').setAttribute('aria-pressed', String(state.paused));
  $('motion-toggle').firstChild.textContent = state.paused ? 'Resume orbit ' : 'Pause orbit ';
}
$('motion-toggle').addEventListener('click', () => {state.paused = !state.paused; updateMotion();});
reducedMotion.addEventListener('change', event => {state.paused = event.matches; updateMotion();});
$('how-to-play').addEventListener('click', () => $('instructions').showModal());
$('close-instructions').addEventListener('click', () => $('instructions').close());
$('start-playing').addEventListener('click', () => {$('instructions').close(); $('reactor').scrollIntoView({behavior: reducedMotion.matches ? 'auto' : 'smooth'}); $('reactor').focus({preventScroll: true});});
$('export-receipt').addEventListener('click', () => {
  if (!state.report || state.busy) return;
  const blob = new Blob([JSON.stringify(state.report.capsule, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob), link = node('a'); link.href = url;
  link.download = `atomic-roc-${state.report.capsule.sha256.slice(0, 16)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
});
$('import-receipt').addEventListener('click', () => {if (!state.busy) $('capsule-file').click();});
$('capsule-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file || state.busy) return;
  const revision = ++state.revision;
  if (file.size > 8192) {fail('Capsule rejected: the maximum file size is 8 KiB.'); return;}
  try {
    const capsule = JSON.parse(await file.text());
    if (state.busy || state.revision !== revision) return;
    state.undo = []; $('design-state').textContent = 'SHARED REPLAY'; run(capsule);
  } catch {if (state.revision === revision && !state.busy) fail('Capsule rejected: select a valid exported JSON replay capsule.');}
});
document.addEventListener('keydown', event => {
  if (state.busy || $('instructions').open || event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (/^[1-5]$/.test(event.key)) {event.preventDefault(); selectModule(Number(event.key) - 1);}
});
document.addEventListener('visibilitychange', () => {
  if (!sound.context) return;
  if (document.hidden) void sound.context.suspend().catch(() => {});
  else if (sound.enabled) void sound.context.resume().catch(() => {});
});
window.addEventListener('pagehide', event => {
  state.revision++;
  if (event.persisted) {
    if (state.busy) fail('The active run was stopped when this page was left.');
    world.setPaused(true);
    if (sound.context) void sound.context.suspend().catch(() => {});
    return;
  }
  clearTimeout(state.deadline); state.worker?.terminate(); state.worker = null;
  world.dispose(); if (sound.context) void sound.context.close().catch(() => {});
});
window.addEventListener('pageshow', event => {if (event.persisted) world.setPaused(state.paused);});

buildControls(); selectModule(2); drawBoard(); world.setBoard(state.board, MODULES); updateMotion();
run();
// Visual assets are optional; loading them must never gate the exact reactor.
void import('./world.mjs').then(({createWorld}) => {
  if (renderingClosed) return;
  for (const id of ['world', 'reactor-world']) {
    try {
      const view = createWorld($(id), index => placeModule(index));
      views.push(view); view.setBoard(state.board, MODULES); view.setPaused(state.paused);
      if (state.report) view.accept(state.report);
    } catch { /* The accessible tile grid remains the complete game interface. */ }
  }
}).catch(() => { /* Arithmetic and replay remain available without the renderer. */ });
