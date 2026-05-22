import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import Home from "./pages/Home.jsx";
import FicheView from "./pages/FicheView.jsx";
import Flashcards from "./pages/Flashcards.jsx";
import Search from "./pages/Search.jsx";
import Settings from "./pages/Settings.jsx";

function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches ||
          window.navigator.standalone === true
  );

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

  if (installed || !deferred) return null;
  return (
    <button className="install-btn" onClick={async () => {
      await deferred.prompt();
      setDeferred(null);
    }}>
      📲 Installer l'app
    </button>
  );
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
