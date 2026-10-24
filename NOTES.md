# pocus: notes

Lasting rules live in `AGENTS.md`. Points worth remembering (how to test, gotchas, why something is the way it is) go here.

- Installable web apps stay installable but are never prompted (see `AGENTS.md`).
- Pages use paths relative to `pocus/` (`assets/`, `fonts/`, logo); links to other NTF pages are absolute (https://anantf.com/, regional, exams and airway hosts).
- The Worker serves only `pocus/` (root host); the repo's tools, worker code, config and `pocus/test/` are never served (`.assetsignore`).
- `pocus/haemodynamics/package.json` says commonjs so `model.test.cjs` can `require` `model.js` (the repo is `"type": "module"`).
- Test: `node tools/check.mjs`, `python3 pocus/test/content.py`, `node pocus/test/model.test.cjs`; browser suite: `python3 -m http.server 8080` in the repo root, then `PLAYWRIGHT_PATH=<playwright/index.mjs> node pocus/test/review.e2e.mjs`; local Worker: `npx wrangler@4 dev --local --port 8799`, then curl the pages.
