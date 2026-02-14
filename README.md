# Portfolio site

A simple portfolio website that renders Markdown work entries.

## Quick start

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

## Add work (Markdown)

- Put your `.md` files in `public/work/`.
- The site automatically generates `public/work/index.json` from that folder.
- Each file becomes a page at `/work/<filename-without-.md>`.

### Optional frontmatter

At the top of your markdown file you can add:

```yaml
---
title: My Project
date: 2026-02-13
description: One-line summary.
---
```

## Deploy (GitHub Pages)

### Option A (recommended): GitHub Actions deploy

Set GitHub Pages to deploy from **GitHub Actions** and push to `main`.

### Option B: Manual build

Build with a base path (use your repo name only):

```bash
VITE_BASE=/portfolio/ npm run build
```

Then deploy the `dist/` folder to GitHub Pages.

Tip: if you want, tell me your GitHub username + repo name and I can add a GitHub Actions workflow to auto-deploy.
