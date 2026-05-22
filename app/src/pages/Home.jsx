import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadIndex } from "../lib/data.js";

export default function Home() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { loadIndex().then(setData).catch(e => setErr(e.message)); }, []);

  if (err) return <p className="err">Erreur: {err}. As-tu lancé <code>npm run build:fiches</code> ?</p>;
  if (!data) return <p>Chargement…</p>;
  if (!data.fiches.length) return (
    <div className="empty">
      <h2>Aucune fiche pour l'instant</h2>
      <p>Lance le pipeline pour générer les fiches depuis tes cours.</p>
    </div>
  );

  const recaps = data.fiches.filter(f => f.kind === "recap");
  const lessons = data.fiches.filter(f => f.kind !== "recap");

  return (
    <div className="fiches-list">
      {recaps.length > 0 && (
        <>
          <h2>Récapitulatifs</h2>
          <ul>
            {recaps.map(f => (
              <li key={f.slug} className="recap">
                <Link to={`/fiche/${f.slug}`}>
                  <span className="title">{f.title}</span>
                  <span className="meta">{f.card_count} entrées</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <h2>{lessons.length} leçon{lessons.length > 1 ? "s" : ""}</h2>
      <ul>
        {lessons.map(f => (
          <li key={f.slug}>
            <Link to={`/fiche/${f.slug}`}>
              <span className="title">{f.title}</span>
              <span className="meta">{f.niveau} · {f.card_count} cartes</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
