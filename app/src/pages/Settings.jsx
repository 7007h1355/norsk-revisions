import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  isNative, getNorskVoices, getRate, setRate, speak, stopSpeaking,
  NoNorskVoiceError,
} from "../lib/tts.js";
import { exportSrs, importSrs } from "../lib/data.js";
import { toast } from "../lib/toast.js";

const SAMPLE = "Hei! Jeg heter Anna og jeg kommer fra Frankrike.";

export default function Settings() {
  const [norsk, setNorsk] = useState([]);
  const [all, setAll] = useState([]);
  const [rate, setRateState] = useState(getRate());
  const [showAll, setShowAll] = useState(false);
  const [importText, setImportText] = useState(null); // null = hidden, "" = open

  useEffect(() => {
    getNorskVoices().then(({ norsk, all }) => { setNorsk(norsk); setAll(all); });
    return () => stopSpeaking();
  }, []);

  const trySpeak = (text) => speak(text).catch((e) => {
    if (e instanceof NoNorskVoiceError) {
      toast("Aucune voix norvégienne — installe le pack nb-NO dans Paramètres → Synthèse vocale", { type: "warn", duration: 5000 });
    } else {
      toast(e.message, { type: "warn", duration: 5000 });
    }
  });

  const onRate = (v) => { setRate(v); setRateState(v); };

  const doExport = () => {
    const json = exportSrs();
    if (navigator.share) {
      navigator.share({ title: "Norsk SRS backup", text: json }).catch(() => {});
    } else {
      navigator.clipboard.writeText(json)
        .then(() => toast("Progression copiée dans le presse-papier", { type: "ok" }))
        .catch(() => toast("Copie échouée — ouvre le diagnostic et copie manuellement", { type: "warn" }));
    }
  };

  const doImport = () => {
    try {
      importSrs(importText);
      setImportText(null);
      toast("Progression restaurée ✓", { type: "ok" });
    } catch (e) {
      toast(`Erreur: ${e.message}`, { type: "warn" });
    }
  };

  const list = showAll ? all : norsk;
  const noNorsk = !isNative && norsk.length === 0;

  return (
    <div className="settings">
      <Link to="/" className="back-btn">← Retour</Link>
      <h2>🔊 Prononciation</h2>

      <div className="setting-card diagnostic">
        <div className="row">
          <label>Voix utilisée</label>
          <span>
            {isNative
              ? "🇳🇴 Android TTS natif (nb-NO)"
              : norsk.length > 0
                ? `🇳🇴 ${norsk[0].name} (${norsk[0].lang})`
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

      {!isNative && <h3>Voix disponibles</h3>}
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

      {!isNative && (
        <>
          <div className="voices">
            {list.map(v => {
              const isNo = /^(nb|nn|no)/i.test(v.lang) || /norsk|norwegian|bokm/i.test(v.name);
              return (
                <button
                  key={v.voiceURI}
                  className="voice"
                  onClick={() => trySpeak(SAMPLE)}
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
        </>
      )}

      <h3>Sauvegarde progression</h3>
      <div className="setting-card">
        <p className="vo-sub" style={{margin:"0 0 12px"}}>La progression SRS est stockée localement. Exporte-la pour ne pas la perdre si tu réinstalles l'app.</p>
        <div style={{display:"flex", gap:8}}>
          <button className="test-btn" style={{flex:1}} onClick={doExport}>📤 Exporter</button>
          <button className="test-btn" style={{flex:1, background:"var(--surface-2)"}} onClick={() => setImportText("")}>📥 Importer</button>
        </div>
      </div>

      {importText !== null && (
        <div className="install-modal-backdrop">
          <div className="install-modal">
            <h3>📥 Importer progression</h3>
            <p className="hint">Colle le JSON exporté depuis l'autre appareil :</p>
            <textarea
              style={{width:"100%", height:140, background:"var(--surface-3)", color:"var(--text)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:8, fontFamily:"monospace", fontSize:12, resize:"vertical"}}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder='{"mot::traduction": {...}}'
            />
            <div style={{display:"flex", gap:8, marginTop:12}}>
              <button className="vo-done" style={{flex:1}} onClick={doImport} disabled={!importText.trim()}>Restaurer</button>
              <button className="vo-skip" style={{flex:1, border:"1px solid var(--surface-3)", borderRadius:8}} onClick={() => setImportText(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      <details className="diag">
        <summary>🔬 Diagnostic technique</summary>
        <p>Mode: <strong>{isNative ? "Android natif" : "Web"}</strong></p>
        {!isNative && <>
          <p>Voix totales: <strong>{all.length}</strong> · norvégiennes: <strong>{norsk.length}</strong></p>
          <p>Web Speech API: <strong>{"speechSynthesis" in window ? "✓" : "✗ absent"}</strong></p>
        </>}
      </details>
    </div>
  );
}
