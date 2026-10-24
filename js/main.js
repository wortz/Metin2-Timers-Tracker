import { login, logout, onAuthChange, isAdmin, isPrivileged, subscribeToOwnProfile, currentUser } from "./auth.js";
import {
  COSTUME_TYPES,
  COSTUME_ICONS,
  addCostume,
  deleteCostume,
  renewCostume,
  renewPet,
  toDurationMs,
  moveCostume,
  subscribeToOwnCostumes,
  subscribeToAllCostumes,
  computeRemaining,
  formatEndDate,
  formatRemaining,
} from "./costumes.js";
import {
  addSection,
  deleteSection,
  subscribeToOwnSections,
  reorderSections,
  ensureDefaultSection,
} from "./sections.js";
import {
  addCharacter,
  deleteCharacterEverywhere,
  subscribeToOwnCharacters,
  subscribeToAllCharacters,
} from "./characters.js";
import { createUser, disableUser, setPrivileged, subscribeToUsers } from "./admin.js";
import {
  requestNotificationPermission,
  checkCostumeNotifications,
  testDiscordDM,
  notifyCostumeRenewed,
  getNotifyRepeatSetting,
  setNotifyRepeatSetting,
} from "./notifications.js";
import {
  INSTANCES,
  REGISTRATION_COOLDOWN_MS,
  CHANNELS,
  subscribeToRegistration,
  saveRegistration,
} from "./registrations.js";
import { notifyRegistration } from "./notifications.js";
import { startBio } from "./bio-ui.js";
import { startGuild } from "./guild-ui.js";
import { startHydras } from "./hydras-ui.js";
import { startHydraTimer } from "./hydra-timer.js";
import "./theme.js";
import { limitsFor } from "./limits.js";
import { startUpdateCheck } from "./update-check.js";
import { DISCORD_OAUTH_CLIENT_ID } from "./settings.js";
import { DEFAULT_USER_SETTINGS, getUserSettings, saveUserSettings, subscribeToUserSettings } from "./user-settings.js";

// ---------- Elements ----------
const loadingView = document.getElementById("loading-view");
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");
const navEl = document.getElementById("sidebar");
const navAdmin = document.getElementById("nav-admin");
const appViewEl = document.getElementById("app-view");
const registryViewEl = document.getElementById("registry-view");
const guildViewEl = document.getElementById("guild-view");
const hidrasViewEl = document.getElementById("hidras-view");
const fazerHidraViewEl = document.getElementById("fazer-hidra-view");
const listTitleEl = document.getElementById("list-title");
const costumesViewEl = document.getElementById("costumes-view");
const adminViewEl = document.getElementById("admin-view");
const bioViewEl = document.getElementById("bio-view");
const costumesListEl = document.getElementById("costumes-list");
const expiryBannerEl = document.getElementById("expiry-banner");
const urgentBannerEl = document.getElementById("urgent-banner");
const usersListEl = document.getElementById("users-list");

const addCostumeBtn = document.getElementById("add-costume-btn");
const costumeModal = document.getElementById("costume-modal");
const costumeForm = document.getElementById("costume-form");
const costumeFormError = document.getElementById("costume-form-error");
const costumeCancelBtn = document.getElementById("costume-cancel");
const costumeTypePicker = document.getElementById("costume-type-picker");
const costumeTypeInput = document.getElementById("costume-type");
const costumeModalTitle = document.getElementById("costume-modal-title");
const costumeTypeLabel = document.getElementById("costume-type-label");
const costumeDescLabel = document.getElementById("costume-desc-label");
const costumeRemainingFieldset = document.getElementById("costume-remaining-fieldset");
const costumeTimeLegend = document.getElementById("costume-time-legend");

const renewModal = document.getElementById("renew-modal");
const renewForm = document.getElementById("renew-form");
const renewFormError = document.getElementById("renew-form-error");
const renewCancelBtn = document.getElementById("renew-cancel");
const renewCostumeIcon = document.getElementById("renew-costume-icon");
const renewCostumeName = document.getElementById("renew-costume-name");
const renewCostumeType = document.getElementById("renew-costume-type");
const renewCostumeDesc = document.getElementById("renew-costume-desc");

const sectionModal = document.getElementById("section-modal");
const sectionForm = document.getElementById("section-form");
const sectionFormError = document.getElementById("section-form-error");
const sectionCancelBtn = document.getElementById("section-cancel");
const sectionCharacterLabel = document.getElementById("section-character-label");

const addCharacterBtn = document.getElementById("add-character-btn");
const characterModal = document.getElementById("character-modal");
const characterForm = document.getElementById("character-form");
const characterFormError = document.getElementById("character-form-error");
const characterCancelBtn = document.getElementById("character-cancel");

const addUserBtn = document.getElementById("add-user-btn");
const userModal = document.getElementById("user-modal");
const userForm = document.getElementById("user-form");
const userFormError = document.getElementById("user-form-error");
const userCancelBtn = document.getElementById("user-cancel");

const notifHint = document.getElementById("notif-hint");
const enableNotifBtn = document.getElementById("enable-notif-btn");

const openSettingsBtn = document.getElementById("open-settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsForm = document.getElementById("settings-form");
const settingsFormError = document.getElementById("settings-form-error");
const settingsCancelBtn = document.getElementById("settings-cancel");
const settingsNotifyDays = document.getElementById("settings-notify-days");
const settingsNotifyRepeat = document.getElementById("settings-notify-repeat");
const settingsWarningDays = document.getElementById("settings-warning-days");
const settingsAlertDays = document.getElementById("settings-alert-days");
const dmRecipientsListEl = document.getElementById("dm-recipients-list");
const settingsDmNewName = document.getElementById("settings-dm-new-name");
const settingsDmNewId = document.getElementById("settings-dm-new-id");
const settingsDmAddBtn = document.getElementById("settings-dm-add");
const settingsDmTestBtn = document.getElementById("settings-dm-test");
const settingsDmTestResult = document.getElementById("settings-dm-test-result");
const discordLoginBtn = document.getElementById("discord-login-btn");

// ---------- State ----------
let unsubscribers = [];

// Guild e histórico das Hidras só ligam ao Firestore quando se abre a página pela primeira vez
// (e ficam ligados até sair), para a app gastar menos leituras e ligações ao abrir.
let lazyUser = null;
const lazyStarted = new Set();

function ensurePageData(page) {
  if (!lazyUser || lazyStarted.has(page)) return;
  const user = lazyUser;
  const starters = {
    guild: () => startGuild(user, () => userLimits()),
    hidras: () => startHydras(user),
  };
  if (!starters[page]) return;
  lazyStarted.add(page);
  unsubscribers.push(starters[page]());
}
// Trajes e pets têm dados separados, mas ambos ficam sempre subscritos (para as
// notificações funcionarem nos dois). As variáveis latest* abaixo espelham o
// sistema que está aberto no momento (currentKind).
const store = {
  costume: { items: [], sections: [], characters: [] },
  pet: { items: [], sections: [], characters: [] },
};
let currentKind = "costume";
let latestCostumes = [];
let latestSections = [];
let latestCharacters = [];
let latestUsers = [];
let latestAllCostumes = [];
let latestAllPets = [];
let latestAllCharacters = [];
let latestRegistration = { meley: null, balathor: null };
const registryStatus = {};
let latestUserSettings = DEFAULT_USER_SETTINGS;
let renewingCostume = null;
let creatingSectionForCharacter = null;
let settingsDmRecipientsState = [];

// ---------- Auth ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await login(email, password);
  } catch (err) {
    loginError.textContent = friendlyAuthError(err);
  }
});

logoutBtn.addEventListener("click", () => logout());

onAuthChange((user, err) => {
  cleanupSubscriptions();
  loadingView.hidden = true;

  if (!user) {
    appView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
    if (err) loginError.textContent = err.message;
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  userEmailEl.textContent = user.displayName;

  const admin = isAdmin();
  navAdmin.hidden = !admin;
  // Abre na última página em que o utilizador estava (guardada num cookie).
  navigate(readPageCookie() || "costume");

  for (const kind of ["costume", "pet"]) {
    unsubscribers.push(
      subscribeToOwnCostumes(user.uid, (items) => setStore(kind, "items", items), kind),
      subscribeToOwnSections(user.uid, (sections) => setStore(kind, "sections", sections), kind)
    );
  }
  // As personagens são partilhadas entre trajes e pets: uma única coleção.
  unsubscribers.push(
    subscribeToOwnCharacters(user.uid, (characters) => {
      setStore("costume", "characters", characters);
      setStore("pet", "characters", characters);
    })
  );

  // Muda os limites logo que o admin torna a conta privilegiada (ou o remove).
  unsubscribers.push(
    subscribeToOwnProfile(user.uid, (profile) => {
      currentUser.privileged = !!profile.privileged;
      renderCostumes();
    })
  );

  unsubscribers.push(
    startBio(user, () =>
      Object.values(store).flatMap((st) => [...st.characters.map((c) => c.name), ...st.items.map((c) => c.character)]),
    () => latestUserSettings.discordRecipients,
    () => userLimits(),
    (count) => setNavBadge("bio", count, `${count} pronto${count === 1 ? "" : "s"} para entregar / recolher`)
    )
  );

  unsubscribers.push(startHydraTimer(user));
  lazyUser = user;
  lazyStarted.clear();
  ensurePageData(currentPage); // se a página guardada no cookie for a Guild ou o histórico

  unsubscribers.push(
    subscribeToRegistration(user.uid, (registration) => {
      latestRegistration = registration;
      renderRegistry();
    })
  );

  unsubscribers.push(
    subscribeToUserSettings(user.uid, (settings) => {
      latestUserSettings = settings;
      renderCostumes();
    })
  );

  if (admin) {
    unsubscribers.push(
      subscribeToUsers((users) => {
        latestUsers = users;
        renderUsers();
      }),
      subscribeToAllCostumes((costumes) => {
        latestAllCostumes = costumes;
        renderUsers();
      }),
      subscribeToAllCostumes((pets) => {
        latestAllPets = pets;
        renderUsers();
      }, "pet"),
      subscribeToAllCharacters((characters) => {
        latestAllCharacters = characters;
        renderUsers();
      })
    );
  }

  if ("Notification" in window && Notification.permission === "default") {
    notifHint.hidden = false;
  }
});

function setStore(kind, field, value) {
  store[kind][field] = value;
  updateNavBadges();
  if (kind === currentKind) {
    syncCurrentKind();
    renderCostumes();
  }
}

function syncCurrentKind() {
  latestCostumes = store[currentKind].items;
  latestSections = store[currentKind].sections;
  latestCharacters = store[currentKind].characters;
}

function cleanupSubscriptions() {
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  lazyUser = null;
  lazyStarted.clear();
  for (const kind of Object.keys(store)) store[kind] = { items: [], sections: [], characters: [] };
  syncCurrentKind();
  latestUsers = [];
  latestAllCostumes = [];
  latestAllPets = [];
  latestAllCharacters = [];
  latestRegistration = { meley: null, balathor: null };
  latestUserSettings = DEFAULT_USER_SETTINGS;
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email ou password incorretos.";
  }
  if (code.includes("too-many-requests")) {
    return "Demasiadas tentativas. Tenta novamente mais tarde.";
  }
  return err.message || "Erro ao entrar.";
}

// ---------- Views (menu / trajes / pets / admin) ----------
const IS_PET = () => currentKind === "pet";

const KIND_TEXT = {
  costume: {
    title: "Os meus trajes",
    add: "+ Adicionar traje",
    empty: "Ainda não tens trajes adicionados.",
    singular: "traje",
    plural: "trajes",
  },
  pet: {
    title: "Os meus pets",
    add: "+ Adicionar pet",
    empty: "Ainda não tens pets adicionados.",
    singular: "pet",
    plural: "pets",
  },
};

function kindText() {
  return KIND_TEXT[currentKind];
}

// ---------- Navegação (barra lateral) ----------
const PAGES = ["costume", "pet", "bio", "registos", "guild", "hidras", "fazer-hidra", "admin"];
const PAGE_COOKIE = "timers_page";
let currentPage = null;

// A página atual fica guardada num cookie (1 ano), só para este site.
function readPageCookie() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${PAGE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function savePageCookie(page) {
  const path = location.pathname.replace(/[^/]*$/, "") || "/";
  document.cookie = `${PAGE_COOKIE}=${encodeURIComponent(page)}; max-age=31536000; path=${path}; SameSite=Lax`;
}

function closeSidebar() {
  appViewEl.classList.remove("sidebar-open");
}

function navigate(page) {
  if (!PAGES.includes(page) || (page === "admin" && !isAdmin())) page = "costume";
  currentPage = page;
  ensurePageData(page);

  const isList = page === "costume" || page === "pet";
  if (isList) {
    currentKind = page;
    syncCurrentKind();
    addCostumeBtn.textContent = kindText().add;
  }
  costumesViewEl.hidden = !isList;
  bioViewEl.hidden = page !== "bio";
  registryViewEl.hidden = page !== "registos";
  guildViewEl.hidden = page !== "guild";
  hidrasViewEl.hidden = page !== "hidras";
  fazerHidraViewEl.hidden = page !== "fazer-hidra";
  adminViewEl.hidden = page !== "admin";

  for (const item of navEl.querySelectorAll(".nav-item[data-page]")) {
    // O histórico das hidras abre-se a partir do menu "Hidras" (que mostra o cronómetro).
    item.classList.toggle("active", item.dataset.page === page || (item.dataset.page === "fazer-hidra" && page === "hidras"));
  }
  savePageCookie(page);
  closeSidebar();
  if (isList) renderCostumes();
}

document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto-page]");
  if (goto) navigate(goto.dataset.gotoPage);
});

navEl.addEventListener("click", (e) => {
  const item = e.target.closest(".nav-item[data-page]");
  if (item) navigate(item.dataset.page);
});

// Em ecrãs pequenos a barra lateral abre e fecha com o botão ☰.
document.getElementById("sidebar-toggle").addEventListener("click", () => appViewEl.classList.toggle("sidebar-open"));
document.getElementById("sidebar-backdrop").addEventListener("click", closeSidebar);
document.getElementById("sidebar").addEventListener("click", (e) => {
  if (e.target.closest("#open-settings-btn, #logout-btn")) closeSidebar();
});

// Personagens conhecidas da conta (partilhadas por trajes, pets e Biologo / 6-7), sem repetir.
function knownCharacterNames() {
  const seen = new Map();
  for (const st of Object.values(store)) {
    for (const name of [...st.characters.map((c) => c.name), ...st.items.map((c) => c.character)]) {
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

// Limites da conta atual (base ou privilegiada).
function userLimits() {
  return limitsFor(isPrivileged());
}

function itemLimit() {
  return IS_PET() ? userLimits().pets : userLimits().costumes;
}

// ---------- Registos (Meley / Balathor) ----------
const INSTANCE_ICONS = { meley: "assets/icons/meley.png", balathor: "assets/icons/balathor.png" };
const registryBoxesEl = document.getElementById("registry-boxes");

function formatRegistryTime(date) {
  return date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderRegistry() {
  updateNavBadges();
  registryBoxesEl.innerHTML = "";
  for (const [key, label] of Object.entries(INSTANCES)) {
    const registration = latestRegistration[key];
    const registeredAt = registration ? registration.at : null;
    const box = document.createElement("div");
    box.className = "registry-box";

    // Os dois cartões têm sempre as mesmas duas linhas, para ficarem com o mesmo tamanho.
    let info = `
      <p class="registry-line muted">Último registo: <strong>—</strong></p>
      <p class="registry-line ready">Próximo registo: <strong>já podes</strong></p>`;
    if (registeredAt) {
      const nextAt = new Date(registeredAt.getTime() + REGISTRATION_COOLDOWN_MS);
      const ready = Date.now() >= nextAt.getTime();
      info = `
        <p class="registry-line">Último registo: <strong>${registration.channel ? `Canal ${registration.channel}` : "—"}</strong></p>
        <p class="registry-line ${ready ? "ready" : "muted"}">Próximo registo: <strong>${formatRegistryTime(nextAt)}</strong></p>${ready ? '<p class="registry-line ready"><strong>Já podes</strong></p>' : ""}`;
    }
    // Imagem do boss (assets/icons/meley.png, balathor.png); se faltar, esconde-se sozinha.
    box.innerHTML = `
      <div class="registry-image"><img src="${INSTANCE_ICONS[key]}" alt="${label}" onerror="this.style.display='none'" /></div>
      <div class="registry-body">
        <h4>Registo de ${label}</h4>
        ${info}
      </div>`;

    const body = box.querySelector(".registry-body");
    const btn = document.createElement("button");
    btn.textContent = "Registar";
    btn.addEventListener("click", () => registerInstance(key));
    body.appendChild(btn);

    const status = document.createElement("p");
    status.className = "registry-status";
    status.textContent = registryStatus[key] || "";
    body.appendChild(status);

    registryBoxesEl.appendChild(box);
  }
}

// Só em localhost: simula um registo no ecrã (sem guardar no Firebase) para testar
// o aspeto. Na consola: demoRegistration("meley", 30) -> registo feito há 30 min.
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.demoRegistration = (instance = "meley", minutesAgo = 30) => {
    latestRegistration = { ...latestRegistration, [instance]: { at: new Date(Date.now() - minutesAgo * 60000), channel: 1 } };
    renderRegistry();
  };
}

const registryModal = document.getElementById("registry-modal");
const registryForm = document.getElementById("registry-form");
const registryChannelSelect = document.getElementById("registry-channel");
const registryFormError = document.getElementById("registry-form-error");
let registeringKey = null;

// Passo 1: avisa se ainda não passaram 3h; passo 2: escolher o canal (1 a 6).
function registerInstance(key) {
  const label = INSTANCES[key];
  const last = latestRegistration[key];
  if (last) {
    const nextAt = new Date(last.at.getTime() + REGISTRATION_COOLDOWN_MS);
    if (Date.now() < nextAt.getTime()) {
      if (!confirm(`Já tens um registo de ${label} (feito ${formatRegistryTime(last.at)}).
Só podes voltar a registar a partir de ${formatRegistryTime(nextAt)}.
Queres registar mesmo assim?`)) return;
    }
  }

  registeringKey = key;
  registryFormError.textContent = "";
  document.getElementById("registry-modal-title").textContent = `Registo de ${label}`;
  registryChannelSelect.innerHTML = "";
  for (const channel of CHANNELS) {
    const option = document.createElement("option");
    option.value = String(channel);
    option.textContent = `Canal ${channel}`;
    registryChannelSelect.appendChild(option);
  }
  if (last && last.channel) registryChannelSelect.value = String(last.channel);
  registryModal.showModal();
}

document.getElementById("registry-cancel").addEventListener("click", () => registryModal.close());

registryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = registeringKey;
  const channel = Number(registryChannelSelect.value);
  if (!key || !CHANNELS.includes(channel)) {
    registryFormError.textContent = "Escolhe um canal.";
    return;
  }
  registryModal.close();

  registryStatus.meley = registryStatus.balathor = "";
  try {
    await saveRegistration(currentUser.uid, key, channel);
  } catch (err) {
    registryStatus[key] = err.message || "Erro ao guardar o registo.";
    renderRegistry();
    return;
  }

  const now = new Date();
  const nextAt = new Date(now.getTime() + REGISTRATION_COOLDOWN_MS);
  const recipients = latestUserSettings.discordRecipients;
  if (recipients.length === 0) {
    registryStatus[key] = "Registado. (Sem destinatários Discord configurados.)";
  } else {
    registryStatus[key] = "Registado. A enviar mensagem...";
    renderRegistry();
    const results = await notifyRegistration(INSTANCES[key], now, nextAt, recipients, channel);
    const failed = results.filter((r) => !r.ok);
    registryStatus[key] = failed.length === 0 ? "Registado e enviado no Discord." : `Registado, mas o Discord falhou: ${failed.map((f) => f.error).join(", ")}`;
  }
  renderRegistry();
});

// ---------- Notifications ----------
enableNotifBtn.addEventListener("click", () => {
  requestNotificationPermission();
  notifHint.hidden = true;
});

// ---------- Discord OAuth (obter o User ID automaticamente) ----------
function discordRedirectUri() {
  return window.location.origin + window.location.pathname;
}

discordLoginBtn.addEventListener("click", () => {
  if (!DISCORD_OAUTH_CLIENT_ID || DISCORD_OAUTH_CLIENT_ID === "REPLACE_WITH_YOUR_DISCORD_CLIENT_ID") {
    alert("O Client ID do Discord ainda não está configurado (js/settings.js).");
    return;
  }
  const params = new URLSearchParams({
    client_id: DISCORD_OAUTH_CLIENT_ID,
    redirect_uri: discordRedirectUri(),
    response_type: "token",
    scope: "identify",
  });
  window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
});

async function handleDiscordOAuthRedirect() {
  if (!window.location.hash.includes("access_token")) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!accessToken) return;

  try {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Falha ao obter o perfil do Discord.");
    const user = await res.json();

    if (!currentUser) {
      await new Promise((resolve) => {
        const unsub = onAuthChange((u) => {
          if (u) {
            unsub?.();
            resolve();
          }
        });
      });
    }

    const existing = await getUserSettings(currentUser.uid);
    const recipients = existing.discordRecipients.filter((r) => r.id !== user.id);
    recipients.push({ name: user.username, id: user.id });
    await saveUserSettings(currentUser.uid, { ...existing, discordRecipients: recipients });
    alert(`Discord ligado: ${user.username}\nAdicionado à lista de destinatários nas Configurações.`);
  } catch (err) {
    alert(err.message || "Erro ao ligar ao Discord.");
  }
}

handleDiscordOAuthRedirect();

// ---------- Settings modal ----------
function renderDmRecipientsList() {
  dmRecipientsListEl.innerHTML = "";
  if (settingsDmRecipientsState.length === 0) {
    dmRecipientsListEl.innerHTML = '<p class="hint-inline">Ainda não tens destinatários.</p>';
    return;
  }
  for (const recipient of settingsDmRecipientsState) {
    const row = document.createElement("div");
    row.className = "dm-recipient-row";
    row.innerHTML = `
      <span><span class="dm-recipient-name">${escapeHtml(recipient.name || "(sem nome)")}</span> <span class="dm-recipient-id">${escapeHtml(recipient.id)}</span></span>
    `;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "icon-btn small";
    removeBtn.textContent = "×";
    removeBtn.title = "Remover";
    removeBtn.addEventListener("click", () => {
      settingsDmRecipientsState = settingsDmRecipientsState.filter((r) => r.id !== recipient.id);
      renderDmRecipientsList();
    });
    row.appendChild(removeBtn);
    dmRecipientsListEl.appendChild(row);
  }
}

settingsDmAddBtn.addEventListener("click", () => {
  const name = settingsDmNewName.value.trim();
  const id = settingsDmNewId.value.trim();
  if (!id) {
    settingsDmTestResult.textContent = "Indica o Discord User ID a adicionar.";
    settingsDmTestResult.className = "hint-inline error";
    return;
  }
  if (settingsDmRecipientsState.some((r) => r.id === id)) {
    settingsDmTestResult.textContent = "Esse ID já está na lista.";
    settingsDmTestResult.className = "hint-inline error";
    return;
  }
  settingsDmRecipientsState.push({ name, id });
  settingsDmNewName.value = "";
  settingsDmNewId.value = "";
  settingsDmTestResult.textContent = "";
  settingsDmTestResult.className = "hint-inline";
  renderDmRecipientsList();
});

openSettingsBtn.addEventListener("click", () => {
  settingsFormError.textContent = "";
  settingsDmTestResult.textContent = "";
  settingsDmTestResult.className = "hint-inline";
  settingsNotifyDays.value = latestUserSettings.notifyThresholdDays;
  settingsNotifyRepeat.checked = getNotifyRepeatSetting();
  settingsWarningDays.value = latestUserSettings.warningThresholdDays;
  settingsAlertDays.value = latestUserSettings.alertThresholdDays;
  settingsDmRecipientsState = latestUserSettings.discordRecipients.map((r) => ({ ...r }));
  settingsDmNewName.value = "";
  settingsDmNewId.value = "";
  renderDmRecipientsList();
  settingsModal.showModal();
});

settingsCancelBtn.addEventListener("click", () => settingsModal.close());

settingsDmTestBtn.addEventListener("click", async () => {
  if (settingsDmRecipientsState.length === 0) {
    settingsDmTestResult.textContent = "Adiciona primeiro pelo menos um destinatário.";
    settingsDmTestResult.className = "hint-inline error";
    return;
  }
  settingsDmTestBtn.disabled = true;
  settingsDmTestResult.textContent = "A enviar...";
  settingsDmTestResult.className = "hint-inline";
  const results = await Promise.all(settingsDmRecipientsState.map((r) => testDiscordDM(r.id)));
  const failed = results.filter((r) => !r.ok);
  settingsDmTestResult.textContent =
    failed.length === 0
      ? `Enviado a ${results.length} destinatário${results.length > 1 ? "s" : ""} pelos dois bots! Confirma no Discord.`
      : `${results.length - failed.length}/${results.length} enviados. Falhas: ${failed.map((f) => f.error).join(", ")}`;
  settingsDmTestResult.className = failed.length === 0 ? "hint-inline success" : "hint-inline error";
  settingsDmTestBtn.disabled = false;
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const notifyDays = Number(settingsNotifyDays.value);
  const warningDays = Number(settingsWarningDays.value);
  const alertDays = Number(settingsAlertDays.value);

  if (!(notifyDays > 0) || !(warningDays > 0) || !(alertDays > 0)) {
    settingsFormError.textContent = "Os valores têm de ser maiores que zero.";
    return;
  }

  try {
    setNotifyRepeatSetting(settingsNotifyRepeat.checked);
    await saveUserSettings(currentUser.uid, {
      notifyThresholdDays: notifyDays,
      warningThresholdDays: warningDays,
      alertThresholdDays: alertDays,
      discordRecipients: settingsDmRecipientsState,
    });
    settingsModal.close();
    renderCostumes();
  } catch (err) {
    settingsFormError.textContent = err.message || "Erro ao guardar as configurações.";
  }
});

setInterval(() => {
  renderCostumes();
  renderRegistry();
  for (const kind of Object.keys(store)) {
    checkCostumeNotifications(store[kind].items, computeRemaining, latestUserSettings, kind);
  }
}, 30000);

// ---------- Costumes: render ----------
function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

function byRemaining(a, b) {
  return computeRemaining(a.endAt).totalMs - computeRemaining(b.endAt).totalMs;
}

// Aviso do atraso das DMs de expiração: o Worker verifica trajes e pets de hora a hora.
const dmDelayHintEl = document.getElementById("dm-delay-hint");

// Hora no fuso do próprio browser (sem indicar PT/CZ).
function formatClock(date) {
  return date.toLocaleString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

function renderDmDelayHint() {
  if (latestUserSettings.discordRecipients.length === 0) {
    dmDelayHintEl.hidden = true;
    return;
  }
  const next = new Date();
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  dmDelayHintEl.hidden = false;
  dmDelayHintEl.textContent =
    `⏱ Os avisos no Discord são enviados de hora a hora. Próxima verificação por volta das ${formatClock(next)}.`;
}

function renderCostumes() {
  updateNavBadges();
  renderExpiryBanner();
  renderDmDelayHint();
  listTitleEl.textContent = `${kindText().title} (${latestCostumes.length}/${itemLimit()})`;
  costumesListEl.innerHTML = "";

  if (latestCostumes.length === 0 && latestSections.length === 0 && latestCharacters.length === 0 && !store.costume.items.length && !store.pet.items.length) {
    costumesListEl.innerHTML = `<p class="empty-state">${kindText().empty}</p>`;
    return;
  }

  const characterNames = [
    ...new Set([
      ...latestCostumes.map((c) => c.character),
      ...latestSections.map((s) => s.character),
      ...latestCharacters.map((c) => c.name),
      // Personagens que só têm itens no outro sistema também aparecem aqui.
      ...Object.keys(store).flatMap((kind) => store[kind].items.map((c) => c.character)),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt"));

  for (const character of characterNames) {
    costumesListEl.appendChild(buildCharacterGroup(character));
  }
}

function buildCharacterGroup(character) {
  const groupEl = document.createElement("div");
  groupEl.className = "character-group";


  const header = document.createElement("div");
  header.className = "character-header";
  header.innerHTML = `<h3>${escapeHtml(character)}</h3>`;

  const headerActions = document.createElement("div");
  headerActions.className = "section-header-actions";

  const addSectionBtn = document.createElement("button");
  addSectionBtn.className = "secondary small";
  addSectionBtn.textContent = "+ Secção";
  addSectionBtn.addEventListener("click", () => openSectionModal(character));
  headerActions.appendChild(addSectionBtn);

  // Apaga a personagem e tudo o que ela tem (trajes, pets e tempos do Biologo / 6-7).
  const delCharBtn = document.createElement("button");
  delCharBtn.className = "icon-btn small";
  delCharBtn.textContent = "×";
  delCharBtn.title = "Apagar personagem";
  delCharBtn.addEventListener("click", async () => {
    const countOf = (kind) => store[kind].items.filter((c) => c.character.toLowerCase() === character.toLowerCase()).length;
    const message =
      `Apagar a personagem "${character}"?

` +
      `Vai apagar também TUDO o que ela tem, em todos os menus: ${countOf("costume")} trajes, ${countOf("pet")} pets e os tempos do Biologo / 6-7.
` +
      `Não dá para desfazer.`;
    if (!confirm(message)) return;
    try {
      await deleteCharacterEverywhere(currentUser.uid, character);
    } catch (err) {
      alert(err.message || "Erro ao apagar a personagem.");
    }
  });
  headerActions.appendChild(delCharBtn);

  header.appendChild(headerActions);
  groupEl.appendChild(header);

  const sections = latestSections.filter((s) => s.character === character).sort(byOrder);
  const defaultSections = sections.filter((s) => s.isDefault);
  const defaultSection = defaultSections[0];
  ensureCharacterDefaultSection(character, defaultSections);

  const sectionsContainer = document.createElement("div");
  sectionsContainer.className = "sections-container";
  sectionsContainer.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("application/x-section-id")) return;
    e.preventDefault();
    sectionsContainer.classList.add("dropzone-active");
    showInsertionMarker(sectionsContainer, e.clientY, ".section-block:not(.unsectioned)");
  });
  sectionsContainer.addEventListener("dragleave", (e) => {
    if (sectionsContainer.contains(e.relatedTarget)) return;
    sectionsContainer.classList.remove("dropzone-active");
    clearInsertionMarker(sectionsContainer);
  });
  sectionsContainer.addEventListener("drop", (e) => {
    sectionsContainer.classList.remove("dropzone-active");
    clearInsertionMarker(sectionsContainer);
    handleSectionDrop(e, sectionsContainer, character);
  });

  const extraDefaultIds = new Set(defaultSections.slice(1).map((s) => s.id));
  const sectionsToRender = sections.filter((s) => !extraDefaultIds.has(s.id));

  for (const section of sectionsToRender) {
    const costumes = latestCostumes.filter((c) => c.character === character && c.sectionId === section.id).sort(byRemaining);
    sectionsContainer.appendChild(buildSectionBlock(section, costumes, character, defaultSection));
  }

  if (defaultSection) {
    migrateOrphanedCostumes(character, defaultSection);
  } else {
    // Enquanto a secção "Geral" ainda não foi criada no Firestore, mostra os trajes sem secção na mesma.
    const orphaned = latestCostumes.filter((c) => c.character === character && !c.sectionId).sort(byRemaining);
    if (orphaned.length) {
      sectionsContainer.appendChild(buildSectionBlock(null, orphaned, character, null));
    }
  }

  groupEl.appendChild(sectionsContainer);

  return groupEl;
}

const pendingDefaultSections = new Set();
const pendingMigrations = new Set();
const pendingDedup = new Set();

function ensureCharacterDefaultSection(character, defaultSections) {
  const key = `${currentKind}:${character}`;
  if (defaultSections.length > 1 && !pendingDedup.has(key)) {
    // Limpa duplicados criados por uma condição de corrida anterior: mantém o mais antigo,
    // move os trajes dos outros para lá, e apaga-os.
    pendingDedup.add(key);
    const [keep, ...extras] = defaultSections;
    Promise.all(extras.map((extra) => deleteSection(extra.id, keep.id, currentKind))).catch((err) => console.error("Erro ao limpar secções duplicadas:", err)).finally(() => pendingDedup.delete(key));
    return;
  }

  if (defaultSections.length > 0 || pendingDefaultSections.has(key)) return;
  pendingDefaultSections.add(key);
  ensureDefaultSection({ ownerUid: currentUser.uid, character, kind: currentKind }).catch((err) => console.error("Erro ao criar a secção Geral:", err)).finally(() => {
    pendingDefaultSections.delete(key);
  });
}

function migrateOrphanedCostumes(character, defaultSection) {
  const orphaned = latestCostumes.filter(
    (c) => c.character === character && (!c.sectionId || !latestSections.some((s) => s.id === c.sectionId))
  );
  const key = `${currentKind}:${character}`;
  if (orphaned.length === 0 || pendingMigrations.has(key)) return;
  pendingMigrations.add(key);
  Promise.all(orphaned.map((c) => moveCostume(c.id, { character, sectionId: defaultSection.id }, currentKind))).catch((err) => console.error("Erro ao mover itens para a secção Geral:", err)).finally(() =>
    pendingMigrations.delete(key)
  );
}

function buildSectionBlock(section, costumes, character, defaultSection) {
  const block = document.createElement("div");
  block.className = "section-block" + (section ? "" : " unsectioned");

  if (section) {
    const header = document.createElement("div");
    header.className = "section-block-header";
    header.draggable = true;
    header.dataset.sectionId = section.id;
    header.dataset.character = character;
    header.innerHTML = `<span class="drag-handle">⠿</span><span class="section-name">${escapeHtml(section.name)}</span>`;

    if (!section.isDefault) {
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn small";
      delBtn.textContent = "×";
      delBtn.title = "Apagar secção";
      delBtn.addEventListener("click", () => {
        if (confirm(`Apagar a secção "${section.name}"? Os ${kindText().plural} lá dentro passam para "Geral".`)) {
          deleteSection(section.id, defaultSection ? defaultSection.id : null, currentKind);
        }
      });
      header.appendChild(delBtn);
    }

    header.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-section-id", section.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => block.classList.add("dragging"), 0);
    });
    header.addEventListener("dragend", () => {
      block.classList.remove("dragging");
      clearAllInsertionMarkers();
    });

    block.appendChild(header);
  } else {
    const header = document.createElement("div");
    header.className = "section-block-header muted";
    header.innerHTML = `<span class="section-name">Geral</span>`;
    block.appendChild(header);
  }

  const dropzone = document.createElement("div");
  dropzone.className = "section-dropzone";
  dropzone.dataset.character = character;
  dropzone.dataset.sectionId = section ? section.id : "";

  dropzone.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("application/x-costume-id")) return;
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", (e) => {
    if (dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove("dropzone-active");
    clearInsertionMarker(dropzone);
  });
  dropzone.addEventListener("drop", (e) => {
    dropzone.classList.remove("dropzone-active");
    clearInsertionMarker(dropzone);
    handleCostumeDrop(e, dropzone);
  });

  if (costumes.length === 0) {
    dropzone.innerHTML = '<p class="empty-hint">Arrasta para aqui</p>';
  } else {
    for (const costume of costumes) {
      dropzone.appendChild(buildCostumeCard(costume));
    }
  }

  block.appendChild(dropzone);
  return block;
}

// ---------- Drag and drop ----------
function getDragAfterElement(container, y, selector) {
  const els = [...container.querySelectorAll(`${selector}:not(.dragging)`)];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function showInsertionMarker(container, y, selector) {
  let marker = container.querySelector(":scope > .insertion-marker");
  if (!marker) {
    marker = document.createElement("div");
    marker.className = "insertion-marker";
    container.appendChild(marker);
  }
  const afterEl = getDragAfterElement(container, y, selector);
  if (afterEl) {
    container.insertBefore(marker, afterEl);
  } else {
    container.appendChild(marker);
  }
}

function clearInsertionMarker(container) {
  container.querySelector(":scope > .insertion-marker")?.remove();
}

function clearAllInsertionMarkers() {
  document.querySelectorAll(".insertion-marker").forEach((el) => el.remove());
  document.querySelectorAll(".dropzone-active").forEach((el) => el.classList.remove("dropzone-active"));
}

async function handleCostumeDrop(e, dropzoneEl) {
  if (!e.dataTransfer.types.includes("application/x-costume-id")) return;
  e.preventDefault();
  dropzoneEl.classList.remove("dropzone-active");
  const costumeId = e.dataTransfer.getData("application/x-costume-id");
  const draggedCostume = latestCostumes.find((c) => c.id === costumeId);
  if (!draggedCostume) return;

  const targetCharacter = dropzoneEl.dataset.character;
  const targetSectionId = dropzoneEl.dataset.sectionId || null;

  if (draggedCostume.character === targetCharacter && (draggedCostume.sectionId || null) === targetSectionId) {
    return;
  }

  try {
    await moveCostume(costumeId, { character: targetCharacter, sectionId: targetSectionId }, currentKind);
  } catch (err) {
    alert(err.message || "Erro ao mover.");
  }
}

async function handleSectionDrop(e, containerEl, character) {
  if (!e.dataTransfer.types.includes("application/x-section-id")) return;
  e.preventDefault();
  const sectionId = e.dataTransfer.getData("application/x-section-id");
  if (!sectionId) return;

  const afterEl = getDragAfterElement(containerEl, e.clientY, ".section-block:not(.unsectioned)");
  const existingIds = [...containerEl.querySelectorAll(".section-block:not(.unsectioned) .section-block-header")]
    .map((el) => el.dataset.sectionId)
    .filter((id) => id !== sectionId);

  let insertIndex = existingIds.length;
  if (afterEl) {
    const headerEl = afterEl.querySelector(".section-block-header");
    const idx = existingIds.indexOf(headerEl?.dataset.sectionId);
    if (idx !== -1) insertIndex = idx;
  }
  existingIds.splice(insertIndex, 0, sectionId);

  try {
    await reorderSections(existingIds.map((id, index) => ({ id, order: index })), currentKind);
  } catch (err) {
    alert(err.message || "Erro ao reordenar a secção.");
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ---------- Bolinhas vermelhas na barra lateral ----------
// Quanto tempo a bolinha dos registos fica acesa depois de passarem as 3 horas.
const REGISTRY_BADGE_WINDOW_MS = 3 * 60 * 60 * 1000;

// type "alert" = bolinha vermelha; "warning" = bolinha amarela (só nos Trajes e Pets).
function setNavBadge(page, count, title, type = "alert") {
  const item = navEl.querySelector(`.nav-item[data-page="${page}"]`);
  const badge = item?.querySelector(type === "warning" ? ".nav-badge-warning" : ".nav-badge:not(.nav-badge-warning)");
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.title = count > 0 ? title : "";
}

// Trajes e pets: bolinha vermelha = já expiraram ou estão dentro do limite de "Alerta" das
// configurações; bolinha amarela = estão dentro do limite de "Aviso" (os de borda amarela),
// sem contar os que já estão na vermelha.
function updateNavBadges() {
  const alertMs = latestUserSettings.alertThresholdDays * ONE_DAY_MS;
  const warningMs = latestUserSettings.warningThresholdDays * ONE_DAY_MS;

  for (const [kind, page, noun] of [["costume", "costume", "traje"], ["pet", "pet", "pet"]]) {
    let urgent = 0;
    let warning = 0;
    for (const item of store[kind].items) {
      const remaining = computeRemaining(item.endAt);
      if (remaining.expired || remaining.totalMs <= alertMs) urgent++;
      else if (remaining.totalMs <= warningMs) warning++;
    }
    const plural = (n) => (n === 1 ? "" : "s");
    setNavBadge(page, urgent, `${urgent} ${noun}${plural(urgent)} a expirar ou já expirado${plural(urgent)}`);
    setNavBadge(page, warning, `${warning} ${noun}${plural(warning)} com menos de ${latestUserSettings.warningThresholdDays} dias`, "warning");
  }

  // Registos: instâncias em que já passaram as 3 horas do registo, mas só durante
  // um tempo (REGISTRY_BADGE_WINDOW_MS) — depois a bolinha desaparece.
  const now = Date.now();
  const readyRegistrations = Object.values(latestRegistration).filter((reg) => {
    if (!reg) return false;
    const readyAt = reg.at.getTime() + REGISTRATION_COOLDOWN_MS;
    return now >= readyAt && now < readyAt + REGISTRY_BADGE_WINDOW_MS;
  }).length;
  setNavBadge("registos", readyRegistrations, `${readyRegistrations} registo${readyRegistrations === 1 ? "" : "s"} já pode${readyRegistrations === 1 ? "" : "m"} ser feito${readyRegistrations === 1 ? "" : "s"}`);
}

function renderExpiryBanner() {
  const alertDays = latestUserSettings.alertThresholdDays;
  const warningDays = latestUserSettings.warningThresholdDays;
  const warningMs = warningDays * ONE_DAY_MS;
  const alertMs = alertDays * ONE_DAY_MS;

  let expiredCount = 0;
  let soonCount = 0;
  let urgentCount = 0;

  for (const costume of latestCostumes) {
    const remaining = computeRemaining(costume.endAt);
    if (remaining.expired) {
      expiredCount++;
    } else {
      if (remaining.totalMs <= warningMs) soonCount++;
      if (remaining.totalMs <= alertMs) urgentCount++;
    }
  }

  if (urgentCount > 0) {
    urgentBannerEl.hidden = false;
    urgentBannerEl.innerHTML = `🔴 ${urgentCount} ${urgentCount > 1 ? kindText().plural : kindText().singular} com menos de ${alertDays} dia${alertDays > 1 ? "s" : ""} para expirar!`;
  } else {
    urgentBannerEl.hidden = true;
    urgentBannerEl.innerHTML = "";
  }

  if (expiredCount === 0 && soonCount === 0) {
    expiryBannerEl.hidden = true;
    expiryBannerEl.innerHTML = "";
    return;
  }

  const parts = [];
  if (expiredCount > 0) {
    parts.push(`${expiredCount} ${expiredCount > 1 ? kindText().plural : kindText().singular} já expirado${expiredCount > 1 ? "s" : ""}`);
  }
  if (soonCount > 0) {
    parts.push(`${soonCount} ${soonCount > 1 ? kindText().plural : kindText().singular} prestes a expirar (menos de ${warningDays} dias)`);
  }

  expiryBannerEl.hidden = false;
  expiryBannerEl.innerHTML = `⚠ ${parts.join(" · ")}.`;
}

function buildCostumeCard(costume) {
  const remaining = computeRemaining(costume.endAt);
  const isDanger = !remaining.expired && remaining.totalMs <= latestUserSettings.alertThresholdDays * ONE_DAY_MS;
  const isWarning = !remaining.expired && !isDanger && remaining.totalMs <= latestUserSettings.warningThresholdDays * ONE_DAY_MS;

  const card = document.createElement("div");
  card.className =
    "costume-card" + (remaining.expired ? " expired" : isDanger ? " danger" : isWarning ? " warning" : "");
  card.draggable = true;
  card.dataset.costumeId = costume.id;
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-costume-id", costume.id);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => card.classList.add("dragging"), 0);
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    clearAllInsertionMarkers();
  });

  const main = document.createElement("div");
  main.className = "costume-main";
  const titleHtml = IS_PET()
    ? `<span class="pet-emoji">🐾</span><span class="badge pet">Pet</span>`
    : `<img class="type-icon" src="${COSTUME_ICONS[costume.type] || ""}" alt="${COSTUME_TYPES[costume.type] || costume.type}" />
      <span class="badge ${costume.type}">${COSTUME_TYPES[costume.type] || costume.type}</span>`;
  main.innerHTML = `
    <div class="costume-title">${titleHtml}</div>
    ${costume.description ? `<div class="costume-desc">${escapeHtml(costume.description)}</div>` : ""}
  `;

  const time = document.createElement("div");
  time.className = "costume-time";
  const remainingClass = remaining.expired ? "expired" : isDanger ? "danger" : isWarning ? "warning" : "ok";
  time.innerHTML = `
    <span class="remaining ${remainingClass}">${formatRemaining(remaining)}</span>
    <span class="end-date">termina em ${formatEndDate(remaining.endDate)}</span>
    ${IS_PET() && costume.durationMs ? `<span class="end-date">duração: ${formatDuration(costume.durationMs)}</span>` : ""}
  `;

  const actions = document.createElement("div");
  actions.className = "costume-actions";

  const renewBtn = document.createElement("button");
  renewBtn.className = "secondary";
  renewBtn.textContent = "Renovar";
  renewBtn.addEventListener("click", () => (IS_PET() ? renewPetNow(costume) : openRenewModal(costume)));
  actions.appendChild(renewBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn";
  delBtn.textContent = "Apagar";
  delBtn.addEventListener("click", () => {
    if (confirm(`Apagar ${IS_PET() ? "o pet" : "o traje"} "${costume.description || COSTUME_TYPES[costume.type] || "pet"}" de ${costume.character}?`)) {
      deleteCostume(costume.id, currentKind);
    }
  });
  actions.appendChild(delBtn);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "16px";
  right.appendChild(time);
  right.appendChild(actions);

  card.appendChild(main);
  card.appendChild(right);
  return card;
}

// Garante que a personagem fica guardada (uma vez só) para trajes e pets.
async function ensureCharacterSaved(name) {
  const exists = latestCharacters.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!exists) await addCharacter({ ownerUid: currentUser.uid, name });
}

function formatDuration(ms) {
  const totalMinutes = Math.round(ms / 60000);
  return `${Math.floor(totalMinutes / 1440)}d ${Math.floor((totalMinutes % 1440) / 60)}h ${totalMinutes % 60}m`;
}

// Pets renovam sempre para a duração fixa com que foram criados — sem formulário.
async function renewPetNow(pet) {
  if (!pet.durationMs) {
    alert("Este pet não tem duração guardada.");
    return;
  }
  if (!confirm(`Renovar o pet "${pet.description || pet.character}" para ${formatDuration(pet.durationMs)}?`)) return;
  try {
    await renewPet(pet.id, pet.durationMs);
    const totalMinutes = Math.round(pet.durationMs / 60000);
    notifyCostumeRenewed(
      pet,
      { daysLeft: Math.floor(totalMinutes / 1440), hoursLeft: Math.floor((totalMinutes % 1440) / 60), minutesLeft: totalMinutes % 60 },
      latestUserSettings.discordRecipients,
      "pet"
    );
  } catch (err) {
    alert(err.message || "Erro ao renovar o pet.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Costume modal ----------
function selectCostumeType(type) {
  costumeTypeInput.value = type;
  costumeTypePicker.querySelectorAll(".type-option").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.type === type);
  });
}

costumeTypePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".type-option");
  if (!btn) return;
  selectCostumeType(btn.dataset.type);
});

const characterInput = document.getElementById("costume-character");
const characterListEl = document.getElementById("costume-character-list");
let characterNamesForCombo = [];

function populateCharacterOptions() {
  characterNamesForCombo = [
    ...new Set([
      ...latestCharacters.map((c) => c.name),
      ...latestCostumes.map((c) => c.character),
      ...latestSections.map((s) => s.character),
      // Sugere também as personagens do outro sistema (trajes <-> pets).
      ...Object.keys(store).flatMap((kind) => [
        ...store[kind].characters.map((c) => c.name),
        ...store[kind].items.map((c) => c.character),
      ]),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt"));
  characterListEl.hidden = true;
}

function showCharacterOptions({ all = false } = {}) {
  const filter = all ? "" : characterInput.value.trim().toLowerCase();
  if (!all && !filter) {
    characterListEl.hidden = true;
    return;
  }
  const matches = characterNamesForCombo.filter((name) => name.toLowerCase().startsWith(filter));
  characterListEl.innerHTML = "";
  if (matches.length === 0) {
    characterListEl.hidden = true;
    return;
  }
  for (const name of matches) {
    const option = document.createElement("div");
    option.className = "combo-option";
    option.textContent = name;
    option.addEventListener("mousedown", (e) => {
      e.preventDefault();
      characterInput.value = name;
      characterListEl.hidden = true;
    });
    characterListEl.appendChild(option);
  }
  characterListEl.hidden = false;
}

characterInput.addEventListener("input", () => showCharacterOptions());
characterInput.addEventListener("blur", () => {
  characterListEl.hidden = true;
});
document.getElementById("costume-character-toggle").addEventListener("mousedown", (e) => {
  e.preventDefault();
  if (!characterListEl.hidden) {
    characterListEl.hidden = true;
    return;
  }
  characterInput.focus();
  showCharacterOptions({ all: true });
});

addCostumeBtn.addEventListener("click", () => {
  costumeForm.reset();
  costumeFormError.textContent = "";
  populateCharacterOptions();
  selectCostumeType("body");
  const pet = IS_PET();
  costumeModalTitle.textContent = pet ? "Adicionar pet" : "Adicionar traje";
  costumeTypeLabel.hidden = pet;
  costumeTypePicker.hidden = pet;
  costumeDescLabel.textContent = pet ? "Nome / descrição" : "Descrição";
  costumeRemainingFieldset.hidden = !pet;
  costumeTimeLegend.textContent = pet ? "Duração do pet" : "Tempo restante";
  costumeModal.showModal();
});

costumeCancelBtn.addEventListener("click", () => costumeModal.close());

costumeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  costumeFormError.textContent = "";
  const character = document.getElementById("costume-character").value.trim();
  const type = document.getElementById("costume-type").value;
  const description = document.getElementById("costume-description").value.trim();
  const daysLeft = document.getElementById("costume-days").value;
  const hoursLeft = document.getElementById("costume-hours").value;
  const minutesLeft = document.getElementById("costume-minutes").value;

  if (!character) {
    costumeFormError.textContent = "Indica o nome da personagem.";
    return;
  }
  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  if (totalMinutes <= 0) {
    costumeFormError.textContent = IS_PET() ? "A duração tem de ser maior que zero." : "O tempo restante tem de ser maior que zero.";
    return;
  }

  let remainingMs = null;
  if (IS_PET()) {
    remainingMs =
      toDurationMs({
        daysLeft: document.getElementById("costume-rem-days").value,
        hoursLeft: document.getElementById("costume-rem-hours").value,
        minutesLeft: document.getElementById("costume-rem-minutes").value,
      }) || null;
    if (remainingMs && remainingMs > totalMinutes * 60 * 1000) {
      costumeFormError.textContent = "O tempo restante não pode ser maior que a duração.";
      return;
    }
  }

  if (store[currentKind].items.length >= itemLimit()) {
    costumeFormError.textContent = `Atingiste o limite de ${itemLimit()} ${kindText().plural}.`;
    return;
  }
  const isNewCharacter = !knownCharacterNames().some((n) => n.toLowerCase() === character.toLowerCase());
  if (isNewCharacter && knownCharacterNames().length >= userLimits().characters) {
    costumeFormError.textContent = `Atingiste o limite de ${userLimits().characters} personagens.`;
    return;
  }

  try {
    await ensureCharacterSaved(character);
    await addCostume({
      ownerUid: currentUser.uid,
      character,
      type: IS_PET() ? null : type,
      description,
      daysLeft,
      hoursLeft,
      minutesLeft,
      kind: currentKind,
      remainingMs,
    });
    costumeModal.close();
  } catch (err) {
    costumeFormError.textContent = err.message || "Erro ao guardar.";
  }
});

// ---------- Renew modal ----------
function openRenewModal(costume) {
  renewingCostume = costume;
  renewForm.reset();
  renewFormError.textContent = "";
  renewCostumeIcon.src = COSTUME_ICONS[costume.type] || "";
  renewCostumeIcon.alt = COSTUME_TYPES[costume.type] || costume.type;
  renewCostumeName.textContent = costume.character;
  renewCostumeType.innerHTML = `<span class="badge ${costume.type}">${COSTUME_TYPES[costume.type] || costume.type}</span>`;
  renewCostumeDesc.textContent = costume.description || "";
  renewModal.showModal();
}

renewCancelBtn.addEventListener("click", () => renewModal.close());

renewForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  renewFormError.textContent = "";
  const daysLeft = document.getElementById("renew-days").value;
  const hoursLeft = document.getElementById("renew-hours").value;
  const minutesLeft = document.getElementById("renew-minutes").value;

  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  if (totalMinutes <= 0) {
    renewFormError.textContent = "O tempo restante tem de ser maior que zero.";
    return;
  }

  try {
    await renewCostume(renewingCostume.id, { daysLeft, hoursLeft, minutesLeft });
    notifyCostumeRenewed(renewingCostume, { daysLeft, hoursLeft, minutesLeft }, latestUserSettings.discordRecipients);
    renewModal.close();
  } catch (err) {
    renewFormError.textContent = err.message || "Erro ao renovar o traje.";
  }
});

// ---------- Section modal ----------
function openSectionModal(character) {
  creatingSectionForCharacter = character;
  sectionForm.reset();
  sectionFormError.textContent = "";
  sectionCharacterLabel.textContent = `Personagem: ${character}`;
  sectionModal.showModal();
}

sectionCancelBtn.addEventListener("click", () => sectionModal.close());

sectionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  sectionFormError.textContent = "";
  const name = document.getElementById("section-name").value.trim();
  if (!name) {
    sectionFormError.textContent = "Indica um nome para a secção.";
    return;
  }
  try {
    await addSection({ ownerUid: currentUser.uid, character: creatingSectionForCharacter, name, kind: currentKind });
    sectionModal.close();
  } catch (err) {
    sectionFormError.textContent = err.message || "Erro ao criar a secção.";
  }
});

// ---------- Character modal ----------
addCharacterBtn.addEventListener("click", () => {
  characterForm.reset();
  characterFormError.textContent = "";
  characterModal.showModal();
});

characterCancelBtn.addEventListener("click", () => characterModal.close());

characterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  characterFormError.textContent = "";
  const name = document.getElementById("character-name").value.trim();
  if (!name) {
    characterFormError.textContent = "Indica um nome para a personagem.";
    return;
  }
  const exists = [
    ...Object.values(store).flatMap((st) => st.items.map((c) => c.character)),
    ...latestCharacters.map((c) => c.name),
  ].some(
    (existing) => existing.toLowerCase() === name.toLowerCase()
  );
  if (exists) {
    characterFormError.textContent = "Já existe uma personagem com esse nome.";
    return;
  }
  if (knownCharacterNames().length >= userLimits().characters) {
    characterFormError.textContent = `Atingiste o limite de ${userLimits().characters} personagens.`;
    return;
  }
  try {
    await addCharacter({ ownerUid: currentUser.uid, name, kind: currentKind });
    characterModal.close();
  } catch (err) {
    characterFormError.textContent = err.message || "Erro ao criar a personagem.";
  }
});

// ---------- Admin: render users ----------
function renderUsers() {
  if (latestUsers.length === 0) {
    usersListEl.innerHTML = '<p class="empty-state">Sem utilizadores.</p>';
    return;
  }

  const countsByUid = latestAllCostumes.reduce((acc, c) => {
    acc[c.ownerUid] = (acc[c.ownerUid] || 0) + 1;
    return acc;
  }, {});
  const petCountsByUid = latestAllPets.reduce((acc, p) => {
    acc[p.ownerUid] = (acc[p.ownerUid] || 0) + 1;
    return acc;
  }, {});

  // Personagens por conta: as guardadas + as que só existem em trajes/pets, sem repetir.
  const characterNamesByUid = {};
  const addCharacterName = (uid, name) => {
    if (!uid || !name) return;
    (characterNamesByUid[uid] ||= new Set()).add(name.toLowerCase());
  };
  latestAllCharacters.forEach((c) => addCharacterName(c.ownerUid, c.name));
  latestAllCostumes.forEach((c) => addCharacterName(c.ownerUid, c.character));
  latestAllPets.forEach((p) => addCharacterName(p.ownerUid, p.character));

  const rows = latestUsers
    .slice()
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""))
    .map((u) => {
      const count = countsByUid[u.uid] || 0;
      const petCount = petCountsByUid[u.uid] || 0;
      const characterCount = characterNamesByUid[u.uid]?.size || 0;
      const isSelf = currentUser && currentUser.uid === u.uid;
      const statusTag = u.disabled
        ? '<span class="tag disabled">Desativado</span>'
        : u.role === "admin"
        ? '<span class="tag">Admin</span>'
        : u.privileged
        ? '<span class="tag">Privilegiada</span>'
        : "";
      const privilegeBtn =
        u.disabled || u.role === "admin"
          ? ""
          : `<button class="secondary small" data-uid="${u.uid}" data-action="privilege" data-value="${u.privileged ? "off" : "on"}">${u.privileged ? "Remover privilégio" : "Tornar privilegiada"}</button>`;
      const deleteBtn =
        u.disabled || isSelf
          ? ""
          : `<button class="icon-btn" data-uid="${u.uid}" data-action="disable">Apagar</button>`;
      return `
        <tr>
          <td>${escapeHtml(u.displayName || u.email)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${characterCount}</td>
          <td>${count}</td>
          <td>${petCount}</td>
          <td>${statusTag}</td>
          <td>${privilegeBtn} ${deleteBtn}</td>
        </tr>
      `;
    })
    .join("");

  usersListEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Nome</th><th>Email</th><th>Personagens</th><th>Trajes</th><th>Pets</th><th>Estado</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  usersListEl.querySelectorAll('[data-action="privilege"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await setPrivileged(btn.dataset.uid, btn.dataset.value === "on");
      } catch (err) {
        alert(err.message || "Erro ao alterar a conta.");
        btn.disabled = false;
      }
    });
  });

  usersListEl.querySelectorAll('[data-action="disable"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      if (confirm("Apagar este utilizador? Os trajes e pets dele serão removidos e deixa de conseguir entrar.")) {
        btn.disabled = true;
        try {
          await disableUser(uid);
        } catch (err) {
          alert(err.message || "Erro ao apagar utilizador.");
          btn.disabled = false;
        }
      }
    });
  });
}

// ---------- User modal ----------
addUserBtn.addEventListener("click", () => {
  userForm.reset();
  userFormError.textContent = "";
  userModal.showModal();
});

userCancelBtn.addEventListener("click", () => userModal.close());

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  userFormError.textContent = "";
  const displayName = document.getElementById("user-displayname").value;
  const email = document.getElementById("user-email-input").value.trim();
  const password = document.getElementById("user-password").value;
  const submitBtn = userForm.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  try {
    await createUser({ email, password, displayName, privileged: document.getElementById("user-privileged").checked });
    userModal.close();
  } catch (err) {
    userFormError.textContent = friendlyAuthError(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Fechar as janelas ao clicar fora ----------
// Vale para todas as janelas (<dialog>): um clique no fundo escurecido fecha-as.
// Só fecha se o clique COMEÇOU e acabou fora (para não fechar ao selecionar texto
// dentro da janela e largar o rato fora).
for (const dialog of document.querySelectorAll("dialog")) {
  let pressedOutside = false;
  const isOutside = (e) => {
    const rect = dialog.getBoundingClientRect();
    return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  };
  dialog.addEventListener("mousedown", (e) => {
    pressedOutside = e.target === dialog && isOutside(e);
  });
  dialog.addEventListener("click", (e) => {
    if (pressedOutside && e.target === dialog && isOutside(e)) dialog.close();
    pressedOutside = false;
  });
}

// Avisa quando há uma versão nova da app.
startUpdateCheck();
