// Regras diárias da Guild (sem Firestore, para se poderem usar em qualquer sítio):
// cada personagem só pode fazer 3 doações (de qualquer tamanho, em qualquer combinação)
// e 1 recompensa de participação por dia. O dia reinicia às 04:00 em Praga (CZ), que são
// as 03:00 em Lisboa (PT) — as duas mudam de horário de verão ao mesmo tempo.
export const DAILY_LIMITS = {
  donations: 3,
  participation: 1,
};

// "Voto padrão": o que se vota normalmente num dia. Preenche o que falta a cada personagem:
// as doações em falta (até 3) a +3 cada e, se ainda não participou, a participação de +13.
export const DEFAULT_VOTE = {
  donationAmount: 3,
  participationAmount: 13,
};

const RESET_HOUR_PRAGUE = 4;

// Identifica o "dia de doações" atual (por exemplo "2026-10-21"). Muda às 04:00 de Praga.
export function periodKey(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  // Hora local de Praga tratada como UTC; recuar 4h faz o "dia" começar às 04:00.
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(local - RESET_HOUR_PRAGUE * 3600 * 1000).toISOString().slice(0, 10);
}

// O que a personagem já fez neste "dia de doações" (se o dia guardado for outro, é tudo zero).
export function usageOf(char, key = periodKey()) {
  const same = char.usageDay === key;
  return {
    donations: same ? char.donations || 0 : 0,
    participated: same ? !!char.participated : false,
  };
}

// ---------- Guild runs (semanais) ----------
// Cada nível de guild run só pode ser feito 1 vez por semana, por personagem lv70+.
export const GUILD_RUNS = [
  { level: 21, medals: 150 },
  { level: 24, medals: 200 },
  { level: 27, medals: 250 },
  { level: 30, medals: 300 },
  { level: 35, medals: 350 },
];

export const DEFAULT_GUILD_LEVEL = 21;
export const MIN_GUILD_LEVEL = 1;
export const MAX_GUILD_LEVEL = 40;

// Identifica a "semana de guild runs" atual: o dia (da segunda-feira) em que começou. A semana
// muda na segunda-feira às 04:00 de Praga (03:00 de Lisboa), junto com o reinício diário.
export function weekKey(now = new Date()) {
  const day = new Date(`${periodKey(now)}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day.toISOString().slice(0, 10);
}

// Níveis de guild run que a personagem já fez nesta semana (se a semana guardada for outra, nenhum).
export function runsDoneOf(char, key = weekKey()) {
  return char.runsWeek === key && Array.isArray(char.runs) ? char.runs : [];
}

// ---------- Scrolls de elementos e Guild Land: gastam medalhas ----------
// Subir o contador de um item em 1 custa `cost` medalhas à personagem. Baixar o contador NÃO as devolve.
const ICONS = "assets/icons/guild";

export const ELEMENT_ITEMS = [
  { name: "Gelo", cost: 300, icon: `${ICONS}/gelo.png` },
  { name: "Trevas", cost: 300, icon: `${ICONS}/trevas.png` },
  { name: "Raios", cost: 300, icon: `${ICONS}/raios.png` },
  { name: "Fogo", cost: 300, icon: `${ICONS}/fogo.png` },
  { name: "Vento", cost: 300, icon: `${ICONS}/vento.png` },
  { name: "Terra", cost: 300, icon: `${ICONS}/terra.png` },
  { name: "Remover elemento", cost: 400, icon: `${ICONS}/remover.png` },
  { name: "Mudar elemento", cost: 1000, icon: `${ICONS}/mudar.png` },
];

export const LAND_ITEMS = [
  { name: "Exp", cost: 300, icon: `${ICONS}/exp.png` },
  { name: "Cofre", cost: 300, icon: `${ICONS}/cofre.png` },
  { name: "Invocar", cost: 100, icon: `${ICONS}/invocar.png` },
];

export const ITEM_GROUPS = { scrolls: ELEMENT_ITEMS, land: LAND_ITEMS };
export const MAX_ITEM_COUNT = 999;

// Quantidade que a personagem tem de um item ("scrolls" ou "land", posição 0..n).
export function itemCount(char, group, index) {
  const list = char[group];
  return Array.isArray(list) ? list[index] || 0 : 0;
}
