import { addHydra, setHydra, subscribeToHydraDays } from "./hydras.js";
import { MAX_CHESTS_PER_HYDRA, QUICK_CHESTS, dateKey, dayTotals, formatNumber } from "./hydras-rules.js";

// Página "Fazer Hidra": cronómetro de 20 minutos entre hidras.
//   Começar → corre o cronómetro e aparecem os botões 0–5 (cofres recebidos nesta hidra).
//   Ao chegar a 0 toca um som, volta a 20:00 e fica parado; só se começa de novo depois de marcar
//   os cofres recebidos (se já os marcaste durante a contagem, basta carregar em Começar).
// O estado fica no localStorage (por utilizador), por isso sobrevive a recarregar a página.

export const HYDRA_MINUTES = 20;
const DURATION_MS = HYDRA_MINUTES * 60 * 1000;
// Aviso (3 beeps) quando ainda faltam 17:20 no cronómetro.
const WARN_REMAINING_MS = (17 * 60 + 20) * 1000;
const VOICE_URL = "assets/sounds/hydra-available.mp3";

const displayEl = document.getElementById("hydra-timer-display");
const statusEl = document.getElementById("hydra-timer-status");
const actionsEl = document.getElementById("hydra-timer-actions");
const todayEl = document.getElementById("hydra-timer-today");
const chipsEl = document.getElementById("hydra-timer-chips");
const soundToggle = document.getElementById("hydra-timer-sound");
const soundTestBtn = document.getElementById("hydra-timer-sound-test");

let ownerUid = null;
// phase "ready": 20:00 parado · "running": a contar até endAt.
// marked: cofres já marcados na hidra em curso (null = por marcar).
// needsMark: depois de acabar o tempo, falta marcar a hidra que terminou.
let state = { phase: "ready", endAt: 0, marked: null, needsMark: false, available: false };
let tickTimer = null;
let audioCtx = null;
let warnedFor = 0; // endAt da contagem que já deu o aviso
let todayDays = [];

const storageKey = () => `hydraTimer:${ownerUid}`;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
    if (saved && (saved.phase === "ready" || saved.phase === "running")) {
      state = {
        phase: saved.phase,
        endAt: Number(saved.endAt) || 0,
        marked: typeof saved.marked === "number" ? saved.marked : null,
        needsMark: Boolean(saved.needsMark),
        available: Boolean(saved.available),
      };
      return;
    }
  } catch {
    // sem localStorage: começa do zero
  }
  state = { phase: "ready", endAt: 0, marked: null, needsMark: false, available: false };
}

function saveState() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {
    // sem localStorage: o estado só vive enquanto a página estiver aberta
  }
}

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

// Três beeps curtos de aviso.
function playWarning() {
  unlockAudio();
  if (!audioCtx) return;
  for (let i = 0; i < 3; i++) tone(880, i * 0.25, 0.15);
}

// ---------- Estado ----------
function startTimer() {
  state = { phase: "running", endAt: Date.now() + DURATION_MS, marked: null, needsMark: false, available: false };
  saveState();
  render();
}

function finishTimer(withSound) {
  state = { phase: "ready", endAt: 0, marked: null, needsMark: state.marked === null, available: true };
  saveState();
  if (withSound && soundOn()) playHydraAvailable();
  render();
}

function cancelTimer() {
  if (!confirm("Cancelar a contagem? A hidra em curso não é registada.")) return;
  state = { phase: "ready", endAt: 0, marked: null, needsMark: false, available: false };
  saveState();
  render();
}

async function markChests(n) {
  unlockAudio();
  try {
    await addHydra(ownerUid, dateKey(), n);
  } catch (err) {
    alert(err.message || "Erro ao registar a hidra.");
    return;
  }
  if (state.phase === "ready") {
    // Marcada a hidra que terminou: começa a contagem da próxima.
    startTimer();
    return;
  }
  state.marked = n;
  saveState();
  render();
}

let lastDay = dateKey();

function tick() {
  if (dateKey() !== lastDay) {
    lastDay = dateKey();
    renderToday();
  }
  if (state.phase !== "running") return;
  if (Date.now() >= state.endAt) {
    finishTimer(true);
    return;
  }
  if (Date.now() >= state.endAt - WARN_REMAINING_MS && warnedFor !== state.endAt) {
    warnedFor = state.endAt;
    if (soundOn()) playWarning();
  }
  renderTime();
}

// ---------- Ecrã ----------
const pad = (n) => String(n).padStart(2, "0");

function remainingMs() {
  return state.phase === "running" ? Math.max(0, state.endAt - Date.now()) : DURATION_MS;
}

function renderTime() {
  const seconds = Math.ceil(remainingMs() / 1000);
  displayEl.textContent = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
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

// Bolinha "1" no menu Hidras quando o cronómetro acabou e há uma hidra disponível.
function renderBadge() {
  const badge = document.querySelector('.nav-item[data-page="fazer-hidra"] .nav-badge');
  if (!badge) return;
  badge.textContent = "1";
  badge.hidden = !(state.phase === "ready" && state.available);
}

function render() {
  renderBadge();
  renderTime();
  displayEl.classList.toggle("running", state.phase === "running");
  actionsEl.innerHTML = "";

  if (state.phase === "running") {
    if (state.marked === null) {
      statusEl.textContent = "A contar… Quantos cofres recebeste nesta hidra?";
      actionsEl.appendChild(chestButtons(markChests));
    } else {
      statusEl.textContent = `A contar… Marcaste ${state.marked} cofre(s) nesta hidra.`;
      actionsEl.appendChild(chestButtons(markChests, state.marked));
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary hydra-timer-cancel";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", cancelTimer);
    actionsEl.appendChild(cancel);
  } else if (state.needsMark) {
    statusEl.textContent = "Hidra disponível! Marca quantos cofres recebeste na anterior para começar a próxima.";
    actionsEl.appendChild(chestButtons(markChests));
  } else {
    statusEl.textContent = "Pronto para começar.";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "hydra-timer-start";
    start.textContent = "Começar";
    start.addEventListener("click", () => {
      unlockAudio();
      startTimer();
    });
    actionsEl.appendChild(start);
  }
  renderToday();
}

soundTestBtn.addEventListener("click", playHydraAvailable);

export function startHydraTimer(user) {
  ownerUid = user.uid;
  loadState();
  // Se o tempo acabou enquanto a página estava fechada, passa a "pronto" sem tocar.
  if (state.phase === "running" && Date.now() >= state.endAt) {
    state = { phase: "ready", endAt: 0, marked: null, needsMark: state.marked === null, available: true };
    saveState();
  }
  // Ao abrir a página quando já faltam menos de 17:20, não repete o aviso.
  if (state.phase === "running" && Date.now() >= state.endAt - WARN_REMAINING_MS) warnedFor = state.endAt;
  render();
  tickTimer = setInterval(tick, 250);
  const unsubscribe = subscribeToHydraDays(user.uid, (days) => {
    todayDays = days;
    renderToday();
  });
  return () => {
    clearInterval(tickTimer);
    const badge = document.querySelector('.nav-item[data-page="fazer-hidra"] .nav-badge');
    if (badge) badge.hidden = true;
    unsubscribe();
    ownerUid = null;
    todayDays = [];
  };
}
