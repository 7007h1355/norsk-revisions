import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getNorskVoices, setPreferredVoice, pickBestNorskVoice,
  getEngine, setEngine, getRate, setRate, speak, stopSpeaking,
  NoNorskVoiceError,
} from "../lib/tts.js";
import { toast } from "../lib/toast.js";

const SAMPLE = "Hei! Jeg heter Anna og jeg kommer fra Frankrike.";

export default function Settings() {
  const [norsk, setNorsk] = useState([]);
  const [all, setAll] = useState([]);
  const [active, setActive] = useState(null);
  const [engine, setEngineState] = useState(getEngine());
  const [rate, setRateState] = useState(getRate());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      const { norsk, all } = await getNorskVoices();
      setNorsk(norsk);
      setAll(all);
      const best = await pickBestNorskVoice();
      if (best) setActive(best.voiceURI);
    })();
    return () => stopSpeaking();
  }, []);

  const trySpeak = (text) => speak(text).catch((e) => {
    if (e instanceof NoNorskVoiceError) {
      toast("Aucune voix norvégienne installée — installe une voix nb-NO sur ton appareil", { type: "warn", duration: 5000 });
    } else {
      toast(e.message, { type: "warn", duration: 5000 });
    }
  });

  const chooseVoice = (v) => {
    setPreferredVoice(v.voiceURI);
    setActive(v.voiceURI);
    setEngineState("speech");
    setEngine("speech");
    trySpeak(SAMPLE);
  };

  // Google Translate TTS fallback est cassé (CORS) — code de retour conservé pour réactivation.
  // const useGoogle = () => { setEngine("google"); setEngineState("google"); trySpeak(SAMPLE); };

  const onRate = (v) => {
    setRate(v);
    setRateState(v);
  };

  const list = showAll ? all : norsk;
  const noNorsk = norsk.length === 0;
  const activeVoice = norsk.find(v => v.voiceURI === active);

  return (
    <div className="settings">
      <Link to="/" className="back-btn">← Retour</Link>
      <h2>🔊 Prononciation</h2>

      <div className="setting-card diagnostic">
        <div className="row">
          <label>Voix utilisée</label>
          <span>
            {engine === "google"
              ? "🌐 Google Translate"
              : activeVoice
                ? `🇳🇴 ${activeVoice.name} (${activeVoice.lang})`
                : "⚠️ Aucune (audio désactivé)"}
          </span>
        </div>
      </div>

      <div className="setting-card">
        <div className="row">
          <label>Vitesse</label>
          <span>{rate.toFixed(2)}×</span>
        </div>
        <input
          type="range" min="0.5" max="1.3" step="0.05"
          value={rate}
          onChange={(e) => onRate(parseFloat(e.target.value))}
        />
        <button className="test-btn" onClick={() => trySpeak(SAMPLE)}>▶ Tester</button>
      </div>

      {/*
        L'endpoint translate.google.com/translate_tts est bloqué par CORS sur la plupart des
        navigateurs depuis 2023. Le toggle est masqué pour éviter de proposer une option
        qui échoue silencieusement. Réactiver si on branche un vrai TTS backend (Azure,
        ElevenLabs, ResponsiveVoice, etc.).
      */}

      <h3>Voix disponibles</h3>
      {noNorsk && (
        <div className="warn">
          <strong>⚠️ Aucune voix norvégienne détectée</strong>

          <details open>
            <summary>📱 Samsung / Android</summary>
            <ol>
              <li>Paramètres → <strong>Gestion globale</strong> → <strong>Synthèse vocale</strong> (ou « Text-to-speech »)</li>
              <li>Moteur favori → choisir <strong>Google</strong> (pas Samsung TTS)</li>
              <li>Touche ⚙️ à côté de Google → <strong>Installer données vocales</strong></li>
              <li>Choisir <strong>Norsk (Norge)</strong> / Norwegian Bokmål → Télécharger</li>
              <li>Reviens ici, recharge la page</li>
            </ol>
            <p className="hint">Utilise <strong>Chrome</strong> (pas Samsung Internet) — meilleur support Web Speech.</p>
          </details>

          <details>
            <summary>🍎 iOS / iPad</summary>
            <ol>
              <li>Réglages → Accessibilité → Contenu énoncé → Voix</li>
              <li>Langues & dialectes → <strong>Norvégien (Bokmål)</strong> → installer Nora</li>
            </ol>
          </details>

          <details>
            <summary>💻 macOS</summary>
            <ol>
              <li>Réglages Système → Accessibilité → Contenu énoncé → Voix système</li>
              <li>Personnaliser → <strong>Norvégien (Bokmål)</strong> → cocher Nora → Télécharger</li>
            </ol>
          </details>
        </div>
      )}

      <div className="voices">
        {list.map(v => {
          const isNo = /^(nb|nn|no)/i.test(v.lang) || /norsk|norwegian|bokm/i.test(v.name);
          return (
            <button
              key={v.voiceURI}
              className={`voice ${active === v.voiceURI && engine === "speech" ? "on" : ""}`}
              onClick={() => chooseVoice(v)}
            >
              <div className="vname">{v.name} {isNo ? "🇳🇴" : ""}</div>
              <div className="vmeta">{v.lang} · {v.localService ? "local" : "réseau"}</div>
            </button>
          );
        })}
      </div>

      <button className="more-btn" onClick={() => setShowAll(s => !s)}>
        {showAll ? "Cacher les autres langues" : `Afficher toutes les voix (${all.length})`}
      </button>

      <details className="diag">
        <summary>🔬 Diagnostic technique</summary>
        <p>
          UA: <code>{navigator.userAgent.slice(0, 120)}</code>
        </p>
        <p>
          Voix totales: <strong>{all.length}</strong> · norvégiennes: <strong>{norsk.length}</strong>
        </p>
        <p>
          Web Speech API: <strong>{"speechSynthesis" in window ? "✓" : "✗ absent"}</strong>
        </p>
      </details>
    </div>
  );
}
