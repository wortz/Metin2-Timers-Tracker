import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, snapshotError } from "./firebase-init.js";
import { createUserWithoutSignOut } from "./firebase-init.js";

// Cria um novo utilizador (só chamável pelo admin autenticado; as Firestore
// rules impedem a criação do documento users/{uid} por quem não for admin).
export async function createUser({ email, password, displayName, privileged = false }) {
  const uid = await createUserWithoutSignOut(email, password);
  await setDoc(doc(db, "users", uid), {
    email,
    displayName: displayName?.trim() || email,
    role: "user",
    disabled: false,
    privileged: !!privileged,
    createdAt: serverTimestamp(),
  });
  return uid;
}

// Marca/desmarca uma conta como privilegiada (limites maiores).
export function setPrivileged(uid, privileged) {
  return updateDoc(doc(db, "users", uid), { privileged: !!privileged });
}

// "Apagar" utilizador = desativar a conta (impede novo login) + apagar os seus trajes e pets.
export async function disableUser(uid) {
  const batch = writeBatch(db);
  for (const name of ["costumes", "pets", "bioTimers", "guilds", "guildAccounts", "guildCharacters", "hydraDays", "hydraMonths"]) {
    const snap = await getDocs(query(collection(db, name), where("ownerUid", "==", uid)));
    snap.forEach((docSnap) => batch.delete(docSnap.ref));
  }
  batch.update(doc(db, "users", uid), { disabled: true });
  await batch.commit();
}

export function subscribeToUsers(onChange) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    onChange(users);
  }, snapshotError("users"));
}
