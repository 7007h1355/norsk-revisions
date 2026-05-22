import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";
import { loadFiche } from "../lib/data.js";
import { useNavigate } from "react-router-dom";
import { speak, loadVoices, NoNorskVoiceError } from "../lib/tts.js";
import { toast } from "../lib/toast.js";

export default function FicheView() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [md, setMd] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    loadFiche(slug).then(setMd).catch(e => setErr(e.message));
    loadVoices();
  }, [slug]);

  useEffect(() => {
    // attach click-to-speak on norsk words inside the rendered content
    const root = document.getElementById("fiche-content");
    if (!root) return;
    const onSpeakErr = (e) => {
      if (e instanceof NoNorskVoiceError) {
        toast("Aucune voix norvégienne installée", {
          type: "warn",
          action: { label: "Réglages", onClick: () => navigate("/settings") },
        });
      }
    };
    const handler = (e) => {
      const sel = window.getSelection?.().toString().trim();
      if (sel) { speak(sel).catch(onSpeakErr); return; }
      const target = e.target.closest("td, li");
      if (!target) return;
      const txt = target.innerText.split(/[—|=:]/)[0].trim();
      if (txt) speak(txt).catch(onSpeakErr);
    };
    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [md]);

  if (err) return <p className="err">Erreur: {err}</p>;
  if (!md) return <p>Chargement…</p>;

  // strip frontmatter from rendered view (keep separately if needed)
  const body = md.startsWith("---") ? md.replace(/^---[\s\S]*?---\n?/, "") : md;

  return (
    <article className="fiche">
      <Link to="/" className="back">← Fiches</Link>
      <div id="fiche-content" dangerouslySetInnerHTML={{ __html: marked.parse(body) }} />
      <p className="hint">💡 Clique un mot ou une ligne pour l'entendre prononcé.</p>
    </article>
  );
}
