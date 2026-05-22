const BASE = import.meta.env.BASE_URL || "./";

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

export function cardId(card) {
  return `${card.source || ""}::${card.front}`;
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
