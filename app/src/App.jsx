import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import FicheView from "./pages/FicheView.jsx";
import Flashcards from "./pages/Flashcards.jsx";
import Search from "./pages/Search.jsx";
import Settings from "./pages/Settings.jsx";

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

export default function App() {
  return (
    <div className="app">
      <ScrollToTop />
      <header className="topbar">
        <h1>🇳🇴 Norsk</h1>
        <InstallPrompt />
        <NavLink to="/settings" className="settings-btn" title="Paramètres voix">⚙️</NavLink>
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
        </NavLink>
        <NavLink to="/search">
          <span className="ic">🔍</span>
          <span>Recherche</span>
        </NavLink>
      </nav>
    </div>
  );
}
