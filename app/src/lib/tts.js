import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { Capacitor } from "@capacitor/core";

const RATE_KEY = "norsk.tts_rate";

export const isNative = Capacitor.isNativePlatform();

export function getRate() {
  const r = parseFloat(localStorage.getItem(RATE_KEY) || "0.85");
  return Number.isFinite(r) ? r : 0.85;
}
export function setRate(r) { localStorage.setItem(RATE_KEY, String(r)); }

let cachedNorskVoices = null;

export async function getNorskVoices() {
  if (cachedNorskVoices) return cachedNorskVoices;
  if (!isNative) {
    const all = await loadWebVoices();
    const norsk = all.filter(isNorskVoice).sort((a, b) => scoreVoice(b) - scoreVoice(a));
    cachedNorskVoices = { norsk, all };
    return cachedNorskVoices;
  }
  try {
    const { languages } = await TextToSpeech.getSupportedLanguages();
    const norsk = (languages || []).filter(l => /^(nb|nn|no)/i.test(l))
      .map(l => ({ name: l, lang: l, voiceURI: l, localService: true }));
    cachedNorskVoices = { norsk, all: norsk };
    return cachedNorskVoices;
  } catch {
    cachedNorskVoices = { norsk: [], all: [] };
    return cachedNorskVoices;
  }
}

async function pickBestNorskVoice() {
  const { norsk } = await getNorskVoices();
  return norsk[0] || null;
}

export class NoNorskVoiceError extends Error {
  constructor() {
    super("Aucune voix norvégienne disponible sur cet appareil");
    this.name = "NoNorskVoiceError";
  }
}

export async function speak(text) {
  if (!text) return;
  const rate = getRate();

  if (isNative) {
    return TextToSpeech.speak({
      text: text.slice(0, 4000),
      lang: "nb-NO",
      rate: Math.max(0.1, Math.min(2.0, rate)),
      pitch: 1.0,
      volume: 1.0,
      category: "ambient",
    });
  }

  // Web fallback
  const voice = await pickBestNorskVoice();
  if (!voice) throw new NoNorskVoiceError();
  return speakViaSpeech(text, voice, rate);
}

export function stopSpeaking() {
  if (isNative) { TextToSpeech.stop().catch(() => {}); return; }
  try { window.speechSynthesis?.cancel(); } catch {}
}

// ── Web Speech helpers (non-native only) ────────────────────────────────────

let cached = null;
let pending = null;

function isNorskVoice(v) {
  return /^(nb|nn|no)([-_]|$)/i.test(v.lang) || /norwegian|norvég|norsk|bokmål|bokmal|nynorsk/i.test(v.name);
}

function scoreVoice(v) {
  let s = 0;
  if (/^nb/i.test(v.lang)) s += 100;
  else if (/^no/i.test(v.lang)) s += 80;
  else if (/^nn/i.test(v.lang)) s += 60;
  if (/google/i.test(v.name)) s += 30;
  if (/samsung/i.test(v.name)) s += 25;
  if (/microsoft/i.test(v.name)) s += 20;
  if (/enhanced|premium|natural|neural/i.test(v.name)) s += 15;
  if (v.localService) s += 5;
  if (/nora|finn|liv/i.test(v.name)) s += 10;
  return s;
}

function loadWebVoices() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { cached = []; resolve(cached); return; }
    const tryGet = () => { const v = synth.getVoices(); if (v?.length) { cached = v; resolve(v); return true; } return false; };
    if (tryGet()) return;
    let done = false;
    const finish = () => { if (done) return; done = true; synth.removeEventListener?.("voiceschanged", onChange); cached = synth.getVoices() || []; resolve(cached); };
    const onChange = () => { if (tryGet()) finish(); };
    synth.addEventListener?.("voiceschanged", onChange);
    setTimeout(finish, 2500);
  });
  return pending;
}

function speakViaSpeech(text, voice, rate) {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.reject(new Error("no speechSynthesis"));
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  u.pitch = 1;
  return new Promise((resolve, reject) => {
    u.onend = () => resolve();
    u.onerror = (e) => reject(new Error(e.error || "speech error"));
    synth.speak(u);
  });
}
