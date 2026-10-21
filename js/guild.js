import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, snapshotError } from "./firebase-init.js";
import {
  DAILY_LIMITS,
  DEFAULT_GUILD_LEVEL,
  GUILD_RUNS,
  ITEM_GROUPS,
  MAX_ITEM_COUNT,
  MAX_GUILD_LEVEL,
  MIN_GUILD_LEVEL,
  periodKey,
  weekKey,
} from "./guild-rules.js";

// Doações da Guild: cada utilizador tem até 2 guilds; cada guild tem contas e cada conta
// tem personagens, com as suas Medalhas de Bravura. Três coleções do Firestore:
//   guilds            { ownerUid, name }
//   guildAccounts     { ownerUid, guildId, name }
//   guildCharacters   { ownerUid, guildId, accountId, name, medals }

// Botões de "+medalhas" (iguais aos do m2-helper.com).
export const MEDAL_BUTTONS = {
  donations: [3, 10, 30],
  participation: [1, 2, 3, 5, 7, 9, 11, 13],
};

const MAX_MEDALS = 99999999;

export function createGuild({ ownerUid, name }) {
  return addDoc(collection(db, "guilds"), {
    ownerUid,
    name: name.trim(),
    level: DEFAULT_GUILD_LEVEL,
    createdAt: serverTimestamp(),
  });
}

export function addGuildAccount({ ownerUid, guildId, name }) {
  return addDoc(collection(db, "guildAccounts"), { ownerUid, guildId, name: name.trim(), createdAt: serverTimestamp() });
}

export const MAX_DESCRIPTION = 60;

export function addGuildCharacter({ ownerUid, guildId, accountId, name, description = "" }) {
  return addDoc(collection(db, "guildCharacters"), {
    ownerUid,
    guildId,
    accountId,
    name: name.trim(),
    description: description.trim().slice(0, MAX_DESCRIPTION),
    medals: 0,
    createdAt: serverTimestamp(),
  });
}

// Descrição curta e opcional da personagem (por exemplo, outro propósito que ela tenha).
export function setGuildCharacterDescription(characterId, description) {
  return updateDoc(doc(db, "guildCharacters", characterId), { description: description.trim().slice(0, MAX_DESCRIPTION) });
}

export function deleteGuildCharacter(characterId) {
  return deleteDoc(doc(db, "guildCharacters", characterId));
}

// Apaga a conta e as personagens dela.
export async function deleteGuildAccount(ownerUid, accountId) {
  const batch = writeBatch(db);
  const chars = await getDocs(
    query(collection(db, "guildCharacters"), where("ownerUid", "==", ownerUid), where("accountId", "==", accountId))
  );
  chars.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "guildAccounts", accountId));
  return batch.commit();
}

// Apaga a guild, as contas e as personagens.
export async function deleteGuild(ownerUid, guildId) {
  const batch = writeBatch(db);
  for (const name of ["guildCharacters", "guildAccounts"]) {
    const snap = await getDocs(query(collection(db, name), where("ownerUid", "==", ownerUid), where("guildId", "==", guildId)));
    snap.forEach((d) => batch.delete(d.ref));
  }
  batch.delete(doc(db, "guilds", guildId));
  return batch.commit();
}

// Soma medalhas dentro de uma transação (atómica: vários cliques seguidos ou dois dispositivos
// nunca se perdem nem passam do limite). kind:
//   "donation"      -> conta como 1 das 3 doações do dia
//   "participation" -> conta como a 1 participação do dia
export function addMedals(characterId, amount, kind) {
  const ref = doc(db, "guildCharacters", characterId);
  const key = periodKey();
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Personagem não encontrada.");
    const data = snap.data();
    const sameDay = data.usageDay === key;
    let donations = sameDay ? data.donations || 0 : 0;
    let participated = sameDay ? !!data.participated : false;

    if (kind === "donation") {
      if (donations >= DAILY_LIMITS.donations) throw new Error(`Esta personagem já fez as ${DAILY_LIMITS.donations} doações de hoje.`);
      donations++;
    } else if (kind === "participation") {
      if (participated) throw new Error("Esta personagem já recebeu a participação de hoje.");
      participated = true;
    }
    const medals = Math.min(MAX_MEDALS, (data.medals || 0) + amount);
    tx.update(ref, { medals, usageDay: key, donations, participated });
  });
}

// Soma o mesmo voto a várias personagens de uma vez, numa só transação. Cada personagem é
// verificada outra vez lá dentro: as que já atingiram o limite do dia são saltadas.
// Devolve quantas receberam o voto.
export function addMedalsBulk(characterIds, amount, kind) {
  const refs = characterIds.map((id) => doc(db, "guildCharacters", id));
  const key = periodKey();
  return runTransaction(db, async (tx) => {
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    let applied = 0;
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const sameDay = data.usageDay === key;
      let donations = sameDay ? data.donations || 0 : 0;
      let participated = sameDay ? !!data.participated : false;
      if (kind === "donation") {
        if (donations >= DAILY_LIMITS.donations) return;
        donations++;
      } else {
        if (participated) return;
        participated = true;
      }
      tx.update(refs[i], {
        medals: Math.min(MAX_MEDALS, (data.medals || 0) + amount),
        usageDay: key,
        donations,
        participated,
      });
      applied++;
    });
    return applied;
  });
}

// Define quantos scrolls / itens de Guild Land a personagem tem. SUBIR gasta medalhas (custo por
// unidade, ver ELEMENT_ITEMS / LAND_ITEMS); BAIXAR só corrige o contador e NÃO devolve medalhas.
// Se faltarem medalhas para subir, recusa com um erro de código "insufficient-medals" — a não ser
// que se passe { force: true } (a interface pergunta ao utilizador): então o contador sobe sem gastar
// medalhas (por exemplo, um pergaminho que não veio de medalhas ou que já se tinha).
// Tudo numa transação, para as contas nunca falharem.
export function setItemCount(characterId, group, index, value, { force = false } = {}) {
  const items = ITEM_GROUPS[group];
  const item = items?.[index];
  if (!item) return Promise.reject(new Error("Item inválido."));
  const ref = doc(db, "guildCharacters", characterId);
  const next = Math.min(MAX_ITEM_COUNT, Math.max(0, Math.floor(Number(value) || 0)));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Personagem não encontrada.");
    const data = snap.data();
    const counts = Array.from({ length: items.length }, (_, i) => (Array.isArray(data[group]) ? data[group][i] || 0 : 0));
    const delta = next - counts[index];
    if (delta === 0) return;
    const medals = data.medals || 0;
    let price = delta > 0 ? item.cost * delta : 0; // só subir custa; baixar não devolve nada
    if (price > medals) {
      if (!force) {
        const error = new Error(`Medalhas insuficientes: ${item.name} custa ${item.cost} e a personagem só tem ${medals}.`);
        error.code = "insufficient-medals";
        throw error;
      }
      price = 0; // confirmado pelo utilizador: sobe o contador sem mexer nas medalhas
    }
    counts[index] = next;
    tx.update(ref, { [group]: counts, medals: medals - price });
  });
}

// Nível da guild (define que guild runs já estão desbloqueadas).
export function setGuildLevel(guildId, level) {
  const value = Math.min(MAX_GUILD_LEVEL, Math.max(MIN_GUILD_LEVEL, Math.floor(Number(level) || DEFAULT_GUILD_LEVEL)));
  return updateDoc(doc(db, "guilds", guildId), { level: value });
}

// Marca se a personagem está no nível 70 ou mais (só essas fazem guild runs).
export function setCharacterLv70(characterId, value) {
  return updateDoc(doc(db, "guildCharacters", characterId), { lv70: !!value });
}

// Guild run: cada nível só pode ser feito 1 vez por semana por personagem (transação atómica).
export function addGuildRun(characterId, level) {
  const run = GUILD_RUNS.find((r) => r.level === level);
  if (!run) return Promise.reject(new Error("Guild run inválida."));
  const ref = doc(db, "guildCharacters", characterId);
  const week = weekKey();
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Personagem não encontrada.");
    const data = snap.data();
    if (!data.lv70) throw new Error("Só personagens lv70+ fazem guild runs.");
    const done = data.runsWeek === week && Array.isArray(data.runs) ? data.runs : [];
    if (done.includes(level)) throw new Error(`Esta personagem já fez a guild run lv${level} esta semana.`);
    tx.update(ref, {
      medals: Math.min(MAX_MEDALS, (data.medals || 0) + run.medals),
      runsWeek: week,
      runs: [...done, level],
    });
  });
}

// Remove uma guild run da semana: a personagem perde as medalhas dessa run (sem ir abaixo de 0)
// e o nível volta a poder ser feito.
export function undoGuildRun(characterId, level) {
  const ref = doc(db, "guildCharacters", characterId);
  const week = weekKey();
  const run = GUILD_RUNS.find((r) => r.level === level);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.runsWeek !== week || !Array.isArray(data.runs) || !data.runs.includes(level)) return;
    tx.update(ref, {
      runs: data.runs.filter((l) => l !== level),
      medals: Math.max(0, (data.medals || 0) - (run ? run.medals : 0)),
    });
  });
}

// Anula 1 no contador do dia (para corrigir um clique enganado). Não mexe nas medalhas:
// se for preciso, corrige-se o número à mão.
export function undoUsage(characterId, kind) {
  const ref = doc(db, "guildCharacters", characterId);
  const key = periodKey();
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.usageDay !== key) return;
    if (kind === "donation") tx.update(ref, { donations: Math.max(0, (data.donations || 0) - 1) });
    else tx.update(ref, { participated: false });
  });
}

// Valor escrito à mão: número inteiro, entre 0 e um máximo razoável.
export function setMedals(characterId, value) {
  const medals = Math.min(MAX_MEDALS, Math.max(0, Math.floor(Number(value) || 0)));
  return updateDoc(doc(db, "guildCharacters", characterId), { medals });
}

function subscribeToOwn(collectionName, ownerUid, onChange) {
  const q = query(collection(db, collectionName), where("ownerUid", "==", ownerUid));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    snapshotError(collectionName)
  );
}

export const subscribeToOwnGuilds = (uid, cb) => subscribeToOwn("guilds", uid, cb);
export const subscribeToOwnGuildAccounts = (uid, cb) => subscribeToOwn("guildAccounts", uid, cb);
export const subscribeToOwnGuildCharacters = (uid, cb) => subscribeToOwn("guildCharacters", uid, cb);
