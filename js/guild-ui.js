import {
  MEDAL_BUTTONS,
  setGuildLevel,
  setCharacterLv70,
  addGuildRun,
  addMedalsBulk,
  setItemCount,
  undoGuildRun,
  createGuild,
  deleteGuild,
  addGuildAccount,
  deleteGuildAccount,
  addGuildCharacter,
  setGuildCharacterDescription,
  MAX_DESCRIPTION,
  deleteGuildCharacter,
  addMedals,
  undoUsage,
  setMedals,
  subscribeToOwnGuilds,
  subscribeToOwnGuildAccounts,
  subscribeToOwnGuildCharacters,
} from "./guild.js";

import {
  DAILY_LIMITS,
  DEFAULT_GUILD_LEVEL,
  GUILD_RUNS,
  ITEM_GROUPS,
  itemCount,
  MAX_GUILD_LEVEL,
  MIN_GUILD_LEVEL,
  periodKey,
  runsDoneOf,
  usageOf,
  weekKey,
} from "./guild-rules.js";

const tabsEl = document.getElementById("guild-tabs");
const bodyEl = document.getElementById("guild-body");
const newGuildBtn = document.getElementById("guild-new-btn");

const inputModal = document.getElementById("guild-input-modal");
const inputForm = document.getElementById("guild-input-form");
const inputTitle = document.getElementById("guild-input-title");
const inputLabel = document.getElementById("guild-input-label");
const inputField = document.getElementById("guild-input");
const inputError = document.getElementById("guild-input-error");

const SELECTED_KEY = "timers_guild_selected";
const ITEMS_KEY = "timers_guild_items";

// Nome das personagens: no máximo 12 caracteres (a coluna da lista tem esse tamanho).
const MAX_CHARACTER_NAME = 12;

// Limites da conta atual (guilds e personagens por guild); a app principal indica-os.
let getLimits = () => ({ guilds: 1, guildCharacters: 90 });
const maxGuilds = () => getLimits().guilds;
const maxChars = () => getLimits().guildCharacters;

let ownerUid = null;
let guilds = [];
let accounts = [];
let characters = [];
let selectedGuildId = null;
let collapsedAccounts = new Set();
// Modo de edição: só nele aparecem os botões de apagar (guild, conta e personagem).
let editMode = false;
// Mostrar/esconder a linha de scrolls por baixo de cada personagem (guardado neste browser).
let showItems = (() => {
  try {
    return localStorage.getItem(ITEMS_KEY) !== "off";
  } catch {
    return true;
  }
})();
let renderPending = false;
let retryTimer = null;

function guildLimitMessage() {
  const n = maxGuilds();
  return `A tua conta pode ter no máximo ${n} guild${n === 1 ? "" : "s"}.${n === 1 ? " Contas privilegiadas podem ter 2." : ""}`;
}

const fmt = (n) => Number(n || 0).toLocaleString("pt-PT");
const byName = (a, b) => a.name.localeCompare(b.name, "pt");

// Ordem em que foram adicionadas: as mais antigas primeiro. Um documento acabado de criar ainda não
// tem a hora do servidor (createdAt vazio), por isso conta como o mais recente e fica no fim.
const createdMs = (item) => {
  const t = item.createdAt;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  return typeof t === "number" ? t : Number.MAX_SAFE_INTEGER;
};
const byCreated = (a, b) => createdMs(a) - createdMs(b) || a.id.localeCompare(b.id);

function readSelected() {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function saveSelected(id) {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // sem armazenamento local: a escolha só vale nesta sessão
  }
}

function currentGuild() {
  return guilds.find((g) => g.id === selectedGuildId) || null;
}

function charactersOfGuild(guildId) {
  return characters.filter((c) => c.guildId === guildId);
}

// ---------- Render ----------
// Se alguém está a escrever as medalhas à mão, adia o desenho para não lhe tirar o cursor.
function render() {
  if (document.activeElement?.matches(".guild-medals-input, .guild-desc-input, .guild-level-input, .guild-item-input")) {
    renderPending = true;
    // Volta a tentar passado um momento (além de desenhar quando o campo perde o foco).
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (renderPending) render();
      }, 1000);
    }
    return;
  }
  renderPending = false;

  guilds.sort((a, b) => a.name.localeCompare(b.name, "pt"));
  if (!currentGuild()) {
    const saved = readSelected();
    selectedGuildId = guilds.find((g) => g.id === saved)?.id || guilds[0]?.id || null;
  }

  newGuildBtn.disabled = guilds.length >= maxGuilds();
  newGuildBtn.title = newGuildBtn.disabled ? guildLimitMessage() : "";

  renderTabs();
  renderBody();
  renderPopover();
  renderRunModal();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const guild of guilds) {
    const tab = document.createElement("button");
    tab.className = "guild-tab" + (guild.id === selectedGuildId ? " active" : "");
    tab.textContent = guild.name;
    tab.addEventListener("click", () => {
      selectedGuildId = guild.id;
      saveSelected(guild.id);
      render();
    });
    tabsEl.appendChild(tab);
  }
}

function renderBody() {
  bodyEl.innerHTML = "";
  const guild = currentGuild();
  if (!guild) {
    bodyEl.innerHTML = '<p class="empty-state">Ainda não tens nenhuma guild. Cria a primeira em "+ Nova guild".</p>';
    return;
  }

  const guildChars = charactersOfGuild(guild.id);
  const total = guildChars.reduce((sum, c) => sum + (c.medals || 0), 0);
  const atLimit = guildChars.length >= maxChars();

  const header = document.createElement("div");
  header.className = "guild-header";
  const info = document.createElement("div");
  info.className = "guild-info";
  info.innerHTML = `<h3></h3><span class="guild-total">Total: <strong>${fmt(total)}</strong> medalhas</span>
    <span class="guild-count">${guildChars.length}/${maxChars()} personagens</span>
    <span class="guild-count">Doações e participação reiniciam às 03:00 PT (04:00 CZ/CH)</span>`;
  info.querySelector("h3").textContent = guild.name;

  // Nível da guild (editável): desbloqueia as guild runs.
  const levelLabel = document.createElement("label");
  levelLabel.className = "guild-level";
  levelLabel.append("Lv da guild");
  const levelInput = document.createElement("input");
  levelInput.type = "number";
  levelInput.className = "guild-level-input";
  levelInput.min = String(MIN_GUILD_LEVEL);
  levelInput.max = String(MAX_GUILD_LEVEL);
  levelInput.step = "1";
  levelInput.value = guild.level || DEFAULT_GUILD_LEVEL;
  levelInput.addEventListener("change", () => {
    if (levelInput.value === "") {
      levelInput.value = guild.level || DEFAULT_GUILD_LEVEL;
      return;
    }
    setGuildLevel(guild.id, levelInput.value).catch((err) => alert(err.message || "Erro ao guardar o nível."));
  });
  levelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") levelInput.blur();
  });
  levelInput.addEventListener("blur", () => {
    if (renderPending) setTimeout(render, 0);
  });
  levelLabel.appendChild(levelInput);
  info.insertBefore(levelLabel, info.children[1]);
  header.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "section-header-actions";
  const addAccountBtn = document.createElement("button");
  addAccountBtn.className = "secondary";
  addAccountBtn.textContent = "+ Conta";
  addAccountBtn.addEventListener("click", () => openInputModal("account"));
  const delGuildBtn = document.createElement("button");
  delGuildBtn.className = "icon-btn small";
  delGuildBtn.textContent = "Apagar guild";
  delGuildBtn.addEventListener("click", async () => {
    const msg = `Apagar a guild "${guild.name}" com ${accountsOf(guild.id).length} contas e ${guildChars.length} personagens?\n\nNão dá para desfazer.`;
    if (!confirm(msg)) return;
    try {
      selectedGuildId = null;
      await deleteGuild(ownerUid, guild.id);
    } catch (err) {
      alert(err.message || "Erro ao apagar a guild.");
    }
  });
  const editBtn = document.createElement("button");
  editBtn.className = editMode ? "" : "secondary";
  editBtn.textContent = editMode ? "✓ Concluir" : "✎ Editar";
  editBtn.title = editMode ? "Sair do modo de edição" : "Entrar no modo de edição (para apagar)";
  editBtn.addEventListener("click", () => {
    editMode = !editMode;
    render();
  });
  const bulkBtn = document.createElement("button");
  bulkBtn.className = "secondary guild-vote-all";
  bulkBtn.textContent = "Votar em falta";
  bulkBtn.title = "Aplica um voto a todas as personagens da guild que ainda não o fizeram hoje";
  bulkBtn.addEventListener("click", () => {
    if (popover?.bulk) {
      closePopover();
      return;
    }
    const rect = bulkBtn.getBoundingClientRect();
    popover = { bulk: true, message: "", anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } };
    renderPopover();
  });
  const runBtn = document.createElement("button");
  runBtn.textContent = "Guild Run";
  runBtn.title = "Registar guild runs das personagens lv70+";
  runBtn.addEventListener("click", openRunModal);
  const itemsBtn = document.createElement("button");
  itemsBtn.className = "secondary";
  itemsBtn.textContent = showItems ? "Esconder scrolls" : "Mostrar scrolls";
  itemsBtn.title = "Mostra ou esconde a linha de scrolls e Guild Land de cada personagem";
  itemsBtn.addEventListener("click", () => {
    showItems = !showItems;
    try {
      localStorage.setItem(ITEMS_KEY, showItems ? "on" : "off");
    } catch {
      // sem armazenamento local: a escolha só vale nesta sessão
    }
    render();
  });
  actions.append(bulkBtn, runBtn, addAccountBtn, itemsBtn);
  if (editMode) actions.append(delGuildBtn);
  actions.append(editBtn);
  header.appendChild(actions);
  bodyEl.appendChild(header);

  const guildAccounts = accountsOf(guild.id);
  if (guildAccounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = 'Esta guild ainda não tem contas. Usa "+ Conta" para adicionar a primeira.';
    bodyEl.appendChild(empty);
    return;
  }
  for (const account of guildAccounts) bodyEl.appendChild(buildAccount(account, atLimit));
}

function accountsOf(guildId) {
  return accounts.filter((a) => a.guildId === guildId).sort(byName);
}

function buildAccount(account, guildAtLimit) {
  const chars = characters.filter((c) => c.accountId === account.id).sort(byCreated);
  const sum = chars.reduce((s, c) => s + (c.medals || 0), 0);
  const collapsed = collapsedAccounts.has(account.id);

  const block = document.createElement("div");
  block.className = "guild-account";

  const head = document.createElement("div");
  head.className = "guild-account-head";
  const toggle = document.createElement("button");
  toggle.className = "guild-toggle";
  toggle.textContent = collapsed ? "▸" : "▾";
  toggle.title = collapsed ? "Mostrar personagens" : "Esconder personagens";
  toggle.addEventListener("click", () => {
    if (collapsed) collapsedAccounts.delete(account.id);
    else collapsedAccounts.add(account.id);
    render();
  });
  const title = document.createElement("div");
  title.className = "guild-account-title";
  title.innerHTML = `<strong></strong><span>${chars.length} personagens · ${fmt(sum)} medalhas</span>`;
  title.querySelector("strong").textContent = account.name;
  const actions = document.createElement("div");
  actions.className = "section-header-actions";
  const addCharBtn = document.createElement("button");
  addCharBtn.className = "secondary small";
  addCharBtn.textContent = "+ Personagem";
  addCharBtn.disabled = guildAtLimit;
  addCharBtn.title = guildAtLimit ? `Máximo de ${maxChars()} personagens por guild` : "";
  addCharBtn.addEventListener("click", () => openInputModal("character", account));
  const delAccBtn = document.createElement("button");
  delAccBtn.className = "icon-btn small";
  delAccBtn.textContent = "×";
  delAccBtn.title = "Apagar conta";
  delAccBtn.addEventListener("click", async () => {
    if (!confirm(`Apagar a conta "${account.name}" e as ${chars.length} personagens dela?\n\nNão dá para desfazer.`)) return;
    try {
      await deleteGuildAccount(ownerUid, account.id);
    } catch (err) {
      alert(err.message || "Erro ao apagar a conta.");
    }
  });
  actions.append(addCharBtn);
  if (editMode) actions.append(delAccBtn);
  head.append(toggle, title, actions);
  block.appendChild(head);

  if (collapsed) return block;

  if (chars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "Sem personagens.";
    block.appendChild(empty);
    return block;
  }

  const labels = document.createElement("div");
  labels.className = "guild-row guild-row-labels";
  labels.innerHTML = "<span>Personagem</span><span>Descrição</span><span>Medalhas</span><span>Lv70+</span><span>Votar</span><span></span>";
  block.appendChild(labels);
  for (const char of chars) {
    block.appendChild(buildCharacterRow(char));
    if (showItems) block.appendChild(buildItemsRow(char));
  }
  return block;
}

// Linha por baixo da personagem: 8 scrolls de elementos + 3 itens da Guild Land. Cada contador
// gasta medalhas ao subir (baixar não devolve); o custo está na dica de cada item.
function buildItemsRow(char) {
  const row = document.createElement("div");
  row.className = "guild-items-row" + (isVoted(char) ? " voted" : "");

  // Scrolls | Guild Land: separados só por uma barra.
  ["scrolls", "land"].forEach((group, g) => {
    if (g > 0) {
      const sep = document.createElement("span");
      sep.className = "guild-items-sep";
      row.appendChild(sep);
    }
    ITEM_GROUPS[group].forEach((item, index) => {
      const box = document.createElement("label");
      box.className = "guild-item";
      box.title = `${item.name} — custa ${item.cost} medalhas por unidade ao subir (baixar não devolve)`;
      const icon = document.createElement("img");
      icon.className = "guild-item-icon";
      icon.src = item.icon;
      icon.alt = item.name;
      const input = document.createElement("input");
      input.type = "number";
      input.className = "guild-item-input";
      input.min = "0";
      input.step = "1";
      input.value = itemCount(char, group, index);
      input.setAttribute("aria-label", `${item.name} de ${char.name}`);
      input.addEventListener("change", () => {
        const current = itemCount(char, group, index);
        if (input.value === "") {
          input.value = current;
          return;
        }
        const wanted = input.value;
        setItemCount(char.id, group, index, wanted).catch(async (err) => {
          input.value = current;
          // Sem medalhas suficientes: mostra o mesmo aviso e pergunta se quer continuar (por
          // exemplo, se o pergaminho não foi comprado com medalhas ou se já o tinha).
          if (err.code === "insufficient-medals" && (await askYesNo(err.message))) {
            input.value = wanted;
            setItemCount(char.id, group, index, wanted, { force: true }).catch((err2) => {
              input.value = current;
              alert(err2.message || "Erro ao guardar.");
            });
            return;
          }
          if (err.code !== "insufficient-medals") alert(err.message || "Erro ao guardar.");
        });
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      input.addEventListener("blur", () => {
        if (renderPending) setTimeout(render, 0);
      });

      // Setas próprias (▲ ▼): as do browser são pequenas e coladas. Usam o mesmo caminho do campo:
      // põem o valor novo e disparam o "change", que guarda (ou recusa, se faltarem medalhas).
      const stepper = document.createElement("div");
      stepper.className = "guild-stepper";
      for (const [symbol, delta, title] of [
        ["▲", 1, `Subir 1 (gasta ${item.cost} medalhas)`],
        ["▼", -1, "Baixar 1 (não devolve medalhas)"],
      ]) {
        const step = document.createElement("button");
        step.type = "button";
        step.className = "guild-step";
        step.textContent = symbol;
        step.title = title;
        step.setAttribute("aria-label", `${item.name}: ${title}`);
        step.addEventListener("click", () => {
          const now = Number(input.value) || 0;
          const next = Math.max(0, now + delta);
          if (next === now) return;
          input.value = String(next);
          input.dispatchEvent(new Event("change"));
        });
        stepper.appendChild(step);
      }
      box.append(icon, input, stepper);
      row.appendChild(box);
    });
  });
  return row;
}

// kind: "donation" (máx. 3 por dia) ou "participation" (máx. 1 por dia).
function medalButtons(char, amounts, kind) {
  const usage = usageOf(char);
  const limit = kind === "donation" ? DAILY_LIMITS.donations : DAILY_LIMITS.participation;
  const used = kind === "donation" ? usage.donations : usage.participated ? 1 : 0;
  const full = used >= limit;

  const group = document.createElement("div");
  group.className = "guild-btns";
  for (const amount of amounts) {
    const btn = document.createElement("button");
    btn.className = "secondary guild-plus";
    btn.textContent = `+${amount}`;
    btn.disabled = full;
    btn.title = full ? "Limite diário atingido (reinicia às 03:00 PT / 04:00 CZ)" : `Somar ${amount} medalhas a ${char.name}`;
    btn.addEventListener("click", () => {
      addMedals(char.id, amount, kind).catch((err) => alert(err.message || "Erro ao somar medalhas."));
    });
    group.appendChild(btn);
  }

  // Contador do dia (usadas/limite); clicar anula 1, para corrigir um clique enganado.
  {
    const counter = document.createElement("button");
    counter.className = "guild-counter" + (full ? " full" : "");
    counter.textContent = `${used}/${limit}`;
    counter.title = used > 0 ? "Clica para anular 1 no contador de hoje (não altera as medalhas)" : "Ainda nada feito hoje";
    counter.disabled = used === 0;
    counter.addEventListener("click", () => {
      undoUsage(char.id, kind).catch((err) => alert(err.message || "Erro ao anular."));
    });
    group.appendChild(counter);
  }
  return group;
}

function buildCharacterRow(char) {
  const row = document.createElement("div");
  row.className = "guild-row" + (isVoted(char) ? " voted" : "");

  // Nome + pequena descrição (opcional) sempre editável: Enter ou clicar fora guarda, Esc cancela.
  const name = document.createElement("span");
  name.className = "guild-char-name";
  const strong = document.createElement("strong");
  strong.textContent = char.name;
  strong.title = char.name;
  const desc = document.createElement("input");
  desc.className = "guild-desc-input";
  desc.maxLength = MAX_DESCRIPTION;
  desc.placeholder = "descrição...";
  desc.value = char.description || "";
  desc.title = "Descrição (opcional): escreve e carrega Enter ou clica fora para guardar";
  desc.setAttribute("aria-label", `Descrição de ${char.name}`);
  let cancelled = false;
  desc.addEventListener("keydown", (e) => {
    if (e.key === "Enter") desc.blur();
    if (e.key === "Escape") {
      cancelled = true;
      desc.value = char.description || "";
      desc.blur();
    }
  });
  desc.addEventListener("blur", () => {
    const text = desc.value.trim();
    if (!cancelled && text !== (char.description || "")) {
      setGuildCharacterDescription(char.id, text).catch((err) => alert(err.message || "Erro ao guardar a descrição."));
    }
    cancelled = false;
    if (renderPending) setTimeout(render, 0);
  });
  name.append(strong);

  const medals = document.createElement("input");
  medals.type = "number";
  medals.min = "0";
  medals.step = "1";
  medals.className = "guild-medals-input";
  medals.value = char.medals || 0;
  medals.setAttribute("aria-label", `Medalhas de ${char.name}`);
  const commit = () => {
    const value = Number(medals.value);
    if (medals.value === "" || Number.isNaN(value)) {
      medals.value = char.medals || 0;
      return;
    }
    if (Math.max(0, Math.floor(value)) === (char.medals || 0)) {
      medals.value = char.medals || 0;
      return;
    }
    setMedals(char.id, value).catch((err) => alert(err.message || "Erro ao guardar as medalhas."));
  };
  medals.addEventListener("change", commit);
  medals.addEventListener("keydown", (e) => {
    if (e.key === "Enter") medals.blur();
  });
  medals.addEventListener("blur", () => {
    if (renderPending) setTimeout(render, 0);
  });

  const del = document.createElement("button");
  del.className = "icon-btn small";
  del.textContent = "×";
  del.title = "Apagar personagem";
  del.addEventListener("click", () => {
    if (confirm(`Apagar a personagem "${char.name}"?`)) {
      deleteGuildCharacter(char.id).catch((err) => alert(err.message || "Erro ao apagar a personagem."));
    }
  });

  // Toggle "lv70+": só estas personagens aparecem no menu das guild runs.
  const lv70 = document.createElement("button");
  lv70.className = "guild-lv70" + (char.lv70 ? " on" : "");
  lv70.textContent = "70+";
  lv70.setAttribute("aria-pressed", char.lv70 ? "true" : "false");
  lv70.title = char.lv70 ? "Está no lv70 ou mais (clica para desmarcar)" : "Clica se a personagem já está no lv70 ou mais";
  lv70.addEventListener("click", () => {
    setCharacterLv70(char.id, !char.lv70).catch((err) => alert(err.message || "Erro ao guardar."));
  });

  row.append(name, desc, medals, lv70, buildVoteButton(char));
  if (editMode) row.append(del);
  return row;
}

// ---------- Menu "Votar": doações e participação ----------
const popoverEl = document.getElementById("guild-popover");
let popover = null; // { charId, anchor: { left, top, bottom } } enquanto estiver aberto

// Já votou tudo hoje (as 3 doações e a participação)?
function isVoted(char) {
  const usage = usageOf(char);
  return usage.donations >= DAILY_LIMITS.donations && usage.participated;
}

function buildVoteButton(char) {
  const usage = usageOf(char);
  const done = isVoted(char);
  const btn = document.createElement("button");
  btn.className = "guild-vote" + (done ? " done" : "");
  btn.textContent = done ? "✓ votado" : "Votar";
  btn.title = `Doações ${usage.donations}/${DAILY_LIMITS.donations} · Participação ${usage.participated ? 1 : 0}/${DAILY_LIMITS.participation}`;
  btn.addEventListener("click", () => {
    if (popover?.charId === char.id) {
      closePopover();
      return;
    }
    const rect = btn.getBoundingClientRect();
    popover = { charId: char.id, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } };
    renderPopover();
  });
  return btn;
}

function closePopover() {
  popover = null;
  popoverEl.hidden = true;
  popoverEl.innerHTML = "";
}

// Posição junto ao botão, sem sair do ecrã (abre para cima se não couber por baixo).
function placePopover() {
  popoverEl.hidden = false;
  const { left, top, bottom } = popover.anchor;
  const width = popoverEl.offsetWidth;
  const height = popoverEl.offsetHeight;
  popoverEl.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  const below = bottom + 4;
  popoverEl.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, top - height - 4) : below}px`;
}

// Menu do botão "Votar em falta": o mesmo tipo de menu, mas cada botão aplica-se a TODAS as
// personagens da guild que ainda não fizeram esse voto hoje (doações: menos de 3; participação: ainda não).
function renderBulkPopover() {
  const guild = currentGuild();
  if (!guild) {
    closePopover();
    return;
  }
  const chars = charactersOfGuild(guild.id);
  const missingDonation = chars.filter((c) => usageOf(c).donations < DAILY_LIMITS.donations);
  const missingParticipation = chars.filter((c) => !usageOf(c).participated);

  popoverEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "guild-popover-title";
  title.textContent = "Votar em falta";
  popoverEl.appendChild(title);

  for (const [label, amounts, kind, targets] of [
    ["Doações", MEDAL_BUTTONS.donations, "donation", missingDonation],
    ["Participação", MEDAL_BUTTONS.participation, "participation", missingParticipation],
  ]) {
    const section = document.createElement("div");
    section.className = "guild-popover-group";
    const heading = document.createElement("span");
    heading.className = "guild-popover-label";
    heading.textContent = `${label} — faltam ${targets.length} de ${chars.length}`;
    const group = document.createElement("div");
    group.className = "guild-btns";
    for (const amount of amounts) {
      const btn = document.createElement("button");
      btn.className = "secondary guild-plus";
      btn.textContent = `+${amount}`;
      btn.disabled = targets.length === 0;
      btn.title = targets.length === 0 ? "Todas as personagens já fizeram este voto hoje" : `Somar ${amount} a ${targets.length} personagens`;
      btn.addEventListener("click", () => bulkVote(kind, amount, targets));
      group.appendChild(btn);
    }
    section.append(heading, group);
    popoverEl.appendChild(section);
  }

  if (popover.message) {
    const note = document.createElement("div");
    note.className = "guild-popover-note";
    note.textContent = popover.message;
    popoverEl.appendChild(note);
  }
  placePopover();
}

async function bulkVote(kind, amount, targets) {
  const what = kind === "donation" ? "doação" : "participação";
  if (!confirm(`Somar +${amount} (${what}) a ${targets.length} ${targets.length === 1 ? "personagem" : "personagens"}?\n\nSó recebem as que ainda não fizeram este voto hoje.`)) return;
  try {
    const applied = await addMedalsBulk(targets.map((c) => c.id), amount, kind);
    if (popover?.bulk) {
      popover.message = `✓ +${amount} somado a ${applied} ${applied === 1 ? "personagem" : "personagens"}.`;
      renderPopover();
    }
  } catch (err) {
    alert(err.message || "Erro ao votar.");
  }
}

function renderPopover() {
  if (!popover) return;
  if (popover.bulk) {
    renderBulkPopover();
    return;
  }
  const char = characters.find((c) => c.id === popover.charId);
  if (!char) {
    closePopover();
    return;
  }

  popoverEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "guild-popover-title";
  title.textContent = char.name;
  popoverEl.appendChild(title);

  for (const [label, amounts, kind] of [
    [`Doações (máx. ${DAILY_LIMITS.donations} por dia)`, MEDAL_BUTTONS.donations, "donation"],
    [`Participação (máx. ${DAILY_LIMITS.participation} por dia)`, MEDAL_BUTTONS.participation, "participation"],
  ]) {
    const section = document.createElement("div");
    section.className = "guild-popover-group";
    const heading = document.createElement("span");
    heading.className = "guild-popover-label";
    heading.textContent = label;
    section.append(heading, medalButtons(char, amounts, kind));
    popoverEl.appendChild(section);
  }

  placePopover();
}

// Fecha ao clicar fora, com Esc, ao fazer scroll ou ao mudar o tamanho da janela.
document.addEventListener("mousedown", (e) => {
  if (popover && !popoverEl.contains(e.target) && !e.target.closest(".guild-vote, .guild-vote-all")) closePopover();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePopover();
});
window.addEventListener("scroll", () => closePopover(), true);
window.addEventListener("resize", () => closePopover());

// ---------- Pergunta Sim / Não ----------
const confirmModal = document.getElementById("guild-confirm-modal");
const confirmText = document.getElementById("guild-confirm-text");
let confirmResolve = null;

// Mostra a mensagem e pergunta "Queres continuar?". Devolve true (Sim) ou false (Não, ou fechar a janela).
function askYesNo(message) {
  confirmResolve?.(false);
  confirmText.textContent = message;
  confirmModal.showModal();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function answerConfirm(answer) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmModal.open) confirmModal.close();
  resolve?.(answer);
}

document.getElementById("guild-confirm-yes").addEventListener("click", () => answerConfirm(true));
document.getElementById("guild-confirm-no").addEventListener("click", () => answerConfirm(false));
// Fechar de outra forma (Esc, clicar fora) conta como "Não".
confirmModal.addEventListener("close", () => answerConfirm(false));

// ---------- Menu "Guild Run" ----------
const runModal = document.getElementById("guild-run-modal");
const runList = document.getElementById("guild-run-list");
const runInfo = document.getElementById("guild-run-info");

function openRunModal() {
  if (!currentGuild()) return;
  runModal.showModal();
  renderRunModal();
}

document.getElementById("guild-run-close").addEventListener("click", () => runModal.close());

// Lista as personagens lv70+ da guild; para cada uma, só aparecem as guild runs ainda por fazer
// esta semana (as feitas ficam como "✓ LvNN", que se podem anular). As runs de nível acima
// do da guild ficam desativadas.
function renderRunModal() {
  if (!runModal.open) return;
  const guild = currentGuild();
  if (!guild) {
    runModal.close();
    return;
  }
  const guildLevel = guild.level || DEFAULT_GUILD_LEVEL;
  // Só aparecem as guild runs que a guild já desbloqueou (as de nível superior ficam escondidas).
  const availableRuns = GUILD_RUNS.filter((run) => run.level <= guildLevel);
  runInfo.textContent = `Guild lv${guildLevel} · cada guild run só pode ser feita 1 vez por semana por personagem · reinicia à segunda às 03:00 PT (04:00 CZ/CH)`;

  const accountName = (id) => accounts.find((a) => a.id === id)?.name || "";
  const chars = charactersOfGuild(guild.id)
    .filter((c) => c.lv70)
    .sort((a, b) => accountName(a.accountId).localeCompare(accountName(b.accountId), "pt") || byCreated(a, b));

  runList.innerHTML = "";
  if (chars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = 'Ainda não há personagens lv70+. Marca "70+" nas personagens que já lá chegaram.';
    runList.appendChild(empty);
    return;
  }

  if (availableRuns.length === 0) {
    const none = document.createElement("p");
    none.className = "empty-hint";
    none.textContent = `A guild precisa de ser pelo menos lv${GUILD_RUNS[0].level} para fazer guild runs.`;
    runList.appendChild(none);
    return;
  }

  const week = weekKey();
  for (const char of chars) {
    const done = runsDoneOf(char, week);
    const row = document.createElement("div");
    row.className = "guild-run-row";

    const label = document.createElement("span");
    label.className = "guild-run-name";
    const strong = document.createElement("strong");
    strong.textContent = char.name;
    const acc = document.createElement("small");
    acc.textContent = accountName(char.accountId);
    label.append(strong, acc);

    const buttons = document.createElement("div");
    buttons.className = "guild-btns";
    for (const run of availableRuns) {
      if (done.includes(run.level)) continue;
      const btn = document.createElement("button");
      btn.className = "secondary guild-plus guild-run-btn";
      btn.textContent = `Lv${run.level} +${run.medals}`;
      btn.title = `Guild run lv${run.level}: somar ${run.medals} medalhas a ${char.name}`;
      btn.addEventListener("click", () => {
        addGuildRun(char.id, run.level).catch((err) => alert(err.message || "Erro ao registar a guild run."));
      });
      buttons.appendChild(btn);
    }
    if (availableRuns.length > 0 && availableRuns.every((run) => done.includes(run.level))) {
      const all = document.createElement("span");
      all.className = "guild-run-all";
      all.textContent = "✓ Todas feitas esta semana";
      buttons.appendChild(all);
    }

    const doneBox = document.createElement("div");
    doneBox.className = "guild-run-done";
    for (const level of [...done].sort((a, b) => a - b)) {
      const chip = document.createElement("button");
      chip.className = "guild-counter full";
      chip.textContent = `✓ Lv${level}`;
      const runMedals = GUILD_RUNS.find((r) => r.level === level)?.medals ?? 0;
      chip.title = `Feita esta semana. Clica para remover (a personagem perde as ${runMedals} medalhas)`;
      chip.addEventListener("click", () => {
        if (!confirm(`Remover a guild run Lv${level} de ${char.name}?\n\nA personagem perde as ${runMedals} medalhas dessa run e o nível volta a poder ser feito esta semana.`)) return;
        undoGuildRun(char.id, level).catch((err) => alert(err.message || "Erro ao remover a guild run."));
      });
      doneBox.appendChild(chip);
    }

    row.append(label, buttons, doneBox);
    runList.appendChild(row);
  }
}

// ---------- Janela de nome (guild / conta / personagem) ----------
let inputMode = null;
let inputAccount = null;

function openInputModal(mode, account = null) {
  inputMode = mode;
  inputAccount = account;
  inputError.textContent = "";
  inputForm.reset();
  inputField.maxLength = mode === "character" ? MAX_CHARACTER_NAME : 40;
  if (mode === "guild") {
    inputTitle.textContent = "Nova guild";
    inputLabel.textContent = "Nome da guild";
  } else if (mode === "account") {
    inputTitle.textContent = "Nova conta";
    inputLabel.textContent = "Nome da conta";
  } else {
    inputTitle.textContent = `Nova personagem — ${account.name}`;
    inputLabel.textContent = "Nome da personagem";
  }
  inputModal.showModal();
}

newGuildBtn.addEventListener("click", () => openInputModal("guild"));
document.getElementById("guild-input-cancel").addEventListener("click", () => inputModal.close());

inputForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  inputError.textContent = "";

  const name = inputField.value.trim();
  if (!name) {
    inputError.textContent = "Indica um nome.";
    return;
  }
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (inputMode === "character" && name.length > MAX_CHARACTER_NAME) {
    inputError.textContent = `O nome da personagem pode ter no máximo ${MAX_CHARACTER_NAME} caracteres.`;
    return;
  }

  try {
    if (inputMode === "guild") {
      if (guilds.length >= maxGuilds()) {
        inputError.textContent = guildLimitMessage();
        return;
      }
      if (guilds.some((g) => same(g.name, name))) {
        inputError.textContent = "Já tens uma guild com esse nome.";
        return;
      }
      const ref = await createGuild({ ownerUid, name });
      selectedGuildId = ref.id;
      saveSelected(ref.id);
    } else if (inputMode === "account") {
      const guild = currentGuild();
      if (!guild) return;
      if (accountsOf(guild.id).some((a) => same(a.name, name))) {
        inputError.textContent = "Já existe uma conta com esse nome nesta guild.";
        return;
      }
      await addGuildAccount({ ownerUid, guildId: guild.id, name });
    } else {
      const guild = currentGuild();
      if (!guild) return;
      const guildChars = charactersOfGuild(guild.id);
      if (guildChars.length >= maxChars()) {
        inputError.textContent = `Máximo de ${maxChars()} personagens por guild.`;
        return;
      }
      if (guildChars.some((c) => same(c.name, name))) {
        inputError.textContent = "Já existe uma personagem com esse nome nesta guild.";
        return;
      }
      await addGuildCharacter({ ownerUid, guildId: guild.id, accountId: inputAccount.id, name });
      // Mostra a conta aberta, para se ver a personagem nova.
      collapsedAccounts.delete(inputAccount.id);
    }
    inputModal.close();
  } catch (err) {
    inputError.textContent = err.message || "Erro ao guardar.";
  }
});

// ---------- Ligação à app ----------
// Chamado no login; devolve a função que pára as subscrições.
export function startGuild(user, getLimitsFn) {
  ownerUid = user.uid;
  getLimits = getLimitsFn || getLimits;
  const unsubs = [
    subscribeToOwnGuilds(user.uid, (items) => {
      guilds = items;
      render();
    }),
    subscribeToOwnGuildAccounts(user.uid, (items) => {
      accounts = items;
      render();
    }),
    subscribeToOwnGuildCharacters(user.uid, (items) => {
      characters = items;
      render();
    }),
  ];
  // Quando o "dia de doações" muda (03:00 PT / 04:00 CZ) os contadores voltam a zero: redesenha.
  let lastKey = periodKey();
  const resetWatcher = setInterval(() => {
    const key = periodKey();
    if (key !== lastKey) {
      lastKey = key;
      render();
    }
  }, 30000);
  return () => {
    clearInterval(resetWatcher);
    closePopover();
    if (runModal.open) runModal.close();
    unsubs.forEach((u) => u());
    guilds = [];
    accounts = [];
    characters = [];
    selectedGuildId = null;
    ownerUid = null;
    tabsEl.innerHTML = "";
    bodyEl.innerHTML = "";
  };
}
