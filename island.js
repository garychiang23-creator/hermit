/* SANASAI 沙那賽 v2：一座島、三個遊戲（小蜜蜂／Blocks Pro／迷宮球）。
 * 同網域 localStorage 讀真實遊戲紀錄：島上的造景、三把鑰匙、日誌都跟著紀錄變。
 * 造景全部用程式拼（方塊、圓柱、錐），不載入任何模型檔。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const body = document.body;
const TAU = Math.PI * 2;
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => innerWidth <= 820;
if (isTouch) body.classList.add('touch');

/* ---------- DEBUG（僅本機測試；線上一律關閉） ---------- */
const DEBUG = (location.protocol === 'file:' || location.hostname === 'localhost')
  && new URLSearchParams(location.search).get('debug') === '1';

/* ---------- 小工具 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20260719);
const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z), u = smooth(x - xi), v = smooth(z - zi);
  return lerp(lerp(hash2(xi, zi), hash2(xi + 1, zi), u), lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u), v);
};
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtTime = sec => { const m = Math.floor(sec / 60), s = sec - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const pad2 = n => String(n).padStart(2, '0');
const hexNum = hex => parseInt(hex.slice(1), 16);
function tint(hex, k = .86) {
  const n = hexNum(hex), m = c => Math.round(c + (255 - c) * k);
  return `rgb(${m(n >> 16)},${m(n >> 8 & 255)},${m(n & 255)})`;
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
};
const num = k => { const v = parseFloat(ls.get(k)); return isFinite(v) ? v : 0; };

/* ---------- 遊戲清單：新遊戲上架＝加一行（at＝島上位置、door＝分身站的位置；沒有專屬造景的會放一台通用機台） ---------- */
const GAMES = [
  { id: 'bee',    name: '小蜜蜂',     en: 'BEE',        url: 'https://garychiang23-creator.github.io/bee/mobile.html', color: '#d29300', at: [10.4, 1.8],  door: [6.2, 3.6] },
  { id: 'blocks', name: 'Blocks Pro', en: 'BLOCKS PRO', url: 'https://garychiang23-creator.github.io/blocks/',        color: '#2f8fd0', at: [7.4, -7.8],  door: [4.9, -5.3] },
  { id: 'maze',   name: '迷宮球',     en: 'TILT MAZE',  url: 'https://garychiang23-creator.github.io/maze/',          color: '#4c9a56', at: [-8.8, -1.6], door: [-4.7, -.8] },
];
const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));

const INFO = {
  bee: { eyebrow: 'ARCADE', lead: '經典射擊街機。三種難度各自記分，打倒 Boss，每 3 萬分多一條命。', chips: ['三種難度', 'Boss 戰', '手機可玩'] },
  blocks: { eyebrow: 'PUZZLE', lead: '方塊消除。MARATHON 每 10 行升一級，SPRINT 40 比誰先清完 40 行，ULTRA 只有兩分鐘，ZEN 不會結束。', chips: ['四種模式', '手機可玩'] },
  maze: { eyebrow: 'TILT', lead: '傾斜手機讓球滾進終點；電腦用方向鍵。6 章 30 關，零失誤過關拿三顆星。', chips: ['陀螺儀', '6 章 30 關'] },
  pier: { eyebrow: 'LANDING', lead: '渡海的小舟停在這裡。上岸第一眼看到的，是一塊刻了字的石碑。' },
  gate: { eyebrow: 'FINALE', lead: '三把鑰匙到齊時，門才會出現。走進去。' },
};

/* 迷宮球的章節（對齊 maze/index.html 的 CHAPTERS；from＝起始關卡索引，共 30 關） */
const MAZE_CHAPTERS = [
  { name: '慣性', from: 0, to: 3 }, { name: '冰', from: 4, to: 8 }, { name: '沙', from: 9, to: 13 },
  { name: '逆流', from: 14, to: 18 }, { name: '開關', from: 19, to: 23 }, { name: '精通', from: 24, to: 29 },
];
const MAZE_LEVELS = 30, MAZE_STAR_MAX = 90;

/* ---------- 讀真實紀錄 ---------- */
function readRecords() {
  const st = ls.json('bee_stats', {}) || {};
  const bee = {
    easy: num('bee_hi_easy'), normal: num('bee_hi_normal'), hard: num('bee_hi_hard'),
    legacy: num('bee_hi'),   // 小蜜蜂改成分難度記分前的舊欄位，只遷移一次、之後不再更新
    plays: st.plays | 0, maxStage: st.maxStage | 0, bossKills: st.bossKills | 0,
  };
  bee.keyBest = Math.max(bee.normal, bee.hard, bee.legacy);
  bee.best = Math.max(bee.keyBest, bee.easy);
  const spr = parseFloat(ls.get('tetris2_best_sprint'));
  const blocks = {
    marathon: num('tetris2_best_marathon'), ultra: num('tetris2_best_ultra'), zen: num('tetris2_best_zen'),
    sprint: isFinite(spr) && spr > 0 ? spr : null,
  };
  const starMap = ls.json('maze_stars', {}) || {};
  let stars = 0;
  for (const k in starMap) stars += +starMap[k] || 0;
  const maze = { cleared: num('maze_cleared'), perfect: num('maze_perfect'), stars };
  maze.chapters = MAZE_CHAPTERS.map(c => {
    let s = 0;
    for (let i = c.from; i <= c.to; i++) s += +starMap[i] || 0;
    return { ...c, done: maze.cleared >= c.to + 1, stars: s, max: (c.to - c.from + 1) * 3 };
  });
  return { bee, blocks, maze };
}
let records = readRecords();

/* ---------- 三把鑰匙（同網域 localStorage 讀真實紀錄） ---------- */
const BEE_TARGET = 20000;       // 銅：小蜜蜂最高分（普通或困難；舊版不分難度的 bee_hi 視同普通）
const MARATHON_TARGET = 15000;  // 玉：Blocks MARATHON 分數（或完成 SPRINT 40）
const KEYS = [
  { id: 'copper', name: '銅鑰匙', short: '銅', color: '#b87333', hex: 0xc07a3a, place: 'bee', spot: [6.8, 6.0],
    met: r => r.bee.keyBest >= BEE_TARGET, pct: r => r.bee.keyBest / BEE_TARGET,
    rule: `小蜜蜂普通或困難難度最高分達 ${fmt(BEE_TARGET)}`, now: r => `目前 ${fmt(r.bee.keyBest)}` },
  { id: 'jade', name: '玉鑰匙', short: '玉', color: '#12a072', hex: 0x0fae78, place: 'blocks', spot: [4.2, -8.2],
    met: r => r.blocks.marathon >= MARATHON_TARGET || r.blocks.sprint !== null,
    pct: r => r.blocks.sprint !== null ? 1 : r.blocks.marathon / MARATHON_TARGET,
    rule: `Blocks Pro 的 MARATHON 達 ${fmt(MARATHON_TARGET)} 分，或完成一次 SPRINT 40`, now: r => `目前 MARATHON ${fmt(r.blocks.marathon)}` },
  { id: 'crystal', name: '水晶鑰匙', short: '晶', color: '#3fa9c4', hex: 0xa5f2f3, place: null, spot: null,
    met: () => true, pct: () => 0, rule: '藏在島上某個暗處', now: () => '' },
];
const KEY = Object.fromEntries(KEYS.map(k => [k.id, k]));
let keyState = { copper: false, jade: false, crystal: false, coin: false };
Object.assign(keyState, ls.json('sanasai_keys', {}));
const saveKeys = () => ls.set('sanasai_keys', JSON.stringify(keyState));
const allKeys = () => keyState.copper && keyState.jade && keyState.crystal;
const announced = new Set(ls.json('sanasai_announced', []));
let steleRead = ls.get('sanasai_stele') === '1';

/* ---------- 地點 ---------- */
const PLACE = {};
GAMES.forEach((g, i) => { PLACE[g.id] = { id: g.id, no: pad2(i + 1), kind: 'game', name: g.name, en: g.en, color: g.color, at: g.at, door: g.door }; });
PLACE.pier = { id: 'pier', no: pad2(GAMES.length + 1), kind: 'pier', name: '入口碼頭', en: 'PIER', color: '#1d7d8b', at: [0, 19.2], door: [0, 15.9] };
PLACE.gate = { id: 'gate', no: pad2(GAMES.length + 2), kind: 'gate', name: '沙那賽之門', en: 'GATE', color: '#b8841f', at: [0, -11.4], door: [0, -9.8] };
const VIEW = {
  bee: { dir: [-1, .95], dist: 22, look: 2.2 },
  blocks: { dir: [-.6, 1], dist: 18.5, look: 3 },
  maze: { dir: [.8, 1], dist: 14.5, look: .9 },
  pier: { dir: [.95, .75], dist: 15, look: .7 },
  gate: { dir: [.18, 1], dist: 21, look: 2.6 },
};

const ICON = {
  bee: '<path d="M12 6.5c2.9 0 5 2.6 5 6s-2.1 6.5-5 6.5-5-3.1-5-6.5 2.1-6 5-6z"/><path d="M7.3 11h9.4M7.2 14.5h9.6"/><path d="M10.2 6.9C9 4.6 6.6 3.9 5.4 5.1s.2 3.8 2.4 4M13.8 6.9c1.2-2.3 3.6-3 4.8-1.8s-.2 3.8-2.4 4"/>',
  blocks: '<path d="M3.5 13.5H9V19H3.5zM9 13.5h5.5V19H9zM9 8h5.5v5.5H9zM14.5 8H20v5.5h-5.5z"/>',
  maze: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.2H11M14.5 3.5v5.7M8 14.3h12.5M8 14.3v6.2M14.5 14.3v-2.2"/><circle cx="17.2" cy="17.6" r="1.4"/>',
  pier: '<path d="M12 3v11M12 4.2l5.6 8.8H12"/><path d="M5 15.5c2.2 2.1 11.8 2.1 14 0"/><path d="M3 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
  gate: '<path d="M6 21V7.5M18 21V7.5M3.5 4.5h17M4.5 7.5h15M5 11h14"/>',
  key: '<circle cx="8" cy="8.5" r="4"/><path d="M11 11.5 20 20.5M15.5 16l2.2-2.2M18 18.5l2.2-2.2"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m9.5 21 2.2-6.2 2.6 2.4V21M8 12l2.2-4.3 3.6.6 2.2 3.4 2.5.8M11.7 14.8 10.2 7.7"/>',
};
const svg = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/* ---------- 場景 ---------- */
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: $('#labels') });
labelRenderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xeef3ef, 85, 250);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .3, 900);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .08;
controls.minDistance = 6;
controls.maxDistance = 120;
controls.minPolarAngle = .12;
controls.maxPolarAngle = 1.36;
controls.screenSpacePanning = false;
controls.rotateSpeed = .6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const hemi = new THREE.HemisphereLight(0xeef6fa, 0x8a7c66, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1de, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 150 });
sun.shadow.bias = -.0005;
sun.shadow.normalBias = .03;
scene.add(sun, sun.target);

/* 天空：漸層球＋星星＋日月 */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
  vertexShader: `
    varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y * 1.2, 0.0, 1.0);
      gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0);
      #include <colorspace_fragment>
    }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat));

const stars = (() => {
  const n = 700, p = new Float32Array(n * 3), r = mulberry32(5);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, y = .08 + r() * .92, s = Math.sqrt(1 - y * y);
    p.set([Math.cos(a) * s * 420, y * 420, Math.sin(a) * s * 420], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  scene.add(m);
  return m;
})();
function glowSprite(inner, outer, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(.32, inner); g.addColorStop(.36, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  s.scale.setScalar(size);
  scene.add(s);
  return s;
}
const sunDisc = glowSprite('rgba(255,248,220,1)', 'rgba(255,214,150,.35)', 70);
const moonDisc = glowSprite('rgba(244,241,226,1)', 'rgba(220,226,255,.22)', 46);

/* ---------- 共用零件：全部合併成少數幾個網格 ---------- */
const BASE = {
  box: new THREE.BoxGeometry(1, 1, 1),
  rbox: new RoundedBoxGeometry(1, 1, 1, 2, .14),
  cyl: new THREE.CylinderGeometry(.5, .5, 1, 16),
  cyl6: new THREE.CylinderGeometry(.5, .5, 1, 6),
  cone6: new THREE.ConeGeometry(.5, 1, 6),
  pyr: new THREE.ConeGeometry(.5, 1, 4).rotateY(Math.PI / 4).scale(Math.SQRT2, 1, Math.SQRT2),   // 四角錐，底面剛好 1×1
  ico: new THREE.IcosahedronGeometry(.5, 0),
  ico1: new THREE.IcosahedronGeometry(.5, 1),
  dodeca: new THREE.DodecahedronGeometry(.5, 0),
  sphere: new THREE.SphereGeometry(.5, 14, 10),
  disc: new THREE.CylinderGeometry(.5, .5, 1, 32),
  octa: new THREE.OctahedronGeometry(.5, 0),
};
for (const k in BASE) {
  let g = BASE[k];
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  BASE[k] = g;
}
const SOLID = [], GLOW = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
/* part(種類, [x,y,z], [寬,高,深], 顏色, { rx, ry, rz, into, jit }) */
function part(kind, [x, y, z], [sx, sy, sz], color, o = {}) {
  const g = BASE[kind].clone();
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz)));
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i += 3) {
    const k = o.jit ? 1 + (rnd() - .5) * o.jit : 1;
    for (let v = i; v < i + 3; v++) { arr[v * 3] = _c.r * k; arr[v * 3 + 1] = _c.g * k; arr[v * 3 + 2] = _c.b * k; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  (o.into || SOLID).push(g);
}
const MAT = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .88 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
};
function merged(list, mat, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(list), mat);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}
const glowMats = [];
function glowMat(hex) {
  const m = new THREE.MeshBasicMaterial({ color: hex });
  m.userData.base = new THREE.Color(hex);
  glowMats.push(m);
  return m;
}
/* 繞 y 軸轉 ry 之後的局部座標 → 世界座標 */
const local = (x0, z0, ry, lx, lz) => [x0 + lx * Math.cos(ry) + lz * Math.sin(ry), z0 - lx * Math.sin(ry) + lz * Math.cos(ry)];
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData = { c, x: c.getContext('2d'), draw };
  redraw(t);
  return t;
}
function redraw(t, draw) {
  const { c, x } = t.userData;
  if (draw) t.userData.draw = draw;
  x.clearRect(0, 0, c.width, c.height);
  t.userData.draw(x, c.width, c.height);
  t.needsUpdate = true;
}
function rr(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
}
const FONT_D = 'Futura, "Avenir Next", "Helvetica Neue", Arial, sans-serif';
const FONT_C = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
const FONT_M = 'Menlo, "SF Mono", Consolas, monospace';

/* ---------- 地形 ---------- */
const TOP = 1.0, DECK_Y = .62, WALK_MIN = .1;
function islandR(a) { return 17.5 + 1.4 * Math.sin(2 * a + .6) + 1.0 * Math.sin(3 * a + 2.1) + .55 * Math.sin(5 * a + .3); }
const HILL = { x: 0, z: -6.4, r: 4.6, h: 1.0 };
function baseHeight(x, z) {
  const d = Math.hypot(x, z) / islandR(Math.atan2(z, x));
  let h;
  if (d < .8) h = TOP;
  else if (d < .92) h = lerp(TOP, .22, smooth((d - .8) / .12));
  else if (d < 1) h = lerp(.22, -.06, (d - .92) / .08);
  else h = -.06 - 2.4 * Math.min(1, (d - 1) / .3);
  const hd = Math.hypot(x - HILL.x, z - HILL.z) / HILL.r;
  if (hd < 1) h += HILL.h * smooth(1 - hd);
  return h;
}
const polar = (a, d) => [Math.cos(a) * islandR(a) * d, Math.sin(a) * islandR(a) * d];
const PIER = { x0: -1.0, x1: 1.0, z0: 15.4, z1: 23.0 };
const onPier = (x, z) => x > PIER.x0 && x < PIER.x1 && z > PIER.z0 && z < PIER.z1;
const groundY = (x, z) => onPier(x, z) ? DECK_Y : Math.max(baseHeight(x, z), 0);
const PLAZA = [0, 6.4];
const STELE = [-2.5, 15.0];
const COIN = [2.5, 15.0];
const GROTTO = polar(-2.36, .925);

const terrain = (() => {
  const S = .8, N = 60, half = N * S / 2, tr = mulberry32(42);
  const W = N + 1, vx = new Float32Array(W * W), vz = new Float32Array(W * W), vh = new Float32Array(W * W);
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const k = i * W + j;
    let x = -half + j * S, z = -half + i * S;
    if (i && j && i < N && j < N) { x += (tr() - .5) * S * .5; z += (tr() - .5) * S * .5; }
    vx[k] = x; vz[k] = z; vh[k] = baseHeight(x, z);
  }
  const pos = [], col = [], c = new THREE.Color();
  const grass = [0x9dc57c, 0xa6ca85, 0x94bd73, 0xadd08d];
  const tri = (a, b, d) => {
    if (Math.max(vh[a], vh[b], vh[d]) < -.45) return;
    const h = (vh[a] + vh[b] + vh[d]) / 3, cx = (vx[a] + vx[b] + vx[d]) / 3, cz = (vz[a] + vz[b] + vz[d]) / 3;
    const n = vnoise(cx * .17, cz * .17);
    if (h > TOP + .04) c.set(n > .5 ? 0x97c377 : 0xa2c981);
    else if (h > TOP - .02) c.set(grass[Math.min(3, (n * 4) | 0)]);
    else if (h > .55) c.set(0xc9cf93);
    else if (h > .07) c.set(0xecdcaf);
    else if (h > -.2) c.set(0xd9c597);
    else c.set(0xbaae88);
    if (Math.hypot(cx - GROTTO[0], cz - GROTTO[1]) < 3.4 && h < .7) c.set(0x8f897f);
    for (const k of [a, b, d]) { pos.push(vx[k], vh[k], vz[k]); col.push(c.r, c.g, c.b); }
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = i * W + j, b = a + 1, d = a + W, e = d + 1;
    if ((i + j) & 1) { tri(a, d, b); tri(b, d, e); } else { tri(a, d, e); tri(a, e, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95 }));
  m.receiveShadow = true;
  scene.add(m);
  return m;
})();

/* 海：放射狀網格（靠島密、遠處疏），淺水亮、深水暗，浪高跟水深走 */
const water = (() => {
  const RADII = [0, 6, 11, 14, 16, 17.5, 18.8, 20, 21.2, 22.5, 24, 26, 28.5, 31.5, 35, 40, 46, 54, 64, 76, 92, 112, 138, 170, 210, 260, 320];
  const SEG = isTouch ? 96 : 140, tr = mulberry32(9);
  const pos = [], col = [], amp = [], idx = [];
  const deep = new THREE.Color(.7, .8, .9), shallow = new THREE.Color(1.55, 1.62, 1.4), c = new THREE.Color();
  const push = (x, z) => {
    const depth = -baseHeight(x, z), s = Math.pow(clamp(1 - depth / 2.4, 0, 1), 1.6), r = Math.hypot(x, z);
    c.copy(deep).lerp(shallow, s);
    pos.push(x, 0, z); col.push(c.r, c.g, c.b);
    amp.push(.075 * smooth((depth - .04) / .7) * (1 - smooth((r - 150) / 120)));
  };
  push(0, 0);
  for (let i = 1; i < RADII.length; i++) for (let j = 0; j < SEG; j++) {
    const a = j / SEG * TAU + (i % 2) * (Math.PI / SEG), jr = i < RADII.length - 1 ? (tr() - .5) * .6 : 0;
    push(Math.cos(a) * (RADII[i] + jr), Math.sin(a) * (RADII[i] + jr));
  }
  for (let j = 0; j < SEG; j++) idx.push(0, 1 + (j + 1) % SEG, 1 + j);
  for (let i = 1; i < RADII.length - 1; i++) {
    const a0 = 1 + (i - 1) * SEG, b0 = 1 + i * SEG;
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .32, metalness: .08, color: 0x45a0c2 }));
  m.receiveShadow = true;
  m.userData.amp = Float32Array.from(amp);
  scene.add(m);
  return m;
})();
const foam = (() => {
  const SEG = 160, pos = [], idx = [];
  for (let j = 0; j <= SEG; j++) {
    const a = j / SEG * TAU, R = islandR(a);
    pos.push(Math.cos(a) * R * .966, .035, Math.sin(a) * R * .966, Math.cos(a) * R * 1.02, .035, Math.sin(a) * R * 1.02);
  }
  for (let j = 0; j < SEG; j++) { const k = j * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(m);
  return m;
})();

/* ---------- 障礙與保留區（給種樹與走路用） ---------- */
const OBST = [], KEEP = [];
const circleOb = (x, z, r) => OBST.push({ x, z, r });
const rectOb = (x, z, w, d, ry = 0) => OBST.push({ x, z, hw: w / 2, hd: d / 2, ry });
const keep = (x, z, r) => KEEP.push({ x, z, r });
function inRect(o, x, z, pad) {
  const dx = x - o.x, dz = z - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry);
  return Math.abs(dx * c - dz * s) < o.hw + pad && Math.abs(dx * s + dz * c) < o.hd + pad;
}
const hitsObstacle = (x, z, pad) => OBST.some(o => o.r !== undefined ? (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2 : inRect(o, x, z, pad));
const freeSpot = (x, z, pad) => !hitsObstacle(x, z, pad) && !KEEP.some(k => Math.hypot(x - k.x, z - k.z) < k.r + pad);

const pickables = [], groundPick = [terrain, water];
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const HIT_GEO = new THREE.BoxGeometry(1, 1, 1);
function hitBox(data, [x, y, z], [w, h, d], ry = 0) {
  const m = new THREE.Mesh(HIT_GEO, hitMat);
  m.position.set(x, y, z); m.scale.set(w, h, d); m.rotation.y = ry;
  m.userData = data;
  scene.add(m);
  return m;
}

/* ---------- 廣場與步道 ---------- */
function bench(x, z, ry) {
  const y = groundY(x, z);
  part('box', [x, y + .44, z], [1.3, .08, .44], 0xb48560, { ry });
  const [bx, bz] = local(x, z, ry, 0, -.2);
  part('box', [bx, y + .72, bz], [1.3, .36, .06], 0xa77a55, { ry });
  for (const lx of [-.52, .52]) { const [lx2, lz2] = local(x, z, ry, lx, 0); part('box', [lx2, y + .22, lz2], [.08, .44, .38], 0x5b4a3b, { ry }); }
  rectOb(x, z, 1.3, .5, ry);
}
function lampPost(x, z) {
  const y = groundY(x, z);
  part('cyl6', [x, y + 1.15, z], [.1, 2.3, .1], 0x39415a);
  part('box', [x, y + 2.42, z], [.3, .36, .3], 0xffdc9a, { into: GLOW });
  part('pyr', [x, y + 2.7, z], [.42, .22, .42], 0x39415a);
  circleOb(x, z, .2);
}
function buildPlaza() {
  const [px, pz] = PLAZA, y = TOP;
  part('disc', [px, y + .03, pz], [6.9, .06, 6.9], 0xe7ddc9);
  part('disc', [px, y + .05, pz], [4.6, .05, 4.6], 0xd9ccb2);
  part('disc', [px, y + .07, pz], [1.9, .05, 1.9], 0x96c0c9);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * TAU;
    part('box', [px + Math.cos(a) * 3.25, y + .065, pz + Math.sin(a) * 3.25], [.5, .05, .3], i % 2 ? 0xcfc1a6 : 0xeee5d3, { ry: -a + Math.PI / 2 });
  }
  part('cyl6', [px, y + 1.15, pz], [.14, 2.3, .14], 0x6f5641);
  GAMES.forEach((g, i) => {
    const a = Math.atan2(g.at[1] - pz, g.at[0] - px);
    part('box', [px + Math.cos(a) * .5, y + 1.95 - i * .34, pz + Math.sin(a) * .5], [.95, .24, .06], hexNum(g.color), { ry: -a });
  });
  circleOb(px, pz, .4);
  for (const a of [.55, 2.6, 3.75, 5.65]) bench(px + Math.cos(a) * 4.05, pz + Math.sin(a) * 4.05, Math.atan2(-Math.cos(a), -Math.sin(a)));
  for (const a of [2.05, 1.09, -1.0, -2.14]) lampPost(px + Math.cos(a) * 3.65, pz + Math.sin(a) * 3.65);
  keep(px, pz, 4.9);
}
const PATHS = [
  [[0, 15.4], [0, 12.6], [0, 9.9]],
  [[2.5, 7.8], [4.5, 6.3], [5.6, 4.6], [6.1, 3.7]],
  [[-2.7, 5.2], [-3.8, 3.0], [-4.4, .9], [-4.6, -.6]],
  [[1.2, 3.2], [2.4, .4], [3.5, -2.5], [4.7, -5.0]],
  [[0, 3.0], [0, -1.6], [0, -6.4], [0, -10.2]],
];
function buildPaths() {
  const pr = mulberry32(31), stones = [0xe9dfca, 0xe1d5be, 0xf1e8d6];
  for (const pts of PATHS) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.max(2, Math.round(curve.getLength() / .52));
    for (let i = 0; i <= n; i++) {
      const p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n), a = Math.atan2(t.x, t.z);
      for (const side of [-1, 1]) {
        const ox = Math.cos(a) * .27 * side + (pr() - .5) * .08, oz = -Math.sin(a) * .27 * side + (pr() - .5) * .08;
        const x = p.x + ox, z = p.z + oz;
        part('rbox', [x, groundY(x, z) + .03, z], [.44, .07, .36], stones[(pr() * 3) | 0], { ry: a + (pr() - .5) * .4 });
      }
      keep(p.x, p.z, 1.0);
    }
  }
}

/* ---------- 入口碼頭、小舟、石碑 ---------- */
const boat = new THREE.Group();
function buildPier() {
  const { x0, x1, z0, z1 } = PIER, w = x1 - x0 + .5;
  let k = 0;
  for (let z = z0 - .1; z < z1; z += .44, k++) part('box', [0, DECK_Y - .05, z + .2], [w, .1, .38], k % 3 ? 0xb88a5f : 0xa77c54, { jit: .06 });
  for (let z = z0 + .8; z <= z1; z += 1.9) for (const sx of [-1, 1]) {
    part('cyl6', [sx * (w / 2 + .02), DECK_Y - .9, z], [.22, 2.1, .22], 0x7d5c3f);
    part('cyl6', [sx * (w / 2 - .08), DECK_Y + .3, z], [.11, .6, .11], 0x8a6848);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - .12), z = z1 - .15;
    part('cyl6', [x, DECK_Y + .65, z], [.09, 1.3, .09], 0x4b3a2c);
    part('box', [x, DECK_Y + 1.38, z], [.26, .3, .26], 0xffd38f, { into: GLOW });
    part('pyr', [x, DECK_Y + 1.62, z], [.36, .2, .36], 0x3a2e24);
  }
  groundPick.push(hitBox({ walk: true }, [0, DECK_Y - .1, (z0 + z1) / 2], [w, .2, z1 - z0]));
  keep(0, 15.2, 2.6);

  const L = [], hull = 0x1f2638;
  part('box', [0, .12, 0], [2.0, .42, .9], hull, { into: L });
  part('pyr', [1.32, .12, 0], [.42, .65, .9], hull, { into: L, rz: -Math.PI / 2 });
  part('pyr', [-1.18, .12, 0], [.42, .38, .9], hull, { into: L, rz: Math.PI / 2 });
  part('box', [0, .34, 0], [1.9, .05, .74], 0x9b7350, { into: L });
  part('cyl6', [.1, 1.3, 0], [.07, 2.0, .07], 0x3a2e24, { into: L });
  boat.add(merged(L, MAT.solid));
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([.1, .55, 0, .1, 2.2, 0, -.95, .6, 0], 3));
  sg.computeVertexNormals();
  const sail = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xe8e3d0, side: THREE.DoubleSide, roughness: .9 }));
  sail.castShadow = true;
  boat.add(sail);
  const lamp = new THREE.Mesh(BASE.box, glowMat(0xffb066));
  lamp.scale.setScalar(.17);
  lamp.position.set(-1.0, .58, 0);
  boat.add(lamp);
  boat.position.set(1.95, 0, 21.4);
  boat.rotation.y = Math.PI / 2;
  scene.add(boat);
  pickables.push(hitBox({ place: 'pier' }, [1.95, .8, 21.4], [1.1, 2.4, 3.0]));
}
function buildStele() {
  const [x, z] = STELE, y = groundY(x, z), ry = .35;
  part('box', [x, y + .1, z], [1.3, .2, .8], 0xa9a397, { ry });
  part('rbox', [x, y + 1.0, z], [.95, 1.7, .34], 0x8d97a1, { ry });
  for (let i = 0; i < 4; i++) part('box', [x + Math.sin(ry) * .18, y + 1.4 - i * .22, z + Math.cos(ry) * .18], [.56 - (i % 2) * .16, .045, .02], 0x5c6570, { ry });
  circleOb(x, z, .65);
  keep(x, z, 1.4);
  pickables.push(hitBox({ place: 'pier' }, [x, y + 1, z], [1.1, 2, .8], ry));
}

/* ---------- 01 小蜜蜂：ARCHAIDE 街機館 ---------- */
let beeScreen = null, beeBoard = null, fighter = null, neonMat = null;
function drawBeeScreen(x, w, h) {
  const t = performance.now() / 1000;
  x.fillStyle = '#05060f'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { x.fillStyle = i % 3 ? '#5866c2' : '#ffffff'; x.fillRect((i * 37) % w, (i * 53 + t * 36) % h, 2, 2); }
  const cols = ['#ffd23f', '#ff5a7a', '#66d9ff'];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    const ex = 22 + c * 21 + Math.sin(t * 1.8 + r) * 6, ey = 20 + r * 17, f = ((t * 3 + c) | 0) % 2;
    x.fillStyle = cols[r];
    x.fillRect(ex - 5, ey - 2, 10, 5); x.fillRect(ex - 2, ey - 5, 4, 3);
    x.fillRect(ex - (f ? 8 : 7), ey + (f ? 1 : -3), 3, 3); x.fillRect(ex + (f ? 5 : 4), ey + (f ? 1 : -3), 3, 3);
  }
  const px = w / 2 + Math.sin(t * 1.3) * 34;
  x.fillStyle = '#e8edf7'; x.fillRect(px - 7, h - 18, 14, 6); x.fillRect(px - 2, h - 26, 4, 8);
  x.fillStyle = '#ff5050'; x.fillRect(px - 9, h - 14, 3, 5); x.fillRect(px + 6, h - 14, 3, 5);
  x.fillStyle = '#ffffff'; x.fillRect(px - 1, (h - 30) - ((t * 150) % (h - 40)), 2, 7);
}
function drawBeeBoard(x, w, h) {
  const r = records.bee;
  x.fillStyle = '#141a33'; rr(x, 4, 4, w - 8, h - 8, 26); x.fill();
  x.lineWidth = 6; x.strokeStyle = '#2f3a68'; x.stroke();
  x.fillStyle = '#ffd23f'; x.font = `600 30px ${FONT_D}`; x.textAlign = 'left'; x.fillText('HI-SCORE', 36, 62);
  x.fillStyle = '#7f8cc8'; x.font = `500 24px ${FONT_C}`; x.textAlign = 'right'; x.fillText('小蜜蜂', w - 36, 60);
  x.textAlign = 'center';
  x.fillStyle = r.best ? '#fff1b8' : '#55608f';
  x.font = `bold 92px ${FONT_M}`;
  x.shadowColor = '#ffc93c'; x.shadowBlur = r.best ? 18 : 0;
  x.fillText(r.best ? fmt(r.best) : '------', w / 2, 158);
  x.shadowBlur = 0;
  x.fillStyle = '#9fb0e6'; x.font = `500 25px ${FONT_C}`;
  x.fillText(r.best ? `普通 ${fmt(r.normal)}　困難 ${fmt(r.hard)}　簡單 ${fmt(r.easy)}` : '還沒有紀錄', w / 2, 214);
}
function arcadeCabinet(color, screenTex) {
  const g = new THREE.Group(), L = [];
  part('box', [0, .62, -.05], [.9, 1.24, .78], 0x232b46, { into: L });
  part('box', [0, 1.55, -.12], [.9, .66, .64], 0x232b46, { into: L });
  part('box', [0, 1.06, .2], [.92, .1, .42], 0x2d3658, { into: L, rx: -.38 });
  part('cyl', [-.18, 1.16, .26], [.06, .16, .06], 0xe8e8e8, { into: L });
  part('sphere', [-.18, 1.26, .26], [.11, .11, .11], 0xe14b4b, { into: L });
  part('cyl', [.1, 1.13, .28], [.09, .04, .09], 0xf6c33b, { into: L });
  part('cyl', [.27, 1.13, .22], [.09, .04, .09], 0x3fc3f0, { into: L });
  for (const sx of [-.46, .46]) part('box', [sx, 1.0, -.05], [.03, 1.9, .8], hexNum(color), { into: L });
  g.add(merged(L, MAT.solid));
  const marquee = new THREE.Mesh(BASE.box, glowMat(hexNum(color)));
  marquee.scale.set(.92, .24, .5); marquee.position.set(0, 2.0, -.1);
  g.add(marquee);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.66, .52), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 1.56, .205); screen.rotation.x = -.12;
  g.add(screen);
  return g;
}
function buildArchaide(game) {
  const [cx, cz] = game.at, y = TOP, fx = cx - 1.78;   // 正面朝 -x（面向廣場）
  part('box', [cx, y + .12, cz], [4.9, .24, 6.4], 0xd9cdb7);
  part('box', [cx + .25, y + 1.62, cz], [4.0, 2.76, 5.8], 0xf2e9da);
  part('box', [cx + .25, y + 3.1, cz], [4.4, .26, 6.2], 0x27304d);
  part('box', [cx + .5, y + 3.32, cz], [3.4, .2, 5.2], 0x313b5c);
  part('box', [fx - .02, y + 1.02, cz + .2], [.08, 1.76, 1.95], 0x1d2338);
  part('box', [fx - .05, y + .98, cz + .2], [.04, 1.56, 1.62], 0xffc777, { into: GLOW });
  for (const dz of [-1.95, 1.95]) {
    part('cyl', [fx - .02, y + 1.55, cz + dz], [.9, .08, .9], 0x27304d, { rz: Math.PI / 2 });
    part('cyl', [fx - .05, y + 1.55, cz + dz], [.68, .05, .68], 0x9fe6ff, { into: GLOW, rz: Math.PI / 2 });
  }
  for (const dx of [-.5, .75, 2.0]) for (const s of [-1, 1]) part('box', [cx + dx, y + 1.75, cz + s * 2.92], [.72, .92, .05], 0x9fe6ff, { into: GLOW });
  for (let i = 0; i < 7; i++) part('box', [fx - .38, y + 2.32, cz - 1.6 + i * .45 + .22], [.8, .06, .45], i % 2 ? 0xf6c33b : 0x27304d, { rz: .38 });
  part('box', [cx + .3, y + 3.62, cz - 1.7], [1.5, .12, 1.5], 0x39415a);
  part('cyl', [cx + .3, y + 3.71, cz - 1.7], [1.25, .06, 1.25], 0xf6c33b);
  rectOb(cx + .1, cz, 4.6, 6.3);
  keep(cx, cz, 4.2);

  // 霓虹招牌 ARCHAIDE（夜裡亮）
  const signTex = canvasTex(1024, 256, (x, w, h) => {
    x.fillStyle = '#1a2142'; rr(x, 8, 8, w - 16, h - 16, 44); x.fill();
    x.lineWidth = 8; x.strokeStyle = '#2f3a6b'; x.stroke();
    const word = 'ARCHAIDE';
    x.font = `600 128px ${FONT_D}`; x.textBaseline = 'middle';
    const ws = [...word].map(ch => x.measureText(ch).width), gap = 22, total = ws.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
    let px = (w - total) / 2;
    [...word].forEach((ch, i) => {
      x.shadowColor = '#ff4fa3'; x.shadowBlur = 26; x.lineWidth = 7; x.strokeStyle = '#ff74b8'; x.strokeText(ch, px, h / 2 + 6);
      x.shadowBlur = 0; x.lineWidth = 2.5; x.strokeStyle = '#ffe3f1'; x.strokeText(ch, px, h / 2 + 6);
      px += ws[i] + gap;
    });
  });
  neonMat = new THREE.MeshBasicMaterial({ map: signTex });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), neonMat);
  sign.position.set(fx - .1, y + 3.95, cz); sign.rotation.y = -Math.PI / 2;
  scene.add(sign);
  part('box', [fx - .02, y + 3.95, cz], [.12, 1.2, 4.7], 0x1a2142);

  // 小蜜蜂機台、計分板、屋頂的戰機
  beeScreen = canvasTex(128, 128, drawBeeScreen);
  const cab = arcadeCabinet(game.color, beeScreen);
  cab.position.set(7.45, y, 3.6); cab.rotation.y = -Math.PI / 2;
  cab.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(cab);
  rectOb(7.45, 3.6, .9, .9);
  pickables.push(hitBox({ place: game.id }, [cx, y + 2, cz], [4.6, 4.2, 6.4]), hitBox({ place: game.id }, [7.45, y + 1.1, 3.6], [1.1, 2.3, 1.1]));

  beeBoard = canvasTex(512, 256, drawBeeBoard);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: beeBoard }));
  const bx = 7.35, bz = -.55, bry = -Math.PI / 2 + .35;
  board.position.set(bx, y + 1.75, bz); board.rotation.y = bry;
  scene.add(board);
  for (const lx of [-.8, .8]) { const [px2, pz2] = local(bx, bz, bry, lx, -.04); part('cyl6', [px2, y + .85, pz2], [.08, 1.7, .08], 0x39415a); }
  part('box', [bx, y + 1.75, bz], [2.12, 1.1, .05], 0x141a33, { ry: bry });
  circleOb(bx, bz, .5);
  pickables.push(hitBox({ place: game.id }, [bx, y + 1.5, bz], [2.2, 1.6, .4], bry));

  fighter = new THREE.Group();
  const F = [];
  part('cone6', [0, 0, .25], [.32, .9, .32], 0xf1f3f8, { into: F, rx: Math.PI / 2 });
  part('box', [0, -.02, -.05], [1.1, .06, .34], 0xe14b4b, { into: F });
  part('box', [0, .12, -.28], [.06, .32, .26], 0xe14b4b, { into: F });
  part('sphere', [0, .1, .18], [.17, .12, .26], 0x4fc3f7, { into: F });
  fighter.add(merged(F, MAT.solid));
  const flame = new THREE.Mesh(BASE.cone6, glowMat(0xffa040));
  flame.scale.set(.16, .32, .16); flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0, -.38);
  fighter.add(flame);
  fighter.position.set(cx + .3, y + 4.6, cz - 1.7);
  fighter.userData.y = fighter.position.y;
  scene.add(fighter);
}

/* ---------- 02 Blocks Pro：方塊塔（MARATHON 每 2,500 分加一層） ---------- */
const PIECE = [0x3cc4ee, 0xf5c541, 0xa46ad6, 0x5cc46a, 0xee5d57, 0x3f73e3, 0xf39a3b];
const TILINGS = [['IIII', 'LOOJ', 'LOOJ', 'LLJJ'], ['AAAB', 'CABB', 'CCDB', 'CDDD']];
const SHAPES = [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[2, 0], [0, 1], [1, 1], [2, 1]]];
const TOWER_GOAL = 2 + MARATHON_TARGET / 2500;
const towerLayers = r => clamp(2 + Math.floor(r.blocks.marathon / 2500), 2, 14);
let tower = null, blocksPlaque = null;
const cellGeo = new RoundedBoxGeometry(.47, .47, .47, 2, .06);
const cellMat = new THREE.MeshStandardMaterial({ roughness: .5, metalness: .04 });
function drawBlocksPlaque(x, w, h) {
  const b = records.blocks;
  x.fillStyle = '#f7f0e2'; rr(x, 4, 4, w - 8, h - 8, 24); x.fill();
  x.lineWidth = 6; x.strokeStyle = '#d8ccb4'; x.stroke();
  x.textAlign = 'left';
  x.fillStyle = '#2f8fd0'; x.font = `600 28px ${FONT_D}`; x.fillText('MARATHON', 34, 64);
  x.fillStyle = '#16213a'; x.font = `600 70px ${FONT_D}`; x.fillText(b.marathon ? fmt(b.marathon) : '—', 34, 136);
  x.fillStyle = '#2f8fd0'; x.font = `600 26px ${FONT_D}`; x.fillText('SPRINT 40', 34, 192);
  x.fillStyle = '#16213a'; x.font = `600 34px ${FONT_D}`; x.fillText(b.sprint ? fmtTime(b.sprint) : '—', 34, 232);
  x.textAlign = 'right'; x.fillStyle = '#8b91a1'; x.font = `500 24px ${FONT_C}`; x.fillText(`塔高 ${towerLayers(records)} 層`, w - 34, 64);
}
function buildTower(game) {
  const [cx, cz] = game.at, y = TOP;
  part('box', [cx, y + .17, cz], [3.2, .34, 3.2], 0xd5c8b0);
  part('box', [cx, y + .38, cz], [2.6, .08, 2.6], 0xe8ddc8);
  rectOb(cx, cz, 3.2, 3.2);
  keep(cx, cz, 3.6);
  const group = new THREE.Group();
  group.position.set(cx, y + .42, cz);
  scene.add(group);
  const frameMat = glowMat(0xf1c24e), frame = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(BASE.box, frameMat), a = i * Math.PI / 2;
    m.scale.set(2.36, .07, .07); m.position.set(Math.sin(a) * 1.18, 0, Math.cos(a) * 1.18); m.rotation.y = a;
    frame.add(m);
  }
  frame.position.y = TOWER_GOAL * .5;
  group.add(frame);
  const drop = new THREE.Group(), dropMat = new THREE.MeshStandardMaterial({ roughness: .5, emissive: 0xffffff, emissiveIntensity: 0 });
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(cellGeo, dropMat); m.castShadow = true; drop.add(m); }
  drop.visible = false;
  group.add(drop);
  tower = { group, mesh: null, layers: 0, top: 0, frame, frameMat, drop, dropMat, state: 'wait', t: 2.5, v: 0 };
  pickables.push(hitBox({ place: game.id }, [cx, y + 4, cz], [3.2, 8, 3.2]));

  blocksPlaque = canvasTex(512, 256, drawBlocksPlaque);
  const px = cx - 2.2, pz = cz + 2.1, pry = -Math.PI / 4;
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .8), new THREE.MeshBasicMaterial({ map: blocksPlaque }));
  plaque.position.set(px, y + 1.05, pz); plaque.rotation.y = pry; plaque.rotation.x = -.18;
  scene.add(plaque);
  part('box', [px - Math.sin(pry) * .12, y + .36, pz - Math.cos(pry) * .12], [.12, .72, .12], 0x6f5641);
  circleOb(px, pz, .35);
}
function setTowerLayers(L) {
  if (!tower || tower.layers === L) return;
  if (tower.mesh) { tower.group.remove(tower.mesh); tower.mesh.dispose(); }
  const mesh = new THREE.InstancedMesh(cellGeo, cellMat, L * 16), m4 = new THREE.Matrix4(), c = new THREE.Color();
  let n = 0;
  for (let k = 0; k < L; k++) {
    const T = TILINGS[k % 2], ids = [...new Set(T.join(''))];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let a = i, b = j;
      for (let r = 0; r < k % 4; r++) [a, b] = [b, 3 - a];
      c.setHex(PIECE[(ids.indexOf(T[a][b]) * 2 + k * 3) % 7]);
      mesh.setMatrixAt(n, m4.makeTranslation((i - 1.5) * .5, (k + .5) * .5, (j - 1.5) * .5));
      mesh.setColorAt(n++, c);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = true;
  tower.group.add(mesh);
  Object.assign(tower, { mesh, layers: L, top: L * .5 });
  if (pins.blocks) pins.blocks.obj.position.y = tower.group.position.y + tower.top + 1.3;
}
function updateTower(dt) {
  const T = tower;
  if (!T || !T.mesh) return;
  T.t -= dt;
  if (T.state === 'wait' && T.t <= 0) {
    const sh = SHAPES[(rnd() * SHAPES.length) | 0], ox = (rnd() * 2) | 0, oz = (rnd() * 3) | 0;
    T.dropMat.color.setHex(PIECE[(rnd() * 7) | 0]);
    T.drop.children.forEach((m, i) => m.position.set((sh[i][0] + ox - 1.5) * .5, 0, (Math.min(3, sh[i][1] + oz) - 1.5) * .5));
    Object.assign(T, { state: 'fall', v: 0 });
    T.drop.position.y = T.top + 6; T.drop.scale.setScalar(1); T.drop.visible = true;
  } else if (T.state === 'fall') {
    T.v += 14 * dt; T.drop.position.y -= T.v * dt;
    if (T.drop.position.y <= T.top + .25) { T.drop.position.y = T.top + .25; T.state = 'land'; T.t = .9; }
  } else if (T.state === 'land') {
    T.dropMat.emissiveIntensity = T.t > .6 ? .55 : 0;
    if (T.t < .4) T.drop.scale.setScalar(Math.max(.01, T.t / .4));
    if (T.t <= 0) { T.drop.visible = false; T.state = 'wait'; T.t = 3.5 + rnd() * 3; }
  }
}

/* ---------- 03 迷宮球：會傾斜的迷宮花園，一章一盞石燈 ---------- */
let maze = null, mazePlaque = null;
const lanternOff = new THREE.MeshStandardMaterial({ color: 0x77716a, flatShading: true, roughness: .9 });
const lanternOn = glowMat(0xffc56a);
function genMaze(n, r) {
  const walls = Array.from({ length: n * n }, () => [1, 1, 1, 1]), seen = new Uint8Array(n * n), stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1], x = c % n, y = (c / n) | 0, nb = [];
    if (y > 0 && !seen[c - n]) nb.push([c - n, 0, 2]);
    if (x < n - 1 && !seen[c + 1]) nb.push([c + 1, 1, 3]);
    if (y < n - 1 && !seen[c + n]) nb.push([c + n, 2, 0]);
    if (x > 0 && !seen[c - 1]) nb.push([c - 1, 3, 1]);
    if (!nb.length) { stack.pop(); continue; }
    const [m, w1, w2] = nb[(r() * nb.length) | 0];
    walls[c][w1] = 0; walls[m][w2] = 0; seen[m] = 1; stack.push(m);
  }
  const prev = new Int32Array(n * n).fill(-1), q = [0];
  prev[0] = 0;
  while (q.length) {
    const c = q.shift(), x = c % n, y = (c / n) | 0;
    [[0, c - n, y > 0], [1, c + 1, x < n - 1], [2, c + n, y < n - 1], [3, c - 1, x > 0]].forEach(([w, m, ok]) => {
      if (ok && !walls[c][w] && prev[m] < 0) { prev[m] = c; q.push(m); }
    });
  }
  const path = [];
  for (let c = n * n - 1; c !== 0; c = prev[c]) path.unshift(c);
  path.unshift(0);
  return { walls, path };
}
function drawMazePlaque(x, w, h) {
  const m = records.maze;
  x.fillStyle = '#f3f0e3'; rr(x, 4, 4, w - 8, h - 8, 24); x.fill();
  x.lineWidth = 6; x.strokeStyle = '#cfd8c2'; x.stroke();
  x.textAlign = 'center';
  x.fillStyle = '#c98a00'; x.font = `600 76px ${FONT_D}`; x.fillText(`★ ${m.stars}`, w / 2 - 40, 122);
  x.fillStyle = '#8b91a1'; x.font = `500 40px ${FONT_D}`; x.textAlign = 'left'; x.fillText(`/ ${MAZE_STAR_MAX}`, w / 2 + 58, 122);
  x.textAlign = 'center'; x.fillStyle = '#4c6b4f'; x.font = `500 30px ${FONT_C}`;
  x.fillText(m.cleared ? `通過 ${m.cleared} / ${MAZE_LEVELS} 關` : '還沒有紀錄', w / 2, 196);
}
function stoneLantern(x, z) {
  const y = groundY(x, z);
  part('cyl6', [x, y + .1, z], [.62, .2, .62], 0xb9b3a6);
  part('cyl6', [x, y + .55, z], [.22, .7, .22], 0xc9c3b6);
  part('box', [x, y + .93, z], [.56, .08, .56], 0xb9b3a6);
  part('pyr', [x, y + 1.43, z], [.72, .32, .72], 0x9d978a);
  part('sphere', [x, y + 1.64, z], [.13, .13, .13], 0x9d978a);
  const box = new THREE.Mesh(BASE.box, lanternOff);
  box.scale.set(.42, .4, .42); box.position.set(x, y + 1.17, z);
  scene.add(box);
  circleOb(x, z, .4);
  return box;
}
function buildMazeGarden(game) {
  const [cx, cz] = game.at, y = TOP, n = 5, cs = 1.12, o = -n * cs / 2;
  part('box', [cx, y + .05, cz], [7.4, .1, 7.4], 0xddd2bd);
  part('box', [cx, y + .3, cz], [2.2, .5, 2.2], 0xb2aa9b);
  rectOb(cx, cz, 6.8, 6.8);
  keep(cx, cz, 5.4);
  const tray = new THREE.Group(), L = [], mz = genMaze(n, mulberry32(30));
  tray.position.set(cx, y + .66, cz);
  part('box', [0, -.1, 0], [6.3, .2, 6.3], 0xb88b5c, { into: L });
  part('box', [0, .015, 0], [5.9, .04, 5.9], 0xeadfc6, { into: L });
  for (const [px, pz, w, d] of [[0, -3.05, 6.3, .2], [0, 3.05, 6.3, .2], [-3.05, 0, .2, 6.3], [3.05, 0, .2, 6.3]]) part('box', [px, .14, pz], [w, .32, d], 0x9d7348, { into: L });
  const hedge = [0x4f8a4a, 0x5a9653, 0x47804a];
  for (let c = 0; c < n * n; c++) {
    const i = c % n, j = (c / n) | 0, x0 = o + i * cs, z0 = o + j * cs;
    if (mz.walls[c][0] && j > 0) part('box', [x0 + cs / 2, .25, z0], [cs + .2, .44, .2], hedge[c % 3], { into: L, jit: .1 });
    if (mz.walls[c][3] && i > 0) part('box', [x0, .25, z0 + cs / 2], [.2, .44, cs + .2], hedge[(c + 1) % 3], { into: L, jit: .1 });
  }
  part('cyl', [o + (n - .5) * cs, .04, o + (n - .5) * cs], [.6, .02, .6], 0x2a2a2a, { into: L });
  tray.add(merged(L, MAT.solid));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.24, 20, 14), new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: .85, roughness: .2 }));
  ball.castShadow = true;
  tray.add(ball);
  scene.add(tray);
  const pathPts = mz.path.map(c => new THREE.Vector3(o + (c % n + .5) * cs, .27, o + (((c / n) | 0) + .5) * cs));
  const lanterns = [];
  for (const sz of [-1, 1]) for (const dx of [-2.4, 0, 2.4]) lanterns.push(stoneLantern(cx + dx, cz + sz * 4.25));
  maze = { tray, ball, pathPts, seg: 0, f: 0, sink: 0, lanterns };
  pickables.push(hitBox({ place: game.id }, [cx, y + .7, cz], [6.6, 1.4, 6.6]));

  mazePlaque = canvasTex(512, 256, drawMazePlaque);
  const px = cx + 3.75, pz = cz + 3.6, pry = Math.PI / 4;
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .8), new THREE.MeshBasicMaterial({ map: mazePlaque }));
  plaque.position.set(px, y + 1.05, pz); plaque.rotation.y = pry; plaque.rotation.x = -.18;
  scene.add(plaque);
  part('box', [px - Math.sin(pry) * .12, y + .36, pz - Math.cos(pry) * .12], [.12, .72, .12], 0x6f5641);
  circleOb(px, pz, .35);

  const n2 = 40, fp = new Float32Array(n2 * 3);
  for (let i = 0; i < n2; i++) fp.set([cx + (rnd() - .5) * 8, y + .6 + rnd() * 1.6, cz + (rnd() - .5) * 8], i * 3);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  maze.flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xe8ff9a, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  maze.flyBase = Float32Array.from(fp);
  scene.add(maze.flies);
}
function updateMaze(dt, t) {
  if (!maze) return;
  maze.tray.rotation.x = Math.sin(t * .5) * .05;
  maze.tray.rotation.z = Math.sin(t * .37 + 1) * .05;
  const P = maze.pathPts;
  if (maze.sink > 0) {
    maze.sink -= dt;
    maze.ball.position.y = .27 - (1 - maze.sink / .8) * .5;
    if (maze.sink <= 0) { maze.seg = 0; maze.f = 0; }
  } else {
    maze.f += dt * 2.4 / Math.max(.01, P[maze.seg].distanceTo(P[maze.seg + 1]));
    while (maze.f >= 1 && maze.seg < P.length - 2) { maze.f -= 1; maze.seg++; }
    if (maze.f >= 1) { maze.ball.position.copy(P[P.length - 1]); maze.sink = .8; }
    else maze.ball.position.lerpVectors(P[maze.seg], P[maze.seg + 1], maze.f);
  }
  const a = maze.flies.geometry.attributes.position, b = maze.flyBase;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, b[i * 3] + Math.sin(t * .7 + i) * .4, b[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * .25, b[i * 3 + 2] + Math.cos(t * .6 + i) * .4);
  a.needsUpdate = true;
}

/* 沒有專屬造景的新遊戲：一台通用機台 */
function buildKiosk(game) {
  const [x, z] = game.at, scr = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#0b1020'; c.fillRect(0, 0, w, h);
    c.fillStyle = game.color; c.font = `600 22px ${FONT_D}`; c.textAlign = 'center'; c.fillText(game.en.slice(0, 9), w / 2, h / 2 + 8);
  });
  const cab = arcadeCabinet(game.color, scr);
  cab.position.set(x, groundY(x, z), z);
  cab.lookAt(game.door[0], cab.position.y, game.door[1]);
  scene.add(cab);
  circleOb(x, z, .7);
  keep(x, z, 2);
  pickables.push(hitBox({ place: game.id }, [x, cab.position.y + 1.1, z], [1.2, 2.3, 1.2]));
}

/* ---------- 暗處的岩洞（水晶鑰匙） ---------- */
const crystal = { group: new THREE.Group(), light: new THREE.PointLight(0x9fe8ff, 0, 8, 1.6), mat: null };
function buildGrotto() {
  const [gx, gz] = GROTTO, gy = groundY(gx, gz), inward = Math.atan2(-gz, -gx);
  part('disc', [gx, gy + .02, gz], [3.4, .04, 3.4], 0x4b4741);
  for (let i = 0; i < 9; i++) {
    const a = inward + (50 + i * 32.5) * Math.PI / 180, r = 1.95, s = 1.5 + rnd() * .6;
    const x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r;
    part('dodeca', [x, gy + s * .55, z], [s, s * (1.2 + rnd() * .5), s], 0x6f6a63, { ry: rnd() * TAU, jit: .14 });
    circleOb(x, z, .75);
  }
  for (let i = 0; i < 3; i++) {
    const a = inward + Math.PI + (i - 1) * .7;
    part('dodeca', [gx + Math.cos(a) * .9, gy + 2.35, gz + Math.sin(a) * .9], [2.3, 1.0, 2.0], 0x625d57, { ry: rnd() * TAU, jit: .12 });
  }
  keep(gx, gz, 5.2);
  crystal.mat = new THREE.MeshStandardMaterial({ color: 0xc9f3ff, emissive: 0x6fd8ff, emissiveIntensity: .06, roughness: .12, metalness: .1, flatShading: true });
  const rock = new THREE.Mesh(BASE.dodeca, new THREE.MeshStandardMaterial({ color: 0x57524c, flatShading: true }));
  rock.scale.set(.7, .4, .7); rock.position.y = .15;
  crystal.group.add(rock);
  for (const [x, z, h, tilt] of [[0, 0, 1.0, 0], [.17, .06, .62, .35], [-.15, .1, .5, -.4]]) {
    const s = new THREE.Mesh(BASE.octa, crystal.mat);
    s.scale.set(.26, h, .26); s.position.set(x, .3 + h * .42, z); s.rotation.z = tilt;
    crystal.group.add(s);
  }
  crystal.light.position.y = 1.1;
  crystal.group.add(crystal.light);
  crystal.group.position.set(gx, gy, gz);
  scene.add(crystal.group);
}

/* ---------- 沙那賽之門、25¢ 復活幣、鑰匙基座 ---------- */
const gate = new THREE.Group(), gateLight = new THREE.PointLight(0xffd27a, 0, 14, 1.5);
let gateShimmer = null;
function buildGate() {
  const [x, z] = PLACE.gate.at, y = groundY(x, z);
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8c066, emissive: 0xb07a14, emissiveIntensity: .35, metalness: .65, roughness: .3, flatShading: true });
  const add = (geo, [px, py, pz], [sx, sy, sz]) => { const m = new THREE.Mesh(geo, gold); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.castShadow = true; gate.add(m); };
  add(BASE.box, [0, .1, 0], [4.8, .2, 1.6]);
  for (const sx of [-1.7, 1.7]) add(BASE.rbox, [sx, 2.3, 0], [.5, 4.4, .5]);
  add(BASE.box, [0, 4.55, 0], [4.4, .44, .62]);
  gateShimmer = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 4.1), new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: .25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  gateShimmer.position.y = 2.25;
  gate.add(gateShimmer);
  gateLight.position.set(0, 2.5, 1.2);
  scene.add(gateLight);
  gate.position.set(x, y, z);
  gate.visible = false;
  scene.add(gate);
  for (const sx of [-1.7, 1.7]) circleOb(x + sx, z, .42);
  keep(x, z, 3.4);
}
const coin = new THREE.Group();
function buildCoin() {
  const [x, z] = COIN, y = groundY(x, z);
  const base = new THREE.Mesh(BASE.cyl6, new THREE.MeshStandardMaterial({ color: 0xa9a397, flatShading: true }));
  base.scale.set(.7, .7, .7); base.position.y = .35;
  coin.add(base);
  const face = canvasTex(256, 256, (c, w, h) => {
    const g = c.createRadialGradient(100, 90, 10, 128, 128, 128);
    g.addColorStop(0, '#fff2b8'); g.addColorStop(.6, '#f2c14e'); g.addColorStop(1, '#b9821c');
    c.fillStyle = g; c.beginPath(); c.arc(128, 128, 126, 0, TAU); c.fill();
    c.fillStyle = '#7a520c'; c.font = `600 92px ${FONT_D}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('25¢', 128, 136);
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.38, .38, .07, 32), [
    new THREE.MeshStandardMaterial({ color: 0xd9a53a, metalness: .7, roughness: .3 }),
    new THREE.MeshStandardMaterial({ map: face, metalness: .5, roughness: .35 }),
    new THREE.MeshStandardMaterial({ map: face, metalness: .5, roughness: .35 }),
  ]);
  disc.rotation.x = Math.PI / 2; disc.position.y = 1.25;
  coin.add(disc);
  coin.userData.disc = disc;
  coin.position.set(x, y, z);
  coin.visible = false;
  scene.add(coin);
  circleOb(x, z, .45);
  keep(x, z, 1.4);
}
const pedestals = {};
function makeKeyMesh(k) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: k.hex, emissive: k.hex, emissiveIntensity: .55, roughness: .3, metalness: .6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.22, .06, 10, 24), mat);
  ring.position.y = .3;
  g.add(ring);
  for (const [px, py, sx, sy] of [[0, -.15, .1, .55], [.12, -.38, .18, .09], [.1, -.24, .13, .09]]) {
    const m = new THREE.Mesh(BASE.box, mat); m.position.set(px, py, 0); m.scale.set(sx, sy, .09); g.add(m);
  }
  return g;
}
function spawnPedestal(k) {
  if (pedestals[k.id]) return;
  const [x, z] = k.spot, y = groundY(x, z), group = new THREE.Group();
  const base = new THREE.Mesh(BASE.cyl6, new THREE.MeshStandardMaterial({ color: 0xe5dccb, flatShading: true }));
  base.scale.set(.75, .9, .75); base.position.y = .45; base.castShadow = true;
  group.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .04, 8, 32), glowMat(k.hex));
  ring.rotation.x = Math.PI / 2; ring.position.y = .93;
  group.add(ring);
  const key = makeKeyMesh(k);
  key.position.y = 1.55;
  group.add(key);
  group.position.set(x, y, z);
  scene.add(group);
  const pin = addPin('key-' + k.id, `<span class="no">${svg('key')}</span>${k.name}`, k.color, [x, y + 2.35, z], () => goToKey(k.id), 'key');
  pedestals[k.id] = { group, key, k, pin };
}
function removePedestal(id) {
  const p = pedestals[id];
  if (!p) return;
  scene.remove(p.group, p.pin.obj);
  delete pedestals[id];
}

/* ---------- 樹、石頭、花 ---------- */
const GREENS = [0x8fbf6f, 0x9cc77d, 0x86b566, 0xa6cd86];
function broadleaf(x, z, s) {
  const y = groundY(x, z), g = GREENS[(rnd() * 4) | 0], c = new THREE.Color(g);
  part('cyl6', [x, y + .4 * s, z], [.18 * s, .8 * s, .18 * s], 0x8a6a4e);
  part('ico', [x, y + 1.15 * s, z], [1.1 * s, .95 * s, 1.1 * s], g, { ry: rnd() * TAU, jit: .12 });
  part('ico', [x + .3 * s, y + 1.4 * s, z - .1 * s], [.66 * s, .6 * s, .66 * s], c.clone().offsetHSL(0, .02, .06).getHex(), { ry: rnd() * TAU, jit: .1 });
  part('ico', [x - .28 * s, y + .98 * s, z + .2 * s], [.6 * s, .52 * s, .6 * s], c.clone().offsetHSL(.01, -.03, -.06).getHex(), { ry: rnd() * TAU, jit: .1 });
  circleOb(x, z, .32 * s);
}
function pine(x, z, s) {
  const y = groundY(x, z);
  part('cyl6', [x, y + .35 * s, z], [.16 * s, .7 * s, .16 * s], 0x7a5a40);
  [[.6, 1.1, 1.3], [1.1, .95, 1.05], [1.55, .7, .8]].forEach(([h, r, hh], i) => part('cone6', [x, y + h * s + .2 * s, z], [r * s * 1.3, hh * s, r * s * 1.3], [0x5f9a63, 0x6aa66b, 0x76b274][i], { ry: rnd(), jit: .1 }));
  circleOb(x, z, .3 * s);
}
function palm(x, z, s) {
  const y = groundY(x, z), lean = rnd() * TAU;
  let px = x, pz = z, py = y;
  for (let i = 0; i < 5; i++) {
    const nx = px + Math.cos(lean) * .08 * s, nz = pz + Math.sin(lean) * .08 * s;
    part('cyl6', [nx, py + .25 * s, nz], [.16 * s, .52 * s, .16 * s], i % 2 ? 0x9b7a55 : 0x8a6a48, { rx: Math.sin(lean) * .15, rz: -Math.cos(lean) * .15 });
    px = nx; pz = nz; py += .48 * s;
  }
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + rnd() * .3;
    part('box', [px + Math.cos(a) * .55 * s, py + .02, pz + Math.sin(a) * .55 * s], [1.15 * s, .05, .3 * s], i % 2 ? 0x6fae5a : 0x7dbb64, { ry: -a, rz: -.32 });
  }
  circleOb(x, z, .25 * s);
}
function scatter() {
  const r = mulberry32(77);
  let placed = 0;
  for (let tries = 0; placed < 64 && tries < 5000; tries++) {
    const a = r() * TAU, d = Math.sqrt(r()) * .78, [x, z] = polar(a, d);
    if (!freeSpot(x, z, .9)) continue;
    const s = .82 + r() * .45;
    (r() < .64 ? broadleaf : pine)(x, z, s);
    placed++;
  }
  for (let i = 0, tries = 0; i < 10 && tries < 400; tries++) {
    const a = r() * TAU, [x, z] = polar(a, .84 + r() * .05);
    if (!freeSpot(x, z, 1.2)) continue;
    palm(x, z, .9 + r() * .3); i++;
  }
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU, [x, z] = polar(a, .95 + r() * .08), s = .35 + r() * .8;
    if (Math.hypot(x - GROTTO[0], z - GROTTO[1]) < 4 || Math.abs(x) < 2.4 && z > 14) continue;
    part('dodeca', [x, Math.max(baseHeight(x, z), -.3) + s * .25, z], [s * 1.2, s * .8, s], [0x9a968e, 0x8c887f, 0xa8a49b][i % 3], { ry: r() * TAU, jit: .12 });
  }
  const fl = [0xf2b5c6, 0xf6d36b, 0xffffff, 0xc7a6ec];
  for (let i = 0, tries = 0; i < 110 && tries < 3000; tries++) {
    const a = r() * TAU, d = Math.sqrt(r()) * .78, [x, z] = polar(a, d);
    if (!freeSpot(x, z, .2)) continue;
    part('ico', [x, groundY(x, z) + .08, z], [.16, .12, .16], fl[i % 4]);
    i++;
  }
}

/* ---------- 遠景：雲、遠島、海鳥 ---------- */
const clouds = new THREE.Group(), birds = [];
function buildAmbient() {
  const r = mulberry32(55), cm = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const L = [], a = i / 9 * TAU + r() * .4, R = 55 + r() * 45, y = 22 + r() * 10;
    for (let k = 0; k < 4 + (r() * 3 | 0); k++) part('ico1', [Math.cos(a) * R + (k - 2) * 2.2, y + r() * 1.2, Math.sin(a) * R + (r() - .5) * 2], [3 + r() * 2.2, 2 + r(), 2.6 + r() * 1.5], 0xffffff, { into: L });
    clouds.add(merged(L, cm, false));
  }
  scene.add(clouds);
  const isl = [];
  for (let i = 0; i < 6; i++) {
    const a = .3 + i / 6 * TAU + r() * .5, R = 125 + r() * 45, x = Math.cos(a) * R, z = Math.sin(a) * R;
    part('cone6', [x, 3, z], [26 + r() * 20, 10 + r() * 10, 22 + r() * 16], 0x7f9c86, { into: isl, ry: r() });
    part('cone6', [x + 5, 6, z + 3], [12, 14 + r() * 8, 12], 0x6f8d78, { into: isl, ry: r() });
  }
  scene.add(merged(isl, MAT.solid, false));
  const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group(), w1 = new THREE.Mesh(BASE.box, bm), w2 = new THREE.Mesh(BASE.box, bm), bd = new THREE.Mesh(BASE.box, bm);
    bd.scale.set(.18, .14, .5); w1.scale.set(.75, .04, .26); w2.scale.set(.75, .04, .26);
    w1.position.x = -.38; w2.position.x = .38;
    b.add(bd, w1, w2);
    b.userData = { w1, w2, R: 13 + i * 3.5, h: 9 + i * 1.3, sp: .16 + i * .03, ph: i * 1.7 };
    birds.push(b);
    scene.add(b);
  }
}

/* ---------- 名牌（CSS2D） ---------- */
const pins = {};
function addPin(id, html, color, [x, y, z], onClick, cls = '') {
  const wrap = document.createElement('div');
  wrap.className = 'pin-wrap';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pin ' + cls;
  b.innerHTML = html;
  if (color) b.style.setProperty('--c', color);
  b.addEventListener('click', e => { e.stopPropagation(); onClick && onClick(); });
  b.addEventListener('pointerdown', e => e.stopPropagation());
  wrap.appendChild(b);
  const obj = new CSS2DObject(wrap);
  obj.center.set(.5, 1);
  obj.position.set(x, y, z);
  scene.add(obj);
  return (pins[id] = { obj, el: b });
}

/* ---------- 蓋島 ---------- */
buildPlaza();
buildPaths();
buildPier();
buildStele();
for (const g of GAMES) ({ bee: buildArchaide, blocks: buildTower, maze: buildMazeGarden }[g.id] || buildKiosk)(g);
buildGrotto();
buildGate();
buildCoin();
for (const k of KEYS) if (k.spot) keep(k.spot[0], k.spot[1], 1.4);
for (const g of GAMES) keep(g.door[0], g.door[1], 1.3);
scatter();
buildAmbient();
scene.add(merged(SOLID, MAT.solid));
scene.add(merged(GLOW, MAT.glow, false));

/* ---------- 走路：格點地圖＋A* ---------- */
const GRID = { x0: -24, z0: -24, cs: .4, n: 120 };
const AV_R = .3;
const walkGrid = new Uint8Array(GRID.n * GRID.n);
const walkableAt = (x, z) => (onPier(x, z) || baseHeight(x, z) > WALK_MIN) && !hitsObstacle(x, z, AV_R);
for (let j = 0; j < GRID.n; j++) for (let i = 0; i < GRID.n; i++) walkGrid[j * GRID.n + i] = walkableAt(GRID.x0 + (i + .5) * GRID.cs, GRID.z0 + (j + .5) * GRID.cs) ? 1 : 0;
const cellOK = (i, j) => i >= 0 && j >= 0 && i < GRID.n && j < GRID.n && walkGrid[j * GRID.n + i] === 1;
const cellAt = (x, z) => [Math.floor((x - GRID.x0) / GRID.cs), Math.floor((z - GRID.z0) / GRID.cs)];
const cellCenter = c => [GRID.x0 + (c % GRID.n + .5) * GRID.cs, GRID.z0 + (((c / GRID.n) | 0) + .5) * GRID.cs];
function nearestCell(i, j, maxR) {
  if (cellOK(i, j)) return [i, j];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !cellOK(i + di, j + dj)) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; best = [i + di, j + dj]; }
    }
    if (best) return best;
  }
  return null;
}
function lineClear([ax, az], [bx, bz]) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / .15);
  for (let k = 1; k <= n; k++) { const [i, j] = cellAt(lerp(ax, bx, k / n), lerp(az, bz, k / n)); if (!cellOK(i, j)) return false; }
  return true;
}
function findPath(sx, sz, tx, tz) {
  const n = GRID.n, s = nearestCell(...cellAt(sx, sz), 5), t = nearestCell(...cellAt(tx, tz), 16);
  if (!s || !t) return null;
  const S = s[1] * n + s[0], T = t[1] * n + t[0];
  const g = new Float32Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n), heap = [];
  const hval = c => { const dx = Math.abs(c % n - t[0]), dz = Math.abs(((c / n) | 0) - t[1]); return Math.max(dx, dz) + .414 * Math.min(dx, dz); };
  const push = (f, c) => { heap.push([f, c]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  g[S] = 0;
  push(hval(S), S);
  while (heap.length) {
    const c = pop()[1];
    if (c === T) break;
    if (done[c]) continue;
    done[c] = 1;
    const ci = c % n, cj = (c / n) | 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!cellOK(ni, nj) || (di && dj && (!cellOK(ci + di, cj) || !cellOK(ci, cj + dj)))) continue;
      const m = nj * n + ni, ng = g[c] + (di && dj ? 1.414 : 1);
      if (ng < g[m]) { g[m] = ng; from[m] = c; push(ng + hval(m), m); }
    }
  }
  if (S !== T && from[T] < 0) return null;
  const cells = [];
  for (let c = T; ; c = from[c]) { cells.push(c); if (c === S || c < 0) break; }
  cells.reverse();
  const pts = cells.map(cellCenter);
  const tc = cellAt(tx, tz);
  if (tc[0] === t[0] && tc[1] === t[1] && walkableAt(tx, tz)) pts[pts.length - 1] = [tx, tz];
  const out = [];
  let from2 = [sx, sz], k = 0;
  while (k < pts.length - 1) {
    let far = pts.length - 1;
    while (far > k + 1 && !lineClear(from2, pts[far])) far--;
    out.push(pts[far]);
    from2 = pts[far];
    k = far;
  }
  if (!out.length) out.push(pts[pts.length - 1]);
  return out;
}

/* ---------- 玩家分身 ---------- */
const avatar = new THREE.Group();
const AV = {};
{
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .65, flatShading: true });
  const add = (parent, geo, mat, [x, y, z], [sx, sy, sz] = [1, 1, 1]) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  AV.body = new THREE.Group();
  avatar.add(AV.body);
  add(AV.body, new RoundedBoxGeometry(.46, .5, .32, 2, .1), M(0x14a7bd), [0, .74, 0]);
  add(AV.body, new THREE.SphereGeometry(.27, 18, 14), M(0xf3d2b3), [0, 1.22, 0]);
  const hair = add(AV.body, new THREE.SphereGeometry(.29, 18, 14, 0, TAU, 0, Math.PI * .52), M(0x2b2f3d), [0, 1.25, -.02]);
  hair.rotation.x = -.3;
  for (const sx of [-.09, .09]) add(AV.body, new THREE.SphereGeometry(.035, 8, 6), M(0x1d2233), [sx, 1.22, .25]);
  const limb = (x, y, w, h, c) => { const p = new THREE.Group(); p.position.set(x, y, 0); add(p, new RoundedBoxGeometry(w, h, w, 1, .04), M(c), [0, -h / 2, 0]); AV.body.add(p); return p; };
  AV.legL = limb(-.11, .5, .15, .44, 0x2a3550);
  AV.legR = limb(.11, .5, .15, .44, 0x2a3550);
  AV.armL = limb(-.3, .95, .12, .4, 0x14a7bd);
  AV.armR = limb(.3, .95, .12, .4, 0x14a7bd);
  AV.halo = new THREE.Mesh(new THREE.TorusGeometry(.42, .035, 8, 40), glowMat(0x22d8f0));
  AV.halo.rotation.x = Math.PI / 2;
  AV.halo.position.y = .05;
  avatar.add(AV.halo);
}
avatar.position.set(0, DECK_Y, 21.6);
avatar.rotation.y = Math.PI;
scene.add(avatar);
const mePin = addPin('me', '你', null, [0, 0, 0], null, 'me');
avatar.add(mePin.obj);
mePin.obj.position.set(0, 1.75, 0);
const marker = new THREE.Mesh(new THREE.RingGeometry(.3, .45, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
scene.add(marker);

const walk = { path: null, i: 0, phase: 0, moving: false, onArrive: null };
function walkTo(x, z, { follow: f = false, onArrive = null, mark = false } = {}) {
  const path = findPath(avatar.position.x, avatar.position.z, x, z);
  if (!path) return false;
  walk.path = path; walk.i = 0; walk.onArrive = onArrive;
  if (f) startFollow();
  if (mark) { const [mx, mz] = path[path.length - 1]; marker.position.set(mx, groundY(mx, mz) + .05, mz); marker.material.opacity = .9; marker.scale.setScalar(1); }
  return true;
}
const keysDown = {};
const joy = { x: 0, y: 0 };
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _mv = new THREE.Vector3();
function updateAvatar(dt) {
  let ix = (keysDown.d || keysDown.arrowright ? 1 : 0) - (keysDown.a || keysDown.arrowleft ? 1 : 0) + joy.x;
  let iz = (keysDown.s || keysDown.arrowdown ? 1 : 0) - (keysDown.w || keysDown.arrowup ? 1 : 0) + joy.y;
  const len = Math.hypot(ix, iz);
  let moving = false;
  const speed = 4.2;
  if (len > .1 && !uiLock()) {
    if (len > 1) { ix /= len; iz /= len; }
    walk.path = null;
    camera.getWorldDirection(_fw); _fw.y = 0; _fw.normalize();
    _rt.crossVectors(_fw, camera.up).normalize();
    _mv.copy(_rt).multiplyScalar(ix).addScaledVector(_fw, -iz);
    const nx = avatar.position.x + _mv.x * speed * dt, nz = avatar.position.z + _mv.z * speed * dt;
    if (walkableAt(nx, nz)) avatar.position.set(nx, avatar.position.y, nz);
    else if (walkableAt(nx, avatar.position.z)) avatar.position.x = nx;
    else if (walkableAt(avatar.position.x, nz)) avatar.position.z = nz;
    faceTo(_mv.x, _mv.z, dt);
    moving = true;
    if (!follow) startFollow();
  } else if (walk.path) {
    const [tx, tz] = walk.path[walk.i], dx = tx - avatar.position.x, dz = tz - avatar.position.z, d = Math.hypot(dx, dz);
    const step = speed * dt;
    if (d <= step) {
      avatar.position.x = tx; avatar.position.z = tz;
      if (++walk.i >= walk.path.length) { walk.path = null; const cb = walk.onArrive; walk.onArrive = null; cb && cb(); }
    } else {
      avatar.position.x += dx / d * step; avatar.position.z += dz / d * step;
      faceTo(dx, dz, dt);
    }
    moving = true;
  }
  avatar.position.y = lerp(avatar.position.y, groundY(avatar.position.x, avatar.position.z), Math.min(1, dt * 12));
  walk.phase += dt * (moving ? 9 : 0);
  const sw = moving ? Math.sin(walk.phase) * .65 : 0;
  AV.legL.rotation.x = sw; AV.legR.rotation.x = -sw; AV.armL.rotation.x = -sw * .8; AV.armR.rotation.x = sw * .8;
  AV.body.position.y = moving ? Math.abs(Math.sin(walk.phase)) * .05 : Math.sin(performance.now() / 600) * .012;
  AV.halo.rotation.z += dt * 1.6;
  if (marker.material.opacity > 0) { marker.material.opacity = Math.max(0, marker.material.opacity - dt * .9); marker.scale.multiplyScalar(1 + dt * .4); }
  walk.moving = moving;
}
function faceTo(dx, dz, dt) {
  let d = Math.atan2(dx, dz) - avatar.rotation.y;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  avatar.rotation.y += d * Math.min(1, dt * 10);
}

/* ---------- 日夜（預設跟著現在時間） ---------- */
const DAY = [
  // [分鐘, 天頂, 地平線, 日光色, 日光強度, 天光, 地光, 環境強度, 夜晚程度, 海]
  [0,    0x0e1a3a, 0x24345e, 0xa9bcff, .8, 0x7487c4, 0x3a3450, .95, 1, 0x1f3f66],
  [300,  0x122046, 0x2f3f70, 0xb0c0ff, .8, 0x7c8cc6, 0x3c3652, 1.0, 1, 0x224468],
  [360,  0x6a7cbc, 0xf2b597, 0xffaf7a, 1.2, 0xe6c0b2, 0x5a4a52, .85, .45, 0x5a8cad],
  [450,  0x8cc3ea, 0xf6e2cd, 0xffe1c2, 2.3, 0xe9f1f5, 0x7c6d5c, 1.0, 0, 0x4f9fbf],
  [720,  0x78bce9, 0xeef3ef, 0xfff4e2, 2.8, 0xeff6fa, 0x8a7c66, 1.05, 0, 0x45a0c2],
  [960,  0x84c0e6, 0xf5e6cf, 0xffe3bf, 2.4, 0xf1ede4, 0x84735f, 1.0, 0, 0x4c9cbc],
  [1065, 0x6f7fbf, 0xf4ae84, 0xff9a62, 1.6, 0xf2ccb6, 0x6f5a56, .9, .3, 0x5a82a8],
  [1140, 0x39437d, 0xc7889f, 0xff8f72, .9, 0xb3a5d6, 0x4b3f5e, .9, .75, 0x3c5788],
  [1230, 0x142146, 0x33447a, 0xb0c0ff, .8, 0x7a8ac6, 0x3c3652, 1.0, 1, 0x234670],
  [1440, 0x0e1a3a, 0x24345e, 0xa9bcff, .8, 0x7487c4, 0x3a3450, .95, 1, 0x1f3f66],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
let night = 0;
function lerpHex(target, a, b, t) { target.copy(_c1.setHex(a)).lerp(_c2.setHex(b), t); }
function applyDay(min) {
  let i = 0;
  while (i < DAY.length - 2 && DAY[i + 1][0] <= min) i++;
  const A = DAY[i], B = DAY[i + 1], t = clamp((min - A[0]) / (B[0] - A[0]), 0, 1);
  lerpHex(skyMat.uniforms.top.value, A[1], B[1], t);
  lerpHex(skyMat.uniforms.horizon.value, A[2], B[2], t);
  scene.fog.color.copy(skyMat.uniforms.horizon.value);
  lerpHex(sun.color, A[3], B[3], t);
  sun.intensity = lerp(A[4], B[4], t);
  lerpHex(hemi.color, A[5], B[5], t);
  lerpHex(hemi.groundColor, A[6], B[6], t);
  hemi.intensity = lerp(A[7], B[7], t);
  night = lerp(A[8], B[8], t);
  lerpHex(water.material.color, A[9], B[9], t);
  const day = min > 330 && min < 1110;
  const ang = day ? (min - 360) / 720 * Math.PI : (((min + 1440 - 1080) % 1440) / 720) * Math.PI;
  const elev = Math.max(.3, Math.sin(clamp(ang, .05, Math.PI - .05)) * (day ? 1 : .8));
  const dir = _p.set(Math.cos(ang) * .9, elev, .45 + .2 * Math.sin(ang)).normalize();
  sun.position.copy(dir).multiplyScalar(70);
  sunDisc.position.copy(dir).multiplyScalar(380); sunDisc.visible = day;
  moonDisc.position.copy(dir).multiplyScalar(380); moonDisc.visible = !day;
  const g = lerp(.9, 2.1, night);
  MAT.glow.color.setScalar(g);
  for (const m of glowMats) m.color.copy(m.userData.base).multiplyScalar(g);
  if (neonMat) neonMat.color.setScalar(lerp(.95, 2.0, night));
  stars.material.opacity = Math.pow(night, 1.4);
  if (maze) maze.flies.material.opacity = night * .9;
  renderer.toneMappingExposure = lerp(1.0, .95, night);
}
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
let timeMode = 'auto', curMin = nowMin();
const TIME_LABEL = { auto: '自動', 390: '清晨', 720: '白天', 1070: '黃昏', 1290: '夜晚' };
function setTime(mode) {
  timeMode = mode;
  $$('[data-time]').forEach(b => b.classList.toggle('active', b.dataset.time === String(mode)));
  $('#btn-time-label').textContent = TIME_LABEL[mode];
}
function updateTime(dt) {
  const target = timeMode === 'auto' ? nowMin() : +timeMode;
  let d = target - curMin;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  curMin = (curMin + (Math.abs(d) < .05 ? d : d * Math.min(1, dt * 2.4)) + 1440) % 1440;
  applyDay(curMin);
}

/* ---------- 鏡頭 ---------- */
let fly = null, follow = false, dragging = false;
function flyTo({ pos, target }, dur = 1.1, done = null) {
  if (reduced || dur <= 0) { camera.position.copy(pos); controls.target.copy(target); controls.update(); done && done(); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), s: performance.now(), dur: dur * 1000, done };
  controls.enabled = false;
}
function shiftView(pos, t, offX, offY, dist) {
  if (!offX && !offY) return;
  const fwd = t.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
  const k = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / innerHeight;
  const sh = right.multiplyScalar(-offX * k).add(up.multiplyScalar(offY * k));
  pos.add(sh); t.add(sh);
}
const sideW = () => (!isMobile() && ui.side) ? 340 : (!isMobile() && ui.log ? 346 : 0);
function overviewPose() {
  const aspect = innerWidth / innerHeight, dist = aspect >= 1.25 ? 60 : aspect >= .85 ? 70 : 78;
  const t = new THREE.Vector3(0, .5, 1.2), d = new THREE.Vector3(.32, 0, 1).normalize(), el = .74;
  const pos = t.clone().addScaledVector(d, dist * Math.cos(el));
  pos.y += dist * Math.sin(el);
  shiftView(pos, t, -sideW() / 2, isMobile() ? innerHeight * .04 : 0, dist);
  return { pos, target: t };
}
function birdPose() {
  const aspect = innerWidth / innerHeight, dist = aspect >= 1 ? 66 : 92;
  return { pos: new THREE.Vector3(0, dist, 2.5), target: new THREE.Vector3(0, 0, 0) };
}
function viewFor(id) {
  const P = PLACE[id], V = VIEW[id] || { dir: [0, 1], dist: 14, look: 1.5 };
  const look = id === 'blocks' && tower ? Math.max(2.4, (tower.top + 1.4) * .5) : V.look;
  const t = new THREE.Vector3(P.at[0], look, P.at[1]);
  const aspect = innerWidth / innerHeight, dist = V.dist * (aspect < .85 ? 1.5 : aspect < 1.2 ? 1.15 : 1);
  const d = new THREE.Vector3(V.dir[0], 0, V.dir[1]).normalize(), el = .58;
  const pos = t.clone().addScaledVector(d, dist * Math.cos(el));
  pos.y += dist * Math.sin(el);
  const offX = isMobile() ? 0 : (392 + innerWidth - sideW()) / 2 - innerWidth / 2;
  const offY = isMobile() ? -innerHeight * .2 : 0;
  shiftView(pos, t, offX, offY, dist);
  return { pos, target: t };
}
function startFollow() {
  follow = true;
  const off = camera.position.clone().sub(controls.target), dist = off.length();
  if (dist > 30 && !fly) {
    const t = avatar.position.clone(); t.y += .8;
    off.setLength(isMobile() ? 26 : 22);
    if (off.y < 8) off.y = 8;
    flyTo({ pos: t.clone().add(off), target: t }, .9);
  }
}
function updateCamera(dt) {
  if (fly) {
    const k = Math.min(1, (performance.now() - fly.s) / fly.dur), e = easeIO(k);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (k >= 1) { const cb = fly.done; fly = null; controls.enabled = true; cb && cb(); }
  } else if (follow && !dragging) {
    const want = _p.set(avatar.position.x, avatar.position.y + .8, avatar.position.z).sub(controls.target).multiplyScalar(Math.min(1, dt * 2.6));
    controls.target.add(want);
    camera.position.add(want);
  }
  controls.update();
}

/* ---------- 介面狀態 ---------- */
const ui = { side: !isMobile(), sidePref: true, card: false, log: false, tab: 'places', logTab: 'log', full: false };
const state = { selected: null, nearGame: null, names: true, freeze: reduced, bird: false, inGame: false, inEnding: false, intro: false };
let landed = false;
const uiLock = () => state.inGame || state.inEnding;
function syncLayout() {
  body.classList.toggle('side-closed', !ui.side);
  body.classList.toggle('card-open', ui.card);
  body.classList.toggle('log-open', ui.log);
  body.classList.toggle('sheet-open', isMobile() && (ui.side || ui.card || ui.log));
  $('#card').hidden = !ui.card;
  $('#card').classList.toggle('full', ui.full);
  $('#log').hidden = !ui.log;
  $('#btn-index').setAttribute('aria-pressed', String(ui.side));
  $$('[data-toggle=log]').forEach(b => b.setAttribute('aria-pressed', String(ui.log)));
}
function openSide(on = true) {
  ui.side = on;
  if (!isMobile()) ui.sidePref = on;
  if (on) { ui.log = false; if (isMobile()) closeCard(false); }
  syncLayout();
}
function openLog(on = true) {
  ui.log = on;
  if (on) { ui.side = false; if (isMobile()) closeCard(false); renderLog(); }
  else if (!isMobile()) ui.side = ui.sidePref;
  syncLayout();
}
function closeCard(sync = true) {
  ui.card = false; ui.full = false; state.selected = null;
  markActive();
  if (sync) syncLayout();
}

/* ---------- 地點選取 ---------- */
function selectPlace(id, { walkThere = true } = {}) {
  const P = PLACE[id];
  if (!P || (id === 'gate' && !gate.visible)) return;
  state.selected = id;
  follow = false;
  if (state.bird) setBird(false, false);
  ui.card = true; ui.full = false;
  if (isMobile()) { ui.side = false; ui.log = false; }
  renderCard();
  syncLayout();
  markActive();
  flyTo(viewFor(id));
  if (walkThere && P.door) walkTo(P.door[0], P.door[1]);
}
function markActive() {
  for (const id in PLACE) if (pins[id]) pins[id].el.classList.toggle('active', state.selected === id);
  $$('#dock button, .idx[data-place]').forEach(b => b.classList.toggle('active', b.dataset.place === state.selected));
}
function overview() {
  follow = false;
  if (state.bird) setBird(false, false);
  closeCard();
  flyTo(overviewPose());
}
function setBird(on, move = true) {
  state.bird = on;
  controls.minPolarAngle = on ? 0 : .12;
  $$('[data-toggle=bird]').forEach(b => b.setAttribute('aria-pressed', String(on)));
  if (!move) return;
  follow = false;
  flyTo(on ? birdPose() : overviewPose());
}
function goToKey(id) {
  const k = KEY[id];
  if (!pedestals[id]) return;
  walkTo(k.spot[0], k.spot[1], { follow: true, mark: true });
  if (isMobile()) closeCard();
}

/* ---------- 介面：品牌列鑰匙、清單、卡片 ---------- */
function kchip(k, extra = '') {
  const owned = keyState[k.id], ready = !owned && k.id !== 'crystal' && k.met(records);
  return `<span class="kchip ${k.id}${owned ? ' owned' : ready ? ' ready' : ''}" title="${k.name}${owned ? '（已到手）' : ready ? '（已現世）' : ''}" ${extra}>${svg('key')}</span>`;
}
function renderBrandKeys() {
  $('#brand-keys').innerHTML = KEYS.map(k => kchip(k)).join('');
  $('#keys-count').textContent = `${KEYS.filter(k => keyState[k.id]).length}/3`;
}
function subline(id) {
  const r = records;
  if (id === 'bee') return r.bee.best ? `最高分 ${fmt(r.bee.best)}` : '還沒有紀錄';
  if (id === 'blocks') return r.blocks.marathon ? `MARATHON ${fmt(r.blocks.marathon)}` : r.blocks.sprint ? `SPRINT 40 ${fmtTime(r.blocks.sprint)}` : '還沒有紀錄';
  if (id === 'maze') return r.maze.cleared ? `通過 ${r.maze.cleared} 關・★ ${r.maze.stars}` : '還沒有紀錄';
  if (id === 'pier') return '渡海的小舟・入口石碑';
  if (id === 'gate') return '三鑰齊聚，門已開啟';
  return '';
}
function renderSide() {
  const el = $('#side-body');
  $('#tab-places').classList.toggle('active', ui.tab === 'places');
  $('#tab-keys').classList.toggle('active', ui.tab === 'keys');
  $('#tab-places').setAttribute('aria-selected', String(ui.tab === 'places'));
  $('#tab-keys').setAttribute('aria-selected', String(ui.tab === 'keys'));
  if (ui.tab === 'places') {
    const ids = [...GAMES.map(g => g.id), 'pier', ...(gate.visible ? ['gate'] : [])];
    el.innerHTML = ids.map(id => {
      const P = PLACE[id];
      return `<button class="idx${state.selected === id ? ' active' : ''}" data-place="${id}" style="--c:${P.color}"><span class="no">${P.no}</span><span><b>${esc(P.name)}</b><small>${esc(subline(id))}</small></span><span class="go">${svg('arrow')}</span></button>`;
    }).join('') + `<p class="side-note">紀錄直接讀這台裝置上的遊戲存檔：直接開遊戲玩、或從島上進去玩都算。</p>`;
  } else {
    el.innerHTML = KEYS.map(k => {
      const owned = keyState[k.id], met = k.met(records);
      let state2, note, bar = '';
      if (owned) { state2 = '<span class="state ok">已到手</span>'; note = k.id === 'crystal' ? '你在暗處找到了它。' : `${k.rule}——達成。`; }
      else if (k.id === 'crystal') { state2 = '<span class="state">尋找中</span>'; note = steleRead ? '石碑上寫著：「霓虹照不到的暗處，沉著第三把鑰匙。」' : '藏在島上某個暗處。線索刻在入口的石碑上。'; }
      else if (met) { state2 = '<span class="state ready">已現世</span>'; note = `就在${PLACE[k.place].name}旁的基座上，走過去就能拿。`; }
      else { state2 = `<span class="state">${Math.floor(clamp(k.pct(records), 0, .99) * 100)}%</span>`; note = `${k.rule}。${k.now(records)}`; bar = `<div class="bar" style="--c:${k.color}"><i style="width:${clamp(k.pct(records), 0, 1) * 100}%"></i></div>`; }
      const btn = !owned && met && k.id !== 'crystal' ? `<p><button class="btn" data-getkey="${k.id}" style="height:36px;font-size:13px">${svg('walk')}走過去拿</button></p>` : '';
      return `<div class="keyrow"><div class="keyrow-top">${kchip(k)}<b>${k.name}</b>${state2}</div>${bar}<p>${note}</p>${btn}</div>`;
    }).join('') + `<p class="side-note">三把到齊，沙那賽之門就會出現。${keyState.coin ? '你已經穿過那道門，25¢ 復活幣留在入口。' : ''}</p>`;
  }
}
function renderDock() {
  const ids = [...GAMES.map(g => g.id), 'pier', ...(gate.visible ? ['gate'] : [])];
  $('#dock').innerHTML = ids.map(id => {
    const P = PLACE[id], icon = ICON[id] ? id : 'play';
    return `<button data-place="${id}" style="--c:${P.color};--cs:${tint(P.color)}"${state.selected === id ? ' class="active"' : ''}><i>${svg(icon)}</i><span>${esc(id === 'pier' ? '碼頭' : id === 'gate' ? '門' : P.name)}</span></button>`;
  }).join('');
}
function stat(label, value, cls = '') { return `<div class="stat ${cls}"><small>${label}</small><b>${value}</b></div>`; }
function keyBox(k) {
  const owned = keyState[k.id], met = k.met(records), pct = clamp(k.pct(records), 0, 1);
  const st = owned ? '<span class="state ok">已到手</span>' : met ? '<span class="state ready">已現世</span>' : `<span class="state">${Math.floor(Math.min(pct, .99) * 100)}%</span>`;
  const note = owned ? '鑰匙已經在你身上了。' : met ? `就在${PLACE[k.place].name}旁的基座上，走過去就能拿。` : `${k.rule}。${k.now(records)}`;
  return `<div class="keybox" style="--c:${k.color}"><div class="top">${kchip(k)}<span>${k.name}</span>${st}</div>${owned || met ? '' : `<div class="bar"><i style="width:${pct * 100}%"></i></div>`}<p>${note}</p>${!owned && met ? `<button class="btn" data-getkey="${k.id}">${svg('walk')}走過去拿</button>` : ''}</div>`;
}
function renderCard() {
  const id = state.selected;
  if (!id) return;
  const P = PLACE[id], info = INFO[id] || { eyebrow: 'GAME', lead: '' }, r = records;
  let h = `<div class="card-head"><div class="tile" style="--c:${P.color};--cs:${tint(P.color)}">${svg(ICON[id] ? id : 'play')}</div><div><div class="eyebrow" style="color:${P.color}">${info.eyebrow} ${P.no}</div><h3>${esc(P.name)}<small>${P.en}</small></h3></div></div>`;
  if (info.lead) h += `<p class="lead">${info.lead}</p>`;
  if (info.chips) h += `<div class="chips">${info.chips.map(c => `<span class="chip" style="--c:${P.color}"><i></i>${c}</span>`).join('')}</div>`;
  let actions = '';
  if (P.kind === 'game') {
    const g = GAME[id];
    h += `<div class="sec">我的紀錄</div>`;
    if (id === 'bee') {
      h += r.bee.best ? `<div class="stats">${stat('最高分（所有難度）', fmt(r.bee.best), 'hero')}${stat('普通', fmt(r.bee.normal), r.bee.normal ? '' : 'dim')}${stat('困難', fmt(r.bee.hard), r.bee.hard ? '' : 'dim')}${stat('簡單', fmt(r.bee.easy), r.bee.easy ? '' : 'dim')}${stat('遊玩', `${r.bee.plays} 場`)}${stat('最遠', r.bee.maxStage ? `第 ${r.bee.maxStage} 關` : '—')}${stat('Boss 擊破', r.bee.bossKills)}</div>`
        : `<div class="empty">還沒有紀錄。玩一場，街機館的計分板就會亮起來。</div>`;
      h += `<div class="sec">鑰匙</div>${keyBox(KEY.copper)}`;
    } else if (id === 'blocks') {
      const b = r.blocks;
      h += (b.marathon || b.sprint || b.ultra || b.zen) ? `<div class="stats">${stat('MARATHON', b.marathon ? fmt(b.marathon) : '—', b.marathon ? 'hero' : 'hero dim')}${stat('SPRINT 40', b.sprint ? fmtTime(b.sprint) : '—', b.sprint ? '' : 'dim')}${stat('ULTRA 2:00', b.ultra ? fmt(b.ultra) : '—', b.ultra ? '' : 'dim')}${stat('ZEN', b.zen ? fmt(b.zen) : '—', b.zen ? '' : 'dim')}</div>`
        : `<div class="empty">還沒有紀錄。</div>`;
      h += `<p class="note">島上的方塊塔現在 ${towerLayers(r)} 層：MARATHON 每 2,500 分加一層，金框那層是 ${fmt(MARATHON_TARGET)} 分。</p>`;
      h += `<div class="sec">鑰匙</div>${keyBox(KEY.jade)}`;
    } else if (id === 'maze') {
      const m = r.maze;
      h += m.cleared ? `<div class="stats">${stat('通過', `${m.cleared} / ${MAZE_LEVELS} 關`, 'hero')}${stat('星星', `★ ${m.stars} / ${MAZE_STAR_MAX}`)}${stat('零失誤', `${m.perfect} 關`)}${stat('章節', `${m.chapters.filter(c => c.done).length} / 6`)}</div>`
        : `<div class="empty">還沒有紀錄。</div>`;
      h += `<div class="sec">花園的石燈：整章通關就點亮一盞</div><div class="chapters">${m.chapters.map((c, i) => `<div class="chap${c.done ? ' done' : ''}"><i></i>${i + 1}・${c.name}</div>`).join('')}</div>`;
    } else {
      h += `<div class="empty">這個遊戲還沒有接上島上的紀錄。</div>`;
    }
    actions = `<button class="btn primary" data-act="play">${svg('play')}開始玩</button><a class="btn" href="${g.url}" target="_blank" rel="noopener">${svg('arrow')}新分頁</a>`;
  } else if (id === 'pier') {
    h += `<div class="sec">入口石碑</div>` + (steleRead ? `<p class="quote" style="--c:#5c6570">霓虹照不到的暗處，沉著第三把鑰匙。</p>` : `<div class="empty">石碑上刻了字，走近才看得清楚。</div>`);
    if (keyState.coin) h += `<div class="sec">25¢ 復活幣</div><p class="lead" style="margin-top:0">穿過沙那賽之門的紀念，從此留在碼頭邊。</p>`;
    actions = `<button class="btn primary" data-act="walk">${svg('walk')}走到石碑前</button>`;
  } else if (id === 'gate') {
    actions = `<button class="btn primary" data-act="gate">${svg('walk')}走進門裡</button>`;
  }
  $('#card-body').innerHTML = h;
  $('#card-actions').innerHTML = actions;
}
function renderAll() {
  renderBrandKeys();
  renderSide();
  renderDock();
  markActive();
  if (ui.card) renderCard();
  if (ui.log) renderLog();
}

/* ---------- 日誌 ---------- */
const LOG_KEY = 'sanasai_log', SEEN_KEY = 'sanasai_seen';
let logItems = ls.json(LOG_KEY, []);
if (!Array.isArray(logItems)) logItems = [];
const TAG = { land: ['land', '登島'], rec: ['rec', '紀錄'], key: ['key', '鑰匙'], play: ['play', '遊玩'], gate: ['gate', '門'] };
function addLog(tag, text) {
  logItems.unshift({ t: Date.now(), tag, text });
  logItems = logItems.slice(0, 80);
  ls.set(LOG_KEY, JSON.stringify(logItems));
  if (ui.log) renderLog();
}
function renderLog() {
  $$('[data-logtab]').forEach(b => b.classList.toggle('active', b.dataset.logtab === ui.logTab));
  $('#log-overview').hidden = ui.logTab !== 'overview';
  $('#log-list').hidden = ui.logTab !== 'log';
  if (ui.logTab === 'log') {
    $('#log-list').innerHTML = logItems.length ? logItems.map(e => {
      const d = new Date(e.t), [cls, label] = TAG[e.tag] || TAG.land;
      return `<li><span class="tag ${cls}">${label}</span><span><time>${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}</time>${esc(e.text)}</span></li>`;
    }).join('') : '<li class="empty-row">還沒有紀錄。</li>';
  } else {
    const r = records, plays = ls.json('sanasai_plays', {}) || {};
    $('#log-overview').innerHTML = `<div class="ov-grid">${stat('登島', `${num('sanasai_visits')} 次`)}${stat('鑰匙', `${KEYS.filter(k => keyState[k.id]).length} / 3`)}${stat('25¢ 復活幣', keyState.coin ? '有' : '還沒')}${stat('迷宮章節', `${r.maze.chapters.filter(c => c.done).length} / 6`)}</div>
      <div class="sec">最佳紀錄</div>
      <div class="ov-line"><span>小蜜蜂</span><span>${r.bee.best ? fmt(r.bee.best) : '—'}</span></div>
      <div class="ov-line"><span>Blocks MARATHON</span><span>${r.blocks.marathon ? fmt(r.blocks.marathon) : '—'}</span></div>
      <div class="ov-line"><span>Blocks SPRINT 40</span><span>${r.blocks.sprint ? fmtTime(r.blocks.sprint) : '—'}</span></div>
      <div class="ov-line"><span>迷宮球</span><span>${r.maze.cleared ? `${r.maze.cleared} 關・★ ${r.maze.stars}` : '—'}</span></div>
      <div class="sec">從島上進遊戲</div>
      ${GAMES.map(g => `<div class="ov-line"><span>${esc(g.name)}</span><span>${plays[g.id] || 0} 次</span></div>`).join('')}`;
  }
}

/* ---------- 紀錄對帳：比上次多了什麼就寫進日誌 ---------- */
const snapshot = r => ({ be: r.bee.easy, bn: r.bee.normal, bh: r.bee.hard, bp: r.bee.plays, mar: r.blocks.marathon, spr: r.blocks.sprint, ult: r.blocks.ultra, zen: r.blocks.zen, mc: r.maze.cleared, ms: r.maze.stars });
function diffRecords(a, b) {
  const out = [], up = (k, label) => { if ((b[k] || 0) > (a[k] || 0)) out.push({ tag: 'rec', text: `${label} ${a[k] ? fmt(a[k]) + ' → ' : ''}${fmt(b[k])}` }); };
  up('bn', '小蜜蜂（普通）最高分'); up('bh', '小蜜蜂（困難）最高分'); up('be', '小蜜蜂（簡單）最高分');
  if ((b.bp || 0) > (a.bp || 0)) out.push({ tag: 'play', text: `小蜜蜂玩了 ${b.bp - (a.bp || 0)} 場` });
  up('mar', 'Blocks MARATHON'); up('ult', 'Blocks ULTRA'); up('zen', 'Blocks ZEN');
  if (b.spr && (!a.spr || b.spr < a.spr)) out.push({ tag: 'rec', text: `Blocks SPRINT 40 ${a.spr ? fmtTime(a.spr) + ' → ' : ''}${fmtTime(b.spr)}` });
  if ((b.mc || 0) > (a.mc || 0)) out.push({ tag: 'rec', text: `迷宮球通過第 ${b.mc} 關` });
  if ((b.ms || 0) > (a.ms || 0)) out.push({ tag: 'rec', text: `迷宮球 +${b.ms - (a.ms || 0)} ★（共 ${b.ms}）` });
  return out;
}
function refresh() {
  records = readRecords();
  const cur = snapshot(records), seen = ls.json(SEEN_KEY, null), news = seen ? diffRecords(seen, cur) : [];
  ls.set(SEEN_KEY, JSON.stringify(cur));
  for (const n of news) addLog(n.tag, n.text);
  if (news.length) toast(news.length > 1 ? `${news[0].text}（另有 ${news.length - 1} 項新紀錄）` : news[0].text);
  applyRecords();
  checkKeys();
  renderAll();
}
function applyRecords() {
  if (beeBoard) redraw(beeBoard);
  if (blocksPlaque) redraw(blocksPlaque);
  if (mazePlaque) redraw(mazePlaque);
  setTowerLayers(towerLayers(records));
  if (tower) tower.frameMat.userData.base.setHex(records.blocks.marathon >= MARATHON_TARGET ? 0x4be8a8 : 0xf1c24e);
  if (maze) maze.lanterns.forEach((l, i) => { l.material = records.maze.chapters[i].done ? lanternOn : lanternOff; });
}

/* ---------- 鑰匙狀態機 ---------- */
function checkKeys() {
  for (const k of KEYS) {
    if (k.id === 'crystal') { crystal.group.visible = !keyState.crystal; continue; }
    if (keyState[k.id] || !k.met(records)) { removePedestal(k.id); continue; }
    spawnPedestal(k);
    if (!announced.has(k.id)) {
      announced.add(k.id);
      ls.set('sanasai_announced', JSON.stringify([...announced]));
      addLog('key', `${k.name}現世：在${PLACE[k.place].name}旁的基座上`);
      toast(`${k.name}現世了──在${PLACE[k.place].name}旁`, 'gold');
    }
  }
  if (allKeys() && !keyState.coin) spawnGate();
  coin.visible = !!keyState.coin;
}
function collectKey(k) {
  keyState[k.id] = true;
  saveKeys();
  removePedestal(k.id);
  addLog('key', `取得${k.name}`);
  toast(`${k.name}到手！`, 'gold');
  checkKeys();
  renderAll();
}
function spawnGate() {
  if (gate.visible) return;
  gate.visible = true;
  gateLight.intensity = 6;
  addPin('gate', `<span class="no">${PLACE.gate.no}</span>${PLACE.gate.name}`, PLACE.gate.color, [PLACE.gate.at[0], 6.6, PLACE.gate.at[1]], () => selectPlace('gate'));
  pickables.push(hitBox({ place: 'gate' }, [PLACE.gate.at[0], 3, PLACE.gate.at[1]], [5, 6, 1.2]));
  addLog('gate', '三鑰齊聚——沙那賽之門開啟');
  toast('三鑰齊聚——沙那賽之門開啟', 'gold');
  renderAll();
}
function openEnding() {
  state.inEnding = true;
  keyState.coin = true;
  saveKeys();
  addLog('gate', '穿過沙那賽之門，獲得 25¢ 復活幣');
  $('#ending').hidden = false;
}
$('#btn-ending').addEventListener('click', () => {
  state.inEnding = false;
  $('#ending').hidden = true;
  gate.visible = false;
  gateLight.intensity = 0;
  if (pins.gate) { scene.remove(pins.gate.obj); delete pins.gate; }
  closeCard();
  checkKeys();
  renderAll();
});

/* ---------- 提示、通知 ---------- */
const toastEl = $('#toast'), pendingToasts = [];
let toastTimer = null;
function toast(text, tone = '') {
  if (!landed) { pendingToasts.push([text, tone]); return; }
  toastEl.textContent = text;
  toastEl.className = 'toast show ' + tone;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast ' + tone; }, 2800);
}
const hintEl = $('#hint'), hintText = $('#hint-text');
let hintKey = '';
const DEFAULT_HINT = isTouch ? '點地面走路・點建築看介紹' : '點地面走路・點建築看介紹・方向鍵也能走';
function setHint(key, text, cls = '') {
  if (key === hintKey) return;
  hintKey = key;
  hintText.textContent = text;
  hintEl.className = 'hint panel ' + cls;
}
hintEl.addEventListener('click', () => { if (state.nearGame) enterGame(GAME[state.nearGame]); });

/* ---------- 接近偵測 ---------- */
function updateProximity() {
  const ax = avatar.position.x, az = avatar.position.z, dist = (x, z) => Math.hypot(ax - x, az - z);
  state.nearGame = null;
  for (const g of GAMES) if (dist(g.door[0], g.door[1]) < 1.9) state.nearGame = g.id;
  for (const id in pedestals) { const p = pedestals[id]; if (dist(p.k.spot[0], p.k.spot[1]) < 1.15) collectKey(p.k); }
  const dc = dist(GROTTO[0], GROTTO[1]);
  if (!keyState.crystal) {
    const near = smooth(1 - dc / 6);
    crystal.mat.emissiveIntensity = .06 + near * 1.1;
    crystal.light.intensity = near * (2 + 3 * night);
    if (dc < 1.05) collectKey(KEY.crystal);
  }
  if (gate.visible && !keyState.coin && !state.inEnding && dist(PLACE.gate.at[0], PLACE.gate.at[1]) < 1.25) openEnding();
  const nearStele = dist(STELE[0], STELE[1]) < 2.4;
  if (nearStele && !steleRead) { steleRead = true; ls.set('sanasai_stele', '1'); renderAll(); }
  if (state.nearGame) setHint('g:' + state.nearGame, isTouch ? `點這裡開始玩《${GAME[state.nearGame].name}》` : `按 Enter（或點這裡）開始玩《${GAME[state.nearGame].name}》`, 'prompt');
  else if (nearStele) setHint('stele', '石碑：「霓虹照不到的暗處，沉著第三把鑰匙。」', 'lore');
  else if (!keyState.crystal && dc < 6.5) setHint('dark', dc < 3 ? '岩洞深處有什麼在發光……' : '這裡好暗……', 'lore');
  else if (gate.visible && !keyState.coin && dist(PLACE.gate.at[0], PLACE.gate.at[1]) < 5) setHint('gate', '沙那賽之門──走進去', 'prompt');
  else setHint('default', DEFAULT_HINT);
}

/* ---------- 進出遊戲 ---------- */
const overlay = $('#overlay'), frame = $('#game-frame');
let gameStart = 0, gameId = null;
function enterGame(game) {
  if (uiLock() || !game) return;
  const plays = ls.json('sanasai_plays', {}) || {};
  plays[game.id] = (plays[game.id] || 0) + 1;
  ls.set('sanasai_plays', JSON.stringify(plays));
  addLog('play', `從島上進入《${game.name}》`);
  // 迷宮球靠陀螺儀：手機上直接開整頁，避免 iframe 拿不到傾斜權限
  if (game.id === 'maze' && isTouch) { location.href = game.url; return; }
  state.inGame = true; gameId = game.id; gameStart = Date.now();
  for (const k in keysDown) keysDown[k] = false;
  walk.path = null;
  $('#overlay-title').innerHTML = `${esc(game.name)}<small>${game.en}</small>`;
  $('#ov-newtab').href = game.url;
  frame.src = game.url;
  overlay.hidden = false;
  frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch (e) {} }, { once: true });
}
function closeGame() {
  if (!state.inGame) return;
  state.inGame = false;
  overlay.hidden = true;
  frame.src = 'about:blank';
  const mins = Math.round((Date.now() - gameStart) / 60000);
  if (mins >= 1) addLog('play', `在《${GAME[gameId].name}》待了 ${mins} 分鐘`);
  refresh();
}
$('#btn-back').addEventListener('click', closeGame);

/* ---------- 導覽說明 ---------- */
const INTRO = [
  ['三個遊戲，一座島', '小蜜蜂、Blocks Pro、迷宮球各據島的一角。點建築或清單看介紹，按「開始玩」就進遊戲。'],
  ['分身會替你走過去', isTouch ? '點地面，分身就走到那裡；也可以用左下角的搖桿。單指拖曳轉視角，雙指縮放。' : '點地面，分身就走到那裡；方向鍵或 WASD 也能走。拖曳轉視角，滾輪縮放。'],
  ['島會記得你的紀錄', '遊戲裡的成績會改變這座島：計分板寫著小蜜蜂的最高分，方塊塔跟著 Blocks 的分數長高，迷宮花園整章通關就點亮一盞石燈。'],
  ['三把鑰匙', '銅鑰匙看小蜜蜂，玉鑰匙看 Blocks Pro，水晶鑰匙藏在島上的暗處。三把到齊，沙那賽之門就會出現。'],
];
let introStep = 0;
function showIntro(step = 0) {
  introStep = step;
  state.intro = true;
  const [title, text] = INTRO[step];
  $('#intro-count').textContent = `WELCOME ASHORE / ${pad2(step + 1)}`;
  $('#intro-title').textContent = title;
  $('#intro-body').textContent = text;
  $('#intro-dots').innerHTML = INTRO.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
  $('#intro-next').textContent = step === INTRO.length - 1 ? '開始探索' : '下一步 →';
  $('#intro').hidden = false;
}
function closeIntro() {
  state.intro = false;
  $('#intro').hidden = true;
  ls.set('sanasai_intro_v2', '1');
}
$('#intro-next').addEventListener('click', () => introStep < INTRO.length - 1 ? showIntro(introStep + 1) : closeIntro());
$('#intro-skip').addEventListener('click', closeIntro);

/* ---------- 介面事件 ---------- */
$('#btn-home').addEventListener('click', overview);
$('#btn-index').addEventListener('click', () => openSide(!ui.side));
$('#btn-help').addEventListener('click', () => showIntro(0));
$('#btn-time').addEventListener('click', () => {
  const order = ['auto', 390, 720, 1070, 1290], next = order[(order.findIndex(m => String(m) === String(timeMode)) + 1) % order.length];
  setTime(next);
  toast(`時段：${TIME_LABEL[next]}`);
});
$$('[data-time]').forEach(b => b.addEventListener('click', () => setTime(b.dataset.time === 'auto' ? 'auto' : +b.dataset.time)));
$$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.toggle;
  if (t === 'log') return openLog(!ui.log);
  if (t === 'bird') return setBird(!state.bird);
  state[t] = !state[t];
  if (t === 'names') body.classList.toggle('names-off', !state.names);
  $$(`[data-toggle=${t}]`).forEach(x => x.setAttribute('aria-pressed', String(state[t])));
}));
$('#tab-places').addEventListener('click', () => { ui.tab = 'places'; renderSide(); });
$('#tab-keys').addEventListener('click', () => { ui.tab = 'keys'; renderSide(); });
$('#side-handle').addEventListener('click', () => openSide(false));
$('#card-handle').addEventListener('click', () => { ui.full = !ui.full; syncLayout(); });
$('#card-close').addEventListener('click', () => closeCard());
$('#log-close').addEventListener('click', () => openLog(false));
$('#log-handle').addEventListener('click', () => openLog(false));
$$('[data-logtab]').forEach(b => b.addEventListener('click', () => { ui.logTab = b.dataset.logtab; renderLog(); }));
document.addEventListener('click', e => {
  const el = e.target.closest('[data-place], [data-getkey], [data-act]');
  if (!el) return;
  if (el.dataset.getkey) return goToKey(el.dataset.getkey);
  if (el.dataset.place) return selectPlace(el.dataset.place);
  const act = el.dataset.act, id = state.selected;
  if (act === 'play') enterGame(GAME[id]);
  if (act === 'walk') { walkTo(STELE[0] + .6, STELE[1] + 1.4, { follow: true, mark: true }); if (isMobile()) closeCard(); }
  if (act === 'gate') { walkTo(PLACE.gate.at[0], PLACE.gate.at[1], { follow: true, mark: true }); if (isMobile()) closeCard(); }
});

/* 點 3D 場景：點建築＝看介紹，點地面＝走過去 */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  dragging = true;
  if (fly) { fly = null; controls.enabled = true; }
});
addEventListener('pointerup', e => {
  dragging = false;
  if (!down || e.pointerId !== down.id) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dtm = performance.now() - down.t;
  down = null;
  if (moved > 8 || dtm > 650 || uiLock() || e.target !== renderer.domElement) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  if (hit) return selectPlace(hit.object.userData.place);
  const g = ray.intersectObjects(groundPick, false)[0];
  if (g) walkTo(g.point.x, g.point.z, { follow: true, mark: true });
});
addEventListener('pointercancel', () => { dragging = false; down = null; });

/* 鍵盤 */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (state.inGame) closeGame();
    else if (state.intro) closeIntro();
    else if (ui.card) closeCard();
    else if (ui.log) openLog(false);
    else if (isMobile() && ui.side) openSide(false);
    return;
  }
  if (uiLock() || state.intro) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    keysDown[k] = true;
    e.preventDefault();
  }
  if (e.key === 'Enter' && state.nearGame && (document.activeElement === body || document.activeElement === renderer.domElement)) enterGame(GAME[state.nearGame]);
  if (DEBUG) {
    if (e.key === '7') { ls.set('bee_hi_normal', String(BEE_TARGET + 500)); toast('DEBUG：偽造小蜜蜂紀錄'); refresh(); }
    if (e.key === '8') { ls.set('tetris2_best_marathon', String(MARATHON_TARGET + 500)); toast('DEBUG：偽造 Blocks 紀錄'); refresh(); }
    if (e.key === '6') { ls.set('maze_cleared', '14'); ls.set('maze_stars', JSON.stringify(Object.fromEntries([...Array(14)].map((_, i) => [i, 3])))); toast('DEBUG：偽造迷宮球紀錄'); refresh(); }
    if (e.key === '9') { const [x, z] = polar(-2.36, .78); avatar.position.set(x, groundY(x, z), z); startFollow(); toast('DEBUG：傳送到暗處附近'); }
  }
});
addEventListener('keyup', e => { keysDown[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keysDown) keysDown[k] = false; });

/* 觸控搖桿 */
{
  const pad = $('#joystick'), stick = $('#stick');
  let active = null;
  const move = e => {
    const r = pad.getBoundingClientRect(), half = r.width / 2;
    let dx = e.clientX - (r.left + half), dy = e.clientY - (r.top + half);
    const len = Math.hypot(dx, dy), max = half - 14;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.x = dx / max; joy.y = dy / max;
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = e => {
    if (e.pointerId !== active) return;
    active = null; joy.x = 0; joy.y = 0;
    stick.style.transform = '';
  };
  pad.addEventListener('pointerdown', e => { active = e.pointerId; pad.setPointerCapture(e.pointerId); move(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === active) move(e); });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

/* 回到這一頁（從新分頁或整頁遊戲回來）就重新對帳 */
addEventListener('pageshow', e => { if (e.persisted) refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.inGame) refresh(); });
addEventListener('storage', e => { if (e.key && !e.key.startsWith('sanasai_')) refresh(); });

/* ---------- 主迴圈 ---------- */
const clock = new THREE.Clock();
let elapsed = 0, screenT = 0;
function updateAmbient(dt, t) {
  const wp = water.geometry.attributes.position, amp = water.userData.amp;
  for (let i = 0; i < wp.count; i++) {
    const a = amp[i];
    if (!a) continue;
    const x = wp.getX(i), z = wp.getZ(i);
    wp.setY(i, a * (Math.sin(x * .32 + t * 1.2) + .8 * Math.sin(z * .41 - t * .9) + .5 * Math.sin((x - z) * .23 + t * .7)));
  }
  wp.needsUpdate = true;
  foam.material.opacity = .32 + .2 * Math.sin(t * 1.3);
  foam.scale.setScalar(1 + .006 * Math.sin(t * 1.3));
  boat.position.y = Math.sin(t * 1.4) * .06;
  boat.rotation.z = Math.sin(t * 1.1) * .04;
  clouds.rotation.y = t * .004;
  for (const b of birds) {
    const u = b.userData, a = t * u.sp + u.ph;
    b.position.set(Math.cos(a) * u.R, u.h + Math.sin(t * .8 + u.ph) * .6, Math.sin(a) * u.R);
    b.rotation.y = -a;
    const f = Math.sin(t * 9 + u.ph) * .5;
    u.w1.rotation.z = f; u.w2.rotation.z = -f;
  }
  if (fighter) {
    fighter.position.y = fighter.userData.y + Math.sin(t * 1.6) * .18;
    fighter.rotation.y = t * .5;
  }
  if (gate.visible && gateShimmer) gateShimmer.material.opacity = .18 + .12 * Math.sin(t * 2.2);
  if (neonMat && night > .5) neonMat.color.setScalar(2.0 * (Math.sin(t * 23) > .97 ? .55 : 1));
  for (const id in pedestals) { const p = pedestals[id]; p.key.rotation.y = t * 1.5; p.key.position.y = 1.55 + Math.sin(t * 2.2) * .1; }
  if (coin.visible) coin.userData.disc.rotation.z = t * 1.6;
  crystal.group.rotation.y = t * .25;
  screenT += dt;
  if (beeScreen && screenT > .1) { screenT = 0; redraw(beeScreen); }
  updateTower(dt);
  updateMaze(dt, t);
}
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), .05);
  if (state.inGame) return;
  if (!state.freeze) elapsed += dt;
  updateTime(dt);
  updateAvatar(dt);
  updateCamera(dt);
  if (!state.freeze) updateAmbient(dt, elapsed);
  updateProximity();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

addEventListener('resize', () => {
  const wasMobile = body.classList.contains('is-mobile');
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < .85 ? 48 : 38;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  body.classList.toggle('is-mobile', isMobile());
  if (wasMobile !== isMobile()) { ui.side = !isMobile() && ui.sidePref; ui.log = false; syncLayout(); }
});

/* ---------- 開場：渡海（點擊即登島，否則 5 秒後自動）→ 鏡頭從海上飛向島 ---------- */
for (const id of [...GAMES.map(g => g.id), 'pier']) {
  const P = PLACE[id];
  const y = id === 'bee' ? 5.6 : id === 'blocks' ? 3.6 : id === 'maze' ? 2.4 : 2.5;
  addPin(id, `<span class="no">${P.no}</span>${esc(P.name)}`, P.color, [P.at[0], y, P.at[1]], () => selectPlace(id));
}
camera.fov = innerWidth / innerHeight < .85 ? 48 : 38;
camera.updateProjectionMatrix();
body.classList.toggle('is-mobile', isMobile());
camera.position.set(4, 3.2, 35);
controls.target.set(0, 1.6, 14);
controls.update();

const visits = num('sanasai_visits') + 1;
ls.set('sanasai_visits', String(visits));
addLog('land', ls.get(SEEN_KEY) ? `第 ${visits} 次登島` : '第一次登島');
setTime('auto');
applyDay(curMin);
refresh();
syncLayout();
renderAll();

const splash = $('#splash');
let splashGone = false;
function hideSplash() {
  if (splashGone) return;
  splashGone = true;
  splash.style.opacity = '0';
  splash.style.pointerEvents = 'none';
  setTimeout(() => { splash.style.display = 'none'; }, 1300);
  flyTo(overviewPose(), 3.2, () => {
    landed = true;
    walkTo(0, 13.6);
    if (!ls.get('sanasai_intro_v2')) showIntro(0);
    pendingToasts.splice(0).forEach(([text, tone], i) => setTimeout(() => toast(text, tone), i * 3000));
  });
}
setTimeout(hideSplash, 5200);
splash.addEventListener('pointerdown', hideSplash, { once: true });
tick();

/* 除錯／測試用的唯讀入口 */
window.sanasai = { PLACE, GAMES, KEYS, keyState, state, ui, avatar, camera, controls, records: () => records, select: selectPlace, walkTo, overview, setTime, hideSplash, findPath };
