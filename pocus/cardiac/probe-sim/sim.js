/* Cardiac probe simulator: slice renderer.
   A parametric 3D heart in a torso, evaluated along the scan plane a probe pose defines, drawn as a beating sector image.
   WebGL2 fragment shader; the anatomy is signed distance fields. Nothing here is a real scan. See DESIGN.md. */
(() => {
'use strict';

const D2R = Math.PI / 180;
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/* Rotate v about unit axis k by angle a (Rodrigues). */
const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))); };

/* ---------- torso frame ----------
   Origin at the sternal notch. x to the patient's left, y caudal, z posterior (into the chest). Centimetres.
   The chest is an elliptic cylinder: half-width 15, anteroposterior half-depth 10, centre at z = 10. */
const CHEST = { a: 15, b: 10, cz: 10 };
function skinPoint(x, y) {
  const t = Math.max(-0.97, Math.min(0.97, x / CHEST.a));
  let z = CHEST.cz - CHEST.b * Math.sqrt(1 - t * t);
  /* below the costal margin the probe is pressed into the abdominal wall */
  const press = Math.min(1, Math.max(0, (y - 18.5) / 2)); z += 1.6 * press * press * (3 - 2 * press);
  /* inward normal of the ellipse at that lateral position */
  const n = norm([-(x / (CHEST.a * CHEST.a)) * 2, 0, -((z - CHEST.cz) / (CHEST.b * CHEST.b)) * 2]);
  if (n[2] < 0) return { p: [x, y, z], n: mul(n, -1) };
  return { p: [x, y, z], n };
}

/* ---------- heart frame ----------
   Long axis from the base (behind the 3rd costal cartilage) to the apex (5th space, mid-clavicular). */
const HEART = (() => {
  const base = [1.0, 8.5, 9.0], apex = [7.0, 14.5, 4.5];
  const e3 = norm([apex[0] - base[0], apex[1] - base[1], apex[2] - base[2]]);     // base → apex
  let e1 = [0, 0, -1];                                                              // anterior, made orthogonal
  e1 = norm(add(e1, mul(e3, -dot(e1, e3))));
  const e2 = cross(e3, e1);
  const centre = [(base[0] + apex[0]) / 2, (base[1] + apex[1]) / 2, (base[2] + apex[2]) / 2];
  return { e1, e2, e3, centre, base, apex };
})();

/* ---------- pose → scan plane ----------
   pose: {x, y} skin position (cm), rot marker direction (degrees clockwise from the patient's right, seen from the
   front, so 0 points to the patient's right, 90 to the head, 180 to the patient's left, 270 to the feet),
   tilt fans the beam about the marker axis, rock heels the beam along the marker axis. */
function planeFor(pose) {
  const s = skinPoint(pose.x, pose.y);
  const n = s.n;
  /* tangent basis on the skin: right (toward −x) and head (toward −y) */
  let right = norm(add([-1, 0, 0], mul(n, -dot([-1, 0, 0], n))));
  const head = norm(cross(n, right));
  const a = pose.rot * D2R;
  const marker = norm(add(mul(right, Math.cos(a)), mul(head, Math.sin(a))));   // marker axis in the skin plane
  const across = cross(n, marker);                                              // perpendicular to the plane
  let beam = rot(n, marker, pose.tilt * D2R);                                    // tilt: fan about the marker axis
  let lat = marker;
  const rk = pose.rock * D2R;                                                    // rock: swing within the plane
  const beam2 = rot(beam, across, rk), lat2 = rot(lat, across, rk);
  return { origin: s.p, beam: beam2, lat: lat2, across };
}

/* ---------- shader ---------- */
const VERT = `#version 300 es
in vec2 a; out vec2 v; void main(){ v = a; gl_Position = vec4(a, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform vec2 u_res; uniform float u_time, u_phase, u_breath, u_depth, u_sector, u_gain, u_effusion, u_rvdil, u_lvef;
uniform vec3 u_origin, u_beam, u_lat;
uniform vec3 u_he1, u_he2, u_he3, u_hc;
uniform int u_debug;
/* labelled heart volume (optional): replaces the parametric heart when u_hasVol == 1 */
uniform int u_hasVol; uniform highp sampler3D u_vol; uniform highp sampler3D u_volSdf;
uniform vec3 u_volSize, u_volOrigin, u_volLvC, u_volAxis, u_raCentre; uniform mat3 u_volR; uniform float u_volSpacing, u_volSdfRange;

/* ----- labelled heart volume ----- */
/* torso cm → volume mm, with the cardiac cycle applied as a deformation of the lookup point */
vec3 volCoord(vec3 p, float c){
  vec3 v = (transpose(u_volR) * (p - u_volOrigin)) * 10.0;                  // volume mm
  vec3 d = v - u_volLvC; float along = dot(d, u_volAxis);                     // + towards the apex
  float vent = smoothstep(-18.0, 8.0, along);                                 // ventricles beyond the valve plane
  vec3 radial = d - u_volAxis * along;
  float rs = 1.0 + 0.16 * c * vent - 0.05 * c * (1.0 - vent);                // systole: ventricles smaller, atria larger
  float ls = 1.0 + 0.10 * c * vent;                                          // and the base descends towards the apex
  return u_volLvC + radial * rs + u_volAxis * (along * ls);
}
bool inVol(vec3 v){ vec3 t = v / (u_volSpacing * u_volSize); return all(greaterThan(t, vec3(0.0))) && all(lessThan(t, vec3(1.0))); }
int volLabel(vec3 v){ vec3 t = (v / u_volSpacing + 0.5) / u_volSize; return int(texture(u_vol, t).r * 255.0 + 0.5); }
float volSdf(vec3 v){ vec3 t = (v / u_volSpacing + 0.5) / u_volSize; return (texture(u_volSdf, t).r * 255.0 - 128.0) / 127.0 * u_volSdfRange * 0.1; }   // cm, negative in blood
/* tissue id for a volume label; valves exist while closed, otherwise they are blood */
int volTissue(int l, float mo){
  if (l == 1 || l == 11) return 1;
  if (l == 2 || l == 3 || l == 4 || l == 5 || l == 8 || l == 10 || l == 6 || l == 7) return 0;
  if (l == 12) return 9;
  if (l == 13 || l == 14) return mo > 0.35 ? 0 : 2;
  if (l == 15) return 3;
  if (l == 16) return 5;
  return -2; }


/* ----- helpers ----- */
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }

/* ----- cardiac cycle (phase 0 = QRS, end-diastole) ----- */
float smoothc(float t){ t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float bump(float x, float c, float w){ float d = (x - c) / w; return abs(d) >= 1.0 ? 0.0 : 0.5 + 0.5 * cos(3.14159265 * d); }
float contraction(float ph){ return ph < 0.32 ? smoothc(ph / 0.32) : ph < 0.46 ? 1.0 - smoothc((ph - 0.32) / 0.14) : 0.0; }
float mitralOpen(float ph){ return clamp(bump(ph, 0.58, 0.12) + 0.6 * bump(ph, 0.88, 0.08), 0.0, 1.0); }
float aorticOpen(float ph){ return (ph > 0.05 && ph < 0.34) ? pow(sin(3.14159265 * (ph - 0.05) / 0.29), 0.35) : 0.0; }

/* ----- anatomy in the heart frame: x toward the RV (anterior-right), z toward the apex ----- */
struct Tis { float sd; int id; };   // id: 0 blood, 1 myocardium, 2 valve, 3 pericardium, 4 liver, 5 fat/muscle, 6 bone, 7 lung, 8 skin, 9 vessel wall
vec3 toHeart(vec3 p){ vec3 d = p - u_hc; return vec3(dot(d, u_he1), dot(d, u_he2), dot(d, u_he3)); }

/* LV cavity and wall */
float lvRad(float c){ float fs = 0.12 + 0.18 * u_lvef; return 2.25 * (1.0 - fs * c); }        // radial shortening scales with EF
float lvLen(float c){ return 4.0 * (1.0 - 0.10 * c); }
vec3 taper(vec3 q, float l){ float t = clamp(q.z / l, 0.0, 1.0); q.xy /= (1.0 - 0.28 * t * t); return q; }
float sdLVcav(vec3 h, float c){ float r = lvRad(c), l = lvLen(c); vec3 q = h; q.z += 0.3; q = taper(q, l); return sdEllipsoid(q, vec3(r, r, l)); }
float sdLVepi(vec3 h, float c){ float w = 1.0 + 0.45 * c; float r = lvRad(c) + w, l = lvLen(c) + 0.6; vec3 q = h; q.z += 0.3; q = taper(q, l); return sdEllipsoid(q, vec3(r, r, l)); }
/* RV: a crescent wrapped around the LV, anterior-right */
vec3 rvC(float g){ return vec3(0.9 * g, 0.9 * g, -0.5); }
float sdRVouter(vec3 h, float c){ float g = 1.0 + 0.35 * u_rvdil; vec3 q = h - rvC(g); float s = 1.0 - 0.06 * c; return max(sdEllipsoid(q, vec3(2.9 * g, 2.9 * g, 4.1) * s), -0.3 - dot(h, normalize(vec3(1.0, 1.0, 0.0)))); }
float sdRVcav(vec3 h, float c){ float g = 1.0 + 0.35 * u_rvdil; vec3 q = h - rvC(g); float s = 1.0 - 0.06 * c; float wall = 0.4 + 0.1 * c; return max(max(sdEllipsoid(q, vec3(2.9 * g, 2.9 * g, 4.1) * s - wall), -(sdLVepi(h, c) + 0.05)), 0.1 - dot(h, normalize(vec3(1.0, 1.0, 0.0)))); }
/* atria beyond the base (negative z) */
float sdLA(vec3 h, float c){ vec3 q = h - vec3(-1.3, -0.4, -6.3); return sdEllipsoid(q, vec3(1.9, 2.1, 1.9) * (1.0 + 0.08 * c)); }
float sdRA(vec3 h, float c){ vec3 q = h - vec3(1.2, 2.4, -5.9); return sdEllipsoid(q, vec3(1.9, 1.9, 1.8) * (1.0 + 0.06 * c)); }
/* aortic root from the LVOT, anterior and basal */
vec3 aoA(){ return vec3(0.9, 0.2, -3.5); } vec3 aoB(){ return vec3(3.4, 0.6, -7.8); }
float sdAoLumen(vec3 h){ return sdCapsule(h, aoA(), aoB(), 1.35); }
float sdAoWall(vec3 h){ return sdCapsule(h, aoA(), aoB(), 1.55); }
/* aortic cusps: a thin disc 1.4 cm along the root; open cusps lie against the wall */
float sdAV(vec3 h, float open){ vec3 a = aoA(), b = aoB(); vec3 ax = normalize(b - a); vec3 q = h - (a + ax * 1.4); float along = dot(q, ax); vec3 rad = q - ax * along; float rr = length(rad);
  float closed = max(abs(along) - 0.05, rr - 1.35);                       // closed: a disc
  float opened = max(abs(along + 0.6 * (rr / 1.35)) - 0.06, max(rr - 1.35, 0.95 - rr)); // open: cusps swept to the wall
  return mix(closed, opened, open); }
/* mitral leaflets hinged on the annulus at z = -3.9 */
float leaflet(vec3 h, vec3 hinge, vec3 dirClosed, vec3 dirOpen, float len, float open){ vec3 d = normalize(mix(dirClosed, dirOpen, open)); vec3 q = h - hinge;
  vec3 w = vec3(0.0, 1.0, 0.0); vec3 n = normalize(cross(d, w));            // along, across, normal
  return sdBox(vec3(dot(q, d) - len * 0.5, dot(q, w), dot(q, n)), vec3(len * 0.5, 1.2, 0.03)); }
float sdMV(vec3 h, float open){
  vec3 ant = vec3(1.0, 0.0, -3.9), post = vec3(-2.0, 0.0, -3.9);
  float a = leaflet(h, ant, normalize(vec3(-1.0, 0.0, 0.35)), normalize(vec3(-0.25, 0.0, 1.0)), 2.6, open);
  float b = leaflet(h, post, normalize(vec3(1.0, 0.0, 0.35)), normalize(vec3(0.35, 0.0, 1.0)), 1.5, open);
  return min(a, b); }
/* tricuspid leaflets, more apical annulus */
float sdTV(vec3 h, float open){ vec3 ant = vec3(3.0, 3.2, -3.1), sep = vec3(0.6, 0.9, -3.1);
  float a = leaflet(h, ant, normalize(vec3(-1.0, 0.0, 0.3)), normalize(vec3(-0.2, 0.0, 1.0)), 2.2, open);
  float b = leaflet(h, sep, normalize(vec3(1.0, 0.0, 0.3)), normalize(vec3(0.2, 0.0, 1.0)), 1.6, open);
  return min(a, b); }
float sdPap(vec3 h, float c){ float s = 1.0 - 0.15 * c; vec3 a = vec3(0.3, 1.2, 0.3) * s, b = vec3(-1.0, -1.1, 0.3) * s; return min(sdCapsule(h, a, a + vec3(0.0, 0.0, 2.0), 0.45), sdCapsule(h, b, b + vec3(0.0, 0.0, 2.0), 0.45)); }
float sdHeartOuter(vec3 h, float c){ return min(min(sdLVepi(h, c), sdRVouter(h, c)), min(min(sdLA(h, c) - 0.25, sdRA(h, c) - 0.25), sdAoWall(h))); }

/* ----- torso-frame structures ----- */
float chestR(vec3 p, float inset){ vec2 q = vec2(p.x / (15.0 - inset), (p.z - 10.0) / (10.0 - inset)); return (length(q) - 1.0) * (10.0 - inset); }  // ≈ cm, <0 inside the (shrunken) chest ellipse
float sdSternum(vec3 p){ return sdBox(p - vec3(0.0, 8.75, 2.2), vec3(1.6, 8.75, 0.6)); }
float sdRibs(vec3 p){ float surf = abs(chestR(p, 2.0)) - 0.4;          // a band on the rib-cage surface
  float along = p.y + 0.18 * abs(p.x) + 0.1 * sin(p.x * 0.5); float band = abs(fract(along / 2.3) - 0.5) * 2.3 - 0.65;
  float r = max(surf, band); r = max(r, 1.3 - abs(p.x));                       // no ribs under the sternum
  return max(r, -(p.y - 1.5)); }
float isBoneRib(vec3 p){ float edge = 7.0 + 0.5 * max(p.y - 8.0, 0.0) + 0.6 * sin(p.y * 1.7); return smoothstep(edge - 1.5, edge + 1.5, abs(p.x)); }   // costal cartilage gives way to bone laterally   // 1 where ribs are bone, 0 over costal cartilage
float sdSpine(vec3 p){ return sdCapsule(p, vec3(0.0, -2.0, 17.8), vec3(0.0, 40.0, 17.8), 1.6); }
float sdLiver(vec3 p){ vec3 q = p - vec3(-4.0, 21.5, 5.5); return sdEllipsoid(q, vec3(12.0, 8.0, 6.5)); }
vec3 raCentreWorld(){ return u_hasVol == 1 ? u_raCentre : u_hc + u_he1 * 1.2 + u_he2 * 2.4 + u_he3 * (-5.9); }
float ivcR(){ return 1.05 - 0.35 * u_breath; }
float sdIVC(vec3 p){ vec3 a = raCentreWorld() + vec3(0.0, 1.2, 0.3); return sdCapsule(p, a, a + vec3(-0.5, 20.0, 2.0), ivcR()); }
float sdHepVein(vec3 p){ vec3 a = raCentreWorld() + vec3(-0.5, 3.0, 0.6); return sdCapsule(p, a, a + vec3(-4.0, 3.0, 2.5), 0.45); }
float sdDescAo(vec3 p){ return sdCapsule(p, vec3(1.5, -2.0, 12.8), vec3(1.5, 30.0, 12.8), 1.15); }
float sdLung(vec3 p, float c){
  float cavity = chestR(p, 2.8);                                              // inside the rib cage
  cavity = max(cavity, 1.5 - p.y);                                            // apex of the lung
  float dome = 17.5 - 4.0 * exp(-pow((abs(p.x) - 8.0) / 5.0, 2.0)) - 3.0 * (1.0 - smoothstep(0.0, 8.0, p.z));   // hemidiaphragm domes laterally; the lung base sits higher anteriorly
  cavity = max(cavity, p.y - dome);
  float heart = sdHeartOuter(toHeart(p), c) + 0.7;                             // the heart and pericardial fat exclude lung
  if (u_hasVol == 1) { vec3 vq = volCoord(p, c); heart = (inVol(vq) && volLabel(vq) > 0) ? -1.0 : 1.0; }
  vec2 nq = vec2((p.x - 3.0) / (6.0 - 1.5 * u_breath), (p.y - 12.5) / 6.5);   // cardiac notch: no lung in front of or below the heart
  float notch = max((length(nq) - 1.0) * 6.0, p.z - 5.5);
  float medi = sdBox(p - vec3(0.5, 9.0, 11.0), vec3(2.6, 9.5, 3.5));          // posterior mediastinum: oesophagus and aorta; lung wraps behind, into the gutters
  return max(max(cavity, -heart), max(-notch, -medi)); }

float sdLungCheap(vec3 p, float c){
  float cavity = chestR(p, 2.8); cavity = max(cavity, 1.5 - p.y);
  float dome = 17.5 - 4.0 * exp(-pow((abs(p.x) - 8.0) / 5.0, 2.0)) - 3.0 * (1.0 - smoothstep(0.0, 8.0, p.z)); cavity = max(cavity, p.y - dome);
  vec3 h = toHeart(p); float heart = min(sdLVepi(h, c), sdRVouter(h, c)) + 0.9;
  if (u_hasVol == 1) { vec3 vq = volCoord(p, c); heart = (inVol(vq) && volLabel(vq) > 0) ? -1.0 : 1.0; }
  vec2 nq = vec2((p.x - 3.0) / (6.0 - 1.5 * u_breath), (p.y - 12.5) / 6.5); float notch = max((length(nq) - 1.0) * 6.0, p.z - 5.5);
  float medi = sdBox(p - vec3(0.5, 9.0, 11.0), vec3(2.6, 9.5, 3.5));
  return max(max(cavity, -heart), max(-notch, -medi)); }

/* ----- classify a point ----- */
Tis classify(vec3 p, float c, float mo, float ao){
  Tis t; t.id = 5; t.sd = 1e3;
  float skin = -chestR(p, 0.0);                                               // >0 inside the body
  if (skin < 0.0) { t.id = -1; return t; }
  if (skin < 0.3) { t.id = 8; return t; }
  if (sdSternum(p) < 0.0 || sdSpine(p) < 0.0) { t.id = 6; return t; }
  if (sdRibs(p) < 0.0) { t.id = isBoneRib(p) > 0.5 ? 6 : 10; return t; }
  if (u_hasVol == 1) { vec3 vq = volCoord(p, c); if (inVol(vq)) { int vt = volTissue(volLabel(vq), mo); if (vt >= 0) { t.id = vt; return t; } }
    if (sdIVC(p) < 0.0 || sdHepVein(p) < 0.0 || sdDescAo(p) < 0.0) { t.id = 0; return t; }
    if (sdLiver(p) < 0.0) { t.id = 4; return t; }
    if (sdLung(p, c) < 0.0) { t.id = 7; return t; }
    return t; }
  vec3 h = toHeart(p);
  float peri = sdHeartOuter(h, c);
  float valves = min(min(sdMV(h, mo), sdTV(h, mo)), sdAV(h, ao));
  if (valves < 0.0) { t.id = 2; return t; }
  if (sdLVcav(h, c) < 0.0 && sdPap(h, c) > 0.0) { t.id = 0; return t; }
  if (sdAoLumen(h) < 0.0) { t.id = 0; return t; }
  if (sdLVepi(h, c) < 0.0) { t.id = 1; return t; }
  if (sdRVcav(h, c) < 0.0) { t.id = 0; return t; }
  if (sdRVouter(h, c) < 0.0) { t.id = 1; return t; }
  if (sdLA(h, c) < 0.0 || sdRA(h, c) < 0.0) { t.id = 0; return t; }
  if (sdLA(h, c) < 0.25 || sdRA(h, c) < 0.25 || sdAoWall(h) < 0.0) { t.id = 9; return t; }
  if (peri < 0.2 + u_effusion) { t.id = (peri < 0.2 + u_effusion && u_effusion > 0.05 && peri > 0.2) ? 0 : 3; return t; }
  if (sdIVC(p) < 0.0 || sdHepVein(p) < 0.0 || sdDescAo(p) < 0.0) { t.id = 0; return t; }
  if (sdLiver(p) < 0.0) { t.id = 4; return t; }
  if (sdLung(p, c) < 0.0) { t.id = 7; return t; }
  return t; }

float echoOf(int id){ return id == 0 ? 0.012 : id == 1 ? 0.5 : id == 2 ? 0.55 : id == 3 ? 0.95 : id == 4 ? 0.5 : id == 5 ? 0.26 : id == 6 ? 0.95 : id == 7 ? 0.0 : id == 8 ? 0.5 : id == 9 ? 0.5 : id == 10 ? 0.22 : 0.0; }

/* ----- specular surfaces: pericardium, valves, vessel walls, diaphragm ----- */
float specField(vec3 p, float c, float mo, float ao){ vec3 h = toHeart(p);
  float s;
  if (u_hasVol == 1) { vec3 vq = volCoord(p, c); s = inVol(vq) ? abs(volSdf(vq)) : 1e3; int l = inVol(vq) ? volLabel(vq) : 0; if (l == 15) s = min(s, 0.02); }
  else s = abs(sdHeartOuter(h, c) - 0.2 - u_effusion);                         // pericardium
  if (u_hasVol == 0) {
  s = min(s, abs(min(min(sdMV(h, mo), sdTV(h, mo)), sdAV(h, ao))));
  s = min(s, abs(sdAoWall(h)) * 1.2);
  s = min(s, abs(sdLVcav(h, c)) * 4.0 + 0.04); }                               // endocardium, weak and fuzzy
  s = min(s, abs(sdLiver(p)) * 1.4); s = min(s, abs(sdIVC(p)) * 1.3); s = min(s, abs(sdDescAo(p)) * 1.3);
  s = min(s, abs(chestR(p, 0.0) + 0.9) * 1.5);                                 // fascia under the subcutaneous fat
  s = min(s, abs(sdRibs(p)) * 1.2 + 0.4 * isBoneRib(p));                       // cartilage edges
  return s; }
/* signed distance of the surface nearest p, so its gradient is a true normal */
float nearestSigned(vec3 p, float c, float mo, float ao){ vec3 h = toHeart(p);
  float best, bd;
  if (u_hasVol == 1) { vec3 vq = volCoord(p, c); best = inVol(vq) ? volSdf(vq) : 1e3; bd = abs(best); }
  else { best = sdHeartOuter(h, c) - 0.2 - u_effusion; bd = abs(best); }
  float d;
  if (u_hasVol == 0) {
  d = min(min(sdMV(h, mo), sdTV(h, mo)), sdAV(h, ao)); if (abs(d) < bd) { bd = abs(d); best = d; }
  d = sdAoWall(h); if (abs(d) * 1.2 < bd) { bd = abs(d) * 1.2; best = d; }
  d = sdLVcav(h, c); if (abs(d) * 4.0 + 0.04 < bd) { bd = abs(d) * 4.0 + 0.04; best = d; } }
  d = sdLiver(p); if (abs(d) * 1.4 < bd) { bd = abs(d) * 1.4; best = d; }
  d = sdIVC(p); if (abs(d) * 1.3 < bd) { bd = abs(d) * 1.3; best = d; }
  d = sdDescAo(p); if (abs(d) * 1.3 < bd) { bd = abs(d) * 1.3; best = d; }
  d = chestR(p, 0.0) + 0.9; if (abs(d) * 1.5 < bd) { bd = abs(d) * 1.5; best = d; }
  d = sdRibs(p); if (abs(d) * 1.2 + 0.4 * isBoneRib(p) < bd) { bd = abs(d) * 1.2 + 0.4 * isBoneRib(p); best = d; }
  return best; }
vec3 specNormal(vec3 p, float c, float mo, float ao, float s0){ float e = 0.03; float s1 = nearestSigned(p, c, mo, ao); vec3 g = vec3(
  nearestSigned(p + vec3(e,0,0), c, mo, ao) - s1, nearestSigned(p + vec3(0,e,0), c, mo, ao) - s1, nearestSigned(p + vec3(0,0,e), c, mo, ao) - s1); return normalize(g + 1e-5); }

/* Pass 1: the scatterer field on a polar grid. x → beam angle, y → depth.
   Each texel holds one complex scatterer (strength and random phase, tissue-locked), the local specular reflectivity
   and a debug tissue id. Transmission losses from bone and lung are applied to the scatterer strength here. */
void main(){
  float ang = (v.x) * u_sector;                                               // v.x in −1..1
  float r = (v.y * 0.5 + 0.5) * u_depth;                                      // cm
  float c = contraction(u_phase), mo = mitralOpen(u_phase), ao = aorticOpen(u_phase);
  vec3 dir = normalize(u_beam * cos(ang) + u_lat * sin(ang));
  vec3 p = u_origin + dir * r;

  Tis t = classify(p, c, mo, ao);
  if (u_debug == 1) { vec3 col = vec3(0.0);
    if (t.id == 0) col = vec3(0.1, 0.15, 0.6); else if (t.id == 1) col = vec3(0.8, 0.2, 0.2); else if (t.id == 2) col = vec3(1.0, 0.9, 0.2);
    else if (t.id == 3) col = vec3(0.9, 0.3, 0.9); else if (t.id == 4) col = vec3(0.55, 0.35, 0.15); else if (t.id == 5) col = vec3(0.75, 0.65, 0.5);
    else if (t.id == 6) col = vec3(1.0); else if (t.id == 7) col = vec3(0.2, 0.85, 0.9); else if (t.id == 8) col = vec3(1.0, 0.7, 0.75); else if (t.id == 9) col = vec3(1.0, 0.55, 0.1); else if (t.id == 10) col = vec3(0.6, 0.8, 0.6);
    o = vec4(col, 1.0); return; }

  /* scatterer strength: tissue echogenicity, modulated at the centimetre scale, and the scatterer density per tissue */
  float strength = echoOf(t.id);
  float slow = 0.75 + 0.5 * vnoise(p * 0.8 + 3.0);
  float density = t.id == 4 ? 1.0 : t.id == 5 ? 0.6 : t.id == 1 ? 0.85 : t.id == 0 ? 0.9 : 0.8;

  /* material coordinates: cardiac tissue carries its speckle through the cycle; blood decorrelates every frame */
  vec3 m = p;
  bool cardiac = (t.id == 0 || t.id == 1 || t.id == 2 || t.id == 3 || t.id == 9);
  if (cardiac) { if (u_hasVol == 1) m = volCoord(p, c) * 0.1 + 100.0; else { vec3 h = toHeart(p); m = vec3(h.xy * (1.0 + 0.25 * c), h.z * (1.0 + 0.08 * c)) + 100.0; } }
  if (t.id == 0) m += vec3(0.0, 0.0, u_time * 37.0);
  vec3 cell = floor(m / 0.015);                                                // 0.15 mm scatterer cells
  float a1 = hash(cell), a2 = hash(cell + 17.0), a3 = hash(cell + 41.0);
  float amp = strength * slow * (0.35 + 0.65 * (a1 + hash(cell + 7.0))) * mix(0.7, 1.0, density);   // dense scatterers, mild amplitude spread
  float phase = 6.2831853 * a2;

  /* specular reflectivity: interfaces that face the beam reflect it, those edge-on do not */
  float sf = specField(p, c, mo, ao), spec = 0.0;
  if (sf < 0.3) { vec3 n = specNormal(p, c, mo, ao, sf); float f = exp(-(sf * sf) / (2.0 * 0.09 * 0.09)); float cosI = abs(dot(n, dir)); float refl = f * (0.02 + 0.8 * pow(cosI, 3.0)) * (0.4 + 1.2 * a1 * a3); spec = refl * 0.35; amp += refl * 0.9; }

  /* transmission: bone and lung along the ray */
  float lungAt = -1.0, boneAt = -1.0, boneMin = 1e3, lungMin = 1e3;
  for (int i = 1; i <= 22; i++) { float sdist = (r - 0.2) * float(i) / 22.0; if (sdist <= 0.0) break; vec3 ps = u_origin + dir * sdist;
    float bb = min(sdSternum(ps), sdRibs(ps) + 2.0 * (1.0 - isBoneRib(ps))); if (bb < boneMin) { boneMin = bb; if (bb < 0.0 && boneAt < 0.0) boneAt = sdist; }
    float l = sdLungCheap(ps, c); if (l < lungMin) { lungMin = l; if (l < 0.0 && lungAt < 0.0) lungAt = sdist; } }
  float shadow = 1.0 - smoothstep(-0.35, 0.2, boneMin);
  float lungShadow = (1.0 - smoothstep(-0.3, 0.15, lungMin)) * 0.92;
  shadow = max(shadow, lungShadow);
  float trans = 1.0 - shadow;
  /* reverberation behind the pleura: faint copies of the near field at multiples of the pleural depth */
  float reverb = 0.0;
  if (lungAt > 0.0) { float k = (r - lungAt) / max(lungAt, 0.5); reverb = lungShadow * 0.5 * exp(-k * 1.6) * (0.15 + 0.85 * bump(fract(k + 0.5), 0.5, 0.1)); }
  /* the pleural line and bone surfaces are strong reflectors; nothing returns from inside them */
  if (t.id == 7) { float ls = -sdLung(p, c); amp = 0.0; spec = ls < 0.15 ? 1.0 * (0.6 + 0.8 * a1) : 0.0; }
  if (t.id == 6) { float bs = -min(min(sdSternum(p), sdSpine(p)), sdRibs(p)); amp = 0.0; spec = bs < 0.15 ? 0.7 * (0.5 + 0.8 * a1) : 0.0; }
  amp = amp * trans + reverb * (0.3 + 1.2 * a1 * a1);
  if (r < 0.9) amp += (0.9 - r) / 0.9 * 0.3 * (0.5 + 1.0 * a1);               // near-field reverberation band
  spec *= trans;

  /* encode: complex scatterer in RG (signed, offset), reflectivity in B, tissue id in A */
  float sx = clamp(amp * cos(phase) * 0.45, -0.5, 0.5), sy = clamp(amp * sin(phase) * 0.45, -0.5, 0.5);
  o = vec4(sx + 0.5, sy + 0.5, clamp(spec * 0.5, 0.0, 1.0), float(t.id + 1) / 12.0);
}`;

/* Pass 2: image formation. Every screen pixel inside the sector sums the scatterers around it through the pulse's
   point-spread function (a short axial wave packet, a lateral beam that widens with depth) with their phases, which is
   what makes speckle: the grain is the interference pattern, not a texture. Reflectivity is added incoherently. */
const FRAG_IMAGE = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D u_field; uniform vec2 u_res, u_fieldRes;
uniform float u_depth, u_sector, u_gain; uniform int u_debug;
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 px = (v * 0.5 + 0.5) * u_res;
  vec2 apex = vec2(u_res.x * 0.5, u_res.y - 10.0);
  float R = u_res.y - 18.0;
  vec2 dd = vec2(px.x - apex.x, apex.y - px.y);
  float dist = length(dd); float ang = atan(dd.x, dd.y);
  if (dist > R || abs(ang) > u_sector || dd.y < 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float r = dist / R * u_depth;
  vec2 uv = vec2(ang / (2.0 * u_sector) + 0.5, r / u_depth);
  if (u_debug == 1) { o = vec4(texture(u_field, uv).rgb, 1.0); return; }

  float dr = u_depth / u_fieldRes.y;                                           // cm per axial texel
  float dth = 2.0 * u_sector / u_fieldRes.x;                                   // rad per beam
  const float K = 2.0 * 3.14159265 / 0.064;                                    // carrier: one cycle per 0.64 mm
  float sigA = 0.055;                                                          // axial pulse length (cm)
  float sigL = max(0.06, 2.2 * dth * r);                                       // lateral beam width (cm): about two beams, so it widens with depth
  const float K2 = 2.0 * 3.14159265 / 0.082;                                   // second carrier for frequency compounding
  float re = 0.0, im = 0.0, re2 = 0.0, im2 = 0.0, spec = 0.0, wsum = 0.0;
  for (int j = -5; j <= 5; j++) {
    float dl = float(j) * dth * r; float wl = exp(-dl * dl / (2.0 * sigL * sigL));
    if (wl < 0.02) continue;
    for (int i = -10; i <= 10; i++) {
      float dz = float(i) * dr; float wa = exp(-dz * dz / (2.0 * sigA * sigA));
      vec4 f = texture(u_field, uv + vec2(float(j) / u_fieldRes.x, float(i) / u_fieldRes.y));
      vec2 sc = (f.rg - 0.5) / 0.45;
      float w = wa * wl, ck = cos(K * dz), sk = sin(K * dz);
      re += w * (sc.x * ck - sc.y * sk); im += w * (sc.x * sk + sc.y * ck);
      float ck2 = cos(K2 * dz), sk2 = sin(K2 * dz); re2 += w * (sc.x * ck2 - sc.y * sk2); im2 += w * (sc.x * sk2 + sc.y * ck2);
      spec += w * f.b * 2.0; wsum += w;
    }
  }
  float env = (length(vec2(re, im)) + length(vec2(re2, im2))) * 0.5 / max(wsum, 1e-3) * 2.6;   // compounded speckle envelope
  float I = env + spec / max(wsum, 1e-3) * 0.7;
  /* depth attenuation with TGC, gain, electronic noise */
  float tgc = exp(-0.08 * r) * (1.0 + 0.08 * r);
  I = I * tgc * u_gain + 0.01 * hash2(px);
  /* log compression and display curve */
  float y = log(1.0 + 45.0 * I) / log(46.0);
  y = pow(clamp(y, 0.0, 1.0), 1.25);
  y *= 1.0 - 0.3 * pow(abs(ang) / u_sector, 6.0);
  o = vec4(vec3(y) * vec3(0.96, 0.98, 1.0), 1.0);
}`;


/* ---------- renderer ---------- */
class SliceRenderer {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.W = opts.w || 440; this.H = opts.h || 340;
    this.dpr = Math.min(opts.dpr || 1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(this.W * this.dpr); canvas.height = Math.round(this.H * this.dpr);
    canvas.style.width = this.W + 'px'; canvas.style.height = this.H + 'px';
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    this.gl = gl; this.ok = !!gl;
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = (fs) => { const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)); return prog; };
    this.pField = program(FRAG); this.pImage = program(FRAG_IMAGE);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const prog of [this.pField, this.pImage]) { const loc = gl.getAttribLocation(prog, 'a'); gl.useProgram(prog); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    const U = (prog, names) => { const u = {}; for (const n of names) u[n] = gl.getUniformLocation(prog, n); return u; };
    this.uF = U(this.pField, ['u_res', 'u_time', 'u_phase', 'u_breath', 'u_depth', 'u_sector', 'u_gain', 'u_effusion', 'u_rvdil', 'u_lvef', 'u_origin', 'u_beam', 'u_lat', 'u_he1', 'u_he2', 'u_he3', 'u_hc', 'u_debug', 'u_hasVol', 'u_vol', 'u_volSdf', 'u_volSize', 'u_volOrigin', 'u_volLvC', 'u_volAxis', 'u_raCentre', 'u_volR', 'u_volSpacing', 'u_volSdfRange']);
    this.uI = U(this.pImage, ['u_field', 'u_res', 'u_fieldRes', 'u_depth', 'u_sector', 'u_gain', 'u_debug']);
    /* the scatterer field: beams across, depth samples down */
    this.FW = opts.beams || 320; this.FH = opts.samples || 1024;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.FW, this.FH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.tex = tex; this.fbo = fbo;
    this.params = { depth: 16, sector: 42, gain: 1, effusion: 0, rvdil: 0, lvef: 0.6, hr: 72, breath: 0, debug: 0 };
    this.vol = null;
  }
  /* Load a labelled heart volume (made by tools/heart-volume.py) and place it in the torso by its LV axis. */
  async loadVolume(dir) {
    const gl = this.gl; if (!gl) return false;
    const meta = await (await fetch(dir + '/heart-volume.json')).json();
    const [nx, ny, nz] = meta.size, [cols] = meta.tiles;
    const detile = async (file) => {
      const img = new Image(); img.src = dir + '/' + file; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, out = new Uint8Array(nx * ny * nz);
      for (let z = 0; z < nz; z++) { const r = Math.floor(z / cols), c = z % cols;
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) out[x + nx * (y + ny * z)] = px[((r * ny + y) * W + (c * nx + x)) * 4]; }
      return out;
    };
    const [labels, sdf] = await Promise.all([detile('heart-labels.png'), detile('heart-sdf.png')]);
    const tex3 = (data, filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, nx, ny, nz, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE); return t; };
    const labelTex = tex3(labels, gl.NEAREST), sdfTex = tex3(sdf, gl.LINEAR);
    /* orientation: the volume's LV axis goes to the torso heart axis; the LV→RV direction to the torso RV direction */
    const lvC = meta.lv_centre_mm, axis = norm(meta.lv_axis);
    const rvC = meta.centroids_mm['5'] || lvC, laC = meta.centroids_mm['2'] || lvC;
    let rvDir = add(rvC, mul(lvC, -1)); rvDir = norm(add(rvDir, mul(axis, -dot(rvDir, axis))));
    const vF = [rvDir, cross(axis, rvDir), axis];                                     // volume frame columns
    const tRv = norm(add(mul(HEART.e1, 1.1), mul(HEART.e2, 1.0)));
    const tF = [tRv, cross(HEART.e3, tRv), HEART.e3];                                  // torso heart frame columns
    /* R maps volume directions to torso directions: R = tF · vFᵀ (column-major mat3 for GL) */
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i][j] += tF[k][i] * vF[k][j];
    const Rv = v => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
    const origin = add(HEART.centre, mul(Rv(lvC), -0.1));                          // LV centre sits at the torso heart centre
    const raC = meta.centroids_mm['4'] ? add(origin, mul(Rv(meta.centroids_mm['4']), 0.1)) : null;
    this.vol = { meta, labelTex, sdfTex, origin, R, lvC, axis, raC, size: [nx, ny, nz] };
    /* the torso heart frame now follows the volume: base and apex from the LV length along its axis */
    const lvLen = Math.sqrt(labels.filter((v, i) => v === 3).length) * 0; void lvLen;
    HEART.base = add(origin, mul(Rv(add(lvC, mul(axis, -45))), 0.1)); HEART.apex = add(origin, mul(Rv(add(lvC, mul(axis, 40))), 0.1));
    return true;
  }
  /* Draw one frame for a pose at a cardiac phase (0..1) and time (s). */
  draw(pose, phase, time, breath = 0) {
    const gl = this.gl; if (!gl) return;
    const P = planeFor(pose), q = this.params, sector = q.sector * D2R;
    /* pass 1: scatterer field */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, this.FW, this.FH); gl.useProgram(this.pField);
    const u = this.uF;
    gl.uniform2f(u.u_res, this.FW, this.FH);
    gl.uniform1f(u.u_time, time); gl.uniform1f(u.u_phase, phase); gl.uniform1f(u.u_breath, breath);
    gl.uniform1f(u.u_depth, q.depth); gl.uniform1f(u.u_sector, sector); gl.uniform1f(u.u_gain, q.gain);
    gl.uniform1i(u.u_debug, q.debug | 0); gl.uniform1f(u.u_effusion, q.effusion); gl.uniform1f(u.u_rvdil, q.rvdil); gl.uniform1f(u.u_lvef, q.lvef);
    gl.uniform3fv(u.u_origin, P.origin); gl.uniform3fv(u.u_beam, P.beam); gl.uniform3fv(u.u_lat, P.lat);
    gl.uniform3fv(u.u_he1, HEART.e1); gl.uniform3fv(u.u_he2, HEART.e2); gl.uniform3fv(u.u_he3, HEART.e3); gl.uniform3fv(u.u_hc, HEART.centre);
    const V = this.vol; gl.uniform1i(u.u_hasVol, V ? 1 : 0);
    if (V) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, V.labelTex); gl.uniform1i(u.u_vol, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, V.sdfTex); gl.uniform1i(u.u_volSdf, 2);
      gl.uniform3fv(u.u_volSize, V.size); gl.uniform3fv(u.u_volOrigin, V.origin); gl.uniform3fv(u.u_volLvC, V.lvC); gl.uniform3fv(u.u_volAxis, V.axis);
      gl.uniform3fv(u.u_raCentre, V.raC || [0, 0, 0]); gl.uniform1f(u.u_volSpacing, V.meta.spacing_mm); gl.uniform1f(u.u_volSdfRange, V.meta.sdf_range_mm);
      const R = V.R; gl.uniformMatrix3fv(u.u_volR, false, new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]])); }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    /* pass 2: image formation */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.cv.width, this.cv.height); gl.useProgram(this.pImage);
    const w = this.uI;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(w.u_field, 0);
    gl.uniform2f(w.u_res, this.cv.width, this.cv.height); gl.uniform2f(w.u_fieldRes, this.FW, this.FH);
    gl.uniform1f(w.u_depth, q.depth); gl.uniform1f(w.u_sector, sector); gl.uniform1f(w.u_gain, q.gain); gl.uniform1i(w.u_debug, q.debug | 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/* ---------- target poses: each FoCUS view is a plane through the heart; the pose that produces it is fitted ----------
   plane: origin on the skin, beam (central ray) and lat (in-plane lateral direction, the marker side on screen right). */
function fitPose(x, y, beam, lat) {
  let best = null;
  const err = (pose) => { const P = planeFor(pose); return (1 - dot(P.beam, beam)) * 3 + (1 - dot(P.lat, lat)); };
  for (let rot = 0; rot < 360; rot += 6) for (let tilt = -40; tilt <= 70; tilt += 5) for (let rock = -35; rock <= 35; rock += 5) {
    const pose = { x, y, rot, tilt, rock }, e = err(pose); if (!best || e < best.e) best = { e, pose };
  }
  let step = 3;                                                                  // refine
  for (let i = 0; i < 40; i++) { let moved = false;
    for (const k of ['rot', 'tilt', 'rock']) for (const dlt of [-step, step]) { const pose = { ...best.pose, [k]: best.pose[k] + dlt }; const e = err(pose); if (e < best.e) { best = { e, pose }; moved = true; } }
    if (!moved) step /= 2; if (step < 0.05) break; }
  const p = best.pose; p.rot = ((Math.round(p.rot) % 360) + 360) % 360; p.tilt = Math.round(p.tilt); p.rock = Math.round(p.rock); return p;
}
function computeTargets() {
  const { e1, e2, e3, base, apex, centre } = HEART;
  const left = norm(add(mul(e2, -1), mul(e3, 0)));                              // −e2 ≈ patient's left-superior in the heart's short axis
  const rvDir = norm(add(mul(e1, 1.5), mul(e2, 1.7)));                           // towards the RV centre
  const T = {};
  /* PLAX: parasternal, the plane holds the long axis and the aorta (anterior); the base on screen right */
  { const x = 3.2, y = 10.7, o = skinPoint(x, y).p; const beam = norm(add(centre, mul(o, -1))); let lat = norm(add(mul(e3, -1), mul(beam, -dot(mul(e3, -1), beam)))); T.plax = { label: 'PLAX', depth: 16, ...fitPose(x, y, beam, lat), hint: 'Left sternal edge, 3rd–4th space, marker to the right shoulder.' }; }
  /* PSAX: same window, plane perpendicular to the long axis at papillary level */
  { const x = 3.2, y = 10.7, o = skinPoint(x, y).p; const mid = add(centre, mul(e3, 0.8)); const beam = norm(add(mid, mul(o, -1))); let lat = norm(add(mul(rvDir, -1), mul(beam, -dot(mul(rvDir, -1), beam)))); T.psax = { label: 'PSAX', depth: 14, ...fitPose(x, y, beam, lat), hint: 'Same window, rotate 90° clockwise: marker to the left shoulder.' }; }
  /* A4C: from the apex towards the base, the plane holds the long axis and the RV; RV on screen left */
  { const x = 6.8, y = 14.6, o = skinPoint(x, y).p; const beam = norm(add(add(base, mul(e3, 1.0)), mul(o, -1))); let lat = norm(add(mul(rvDir, -1), mul(beam, -dot(mul(rvDir, -1), beam)))); T.a4c = { label: 'A4C', depth: 16, ...fitPose(x, y, beam, lat), hint: 'Point of maximal impulse, marker to the patient’s left, beam to the right shoulder.' }; }
  /* Subcostal 4C: from below the xiphoid through the liver to the heart; RV nearest the probe, atria on screen right */
  { const x = 0.8, y = 20.5, o = skinPoint(x, y).p; const beam = norm(add(centre, mul(o, -1))); let lat = norm(add(e3, mul(beam, -dot(e3, beam)))); T.sc4c = { label: 'Subcostal 4C', depth: 20, ...fitPose(x, y, beam, lat), hint: 'Just below the xiphoid, flatten the probe, marker to the patient’s left.' }; }
  /* IVC: sagittal plane through the IVC into the RA, head on screen left… marker to the head puts the RA on screen right */
  { const x = -0.2, y = 20.5, o = skinPoint(x, y).p; const ra = add(add(add(centre, mul(e1, 1.2)), mul(e2, 2.4)), mul(e3, -5.9)); const beam = norm(add(add(ra, [0, 5, 1]), mul(o, -1))); let lat = norm(add([0, -1, 0], mul(beam, -dot([0, -1, 0], beam)))); T.ivc = { label: 'IVC', depth: 20, ...fitPose(x, y, beam, lat), hint: 'From subcostal, rotate the marker to the head: a sagittal plane through the IVC into the RA.' }; }
  return T;
}
const TARGETS = computeTargets();
function refreshTargets(){ const T = computeTargets(); for (const k in T) Object.assign(TARGETS[k], T[k]); }
/* Error between a pose and a target, per movement, and the one hint that most reduces it. */
function score(pose, t) {
  const win = Math.hypot(pose.x - t.x, pose.y - t.y);
  let rotErr = ((pose.rot - t.rot) % 360 + 540) % 360 - 180;
  const tiltErr = pose.tilt - t.tilt, rockErr = pose.rock - t.rock;
  const parts = [
    { k: 'window', e: win / 1.5, msg: win > 0.1 ? (Math.abs(pose.y - t.y) > Math.abs(pose.x - t.x) ? (pose.y > t.y ? 'Slide up a rib space.' : 'Slide down a rib space.') : (pose.x > t.x ? 'Slide towards the sternum.' : 'Slide laterally.')) : '' },
    { k: 'plane', e: Math.abs(rotErr) / 12, msg: rotErr > 0 ? 'Rotate anticlockwise.' : 'Rotate clockwise.' },
    { k: 'tilt', e: Math.abs(tiltErr) / 8, msg: tiltErr > 0 ? 'Tilt back towards upright.' : 'Tilt the beam further over.' },
    { k: 'rock', e: Math.abs(rockErr) / 8, msg: rockErr > 0 ? 'Rock the tail down.' : 'Rock the tail up.' },
  ];
  const worst = parts.reduce((a, b) => b.e > a.e ? b : a);
  const onTarget = parts.every(x => x.e <= 1);
  return { parts, worst, onTarget, hint: onTarget ? 'On target.' : worst.msg };
}

window.ProbeSim = { SliceRenderer, planeFor, skinPoint, TARGETS, score, HEART, refreshTargets };
})();
