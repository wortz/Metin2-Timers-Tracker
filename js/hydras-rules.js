// Regras do registo de Hidras (sem Firestore, para se poderem testar à parte).
//
// Cada dia tem uma lista de hidras; cada hidra é o número de cofres que deu. Por dia:
//   Cofres = soma da lista · Hidras = quantas há · Média = Cofres ÷ Hidras
//   Wons   = Cofres × Preço ÷ 100  (o Preço é o de um cofre nesse dia)

export const MAX_HYDRAS_PER_DAY = 35; // a folha tem 35 colunas por dia
export const MAX_CHESTS_PER_HYDRA = 5; // cada hidra dá de 0 a 5 cofres
export const QUICK_CHESTS = [0, 1, 2, 3, 4, 5];
export const DEFAULT_PRICE = 40; // preço padrão inicial (o utilizador pode mudá-lo)

const pad = (n) => String(n).padStart(2, "0");

// "2026-10-23" no fuso do browser (o dia que o utilizador está a viver).
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, delta) {
  const date = parseKey(key);
  date.setDate(date.getDate() + delta);
  return dateKey(date);
}

export const monthOf = (key) => key.slice(0, 7); // "2026-10"

export function previousMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 2, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// Só se editam as hidras (e o preço) de hoje e de ontem.
export function isEditableDay(key, now = new Date()) {
  const today = dateKey(now);
  return key === today || key === addDays(today, -1);
}

// O preço do dia edita-se um dia a mais: hoje, ontem e anteontem.
export function isPriceEditableDay(key, now = new Date()) {
  const today = dateKey(now);
  return isEditableDay(key, now) || key === addDays(today, -2);
}

// Primeiro dia do mês anterior: os dias antes disto já só ficam como totais do mês.
export function cutoffKey(now = new Date()) {
  const month = monthOf(dateKey(now));
  return `${previousMonth(month)}-01`;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Preço padrão DE UM MÊS: o que foi definido para esse mês; se ainda não há, o do mês mais recente
// anterior que tenha; e se não houver nenhum, o `base`. Cada mês tem o seu: mudar o de um mês
// não altera os Wons dos outros.
export function defaultPriceFor(month, monthlyDefaults = {}, base = DEFAULT_PRICE) {
  if (typeof monthlyDefaults[month] === "number") return monthlyDefaults[month];
  const earlier = Object.keys(monthlyDefaults)
    .filter((m) => m < month && typeof monthlyDefaults[m] === "number")
    .sort();
  return earlier.length > 0 ? monthlyDefaults[earlier[earlier.length - 1]] : base;
}

// Preço efetivo do dia: o que foi escrito, ou o padrão (e "priceSet" diz se foi escrito).
export function priceOf(day, defaultPrice) {
  const own = day && typeof day.price === "number" ? day.price : null;
  return { price: own ?? defaultPrice, priceSet: own !== null };
}

export function dayTotals(day, defaultPrice) {
  const hydras = Array.isArray(day?.hydras) ? day.hydras : [];
  const cofres = hydras.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const count = hydras.length;
  const { price, priceSet } = priceOf(day, defaultPrice);
  return {
    cofres,
    hidras: count,
    media: count > 0 ? cofres / count : 0,
    price,
    priceSet,
    wons: round2((cofres * price) / 100),
  };
}

// Soma os dias dados (ex.: os de um mês).
export function sumDays(days, defaultPrice) {
  const total = { cofres: 0, hidras: 0, wons: 0 };
  for (const day of days) {
    const t = dayTotals(day, defaultPrice);
    total.cofres += t.cofres;
    total.hidras += t.hidras;
    total.wons += t.wons;
  }
  total.wons = round2(total.wons);
  total.media = total.hidras > 0 ? total.cofres / total.hidras : 0;
  return total;
}

// Dias antes do "cutoff" → totais por mês: { "2026-08": { cofres, hidras, wons } }.
// Estes meses deixam de ter o detalhe dos dias (o ecrã passa a mostrar só os totais).
// `defaultPrice` pode ser um número ou uma função (mês) => preço padrão desse mês.
export function totalsOfOldDays(days, defaultPrice, cutoff) {
  const byMonth = {};
  for (const day of days) {
    if (day.date >= cutoff) continue;
    const month = monthOf(day.date);
    const t = dayTotals(day, typeof defaultPrice === "function" ? defaultPrice(month) : defaultPrice);
    const acc = (byMonth[month] ||= { cofres: 0, hidras: 0, wons: 0 });
    acc.cofres += t.cofres;
    acc.hidras += t.hidras;
    acc.wons = round2(acc.wons + t.wons);
  }
  return byMonth;
}

// Texto colado da folha: uma linha por dia, "23/10/2026 2 3 4 2" (data e depois os cofres de cada
// hidra, separados por espaços ou tabs). Aceita também "2026-10-23". Devolve { days, errors }.
export function parseImport(text) {
  const days = [];
  const errors = [];
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [dateText, ...rest] = line.split(/[\s;,]+/);
    let key = null;
    let m = dateText.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) key = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) key = dateText;
    const hydras = rest.map(Number);
    if (!key || Number.isNaN(parseKey(key).getTime()) || dateKey(parseKey(key)) !== key) {
      errors.push(`Linha ${i + 1}: data inválida.`);
    } else if (hydras.some((n) => !Number.isInteger(n) || n < 0 || n > MAX_CHESTS_PER_HYDRA)) {
      errors.push(`Linha ${i + 1}: cada hidra tem de ter entre 0 e ${MAX_CHESTS_PER_HYDRA} cofres.`);
    } else if (hydras.length > MAX_HYDRAS_PER_DAY) {
      errors.push(`Linha ${i + 1}: no máximo ${MAX_HYDRAS_PER_DAY} hidras por dia.`);
    } else {
      days.push({ date: key, hydras });
    }
  }
  return { days, errors };
}

export const formatNumber = (n, digits = 2) =>
  Number(n || 0).toLocaleString("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// "2026-10-23" -> "23/10/2026"
export function formatDate(key) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}
