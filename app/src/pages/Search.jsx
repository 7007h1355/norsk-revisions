import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadIndex, loadFiche } from "../lib/data.js";

export default function Search() {
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    (async () => {
      const idx = await loadIndex();
      const loaded = await Promise.all(
        idx.fiches.map(async f => ({ ...f, text: await loadFiche(f.slug).catch(() => "") }))
      );
      setDocs(loaded);
    })();
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return docs
      .map(d => {
        const i = d.text.toLowerCase().indexOf(needle);
        if (i < 0) return null;
        const start = Math.max(0, i - 40);
        const end = Math.min(d.text.length, i + needle.length + 80);
        return { slug: d.slug, title: d.title, snippet: d.text.slice(start, end).replace(/\n/g, " ") };
      })
      .filter(Boolean)
      .slice(0, 30);
  }, [q, docs]);

  return (
    <div className="search">
      <input
        placeholder="Cherche un mot, une règle…"
        value={q}
        onChange={e => setQ(e.target.value)}
        type="search"
        inputMode="search"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="search"
      />
      {!q && (
        <div className="search-empty">
          <p>Cherche un mot norvégien, une règle grammaticale, une expression…</p>
          <div className="search-hints">
            {["snakke", "ikke", "pronoms", "conjugaison", "høflig"].map(w => (
              <button key={w} className="search-hint-chip" onClick={() => setQ(w)}>{w}</button>
            ))}
          </div>
        </div>
      )}
      {q && <p className="meta">{results.length} résultat{results.length > 1 ? "s" : ""}</p>}
      <ul>
        {results.map((r, i) => (
          <li key={r.slug + "-" + i}>
            <Link to={`/fiche/${r.slug}`}>
              <strong>{r.title}</strong>
              <small>…{r.snippet}…</small>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
