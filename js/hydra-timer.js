import { addHydra, setHydra, subscribeToHydraDays, mutateHydraTimers, subscribeToHydraTimer } from "./hydras.js";
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
// Todos os cronómetros adicionam ao mesmo histórico de hoje. O estado fica no Firestore (por
// utilizador), por isso é o mesmo em todos os dispositivos.

export const HYDRA_MINUTES = 20;
const DURATION_MS = HYDRA_MINUTES * 60 * 1000;
// Aviso (3 beeps) quando ainda faltam 17:20 no cronómetro.
const WARN_REMAINING_MS = (17 * 60 + 20) * 1000;
const VOICE_URL = "assets/sounds/hydra-available.mp3";
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
let timerLoaded = false; // só se pode mexer depois de ler o estado guardado
let tickTimer = null;
let audioCtx = null;
const warnedFor = new Map(); // id do timer -> endAt da contagem que já deu o aviso
const displays = new Map(); // id do timer -> elemento com o tempo
let todayDays = [];

// ---------- Som ----------
function soundOn() {
  return soundToggle.checked;
}

// O browser só deixa tocar áudio depois de um clique: criamos/retomamos o contexto nos botões.
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function tone(freq, start, length, volume = 0.25) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, audioCtx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + start + length);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + start);
  osc.stop(audioCtx.currentTime + start + length + 0.05);
}

// "Hidra Available": um toque ascendente (dó–mi–sol–dó), repetido duas vezes.
function playHydraAvailable() {
  unlockAudio();
  if (audioCtx) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let round = 0; round < 2; round++) {
      notes.forEach((freq, i) => tone(freq, round * 0.9 + i * 0.16, round === 1 && i === 3 ? 0.6 : 0.22));
    }
  }
  // Depois do toque, a voz "Hydra available" (se o ficheiro faltar, fica só o toque).
  setTimeout(() => {
    const voice = new Audio(VOICE_URL);
    voice.play().catch(() => {});
  }, 1900);
}

// Aviso dos 17:20: dois beeps curtos e depois a gravação.
function playWarning() {
  unlockAudio();
  if (audioCtx) for (let i = 0; i < 2; i++) tone(880, i * 0.25, 0.15);
  setTimeout(() => {
    const voice = new Audio(WARNING_URL);
    voice.play().catch(() => {});
  }, 700);
}

// ---------- Estado ----------
const timerById = (id) => timers.find((t) => t.id === id);

// Aplica a mudança já no ecrã e depois guarda-a (a mesma função corre sobre a lista guardada).
function change(fn) {
  timers = fn(timers);
  render();
  mutateHydraTimers(ownerUid, fn).catch((err) => console.error("Erro a guardar o cronómetro:", err));
}

const mapTimer = (id, update) => (list) => list.map((t) => (t.id === id ? update(t) : t));

function startTimer(id) {
  change(
    mapTimer(id, (t) => ({ ...t, phase: "running", endAt: Date.now() + DURATION_MS, marked: null, needsMark: false, available: false }))
  );
}

function finishTimer(id) {
  const now = Date.now();
  change(
    mapTimer(id, (t) =>
      t.phase === "running" && now >= t.endAt
        ? { ...t, phase: "ready", endAt: 0, marked: null, needsMark: t.marked === null, available: true }
        : t
    )
  );
  if (soundOn()) playHydraAvailable();
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
  const now = Date.now();
  for (const timer of timers) {
    if (timer.phase !== "running") continue;
    if (now >= timer.endAt) {
      finishTimer(timer.id);
      return; // o ecrã foi refeito; os outros tratam-se no próximo ciclo
    }
    if (now >= timer.endAt - WARN_REMAINING_MS && warnedFor.get(timer.id) !== timer.endAt) {
      warnedFor.set(timer.id, timer.endAt);
      if (soundOn() && warnToggle.checked) playWarning();
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
}

soundTestBtn.addEventListener("click", playHydraAvailable);

// O aviso dos 17:20 pode ser ligado ou desligado; a escolha fica neste browser.
try {
  warnToggle.checked = localStorage.getItem("hydraWarn") !== "off";
} catch {
  // sem localStorage: fica ligado
}
warnToggle.addEventListener("change", () => {
  try {
    localStorage.setItem("hydraWarn", warnToggle.checked ? "on" : "off");
  } catch {
    // sem localStorage: a escolha só dura enquanto a página estiver aberta
  }
});
addTimerBtn.addEventListener("click", addTimer);

export function startHydraTimer(user) {
  ownerUid = user.uid;
  timerLoaded = false;
  timers = normalizeTimers(null);
  warnedFor.clear();
  let firstSnapshot = true;
  render();
  tickTimer = setInterval(tick, 250);
  const unsubscribeTimer = subscribeToHydraTimer(user.uid, (saved) => {
    timers = normalizeTimers(saved);
    const now = Date.now();
    // Timers que acabaram enquanto não havia nenhuma página aberta passam a "prontos" sem tocar.
    if (timers.some((t) => t.phase === "running" && now >= t.endAt)) {
      const expire = (list) =>
        list.map((t) =>
          t.phase === "running" && now >= t.endAt
            ? { ...t, phase: "ready", endAt: 0, marked: null, needsMark: t.marked === null, available: true }
            : t
        );
      timers = expire(timers);
      mutateHydraTimers(ownerUid, expire).catch((err) => console.error("Erro a guardar o cronómetro:", err));
    }
    // Ao abrir a página quando já faltam menos de 17:20, não repete o aviso.
    if (firstSnapshot) {
      for (const t of timers) {
        if (t.phase === "running" && now >= t.endAt - WARN_REMAINING_MS) warnedFor.set(t.id, t.endAt);
      }
    }
    firstSnapshot = false;
    timerLoaded = true;
    render();
  });
  const unsubscribe = subscribeToHydraDays(user.uid, (days) => {
    todayDays = days;
    renderToday();
  });
  return () => {
    clearInterval(tickTimer);
    const badge = document.querySelector('.nav-item[data-page="fazer-hidra"] .nav-badge');
    if (badge) badge.hidden = true;
    unsubscribe();
    unsubscribeTimer();
    ownerUid = null;
    todayDays = [];
  };
}
