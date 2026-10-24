import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteField,
  onSnapshot,
  query,
  where,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, snapshotError } from "./firebase-init.js";
import { DEFAULT_PRICE, MAX_CHESTS_PER_HYDRA, MAX_HYDRAS_PER_DAY, normalizeTimers, totalsOfOldDays } from "./hydras-rules.js";

// Registo de Hidras (por utilizador). Três coleções do Firestore:
//   hydraDays      { ownerUid, date: "2026-10-23", hydras: [3, 4, ...], price?: 45 }   id: {uid}__{date}
//   hydraMonths    { ownerUid, month: "2026-08", cofres, hidras, wons }                  id: {uid}__{month}
//   hydraSettings  { defaultPrice }                                                       id: {uid}
// Os dias com mais de um mês de idade são "compactados": viram um total do mês (hydraMonths).

const dayRef = (uid, date) => doc(db, "hydraDays", `${uid}__${date}`);

function clampChests(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) throw new Error("Número de cofres inválido.");
  return Math.min(MAX_CHESTS_PER_HYDRA, n);
}

// Junta uma hidra (com `chests` cofres) à lista do dia.
export function addHydra(uid, date, chests) {
  const value = clampChests(chests);
  const ref = dayRef(uid, date);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const hydras = snap.exists() && Array.isArray(snap.data().hydras) ? [...snap.data().hydras] : [];
    if (hydras.length >= MAX_HYDRAS_PER_DAY) throw new Error(`Um dia só pode ter ${MAX_HYDRAS_PER_DAY} hidras.`);
    hydras.push(value);
    tx.set(ref, { ownerUid: uid, date, hydras }, { merge: true });
  });
}

// Altera os cofres de uma hidra do dia (0 é válido); com null (campo vazio) a hidra é removida.
export function setHydra(uid, date, index, chests) {
  const value = chests === null ? null : clampChests(chests);
  const ref = dayRef(uid, date);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const hydras = snap.exists() && Array.isArray(snap.data().hydras) ? [...snap.data().hydras] : [];
    if (index < 0 || index >= hydras.length) return;
    if (value === null) hydras.splice(index, 1);
    else hydras[index] = value;
    tx.set(ref, { ownerUid: uid, date, hydras }, { merge: true });
  });
}

// Estado do cronómetro "Fazer Hidra" (partilhado entre os dispositivos do mesmo utilizador).
// A lista é alterada numa transação (a função recebe a lista guardada e devolve a nova), para dois
// dispositivos não se pisarem.
export function mutateHydraTimers(uid, fn) {
  const ref = doc(db, "hydraTimers", uid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const timers = fn(normalizeTimers(snap.exists() ? snap.data() : null));
    tx.set(ref, { timers, updatedAt: Date.now() });
  });
}

export function subscribeToHydraTimer(uid, onChange) {
  return onSnapshot(
    doc(db, "hydraTimers", uid),
    (snap) => onChange(snap.exists() ? snap.data() : null),
    snapshotError("hydraTimers")
  );
}

// Preço de um cofre nesse dia; null apaga-o (o dia volta a usar o preço padrão).
export function setDayPrice(uid, date, price) {
  return setDoc(
    dayRef(uid, date),
    { ownerUid: uid, date, price: price === null ? deleteField() : Math.max(0, Number(price) || 0) },
    { merge: true }
  );
}

// Preço padrão de um mês (só vale para esse mês).
export function setMonthDefaultPrice(uid, month, price) {
  return setDoc(
    doc(db, "hydraSettings", uid),
    { monthlyDefaults: { [month]: Math.max(0, Number(price) || 0) } },
    { merge: true }
  );
}

export function subscribeToHydraDays(uid, onChange) {
  const q = query(collection(db, "hydraDays"), where("ownerUid", "==", uid));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), snapshotError("hydraDays"));
}

export function subscribeToHydraMonths(uid, onChange) {
  const q = query(collection(db, "hydraMonths"), where("ownerUid", "==", uid));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), snapshotError("hydraMonths"));
}

export function subscribeToHydraSettings(uid, onChange) {
  return onSnapshot(
    doc(db, "hydraSettings", uid),
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      onChange({
        monthlyDefaults: data.monthlyDefaults && typeof data.monthlyDefaults === "object" ? data.monthlyDefaults : {},
        // Valor antigo (um preço padrão único), usado só se um mês ainda não tiver o seu.
        base: typeof data.defaultPrice === "number" ? data.defaultPrice : DEFAULT_PRICE,
      });
    },
    snapshotError("hydraSettings")
  );
}

// Importa dias (substitui as hidras de cada data; o preço do dia, se existir, mantém-se).
export async function importDays(uid, days) {
  for (let i = 0; i < days.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of days.slice(i, i + 400)) {
      batch.set(dayRef(uid, d.date), { ownerUid: uid, date: d.date, hydras: d.hydras }, { merge: true });
    }
    await batch.commit();
  }
}

// Apaga todos os dias e totais de hidras do utilizador (os preços padrão dos meses ficam).
export async function deleteAllHydraData(uid) {
  for (const name of ["hydraDays", "hydraMonths"]) {
    const snap = await getDocs(query(collection(db, name), where("ownerUid", "==", uid)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

// Dias anteriores ao mês passado: guarda os totais de cada mês e apaga o detalhe dos dias.
// Corre uma vez ao abrir; é seguro repetir (soma aos totais que já existam, e só apaga o que somou).
// `defaultPrice` é uma função (mês) => preço padrão desse mês.
export async function compactOldDays(uid, days, defaultPrice, cutoff) {
  const old = days.filter((d) => d.date < cutoff);
  if (old.length === 0) return;
  const totals = totalsOfOldDays(old, defaultPrice, cutoff);

  const batch = writeBatch(db);
  for (const [month, t] of Object.entries(totals)) {
    if (t.hidras === 0 && t.cofres === 0) continue;
    const ref = doc(db, "hydraMonths", `${uid}__${month}`);
    const existing = await getDoc(ref).catch(() => null);
    const prev = existing && existing.exists() ? existing.data() : { cofres: 0, hidras: 0, wons: 0 };
    batch.set(ref, {
      ownerUid: uid,
      month,
      cofres: (prev.cofres || 0) + t.cofres,
      hidras: (prev.hidras || 0) + t.hidras,
      wons: Math.round(((prev.wons || 0) + t.wons) * 100) / 100,
    });
  }
  for (const d of old) batch.delete(dayRef(uid, d.date));
  await batch.commit();
}
