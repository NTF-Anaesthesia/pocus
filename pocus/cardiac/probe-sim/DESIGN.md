# Cardiac probe simulator: design

Status: draft, 30 Oct 2026. Owner: Dr Chew Shi Hao. Target: `pocus/cardiac/`, Part I (Acquisition), slides 5 to 10.

## What it is

A virtual phased-array probe on a photoreal chest. The learner drags it across the skin, twists it, tilts and rocks it,
and the ultrasound panel beside it shows the slice that pose would produce, beating. The five FoCUS views (PLAX, PSAX,
A4C, subcostal four-chamber, IVC) are targets: the simulator says how close the learner is and, on request, which single
movement would fix the view. The real clips already on the site appear beside the render whenever the learner reaches a
target, so the synthetic image is always anchored to a real one.

It replaces the shape-drawn schematics on the "Five windows", PLAX, PSAX, A4C, Subcostal and "Fix the view" slides.
Routes 1 to 31, slide ids and the e2e section order do not change.

## Why a 3D slice renderer

The windows slides teach one thing: the image is a slice, and the probe decides the slice. A schematic drawn per view
cannot show what happens between views. A renderer that evaluates a 3D anatomy along the actual scan plane shows the
LV foreshortening as the probe slides off the apex, the aortic valve leaving the plane as the probe rotates, the lung
curtain coming in as the probe moves lateral. Off-axis states are the lesson, and only a real slice gives them.

Generative images were rejected: they get cardiac anatomy wrong in ways a learner cannot detect. Real clips only were
rejected: we have real images only for correct views.

## Coordinate system and pose

- Torso frame: origin at the sternal notch, x to the patient's left, y caudal, z posterior (into the chest). Units cm.
- Probe pose: `{x, y}` skin position; `rot` (marker direction in the skin plane, degrees clockwise from the patient's
  right, so PLAX marker ≈ right shoulder ≈ 10 o'clock); `tilt` (fan the beam about the marker axis, ±40°); `rock`
  (heel-toe along the marker axis, ±30°); `pressure` (optional, flattens near-field fat).
- Scan plane: contains the probe contact point and the marker axis, rotated by tilt about that axis; the beam fans
  through ±42° (phased array) in the plane. Depth 4 to 20 cm, default 15 for cardiac and 20 for subcostal.
- Skin surface: a smooth height field over (x, y) (sternum ridge, costal margin, breast tissue optional) so the probe
  sits on the chest and the beam enters normal to the local surface plus tilt and rock.

## Anatomy model (signed distance fields)

Everything is an analytic SDF in the torso frame, so a point's tissue is a few function evaluations. The heart is
posed as in an adult supine with mild left lateral tilt: apex at about (−8, 14, 6) cm from the sternal notch, long axis
pointing inferior, left and anterior.

| Structure | Primitive | Echo class |
|---|---|---|
| LV cavity | ellipsoid (long axis 8 cm, short 4.5 cm at end-diastole) | blood |
| LV myocardium | shell 1.0 cm, thickens to 1.5 cm in systole | myocardium (speckled mid-grey) |
| Papillary muscles | two capsules inside the LV at mid-level | myocardium, brighter |
| RV | crescent: ellipsoid minus LV epicardium, wrapped anteriorly and right | blood; free wall 0.4 cm |
| Septum | shared wall; bows into the RV in systole; flattens under RV load (future) | myocardium |
| LA, RA | ellipsoids posterior and superior; RA continuous with IVC | blood; thin walls |
| Mitral valve | two thin leaflets hinged on the annulus, opening in diastole | specular, bright, thin |
| Tricuspid valve | same, annulus 0.8 cm more apical than mitral | specular |
| Aortic root and valve | tube 3 cm diameter from the LVOT, three cusps as thin shells | specular walls |
| Descending aorta | cylinder behind the LA, 2.5 cm | blood with bright wall |
| Pericardium | epicardial surface offset 0.2 cm; optional fluid layer (effusion) | strongly specular |
| Liver | large smooth solid below the diaphragm | fine homogeneous speckle |
| IVC, hepatic veins | cylinders into the RA; diameter and collapse animate with breathing | blood |
| Ribs and sternum | capsules on a rib cage surface, 1.2 cm wide, 2 cm apart | bone: bright front, total shadow behind |
| Lung | the volume lateral and superior to the cardiac notch, moving with breathing | air: bright line, reverberation, nothing behind |
| Chest wall | skin, fat, muscle layers from the surface height field | layered, mildly bright |

Cardiac cycle: one phase variable at the lecture's heart rate drives LV radial and longitudinal shortening, septal
motion, atrial filling, leaflet angles and annular descent (so TAPSE and MAPSE later come free). Breathing drives the
lung curtain, IVC calibre and heart position by a few millimetres.

Pathology hooks (not in release 1, but the model must not preclude them): effusion thickness, LV dilatation and EF,
RV dilatation and free-wall thickness, septal flattening phase, plethoric IVC. These are parameters on the SDFs, so the
RV patterns lab and the effusion slide can later drive the same renderer.

## Image formation

Per pixel of the sector (polar grid: beam angle × depth), walk the ray from the probe face to the pixel's depth:

1. Tissue lookup at the sample point from the SDFs; echogenicity base value per class.
2. Speckle: multiplicative noise, correlated along the beam (axial grain 0.4 mm) and across beams (lateral grain
   grows with depth as the beam widens); generated from a 3D hash of the torso-frame coordinates so it is stable while
   the heart moves through it, which is how real speckle behaves.
3. Specular term: where the ray crosses an interface (SDF sign change), brightness scales with |cos| of the angle
   between the ray and the surface normal, so pericardium and valve leaflets flash when perpendicular and fade when
   parallel. This is the single biggest contributor to looking real.
4. Attenuation: exponential with depth, compensated by a TGC curve; the far field stays slightly darker and noisier.
5. Shadowing: cumulative along the ray; bone stops the ray (bright edge, black behind); air gives a bright line, then
   repeated reverberations fading with depth, then black. Lateral resolution: a small blur across beams.
6. Near field: a bright reverberation band over the first 1 cm, as every real still shows.
7. Log compression and a gamma curve calibrated against the real stills; 70 dB dynamic range feel.
8. Sector geometry, scale marks every 5 cm, the probe marker dot at the apex, and the ECG trace reuse the existing
   `Sono` chrome so the panel matches the rest of the lecture.

Implementation: WebGL2 fragment shader (whole image per frame, 60 fps on a phone) with the SDFs and the ray walk in
GLSL; a 2D-canvas fallback at quarter resolution for contexts without WebGL. The cardiac phase, breathing phase and
pose are uniforms. The same shader renders the target-view stills for the PLAX, PSAX, A4C and subcostal slides.

## Calibration

Render each target pose and compare with the site's real stills (`media/a4c-normal.jpg`, `psax-normal.jpg`,
`sccm-rv/s06-plax-normal.jpg`, `s12-subcostal-4c-normal.jpg`, `s08-psax-aortic-level-normal-rv.jpg`,
`s11-a4c-rv-focused.jpg`): grey histogram, speckle grain size, pericardial brightness, chamber proportions, near-field
band. Iterate until a clinician cannot name the obvious giveaway. Keep a `calibration/` folder of side-by-side
contact sheets in the private pair, not here.

## Controls (phone first)

- Drag the probe with one finger or the mouse: skin position.
- Twist with two fingers, the mouse wheel, or the rotation slider: marker direction. Readout in o'clock.
- Tilt and rock: two sliders under the torso; arrow keys with modifiers on a keyboard.
- Buttons: `Snap to PLAX / PSAX / A4C / Subcostal / IVC` (teaching), `Walk me through` (animates one movement at a
  time from the current pose to the target, naming each), `Random start` (practice), `Hint` (names the single movement
  that most reduces the error, in the lecture's own words: "Move one rib space up", "Rotate towards the left shoulder").
- Target feedback: distance to target as a four-segment bar (window, plane, tilt, rock) and a tick when all four are
  within tolerance; on target, the matching real clip appears beside the render with its credit.

## The chest image

One neutral adult torso, supine, anterior chest from above, head at the top of the frame, soft even light, no face,
no identifying marks. Generated with the image tool and recorded in `media/README.md` as generated, no model release
needed. Surface landmarks (sternal notch, xiphoid, nipples, costal margins) are read off the image once and stored as
pixel coordinates in the torso frame; ribs are drawn as a faint overlay the learner can toggle.

## Files

```
pocus/cardiac/probe-sim/
  anatomy.glsl      SDFs and the cardiac cycle (included into the shader)
  render.glsl       ray walk, speckle, specular, attenuation, shadowing, compression
  sim.js            WebGL setup, uniforms, 2D fallback, frame loop
  probe.js          torso panel, pointer handling, pose, targets, scoring, hints
  index.html        unlisted dev page (noindex) for calibration and tests
pocus/media/torso-chest.webp
pocus/test/probe-sim.test.mjs   pose → tissue checks at known points, target scoring, shader compiles
```

The lecture includes `sim.js` and `probe.js` and mounts the simulator in the existing `.scanner` panels.

## Release plan

1. Vertical slice: PLAX only, WebGL renderer, drag and rotate, calibrated against the two PLAX stills. Review with a
   clinician before anything else is built.
2. All five windows, tilt and rock, targets, hints, walk-through; replace the five windows slide and the four view slides.
3. "Fix the view" cards driven by pose offsets instead of hand-drawn faults; real clip beside the render on target.
4. Pathology parameters exposed to the effusion slide and the RV patterns lab.
