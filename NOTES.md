# pocus: notes

Lasting rules live in `AGENTS.md`. Points worth remembering (how to test, gotchas, why something is the way it is) go here.

- Installable web apps stay installable but are never prompted (see `AGENTS.md`).
- Pages use paths relative to `pocus/` (`assets/`, `fonts/`, logo); links to other NTF pages are absolute (https://anantf.com/, regional, exams and airway hosts).
- The Worker serves only `pocus/` (root host); the repo's tools, worker code, config and `pocus/test/` are never served (`.assetsignore`).
- `pocus/haemodynamics/package.json` says commonjs so `model.test.cjs` can `require` `model.js` (the repo is `"type": "module"`).
- Test: `node tools/check.mjs`, `python3 pocus/test/content.py`, `node pocus/test/model.test.cjs`; browser suite: `python3 -m http.server 8080` in the repo root, then `PLAYWRIGHT_PATH=<playwright/index.mjs> node pocus/test/review.e2e.mjs`; local Worker: `npx wrangler@4 dev --local --port 8799`, then curl the pages.
- Cardiac has a reference part 'Standard TTE views' (`#part-tte`, slides `tte-*`, no numeric routes, so routes 1-31 are unchanged) added 30 Oct 2026 from Dr Chew's TTE notes. Its 72 images are in `pocus/media/tte/` (webp; scanner times and dates masked). They come from echocardiographer.org and Bansal & Sengupta, Heart 2017; per-image credits and licences were not recorded, so they are not in `media-attributions.json`. Replace with licensed or own images when possible.
- RV part updated 30 Oct 2026 from Dr Chew's 30-minute RV teaching guide (SCCM RV deck, 2020): 30-minute running order on the `#part-rv` divider, window limits column, FAC worked example, T-wave landmark, closing line and five rehearsal questions on `#rv-patterns`. No new slides, clips or thresholds; values stay on ASE 2025.
