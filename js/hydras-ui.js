import {
  addHydra,
  setHydra,
  setDayPrice,
  setMonthDefaultPrice,
  subscribeToHydraDays,
  subscribeToHydraMonths,
  subscribeToHydraSettings,
  compactOldDays,
  importDays,
  deleteAllHydraData,
} from "./hydras.js";
import {
  DEFAULT_PRICE,
  MAX_CHESTS_PER_HYDRA,
  MAX_HYDRAS_PER_DAY,
  QUICK_CHESTS,
  cutoffKey,
  dateKey,
  dayTotals,
  daysInMonth,
  formatDate,
  formatNumber,
  isEditableDay,
  isPriceEditableDay,
  monthOf,
  previousMonth,
  defaultPriceFor,
  sumDays,
  parseImport,
} from "./hydras-rules.js";

const tabsEl = document.getElementById("hydra-tabs");
const bodyEl = document.getElementById("hydra-body");
const defaultInput = document.getElementById("hydra-default-price");
const defaultLabel = document.getElementById("hydra-default-label");
const defaultTitle = document.getElementById("hydra-default-title");

// Preço padrão do mês indicado (cada mês tem o seu).
const defaultFor = (month) => defaultPriceFor(month, settings.monthlyDefaults, settings.base);

// Mês que o ecrã está a mostrar (null no separador dos meses antigos).
function shownMonth() {
  const current = monthOf(dateKey());
  if (tab === "current") return current;
  if (tab === "previous") return previousMonth(current);
  return null;
}

let ownerUid = null;
let days = [];
let months = [];
let settings = { monthlyDefaults: {}, base: DEFAULT_PRICE };
let tab = "current"; // "current" | "previous" | "older"
let daysLoaded = false;
let settingsLoaded = false;
let compacted = false;
let renderPending = false;
let retryTimer = null;
let lastDay = dateKey();

const monthLabel = (month) => `${month.slice(5)}/${month.slice(0, 4)}`; // "10/2026"

// ---------- Desenho ----------
// Enquanto se escreve num campo (cofres ou preço) o desenho espera, para não lhe tirar o cursor.
function render() {
  if (document.activeElement?.matches(".hydra-chip, .hydra-price-input, #hydra-default-price")) {
    renderPending = true;
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (renderPending) render();
      }, 1000);
    }
    return;
  }
  renderPending = false;

  // O campo do preço padrão é do mês que se está a ver (nos meses antigos, só totais, não há).
  const month = shownMonth();
  defaultLabel.hidden = month === null;
  if (month !== null) {
    defaultTitle.textContent = `Preço padrão de ${monthLabel(month)} (por cofre)`;
    if (document.activeElement !== defaultInput) defaultInput.value = defaultFor(month);
  }
  renderTabs();
  renderBody();
}

function renderTabs() {
  const current = monthOf(dateKey());
  const previous = previousMonth(current);
  tabsEl.innerHTML = "";
  for (const [key, label] of [
    ["current", `Este mês (${monthLabel(current)})`],
    ["previous", `Mês anterior (${monthLabel(previous)})`],
    ["older", "Meses anteriores (totais)"],
  ]) {
    const btn = document.createElement("button");
    btn.className = "guild-tab" + (tab === key ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      tab = key;
      render();
    });
    tabsEl.appendChild(btn);
  }
}

function renderBody() {
  bodyEl.innerHTML = "";
  if (tab === "older") {
    renderOlderMonths();
    return;
  }

  const today = dateKey();
  const current = monthOf(today);
  const month = tab === "current" ? current : previousMonth(current);
  const lastDayNumber = month === current ? Number(today.slice(8)) : daysInMonth(month);
  const byDate = new Map(days.map((d) => [d.date, d]));

  const monthDays = days.filter((d) => monthOf(d.date) === month);
  const monthDefault = defaultFor(month);
  const total = sumDays(monthDays, monthDefault);
  const summary = document.createElement("div");
  summary.className = "hydra-summary";
  summary.innerHTML = `<strong>Total do mês</strong>
    <span>Cofres <b>${total.cofres}</b></span>
    <span>Hidras <b>${total.hidras}</b></span>
    <span>Média <b>${formatNumber(total.media)}</b></span>
    <span>Wons <b>${formatNumber(total.wons)}</b></span>`;
  bodyEl.appendChild(summary);

  const head = document.createElement("div");
  head.className = "hydra-row hydra-row-head";
  head.innerHTML = "<span>Dia</span><span>Cofres por hidra</span><span>Cofres</span><span>Hidras</span><span>Média</span><span>Preço</span><span>Wons</span>";
  bodyEl.appendChild(head);

  // O(s) dia(s) do mês com mais cofres ficam com um glow verde.
  const best = Math.max(0, ...monthDays.map((d) => dayTotals(d, monthDefault).cofres));

  // Dia mais recente primeiro.
  for (let n = lastDayNumber; n >= 1; n--) {
    const date = `${month}-${String(n).padStart(2, "0")}`;
    bodyEl.appendChild(buildDayRow(date, byDate.get(date), today, monthDefault, best));
  }
}

function buildDayRow(date, day, today, monthDefault, best) {
  const editable = isEditableDay(date);
  const priceEditable = isPriceEditableDay(date);
  const totals = dayTotals(day, monthDefault);
  const hydras = Array.isArray(day?.hydras) ? day.hydras : [];

  const row = document.createElement("div");
  row.className = "hydra-row" + (date === today ? " today" : "") + (editable ? "" : " locked") + (best > 0 && totals.cofres === best ? " best" : "");

  const dateCell = document.createElement("span");
  dateCell.className = "hydra-date";
  dateCell.textContent = formatDate(date);
  if (date === today) dateCell.append(" ", tag("hoje"));
  else if (editable) dateCell.append(" ", tag("ontem"));

  // Cofres de cada hidra: editáveis só em hoje e ontem; um campo vazio remove a hidra (0 é válido).
  const cells = document.createElement("div");
  cells.className = "hydra-chips";
  hydras.forEach((chests, index) => {
    if (!editable) {
      const chip = document.createElement("span");
      chip.className = "hydra-chip readonly";
      chip.textContent = chests;
      cells.appendChild(chip);
      return;
    }
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
      if (renderPending) setTimeout(render, 0);
    });
    cells.appendChild(chip);
  });
  if (editable && hydras.length < MAX_HYDRAS_PER_DAY) {
    const add = document.createElement("span");
    add.className = "hydra-add";
    add.append("Nova hidra:");
    for (const n of QUICK_CHESTS) {
      const btn = document.createElement("button");
      btn.className = "secondary hydra-add-btn";
      btn.textContent = String(n);
      btn.title = `Adicionar uma hidra com ${n} cofre(s)`;
      btn.addEventListener("click", () => {
        addHydra(ownerUid, date, n).catch((err) => alert(err.message || "Erro ao adicionar."));
      });
      add.appendChild(btn);
    }
    cells.appendChild(add);
  }

  // Preço de um cofre nesse dia: sem preço escrito usa o padrão e fica a vermelho.
  const priceInput = document.createElement("input");
  priceInput.type = "number";
  priceInput.min = "0";
  priceInput.step = "0.01";
  // O aviso vermelho (preço por escrever) só aparece enquanto o preço ainda se pode editar (hoje,
  // ontem e anteontem); depois o dia fica com o preço padrão, sem destaque.
  priceInput.className = "hydra-price-input" + (!totals.priceSet && priceEditable ? " unset" : "");
  priceInput.value = formatPrice(totals.price);
  priceInput.disabled = !priceEditable;
  priceInput.title = totals.priceSet
    ? "Preço de um cofre neste dia (apaga para voltar ao preço padrão)"
    : priceEditable
      ? "Sem preço definido: está a usar o preço padrão"
      : "Sem preço definido: ficou com o preço padrão";
  priceInput.addEventListener("change", () => {
    const value = priceInput.value === "" ? null : Number(priceInput.value);
    setDayPrice(ownerUid, date, value).catch((err) => {
      priceInput.value = formatPrice(totals.price);
      alert(err.message || "Erro ao guardar o preço.");
    });
  });
  priceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") priceInput.blur();
  });
  priceInput.addEventListener("blur", () => {
    if (renderPending) setTimeout(render, 0);
  });

  row.append(
    dateCell,
    cells,
    textCell(totals.cofres),
    textCell(totals.hidras),
    textCell(formatNumber(totals.media)),
    priceInput,
    textCell(formatNumber(totals.wons))
  );
  return row;
}

function renderOlderMonths() {
  const current = monthOf(dateKey());
  const previous = previousMonth(current);
  const older = months.filter((m) => m.month < previous).sort((a, b) => b.month.localeCompare(a.month));

  if (older.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Ainda não há meses anteriores. Os dias com mais de um mês passam para aqui, só com os totais.";
    bodyEl.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "hydra-month-row hydra-row-head";
  head.innerHTML = "<span>Mês</span><span>Cofres</span><span>Hidras</span><span>Média</span><span>Wons</span>";
  bodyEl.appendChild(head);
  for (const m of older) {
    const media = m.hidras > 0 ? m.cofres / m.hidras : 0;
    const row = document.createElement("div");
    row.className = "hydra-month-row";
    row.append(textCell(monthLabel(m.month)), textCell(m.cofres), textCell(m.hidras), textCell(formatNumber(media)), textCell(formatNumber(m.wons)));
    bodyEl.appendChild(row);
  }
}

const textCell = (text) => {
  const span = document.createElement("span");
  span.textContent = String(text);
  return span;
};

const tag = (text) => {
  const span = document.createElement("small");
  span.className = "hydra-tag";
  span.textContent = text;
  return span;
};

const formatPrice = (price) => (Number.isInteger(price) ? String(price) : String(Math.round(price * 100) / 100));

// ---------- Preço padrão ----------
const importModal = document.getElementById("hydra-import-modal");
document.getElementById("hydra-import-open").addEventListener("click", () => importModal.showModal());
document.getElementById("hydra-import-close").addEventListener("click", () => importModal.close());

document.getElementById("hydra-import-btn").addEventListener("click", async () => {
  const textEl = document.getElementById("hydra-import-text");
  const { days: parsed, errors } = parseImport(textEl.value);
  if (errors.length > 0) return alert(errors.join("\n"));
  if (parsed.length === 0) return alert("Não há dias para importar.");
  if (!confirm(`Importar ${parsed.length} dia(s)? As hidras desses dias vão ser substituídas.`)) return;
  try {
    await importDays(ownerUid, parsed);
    textEl.value = "";
    importModal.close();
  } catch (err) {
    alert(err.message || "Erro ao importar.");
  }
});

document.getElementById("hydra-delete-all-btn").addEventListener("click", async () => {
  if (!confirm("Apagar TODAS as tuas hidras (dias e totais dos meses)? Não dá para desfazer.")) return;
  try {
    await deleteAllHydraData(ownerUid);
  } catch (err) {
    alert(err.message || "Erro ao apagar.");
  }
});

defaultInput.addEventListener("change", () => {
  const month = shownMonth();
  if (month === null) return;
  if (defaultInput.value === "") {
    defaultInput.value = defaultFor(month);
    return;
  }
  setMonthDefaultPrice(ownerUid, month, defaultInput.value).catch((err) => alert(err.message || "Erro ao guardar o preço padrão."));
});
defaultInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") defaultInput.blur();
});
defaultInput.addEventListener("blur", () => {
  if (renderPending) setTimeout(render, 0);
});

// ---------- Ligação à app ----------
// Chamado no login; devolve a função que pára tudo.
export function startHydras(user) {
  ownerUid = user.uid;

  // Um mês novo começa com o preço padrão do mês anterior, gravado já como o SEU (assim, mudar o de
  // um mês mais tarde nunca altera os outros).
  const ensureCurrentMonthDefault = () => {
    const month = monthOf(dateKey());
    if (!ownerUid || typeof settings.monthlyDefaults[month] === "number") return;
    setMonthDefaultPrice(ownerUid, month, defaultFor(month)).catch((err) => console.error("Erro a guardar o preço padrão do mês:", err));
  };

  // Depois de carregar os dias e as definições, compacta (uma vez) os dias anteriores ao mês passado.
  const maybeCompact = () => {
    if (compacted || !daysLoaded || !settingsLoaded) return;
    compacted = true;
    compactOldDays(ownerUid, days, defaultFor, cutoffKey()).catch((err) => console.error("Erro a compactar hidras antigas:", err));
  };

  const unsubs = [
    subscribeToHydraDays(user.uid, (items) => {
      days = items;
      daysLoaded = true;
      render();
      maybeCompact();
    }),
    subscribeToHydraMonths(user.uid, (items) => {
      months = items;
      render();
    }),
    subscribeToHydraSettings(user.uid, (loaded) => {
      settings = loaded;
      settingsLoaded = true;
      ensureCurrentMonthDefault();
      render();
      maybeCompact();
    }),
  ];

  // À meia-noite o "hoje" muda: redesenha (para os dias editáveis passarem a ser os certos).
  lastDay = dateKey();
  const dayWatcher = setInterval(() => {
    if (dateKey() !== lastDay) {
      lastDay = dateKey();
      ensureCurrentMonthDefault();
      render();
    }
  }, 30000);

  return () => {
    clearInterval(dayWatcher);
    unsubs.forEach((u) => u());
    days = [];
    months = [];
    settings = { monthlyDefaults: {}, base: DEFAULT_PRICE };
    daysLoaded = settingsLoaded = compacted = false;
    ownerUid = null;
    tabsEl.innerHTML = "";
    bodyEl.innerHTML = "";
  };
}
