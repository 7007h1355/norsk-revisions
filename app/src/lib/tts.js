// Norwegian TTS with robust voice loading + Google Translate fallback.
//
// Web Speech API quirks handled:
// - getVoices() returns [] before voices are loaded (Chrome: voiceschanged event)
// - Different OSes ship different Norwegian voice IDs (nb-NO vs no-NO vs nn-NO)
// - On Android, Google's "Norwegian (Bokmål)" voice is high quality
// - On iOS/macOS, "Nora" is the bundled bokmål voice
// - If no Norwegian voice exists locally, fall back to Google Translate TTS via <audio>

const PREF_KEY = "norsk.voice";
const ENGINE_KEY = "norsk.tts_engine";  // "speech" | "google"
const RATE_KEY = "norsk.tts_rate";

let cached = null;
let pending = null;

function isNorsk(v) {
  return /^(nb|nn|no)([-_]|$)/i.test(v.lang) || /norwegian|norvég|norsk|bokmål|bokmal|nynorsk/i.test(v.name);
}

function scoreVoice(v) {
  // Higher = better
  let s = 0;
  if (/^nb/i.test(v.lang)) s += 100;          // bokmål first
  else if (/^no/i.test(v.lang)) s += 80;
  else if (/^nn/i.test(v.lang)) s += 60;
  if (/google/i.test(v.name)) s += 30;        // Google TTS engines are usually best
  if (/microsoft/i.test(v.name)) s += 20;
  if (/enhanced|premium|natural|neural/i.test(v.name)) s += 15;
  if (v.localService) s += 5;                 // local = no latency
  if (/nora|finn|liv/i.test(v.name)) s += 10; // known good Apple/MS voice names
  return s;
}

export function loadVoices() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { cached = []; resolve(cached); return; }

    const tryGet = () => {
      const v = synth.getVoices();
      if (v && v.length) {
        cached = v;
        resolve(v);
        return true;
      }
      return false;
    };

    if (tryGet()) return;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", onChange);
      if (!cached) { cached = synth.getVoices() || []; }
      resolve(cached);
    };
    const onChange = () => { if (tryGet()) finish(); };
    synth.addEventListener?.("voiceschanged", onChange);
    // Safety net: some browsers never fire voiceschanged.
    setTimeout(finish, 2500);
  });
  return pending;
}

export async function getNorskVoices() {
  const all = await loadVoices();
  const norsk = all.filter(isNorsk).sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return { norsk, all };
}

export async function pickBestNorskVoice() {
  const { norsk } = await getNorskVoices();
  const saved = localStorage.getItem(PREF_KEY);
  if (saved) {
    const match = norsk.find(v => v.voiceURI === saved || v.name === saved);
    if (match) return match;
  }
  return norsk[0] || null;
}

export function setPreferredVoice(voiceURI) {
  if (voiceURI) localStorage.setItem(PREF_KEY, voiceURI);
  else localStorage.removeItem(PREF_KEY);
}

export function getEngine() {
  // Default to "auto": pick the best engine at speak time based on local voice availability.
  return localStorage.getItem(ENGINE_KEY) || "auto";
}
export function setEngine(e) { localStorage.setItem(ENGINE_KEY, e); }

export function getRate() {
  const r = parseFloat(localStorage.getItem(RATE_KEY) || "0.85");
  return Number.isFinite(r) ? r : 0.85;
}
export function setRate(r) { localStorage.setItem(RATE_KEY, String(r)); }

let currentAudio = null;

function speakViaGoogle(text, rate) {
  // Unofficial endpoint. Often blocked by CORS / User-Agent checks in some browsers.
  // Caller is responsible for surfacing failures to the user.
  const chunk = text.slice(0, 200);
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=no&client=tw-ob`;
  try { currentAudio?.pause(); } catch {}
  const a = new Audio(url);
  a.playbackRate = Math.max(0.5, Math.min(2, rate));
  currentAudio = a;
  return new Promise((resolve, reject) => {
    a.addEventListener("error", () => reject(new Error("Google TTS bloqué par le navigateur (CORS).")));
    a.addEventListener("ended", () => resolve());
    a.play().catch(reject);
  });
}

function speakViaSpeech(text, voice, rate) {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.reject(new Error("no speechSynthesis"));
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = "nb-NO";
  }
  u.rate = rate;
  u.pitch = 1;
  synth.speak(u);
  return Promise.resolve();
}

// Custom error so callers can show a clear UI when no Norwegian voice exists.
export class NoNorskVoiceError extends Error {
  constructor() {
    super("Aucune voix norvégienne disponible sur cet appareil");
    this.name = "NoNorskVoiceError";
  }
}

export async function speak(text) {
  if (!text) return;
  const engine = getEngine();
  const rate = getRate();

  if (engine === "google") {
    return speakViaGoogle(text, rate);
  }

  // Default ("auto") and "speech" both require a real Norwegian voice.
  // Mispronouncing with a French/English voice ("hache-é-i" for "Hei") is worse than no audio.
  const voice = await pickBestNorskVoice();
  if (!voice) throw new NoNorskVoiceError();
  return speakViaSpeech(text, voice, rate);
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch {}
  try { currentAudio?.pause(); } catch {}
}
