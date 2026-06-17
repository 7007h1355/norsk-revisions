import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import Home from "./pages/Home.jsx";
import FicheView from "./pages/FicheView.jsx";
import Flashcards from "./pages/Flashcards.jsx";
import Search from "./pages/Search.jsx";
import Settings from "./pages/Settings.jsx";
import { isNative, getNorskVoices, speak } from "./lib/tts.js";
import { loadFlashcards, loadSrs, countSessionCards, getStreak } from "./lib/data.js";
import { App as CapApp } from "@capacitor/app";

const ONBOARDING_KEY = "norsk.voice_onboarding";
const isAndroid = /Android/i.test(navigator.userAgent);

function VoiceOnboarding() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isNative) return;          // native APK: TTS works directly, no onboarding needed
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    if (!isAndroid) return;
    getNorskVoices().then(({ norsk }) => {
      if (norsk.length === 0) setShow(true);
    });
  }, []);

  const dismiss = (done) => {
    localStorage.setItem(ONBOARDING_KEY, done ? "done" : "skipped");
    setShow(false);
    if (done) speak("Hei! God uttale nå.").catch(() => {});
  };

  if (!show) return null;

  return (
    <div className="install-modal-backdrop">
      <div className="install-modal voice-onboarding">
        <div className="vo-icon">🔊</div>
        <h3>Activer la voix norvégienne</h3>
        <p className="vo-sub">Sans voix nb-NO installée, la prononciation est désactivée.</p>
        <a
          className="vo-settings-btn"
          href="intent:#Intent;action=android.settings.TTS_SETTINGS;end"
        >
          ⚙️ Ouvrir les paramètres vocaux
        </a>
        <ol>
          <li>Moteur favori → <strong>Google</strong> → icône ⚙️</li>
          <li>→ <strong>Installer données vocales</strong></li>
          <li>Cherche <strong>Norsk (Norge)</strong> → télécharger</li>
          <li>Reviens ici et appuie sur <strong>C'est fait !</strong></li>
        </ol>
        <p className="hint">Reviens dans l'app après le téléchargement et appuie sur "C'est fait !".</p>
        <div className="vo-actions">
          <button className="vo-done" onClick={() => dismiss(true)}>✅ C'est fait !</button>
          <button className="vo-skip" onClick={() => dismiss(false)}>Ignorer</button>
        </div>
      </div>
    </div>
  );
}

function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches ||
          window.navigator.standalone === true
  );

  // iOS Safari does NOT fire `beforeinstallprompt` — install is manual via Share → Add to Home.
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  // Chrome/Android: native prompt available.
  if (deferred) {
    return (
      <button className="install-btn" onClick={async () => {
        await deferred.prompt();
        setDeferred(null);
      }}>
        📲 Installer
      </button>
    );
  }

  // iOS Safari: render a button that opens an instructions modal.
  if (isIos) {
    return (
      <>
        <button className="install-btn" onClick={() => setShowIosHint(true)}>
          📲 Installer
        </button>
        {showIosHint && (
          <div className="install-modal-backdrop" onClick={() => setShowIosHint(false)}>
            <div className="install-modal" onClick={e => e.stopPropagation()}>
              <h3>📲 Installer sur iPhone / iPad</h3>
              <ol>
                <li>Touche le bouton <strong>Partager</strong> en bas (carré avec flèche ↑)</li>
                <li>Fais défiler et choisis <strong>« Sur l'écran d'accueil »</strong></li>
                <li>Touche <strong>Ajouter</strong> en haut à droite</li>
              </ol>
              <p className="hint">L'app fonctionnera ensuite hors-ligne et comme une vraie app.</p>
              <button className="test-btn" onClick={() => setShowIosHint(false)}>OK</button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [pathname]);
  return null;
}

function BackButtonHandler() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isNative) return;
    const listener = CapApp.addListener("backButton", () => {
      if (pathname === "/") {
        CapApp.exitApp();
      } else {
        navigate(-1);
      }
    });
    return () => { listener.then(h => h.remove()); };
  }, [pathname, navigate]);
  return null;
}

const ONBOARDING_SRS_KEY = "norsk.onboarding.srs.v1";

function SrsOnboarding() {
  const [show, setShow] = useState(() => !localStorage.getItem(ONBOARDING_SRS_KEY));
  if (!show) return null;
  const dismiss = () => { localStorage.setItem(ONBOARDING_SRS_KEY, "done"); setShow(false); };
  return (
    <div className="install-modal-backdrop">
      <div className="install-modal">
        <div className="vo-icon">🧠</div>
        <h3>Comment ça marche ?</h3>
        <ul style={{ paddingLeft: 20, margin: "12px 0" }}>
          <li style={{ marginBottom: 8 }}><strong>20 cartes/jour</strong> — pas plus, pour ancrer sans saturer</li>
          <li style={{ marginBottom: 8 }}><strong>Répétition espacée</strong> — les cartes ratées reviennent plus souvent, les faciles moins</li>
          <li style={{ marginBottom: 8 }}><strong>Régularité &gt; volume</strong> — 10 min par jour &gt; 2h le dimanche</li>
        </ul>
        <button className="vo-done" onClick={dismiss}>C'est parti ! 🇳🇴</button>
      </div>
    </div>
  );
}

export default function App() {
  const [due, setDue] = useState(0);
  const [streak, setStreak] = useState(getStreak);
  const { pathname } = useLocation();

  useEffect(() => {
    loadFlashcards().then(cards => setDue(countSessionCards(cards, loadSrs()))).catch(() => {});
    setStreak(getStreak());
  }, [pathname]);

  return (
    <div className="app">
      <SrsOnboarding />
      <VoiceOnboarding />
      <ScrollToTop />
      <BackButtonHandler />
      <header className="topbar">
        <h1>🇳🇴 Norsk</h1>
        <InstallPrompt />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/fiche/:slug" element={<FicheView />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <span className="ic">📚</span>
          <span>Fiches</span>
        </NavLink>
        <NavLink to="/flashcards">
          <span className="ic">🎯</span>
          <span>Cartes</span>
          {due > 0 && <span className="badge">{due}</span>}
        </NavLink>
        <NavLink to="/search">
          <span className="ic">🔍</span>
          <span>Chercher</span>
        </NavLink>
        <NavLink to="/settings">
          <span className="ic">⚙️</span>
          <span>Réglages</span>
          {streak > 0 && <span className="streak-chip">🔥{streak}</span>}
        </NavLink>
      </nav>
    </div>
  );
}
