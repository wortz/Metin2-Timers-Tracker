import { addHydra, setHydra, subscribeToRecentHydraDays } from "./hydras.js";
import {
  MAX_CHESTS_PER_HYDRA,
  MAX_TIMERS,
  QUICK_CHESTS,
  dateKey,
  dayTotals,
  formatNumber,
  newTimer,
  normalizeTimers,
} from "./hydras-rules.js";

// Página "Fazer Hidra": cronómetros de 20 minutos entre hidras (podes ter vários ao mesmo tempo).
//   Começar → corre o cronómetro e aparecem os botões 0–5 (cofres recebidos nesta hidra).
//   Ao chegar a 0 toca um som, volta a 20:00 e fica parado; só se começa de novo depois de marcar
//   os cofres recebidos (se já os marcaste durante a contagem, basta carregar em Começar).
// Todos os cronómetros adicionam ao mesmo histórico de hoje. O estado fica guardado em cada browser
// (localStorage, por utilizador): não é partilhado entre dispositivos.

export const HYDRA_MINUTES = 20;
const DURATION_MS = HYDRA_MINUTES * 60 * 1000;
// Aviso (3 beeps) quando ainda faltam 17:20 no cronómetro.
const WARN_REMAINING_MS = (17 * 60 + 20) * 1000;
const VOICE_URL = "assets/sounds/hydra-alert.mp3";
const WARNING_URL = "assets/sounds/hydra-warning.mp3";

const listEl = document.getElementById("hydra-timer-list");
const addTimerBtn = document.getElementById("hydra-timer-add");
const todayEl = document.getElementById("hydra-timer-today");
const chipsEl = document.getElementById("hydra-timer-chips");
const soundToggle = document.getElementById("hydra-timer-sound");
const warnToggle = document.getElementById("hydra-timer-warn");
const soundTestBtn = document.getElementById("hydra-timer-sound-test");

let ownerUid = null;
let timers = normalizeTimers(null);
let timerLoaded = false; // só depois de ler o estado guardado

const storageKey = () => `hydraTimers:${ownerUid}`;

function loadTimers() {
  try {
    return normalizeTimers(JSON.parse(localStorage.getItem(storageKey()) || "null"));
  } catch {
    return normalizeTimers(null);
  }
}

function saveTimers() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ timers }));
  } catch {
    // sem localStorage: os timers só vivem enquanto a página estiver aberta
  }
}
let tickTimer = null;
let audioCtx = null;
const warnedFor = new Map(); // id do timer -> endAt da contagem que já deu o aviso
const displays = new Map(); // id do timer -> elemento com o tempo
let todayDays = [];

// ---------- Som ----------
// Os sons são agendados no relógio do áudio (Web Audio) no momento em que o timer começa. Assim
// tocam à hora certa mesmo com a página em segundo plano, onde o browser atrasa os temporizadores
// normais (por vezes até um minuto). O browser só deixa tocar áudio depois de uma interação com a
// página, por isso o áudio é preparado no primeiro clique/tecla e os timers em curso agendam-se nessa altura.
function soundOn() {
  return soundToggle.checked;
}

let alertGain = null; // volume do alerta final (ligado/desligado pelo toggle "Som")
let warnGain = null; // volume do aviso dos 17:20 (toggles "Som" e "Aviso")
const buffers = new Map(); // url -> AudioBuffer (ou null se falhou)
const scheduled = new Map(); // id do timer -> { endAt, nodes } dos sons já agendados

function applyGains() {
  if (alertGain) alertGain.gain.value = soundOn() ? 1 : 0;
  if (warnGain) warnGain.gain.value = soundOn() && warnToggle.checked ? 1 : 0;
}

async function loadBuffer(url) {
  try {
    const response = await fetch(url);
    buffers.set(url, await audioCtx.decodeAudioData(await response.arrayBuffer()));
  } catch {
    buffers.set(url, null); // sem a gravação, ficam só os beeps
  }
  // Volta a agendar os timers em curso, agora com a gravação incluída.
  for (const done of scheduled.values()) for (const node of done.nodes) node.stop();
  scheduled.clear();
  syncSchedule();
}

// Cria/retoma o contexto de áudio (precisa de ser chamado a partir de uma interação do utilizador).
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!alertGain) {
      alertGain = audioCtx.createGain();
      warnGain = audioCtx.createGain();
      alertGain.connect(audioCtx.destination);
      warnGain.connect(audioCtx.destination);
      applyGains();
      for (const url of [VOICE_URL, WARNING_URL]) loadBuffer(url);
    }
  } catch {
    audioCtx = null;
  }
}

function tone(freq, at, length, dest, nodes, volume = 0.25) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(dest);
  osc.start(at);
  osc.stop(at + length + 0.05);
  nodes.push(osc);
}

function playBuffer(url, at, dest, nodes) {
  const buffer = buffers.get(url);
  if (!buffer) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(dest);
  source.start(at);
  nodes.push(source);
}

// "Hidra Available": um toque ascendente (dó–mi–sol–dó), repetido duas vezes, e a gravação.
function scheduleAlert(at, dest, nodes) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  for (let round = 0; round < 2; round++) {
    notes.forEach((freq, i) => tone(freq, at + round * 0.9 + i * 0.16, round === 1 && i === 3 ? 0.6 : 0.22, dest, nodes));
  }
  playBuffer(VOICE_URL, at + 1.9, dest, nodes);
}

// Aviso dos 17:20: dois beeps curtos e depois a gravação.
function scheduleWarning(at, dest, nodes) {
  for (let i = 0; i < 2; i++) tone(880, at + i * 0.25, 0.15, dest, nodes);
  playBuffer(WARNING_URL, at + 0.7, dest, nodes);
}

// Botão "Testar som": toca já o alerta (ignora os toggles).
function playHydraAvailable() {
  unlockAudio();
  if (audioCtx) scheduleAlert(audioCtx.currentTime + 0.05, audioCtx.destination, []);
}

// Agenda os sons dos timers a contar (e cancela os de timers que mudaram ou pararam).
function syncSchedule() {
  if (!audioCtx || !alertGain) return;
  const now = Date.now();
  const live = new Set();
  for (const timer of timers) {
    if (timer.phase !== "running" || timer.endAt <= now) continue;
    live.add(timer.id);
    const done = scheduled.get(timer.id);
    if (done && done.endAt === timer.endAt) continue;
    if (done) for (const node of done.nodes) node.stop();
    const nodes = [];
    const toCtx = (ms) => audioCtx.currentTime + (ms - now) / 1000;
    if (timer.endAt - WARN_REMAINING_MS > now) scheduleWarning(toCtx(timer.endAt - WARN_REMAINING_MS), warnGain, nodes);
    scheduleAlert(toCtx(timer.endAt), alertGain, nodes);
    scheduled.set(timer.id, { endAt: timer.endAt, nodes, offset: audioCtx.currentTime - now / 1000 });
  }
  for (const [id, done] of scheduled) {
    if (live.has(id)) continue;
    // Se o tempo já acabou, o alerta está a tocar: deixa-o. Se foi cancelado antes, silencia.
    if (done.endAt > now) for (const node of done.nodes) node.stop();
    scheduled.delete(id);
  }
}

// O relógio do áudio pode descompassar-se do relógio normal (contexto suspenso, computador a dormir,
// etc.): se for o caso, os sons agendados são refeitos com a hora certa.
function checkAudioDrift() {
  if (!audioCtx || audioCtx.state !== "running" || scheduled.size === 0) return;
  const offset = audioCtx.currentTime - Date.now() / 1000;
  for (const done of scheduled.values()) {
    if (Math.abs(offset - done.offset) > 1) {
      for (const d of scheduled.values()) for (const node of d.nodes) node.stop();
      scheduled.clear();
      syncSchedule();
      return;
    }
  }
}

// Primeira interação com a página: prepara o áudio e agenda os timers que já estavam a contar.
function unlockOnGesture() {
  unlockAudio();
  syncSchedule();
}
for (const type of ["pointerdown", "keydown", "touchstart"]) {
  document.addEventListener(type, unlockOnGesture, { capture: true, passive: true });
}

// ---------- Estado ----------
const timerById = (id) => timers.find((t) => t.id === id);

// Aplica a mudança, guarda-a neste browser e redesenha.
function change(fn) {
  timers = fn(timers);
  saveTimers();
  render();
}

const mapTimer = (id, update) => (list) => list.map((t) => (t.id === id ? update(t) : t));

function startTimer(id) {
  change(
    mapTimer(id, (t) => ({ ...t, phase: "running", endAt: Date.now() + DURATION_MS, marked: null, needsMark: false, available: false }))
  );
}

function finishTimer(id, withSound) {
  const now = Date.now();
  change(
    mapTimer(id, (t) =>
      t.phase === "running" && now >= t.endAt
        ? { ...t, phase: "ready", endAt: 0, marked: null, needsMark: t.marked === null, available: true }
        : t
    )
  );
  if (withSound && soundOn() && audioCtx && alertGain) scheduleAlert(audioCtx.currentTime + 0.05, alertGain, []);
}

function cancelTimer(id) {
  if (!confirm("Cancelar a contagem? A hidra em curso não é registada.")) return;
  change(mapTimer(id, (t) => ({ ...t, phase: "ready", endAt: 0, marked: null, needsMark: false, available: false })));
}

async function markChests(id, n) {
  unlockAudio();
  const timer = timerById(id);
  if (!timer) return;
  try {
    await addHydra(ownerUid, dateKey(), n);
  } catch (err) {
    alert(err.message || "Erro ao registar a hidra.");
    return;
  }
  if (timer.phase === "ready") {
    // Marcada a hidra que terminou: começa a contagem da próxima.
    startTimer(id);
    return;
  }
  change(mapTimer(id, (t) => ({ ...t, marked: n })));
}

function addTimer() {
  if (timers.length >= MAX_TIMERS) return;
  const timer = newTimer(); // criado uma vez, para ter o mesmo id aqui e na lista guardada
  change((list) => (list.length >= MAX_TIMERS ? list : [...list, timer]));
}

function removeTimer(id) {
  const timer = timerById(id);
  if (!timer || timers.length <= 1) return;
  if (timer.phase === "running" && !confirm("Este timer está a contar. Remover mesmo?")) return;
  change((list) => (list.length > 1 ? list.filter((t) => t.id !== id) : list));
}

let lastDay = dateKey();

function tick() {
  if (dateKey() !== lastDay) {
    lastDay = dateKey();
    renderToday();
  }
  if (!timerLoaded) return;
  checkAudioDrift();
  const now = Date.now();
  for (const timer of timers) {
    if (timer.phase !== "running") continue;
    const handled = scheduled.get(timer.id)?.endAt === timer.endAt; // os sons já estão agendados
    if (now >= timer.endAt) {
      finishTimer(timer.id, !handled);
      return; // o ecrã foi refeito; os outros tratam-se no próximo ciclo
    }
    if (now >= timer.endAt - WARN_REMAINING_MS && warnedFor.get(timer.id) !== timer.endAt) {
      warnedFor.set(timer.id, timer.endAt);
      if (!handled && audioCtx && warnGain) scheduleWarning(audioCtx.currentTime + 0.05, warnGain, []);
    }
  }
  renderTimes();
}

// ---------- Ecrã ----------
const pad = (n) => String(n).padStart(2, "0");

function remainingMs(timer) {
  return timer.phase === "running" ? Math.max(0, timer.endAt - Date.now()) : DURATION_MS;
}

function timeText(timer) {
  const seconds = Math.ceil(remainingMs(timer) / 1000);
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

function renderTimes() {
  for (const timer of timers) {
    const el = displays.get(timer.id);
    if (el) el.textContent = timeText(timer);
  }
}

function chestButtons(onPick, selected = null) {
  const wrap = document.createElement("div");
  wrap.className = "hydra-timer-chests";
  for (const n of [0, ...QUICK_CHESTS.filter((q) => q > 0)]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hydra-timer-chest" + (selected === n ? " selected" : "");
    btn.textContent = String(n);
    btn.disabled = selected !== null;
    btn.addEventListener("click", () => onPick(n));
    wrap.appendChild(btn);
  }
  return wrap;
}

let renderTodayPending = false;

function renderToday() {
  // Não refaz os campos enquanto o utilizador está a escrever num deles.
  if (chipsEl.contains(document.activeElement)) {
    renderTodayPending = true;
    return;
  }
  renderTodayPending = false;
  const date = dateKey();
  const today = todayDays.find((d) => d.date === date);
  const hydras = Array.isArray(today?.hydras) ? today.hydras : [];
  const totals = dayTotals(today, 0);
  todayEl.textContent = `${totals.hidras} hidra(s) · ${totals.cofres} cofre(s) · média ${formatNumber(totals.media)}`;

  chipsEl.innerHTML = "";
  hydras.forEach((chests, index) => {
    const chip = document.createElement("input");
    chip.type = "number";
    chip.className = "hydra-chip";
    chip.min = "0";
    chip.max = String(MAX_CHESTS_PER_HYDRA);
    chip.value = chests;
    chip.title = "Cofres desta hidra (vazio remove a hidra)";
    chip.addEventListener("change", () => {
      const value = chip.value === "" ? null : Number(chip.value);
      setHydra(ownerUid, date, index, value).catch((err) => {
        chip.value = chests;
        alert(err.message || "Erro ao guardar.");
      });
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter") chip.blur();
    });
    chip.addEventListener("blur", () => {
      if (renderTodayPending) setTimeout(renderToday, 0);
    });
    chipsEl.appendChild(chip);
  });
}

// Bolinha no menu Hidras: quantos timers acabaram e têm uma hidra disponível.
function renderBadge() {
  const badge = document.querySelector('.nav-item[data-page="fazer-hidra"] .nav-badge');
  if (!badge) return;
  const available = timerLoaded ? timers.filter((t) => t.phase === "ready" && t.available).length : 0;
  badge.textContent = String(available);
  badge.hidden = available === 0;
}

function buildTimerCard(timer, index) {
  const card = document.createElement("div");
  card.className = "hydra-timer-card";

  if (timers.length > 1) {
    const title = document.createElement("div");
    title.className = "hydra-timer-title";
    title.textContent = `Timer ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary hydra-timer-remove";
    remove.textContent = "×";
    remove.title = "Remover este timer";
    remove.addEventListener("click", () => removeTimer(timer.id));
    card.append(title, remove);
  }

  const display = document.createElement("div");
  display.className = "hydra-timer-display" + (timer.phase === "running" ? " running" : "");
  display.textContent = timeText(timer);
  displays.set(timer.id, display);

  const status = document.createElement("p");
  status.className = "hydra-timer-status";
  const actions = document.createElement("div");
  actions.className = "hydra-timer-actions";
  const pick = (n) => markChests(timer.id, n);

  if (timer.phase === "running") {
    if (timer.marked === null) {
      status.textContent = "A contar… Quantos cofres recebeste nesta hidra?";
      actions.appendChild(chestButtons(pick));
    } else {
      status.textContent = `A contar… Marcaste ${timer.marked} cofre(s) nesta hidra.`;
      actions.appendChild(chestButtons(pick, timer.marked));
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary hydra-timer-cancel";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", () => cancelTimer(timer.id));
    actions.appendChild(cancel);
  } else if (timer.needsMark) {
    status.textContent = "Hidra disponível! Marca quantos cofres recebeste na anterior para começar a próxima.";
    actions.appendChild(chestButtons(pick));
  } else {
    status.textContent = timer.available ? "Hidra disponível!" : "Pronto para começar.";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "hydra-timer-start";
    start.textContent = "Começar";
    start.addEventListener("click", () => {
      unlockAudio();
      startTimer(timer.id);
    });
    actions.appendChild(start);
  }

  card.append(display, status, actions);
  return card;
}

function render() {
  renderBadge();
  displays.clear();
  listEl.innerHTML = "";
  addTimerBtn.hidden = !timerLoaded || timers.length >= MAX_TIMERS;
  if (!timerLoaded) {
    const loading = document.createElement("p");
    loading.className = "hydra-timer-status";
    loading.textContent = "A carregar…";
    listEl.appendChild(loading);
  } else {
    timers.forEach((timer, index) => listEl.appendChild(buildTimerCard(timer, index)));
  }
  renderToday();
  syncSchedule();
}

soundTestBtn.addEventListener("click", playHydraAvailable);
soundToggle.addEventListener("change", applyGains);

// O aviso dos 17:20 pode ser ligado ou desligado; a escolha fica neste browser.
try {
  warnToggle.checked = localStorage.getItem("hydraWarn") !== "off";
} catch {
  // sem localStorage: fica ligado
}
warnToggle.addEventListener("change", () => {
  applyGains();
  try {
    localStorage.setItem("hydraWarn", warnToggle.checked ? "on" : "off");
  } catch {
    // sem localStorage: a escolha só dura enquanto a página estiver aberta
  }
});
addTimerBtn.addEventListener("click", addTimer);

export function startHydraTimer(user) {
  ownerUid = user.uid;
  timers = loadTimers();
  warnedFor.clear();
  const now = Date.now();
  // Timers que acabaram enquanto a página estava fechada passam a "prontos" sem tocar.
  if (timers.some((t) => t.phase === "running" && now >= t.endAt)) {
    timers = timers.map((t) =>
      t.phase === "running" && now >= t.endAt
        ? { ...t, phase: "ready", endAt: 0, marked: null, needsMark: t.marked === null, available: true }
        : t
    );
    saveTimers();
  }
  // Ao abrir a página quando já faltam menos de 17:20, não repete o aviso.
  for (const t of timers) {
    if (t.phase === "running" && now >= t.endAt - WARN_REMAINING_MS) warnedFor.set(t.id, t.endAt);
  }
  timerLoaded = true;
  render();
  tickTimer = setInterval(tick, 250);

  // Outro separador do mesmo browser pode ter mudado os timers.
  const onStorage = (e) => {
    if (e.key !== storageKey()) return;
    timers = loadTimers();
    render();
  };
  window.addEventListener("storage", onStorage);

  const unsubscribe = subscribeToRecentHydraDays(
    user.uid,
    (days) => {
      todayDays = days;
      renderToday();
    },
    1 // só interessa o dia de hoje
  );
  return () => {
    clearInterval(tickTimer);
    window.removeEventListener("storage", onStorage);
    const badge = document.querySelector('.nav-item[data-page="fazer-hidra"] .nav-badge');
    if (badge) badge.hidden = true;
    unsubscribe();
    timerLoaded = false;
    ownerUid = null;
    todayDays = [];
  };
}
