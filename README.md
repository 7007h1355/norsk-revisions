# 🇳🇴 Norsk Revisions

Pipeline automatique : cours Google Drive → fiches de révision markdown → PWA installable sur Android.

## Flux

```
Google Drive (partagé public)
        │
        ▼  (GitHub Actions, cron quotidien)
  sync_drive.py   → cours-raw/   (Word/pptx/PDF bruts, hashés)
        │
        ▼
  extract_text.py → cours-text/  (.md texte brut)
        │
        ▼  (sur ton Mac, npm run fiches → Claude CLI)
  build_fiches.py → fiches/      (.md structurés + flashcards JSON)
        │
        ▼  (GitHub Pages)
  PWA Vite/React  → Android, iPhone, desktop
```

## Prérequis

- **Drive** : dossier en partage `Toute personne disposant du lien → Lecteur`.
- **Local** : Python 3.10+, Node 20+, Claude Code CLI (`claude` dans le PATH).
- **GitHub** : repo, Actions activés, Pages activées (source = GitHub Actions).

## Setup local

```bash
# Python venv + deps
python3 -m venv .venv
.venv/bin/pip install gdown python-docx python-pptx pdfplumber

# App PWA
npm install --prefix app
```

URL Drive dans `scripts/drive_url.txt` (déjà configuré).

## Usage

```bash
# 1. sync depuis Drive
npm run sync

# 2. extraire texte des nouveaux/modifiés
npm run extract

# 3. générer fiches via Claude CLI (sur ton Mac uniquement)
npm run fiches

# Tout en une fois
npm run pipeline

# Lancer l'app en local
npm run dev
```

## Mode hybride (auto + manuel)

- **GitHub Actions** tourne quotidiennement (`cron: 0 6 * * *`) :
  1. Sync Drive (gdown)
  2. Diff par hash (`scripts/.sync_state.json`)
  3. Extract texte (PDF/docx/pptx)
  4. Commit `cours-raw/` + `cours-text/`
  5. Si nouveaux cours → ouvre une **issue GitHub** listant les fichiers
  6. Build + déploie la PWA sur GitHub Pages

- **Toi sur ton Mac**, quand tu vois la notif issue :
  ```bash
  git pull
  npm run fiches    # Claude CLI résume les nouveaux
  git add fiches && git commit -m "fiches: $(date +%F)" && git push
  ```
  Push → re-déploie auto sur GitHub Pages.

## Installer sur Android

1. Ouvrir l'URL GitHub Pages dans Chrome Android.
2. Menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).
3. Ça apparaît comme une vraie app. Marche **offline** une fois ouverte (service worker cache toutes les fiches).

## Fonctionnalités PWA

- 📋 **Liste fiches** par leçon, niveau, nombre de cartes.
- 📖 **Vue fiche** : markdown rendu avec tables vocab, grammaire, expressions, pièges. **Clic sur un mot norvégien → prononciation TTS** (voix nb-NO du navigateur).
- 🎯 **Flashcards** : répétition espacée (algo SM-2 léger, état stocké localStorage). Filtre par thème.
- 🔍 **Recherche** full-text dans toutes les fiches.

## Format fiche

Chaque `fiches/*.md` :

```markdown
---
title: Leçon X — ...
source: nom_fichier.docx
themes: [thème1, thème2]
niveau: A1|A2|B1|B2|C1
---

# Titre
## 📌 Résumé
## 📖 Vocabulaire (table norsk | FR | prononciation)
## 🔤 Grammaire
## 💬 Expressions
## ⚠️ Pièges francophones
## 🎯 Flashcards (JSON dans bloc ```json)
```

Le prompt qui guide Claude est dans `scripts/prompt_fiche.md` — éditable pour ajuster le style.

## Structure

```
.
├── cours-raw/        # docs Drive bruts (commités, git lourd OK)
├── cours-text/       # texte extrait (.md)
├── fiches/           # fiches finales (.md + index.json + flashcards.json)
├── scripts/
│   ├── drive_url.txt
│   ├── prompt_fiche.md
│   ├── sync_drive.py
│   ├── extract_text.py
│   └── build_fiches.py
├── app/              # PWA Vite/React
└── .github/workflows/sync.yml
```

## Déploiement initial

```bash
git remote add origin git@github.com:<user>/norsk-revisions.git
git add -A && git commit -m "init: pipeline norsk"
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source = GitHub Actions**.

L'URL sera `https://<user>.github.io/norsk-revisions/`.
