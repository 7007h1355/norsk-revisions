const BASE = import.meta.env.BASE_URL;

export async function loadIndex() {
  const r = await fetch(`${BASE}fiches/index.json`);
  if (!r.ok) throw new Error(`index.json ${r.status}`);
  return r.json();
}

export async function loadFiche(slug) {
  const r = await fetch(`${BASE}fiches/${slug}.md`);
  if (!r.ok) throw new Error(`${slug}.md ${r.status}`);
  return r.text();
}

export async function loadFlashcards() {
  const r = await fetch(`${BASE}fiches/flashcards.json`);
  if (!r.ok) throw new Error(`flashcards.json ${r.status}`);
  return r.json();
}

// SM-2 light: store per-card review state in localStorage.
const STORE_KEY = "norsk.srs.v1";

export function loadSrs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
  catch { return {}; }
}
export function saveSrs(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
export function exportSrs() { return JSON.stringify(loadSrs(), null, 2); }
export function importSrs(json) {
  const data = JSON.parse(json);
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("Format invalide");
  saveSrs(data);
}

const MAX_NEW_PER_SESSION = 20;

export function countSessionCards(cards, srs) {
  const now = Date.now();
  const all = cards.map(c => ({ state: srs[cardId(c)] || {} }));
  const due = all.filter(x => x.state.due && x.state.due <= now && x.state.reps !== undefined).length;
  const newCount = Math.min(all.filter(x => !x.state.due && x.state.reps === undefined).length, MAX_NEW_PER_SESSION);
  return due + newCount;
}

export function getStreak() {
  try {
    const s = JSON.parse(localStorage.getItem("norsk.streak") || "{}");
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (s.date === today || s.date === yesterday) return s.count || 0;
    return 0;
  } catch { return 0; }
}

export function touchStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  try {
    const s = JSON.parse(localStorage.getItem("norsk.streak") || "{}");
    if (s.date === today) return s.count || 1;
    const count = s.date === yesterday ? (s.count || 0) + 1 : 1;
    localStorage.setItem("norsk.streak", JSON.stringify({ date: today, count }));
    return count;
  } catch { return 1; }
}

export function cardId(card) {
  // Stable across renames/dedupes: keyed on the norsk word + the FR primary,
  // independent of which lesson contributed it. Renaming a source file or
  // re-merging duplicates therefore preserves the user's SRS progress.
  const front = (card.front || "").split(/[/(]/)[0].trim().toLowerCase();
  const back = (card.back || "").split(/[/(]/)[0].trim().toLowerCase();
  return `${front}::${back}`;
}

export function nextReview(state, quality) {
  // quality: 0 (fail) | 1 (hard) | 2 (good) | 3 (easy)
  let { ease = 2.5, interval = 0, reps = 0 } = state || {};
  if (quality === 0) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.round(interval * ease);
    ease = Math.max(1.3, ease + (0.1 - (3 - quality) * (0.08 + (3 - quality) * 0.02)));
  }
  const due = Date.now() + interval * 24 * 60 * 60 * 1000;
  return { ease, interval, reps, due };
}
