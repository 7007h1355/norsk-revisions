import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFlashcards, loadSrs, saveSrs, cardId, nextReview, touchStreak } from "../lib/data.js";
import { speak, NoNorskVoiceError } from "../lib/tts.js";
import { toast } from "../lib/toast.js";
import { useNavigate } from "react-router-dom";

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

function safeSpeak(navigate) {
  return (text) => speak(text).catch((e) => {
    if (e instanceof NoNorskVoiceError) {
      toast("Aucune voix norvégienne installée", {
        type: "warn",
        action: { label: "Réglages", onClick: () => navigate("/settings") },
      });
    } else {
      toast(`Audio: ${e.message}`, { type: "warn" });
    }
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistractors(target, pool, n = 3) {
  // Try same-tag candidates first, then fall through to the whole pool so we ALWAYS get N
  // distinct distractors even when the tag is tiny or has many cards sharing the same `back`.
  const seen = new Set([target.back]);
  const uniq = [];
  const take = (list) => {
    for (const c of shuffle(list)) {
      if (seen.has(c.back)) continue;
      seen.add(c.back);
      uniq.push(c);
      if (uniq.length >= n) return true;
    }
    return false;
  };
  take(pool.filter(c => c.tag === target.tag)) || take(pool);
  return uniq;
}

export default function Flashcards() {
  const [cards, setCards] = useState(null);
  const [srs, setSrs] = useState(loadSrs());
  const [tag, setTag] = useState("all");
  const [mode, setMode] = useState(() => localStorage.getItem("norsk.mode") || "reveal");
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(false);
  const [qcm, setQcm] = useState(null);   // { options:[card,...], picked:null|idx }
  const [swipeClass, setSwipeClass] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({ ok: 0, again: 0 });
  const touchRef = useRef({ x: 0, y: 0, startX: 0, dx: 0, dy: 0 });

  const navigate = useNavigate();
  const speakSafe = useCallback(safeSpeak(navigate), [navigate]);

  useEffect(() => { loadFlashcards().then(setCards).catch(() => setCards([])); }, []);
  useEffect(() => { localStorage.setItem("norsk.mode", mode); }, [mode]);

  const tags = useMemo(() => {
    if (!cards) return [];
    const s = new Set(cards.map(c => c.tag).filter(Boolean));
    return ["all", ...Array.from(s).sort()];
  }, [cards]);

  const MAX_NEW_PER_SESSION = 20;

  // Build the session queue ONCE per (cards, tag) change. Including `srs` in the deps
  // would cause the queue to rebuild after every rate(), filtering out the card you just
  // graded and shifting `idx` so subsequent cards get skipped.
  const queue = useMemo(() => {
    if (!cards) return [];
    const now = Date.now();
    const filtered = cards
      .filter(c => tag === "all" || c.tag === tag)
      .map(c => ({ card: c, state: srs[cardId(c)] || {} }));
    const due = filtered.filter(x => x.state.due && x.state.due <= now && x.state.reps !== undefined)
      .sort((a, b) => (a.state.due || 0) - (b.state.due || 0));
    const newCards = filtered.filter(x => !x.state.due && x.state.reps === undefined)
      .slice(0, MAX_NEW_PER_SESSION);
    return [...due, ...newCards];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, tag]);

  // (re)build QCM options when card changes in qcm mode
  useEffect(() => {
    if (mode !== "qcm" || !queue.length || !cards || idx >= queue.length) { setQcm(null); return; }
    const cur = queue[idx];
    const distractors = pickDistractors(cur.card, cards, 3);
    const options = shuffle([cur.card, ...distractors]);
    setQcm({ options, picked: null });
  }, [mode, idx, cards, queue]);

  if (!cards) return <p>Chargement…</p>;
  if (!cards.length) return <p>Pas encore de cartes — génère des fiches d'abord.</p>;

  const header = (
    <>
      <ModeSwitch mode={mode} setMode={(m) => { setMode(m); setShown(false); setIdx(0); }} />
      <TagPicker tags={tags} tag={tag} setTag={(t) => { setTag(t); setIdx(0); setShown(false); }} />
    </>
  );

  if (!queue.length) return (
    <div className="flashcards">
      {header}
      <div className="empty">
        <h2>✅ Rien à réviser ici</h2>
        <p>Reviens plus tard, ou change de catégorie.</p>
      </div>
    </div>
  );

  // Session done: idx ran past the end of the snapshot queue.
  if (idx >= queue.length) {
    const streak = touchStreak();
    const total = sessionStats.ok + sessionStats.again;
    const pct = total ? Math.round((sessionStats.ok / total) * 100) : 0;
    return (
      <div className="flashcards">
        {header}
        <div className="session-done">
          <div className="session-done-icon">🎉</div>
          <h2>Session terminée !</h2>
          {streak > 0 && <p className="streak-line">🔥 Série : <strong>{streak} jour{streak > 1 ? "s" : ""}</strong></p>}
          <div className="session-stats">
            <div className="stat ok"><span className="stat-n">{sessionStats.ok}</span><span className="stat-l">Bien</span></div>
            <div className="stat pct"><span className="stat-n">{pct}%</span><span className="stat-l">Réussite</span></div>
            <div className="stat again"><span className="stat-n">{sessionStats.again}</span><span className="stat-l">À revoir</span></div>
          </div>
          <div className="session-done-actions">
            <button className="done-btn-primary" onClick={() => { setIdx(0); setSessionStats({ ok: 0, again: 0 }); }}>↺ Rejouer</button>
            <a className="done-btn-secondary" href="/">← Accueil</a>
          </div>
        </div>
      </div>
    );
  }
  const cur = queue[idx];
  const c = cur.card;

  function rate(quality) {
    vibrate(quality === 0 ? [40, 30, 40] : 20);
    const id = cardId(c);
    const next = nextReview(cur.state, quality);
    const updated = { ...srs, [id]: next };
    setSrs(updated);
    saveSrs(updated);
    setShown(false);
    setFlipped(false);
    setSessionStats(s => quality === 0 ? { ...s, again: s.again + 1 } : { ...s, ok: s.ok + 1 });
    setIdx(i => i + 1);
  }

  function onPick(i) {
    if (!qcm || qcm.picked !== null) return;
    const correct = qcm.options[i].back === c.back;
    vibrate(correct ? 25 : [40, 40, 80]);
    setQcm(q => ({ ...q, picked: i }));
  }

  function onTouchStart(e) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, startX: t.clientX, dx: 0, dy: 0 };
  }
  function onTouchMove(e) {
    const t = e.touches[0];
    touchRef.current.dx = t.clientX - touchRef.current.startX;
    touchRef.current.dy = t.clientY - touchRef.current.y;
  }
  function onTouchEnd() {
    const { dx, dy } = touchRef.current;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const dir = dx < 0 ? "left" : "right";
      setSwipeClass(`swipe-out-${dir}`);
      vibrate(15);
      // left = "À revoir" (quality 0), right = "OK" (quality 2)
      setTimeout(() => {
        setSwipeClass("");
        rate(dir === "left" ? 0 : 2);
      }, 180);
    }
    touchRef.current = { x: 0, y: 0, startX: 0, dx: 0, dy: 0 };
  }

  if (mode === "qcm") {
    return (
      <div className="flashcards">
        {header}
        <div className="card qcm">
          <div className="front">
            <span className="lang-tag">norsk</span>
            <span className="text">{c.front}</span>
            <button className="speak" onClick={(e) => { e.stopPropagation(); speakSafe(c.front); }}>🔊</button>
          </div>
          <p className="tap-hint">Choisis la bonne traduction :</p>
          <div className="choices">
            {qcm?.options.map((opt, i) => {
              const correct = opt.back === c.back;
              const picked = qcm.picked === i;
              const revealed = qcm.picked !== null;
              const cls = !revealed ? "" : correct ? "good" : picked ? "bad" : "dim";
              return (
                <button
                  key={i}
                  className={`choice ${cls}`}
                  onClick={() => onPick(i)}
                >
                  {opt.back}
                </button>
              );
            })}
          </div>
        </div>
        {qcm?.picked !== null && (
          <div className="rate">
            <button onClick={() => rate(0)}>😖 À revoir</button>
            <button onClick={() => rate(1)}>🤔 Dur</button>
            <button onClick={() => rate(2)}>🙂 OK</button>
            <button onClick={() => rate(3)}>😎 Facile</button>
          </div>
        )}
        <ProgressBar current={idx} total={queue.length} />
      <p className="progress">{idx}/{queue.length} dans cette session</p>
      </div>
    );
  }

  const handleReveal = () => {
    if (!shown) { setFlipped(true); speakSafe(c.front); }
    setShown(s => !s);
  };

  return (
    <div className="flashcards">
      {header}
      <ProgressBar current={idx} total={queue.length} />
      <div
        className={`card ${swipeClass}`}
        onClick={handleReveal}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="front">
          <span className="lang-tag">norsk</span>
          <span className="text">{c.front}</span>
          <button className="speak" onClick={(e) => { e.stopPropagation(); speakSafe(c.front); }}>🔊</button>
        </div>
        {shown && (
          <div className={`back${flipped ? " flip-in" : ""}`}>
            <span className="lang-tag">FR</span>
            <span className="text">{c.back}</span>
          </div>
        )}
        {!shown && <p className="tap-hint">Tape pour voir · Swipe ← à revoir / → OK</p>}
      </div>
      {shown && (
        <div className="rate-2">
          <button className="rate-again" onClick={() => rate(0)}>↩ Encore</button>
          <button className="rate-ok" onClick={() => rate(2)}>✓ OK</button>
        </div>
      )}
      <p className="progress">{idx}/{queue.length} dans cette session</p>
    </div>
  );
}

function ProgressBar({ current, total }) {
  if (!total) return null;
  const pct = Math.round((current / total) * 100);
  return (
    <div className="session-progress">
      <div className="session-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ModeSwitch({ mode, setMode }) {
  return (
    <div className="mode-switch">
      <button className={mode === "reveal" ? "on" : ""} onClick={() => setMode("reveal")}>🃏 Carte</button>
      <button className={mode === "qcm" ? "on" : ""} onClick={() => setMode("qcm")}>📝 QCM</button>
    </div>
  );
}

function TagPicker({ tags, tag, setTag }) {
  return (
    <div className="tags">
      {tags.map(t => (
        <button key={t} className={t === tag ? "on" : ""} onClick={() => setTag(t)}>{t}</button>
      ))}
    </div>
  );
}
