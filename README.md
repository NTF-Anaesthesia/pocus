# pocus

The POCUS teaching site: point-of-care ultrasound lectures, simulations and cases for anaesthesia trainees (synthetic cases only), live at https://pocus.anantf.com. Static pages in `pocus/` (videos stay in git), served by this repo's own Cloudflare Worker (`pocus`). Split out of the NTF anaesthesia site repo (`anantf-site`) on 24 Oct 2026; `anantf.com/pocus/` forwards here.

- `pocus/`: the pages (hub, lectures, `media/` with attributions), `shared/`, `test/`, and the few site assets and fonts they need, all relative. See `pocus/README.md` for the lecture list and `pocus/REVIEW.md` for the review notes.
- `worker/`: the Worker (`routes.js` picks the folder, `sites.js` serves it) with Node tests.
- `tools/check.mjs`: repo checks. Run `node tools/check.mjs`.
- Deploy: `wrangler deploy` (GitHub Actions `deploy.yml` when the organisation secrets exist, otherwise run by a maintainer). Never Workers Builds.
