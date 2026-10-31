/* HERMIT 隱嶼：一座島、三個遊戲（小蜜蜂／Blocks Pro／迷宮球）。存檔鍵沿用舊名 sanasai_*（改了紀錄會不見）。
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
const approach = (v, to, s) => v < to ? Math.min(to, v + s) : Math.max(to, v - s);   // 往 to 走，每次最多 s
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

/* ---------- 遊戲清單：新遊戲上架＝加一行（at＝機台位置，正面自動朝廣場；door 由機台位置算出） ---------- */
const GAMES = [
  { id: 'bee',    name: '小蜜蜂',     en: 'BEE',        url: 'https://garychiang23-creator.github.io/bee/mobile.html', color: '#d29300', at: [8.8, 2.4],   door: [0, 0] },
  { id: 'blocks', name: 'Blocks Pro', en: 'BLOCKS PRO', url: 'https://garychiang23-creator.github.io/blocks/',        color: '#2f8fd0', at: [6.3, -7.4],  door: [0, 0] },
  { id: 'maze',   name: '迷宮球',     en: 'TILT MAZE',  url: 'https://garychiang23-creator.github.io/maze/',          color: '#4c9a56', at: [-6.2, -6.0], door: [0, 0] },
];
const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));

const INFO = {
  bee: { eyebrow: 'ARCADE', lead: '經典射擊街機。三種難度各自記分，打倒 Boss，每 3 萬分多一條命。', chips: ['三種難度', 'Boss 戰', '手機可玩'] },
  blocks: { eyebrow: 'PUZZLE', lead: '方塊消除。MARATHON 每 10 行升一級，SPRINT 40 比誰先清完 40 行，ULTRA 只有兩分鐘，ZEN 不會結束。', chips: ['四種模式', '手機可玩'] },
  maze: { eyebrow: 'TILT', lead: '傾斜手機讓球滾進終點；電腦用方向鍵。6 章 30 關，零失誤過關拿三顆星。', chips: ['陀螺儀', '6 章 30 關'] },
  pier: { eyebrow: 'LANDING', lead: '一艘老飛船停在碼頭邊，登船就能自己開著繞島。碼頭盡頭可以釣魚；上岸第一眼看到的，是一塊刻了字的石碑。' },
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
PLACE.gate = { id: 'gate', no: pad2(GAMES.length + 2), kind: 'gate', name: '隱嶼之門', en: 'GATE', color: '#b8841f', at: [0, -11.4], door: [0, -9.8] };
const CAB_VIEW = {   // 機台座標系：look＝看的點，dir＝鏡頭在哪一側，el＝仰角
  bee: { look: [0, 5.0, .6], dir: [.3, 1], dist: 19, el: .42 },
  blocks: { look: [1.3, 2.9, 0], dir: [.25, 1], dist: 17, el: .55 },
  maze: { look: [-3.2, 1.0, 2.0], dir: [-.5, 1], dist: 16, el: .8 },
};
const VIEW = {
  pier: { dir: [.95, .75], dist: 15, look: .7 },
  gate: { dir: [.18, 1], dist: 21, look: 2.6 },
};

const ICON = {
  bee: '<path d="M12 6.5c2.9 0 5 2.6 5 6s-2.1 6.5-5 6.5-5-3.1-5-6.5 2.1-6 5-6z"/><path d="M7.3 11h9.4M7.2 14.5h9.6"/><path d="M10.2 6.9C9 4.6 6.6 3.9 5.4 5.1s.2 3.8 2.4 4M13.8 6.9c1.2-2.3 3.6-3 4.8-1.8s-.2 3.8-2.4 4"/>',
  blocks: '<path d="M3.5 13.5H9V19H3.5zM9 13.5h5.5V19H9zM9 8h5.5v5.5H9zM14.5 8H20v5.5h-5.5z"/>',
  maze: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.2H11M14.5 3.5v5.7M8 14.3h12.5M8 14.3v6.2M14.5 14.3v-2.2"/><circle cx="17.2" cy="17.6" r="1.4"/>',
  pier: '<circle cx="11" cy="11" r="5.2"/><circle cx="11" cy="11" r="1.5"/><path d="M9.6 6.2V2.6M12.4 6.2V2.6M15.9 8.6l.5-3.2"/><circle cx="16.6" cy="4.3" r="1.1"/><path d="M3 20c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
  gate: '<path d="M6 21V7.5M18 21V7.5M3.5 4.5h17M4.5 7.5h15M5 11h14"/>',
  key: '<circle cx="8" cy="8.5" r="4"/><path d="M11 11.5 20 20.5M15.5 16l2.2-2.2M18 18.5l2.2-2.2"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  paw: '<circle cx="6.5" cy="10" r="1.7"/><circle cx="10" cy="6.2" r="1.7"/><circle cx="14.5" cy="6.2" r="1.7"/><circle cx="18" cy="10" r="1.7"/><path d="M8 17c0-2.6 1.9-4.6 4.2-4.6s4.3 2 4.3 4.6c0 1.6-1.4 2.4-2.8 2.1l-1.5-.3-1.5.3C9.3 19.4 8 18.6 8 17z"/>',
  wave: '<path d="M3 16c2 0 2-1.8 4.5-1.8S9.5 16 12 16s2-1.8 4.5-1.8S19 16 21 16"/><path d="M6.5 12.5C8 9 10.6 7.2 13.6 7.2c1.8 0 3.2.6 4.2 1.7l1.9-1.2-.6 3.2"/>',
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
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
scene.add(skyDome);

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
  frust: new THREE.CylinderGeometry(.26, .5, 1, 28),   // 截頭圓錐（上窄下寬）
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
const keepRect = (x, z, w, d, ry = 0) => KEEP.push({ x, z, hw: w / 2, hd: d / 2, ry });
function inRect(o, x, z, pad) {
  const dx = x - o.x, dz = z - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry);
  return Math.abs(dx * c - dz * s) < o.hw + pad && Math.abs(dx * s + dz * c) < o.hd + pad;
}
const hitsObstacle = (x, z, pad) => OBST.some(o => o.r !== undefined ? (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2 : inRect(o, x, z, pad));
const freeSpot = (x, z, pad) => !hitsObstacle(x, z, pad) && !KEEP.some(k => k.r !== undefined ? Math.hypot(x - k.x, z - k.z) < k.r + pad : inRect(k, x, z, pad));

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
  [[0, 3.0], [0, -1.6], [0, -6.4], [0, -10.2]],
];
function buildPaths() {
  const pr = mulberry32(31), stones = [0xe9dfca, 0xe1d5be, 0xf1e8d6];
  const gamePaths = GAMES.map(g => {
    const a = Math.atan2(g.door[1] - PLAZA[1], g.door[0] - PLAZA[0]), st = [PLAZA[0] + Math.cos(a) * 3.5, PLAZA[1] + Math.sin(a) * 3.5];
    return [st, [(st[0] + g.door[0]) / 2 - Math.sin(a) * .6, (st[1] + g.door[1]) / 2 + Math.cos(a) * .6], [g.door[0], g.door[1]]];
  });
  for (const pts of [...PATHS, ...gamePaths]) {
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

/* ---------- 入口碼頭、老飛船、石碑 ---------- */
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
}
/* 碼頭邊的老飛船：圓盤船身、船頭兩支長叉、右舷駕駛艙、左舷雷達碟、中央砲塔、船尾一排藍色引擎光。造型是致敬，網站上不寫名字。
   船的局部座標：-z＝船頭、+x＝右舷；轉 180° 後船頭朝海，右舷（駕駛艙、登船坡道）朝碼頭 */
const SHIP = { x: 4.35, y: 1.3, z: 19.4, r: 2.3 };   // z 讓坡道落在碼頭兩根木樁中間
const ship = new THREE.Group();
let ramp = null;   // 登船坡道：起飛前縮回船腹，降落後放下
const shipGlow = new THREE.MeshBasicMaterial({ vertexColors: true });   // 引擎光：飛行時比平常亮
const RAMP_Z = SHIP.z - SHIP.r * .15;
const RAMP_PTS = [[PIER.x1 - .15, DECK_Y, RAMP_Z], [PIER.x1 + .25, DECK_Y + .07, RAMP_Z], [SHIP.x - SHIP.r * .74, SHIP.y - SHIP.r * .17, RAMP_Z], [SHIP.x - SHIP.r * .45, SHIP.y - SHIP.r * .1, RAMP_Z]];   // 碼頭上 → 碼頭邊 → 坡道頂 → 船裡
function buildShip() {
  const R = SHIP.r, L = [], GL = [], hull = 0xd6d3cb, wall = 0xa4a199, plate = 0xbdbab2, line = 0x8e8b84, dark = 0x575b62, rust = 0xa65a3f;
  // 船身：從上面看的整片輪廓（圓盤＋兩支叉，中間一道缺口）擠出厚度，側邊是一圈直立的機械牆。輪廓座標 (u, v)：u＝右舷、v＝船頭
  const A = R * .62, B = R * .12, TIP = R * 1.78, CH = R * .12, SLOT = R * .9, J = Math.sqrt(R * R - A * A), a0 = Math.atan2(J, A);
  const sh = new THREE.Shape();
  sh.moveTo(A, J);
  sh.absarc(0, 0, R, a0, Math.PI - a0, true);
  for (const [u, v] of [[-A, TIP - CH], [-A + CH, TIP], [-B, TIP], [-B, SLOT], [B, SLOT], [B, TIP], [A - CH, TIP], [A, TIP - CH]]) sh.lineTo(u, v);   // 最後一段自動接回起點
  const g = new THREE.ExtrudeGeometry(sh, { depth: R * .2, bevelEnabled: true, bevelThickness: R * .03, bevelSize: R * .03, bevelSegments: 1, curveSegments: 14 });
  g.rotateX(-Math.PI / 2).translate(0, -R * .1, 0);   // (u, v, 厚度) → (x, y, z)＝(u, 厚度, -v)
  g.deleteAttribute('uv');
  const nm = g.attributes.normal, gc = new Float32Array(nm.count * 3), cTop = new THREE.Color(hull), cWall = new THREE.Color(wall);
  for (let i = 0; i < nm.count; i += 3) {
    const c = Math.abs(nm.getY(i)) > .5 ? cTop : cWall, k = 1 + (rnd() - .5) * .05;
    for (let v = i; v < i + 3; v++) gc.set([c.r * k, c.g * k, c.b * k], v * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  L.push(g);
  // 上下各一層往中間隆起的斜面；slopeY＝上斜面在半徑 r 處的高度
  const yT = R * .13, slope = Math.atan2(R * .1, R * .466), slopeY = r => yT + R * .1 * clamp((R * .97 - r) / (R * .466), 0, 1);
  part('frust', [0, yT + R * .05, 0], [R * 1.94, R * .1, R * 1.94], hull, { into: L, jit: .04 });
  part('frust', [0, -yT - R * .04, 0], [R * 1.94, R * .08, R * 1.94], wall, { into: L, rx: Math.PI });
  for (let i = 0; i < 16; i++) {   // 斜面上放射狀的接縫線，船頭中線那條讓給前面的長條
    const t = i / 16 * TAU + .2;
    if (Math.abs(t % TAU - Math.PI / 2) < .25) continue;
    part('box', [Math.cos(t) * R * .735, slopeY(R * .735) + R * .006, -Math.sin(t) * R * .735], [R * .47, R * .012, R * .02], line, { into: L, ry: t, rz: -slope });
  }
  // 中央：深色邊的圓台＋雙管砲塔
  part('disc', [0, yT + R * .115, 0], [R * .9, R * .03, R * .9], line, { into: L });
  part('disc', [0, yT + R * .13, 0], [R * .84, R * .04, R * .84], plate, { into: L });
  part('cyl', [0, yT + R * .17, 0], [R * .34, R * .05, R * .34], dark, { into: L });
  part('sphere', [0, yT + R * .2, 0], [R * .28, R * .14, R * .28], plate, { into: L });
  for (const s of [-1, 1]) part('box', [s * R * .045, yT + R * .21, -R * .2], [R * .025, R * .025, R * .26], dark, { into: L });
  // 船頭：兩支叉中間的長條、叉上的凸條和圓艙口
  part('box', [0, slopeY(R * .72) + R * .035, -R * .72], [R * .26, R * .07, R * .5], plate, { into: L, rx: -slope });
  for (const s of [-1, 1]) {
    part('box', [s * R * .3, yT + R * .025, -R * 1.28], [R * .18, R * .05, R * .9], plate, { into: L });
    for (const vz of [1.15, 1.5]) part('disc', [s * R * .51, yT + R * .006, -R * vz], [R * .12, R * .02, R * .12], dark, { into: L });
  }
  // 船尾上方三個圓口、兩塊紅漆、左舷對接環、側牆上的機械零件
  for (const d of [-.45, 0, .45]) { const t = Math.PI * 1.5 + d; part('disc', [Math.cos(t) * R * .7, slopeY(R * .7) + R * .012, -Math.sin(t) * R * .7], [R * .16, R * .02, R * .16], dark, { into: L }); }
  part('box', [R * .3, slopeY(R * .55) + R * .01, R * .38], [R * .16, R * .015, R * .1], rust, { into: L, ry: .6 });
  part('box', [R * .62, slopeY(R * .72) + R * .01, -R * .35], [R * .12, R * .015, R * .18], rust, { into: L, ry: -.3 });
  part('disc', [-R * 1.035, 0, R * .05], [R * .26, R * .03, R * .26], dark, { into: L, rz: Math.PI / 2 });
  part('disc', [-R * 1.05, 0, R * .05], [R * .16, R * .02, R * .16], plate, { into: L, rz: Math.PI / 2 });
  [120, 140, 160, 180, 200, 220, 240, 300, 320, 340].forEach((deg, k) => {
    const t = deg * Math.PI / 180;
    part('box', [Math.cos(t) * R * 1.035, R * (k % 2 ? .03 : -.04), -Math.sin(t) * R * 1.035], [R * .1, R * .07, R * .03], dark, { into: L, ry: t + Math.PI / 2 });
  });
  // 右舷駕駛艙：一截通道往前伸，前端是圓筒＋錐形鼻，正面是蜘蛛網窗框
  const cx = R * .98;
  part('cyl', [cx, 0, -R * .255], [R * .26, R * .51, R * .26], hull, { into: L, rx: Math.PI / 2 });
  for (const vz of [.15, .35]) part('cyl', [cx, 0, -R * vz], [R * .29, R * .03, R * .29], wall, { into: L, rx: Math.PI / 2 });
  part('cyl', [cx + R * .02, 0, -R * .66], [R * .38, R * .3, R * .38], hull, { into: L, rx: Math.PI / 2 });
  part('frust', [cx + R * .02, 0, -R * .87], [R * .38, R * .12, R * .38], hull, { into: L, rx: -Math.PI / 2 });
  part('disc', [cx + R * .02, 0, -R * .935], [R * .2, R * .01, R * .2], dark, { into: L, rx: Math.PI / 2 });
  part('disc', [cx + R * .02, 0, -R * .94], [R * .15, R * .005, R * .15], 0x5d8fb8, { into: GL, rx: Math.PI / 2 });   // 駕駛艙窗，晚上會亮
  for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3 + Math.PI / 6; part('box', [cx + R * .02 + Math.cos(t) * R * .045, Math.sin(t) * R * .045, -R * .945], [R * .09, R * .016, R * .006], plate, { into: L, rz: t }); }
  // 左舷雷達碟（內圈深一點，看起來是凹的）
  part('cyl6', [-R * .48, slopeY(R * .64) + R * .07, -R * .42], [R * .04, R * .14, R * .04], dark, { into: L });
  part('disc', [-R * .48, slopeY(R * .64) + R * .15, -R * .42], [R * .24, R * .025, R * .24], 0xcfcac0, { into: L, rz: .55, rx: -.25 });
  part('disc', [-R * .48, slopeY(R * .64) + R * .15, -R * .42], [R * .14, R * .03, R * .14], 0xa19d94, { into: L, rz: .55, rx: -.25 });
  // 船尾一排引擎光
  for (let i = 0; i < 11; i++) {
    const t = Math.PI * 1.5 + (i - 5) / 5 * .96;
    part('box', [Math.cos(t) * R * 1.04, 0, -Math.sin(t) * R * 1.04], [R * .215, R * .17, R * .03], 0x8fd8ff, { into: GL, ry: t + Math.PI / 2 });
  }
  // 登船坡道：從右舷船腹斜放到碼頭邊；以船腹那端為軸，起飛前縮回船裡
  const x0 = R * .74, y0 = -R * .17, x1 = SHIP.x - (PIER.x1 + .25), y1 = DECK_Y + .07 - SHIP.y, RL = [], len = Math.hypot(x1 - x0, y1 - y0);
  part('box', [len / 2, 0, 0], [len, .07, .9], 0x6f737a, { into: RL });
  ramp = new THREE.Group();
  ramp.position.set(x0, y0, R * .15);
  ramp.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  ramp.add(merged(RL, MAT.solid));
  ship.add(merged(L, MAT.solid), ramp, merged(GL, shipGlow, false));
  ship.rotation.order = 'YXZ';   // 飛行時：先偏航、再俯仰、最後側傾
  ship.position.set(SHIP.x, SHIP.y, SHIP.z);
  ship.rotation.y = Math.PI;
  scene.add(ship);
  keep(SHIP.x, SHIP.z, R + .8);
  pickables.push(hitBox({ place: 'pier' }, [SHIP.x - R * .08, SHIP.y, SHIP.z + R * .37], [R * 2.25, 1.4, R * 2.85]));
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

/* ---------- 三台大型機台：同款同尺寸，遊戲從螢幕裡溢出來 ---------- */
const CAB = {}, marqueeMats = [];
let neonMat = null;
/* 機台座標系：正面（局部 +z）朝廣場 */
function cabFrame(g) {
  const [x, z] = g.at, ry = Math.atan2(PLAZA[0] - x, PLAZA[1] - z);
  return { x, z, y: groundY(x, z), ry, w: (lx, lz) => local(x, z, ry, lx, lz) };
}
for (const g of GAMES) { const d = cabFrame(g).w(0, 2.6); g.door[0] = d[0]; g.door[1] = d[1]; }
/* 鑰匙基座擺在機台左前方，不擋紀錄牌 */
KEY.copper.spot.splice(0, 2, ...cabFrame(GAME.bee).w(-2.4, 2.2));
KEY.jade.spot.splice(0, 2, ...cabFrame(GAME.blocks).w(-2.4, 1.2));

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
const SCREEN_PAL = ['#3cc4ee', '#f5c541', '#a46ad6', '#5cc46a', '#ee5d57', '#3f73e3', '#f39a3b'];
function drawBlocksScreen(x, w, h) {
  const t = performance.now() / 1000, cs = 10, cols = 7, rows = 11, ox = (w - cols * cs) / 2, oy = 8;
  x.fillStyle = '#070a18'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#2b3566'; x.lineWidth = 2; x.strokeRect(ox - 2, oy - 2, cols * cs + 4, rows * cs + 4);
  for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) if ((r * 5 + c * 3) % 7 !== 2) {
    x.fillStyle = SCREEN_PAL[(r * 2 + c) % 7];
    x.fillRect(ox + c * cs + 1, oy + (rows - 1 - r) * cs + 1, cs - 2, cs - 2);
  }
  const k = ((t * 2.2) % 7) | 0;
  x.fillStyle = SCREEN_PAL[((t / 3.2) | 0) % 7];
  for (const [cx, cy] of [[0, 0], [1, 0], [2, 0], [1, 1]]) x.fillRect(ox + (2 + cx) * cs + 1, oy + (k + cy) * cs + 1, cs - 2, cs - 2);
}
let screenMaze = null;
function drawMazeScreen(x, w, h) {
  if (!screenMaze) screenMaze = genMaze(5, mulberry32(12));
  const t = performance.now() / 1000, n = 5, cs = 22, o = (w - n * cs) / 2, W = screenMaze.walls, P = screenMaze.path;
  x.fillStyle = '#0b1610'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#69c26f'; x.lineWidth = 3; x.lineCap = 'round';
  x.strokeRect(o, o, n * cs, n * cs);
  x.beginPath();
  for (let c = 0; c < n * n; c++) {
    const i = c % n, j = (c / n) | 0;
    if (W[c][1] && i < n - 1) { x.moveTo(o + (i + 1) * cs, o + j * cs); x.lineTo(o + (i + 1) * cs, o + (j + 1) * cs); }
    if (W[c][2] && j < n - 1) { x.moveTo(o + i * cs, o + (j + 1) * cs); x.lineTo(o + (i + 1) * cs, o + (j + 1) * cs); }
  }
  x.stroke();
  x.fillStyle = '#000'; x.beginPath(); x.arc(o + (n - .5) * cs, o + (n - .5) * cs, 6, 0, TAU); x.fill();
  const f = (t * 1.6) % (P.length - 1), a = P[f | 0], b = P[(f | 0) + 1], k = f % 1;
  x.fillStyle = '#e8edf5'; x.beginPath();
  x.arc(o + (lerp(a % n, b % n, k) + .5) * cs, o + (lerp((a / n) | 0, (b / n) | 0, k) + .5) * cs, 6, 0, TAU); x.fill();
}
/* 三台共用的紀錄牌：版型一樣，內容各自 */
function drawPlaque(x, w, h, g) {
  const r = records;
  let label = g.en, big = '▶', sub = g.name;
  if (g.id === 'bee') { label = 'HI-SCORE'; big = r.bee.best ? fmt(r.bee.best) : '—'; sub = r.bee.best ? `普通 ${fmt(r.bee.normal)}・困難 ${fmt(r.bee.hard)}` : '還沒有紀錄'; }
  if (g.id === 'blocks') { label = 'MARATHON'; big = r.blocks.marathon ? fmt(r.blocks.marathon) : '—'; sub = r.blocks.sprint ? `SPRINT 40　${fmtTime(r.blocks.sprint)}` : '還沒有紀錄'; }
  if (g.id === 'maze') { label = 'STARS'; big = `★ ${r.maze.stars}`; sub = r.maze.cleared ? `通過 ${r.maze.cleared} / ${MAZE_LEVELS} 關` : '還沒有紀錄'; }
  x.fillStyle = '#f7f1e4'; rr(x, 4, 4, w - 8, h - 8, 24); x.fill();
  x.lineWidth = 7; x.strokeStyle = g.color; x.stroke();
  x.textAlign = 'left';
  x.fillStyle = g.color; x.font = `600 28px ${FONT_D}`; x.fillText(label, 34, 62);
  x.fillStyle = '#16213a'; x.font = `600 76px ${FONT_D}`; x.fillText(big, 34, 148);
  x.fillStyle = '#6b7184'; x.font = `500 28px ${FONT_C}`; x.fillText(sub, 34, 212);
}
function buildCabinet(g) {
  const F = cabFrame(g), G = new THREE.Group(), L = [], col = hexNum(g.color);
  G.position.set(F.x, F.y, F.z);
  G.rotation.y = F.ry;
  scene.add(G);
  part('disc', [0, .08, 0], [3.5, .16, 3.5], 0xd9cfbd, { into: L });
  part('box', [0, .32, -.1], [2.04, .32, 1.54], 0x1a2036, { into: L });
  part('box', [0, 1.4, -.1], [2.0, 1.84, 1.5], 0x232b46, { into: L });
  part('box', [0, 1.05, .66], [.74, .6, .04], 0x2e3759, { into: L });
  part('box', [0, 2.42, .42], [2.04, .2, .82], 0x2e3759, { into: L, rx: -.32 });
  part('cyl', [-.48, 2.68, .5], [.1, .34, .1], 0xdedede, { into: L });
  part('sphere', [-.48, 2.88, .5], [.24, .24, .24], col, { into: L });
  for (const [bx, bz, c] of [[.1, .6, 0xf6c33b], [.42, .52, 0x3fc3f0], [.74, .44, 0xe14b4b]]) part('cyl', [bx, 2.58, bz], [.17, .07, .17], c, { into: L });
  part('box', [0, 3.42, -.32], [2.0, 1.78, 1.12], 0x232b46, { into: L });
  part('box', [0, 3.4, .25], [1.76, 1.44, .06], 0x0d1120, { into: L, rx: -.08 });
  part('box', [0, 4.6, -.22], [2.08, .64, 1.02], 0x161b31, { into: L });
  part('box', [0, 4.98, -.3], [2.14, .12, 1.3], 0x1a2036, { into: L });
  for (const sx of [-1, 1]) {
    part('box', [sx * 1.02, 2.6, -.15], [.04, 4.4, 1.32], col, { into: L });
    part('box', [sx * 1.035, 1.55, -.15], [.03, .42, 1.2], 0xfff3d6, { into: L });
  }
  G.add(merged(L, MAT.solid));
  for (const sx of [-.16, .16]) { const m = new THREE.Mesh(BASE.box, glowMat(0xffb35c)); m.scale.set(.1, .22, .03); m.position.set(sx, 1.1, .69); G.add(m); }
  const draw = { bee: drawBeeScreen, blocks: drawBlocksScreen, maze: drawMazeScreen }[g.id] || ((x, w, h) => {
    x.fillStyle = '#0b1020'; x.fillRect(0, 0, w, h);
    x.fillStyle = g.color; x.font = `600 22px ${FONT_D}`; x.textAlign = 'center'; x.fillText(g.en.slice(0, 9), w / 2, h / 2 + 8);
  });
  const screenTex = canvasTex(128, 128, draw);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 1.18), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 3.4, .29); screen.rotation.x = -.08;
  G.add(screen);
  const mq = new THREE.MeshBasicMaterial({ map: canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = '#11162c'; x.fillRect(0, 0, w, h);
    x.font = `600 58px ${FONT_D}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = g.color; x.shadowBlur = 22; x.fillStyle = '#fff7e2'; x.fillText(g.en, w / 2, h / 2 + 3);
  }) });
  marqueeMats.push(mq);
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(1.94, .52), mq);
  marquee.position.set(0, 4.6, .3);
  G.add(marquee);
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.position.set(0, 2.6, -.1); hb.scale.set(2.4, 5.3, 1.8); hb.userData = { place: g.id };
  G.add(hb);
  pickables.push(hb);
  rectOb(F.x, F.z, 2.3, 1.8, F.ry);
  keep(F.x, F.z, 3.0);
  const plaqueTex = canvasTex(512, 256, (x, w, h) => drawPlaque(x, w, h, g));
  const pry = F.ry - .45, [px, pz] = F.w(1.95, 1.85);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.5, .75), new THREE.MeshBasicMaterial({ map: plaqueTex }));
  plaque.position.set(px, F.y + 1.05, pz); plaque.rotation.y = pry; plaque.rotation.x = -.15;
  scene.add(plaque);
  part('box', [px - Math.sin(pry) * .12, F.y + .36, pz - Math.cos(pry) * .12], [.1, .72, .1], 0x6f5641);
  circleOb(px, pz, .35);
  return (CAB[g.id] = { g, F, G, screenTex, plaqueTex });
}
/* 廣場南口的 ARCHAIDE 霓虹拱門 */
function buildArch() {
  const z = 10.3, y = TOP;
  for (const sx of [-1.6, 1.6]) { part('box', [sx, y + 1.65, z], [.28, 3.3, .28], 0x27304d); circleOb(sx, z, .3); }
  part('box', [0, y + 3.35, z], [3.6, .26, .36], 0x27304d);
  part('box', [0, y + 3.95, z], [3.1, .84, .06], 0x1a2142);
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
  for (const [dz, ry] of [[.04, 0], [-.04, Math.PI]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, .75), neonMat);
    m.position.set(0, y + 3.95, z + dz); m.rotation.y = ry;
    scene.add(m);
  }
}

/* 01 小蜜蜂：蜜蜂隊伍飛出螢幕繞一圈再飛回去，戰機在下面追著打（最高分每 2,500 分多一隻） */
const BEE_CURVE = new THREE.CatmullRomCurve3([[0, 3.4, .45], [.8, 4.3, 2.4], [3.0, 6.3, 1.9], [3.5, 7.5, -.7], [.3, 8.2, -2.6], [-3.2, 7.2, -.8], [-2.7, 5.5, 1.9], [-.8, 4.1, 2.3]].map(p => new THREE.Vector3(...p)), true, 'centripetal');
const BEE_MAX = 24;
const beeCount = r => clamp(4 + Math.floor(r.bee.best / 2500), 4, BEE_MAX);
let swarm = null;
function buildSwarm(cab) {
  const B = [];
  part('box', [0, 0, 0], [.36, .28, .32], 0xf5c518, { into: B });
  for (const bz of [-.05, .07]) part('box', [0, 0, bz], [.38, .3, .06], 0x2a2a35, { into: B });
  for (const bx of [-.09, .09]) part('box', [bx, .06, .17], [.08, .08, .04], 0xe63946, { into: B });
  part('box', [0, -.02, -.21], [.1, .1, .12], 0x2a2a35, { into: B });
  const body = new THREE.InstancedMesh(mergeGeometries(B), MAT.solid, BEE_MAX);
  const wings = new THREE.InstancedMesh(new THREE.BoxGeometry(.34, .03, .2).translate(.17, 0, 0), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, transparent: true, opacity: .85, roughness: .4 }), BEE_MAX * 2);
  body.castShadow = true;
  body.frustumCulled = wings.frustumCulled = false;
  const ship = new THREE.Group(), S = [];
  part('cone6', [0, .25, 0], [.3, .8, .3], 0xf1f3f8, { into: S });
  part('box', [0, -.05, 0], [1.0, .3, .06], 0xe14b4b, { into: S });
  part('box', [0, -.1, -.12], [.06, .26, .24], 0xe14b4b, { into: S });
  part('sphere', [0, .18, .12], [.16, .24, .12], 0x4fc3f7, { into: S });
  ship.add(merged(S, MAT.solid));
  const flame = new THREE.Mesh(BASE.cone6, glowMat(0xffa040));
  flame.scale.set(.14, .3, .14); flame.rotation.x = Math.PI; flame.position.y = -.38;
  ship.add(flame);
  const boltMat = glowMat(0xfff3a0), bolts = [0, 1, 2].map(i => {
    const b = new THREE.Mesh(BASE.box, boltMat);
    b.scale.set(.05, .32, .05); b.userData = { y: i * 1.4, x: 0 };
    return b;
  });
  cab.G.add(body, wings, ship, ...bolts);
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.position.set(0, 7, -.2); hb.scale.set(6, 3, 5); hb.userData = { place: cab.g.id };
  cab.G.add(hb);
  pickables.push(hb);
  swarm = { cab, body, wings, ship, bolts, n: 4 };
}
const _o = new THREE.Object3D(), _wo = new THREE.Object3D(), _bp = new THREE.Vector3(), _bt = new THREE.Vector3(), _mm = new THREE.Matrix4();
function updateSwarm(dt, t) {
  const S = swarm;
  if (!S) return;
  for (let i = 0; i < S.n; i++) {
    const u = ((t * .045 - i * .027) % 1 + 1) % 1;
    BEE_CURVE.getPointAt(u, _bp); BEE_CURVE.getTangentAt(u, _bt);
    _o.position.copy(_bp); _o.position.y += Math.sin(t * 3 + i * 1.7) * .07;
    _o.lookAt(_bp.x + _bt.x, _bp.y + _bt.y, _bp.z + _bt.z);
    _o.scale.setScalar(Math.max(.001, smooth(u / .045) * smooth((1 - u) / .045)));
    _o.updateMatrix();
    S.body.setMatrixAt(i, _o.matrix);
    const flap = Math.sin(t * 24 + i) * .7;
    for (let s = 0; s < 2; s++) {
      _wo.position.set(s ? .16 : -.16, .12, 0);
      _wo.rotation.set(0, s ? 0 : Math.PI, flap);
      _wo.updateMatrix();
      S.wings.setMatrixAt(i * 2 + s, _mm.multiplyMatrices(_o.matrix, _wo.matrix));
    }
  }
  S.body.count = S.n;
  S.wings.count = S.n * 2;
  S.body.instanceMatrix.needsUpdate = S.wings.instanceMatrix.needsUpdate = true;
  S.ship.position.set(Math.sin(t * .9) * 1.6, 5.7 + Math.sin(t * 1.7) * .15, 1.3);
  S.ship.rotation.z = -Math.cos(t * .9) * .25;
  for (const b of S.bolts) {
    b.userData.y += dt * 7;
    if (b.userData.y > 4.2) { b.userData.y = 0; b.userData.x = S.ship.position.x; }
    b.position.set(b.userData.x, S.ship.position.y + .5 + b.userData.y, 1.3);
  }
}

/* 02 Blocks Pro：方塊從螢幕飛出來，靠著機台堆成山（MARATHON 每 2,500 分一層，金線＝15,000 分） */
const PIECE = [0x3cc4ee, 0xf5c541, 0xa46ad6, 0x5cc46a, 0xee5d57, 0x3f73e3, 0xf39a3b];
const SHAPES = [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [2, 1]], [[2, 0], [0, 1], [1, 1], [2, 1]]];
const HEAP_GOAL = 2 + MARATHON_TARGET / 2500;
const heapLayers = r => clamp(2 + Math.floor(r.blocks.marathon / 2500), 2, 14);
const cellGeo = new RoundedBoxGeometry(.47, .47, .47, 2, .06);
const cellMat = new THREE.MeshStandardMaterial({ roughness: .5, metalness: .04 });
let heap = null;
function buildHeap(cab) {
  const drop = new THREE.Group(), dropMat = new THREE.MeshStandardMaterial({ roughness: .5, emissive: 0xffffff, emissiveIntensity: 0 });
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(cellGeo, dropMat); m.castShadow = true; drop.add(m); }
  drop.visible = false;
  const goalMat = glowMat(0xf1c24e), goal = new THREE.Mesh(BASE.box, goalMat);
  goal.scale.set(.42, .07, 1.5); goal.position.set(1.22, .16 + HEAP_GOAL * .5, -.12);
  cab.G.add(drop, goal);
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.position.set(2.45, 2.2, -.12); hb.scale.set(2.7, 4.4, 1.7); hb.userData = { place: cab.g.id };
  cab.G.add(hb);
  pickables.push(hb);
  const [hx, hz] = cab.F.w(2.45, -.12);
  rectOb(hx, hz, 2.7, 1.7, cab.F.ry);
  keep(hx, hz, 2.2);
  heap = { cab, mesh: null, layers: 0, top: 0, drop, dropMat, goalMat, state: 'wait', t: 2, u: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
}
function setHeap(L) {
  const H = heap;
  if (!H || H.layers === L) return;
  if (H.mesh) { H.cab.G.remove(H.mesh); H.mesh.dispose(); }
  const cells = [];
  for (let c = 0; c < 5; c++) {
    const hgt = Math.max(1, Math.round(L * (1 - c / 5.4)));
    for (let r = 0; r < 3; r++) for (let k = 0; k < hgt; k++) cells.push([c, r, k]);
  }
  const mesh = new THREE.InstancedMesh(cellGeo, cellMat, cells.length), m4 = new THREE.Matrix4(), c3 = new THREE.Color();
  cells.forEach(([c, r, k], i) => {
    mesh.setMatrixAt(i, m4.makeTranslation(1.42 + c * .5, .16 + (k + .5) * .5, -.62 + r * .5));
    mesh.setColorAt(i, c3.setHex(PIECE[(c * 3 + k * 5 + r * 2) % 7]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = true;
  H.cab.G.add(mesh);
  Object.assign(H, { mesh, layers: L, top: .16 + L * .5 });
  H.goalMat.userData.base.setHex(records.blocks.marathon >= MARATHON_TARGET ? 0x4be8a8 : 0xf1c24e);
  if (pins.blocks) pins.blocks.obj.position.y = H.cab.F.y + Math.max(5.05, H.top) + .95;
}
function updateHeap(dt) {
  const H = heap;
  if (!H || !H.mesh) return;
  if (H.state === 'wait') {
    H.t -= dt;
    if (H.t > 0) return;
    const sh = SHAPES[(rnd() * SHAPES.length) | 0];
    H.dropMat.color.setHex(PIECE[(rnd() * 7) | 0]);
    H.drop.children.forEach((m, i) => m.position.set((sh[i][0] - 1) * .5, sh[i][1] * .5, 0));
    H.from.set(0, 3.4, .55);
    H.to.set(1.67 + ((rnd() * 2) | 0) * .5, H.top + .3, -.12);
    Object.assign(H, { state: 'fly', u: 0 });
    H.drop.visible = true;
  } else if (H.state === 'fly') {
    H.u = Math.min(1, H.u + dt / 1.1);
    H.drop.position.lerpVectors(H.from, H.to, H.u);
    H.drop.position.y += Math.sin(Math.PI * H.u) * 1.7;
    H.drop.scale.setScalar(lerp(.25, 1, Math.min(1, H.u * 2)));
    H.drop.rotation.z += dt * 4;
    if (H.u >= 1) { H.state = 'land'; H.t = .8; H.drop.rotation.z = Math.round(H.drop.rotation.z / (Math.PI / 2)) * Math.PI / 2; }
  } else {
    H.t -= dt;
    H.dropMat.emissiveIntensity = H.t > .5 ? .5 : 0;
    if (H.t < .35) H.drop.scale.setScalar(Math.max(.01, H.t / .35));
    if (H.t <= 0) { H.drop.visible = false; H.state = 'wait'; H.t = 2.2 + rnd() * 2.4; }
  }
}

/* 03 迷宮球：迷宮從螢幕流到地上，每通過一章長大一圈（4×4 到 10×10）；還沒長到的地方是草地和小花 */
const MCS = .62, MAZE_MAX = 10;
const mazeSize = r => clamp(4 + r.maze.chapters.filter(c => c.done).length, 4, MAZE_MAX);
let mazeArea = null;
function buildMazeArea(cab) {
  const W = MAZE_MAX * MCS, x1 = -1.6, z0 = -.6, mcx = x1 - W / 2, mcz = z0 + W / 2;   // 迷宮最大會長到的範圍
  const group = new THREE.Group();
  cab.G.add(group);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.17, 18, 12), new THREE.MeshStandardMaterial({ color: 0xdfe4ec, metalness: .85, roughness: .2 }));
  ball.castShadow = true;
  cab.G.add(ball);
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.userData = { place: cab.g.id };
  cab.G.add(hb);
  pickables.push(hb);
  const ob = { x: 0, z: 0, hw: 0, hd: 0, ry: cab.F.ry };   // 障礙跟著迷宮實際大小走（setMaze 更新）
  OBST.push(ob);
  const [wx, wz] = cab.F.w(mcx, mcz);
  keepRect(wx, wz, W + .6, W + .6, cab.F.ry);
  // 還沒長出迷宮的地方：草叢和小花（迷宮長大時被木盤蓋住）
  const fl = [0xf2b5c6, 0xf6d36b, 0xffffff, 0xc7a6ec];
  for (let i = 0; i < 80; i++) {
    const [x, z] = cab.F.w(mcx + (rnd() - .5) * W, mcz + (rnd() - .5) * W), y = groundY(x, z);
    if (i % 3) part('cone6', [x, y + .07, z], [.1, .15, .1], [0x8fbf6f, 0x7fb062, 0x9ccb7c][i % 3], { ry: rnd() });
    else part('ico', [x, y + .06, z], [.13, .1, .13], fl[i % 4]);
  }
  // 外緣一圈矮樹叢
  for (let k = 0; k <= 6; k++) {
    for (const [lx, lz] of [[x1 - W - .55, z0 + k * W / 6], [x1 - W + k * (W - 1.4) / 6, z0 + W + .55]]) {
      const [x, z] = cab.F.w(lx, lz), sz = .55 + rnd() * .2;
      part('ico', [x, groundY(x, z) + sz * .35, z], [sz * 1.2, sz * .8, sz * 1.2], GREENS[(rnd() * 4) | 0], { ry: rnd() * TAU, jit: .12 });
      circleOb(x, z, sz * .5);
    }
  }
  const nf = 40, fp = new Float32Array(nf * 3);
  for (let i = 0; i < nf; i++) fp.set([mcx + (rnd() - .5) * W, .7 + rnd() * 1.6, mcz + (rnd() - .5) * W], i * 3);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  const flies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xe8ff9a, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  flies.frustumCulled = false;
  cab.G.add(flies);
  mazeArea = { cab, group, ball, flies, flyBase: Float32Array.from(fp), hb, ob, n: 0, pts: [], seg: 0, f: 0, sink: 0 };
}
function setMaze(n) {
  const M = mazeArea;
  if (!M || M.n === n) return;
  for (const c of [...M.group.children]) { c.geometry.dispose(); M.group.remove(c); }
  const size = n * MCS, x1 = -1.6, z0 = -.6, cx = x1 - size / 2, cz = z0 + size / 2, L = [];
  const cellX = i => x1 - (i + .5) * MCS, cellZ = j => z0 + (j + .5) * MCS, hedge = [0x4f8a4a, 0x5a9653, 0x47804a];
  const wall = (x, z, w, d, k) => part('box', [x, .44, z], [w, .36, d], hedge[k % 3], { into: L, jit: .1 });
  part('box', [cx, .17, cz], [size + .24, .14, size + .24], 0xb88b5c, { into: L });
  part('box', [cx, .25, cz], [size, .03, size], 0xeadfc6, { into: L });
  const mz = genMaze(n, mulberry32(30 + n));
  for (let c = 0; c < n * n; c++) {
    const i = c % n, j = (c / n) | 0, x = cellX(i), z = cellZ(j);
    if (j > 0 && mz.walls[c][0]) wall(x, z - MCS / 2, MCS + .12, .12, c);
    if (i > 0 && mz.walls[c][3]) wall(x + MCS / 2, z, .12, MCS + .12, c + 1);
  }
  for (let k = 0; k < n; k++) {
    wall(cellX(k), z0, MCS + .12, .12, k);
    wall(cellX(k), z0 + size, MCS + .12, .12, k + 1);
    wall(x1 - size, cellZ(k), .12, MCS + .12, k + 2);
    if (k > 0) wall(x1, cellZ(k), .12, MCS + .12, k);   // 右緣第 0 格留給從螢幕流下來的入口
  }
  part('cyl', [cellX(n - 1), .27, cellZ(n - 1)], [.4, .02, .4], 0x1f1f22, { into: L });
  const rib = new THREE.CatmullRomCurve3([[-.3, 2.72, .52], [-.9, 2.15, .95], [-1.35, 1.25, .75], [-1.45, .62, .2], [x1 + .12, .3, cellZ(0)]].map(p => new THREE.Vector3(...p)));
  const nt = Math.ceil(rib.getLength() / .2);
  for (let k = 0; k <= nt; k++) {
    const p = rib.getPointAt(k / nt), tg = rib.getTangentAt(k / nt), yaw = Math.atan2(tg.x, tg.z), pitch = -Math.asin(clamp(tg.y, -1, 1));
    part('box', [p.x, p.y, p.z], [.34, .04, .22], 0xeadfc6, { into: L, ry: yaw, rx: pitch });
    for (const sd of [-1, 1]) part('box', [p.x + Math.cos(yaw) * .19 * sd, p.y + .07, p.z - Math.sin(yaw) * .19 * sd], [.05, .14, .22], hedge[(k + (sd > 0 ? 1 : 0)) % 3], { into: L, ry: yaw, rx: pitch });
  }
  M.group.add(merged(L, MAT.solid));
  const pts = rib.getSpacedPoints(14).map(p => p.clone().add(new THREE.Vector3(0, .19, 0)));
  for (const c of mz.path) pts.push(new THREE.Vector3(cellX(c % n), .44, cellZ((c / n) | 0)));
  Object.assign(M, { n, pts, seg: 0, f: 0, sink: 0 });
  const [wx, wz] = M.cab.F.w(cx, cz);
  Object.assign(M.ob, { x: wx, z: wz, hw: size / 2 + .2, hd: size / 2 + .2 });
  M.hb.position.set(cx, .5, cz);
  M.hb.scale.set(size + .4, 1, size + .4);
  rebuildWalkGrid();
  if (!walkableAt(avatar.position.x, avatar.position.z)) {
    const c = nearestCell(...cellAt(avatar.position.x, avatar.position.z), 14);
    if (c) [avatar.position.x, avatar.position.z] = cellCenter(c[1] * GRID.n + c[0]);
  }
}
function updateMazeBall(dt, t) {
  const M = mazeArea;
  if (!M || M.pts.length < 2) return;
  const P = M.pts;
  if (M.sink > 0) {
    M.sink -= dt;
    M.ball.position.y = P[P.length - 1].y - (1 - M.sink / .8) * .45;
    if (M.sink <= 0) { M.seg = 0; M.f = 0; }
  } else {
    M.f += dt * 1.9 / Math.max(.01, P[M.seg].distanceTo(P[M.seg + 1]));
    while (M.f >= 1 && M.seg < P.length - 2) { M.f -= 1; M.seg++; }
    if (M.f >= 1) { M.ball.position.copy(P[P.length - 1]); M.sink = .8; }
    else M.ball.position.lerpVectors(P[M.seg], P[M.seg + 1], M.f);
    M.ball.scale.setScalar(M.seg === 0 ? Math.max(.2, M.f) : 1);
  }
  const a = M.flies.geometry.attributes.position, b = M.flyBase;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, b[i * 3] + Math.sin(t * .7 + i) * .4, b[i * 3 + 1] + Math.sin(t * 1.3 + i * 2) * .25, b[i * 3 + 2] + Math.cos(t * .6 + i) * .4);
  a.needsUpdate = true;
}

/* 溢出量跟著紀錄走；螢幕每 0.1 秒重畫 */
let screenAcc = 0;
function updateOverflow(dt, t) {
  screenAcc += dt;
  if (screenAcc > .1) { screenAcc = 0; for (const id in CAB) redraw(CAB[id].screenTex); }
  updateSwarm(dt, t);
  updateHeap(dt);
  updateMazeBall(dt, t);
}
function applyOverflow() {
  for (const id in CAB) redraw(CAB[id].plaqueTex);
  if (swarm) swarm.n = beeCount(records);
  setHeap(heapLayers(records));
  setMaze(mazeSize(records));
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

/* ---------- 隱嶼之門、25¢ 復活幣、鑰匙基座 ---------- */
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
const clouds = new THREE.Group(), birds = [], FAR_ISLES = [];   // FAR_ISLES：遠島的位置與大小（開飛船時從上面飛過去，不會穿進去）
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
    const w = 26 + r() * 20, h = 10 + r() * 10, d = 22 + r() * 16, h2 = 14 + r() * 8;
    part('cone6', [x, 3, z], [w, h, d], 0x7f9c86, { into: isl, ry: r() });
    part('cone6', [x + 5, 6, z + 3], [12, h2, 12], 0x6f8d78, { into: isl, ry: r() });
    FAR_ISLES.push({ x: x + 2, z: z + 1, r: Math.max(w, d) / 2 + 4, top: Math.max(3 + h / 2, 6 + h2 / 2) + 3 });
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
buildShip();
buildStele();
buildArch();
for (const g of GAMES) { const cab = buildCabinet(g); ({ bee: buildSwarm, blocks: buildHeap, maze: buildMazeArea }[g.id] || (() => {}))(cab); }
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
function rebuildWalkGrid() {
  for (let j = 0; j < GRID.n; j++) for (let i = 0; i < GRID.n; i++) walkGrid[j * GRID.n + i] = walkableAt(GRID.x0 + (i + .5) * GRID.cs, GRID.z0 + (j + .5) * GRID.cs) ? 1 : 0;
}
rebuildWalkGrid();
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
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .7, flatShading: true });
  const add = (parent, geo, mat, [x, y, z], [sx, sy, sz] = [1, 1, 1], [rx, ry, rz] = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
  const ROBE = 0x5c3f2b, TUNIC = 0xe6d9bf, TUNIC2 = 0xd3c2a0, LEATHER = 0x3b2a1e, PANTS = 0x4a3a2c, BOOT = 0x2a211b, SKIN = 0xf3d2b3;
  AV.body = new THREE.Group();
  avatar.add(AV.body);
  // 長袍下擺＋米白內衫（前襟交疊）＋皮帶
  add(AV.body, new THREE.CylinderGeometry(.25, .34, .52, 10), M(ROBE), [0, .36, 0]);
  add(AV.body, new RoundedBoxGeometry(.46, .46, .32, 2, .1), M(TUNIC), [0, .78, 0]);
  for (const sx of [-1, 1]) add(AV.body, new THREE.BoxGeometry(.06, .44, .02), M(TUNIC2), [sx * .04, .79, .165 + (sx > 0 ? .003 : 0)], [1, 1, 1], [0, 0, sx * -.32]);
  add(AV.body, new THREE.BoxGeometry(.49, .08, .35), M(LEATHER), [0, .6, 0]);
  add(AV.body, new THREE.BoxGeometry(.09, .06, .02), M(0xb88a3a), [0, .6, .178]);
  // 外袍：背後與兩側，前面敞開
  add(AV.body, new RoundedBoxGeometry(.5, .5, .1, 2, .04), M(ROBE), [0, .78, -.15]);
  for (const sx of [-1, 1]) add(AV.body, new RoundedBoxGeometry(.1, .5, .3, 2, .04), M(ROBE), [sx * .24, .78, 0]);
  // 兜帽放下來，圍在脖子後面
  AV.hoodDown = new THREE.Group();
  AV.body.add(AV.hoodDown);
  add(AV.hoodDown, new THREE.TorusGeometry(.17, .06, 8, 20), M(ROBE), [0, 1.0, -.02], [1, 1, 1], [Math.PI / 2, 0, 0]);
  add(AV.hoodDown, new RoundedBoxGeometry(.36, .22, .14, 2, .06), M(ROBE), [0, 1.06, -.18], [1, 1, 1], [-.25, 0, 0]);
  // 頭：爆炸頭的年輕隱士——一大團小方塊堆成的捲髮，臉露在前面
  {
    const h = new THREE.Group(), HM = [0x3a2618, 0x2e1e13, 0x4a3220].map(M), curl = new RoundedBoxGeometry(1, 1, 1, 1, .25), hr = mulberry32(7), EYE = M(0x1d2233);
    h.position.set(0, 1.24, 0);
    AV.body.add(h);
    Object.assign(AV, { head: h, hair: new THREE.Group(), HM, HM0: HM.map(m => m.color.clone()), eyeMat: EYE, curls: [] });   // 變身時捲髮變金色、往上豎，眼睛變青綠色
    h.add(AV.hair);
    add(h, new RoundedBoxGeometry(.42, .4, .38, 2, .1), M(SKIN), [0, -.03, .03]);
    add(AV.hair, new RoundedBoxGeometry(.62, .52, .56, 2, .2), HM[0], [0, .13, -.07]);   // 捲髮的芯
    for (let i = 0; i < 64; i++) {   // 表面一顆顆捲毛：球面上平均撒點，臉前面和下巴以下留空
      const y = 1 - (i + .5) / 32, r = Math.sqrt(1 - y * y), a = i * 2.39996, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if ((z > .25 && y < .25) || y < -.55) continue;
      const k = .15 + hr() * .07;
      const m = add(AV.hair, curl, HM[i % 3], [x * .36, .13 + y * .3, -.07 + z * .34], [k, k, k], [hr() * 1.5, hr() * 1.5, 0]);
      AV.curls.push({ m, p: m.position.clone(), n: new THREE.Vector3(x, y, z), k, ph: i * 1.7 });
    }
    for (const sx of [-1, 1]) {
      add(h, new THREE.BoxGeometry(.1, .03, .03), HM[1], [sx * .1, .07, .225]);
      add(h, new THREE.BoxGeometry(.06, .07, .02), EYE, [sx * .1, -.005, .225]);
      add(h, new THREE.BoxGeometry(.02, .02, .01), M(0xffffff), [sx * .1 + .012, .012, .237]);
      add(h, new THREE.BoxGeometry(.03, .02, .02), M(0xb5644f), [sx * .055, -.11, .225], [1, 1, 1], [0, 0, sx * .5]);   // 嘴角上揚
    }
    add(h, new THREE.BoxGeometry(.08, .02, .02), M(0xb5644f), [0, -.12, .225]);
  }
  const limb = (x, y, w, h, c, foot) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    add(p, new RoundedBoxGeometry(w, h, w, 1, .04), M(c), [0, -h / 2, 0]);
    if (foot) add(p, new RoundedBoxGeometry(w + .02, .1, w + .06, 1, .03), M(foot), [0, -h + .03, .02]);
    AV.body.add(p);
    return p;
  };
  AV.legL = limb(-.1, .42, .14, .38, PANTS, BOOT);
  AV.legR = limb(.1, .42, .14, .38, PANTS, BOOT);
  AV.armL = limb(-.31, .97, .13, .4, ROBE);
  AV.armR = limb(.31, .97, .13, .4, ROBE);
  for (const arm of [AV.armL, AV.armR]) {
    add(arm, new THREE.CylinderGeometry(.075, .1, .14, 8), M(ROBE), [0, -.36, 0]);   // 寬袖口
    add(arm, new THREE.SphereGeometry(.055, 8, 6), M(SKIN), [0, -.45, 0]);
  }
  // 能量劍：握在右手，銀色劍柄；綠色劍身平時收起來，揮劍才亮出來（點自己的分身會揮一劍）
  AV.saber = new THREE.Group();
  AV.saber.position.set(0, -.45, .03);
  AV.saber.rotation.set(1.4, 0, -.5);   // 往右前方握，不擋在胸前
  AV.armR.add(AV.saber);
  add(AV.saber, new THREE.CylinderGeometry(.035, .035, .24, 10), M(0xc9ccd2), [0, .02, 0]);
  for (const y of [-.05, .02, .09]) add(AV.saber, new THREE.CylinderGeometry(.039, .039, .03, 10), M(0x222428), [0, y, 0]);
  const blade = new THREE.Group();
  blade.position.y = .14;
  AV.saber.add(blade);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, 1, 10).translate(0, .5, 0), new THREE.MeshBasicMaterial({ color: 0xb4ffaa }));
  core.scale.y = .95;
  AV.bladeGlow = new THREE.Mesh(new THREE.CylinderGeometry(.055, .045, 1, 12).translate(0, .5, 0), new THREE.MeshBasicMaterial({ color: 0x1fd63a, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false }));
  AV.bladeLight = new THREE.PointLight(0x7dff8f, .5, 3.4, 2);
  AV.bladeLight.position.y = .5;
  blade.add(core, AV.bladeGlow, AV.bladeLight);
  AV.blade = blade;
  blade.scale.y = .001;
  blade.visible = false;
  AV.bladeK = 0;
  AV.saberT = 0;
  AV.swingT = 0;
  AV.throwT = 0;
  AV.crouchT = 0;
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.position.y = .8; hb.scale.set(.6, 1.6, .6); hb.userData = { pet: 'me' };
  avatar.add(hb);
  pickables.push(hb);
  AV.halo = new THREE.Mesh(new THREE.TorusGeometry(.42, .035, 8, 40), glowMat(0x22d8f0));
  AV.halo.rotation.x = Math.PI / 2;
  AV.halo.position.y = .05;
  avatar.add(AV.halo);
}
avatar.position.set(.3, DECK_Y, 19.1);   // 飛船坡道腳下
avatar.rotation.y = Math.PI;
scene.add(avatar);
const mePin = addPin('me', '你', null, [0, 0, 0], null, 'me');
avatar.add(mePin.obj);
mePin.obj.position.set(0, 2.0, 0);
const marker = new THREE.Mesh(new THREE.RingGeometry(.3, .45, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
marker.rotation.x = -Math.PI / 2;
scene.add(marker);

const walk = { path: null, i: 0, phase: 0, moving: false, onArrive: null };
/* 騎巨獸的狀態（程式在「騎巨獸」那一段）。放在這裡：巨獸載入時就會先算一次姿勢，那時要讀得到 */
const ride = { phase: null, t: 0, offer: 0, ctl: false, p: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), dir: new THREE.Vector3(), dur: 1, hold: -1, shake: 0, stand: 0, pitOff: 0, arc: 10, ho: 0, help: 0 };   // stand：放煙火時在駕駛艙裡站起來的程度；pitOff：你下來後多久收起駕駛艙；help：操作說明還要秀幾秒
const aim = { T: new THREE.Vector3(), mode: 'none', nx: 0, ny: 0, t: 0, kind: 'sea' };   // 你瞄的地方：mode 'screen'＝跟著滑鼠／手指（每幀重算）、'world'＝點過的那一點、'none'＝牠前面
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
  if (ride.phase) return;   // 騎巨獸（飛過去、騎著、飛回來）：位置和姿勢在 updateRide 裡擺
  if (flight.phase) {   // 飛行中：分身在船上，只有走坡道時擺腿
    const sw = flight.walking ? Math.sin(walk.phase += dt * 9) * .65 : 0;
    AV.legL.rotation.x = sw; AV.legR.rotation.x = -sw; AV.armL.rotation.x = -sw * .8;
    return;
  }
  let ix = (keysDown.d || keysDown.arrowright ? 1 : 0) - (keysDown.a || keysDown.arrowleft ? 1 : 0) + joy.x;
  let iz = (keysDown.s || keysDown.arrowdown ? 1 : 0) - (keysDown.w || keysDown.arrowup ? 1 : 0) + joy.y;
  const len = Math.hypot(ix, iz);
  if (fishing.phase && fishing.phase !== 'catch' && (len > .1 || walk.path)) endFishing();   // 一走動就收竿
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
  AV.legL.rotation.x = sw; AV.legR.rotation.x = -sw; AV.armL.rotation.x = -sw * .8;
  if (AV.throwT > 0) {   // 丟東西：左手往後拉再甩出去
    AV.throwT -= dt;
    const k = 1 - Math.max(0, AV.throwT) / .35;
    AV.armL.rotation.x = k < .45 ? lerp(0, -2.4, k / .45) : lerp(-2.4, .4, (k - .45) / .55);
  }
  if (AV.swingT > 0) {   // 揮劍：先舉高再砍下
    AV.swingT -= dt;
    const k = 1 - Math.max(0, AV.swingT) / .45;
    AV.armR.rotation.x = k < .3 ? lerp(0, -2.6, k / .3) : lerp(-2.6, .7, (k - .3) / .7);
    AV.body.rotation.y = Math.sin(k * Math.PI) * .35;
  } else {
    AV.armR.rotation.x = lerp(AV.armR.rotation.x, sw * .3 - .15, Math.min(1, dt * 10));
    AV.body.rotation.y = 0;
  }
  AV.saberT -= dt;   // 揮劍時亮出劍身（約 0.1 秒伸長），三秒沒揮就收回
  AV.bladeK = clamp(AV.bladeK + (AV.swingT > 0 || AV.saberT > 0 ? dt / .12 : -dt / .25), 0, 1);
  AV.blade.scale.y = Math.max(.001, AV.bladeK);
  AV.blade.visible = AV.bladeK > .01;
  AV.bladeGlow.material.opacity = (.5 + Math.sin(performance.now() / 25) * .06) * AV.bladeK;
  AV.bladeLight.intensity = (.35 + night * 1.8) * AV.bladeK;
  AV.body.position.y = moving ? Math.abs(Math.sin(walk.phase)) * .05 : Math.sin(performance.now() / 600) * .012;
  if (AV.crouchT > 0) { AV.crouchT -= dt; AV.body.position.y -= Math.sin(Math.max(0, AV.crouchT) / .7 * Math.PI) * .22; }   // 蹲下放魚
  if (rod.visible && AV.throwT <= 0) AV.armL.rotation.x = -.55;   // 拿著釣竿
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

/* ---------- 島民：柴犬阿滿、機台上的三花貓花捲、寄居蟹、橘色方塊小傢伙柑仔丁 ---------- */
const PET_MATS = new Map();
const petMat = c => { if (!PET_MATS.has(c)) PET_MATS.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: .7, flatShading: true })); return PET_MATS.get(c); };
const RB = new RoundedBoxGeometry(1, 1, 1, 2, .22);
function vox(parent, geo, color, [x, y, z], [sx, sy, sz], [rx, ry, rz] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? petMat(color) : color);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function petHit(group, id, [x, y, z], [w, hh, d]) {
  const hb = new THREE.Mesh(HIT_GEO, hitMat);
  hb.position.set(x, y, z); hb.scale.set(w, hh, d); hb.userData = { pet: id };
  group.add(hb);
  pickables.push(hb);
}
function bubble(group, text, y) {
  const wrap = document.createElement('div'), span = document.createElement('span');
  span.className = 'bubble'; span.textContent = text;
  wrap.appendChild(span);
  const o = new CSS2DObject(wrap);
  o.center.set(.5, 1); o.position.set(0, y, 0);
  group.add(o);
  setTimeout(() => group.remove(o), 1700);
  voice(group, text);   // 叫聲跟著對話泡泡出來
}
function turnTo(g, dx, dz, dt) {
  let d = Math.atan2(dx, dz) - g.rotation.y;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  g.rotation.y += d * Math.min(1, dt * 8);
}
function goTo(m, x, z) { m.path = findPath(m.g.position.x, m.g.position.z, x, z); m.i = 0; return !!m.path; }
function stepAlong(m, speed, dt) {
  if (!m.path) return false;
  const [tx, tz] = m.path[m.i], p = m.g.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), st = speed * dt;
  if (d <= st) { p.x = tx; p.z = tz; if (++m.i >= m.path.length) m.path = null; }
  else { p.x += dx / d * st; p.z += dz / d * st; turnTo(m.g, dx, dz, dt); }
  return true;
}
function randomSpot(cx, cz, r) {
  for (let k = 0; k < 30; k++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (walkableAt(x, z) && baseHeight(x, z) > .9) return [x, z];
  }
  return null;
}
const GROTTO_MOUTH = (() => { const [gx, gz] = GROTTO, a = Math.atan2(-gz, -gx); return [gx + Math.cos(a) * 2.9, gz + Math.sin(a) * 2.9]; })();

/* 阿滿：平常閒晃，你在附近走動就跟著你，晚上回廣場邊睡覺；偶爾跑去岩洞口聞一聞 */
const DOG_BED = [2.2, 8.2];   // 廣場石板上、長椅旁
const dog = { path: null, i: 0, state: 'idle', t: 2, phase: 0, wag: 0, petT: 0, repath: 0, hintAt: 80, zzz: 0 };
{
  const g = new THREE.Group(), body = new THREE.Group(), O = 0xd8894b, W = 0xf6eee3, K = 0x2a2523;
  g.add(body);
  vox(body, RB, O, [0, .44, 0], [.42, .34, .78]);
  vox(body, RB, W, [0, .34, .06], [.34, .18, .6]);
  const head = new THREE.Group();
  head.position.set(0, .72, .4);
  body.add(head);
  vox(head, RB, O, [0, 0, 0], [.42, .36, .36]);
  vox(head, RB, W, [0, -.08, .17], [.26, .17, .2]);
  vox(head, BASE.box, K, [0, -.03, .28], [.09, .06, .05]);
  for (const sx of [-1, 1]) {
    vox(head, BASE.box, K, [sx * .1, .05, .18], [.05, .06, .02]);
    vox(head, BASE.pyr, O, [sx * .12, .25, -.03], [.13, .2, .1]);
    vox(head, RB, W, [sx * .15, -.06, .12], [.09, .1, .1]);
  }
  const legs = [];
  for (const [lx, lz] of [[-.12, .26], [.12, .26], [-.12, -.26], [.12, -.26]]) {
    const pv = new THREE.Group();
    pv.position.set(lx, .3, lz);
    body.add(pv);
    vox(pv, RB, O, [0, -.13, 0], [.12, .26, .12]);
    vox(pv, RB, W, [0, -.27, .01], [.13, .07, .14]);
    legs.push(pv);
  }
  const tail = new THREE.Group();
  tail.position.set(0, .58, -.38);
  body.add(tail);
  vox(tail, new THREE.TorusGeometry(.12, .05, 6, 14, Math.PI * 1.6), O, [0, .1, 0], [1, 1, 1], [0, Math.PI / 2, -.5]);
  g.scale.setScalar(.82);
  g.position.set(2.2, groundY(2.2, 12.4), 12.4);
  g.rotation.y = Math.PI;
  scene.add(g);
  petHit(g, 'dog', [0, .5, 0], [.7, 1.1, 1.1]);
  Object.assign(dog, { g, body, head, legs, tail });
  const pin = addPin('dog', `<span class="no">${svg('paw')}</span>阿滿`, '#d8894b', [0, 0, 0], () => petTap('dog'), 'pet');
  g.add(pin.obj);
  pin.obj.position.set(0, 1.45, 0);
}
function updateDog(dt, t) {
  const D = dog, p = D.g.position, av = avatar.position, dAv = Math.hypot(av.x - p.x, av.z - p.z), sleepy = night > .85;
  if (sleepy && D.state !== 'bed' && D.state !== 'sleep') { if (fetchS.phase === 'carried') dropBall(p.x, p.z); D.state = 'bed'; goTo(D, DOG_BED[0], DOG_BED[1]); }
  if (!sleepy && D.state === 'sleep') { D.state = 'idle'; D.t = 1; }
  if (!sleepy && walk.moving && dAv < 6 && (D.state === 'idle' || D.state === 'walk')) D.state = 'follow';
  let speed = 1.8;
  if (D.state === 'follow') {
    speed = 4.2;
    D.repath -= dt;
    if (dAv > 10) { D.state = 'idle'; D.t = 2; D.path = null; }
    else if (dAv > 1.9) { if (D.repath <= 0) { goTo(D, av.x - Math.sin(avatar.rotation.y) * 1.2, av.z - Math.cos(avatar.rotation.y) * 1.2); D.repath = .5; } D.t = 0; }
    else {
      D.path = null;
      turnTo(D.g, av.x - p.x, av.z - p.z, dt);
      if (walk.moving) D.t = 0; else if ((D.t -= dt) < -3.5) { D.state = 'idle'; D.t = 3 + rnd() * 3; }
    }
  } else if (D.state === 'idle') {
    if ((D.t -= dt) <= 0) {
      if (!keyState.crystal && elapsed > D.hintAt && goTo(D, GROTTO_MOUTH[0], GROTTO_MOUTH[1])) { D.state = 'toSniff'; D.hintAt = elapsed + 150 + rnd() * 90; }
      else { const sp = randomSpot(...(rnd() < .5 ? PLAZA : [p.x, p.z]), 9); if (sp && goTo(D, sp[0], sp[1])) D.state = 'walk'; else D.t = 2; }
    }
  } else if (D.state === 'walk' || D.state === 'toSniff' || D.state === 'bed') {
    speed = D.state === 'walk' ? 1.8 : 2.6;
    if (!D.path) {
      if (D.state === 'walk') { D.state = 'idle'; D.t = 3 + rnd() * 5; }
      else if (D.state === 'toSniff') { D.state = 'sniff'; D.t = 4.5; }
      else D.state = 'sleep';
    }
  } else if (D.state === 'sniff' && (D.t -= dt) <= 0) { D.state = 'idle'; D.t = 2; }
  else if (D.state === 'fetch') {   // 衝去撿球；球還在飛就盯著等它落地
    speed = 5.2;
    D.fetchT -= dt;
    const bx = ball.position.x - p.x, bz = ball.position.z - p.z;
    if (D.fetchT <= 0) { D.state = 'idle'; D.t = 2; D.path = null; }
    else if (fetchS.phase === 'rest' && Math.hypot(bx, bz) < .9) { fetchS.phase = 'carried'; D.state = 'bring'; D.repath = 0; D.path = null; }
    else if (!D.path) { if (fetchS.phase === 'rest') goTo(D, ball.position.x, ball.position.z); else turnTo(D.g, bx, bz, dt); }
  } else if (D.state === 'bring') {   // 叼回分身腳邊
    speed = 4.4;
    D.repath -= dt;
    if (dAv < 1.7) {
      D.path = null;
      dropBall(p.x + Math.sin(D.g.rotation.y) * .5, p.z + Math.cos(D.g.rotation.y) * .5);
      D.state = 'idle'; D.t = 4; D.petT = 2;
      turnTo(D.g, av.x - p.x, av.z - p.z, 1);
      bubble(D.g, '汪！', 1.25);
      fetchN++;
      ls.set('sanasai_fetch', String(fetchN));
      if (fetchN === 1 || fetchN === 10 || fetchN % 50 === 0) addLog('pet', `阿滿撿回第 ${fetchN} 次球`);
    } else if (D.repath <= 0) { goTo(D, av.x + Math.sin(avatar.rotation.y) * 1.1, av.z + Math.cos(avatar.rotation.y) * 1.1); D.repath = .6; }
  }
  const moving = stepAlong(D, speed, dt);
  p.y = groundY(p.x, p.z);
  D.phase += dt * (moving ? speed * 3.4 : 0);
  const sw = moving ? Math.sin(D.phase) * .6 : 0, lie = D.state === 'sleep', sit = !moving && !lie && D.state !== 'sniff';
  D.legs.forEach((l, i) => { l.rotation.x = lie ? (i < 2 ? -1.35 : 1.35) : (i === 0 || i === 3 ? sw : -sw); });
  const k = Math.min(1, dt * 6);
  D.body.rotation.x = lerp(D.body.rotation.x, sit ? -.3 : 0, k);
  D.body.position.y = lerp(D.body.position.y, lie ? -.24 : sit ? -.05 : Math.abs(Math.sin(D.phase)) * .04, k);
  D.head.rotation.x = lerp(D.head.rotation.x, D.state === 'sniff' ? .55 + Math.sin(t * 10) * .12 : lie ? .4 : sit ? .25 : 0, k);
  D.petT -= dt;
  D.wag += dt * (D.petT > 0 ? 24 : lie ? 1 : moving || D.state === 'follow' ? 12 : 5);
  D.tail.rotation.z = Math.sin(D.wag) * (D.petT > 0 ? .7 : lie ? .05 : .3);
  if (D.petT > 1.6) D.body.position.y += Math.sin((2 - D.petT) * Math.PI / .4) * .12;
  if (lie && (D.zzz -= dt) <= 0) { D.zzz = 4; bubble(D.g, 'Zzz', 1.1); }
}

/* 阿滿撿球：點阿滿，分身往面對的方向丟球，阿滿衝去撿、叼回你腳邊 */
const ball = new THREE.Mesh(new THREE.SphereGeometry(.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8ec4a, roughness: .6, flatShading: true }));
ball.castShadow = true;
ball.visible = false;
scene.add(ball);
const fetchS = { phase: null, t: 0, b: 0, h: 2, from: new THREE.Vector3(), to: new THREE.Vector3(), dir: new THREE.Vector3() };
let fetchN = num('sanasai_fetch');
const _mouth = new THREE.Vector3();
function throwBall() {
  const D = dog;
  if (night > .85 || D.state === 'sleep' || D.state === 'bed') { bubble(D.g, 'Zzz…', 1.1); return; }
  if (D.state === 'fetch' || D.state === 'bring' || fetchS.phase === 'air' || fetchS.phase === 'bounce') return;
  const av = avatar.position, dp = D.g.position;
  let tgt = null, ang = 0;
  for (const da of [0, .45, -.45, .9, -.9, 1.5, -1.5, 2.3, -2.3, Math.PI]) {   // 落點要走得到、阿滿也跑得到
    for (const d of [7, 5.5, 4]) {
      const a = avatar.rotation.y + da, x = av.x + Math.sin(a) * d, z = av.z + Math.cos(a) * d;
      if (walkableAt(x, z) && findPath(dp.x, dp.z, x, z)) { tgt = [x, z]; ang = a; break; }
    }
    if (tgt) break;
  }
  if (!tgt) { bubble(D.g, '汪？', 1.25); return; }
  avatar.rotation.y = ang;
  AV.throwT = .35;
  sfx('toss', avatar);
  fetchS.from.set(av.x + Math.sin(ang) * .3, av.y + 1.15, av.z + Math.cos(ang) * .3);
  fetchS.to.set(tgt[0], groundY(tgt[0], tgt[1]) + .11, tgt[1]);
  fetchS.dir.set(Math.sin(ang), 0, Math.cos(ang));
  fetchS.h = 1.8 + fetchS.from.distanceTo(fetchS.to) * .12;
  fetchS.phase = 'air'; fetchS.t = 0;
  ball.position.copy(fetchS.from);
  ball.visible = true;
  D.state = 'fetch'; D.fetchT = 14; D.petT = 1;
  goTo(D, tgt[0], tgt[1]);
  bubble(D.g, '汪！', 1.25);
}
function dropBall(x, z) {
  fetchS.phase = 'rest';
  ball.position.set(x, groundY(x, z) + .11, z);
}
function updateBall(dt) {
  const F = fetchS;
  if (F.phase === 'air') {
    F.t = Math.min(1, F.t + dt / .85);
    ball.position.lerpVectors(F.from, F.to, F.t);
    ball.position.y += Math.sin(Math.PI * F.t) * F.h;
    if (F.t >= 1) { F.phase = 'bounce'; F.t = 0; F.b = 0; F.from.copy(F.to); sfx('bounce', ball); }
  } else if (F.phase === 'bounce') {   // 落地再彈兩下、往前滾一點
    const dur = F.b ? .2 : .3, hgt = F.b ? .14 : .42, run = F.b ? .25 : .55;
    F.t = Math.min(1, F.t + dt / dur);
    const x = F.from.x + F.dir.x * run * F.t, z = F.from.z + F.dir.z * run * F.t;
    if (walkableAt(x, z)) ball.position.set(x, groundY(x, z) + .11 + Math.sin(Math.PI * F.t) * hgt, z);
    if (F.t >= 1) { F.from.copy(ball.position); F.t = 0; sfx('bounce', ball, .5); if (++F.b >= 2) dropBall(ball.position.x, ball.position.z); }
  } else if (F.phase === 'carried') {
    ball.position.copy(dog.head.localToWorld(_mouth.set(0, -.12, .32)));
  }
  if (F.phase === 'air' || F.phase === 'bounce') ball.rotation.x += dt * 12;
}

/* 花捲：會在島上散步；白天常跳上小蜜蜂機台頂睡午覺，也會窩在廣場邊、碼頭上；晚上比較活潑、眼睛會亮。你手上有魚時，牠會聞到、跑過來討 */
const cat = { path: null, i: 0, state: 'nap', t: 18, awakeT: 0, eatT: 0, phase: 0, meowT: 0, followT: 0, repath: 0, orbit: 0, jump: null, perch: true, after: null };
const CAT_PERCH = new THREE.Vector3(), CAT_FOOT = [0, 0];   // 機台頂（世界座標）、跳上去前站的地方
const CAT_NAPS = [[PLAZA[0] + Math.cos(.55) * 3.2, PLAZA[1] + Math.sin(.55) * 3.2], [.2, 18.2]];   // 廣場長椅邊、碼頭上
{
  const g = new THREE.Group(), body = new THREE.Group(), Wc = 0xf4efe7, Or = 0xe0954f, Dk = 0x5a4f48;
  g.add(body);
  vox(body, RB, Wc, [0, .14, 0], [.32, .24, .52]);
  vox(body, RB, Or, [.05, .245, -.08], [.2, .04, .2]);
  vox(body, RB, Dk, [-.06, .245, .12], [.16, .04, .14]);
  const head = new THREE.Group();
  head.position.set(0, .24, .27);
  body.add(head);
  vox(head, RB, Wc, [0, 0, 0], [.27, .22, .22]);
  vox(head, RB, Or, [-.07, .07, .02], [.13, .1, .2]);
  vox(head, BASE.box, 0xe89aa0, [0, -.03, .112], [.035, .025, .02]);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a20, emissive: 0xd8f070, emissiveIntensity: 0 });
  const eyes = [-1, 1].map(sx => { vox(head, BASE.pyr, sx < 0 ? Or : Dk, [sx * .085, .14, -.02], [.08, .1, .07]); return vox(head, BASE.box, eyeMat, [sx * .065, .03, .112], [.045, .04, .02]); });
  const tail = new THREE.Group();
  tail.position.set(.1, .08, -.24);
  body.add(tail);
  vox(tail, RB, Dk, [.06, 0, -.08], [.07, .07, .22], [0, .5, 0]);
  vox(tail, RB, Or, [.17, 0, -.12], [.07, .07, .14], [0, 1.2, 0]);
  const legs = [[-.09, .15], [.09, .15], [-.09, -.16], [.09, -.16]].map(([lx, lz]) => {
    const pv = new THREE.Group();
    pv.position.set(lx, .06, lz);
    body.add(pv);
    vox(pv, RB, Wc, [0, -.06, 0], [.08, .14, .08]);
    return pv;
  });
  const F = cabFrame(GAME.bee);
  CAB.bee.G.updateMatrixWorld(true);
  CAB.bee.G.localToWorld(CAT_PERCH.set(-.45, 5.04, -.35));
  for (const [lx, lz] of [[2.1, .9], [-2.1, .2], [2.2, -.5], [0, 2.6]]) { const [x, z] = F.w(lx, lz); if (walkableAt(x, z)) { CAT_FOOT[0] = x; CAT_FOOT[1] = z; break; } }
  g.position.copy(CAT_PERCH);
  g.rotation.y = .6 + F.ry;
  g.scale.setScalar(1.3);
  scene.add(g);
  petHit(g, 'cat', [0, .25, 0], [.6, .6, .8]);
  Object.assign(cat, { g, body, head, eyes, eyeMat, tail, legs });
  const pin = addPin('cat', `<span class="no">${svg('paw')}</span>花捲`, '#e0954f', [0, 0, 0], () => petTap('cat'), 'pet');
  g.add(pin.obj);
  pin.obj.position.set(0, .8, 0);
}
const catNapLen = () => night > .6 ? 6 + rnd() * 6 : 22 + rnd() * 20;
function catJump(up, next) {   // 跳上／跳下小蜜蜂機台
  const c = cat;
  c.jump = { from: c.g.position.clone(), to: up ? CAT_PERCH.clone() : new THREE.Vector3(CAT_FOOT[0], groundY(CAT_FOOT[0], CAT_FOOT[1]), CAT_FOOT[1]), t: 0, up, next };
  c.path = null;
  turnTo(c.g, c.jump.to.x - c.jump.from.x, c.jump.to.z - c.jump.from.z, 1);
}
function catGo(x, z, after) {
  if (!goTo(cat, x, z)) return false;
  cat.state = 'walk'; cat.after = after;
  return true;
}
function catTap() {
  const c = cat;
  if (carry.color !== null && !c.perch && Math.hypot(c.g.position.x - avatar.position.x, c.g.position.z - avatar.position.z) < 3) return feedCat();
  if (c.state === 'nap') { c.awakeT = 3; bubble(c.g, '喵…', .75); return; }
  bubble(c.g, '喵', .75);
}
function feedCat() {   // 把魚放在花捲面前的地上
  const c = cat, av = avatar.position, p = c.g.position;
  if (carry.color === null || c.state === 'toFish' || c.state === 'eat') return;
  if (c.perch || c.jump || Math.hypot(p.x - av.x, p.z - av.z) > 3) { bubble(avatar, '花捲還沒過來', 2.3); return; }
  const a = Math.atan2(p.x - av.x, p.z - av.z), fx = av.x + Math.sin(a) * .6, fz = av.z + Math.cos(a) * .6;
  avatar.rotation.y = a;
  groundFish.userData.mat.color.setHex(carry.color);
  groundFish.position.set(fx, groundY(fx, fz) + .07, fz);
  groundFish.rotation.set(0, a + Math.PI / 2, Math.PI / 2);   // 側躺
  groundFish.scale.setScalar(1);
  groundFish.visible = true;
  heldFish.visible = false;
  carry.color = null;
  AV.crouchT = .7;
  c.state = 'toFish';
  if (!goTo(c, fx + Math.sin(a) * .38, fz + Math.cos(a) * .38)) c.path = null;
}
function catPose(dt, t, pose) {
  const c = cat, k = Math.min(1, dt * 6), lie = pose === 'nap', walking = pose === 'walk' || pose === 'jump', awake = !lie || c.awakeT > 0;
  c.phase += dt * (walking ? 12 : 0);
  const sw = walking ? Math.sin(c.phase) * .6 : 0;
  c.legs.forEach((l, i) => { l.rotation.x = i === 0 || i === 3 ? sw : -sw; l.scale.y = lerp(l.scale.y, lie ? .15 : 1, k); });
  c.body.position.y = lerp(c.body.position.y, lie ? 0 : pose === 'sit' ? .05 : .09 + Math.abs(Math.sin(c.phase)) * .02, k);
  c.body.rotation.x = lerp(c.body.rotation.x, pose === 'sit' ? -.22 : pose === 'eat' ? .18 : 0, k);
  c.head.position.y = lerp(c.head.position.y, awake ? .3 : .17, k);
  if (pose === 'eat') { c.head.rotation.x = .3 + Math.abs(Math.sin(t * 9)) * .3; c.head.rotation.y = 0; }   // 吃魚：頭一點一點
  else { c.head.rotation.x = awake ? Math.sin(t * .7) * .1 : .35; c.head.rotation.y = awake && !walking ? Math.sin(t * .4) * .5 : 0; }
  c.body.scale.y = 1 + Math.sin(t * (awake ? 2.2 : 1.2)) * .03;
  c.eyes.forEach(e => { e.scale.y = awake ? .04 : .008; });
  c.eyeMat.emissiveIntensity = awake ? night * 1.6 : 0;
  c.tail.rotation.x = lerp(c.tail.rotation.x, walking || c.state === 'beg' ? .7 : 0, k);   // 走路、討食時尾巴翹起來
  c.tail.rotation.y = Math.sin(t * (awake ? 2.4 : .9)) * .35;
}
function updateCat(dt, t) {
  const c = cat, p = c.g.position, av = avatar.position, dAv = Math.hypot(av.x - p.x, av.z - p.z);
  c.awakeT -= dt; c.meowT -= dt;
  if (c.jump) {
    const J = c.jump;
    J.t = Math.min(1, J.t + dt / .75);
    p.lerpVectors(J.from, J.to, J.t);
    p.y += Math.sin(Math.PI * J.t) * 1.1;
    if (J.t >= 1) {
      c.jump = null; c.perch = J.up; c.state = J.next; c.t = J.next === 'nap' ? catNapLen() : 1.5; c.repath = 0;
      if (J.up) c.g.rotation.y = .6 + cabFrame(GAME.bee).ry;
    }
    return catPose(dt, t, 'jump');
  }
  const wantsFish = carry.color !== null && !flight.phase && !ride.phase;
  if (wantsFish && !['seek', 'beg', 'toFish', 'eat', 'happy'].includes(c.state)) {   // 聞到魚味
    bubble(c.g, '喵？', .75);
    if (c.perch) { catJump(false, 'seek'); return catPose(dt, t, 'jump'); }
    c.state = 'seek'; c.repath = 0; c.path = null;
  }
  let speed = 1.5, slide = false;
  if (c.state === 'nap') {
    if ((c.t -= dt) <= 0) { if (c.perch) catJump(false, 'idle'); else { c.state = 'idle'; c.t = 2; } }
  } else if (c.state === 'idle') {
    if ((c.t -= dt) <= 0) {
      if (rnd() < (night > .6 ? .15 : .45)) {   // 找地方睡：機台頂最愛，其次長椅邊、碼頭
        const k = rnd(), s = k < .55 ? null : k < .8 ? CAT_NAPS[0] : CAT_NAPS[1];
        if (!(s ? catGo(s[0], s[1], 'nap') : catGo(CAT_FOOT[0], CAT_FOOT[1], 'perch'))) c.t = 2;
      } else {
        const sp = randomSpot(...(rnd() < .5 ? PLAZA : [p.x, p.z]), 9);
        if (!(sp && catGo(sp[0], sp[1], 'idle'))) c.t = 2;
      }
    }
  } else if (c.state === 'walk') {
    if (!c.path) {
      if (c.after === 'perch') catJump(true, 'nap');
      else if (c.after === 'nap') { c.state = 'nap'; c.t = catNapLen(); }
      else { c.state = 'idle'; c.t = 3 + rnd() * 5; }
    }
  } else if (c.state === 'seek') {   // 往你跑過來
    speed = 3.4;
    if (!wantsFish) { c.state = 'idle'; c.t = 2; c.path = null; }
    else if (dAv < 1.3) { c.state = 'beg'; c.path = null; c.orbit = Math.atan2(p.x - av.x, p.z - av.z); }
    else if ((c.repath -= dt) <= 0) { goTo(c, av.x, av.z); c.repath = .7; }
  } else if (c.state === 'beg' || c.state === 'happy') {   // 討食：繞著你的腳喵喵叫；吃飽：蹭你的腳
    const happy = c.state === 'happy';
    if (!happy && !wantsFish) { c.state = 'idle'; c.t = 2; }
    else if (!happy && dAv > 2.6) { c.state = 'seek'; c.repath = 0; }
    else {
      c.orbit += dt * (happy ? 1.6 : .8);
      const R = happy ? .55 : 1.0, tx = av.x + Math.sin(c.orbit) * R, tz = av.z + Math.cos(c.orbit) * R, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > .02 && walkableAt(tx, tz)) { const st = Math.min(d, (happy ? 1.8 : 1.4) * dt); p.x += dx / d * st; p.z += dz / d * st; slide = true; }
      turnTo(c.g, happy ? dx : av.x - p.x, happy ? dz : av.z - p.z, dt);
      if (!happy && c.meowT <= 0) { c.meowT = 2.4; bubble(c.g, rnd() < .5 ? '喵～' : '喵嗚', .75); }
      if (happy && (c.t -= dt) <= 0) { c.state = 'follow'; c.followT = 15; c.repath = 0; }
    }
  } else if (c.state === 'toFish') {
    speed = 2.2;
    if (!c.path) { turnTo(c.g, groundFish.position.x - p.x, groundFish.position.z - p.z, 1); c.state = 'eat'; c.eatT = 2.6; }
  } else if (c.state === 'eat') {
    groundFish.scale.setScalar(Math.max(.05, c.eatT / 2.6));
    if ((c.eatT -= dt) <= 0) {
      groundFish.visible = false;
      c.state = 'happy'; c.t = 2.4; c.orbit = Math.atan2(p.x - av.x, p.z - av.z);
      bubble(c.g, '♥', .75);
      setTimeout(() => bubble(c.g, '♥', .75), 1100);
      const n = num('sanasai_catfed') + 1;
      ls.set('sanasai_catfed', String(n));
      addLog('pet', `餵花捲吃了一條魚（第 ${n} 條）`);
    }
  } else if (c.state === 'follow') {   // 吃飽了跟著你走一段
    speed = 3;
    if ((c.followT -= dt) <= 0 || flight.phase || ride.phase) { c.state = 'idle'; c.t = 2; c.path = null; }
    else if (dAv > 1.9) { if ((c.repath -= dt) <= 0) { goTo(c, av.x - Math.sin(avatar.rotation.y) * 1.2, av.z - Math.cos(avatar.rotation.y) * 1.2); c.repath = .6; } }
    else { c.path = null; turnTo(c.g, av.x - p.x, av.z - p.z, dt); }
  }
  const moving = stepAlong(c, speed, dt) || slide;
  if (!c.perch) p.y = groundY(p.x, p.z);
  catPose(dt, t, moving ? 'walk' : c.state === 'nap' ? 'nap' : c.state === 'eat' ? 'eat' : 'sit');
}

/* 寄居蟹：沿著沙灘橫著走，有人靠近就縮進殼裡 */
const crabs = [];
for (const [a0, shell] of [[.95, 0xf0d9c0], [2.25, 0xe9b5a8], [-.45, 0xa9d3d0]]) {
  const g = new THREE.Group(), legsG = new THREE.Group(), R = 0xe0663f;
  vox(g, BASE.cone6, shell, [0, .2, -.04], [.32, .34, .32], [-.4, 0, 0]);
  vox(g, BASE.cone6, new THREE.Color(shell).offsetHSL(0, 0, .06).getHex(), [0, .37, -.13], [.17, .2, .17], [-.7, 0, 0]);
  g.add(legsG);
  vox(legsG, RB, R, [0, .08, .12], [.2, .08, .1]);
  for (const sx of [-1, 1]) {
    vox(legsG, RB, R, [sx * .12, .1, .2], [.09, .07, .1]);
    vox(legsG, BASE.box, 0x2a2523, [sx * .04, .17, .15], [.02, .08, .02]);
    for (const lz of [-.04, .04, .12]) vox(legsG, BASE.box, R, [sx * .15, .04, lz], [.1, .03, .03], [0, 0, sx * .5]);
  }
  g.scale.setScalar(.85);
  scene.add(g);
  const c = { g, legsG, a: a0, a0, dir: rnd() < .5 ? -1 : 1, hide: 0, t: 0 };
  petHit(g, 'crab' + crabs.length, [0, .2, 0], [.6, .5, .6]);
  crabs.push(c);
}
function updateCrabs(dt, t) {
  const av = avatar.position;
  for (const c of crabs) {
    const [x, z] = polar(c.a, .905), near = Math.hypot(av.x - x, av.z - z) < 2.2;
    if (near && c.hide <= 0) c.hide = 3;
    c.hide -= dt;
    const hidden = c.hide > 0;
    c.legsG.scale.setScalar(lerp(c.legsG.scale.x, hidden ? .01 : 1, Math.min(1, dt * 10)));
    if (!hidden) {
      if ((c.t -= dt) <= 0) { c.t = 2 + rnd() * 4; if (rnd() < .4) c.dir *= -1; }
      if (Math.abs(c.a + c.dir * .02 - c.a0) > .35) c.dir *= -1;
      c.a += c.dir * dt * .022;
      c.legsG.position.y = Math.abs(Math.sin(t * 14)) * .015;
    }
    c.g.position.set(x, groundY(x, z), z);
    c.g.rotation.y = Math.atan2(x, z);   // 面向大海、橫著走
  }
}

/* 橘色方塊小傢伙：在廣場和機台之間跳來跳去，偶爾站到機台前敲一敲；晚上去碼頭看海 */
const blob = { path: null, i: 0, state: 'idle', t: 1, hop: 0 };
{
  const g = new THREE.Group(), body = new THREE.Group(), O = 0xd97757;
  g.add(body);
  vox(body, BASE.box, O, [0, .36, 0], [.62, .4, .34]);
  for (const sx of [-1, 1]) {
    vox(body, BASE.box, 0x1d1b1a, [sx * .13, .4, .175], [.07, .12, .02]);
    vox(body, BASE.box, O, [sx * .37, .32, 0], [.12, .12, .2]);
  }
  for (const lx of [-.22, -.08, .08, .22]) vox(body, BASE.box, O, [lx, .08, 0], [.08, .16, .12]);
  g.position.set(-1.6, groundY(-1.6, 4.4), 4.4);
  scene.add(g);
  petHit(g, 'blob', [0, .35, 0], [.8, .7, .5]);
  Object.assign(blob, { g, body });
  const pin = addPin('blob', `<span class="no">${svg('paw')}</span>柑仔丁`, '#d97757', [0, 0, 0], () => petTap('blob'), 'pet');
  g.add(pin.obj);
  pin.obj.position.set(0, 1.1, 0);
}
function updateBlob(dt, t) {
  const B = blob, p = B.g.position;
  if (night > .85 && B.state !== 'pier' && B.state !== 'gaze') { B.state = 'pier'; goTo(B, 0, 22.2); }
  if (night < .6 && (B.state === 'pier' || B.state === 'gaze')) { B.state = 'idle'; B.t = 1; }
  if (B.state === 'idle' && (B.t -= dt) <= 0) {
    const g = GAMES[(rnd() * GAMES.length) | 0], sp = rnd() < .45 ? [g.door[0] + (rnd() - .5) * .8, g.door[1] + (rnd() - .5) * .8] : randomSpot(...PLAZA, 7);
    if (sp && goTo(B, sp[0], sp[1])) { B.state = 'walk'; B.target = g; } else B.t = 1.5;
  } else if (B.state === 'walk' && !B.path) {
    B.state = 'tap'; B.t = 2.5 + rnd() * 2;
  } else if (B.state === 'tap') {
    if (B.target && Math.hypot(B.target.door[0] - p.x, B.target.door[1] - p.z) < 1.4) turnTo(B.g, B.target.at[0] - p.x, B.target.at[1] - p.z, dt);
    if ((B.t -= dt) <= 0) { B.state = 'idle'; B.t = 1 + rnd() * 3; }
  } else if (B.state === 'pier' && !B.path) { B.state = 'gaze'; }
  if (B.state === 'gaze') turnTo(B.g, 0, 1, dt);
  const moving = stepAlong(B, 1.9, dt);
  B.hop = moving ? B.hop + dt * 9 : B.hop;
  const jump = moving ? Math.abs(Math.sin(B.hop)) * .14 : B.state === 'tap' ? Math.abs(Math.sin(t * 8)) * .05 : 0;
  p.y = groundY(p.x, p.z);
  B.body.position.y = jump;
  if (B.jolt > 0) { B.jolt -= dt; B.body.position.y += Math.sin((1 - Math.max(0, B.jolt) / .6) * Math.PI) * .55; }   // 被跺腳的浪嚇得跳起來
  B.body.scale.set(1 + (moving && jump < .02 ? .08 : 0), 1 - (moving && jump < .02 ? .1 : 0), 1);
}
/* 海裡：魚偶爾跳出水面，三隻海豚結伴在島外到處游、偶爾表演 */
const splashes = [], dropGeo = new THREE.BoxGeometry(.07, .07, .07), ringGeo = new THREE.RingGeometry(.12, .26, 24).rotateX(-Math.PI / 2);
function waterSplash(x, z, size = 1, quiet = false) {
  let sp = splashes.find(q => q.t <= 0);
  if (!sp) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    sp = { ring: new THREE.Mesh(ringGeo, mat), drops: [], t: 0 };
    for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(dropGeo, mat); d.visible = false; d.userData.v = new THREE.Vector3(); sp.drops.push(d); scene.add(d); }
    scene.add(sp.ring);
    splashes.push(sp);
  }
  sp.ring.position.set(x, .07, z);
  sp.size = size; sp.t = .9;
  sp.drops.forEach((d, i) => { d.position.set(x, .1, z); d.userData.v.set(Math.cos(i * 1.05) * .9, 2.2 + rnd(), Math.sin(i * 1.05) * .9).multiplyScalar(size); d.visible = true; });
  if (!quiet) sfx('splash', _ssp.set(x, .1, z), size);
}
function updateSplashes(dt) {
  for (const sp of splashes) {
    if (sp.t <= 0) continue;
    sp.t -= dt;
    const k = 1 - Math.max(0, sp.t) / .9;
    sp.ring.scale.setScalar((1 + k * 5) * sp.size);
    sp.ring.material.opacity = (1 - k) * .85;
    for (const d of sp.drops) { d.userData.v.y -= 9.8 * dt; d.position.addScaledVector(d.userData.v, dt); if (d.position.y < 0) d.visible = false; }
  }
}
const fishes = [];
for (const col of [0xf08a3c, 0xc9d6df, 0xf2c14e]) {
  const g = new THREE.Group();
  vox(g, BASE.ico, col, [0, 0, 0], [.2, .24, .52]);
  vox(g, BASE.pyr, col, [0, 0, -.32], [.04, .22, .2], [Math.PI / 2, 0, 0]);
  vox(g, BASE.box, 0x1d1b1a, [0, .04, .19], [.21, .04, .04]);
  g.visible = false;
  scene.add(g);
  fishes.push({ g, t: 2 + rnd() * 6, u: -1, from: new THREE.Vector3(), dir: new THREE.Vector3() });
}
function updateFish(dt) {
  for (const f of fishes) {
    if (f.u < 0) {
      if ((f.t -= dt) > 0) continue;
      const a = f.fa ?? rnd() * TAU, r = islandR(a) * (1.07 + rnd() * .25), x = Math.cos(a) * r, z = Math.sin(a) * r;   // fa：跺腳的浪打上岸的地方（嚇得在那裡跳出來）
      f.fa = null;
      if ((Math.abs(x) < 4.5 && z > 14) || Math.hypot(x - SHIP.x, z - SHIP.z) < SHIP.r + 2) { f.t = .5; continue; }   // 不要跳在碼頭（釣魚點）附近或飛船底下
      const h = rnd() * TAU;
      f.from.set(x, 0, z); f.dir.set(Math.cos(h), 0, Math.sin(h));
      f.u = 0; f.g.visible = true;
      waterSplash(x, z, .55);
    } else {
      f.u = Math.min(1, f.u + dt / .9);
      const k = f.u, x = f.from.x + f.dir.x * 1.8 * k, z = f.from.z + f.dir.z * 1.8 * k, y = Math.sin(Math.PI * k) * 1.1 - .1;
      f.g.position.set(x, y, z);
      f.g.lookAt(x + f.dir.x * 1.8, y + Math.PI * 1.1 * Math.cos(Math.PI * k), z + f.dir.z * 1.8);
      if (k >= 1) { f.g.visible = false; waterSplash(x, z, .55); f.u = -1; f.t = 2.5 + rnd() * 7; }
    }
  }
}

/* 手上的魚：釣到後拿在左手；餵花捲時放到地上 */
const carry = { color: null };
const _hand = new THREE.Vector3();
const [heldFish, groundFish, hookFish] = [0, 1, 2].map(() => {
  const G = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xf08a3c, roughness: .7, flatShading: true });
  const b = new THREE.Mesh(BASE.ico, m), tl = new THREE.Mesh(BASE.pyr, m);
  b.scale.set(.2, .24, .52);
  tl.scale.set(.04, .22, .2); tl.position.z = -.32; tl.rotation.x = Math.PI / 2;
  G.add(b, tl);
  G.userData.mat = m;
  G.visible = false;
  return G;
});
heldFish.scale.setScalar(1.05);
heldFish.position.set(0, -.52, .1);
heldFish.rotation.set(-1.3, 0, 0);   // 抓著尾巴，頭朝下
AV.armL.add(heldFish);
scene.add(groundFish, hookFish);

/* 碼頭盡頭釣魚：站到釣魚點點提示列（或按 Enter）拋竿；浮標往下沉、頭上跳出「！」時，點畫面、提示列或按空白鍵就釣到 */
const FISH_SPOT = [-.55, 22.35], BOB_AT = new THREE.Vector3(-3.6, .06, 24.3);
const FISH_KINDS = [['橘色', 0xf08a3c], ['銀色', 0xc9d6df], ['黃色', 0xf2c14e]];
const fishing = { phase: null, t: 0, wait: 0, kind: 0, cm: 0 };
const rod = new THREE.Group(), rodTip = new THREE.Object3D();
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.016, .026, 1.7, 6).translate(0, .85, 0), new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .7, flatShading: true }));
  rodTip.position.y = 1.7;
  rod.add(pole, rodTip);
  rod.position.set(0, -.5, .06);
  rod.rotation.set(1.1, 0, 0);   // 竿尖往前上方
  rod.visible = false;
  AV.armL.add(rod);
}
const bobber = new THREE.Group();
bobber.add(new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 6, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8483c, roughness: .5 })),
  new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: .5 })));
bobber.visible = false;
scene.add(bobber);
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const fishLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf6f6f2, transparent: true, opacity: .85 }));
fishLine.frustumCulled = false;
fishLine.visible = false;
scene.add(fishLine);
const shadows = [0, 1, 2].map(i => {   // 水裡的魚影：讓人知道這裡有魚
  const m = new THREE.Mesh(new THREE.CircleGeometry(.5, 14), new THREE.MeshBasicMaterial({ color: 0x0b2b3c, transparent: true, opacity: .3, depthWrite: false }));
  m.scale.set(.42, 1, 1);
  m.renderOrder = 2;
  scene.add(m);
  return { m, a: i * 2.1, r: .9 + i * .55, sp: (.35 + i * .08) * (i % 2 ? -1 : 1) };
});
function startFishing() {
  if (fishing.phase || carry.color !== null || uiLock() || state.intro) return;
  const av = avatar.position;
  if (Math.hypot(av.x - FISH_SPOT[0], av.z - FISH_SPOT[1]) > .6) {   // 先走到釣魚點
    if (walkTo(FISH_SPOT[0], FISH_SPOT[1], { follow: true, mark: true, onArrive: startFishing }) && isMobile()) closeCard();
    return;
  }
  if (isMobile()) closeCard();
  walk.path = null;
  avatar.rotation.y = Math.atan2(BOB_AT.x - av.x, BOB_AT.z - av.z);
  rod.visible = true;
  AV.throwT = .35;
  sfx('cast', avatar);
  Object.assign(fishing, { phase: 'cast', t: 0 });
}
function endFishing() {
  Object.assign(fishing, { phase: null, t: 0 });
  rod.visible = bobber.visible = fishLine.visible = false;
}
function reel() {   // 拉竿
  const F = fishing;
  if (F.phase === 'bite') {
    Object.assign(F, { phase: 'catch', t: 0, kind: (rnd() * 3) | 0, cm: Math.round(12 + rnd() * rnd() * 30) });   // 小魚多、大魚少
    hookFish.userData.mat.color.setHex(FISH_KINDS[F.kind][1]);
    hookFish.scale.setScalar(.7 + F.cm / 40);
    hookFish.visible = true;
    bobber.visible = fishLine.visible = false;
    waterSplash(BOB_AT.x, BOB_AT.z, .8);
    AV.throwT = .35;
    sfx('reel', avatar);
  } else if (F.phase === 'wait') {
    if (F.t > F.wait - 1.3) { bubble(avatar, '太早了，魚被嚇跑了', 2.3); sfx('fail'); endFishing(); }   // 魚在試咬時拉竿
    else bubble(avatar, '還沒上鉤，再等等', 2.3);
  }
}
function showCatch(kind, cm) {
  const n = num('sanasai_fish_n') + 1, best = num('sanasai_fish_best'), rec = cm > best;
  ls.set('sanasai_fish_n', String(n));
  if (rec) ls.set('sanasai_fish_best', String(cm));
  const el = $('#catch-card');
  el.style.setProperty('--c', '#' + FISH_KINDS[kind][1].toString(16).padStart(6, '0'));
  $('#catch-text').textContent = `一條${FISH_KINDS[kind][0]}的魚，${cm} 公分${rec && n > 1 ? '（最大紀錄）' : ''}`;
  el.hidden = false;
  sfx('jingle', null, rec && n > 1);
  clearTimeout(showCatch.timer);
  showCatch.timer = setTimeout(() => { el.hidden = true; }, 3600);
  if (n === 1) addLog('pet', `第一次在碼頭釣到魚（${cm} 公分）`);
  else if (rec) addLog('pet', `釣到目前最大的一條：${cm} 公分`);
}
function updateFishing(dt, t) {
  const F = fishing, lead = F.phase === 'wait' ? smooth(1 - (F.wait - F.t) / 1.3) : F.phase === 'bite' ? 1 : 0;
  for (const s of shadows) {
    s.a += dt * s.sp;
    const k = s === shadows[0] ? lead : 0;   // 試咬時第一隻游到浮標底下
    s.m.position.set(lerp(BOB_AT.x + Math.cos(s.a) * s.r, BOB_AT.x, k), .1, lerp(BOB_AT.z + Math.sin(s.a) * s.r, BOB_AT.z + .25, k));
    s.m.rotation.set(-Math.PI / 2, 0, Math.PI - s.a * Math.sign(s.sp));
    s.m.material.opacity = .3 * (1 - night * .5);
  }
  if (!F.phase) return;
  F.t += dt;
  if (F.phase === 'cast') {   // 拋竿：浮標畫一道弧落到水上
    const k = Math.min(1, F.t / .7);
    rodTip.getWorldPosition(_hand);
    bobber.visible = fishLine.visible = k > .25;
    bobber.position.lerpVectors(_hand, BOB_AT, k);
    bobber.position.y += Math.sin(Math.PI * k) * 2;
    if (k >= 1) { waterSplash(BOB_AT.x, BOB_AT.z, .5); Object.assign(F, { phase: 'wait', t: 0, wait: 2.2 + rnd() * 3.5 }); }
  } else if (F.phase === 'wait') {
    const left = F.wait - F.t;
    const tw = left < 1.1 && left % .5 < .12;   // 最後一秒浮標抖兩下（每抖一下「噗」一聲）
    bobber.position.set(BOB_AT.x, BOB_AT.y + Math.sin(t * 3) * .025 - (tw ? .05 : 0), BOB_AT.z);
    if (tw && !F.tw) sfx('plip', bobber);
    F.tw = tw;
    if (left <= 0) { Object.assign(F, { phase: 'bite', t: 0 }); bubble(avatar, '！', 2.3); waterSplash(BOB_AT.x, BOB_AT.z, .35); sfx('bite'); }
  } else if (F.phase === 'bite') {   // 上鉤：浮標沉下去，大約一秒半內要拉
    bobber.position.set(BOB_AT.x, BOB_AT.y - .14 + Math.sin(t * 22) * .03, BOB_AT.z);
    if (F.t > 1.5) { bubble(avatar, '魚跑掉了，再拋一次', 2.3); sfx('fail'); endFishing(); }
  } else if (F.phase === 'catch') {   // 魚跳出水面、落進左手
    const k = Math.min(1, F.t / .8);
    hookFish.position.lerpVectors(BOB_AT, AV.armL.localToWorld(_hand.set(0, -.5, .12)), k);
    hookFish.position.y += Math.sin(Math.PI * k) * 2.2;
    hookFish.rotation.x += dt * 12;
    if (k >= 1) {
      hookFish.visible = false;
      rod.visible = false;
      carry.color = FISH_KINDS[F.kind][1];
      heldFish.userData.mat.color.setHex(carry.color);
      heldFish.visible = true;
      showCatch(F.kind, F.cm);
      endFishing();
    }
  }
  if (fishLine.visible) {
    const a = lineGeo.attributes.position;
    rodTip.getWorldPosition(_hand);
    a.setXYZ(0, _hand.x, _hand.y, _hand.z);
    a.setXYZ(1, bobber.position.x, bobber.position.y + .06, bobber.position.z);
    a.needsUpdate = true;
  }
}

/* 能量劍打小蜜蜂：靠近小蜜蜂機台，蜜蜂會從螢幕飛出來朝你俯衝；揮劍打中就碎成像素 */
const divers = [], bits = [], DIVE_R = 7;
let diveCD = 2.5, combo = 0, comboT = 0;
const _dv = new THREE.Vector3(), _sw = new THREE.Vector3(), _prev = new THREE.Vector3();
function bez(out, a, b, c, d, k) {   // 三次貝茲曲線
  const u = 1 - k;
  return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * k).addScaledVector(c, 3 * u * k * k).addScaledVector(d, k * k * k);
}
function spawnDiver() {
  let d = divers.find(q => !q.on);
  if (!d) {
    const g = new THREE.Group(), w1 = new THREE.Mesh(swarm.wings.geometry, swarm.wings.material), w2 = new THREE.Mesh(swarm.wings.geometry, swarm.wings.material);
    g.add(new THREE.Mesh(swarm.body.geometry, MAT.solid), w1, w2);
    w1.position.set(.16, .12, 0);
    w2.position.set(-.16, .12, 0); w2.rotation.y = Math.PI;
    scene.add(g);
    d = { g, w1, w2, on: false, k: 0, p: [0, 1, 2, 3, 4, 5, 6].map(() => new THREE.Vector3()) };
    divers.push(d);
  }
  const G = CAB.bee.G, av = avatar.position, P = d.p, side = rnd() < .5 ? -1 : 1;
  G.localToWorld(P[0].copy(BEE_CURVE.getPointAt(.03)));   // 從螢幕裡飛出來
  const top = G.localToWorld(new THREE.Vector3(0, 7.5, 0));
  const dir = _dv.set(av.x - P[0].x, 0, av.z - P[0].z).normalize();
  P[3].set(av.x - dir.z * .45 * side, av.y + 1.25, av.z + dir.x * .45 * side);   // 從頭邊擦過去
  P[1].copy(P[0]).add(new THREE.Vector3(dir.x * 1.5, 2.6, dir.z * 1.5));
  P[2].copy(P[3]).add(new THREE.Vector3(-dir.x * 2.2, 1.4, -dir.z * 2.2));
  P[4].copy(P[3]).add(new THREE.Vector3(dir.x * 2.5, .6, dir.z * 2.5));
  P[5].copy(top).add(new THREE.Vector3(dir.x * 3, 2.5, dir.z * 3));
  P[6].copy(top);
  d.on = true; d.k = 0;
  d.g.visible = true; d.g.scale.setScalar(1);
  d.g.position.copy(P[0]);
}
function swing() {
  if (AV.swingT > 0 || flight.phase) return;
  AV.swingT = .45;
  AV.saberT = 3;
  sfx('whoosh', avatar);
  let best = null, bd = 3.5;   // 附近有俯衝的蜜蜂就轉向牠
  for (const d of divers) {
    if (!d.on) continue;
    const dd = Math.hypot(d.g.position.x - avatar.position.x, d.g.position.z - avatar.position.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  if (best) avatar.rotation.y = Math.atan2(best.g.position.x - avatar.position.x, best.g.position.z - avatar.position.z);
}
const BIT_GEO = new THREE.BoxGeometry(.11, .11, .11), BIT_MATS = [0xf5c518, 0x2a2a35, 0xe63946, 0xffffff].map(c => new THREE.MeshBasicMaterial({ color: c }));
function pixelBurst(pos, mats = BIT_MATS) {
  for (let i = 0; i < 16; i++) {
    let b = bits.find(q => q.t <= 0);
    if (!b) { b = { m: new THREE.Mesh(BIT_GEO, BIT_MATS[0]), v: new THREE.Vector3(), t: 0 }; scene.add(b.m); bits.push(b); }
    b.m.material = mats[i % mats.length];
    b.m.position.copy(pos);
    b.m.scale.setScalar(1);
    b.m.visible = true;
    b.v.set(rnd() - .5, rnd() * .9 + .2, rnd() - .5).normalize().multiplyScalar(3 + rnd() * 3);
    b.t = .7;
  }
}
function updateDivers(dt, t) {
  if (!swarm) return;
  const av = avatar.position, door = GAME.bee.door;
  if (Math.hypot(av.x - door[0], av.z - door[1]) < DIVE_R && !state.nearGame && !uiLock() && !flight.phase && (diveCD -= dt) <= 0 && divers.filter(d => d.on).length < 2) { spawnDiver(); diveCD = 1.6 + rnd() * 1.6; }
  if ((comboT -= dt) <= 0) combo = 0;
  const striking = AV.swingT > 0 && AV.swingT < .33;   // 揮下去的那一段才算
  _sw.set(av.x + Math.sin(avatar.rotation.y) * .55, av.y + 1.15, av.z + Math.cos(avatar.rotation.y) * .55);
  for (const d of divers) {
    if (!d.on) continue;
    d.k += dt / (d.k < 1 ? 1.3 : 1.4);
    _prev.copy(d.g.position);
    if (d.k < 1) bez(d.g.position, d.p[0], d.p[1], d.p[2], d.p[3], d.k);
    else bez(d.g.position, d.p[3], d.p[4], d.p[5], d.p[6], Math.min(1, d.k - 1));
    d.g.lookAt(_dv.copy(d.g.position).multiplyScalar(2).sub(_prev));
    const f = Math.sin(t * 30) * .8;
    d.w1.rotation.z = f; d.w2.rotation.z = f;
    if (d.k > 1.75) d.g.scale.setScalar(Math.max(.01, (2 - d.k) / .25));
    if (d.k >= 2) { d.on = false; d.g.visible = false; continue; }
    if (striking && d.g.position.distanceTo(_sw) < 1.5) {
      pixelBurst(d.g.position);
      sfx('zap', d.g);
      d.on = false; d.g.visible = false;
      combo++; comboT = 2.5;
      bubble(avatar, combo > 1 ? `擊落 ×${combo}` : '擊落！', 2.3);
      const n = num('sanasai_beehits') + 1;
      ls.set('sanasai_beehits', String(n));
      if (n === 1 || n === 10 || n % 50 === 0) addLog('pet', `用能量劍打下第 ${n} 隻小蜜蜂`);
    }
  }
  for (const b of bits) {
    if (b.t <= 0) continue;
    b.t -= dt;
    b.v.y -= 9.8 * dt;
    b.m.position.addScaledVector(b.v, dt);
    b.m.scale.setScalar(Math.max(.01, b.t / .7));
    if (b.t <= 0) b.m.visible = false;
  }
}
/* 海豚：一群三隻跟著一個看不見的「帶頭點」走。帶頭點繞著島去下一個目的地（看得到的地方優先、偶爾繞遠路、會掉頭），
   或停下來兜圈子玩；三隻照隊形跟（人字／縱隊／並排／鬆散），各自轉彎、加減速。表演只挑鏡頭看得到的時候。 */
const dolphins = [];
/* 能游的水域只用「離島中心至少多遠」一條線圍（離岸 4；南邊停飛船、碼頭盡頭、釣魚浮標那段往外鼓到約 28）。
   不用好幾個圓形禁區：圓跟圓疊起來會有凹角，帶頭點會卡在裡面出不來 */
const dolMinR = a => islandR(a) + 4 + 6.3 * smooth((.55 - Math.abs(Math.atan2(Math.sin(a - 1.48), Math.cos(a - 1.48)))) / .3);
const DOL_FORM = [   // 隊形：每隻 [往前, 往右]，以帶頭點為準
  [[0, 0], [-1.8, -1.5], [-1.8, 1.5]],    // 人字
  [[0, 0], [-2.3, .35], [-4.6, -.35]],    // 一路縱隊（連跳用）
  [[0, 0], [0, -1.8], [0, 1.8]],          // 並排（同步跳用）
  [[.6, -1], [-1.2, 1.4], [-2.8, -.4]],   // 鬆散，位置會慢慢飄
];
const DOL_RR = 2.2, DOL_PH = .8, DOL_ARC = 2 * DOL_RR * DOL_PH, DOL_GLIDE = 1.4;   // 換氣滾過水面的圓弧（半徑、單邊角度、弧長）＋水下那段的長度
const TRICKS = { hop: [.75, .9], jump: [1.3, 2.2], spin: [1.5, 2.6], flip: [1.7, 3], walk: [2.6, 0] };   // [秒, 跳多高]；spin＝邊跳邊轉兩圈、flip＝後空翻、walk＝立起來用尾巴在水面倒退走
const pod = { x: Math.cos(.9) * 26, z: Math.sin(.9) * 26, h: Math.atan2(-Math.sin(.9), Math.cos(.9)), v: 1.6, vT: 1.6, w: 0, mode: 'go', ga: 0, gr: 26, dir: 1, t: 0, wv: 0, cx: 0, cz: 0, ph: 0, spin: 1, flipT: 0, form: 0, show: null, showT: 8 };
const _dfr = new THREE.Frustum(), _dfm = new THREE.Matrix4(), _dv3 = new THREE.Vector3();
const dolView = (x, z) => _dfr.containsPoint(_dv3.set(x, 0, z)) && camera.position.distanceTo(_dv3) < 80;   // 鏡頭看得到這裡嗎
function dolRoom(x, z) {   // 離不能去的地方還有多遠（岸邊／南邊那段、太遠的外海）；≥0 就是舒服的水域
  const r = Math.hypot(x, z);
  return Math.min(r - dolMinR(Math.atan2(z, x)), 36 - r);
}
function dolKeep(o) {   // 保底：怎樣都不會游上岸、鑽到飛船底下
  const r = Math.hypot(o.x, o.z), lo = dolMinR(Math.atan2(o.z, o.x)) - 1.2, k = r < lo ? lo / r : r > 38 ? 38 / r : 1;
  o.x *= k; o.z *= k;
}
function dolTurn(o, hd, w, dt) {   // 朝 hd 轉，每秒最多 w；要掉頭時，靠岸那段往外海那側轉（不往岸上切），轉的方向一決定就轉到底，不左右搖擺
  let d = Math.atan2(Math.sin(hd - o.h), Math.cos(hd - o.h));
  if (Math.abs(d) > 2.5) {
    if (!o.ut) { const s = Math.sin(Math.atan2(o.x, o.z) - o.h); o.ut = (dolRoom(o.x, o.z) < 5 && Math.abs(s) > .05 ? Math.sign(s) : Math.sign(d)) || 1; }
    if (Math.sign(d) !== o.ut) d -= Math.sign(d) * TAU;
  } else o.ut = 0;
  const s = clamp(d, -w * dt, w * dt);
  o.h = Math.atan2(Math.sin(o.h + s), Math.cos(o.h + s)); o.w = s / Math.max(dt, 1e-3);
}
function dolPlan() {   // 選下一段：游去別處，或在原地兜圈子玩（表演進行中就不停下來玩、也不改隊形和衝刺速度）
  const a = Math.atan2(pod.z, pod.x), S = pod.show;
  if (pod.mode === 'go' && !S && rnd() < .4) {
    let cx = pod.x, cz = pod.z;
    for (let i = 0; i < 12 && dolRoom(cx, cz) < 3; i++) { cx *= 1.04; cz *= 1.04; }   // 兜圈子的地方往外挪到夠寬
    if (dolRoom(cx, cz) >= 3 && dolView(cx, cz)) {
      Object.assign(pod, { mode: 'play', t: 8 + rnd() * 7, cx, cz, ph: Math.atan2(pod.z - cz, pod.x - cx), spin: rnd() < .5 ? 1 : -1, flipT: 3 + rnd() * 3, vT: 1.3 + rnd() * .5, form: 3 });
      pod.showT = Math.min(pod.showT, 2 + rnd() * 2);
      return;
    }
  }
  let ga = a + 1.5, gr = 26, best = -1;
  for (let i = 0; i < 10; i++) {   // 抽幾個候選點，鏡頭看得到的加分
    const ca = rnd() * TAU, cr = dolMinR(ca) + .6 + rnd() * 6.5, x = Math.cos(ca) * cr, z = Math.sin(ca) * cr;
    if (Math.abs(Math.atan2(Math.sin(ca - a), Math.cos(ca - a))) < .8 || dolRoom(x, z) < .5) continue;
    const s = rnd() + (dolView(x, z) ? 1.2 : 0);
    if (s > best) { best = s; ga = ca; gr = cr; }
  }
  const da = Math.atan2(Math.sin(ga - a), Math.cos(ga - a)), vT = .9 + rnd() * 1.5, form = [0, 1, 3][(rnd() * 3) | 0];
  Object.assign(pod, { mode: 'go', ga, gr, dir: (rnd() < .2 ? -1 : 1) * Math.sign(da), t: 90, wv: rnd() * TAU, vT: S && S.k === 'wave' ? pod.vT : vT, form: S ? pod.form : form });   // 兩成繞遠路
  if (S && S.k === 'wave') S.v0 = vT;   // 連跳完改用新這段的速度
}
function dolTrick(d, k) {   // 開始一個動作；落點不在舒服的水域就不做
  if (d.tr) return false;
  const [dur, H] = TRICKS[k], v = k === 'walk' ? -1.7 : Math.max(d.v, k === 'hop' ? 3.2 : 3.6), L = v * dur * (k === 'walk' ? .7 : 1);
  if (dolRoom(d.x + Math.sin(d.h) * L, d.z + Math.cos(d.h) * L) < 0) return false;
  d.tr = { k, u: 0, dur, H, v, v0: d.v, sp: 0, y0: d.y, ps: d.pitch };   // 從換氣起伏的當下位置接著跳
  waterSplash(d.x, d.z, k === 'hop' ? .6 : 1, k === 'hop');   // 連跳時起跳不出聲，不然太吵
  return true;
}
function dolShow(dt, vis) {   // 誰、什麼時候表演
  const S = pod.show;
  if (!S) {
    if ((pod.showT -= dt) > 0 || dolphins.some(d => d.tr)) return;
    if (!vis) { pod.showT = 1.5; return; }   // 沒人看就先不演，等游進畫面
    const r = rnd();
    if (r < .28 && pod.mode === 'go') { pod.show = { k: 'wave', t: 5.5, v0: pod.vT }; pod.form = 1; pod.vT = 3.6; dolphins.forEach((d, i) => d.nh = .5 + i * .3); }   // 衝刺連跳，一隻接一隻像波浪
    else if (r < .55) { pod.show = { k: 'sync', t: 0 }; pod.form = 2; }   // 排成並排，一起跳
    else {   // 個人秀
      const d = dolphins[(rnd() * 3) | 0];
      if (!dolTrick(d, ['spin', 'flip', 'walk', 'jump', 'spin', 'flip', 'walk'][(rnd() * 7) | 0])) dolTrick(d, 'jump');
      pod.showT = (pod.mode === 'play' ? 3 : 7) + rnd() * 7;
    }
    return;
  }
  if (S.k === 'wave') {
    for (const d of dolphins) if (!d.tr && (d.nh -= dt) <= 0) { dolTrick(d, 'hop'); d.nh = .3 + rnd() * .2; }
    if ((S.t -= dt) <= 0) { pod.show = null; pod.vT = S.v0; pod.form = 0; pod.showT = 9 + rnd() * 9; }
  } else if (!S.go) {
    S.t += dt;
    if (S.t > 4 || dolphins.every(d => Math.hypot(d.x - d.sx, d.z - d.sz) < 1.1 && Math.abs(Math.sin((d.h - pod.h) / 2)) < .12)) {
      S.go = true;
      const mid = rnd() < .5 ? 'spin' : 'jump';
      dolphins.forEach((d, i) => dolTrick(d, i ? 'jump' : mid));
    }
  } else if (!dolphins.some(d => d.tr)) { pod.show = null; pod.form = 3; pod.showT = 9 + rnd() * 9; }
}
/* 海豚造型（照寬吻海豚照片做）：圓鼓的額頭急降到一截短嘴、往後彎的鉤狀背鰭、中間有缺口的水平尾鰭、小胸鰭、
   小眼睛和往上翹的嘴線；背深灰、側面淺灰、肚子白。身體用一段段橢圓斷面接起來——
   拉長的球＋三角背鰭＋圓錐尖鼻子，看起來會像鯊魚 */
const DOL_GEO = (() => {
  // 斷面 [z, 半寬, 半高, 中心高度]，從尾巴根部到嘴尖；0.74→0.8 那一段額頭陡降，就是「額隆＋短嘴」
  const ST = [[-.95, .03, .035, .02], [-.86, .05, .06, .025], [-.7, .085, .11, .03], [-.45, .16, .19, .03], [-.15, .23, .26, .02], [.15, .25, .28, .01],
    [.45, .23, .25, 0], [.62, .19, .205, -.015], [.74, .14, .155, -.035], [.8, .095, .09, -.07], [.92, .065, .055, -.095], [1.02, .03, .03, -.1]];
  const N = 10, pos = [], col = [], CAPE = 0x6c7a87, cs = [new THREE.Color(CAPE), new THREE.Color(0x96a3ae), new THREE.Color(0xe6e9eb)];
  const P = (i, k) => { const [z, w, h, c] = ST[i], a = k / N * TAU + Math.PI / 2; return [Math.cos(a) * w, c + Math.sin(a) * h, z, Math.sin(a)]; };
  const tri = (a, b, c) => {   // 每個面一個顏色：朝上＝背、朝旁邊＝側面、朝下＝肚子
    const s = (a[3] + b[3] + c[3]) / 3, k = s > .3 ? 0 : s > -.25 ? 1 : 2;
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); col.push(cs[k].r, cs[k].g, cs[k].b); }
  };
  for (let i = 0; i < ST.length - 1; i++) for (let k = 0; k < N; k++) { const a = P(i, k), b = P(i, k + 1), c = P(i + 1, k), d = P(i + 1, k + 1); tri(a, b, c); tri(b, d, c); }
  for (let k = 0; k < N; k++) { tri(P(ST.length - 1, k), P(ST.length - 1, k + 1), [0, -.1, 1.05, 0]); tri(P(0, k + 1), P(0, k), [0, .02, -.97, 0]); }   // 嘴尖、尾巴根部封口
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.computeVertexNormals();
  const flat = (pts, depth) => {   // 平面輪廓（直線＋二次曲線）擠出成薄片，厚度置中
    const sh = new THREE.Shape();
    sh.moveTo(...pts[0]);
    for (const p of pts.slice(1)) p.length > 2 ? sh.quadraticCurveTo(...p) : sh.lineTo(...p);
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -depth / 2);
    g.deleteAttribute('uv');
    return g;
  };
  // 背鰭：側面輪廓 (往前, 往上)，前緣往後上方彎、後緣內凹
  const fin = flat([[.1, .24], [0, .5, -.3, .62], [-.19, .42, -.23, .22], [.1, .2]], .05).rotateY(-Math.PI / 2);
  // 尾鰭：俯視輪廓 (往右, 往前)，兩片往後掠、中間一道缺口
  const fluke = flat([[0, .06], [.3, .04, .48, -.2], [.24, -.13, .03, -.13], [0, -.09], [-.03, -.13], [-.24, -.13, -.48, -.2], [-.3, .04, 0, .06]], .04).rotateX(Math.PI / 2);
  // 胸鰭：(往外, 往前)，尖端往後掠；左右各做一片（鏡像輪廓，面才會朝外）
  const flip = s => flat([[0, .06], [s * .14, .06, s * .27, -.1], [s * .12, -.06, 0, -.06]], .03).rotateX(Math.PI / 2);
  return { body, mat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .5 }), fin, fluke, flipR: flip(1), flipL: flip(-1), cape: CAPE };
})();
for (let i = 0; i < 3; i++) {
  const g = new THREE.Group(), body = new THREE.Group(), tail = new THREE.Group(), D = DOL_GEO, hull = new THREE.Mesh(D.body, D.mat);
  g.add(body);
  hull.castShadow = true;
  body.add(hull);
  vox(body, D.fin, D.cape, [0, 0, 0], [1, 1, 1]);
  for (const s of [-1, 1]) {
    vox(body, s > 0 ? D.flipR : D.flipL, D.cape, [s * .19, -.15, .4], [1, 1, 1], [0, 0, -s * .55]);
    vox(body, BASE.sphere, 0x22262a, [s * .19, .005, .6], [.036, .036, .036]);   // 眼睛
    vox(body, BASE.box, 0x46505a, [s * .066, -.105, .89], [.008, .008, .22], [0, -s * .29, 0]);   // 嘴線
  }
  tail.position.set(0, .02, -.93);
  body.add(tail);
  vox(tail, D.fluke, D.cape, [0, 0, 0], [1, 1, 1]);
  g.scale.setScalar(.85);
  scene.add(g);
  petHit(body, 'dolphin' + i, [0, .1, 0], [.8, .8, 2]);   // 掛在身體上：立起來、翻跟斗時也點得到
  const [f, s] = DOL_FORM[0][i], fx = Math.sin(pod.h), fz = Math.cos(pod.h);
  dolphins.push({ g, body, tail, x: pod.x + fx * f - fz * s, z: pod.z + fz * f + fx * s, sx: 0, sz: 0, h: pod.h, v: 1.6, vT: 1.6, w: 0, roll: 0, fl: i, br: i * .33, y: -.6, pitch: 0, tr: null, nh: 0, jt: 0, ep: 0, ek: 0 });
}
dolPlan();
function updateDolphins(dt, t) {
  _dfm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _dfr.setFromProjectionMatrix(_dfm);
  // 帶頭點：去目的地（沿著島繞過去，路上左右蛇行），或繞著一個點兜圈子、繞到一半換方向游出 8 字
  const P = pod, a = Math.atan2(P.z, P.x), r = Math.hypot(P.x, P.z), rem = () => (((P.ga - a) * P.dir) % TAU + TAU) % TAU;
  if ((P.t -= dt) < 0 || (P.mode === 'go' && (rem() < .1 || rem() > TAU - .25))) dolPlan();
  let cx, cz;
  if (P.mode === 'go') {
    const ac = a + P.dir * Math.min(rem(), .35);
    const rc = clamp(r + (P.gr - r) * .5 + Math.sin(t * .4 + P.wv) * 1.6, dolMinR(ac) + .4, 32);   // 經過飛船、碼頭那段自然往外繞
    cx = Math.cos(ac) * rc; cz = Math.sin(ac) * rc;
  } else {
    P.ph += P.spin * dt * P.v / 2.6;
    if (P.flipT > 0 && (P.flipT -= dt) <= 0) P.spin *= -1;
    cx = P.cx + Math.cos(P.ph + P.spin * .8) * 2.6; cz = P.cz + Math.sin(P.ph + P.spin * .8) * 2.6;
  }
  dolTurn(P, Math.atan2(cx - P.x, cz - P.z), .9, dt);
  P.v += clamp(P.vT - P.v, -.8 * dt, .8 * dt);
  P.x += Math.sin(P.h) * P.v * dt; P.z += Math.cos(P.h) * P.v * dt;
  dolKeep(P);
  dolShow(dt, dolView(P.x, P.z));
  // 三隻照隊形跟：追自己的位置、落後就加速；快靠岸／靠近飛船就往外偏，順著邊游過去
  const fx = Math.sin(P.h), fz = Math.cos(P.h), F = DOL_FORM[P.form];
  dolphins.forEach((d, i) => {
    let [sf, sr] = F[i];
    if (P.form === 3) { sf += Math.sin(t * .31 + i * 2.1) * 1.1; sr += Math.cos(t * .23 + i * 1.3) * 1.1; }
    d.sx = P.x + fx * sf - fz * sr; d.sz = P.z + fz * sf + fx * sr;
    const s0 = Math.hypot(d.sx, d.sz), sLo = dolMinR(Math.atan2(d.sz, d.sx)) + .3, sk = s0 < sLo ? sLo / s0 : s0 > 34 ? 34 / s0 : 1;
    d.sx *= sk; d.sz *= sk;   // 隊形位置落在游不到的地方（太靠岸、太外海）就挪回能游的水域，不然會一直撞邊界
    if (d.jt > 0 && (d.jt -= dt) <= 0) dolTrick(d, 'hop');
    // 換氣：身體順著一段圓弧滾過水面——頭先出水、背和背鰭拱起來、頭先下去、背鰭最後沒入，再到水下繞一小段回來（看不到）。
    // 背鰭平平劃著水面走、或比頭先冒出來，看起來就是鯊魚。進度照游過的距離算，游越快換得越勤
    const br0 = d.br, bq = (d.br = (d.br + Math.max(d.v, 1.2) * dt / (DOL_ARC + DOL_GLIDE)) % 1) * (DOL_ARC + DOL_GLIDE);
    let y, pitch, roll, flap, sp = d.v;
    if (bq < DOL_ARC) { const f = DOL_PH - bq / DOL_RR; y = -.05 - DOL_RR * (1 - Math.cos(f)); pitch = -f; }
    else { const g = (bq - DOL_ARC) / DOL_GLIDE; y = -.05 - DOL_RR * (1 - Math.cos(DOL_PH)) - .3 * Math.sin(Math.PI * g); pitch = DOL_PH * Math.cos(Math.PI * g); }
    if (!d.tr && br0 < .08 && d.br >= .08) waterSplash(d.x + Math.sin(d.h) * .5, d.z + Math.cos(d.h) * .5, .25, true);   // 頭出水那一下的小水花
    const along = (d.sx - d.x) * fx + (d.sz - d.z) * fz, la = Math.max(2, 2 - along);   // 衝過頭（剛跳完）就把目標往前放，慢下來等，不回頭
    let dx = d.sx + fx * la - d.x, dz = d.sz + fz * la - d.z;
    const q = Math.hypot(dx, dz) || 1, dr = Math.hypot(d.x, d.z), m = dr - dolMinR(Math.atan2(d.z, d.x));
    dx /= q; dz /= q;
    if (m < 2.5) { const k = smooth((2.5 - m) / 2.5) * 1.6; dx += d.x / dr * k; dz += d.z / dr * k; }
    if (dr > 33) { const k = smooth((dr - 33) / 2.5) * 1.6; dx -= d.x / dr * k; dz -= d.z / dr * k; }
    for (const o of dolphins) {   // 別擠在一起：太近就往旁邊讓
      if (o === d || o.tr) continue;
      const ex = d.x - o.x, ez = d.z - o.z, eq = Math.hypot(ex, ez);
      if (eq < 2.4 && eq > 1e-4) { const k = (2.4 - eq) / 2.4 * 1.2; dx += ex / eq * k; dz += ez / eq * k; }
    }
    if (!d.tr) {
      dolTurn(d, Math.atan2(dx, dz), 2 + 2.5 * smooth((1 - m) / 2.5), dt);   // 越貼近邊界轉得越急，追隊伍游很快時也煞得住
      d.vT = clamp(P.v + along * .9, .3, 5.5);
      d.v += clamp(d.vT - d.v, -3 * dt, 3 * dt);
      sp = d.v;
      d.fl += dt * (3 + d.v * 1.6);
      flap = Math.sin(d.fl) * .35;
      d.roll += (clamp(-d.w * .35, -.45, .45) - d.roll) * Math.min(1, dt * 4);   // 轉彎時身體往內側傾
      roll = d.roll;
      if (d.ek > 0) { d.ek = Math.max(0, d.ek - dt / .35); pitch += d.ep * smooth(d.ek); }   // 剛落水：頭慢慢抬回來
    } else {
      const T = d.tr, u = T.u = Math.min(1, T.u + dt / T.dur);
      let endP = 0;
      if (T.k === 'hop') dolTurn(d, Math.atan2(dx, dz), 1.2, dt);   // 連跳時邊跳邊慢慢轉，跟得上隊伍轉彎
      roll = d.roll *= 1 - Math.min(1, dt * 4);
      if (T.k === 'walk') {   // 立起來 → 尾巴撥水倒退走 → 往前倒回水裡
        const up = smooth(u / .18) * (1 - smooth((u - .82) / .18)), lean = Math.PI / 2 + .12;
        sp = (T.v0 + (T.v - T.v0) * smooth(u / .18)) * (1 - smooth((u - .82) / .18));
        y = -.2 + 1.12 * up + Math.sin(t * 16) * .04 * up + (T.y0 + .2) * (1 - smooth(u / .25));
        pitch = T.ps * (1 - smooth(u / .18)) + (-lean + Math.sin(t * 9) * .05) * up;
        flap = Math.sin(t * 22) * .45;
        if (up > .9 && (T.sp -= dt) <= 0) { T.sp = .11; waterSplash(d.x + Math.sin(d.h) * .15, d.z + Math.cos(d.h) * .15, .35, true); }
      } else {   // 拋物線：頭跟著軌跡抬起、放平、朝下；spin 邊跳邊轉兩圈，flip 整個往後翻一圈
        sp = T.v;
        y = Math.sin(Math.PI * u) * T.H - .2 + (T.y0 + .2) * (1 - smooth(u / .25));
        const p0 = Math.atan(T.H * Math.PI / (T.dur * T.v)), traj = -Math.atan(T.H * Math.PI * Math.cos(Math.PI * u) / (T.dur * T.v));
        pitch = T.ps + ((T.k === 'flip' ? -p0 - smooth(u) * (TAU - 2 * p0) : traj) - T.ps) * smooth(u / .15);
        if (T.k === 'spin') roll = smooth((u - .08) / .84) * TAU * 2;
        flap = Math.sin(d.fl += dt * 4) * .12;
        endP = p0;   // 入水時頭朝下的角度（後空翻轉完一圈也是這個角度）
      }
      if (u >= 1) {
        d.tr = null;
        waterSplash(d.x, d.z, { hop: .6, jump: 1.1, spin: 1.1, flip: 1.3, walk: 1.2 }[T.k]);
        d.v = T.k === 'walk' ? .8 : T.v * .7;
        d.br = .524; d.ep = endP - .372; d.ek = 1;   // 接回換氣圓弧往下潛的那一段（那一刻剛好在 y＝-0.2、頭朝下 0.372）
      }
    }
    d.y = y; d.pitch = pitch;
    d.x += Math.sin(d.h) * sp * dt; d.z += Math.cos(d.h) * sp * dt;
    dolKeep(d);
    d.g.position.set(d.x, y, d.z);
    d.g.rotation.y = d.h;
    d.body.rotation.set(pitch, 0, roll);
    d.tail.rotation.x = flap;
  });
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {   // 彼此別疊在一起
    const A = dolphins[i], B = dolphins[j];
    if (A.tr || B.tr) continue;
    const dx = B.x - A.x, dz = B.z - A.z, q = Math.hypot(dx, dz);
    if (q < 1.5 && q > 1e-4) { const k = (1.5 - q) / 2 / q * Math.min(1, dt * 8); A.x -= dx * k; A.z -= dz * k; B.x += dx * k; B.z += dz * k; }
  }
}

/* ---------- 外海的機械巨獸（Q 版） ----------
   淺水區（離島中心 46～66，水到大腿）搖搖擺擺走來走去；要去深水區就在淺水區邊上蹲一下、跳起來、肚子先著水撲通落水，
   整隻潛在水下游過去，水面上只看到背上一排排鋸齒鰭劃過去；回到淺水區頭先冒出來、站起來，像阿滿一樣甩甩身體把水甩掉。
   點牠（或偶爾牠自己）會轉過來對著島吼、噴藍色火焰（電影版噴火時眼睛變藍），島升起半球形的防護罩擋下來；阿滿會對著牠叫。
   開飛船靠近時牠會轉頭盯著飛船。
   兩頭身半：大頭、圓肚子、短手短腳。頭頂（含冠）離水面最高約 19.7，要低於雲底 20.5；海底離島越遠越深，所以牠越往外走水淹得越高。
   造型致敬電影版：深灰色裝甲配紅色發光線條、紅眼睛、頭頂的冠、嘴尖的鼻孔、下巴兩根刺、四根槍管手指、脖子兩側各三條粗管、
   背上鋸齒狀的尖板、一節一節的尾巴、站著微微駝背。頭是積木疊出來的（一塊塊磚、頂上有凸點）。網站上不寫牠的名字。
   預設的鳥瞰鏡頭往下看，只拍得到牠在畫面上緣；鏡頭壓低或從清單點牠才看得到全身。
   身體是一節節的骨架（骨盆→身體→脖子→頭；兩腳、兩手、六節尾巴），每節用八角斷面接成管子，平面上色看起來像一片片裝甲 */
const KJ_MIN = 46, KJ_SHELF = 66, KJ_MAX = 94, KJ_S = 1.15, KJ_SWIM = -.35;   // KJ_S：模型放大倍數（下面的身體尺寸都是放大前的）；KJ_SWIM：游泳時背在水面下多深
const kjDepth = r => KJ_S * (r <= KJ_SHELF ? lerp(3.8, 4.8, smooth((r - KJ_MIN) / (KJ_SHELF - KJ_MIN))) : lerp(4.8, 12, smooth((r - KJ_SHELF) / 10)));   // 站著時腳底在水面下多深：水到大腿（水在膝蓋以下時，膝蓋露出水面看起來像站在水面上）
const KJC = { top: 0x8e98a3, side: 0x6d7782, under: 0x434a53, dark: 0x353b43, band: 0x7d8793, band2: 0xaab3bd, plate: 0xa3adb7, claw: 0x2b3036, mouth: 0x3c1517, tooth: 0xe4e0d4, hole: 0x14171b };
const KJ_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .5, metalness: .2 });   // 島上沒有環境貼圖，金屬度高只會整隻變暗
const KJ_RED = glowMat(0xe01a10), KJ_EYE = glowMat(0xe8160c), KJ_SHINE = glowMat(0xfff0dc);   // 身上的紅色發光線條、紅眼睛、眼睛裡的亮點（晚上都會變亮；底色太亮的話晚上乘上去會偏橘）
const KJ_HALO = new THREE.SpriteMaterial({ map: canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }), color: 0xff4630, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });   // 眼睛周圍的光暈（晚上、吼的時候）
const KJ_EYE_RED = new THREE.Color(0xe8160c), KJ_EYE_BLUE = new THREE.Color(0x2a8cff), KJ_HALO_RED = new THREE.Color(0xff4630), KJ_HALO_BLUE = new THREE.Color(0x4aa8ff);
const KJ_EYE_GOLD = new THREE.Color(0xffb412), KJ_HALO_GOLD = new THREE.Color(0xffc640), KJ_ACT = { stomp: 2.3, works: 20 };   // 合體大招時眼睛變金色；開著時的招式各幾秒（煙火秀放完會先結束）
function kjTube(rings, axis, paint = null, n = 8) {   // rings：[[中心], 寬方向半徑, 另一方向半徑]；axis 'y'＝直的（身體、腳、手），'z'＝橫的（頭、尾巴）
  const pos = [], col = [], c = new THREE.Color();
  const P = rings.map(([[x, y, z], ra, rb]) => ({ c: [x, y, z], p: [...Array(n)].map((_, k) => { const a = (k + .5) / n * TAU, u = Math.cos(a) * ra, v = Math.sin(a) * rb; return axis === 'y' ? [x + u, y, z + v] : [x + u, y + v, z]; }) }));
  const tri = (A, B, C, out, i) => {   // out：這一面該朝的方向（從軸心往外），反了就調換頂點順序；朝上亮、朝旁邊中間、朝下暗
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [B, C] = [C, B]; nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    c.setHex((paint && paint(nx, ny, nz, i)) || (ny > .55 ? KJC.top : ny < -.45 ? KJC.under : KJC.side));
    for (const v of [A, B, C]) { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b); }
  };
  const mid = (...q) => [0, 1, 2].map(j => q.reduce((s, v) => s + v[j], 0) / q.length);
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < n; k++) {
    const a = P[i].p[k], b = P[i].p[(k + 1) % n], d = P[i + 1].p[k], e = P[i + 1].p[(k + 1) % n], m = mid(a, b, d, e), o = mid(P[i].c, P[i + 1].c);
    const out = [m[0] - o[0], m[1] - o[1], m[2] - o[2]];
    tri(a, b, d, out, i); tri(b, e, d, out, i);
  }
  for (const [j, o] of [[0, 1], [P.length - 1, P.length - 2]]) {   // 兩頭封口
    const R = P[j], out = [R.c[0] - P[o].c[0], R.c[1] - P[o].c[1], R.c[2] - P[o].c[2]];
    for (let k = 0; k < n; k++) tri(R.c, R.p[k], R.p[(k + 1) % n], out, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
function kjPlate(L, [x, y, z], h, len, tilt = -1, w = .42, rz = 0) {   // 背上的尖板：壓扁的四角錐，尖端往後上方翹；[x,y,z]＝根部
  const ax = -Math.sin(rz), ay = Math.cos(rz) * Math.cos(tilt), az = Math.cos(rz) * Math.sin(tilt);
  part('pyr', [x + ax * h * .4, y + ay * h * .4, z + az * h * .4], [w, h, len], KJC.plate, { rx: tilt, rz, into: L });
}
BASE.wedge = (() => {   // 斜磚：底面、背面是滿的，斜面朝前上方
  const A = [-.5, -.5, -.5], B = [.5, -.5, -.5], C = [.5, -.5, .5], D = [-.5, -.5, .5], E = [-.5, .5, -.5], F = [.5, .5, -.5];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([[A, B, C], [A, C, D], [A, E, F], [A, F, B], [D, C, F], [D, F, E], [A, D, E], [B, F, C]].flat(2), 3));
  g.computeVertexNormals();
  return g;
})();
BASE.cyl10 = new THREE.CylinderGeometry(.5, .5, 1, 10).toNonIndexed();   // 積木頂上的凸點
BASE.cyl10.deleteAttribute('uv');
const KB = .84, KG = .07, KJ_CORE = 0x262a30;   // 積木：一格寬（凸點間距）、磚縫寬、磚縫後面看到的深色
function kjBlock(L, layers, cz, color, noStud = []) {   // 疊磚：layers＝[這層底的高度, 層高, 格子們]；外圈和露出頂面的格子鋪成一塊塊磚（上下層方向交錯、接縫錯開），裡面塞深色擋住縫，露出的頂面放凸點
  const key = (i, k) => i + ',' + k, ns = new Set(noStud.map(c => key(...c)));
  layers.forEach(([y0, h, cells], n) => {
    const S = new Set(cells.map(c => key(...c))), up = new Set(layers[n + 1] ? layers[n + 1][2].map(c => key(...c)) : []);
    const vis = cells.filter(([i, k]) => !up.has(key(i, k)) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !S.has(key(i + a, k + b))));
    const al = n % 2, rows = new Map();   // al：這層的磚往哪排（0＝左右、1＝前後）
    for (const c of vis) { const r = c[1 - al]; if (!rows.has(r)) rows.set(r, []); rows.get(r).push(c[al]); }
    for (const [r, list] of rows) {
      list.sort((a, b) => a - b);
      for (let j = 0; j < list.length;) {
        let e = j;
        while (e + 1 < list.length && list[e + 1] === list[e] + 1) e++;   // 連在一起的一段
        for (let c0 = list[j], first = (n + r) % 2 ? 2 : 3; c0 <= list[e];) {   // 切成 2～4 格一塊，每層起頭長度不同，接縫才會錯開
          const c1 = Math.min(list[e], c0 + (c0 === list[j] ? first : 4) - 1), m = c1 - c0 + 1, mid = (c0 + c1) / 2;
          if (al) part('box', [r * KB, y0 + h / 2, (cz(c0) + cz(c1)) / 2], [KB - KG, h - KG, m * KB - KG], color, { into: L });
          else part('box', [mid * KB, y0 + h / 2, cz(r)], [m * KB - KG, h - KG, KB - KG], color, { into: L });
          c0 = c1 + 1;
        }
        j = e + 1;
      }
    }
    const is = cells.map(c => c[0]), ks = cells.map(c => c[1]), i0 = Math.min(...is), i1 = Math.max(...is), k0 = Math.min(...ks), k1 = Math.max(...ks);
    const ya = n ? y0 - KG / 2 - .01 : y0 + .01, yb = y0 + h - KG / 2 - .015;
    part('box', [(i0 + i1) / 2 * KB, (ya + yb) / 2, (cz(k0) + cz(k1)) / 2], [(i1 - i0 + 1) * KB - .1, yb - ya, (k1 - k0 + 1) * KB - .1], KJ_CORE, { into: L });
    for (const [i, k] of cells) if (!up.has(key(i, k)) && !ns.has(key(i, k))) part('cyl10', [i * KB, y0 + h - KG / 2 + .1, cz(k)], [.5, .2, .5], color, { into: L });
  });
}
function kjFin(L, [x, y, z], h, len, tilt, w, rz, [ox, oy, oz]) {   // 鋸齒狀的尖板：旁邊再黏一個小尖（電影版背上的板子很參差）；[ox,oy,oz]＝小尖離大尖多遠
  kjPlate(L, [x, y, z], h, len, tilt, w, rz);
  kjPlate(L, [x + ox, y + oy, z + oz], h * .55, len * .6, tilt - .2, w * .9, rz);
}
const kj = (() => {
  const G = () => new THREE.Group(), mesh = (parent, list, mat = KJ_MAT) => parent.add(merged(list, mat, false));
  const finMesh = (parent, list) => { const m = merged(list, KJ_MAT, false); m.userData.fin = true; parent.add(m); return m; };
  const g = G(), hip = G(), waist = G(), neck = G(), head = G(), jaw = G(), tip = G();
  hip.rotation.order = 'YXZ';   // 游泳時身體往前斜趴，左右扭要繞著垂直軸
  g.add(hip); hip.position.y = 4.9;
  hip.add(waist); waist.position.set(0, .5, 0);
  waist.add(neck); neck.position.set(0, 6.0, .25);
  neck.add(head); head.position.set(0, .35, .15);
  head.add(jaw); jaw.position.set(0, 1.0, 2.04);
  head.add(tip); tip.position.set(0, 8.8, -2.1);   // 頭頂冠的最高點：量頭頂多高用
  mesh(hip, [kjTube([[[0, -1.2, -.1], 2.5, 2.2], [[0, -.3, 0], 3.25, 2.9], [[0, .8, 0], 3.45, 3.05]], 'y')]);
  // 身體：圓肚子一條條橫紋（中間夾紅色發光線）、胸口一顆紅色六角核心、背上三排鋸齒尖板（中間那排最大）、脖子兩側各三條粗管
  const TOR = [[-1.5, 3.0, 2.7, -.1], [-.5, 3.75, 3.3, .1], [.7, 4.1, 3.6, .25], [2.0, 4.05, 3.55, .3], [3.3, 3.75, 3.3, .2], [4.5, 3.3, 2.95, .05], [5.4, 2.75, 2.55, -.05], [6.1, 2.15, 2.05, 0]];   // [高度, 半寬, 半厚, 前後]
  const tAt = (y, j) => { let i = 0; while (i < TOR.length - 2 && TOR[i + 1][0] < y) i++; const A = TOR[i], B = TOR[i + 1]; return lerp(A[j], B[j], clamp((y - A[0]) / (B[0] - A[0]), 0, 1)); };
  const frontZ = y => tAt(y, 3) + tAt(y, 2) * .924, backZ = y => tAt(y, 3) - tAt(y, 2) * .924;   // 八角形正前方、正後方那一面
  const tor = [kjTube(TOR.map(([y, w, d, z]) => [[0, y, z], w, d]), 'y', (nx, ny, nz, i) => nz > .7 && i < 5 ? (i % 2 ? KJC.band : KJC.band2) : null)], torR = [], torF = [[], [], []];   // 背鰭照高度分三段：蓄力時從尾巴往頭一段段亮起來
  for (const y of [-.5, .7, 2.0]) part('box', [0, y, frontZ(y) + .03], [tAt(y, 1) * .74, .2, .12], 0, { into: torR });   // 橫紋之間的紅線（只在正前方那一面）
  part('rbox', [0, 4.1, frontZ(4.1) - .1], [3.0, 2.0, .5], KJC.top, { rx: -.2, into: tor });   // 胸甲
  part('cyl6', [0, 4.1, frontZ(4.1) + .12], [1.5, .3, 1.5], KJC.dark, { rx: Math.PI / 2 - .2, into: tor });
  part('cyl6', [0, 4.1, frontZ(4.1) + .2], [1.05, .3, 1.05], 0, { rx: Math.PI / 2 - .2, into: torR });   // 胸口的紅色核心
  for (const [y, h] of [[.4, 1.7], [1.7, 2.3], [3.0, 2.8], [4.2, 3.0], [5.3, 2.4]]) kjFin(torF[y < 2 ? 0 : y < 3.8 ? 1 : 2], [0, y, backZ(y) + .3], h, h * .8, -1, 1.0, 0, [0, -h * .45, -.1]);
  for (const s of [-1, 1]) for (const [y, h] of [[1.0, 1.3], [2.3, 1.8], [3.6, 2.1], [4.8, 1.8]]) kjFin(torF[y < 2 ? 0 : y < 3.8 ? 1 : 2], [s * 1.6, y, backZ(y) * .9 + .3], h, h * .75, -.95, .7, -s * .5, [0, -h * .4, -.05]);   // 兩側往外張：從正面看肩膀後面冒出一圈尖板
  mesh(waist, tor); mesh(waist, torR, KJ_RED);
  const finsW = torF.map(L => finMesh(waist, L));
  const nk = [kjTube([[[0, -.9, -.1], 2.5, 2.3], [[0, .2, 0], 2.3, 2.15], [[0, .9, .1], 2.0, 1.9]], 'y')];
  for (const s of [-1, 1]) for (let j = 0; j < 3; j++) {   // 脖子後面兩側各三條粗管：從頭的後下方接到肩膀後面
    const p0 = [s * (1.2 + j * .5), -1.4, -1.55 - j * .45], p1 = [s * (1.15 + j * .45), 1.1, -1.05 - j * .5];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz);
    part('cyl6', [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [.55, L + .4, .55], KJC.top, { rx: Math.acos(dy / L), ry: Math.atan2(dx, dz), into: nk });
  }
  mesh(neck, nk);
  // 頭：積木疊出來的。腦袋六層磚（最下和最上一層內縮一圈，輪廓才不會是方盒子）、頂上一顆顆凸點；嘴是窄一點的兩層磚、最前面一塊斜磚；
  // 眼睛＝橫的黑色 1×2 片上一條橫的紅色發光片（噴火時內側往下斜、瞇起來）；斜磚當眉毛（內側壓低，噴火時壓得更低更斜）；頭頂一階一階疊高的冠；嘴尖兩片黑色鼻孔；嘴邊露出小尖牙；兩側一條紅色發光片
  const hd = [], hdR = [], cz = k => -3 + (k + .5) * KB;   // cz：第 k 排格子中心的前後位置（0～5 排是腦袋，6～9 排是嘴）
  const rect = (i0, i1, k0, k1) => { const c = []; for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) c.push([i, k]); return c; };
  kjBlock(hd, [[0, 1, rect(-3, 3, 1, 5)], ...[1, 2, 3, 4].map(y => [y, 1, rect(-4, 4, 0, 5)]), [5, 1, rect(-3, 3, 1, 5)]], cz, 0x7f8994, [[0, 1], [0, 2], [0, 3]]);   // 腦袋（冠蓋住的格子不放凸點）
  kjBlock(hd, [[1.33, 1, rect(-2, 2, 6, 9)], [2.33, 1, rect(-2, 2, 6, 8)]], cz, 0x98a2ad, [[-1, 8], [1, 8], ...rect(-2, 2, 9, 9)]);   // 嘴（上顎）
  part('wedge', [0, 2.83, cz(9)], [5 * KB - KG, 1 - KG, KB - KG], 0x98a2ad, { into: hd });   // 嘴尖的斜磚
  part('box', [0, 1.165, cz(7.5) - .1], [5 * KB - .3, .31, 4 * KB - .3], KJC.mouth, { into: hd });   // 嘴縫
  for (const [y, h, k0, k1] of [[6, 1, 1, 3], [7, 1, 1, 2]]) part('box', [0, y + h / 2, (cz(k0) + cz(k1)) / 2], [KB - KG, h - KG, (k1 - k0 + 1) * KB - KG], 0xaab3bd, { into: hd });   // 頭頂的冠：一階一階疊高
  part('wedge', [0, 7.5, cz(3)], [KB - KG, 1 - KG, KB - KG], 0xaab3bd, { into: hd });
  part('wedge', [0, 8.4, cz(1)], [KB - KG, .8 - KG, KB - KG], 0xaab3bd, { into: hd });
  const eyes = [], brows = [];
  for (const s of [-1, 1]) {
    part('box', [s * KB, 3.33 - KG / 2 + .06, cz(8)], [KB - KG, .12, KB - KG], KJC.hole, { into: hd });   // 鼻孔
    const BL = [], EL = [], eg = new THREE.Group();
    part('wedge', [0, 0, 0], [2 * KB, .55, .6], 0x4a525c, { into: BL });   // 眉毛：倒過來的斜磚，內側壓低（另外一塊，噴火時會動）
    const bw = merged(BL, KJ_MAT, false);
    bw.position.set(s * 1.85, 5.62, 2.34); bw.rotation.z = Math.PI + s * .2; bw.userData.s = s;
    head.add(bw); brows.push(bw);
    eg.position.set(s * 1.85, 4.6, 2.1); eg.userData.s = s;   // 一隻眼睛：黑色片＋發光片＋亮點一起斜
    part('box', [0, 0, 0], [2 * KB - .08, KB - .02, .12], KJC.hole, { into: EL });
    eg.add(merged(EL, KJ_MAT, false));
    head.add(eg); eyes.push(eg);
    part('cone6', [s * 1.35, 1.1, cz(9) + .2], [.34, .55, .34], KJC.tooth, { rx: Math.PI, into: hd });   // 兩顆小尖牙
    part('cone6', [s * .45, 1.18, cz(9) + .25], [.22, .35, .22], KJC.tooth, { rx: Math.PI, into: hd });
    part('cone6', [s * 1.95, 1.15, cz(7)], [.26, .4, .26], KJC.tooth, { rx: Math.PI, into: hd });
    kjPlate(hd, [s * 3.6, 4.6, -1.8], 1.4, 1.6, -.8, .33, -s * 1.2);   // 兩側的小角
    part('box', [s * (4.5 * KB + .03), 2.5, cz(2)], [.1, .33, 3 * KB], 0, { into: hdR });   // 兩側的紅色發光片
    const eye = vox(eg, BASE.box, KJ_EYE, [0, 0, .1], [1.42, .56, .08]);   // 橫的紅色發光片
    eye.castShadow = false; eg.userData.glow = eye;
    vox(eye, BASE.box, KJ_SHINE, [.3, .2, .6], [.18, .3, .5]).castShadow = false;   // 亮點（兩眼同一側）
    const halo = new THREE.Sprite(KJ_HALO);
    halo.position.set(s * 1.85, 4.6, 2.6); halo.scale.setScalar(3);
    head.add(halo);
  }
  mesh(head, hd); mesh(head, hdR, KJ_RED);
  const jw = [];   // 下巴：兩塊 2×4 的磚
  for (const s of [-1, 1]) part('box', [s * KB, -.5, 2 * KB], [2 * KB - KG, 1 - KG, 4 * KB - KG], 0x5d656f, { into: jw });
  part('box', [0, -.5, 2 * KB], [4 * KB - .1, 1 - KG - .03, 4 * KB - .1], KJ_CORE, { into: jw });
  for (const s of [-1, 1]) {
    part('cone6', [s * 1.2, .15, 3.25], [.28, .45, .28], KJC.tooth, { into: jw });
    part('cone6', [s * .6, -1.35, 2.7], [.42, .9, .42], KJC.side, { rx: Math.PI - .45, into: jw });   // 下巴兩根刺
  }
  mesh(jaw, jw);
  // 手：短短的；圓圓的肩甲外側一條紅線，四根槍管手指（指尖是空的）
  const arms = [-1, 1].map(s => {
    const sh = G(), el = G();
    waist.add(sh); sh.position.set(s * 3.5, 4.5, .45);
    sh.add(el); el.position.set(0, -1.9, .1);
    const ua = [kjTube([[[0, .4, 0], 1.2, 1.2], [[0, -.9, .05], 1.12, 1.18], [[0, -1.9, .1], 1.0, 1.05]], 'y')], uaR = [];
    part('ico1', [s * .3, .45, -.05], [2.75, 2.45, 2.7], KJC.top, { into: ua });
    part('box', [s * 1.6, .55, -.05], [.18, .38, 1.5], 0, { rz: s * .25, into: uaR });
    mesh(sh, ua); mesh(sh, uaR, KJ_RED);
    const fa = [kjTube([[[0, .25, 0], 1.02, 1.08], [[0, -.9, .05], 1.12, 1.18], [[0, -1.75, .1], .98, 1.04]], 'y')];
    part('rbox', [0, -2.15, .12], [2.0, 1.05, 1.7], KJC.side, { into: fa });
    for (const fx of [-.66, -.22, .22, .66]) {
      part('cyl6', [fx, -2.95, .2], [.5, 1.0, .5], KJC.side, { into: fa });
      part('cyl6', [fx, -3.46, .2], [.28, .04, .28], KJC.hole, { into: fa });
    }
    mesh(el, fa);
    return { sh, el };
  });
  // 腳：粗粗短短；護膝上一顆紅燈，腳掌四根腳趾
  const legs = [1, -1].map(s => {
    const th = G(), kn = G(), an = G();
    hip.add(th); th.position.set(s * 2.35, -.2, .15);
    th.add(kn); kn.position.set(0, -2.0, .1);
    kn.add(an); an.position.set(0, -1.9, 0);
    mesh(th, [kjTube([[[0, .9, -.1], 1.8, 1.9], [[0, -.3, 0], 2.05, 2.15], [[0, -1.3, .05], 1.85, 1.95], [[0, -2.1, .1], 1.55, 1.65]], 'y')]);
    const sl = [kjTube([[[0, .3, 0], 1.5, 1.6], [[0, -1.0, .05], 1.45, 1.55], [[0, -1.95, .05], 1.35, 1.45]], 'y')], slR = [];
    part('ico1', [0, .05, .95], [2.0, 1.8, 1.5], KJC.top, { into: sl });
    part('cyl', [0, .05, 1.68], [.62, .12, .62], 0, { rx: Math.PI / 2, into: slR });
    mesh(kn, sl); mesh(kn, slR, KJ_RED);
    const ft = [];
    part('rbox', [0, -.4, .55], [2.7, 1.1, 3.6], KJC.side, { into: ft });
    for (const tx of [-.95, -.32, .32, .95]) part('cone6', [tx, -.5, 2.45], [.55, .9, .55], KJC.claw, { rx: Math.PI / 2, into: ft });
    part('cone6', [0, -.55, -1.3], [.55, .8, .55], KJC.claw, { rx: -Math.PI / 2, into: ft });
    mesh(an, ft);
    return { th, kn, an };
  });
  // 尾巴：六節，一節一節像裝甲，每節背上一片鋸齒尖板，前兩節兩側還有小的；尾巴尖微微翹起來
  const TL = [2.3, 2.2, 2.1, 2.0, 1.9, 1.8], TR = [2.2, 1.95, 1.7, 1.45, 1.2, .95, .7];
  let parent = hip, at = [0, .1, -2.3];
  const tail = TL.map((L, i) => {
    const T = G();
    parent.add(T); T.position.set(...at);
    const r0 = TR[i], r1 = TR[i + 1], rm = (r0 + r1) / 2, rings = [[[0, 0, .3], r0 * .9, r0 * .84], [[0, .04, -L * .45], rm * 1.06, rm * .98], [[0, 0, -L], r1 * .98, r1 * .9]];
    if (i === TL.length - 1) rings.push([[0, 0, -L - .7], .1, .1]);
    const list = [kjTube(rings, 'z')], fin = [];
    kjFin(fin, [0, rm * .85, -L * .45], 1.7 - i * .18, L * .7, -1.15, .75 - i * .06, 0, [0, -.05, -L * .4]);
    if (i < 2) for (const s of [-1, 1]) kjPlate(fin, [s * rm * .5, rm * .7, -L * .45], 1.0 - i * .15, L * .5, -1.15, .45, -s * .45);
    mesh(T, list); T.userData.fin = finMesh(T, fin);
    parent = T; at = [0, 0, -L];
    return T;
  });
  petHit(waist, 'kaiju', [0, 2.3, .2], [8.6, 8.4, 7.6]);
  petHit(head, 'kaiju', [0, 3.4, 1.2], [7.8, 7.2, 8.8]);
  g.scale.setScalar(KJ_S);
  scene.add(g);
  const fins = [...tail.map(T => T.userData.fin).reverse(), ...finsW];   // 從尾巴尖到肩膀後面：合體大招蓄力時照這個順序亮金色
  for (const m of fins) { m.material = KJ_MAT.clone(); m.material.emissive.setHex(0xffa412); m.material.emissiveIntensity = 0; }
  return { g, hip, waist, neck, head, jaw, tip, eyes, brows, arms, legs, tail, fins, TR, TL, back: new THREE.Vector3(0, 2.6, backZ(2.6)), bow: new THREE.Vector3(0, 5.4, backZ(5.4)) };   // back：背中間那一點（游泳時放在水面下）；bow：背的最前面（游泳時從這裡推出浪）
})();
/* 駕駛艙：頭頂前面一個玻璃泡泡。平常收在頭裡面（看不到），你飛過來才升上來、兩片艙蓋往兩邊打開；
   裡面一張紅色座椅、前面一排會亮的按鈕和兩根操縱桿（座標＝頭的局部座標，跟著頭一起放大） */
const PIT = { up: 0, open: 0, upT: 0, openT: 0, lit: 0, litT: 0, fast: false };   // up：升起來的程度；open：艙蓋打開的程度；lit：按鈕亮的程度（開機時亮起來）
const SEAT = new THREE.Vector3(0, 6.57, 1.0), PIT_DOWN = -1.75;   // 坐墊上面；收起來時往下沉多少
const pit = (() => {
  const g = new THREE.Group(), L = [], LT = [];
  g.position.y = PIT_DOWN; g.visible = false;
  kj.head.add(g);
  part('rbox', [0, 6.05, 1.3], [2.5, .5, 2.1], 0x4a525c, { into: L });   // 底座（蓋住頭頂的凸點）
  part('box', [0, 6.48, 1.0], [.62, .18, .52], 0xb3322a, { into: L });   // 座椅
  part('box', [0, 6.88, .74], [.62, .7, .14], 0xb3322a, { rx: -.18, into: L });   // 椅背
  part('wedge', [0, 6.72, 1.98], [1.5, .62, .5], 0x353b43, { ry: Math.PI, into: L });   // 儀表板：斜面朝座椅
  for (const s of [-1, 1]) {
    part('cyl6', [s * .3, 6.48, 1.42], [.07, .34, .07], 0x2b3036, { into: L });   // 兩根操縱桿
    part('sphere', [s * .3, 6.66, 1.42], [.13, .13, .13], 0xc8302a, { into: L });
  }
  [0xff4a3a, 0x4ad8ff, 0xffc53a, 0x7dff6a, 0xff6fb0, 0x4ad8ff].forEach((c, i) => part('box', [(i - 2.5) * .19, 6.93, 2.15], [.11, .04, .08], c, { rx: -.89, into: LT }));   // 儀表板上緣一排按鈕（坐在駕駛艙往前看，畫面下緣就是這排燈）
  part('box', [0, 6.7, 1.96], [.5, .025, .08], 0x47c95a, { rx: -.89, into: LT });   // 一條綠色螢幕
  g.add(merged(L, KJ_MAT, false));
  const litMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  litMat.color.setScalar(.12);
  g.add(merged(LT, litMat, false));
  const metal = new THREE.MeshStandardMaterial({ color: 0x5d656f, roughness: .45, metalness: .3, flatShading: true });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, .07, 6, 36).rotateX(Math.PI / 2), metal);
  rim.position.set(0, 6.3, 1.3); rim.scale.set(1.15, 1, 1.0);
  g.add(rim);
  const glass = new THREE.ShaderMaterial({   // 玻璃：正面幾乎透明、邊緣反白，一道斜斜的反光；裡面的金色火焰會把玻璃照成淡金色
    uniforms: { uDim: { value: 0 }, uGold: { value: 0 } },
    vertexShader: `varying vec3 vN, vV, vL;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; vL = position; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uDim, uGold; varying vec3 vN, vV, vL;
      void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float st = smoothstep(.09, .0, abs(vL.z * .8 + vL.y * .6 - .45)) * .55;
        float a = .08 + .5 * f * f * f + st * .5;
        vec3 c = mix(vec3(.62, .88, 1.0), vec3(1.0), clamp(f * f + st, 0.0, 1.0)) * (1.0 - uDim * .55);
        c = mix(c, vec3(1.0, .8, .38), uGold * .45);
        gl_FragColor = vec4(c, a * (1.0 - uDim * .35) + uGold * .06); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const halves = [-1, 1].map(s => {   // 兩片艙蓋：鉸鍊在外側下緣，打開時往兩邊翻下去
    const h = new THREE.Group(), m = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 10, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI, 0, Math.PI / 2), glass);
    h.position.set(s * 1.15, 6.3, 1.3);
    m.position.x = -s * 1.15; m.scale.set(1.15, 1.65, 1.0); m.renderOrder = 4;
    h.add(m);
    g.add(h);
    return h;
  });
  return { g, halves, glass, litMat };
})();
/* 水面效果：身體（站著）、頭（撲水和站起來的時候）、尾巴穿過水面的地方一圈白浪；踩下去擴散的水圈；游泳時背鰭前面推出的浪和水花；撲進水裡、頭冒出水面、站起來、甩水的水花 */
const KJ_FOAM_GEO = new THREE.RingGeometry(.62, 1, 28).rotateX(-Math.PI / 2), KJ_RIPPLE_GEO = new THREE.RingGeometry(.86, 1, 48).rotateX(-Math.PI / 2);
const KJ_FOAM_THIN = new THREE.RingGeometry(.8, 1, 40).rotateX(-Math.PI / 2);   // 身體、頭比較粗，白浪圈要細
const kjFoam = [0, 1, 2].map(i => { const m = new THREE.Mesh(i < 2 ? KJ_FOAM_THIN : KJ_FOAM_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; scene.add(m); return m; });
const kjRipples = [];
function kjRipple(x, z, r0, r1, life, op) {
  let q = kjRipples.find(o => o.t <= 0);
  if (!q) {
    if (kjRipples.length >= 30) return;
    q = { m: new THREE.Mesh(KJ_RIPPLE_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })), t: 0 };
    scene.add(q.m); kjRipples.push(q);
  }
  Object.assign(q, { r0, r1, life, op, t: life });
  q.m.position.set(x, .14, z); q.m.visible = true;
}
const kjSpray = (() => {
  const N = 400, pos = new Float32Array(N * 3).fill(-999), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const map = canvasTex(32, 32, (x, w, h) => { const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, w, h); });
  const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, map, transparent: true, depthWrite: false }));
  m.frustumCulled = false;
  scene.add(m);
  return { m, pos, vel: new Float32Array(N * 3), life: new Float32Array(N), i: 0, N };
})();
function kjBurst(x, y, z, n, spread, up) {   // 一顆顆白色水滴往上往外噴，再掉回水裡
  const S = kjSpray;
  for (let k = 0; k < n; k++) {
    const i = S.i = (S.i + 1) % S.N, a = Math.random() * TAU, sp = spread * Math.sqrt(Math.random());
    S.pos.set([x, y, z], i * 3);
    S.vel.set([Math.cos(a) * sp, up * (.55 + Math.random() * .6), Math.sin(a) * sp], i * 3);
    S.life[i] = 4;
  }
}
function updateKjFx(dt) {
  const S = kjSpray, P = S.pos;
  let any = false;
  for (let i = 0; i < S.N; i++) {
    if (S.life[i] <= 0) continue;
    any = true;
    S.vel[i * 3 + 1] -= 6 * dt;   // 掉得比真的慢一點：東西大，水花看起來才夠大
    P[i * 3] += S.vel[i * 3] * dt; P[i * 3 + 1] += S.vel[i * 3 + 1] * dt; P[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
    if (P[i * 3 + 1] < 0 || (S.life[i] -= dt) <= 0) { S.life[i] = 0; P[i * 3 + 1] = -999; }
  }
  if (any) S.m.geometry.attributes.position.needsUpdate = true;
  for (const q of kjRipples) {
    if (q.t <= 0) continue;
    q.t -= dt;
    const k = 1 - Math.max(0, q.t) / q.life;
    q.m.scale.setScalar(lerp(q.r0, q.r1, 1 - (1 - k) * (1 - k)));
    q.m.material.opacity = q.op * (1 - k);
    if (q.t <= 0) q.m.visible = false;
  }
}
/* 吼叫噴火：轉過來對著島，往後一仰、張嘴、眼睛變藍，往前一探噴出藍色火焰；島升起半球形的防護罩，火打在罩子上沿著罩面濺開 */
const SHIELD_R = 29, SHIELD_H = 25, KJF_N = 1800, KJ_ROAR = 6.2;   // 罩子的半徑、高度（蓋住整座島、碼頭和停著的飛船）；火焰顆粒數；吼一次幾秒
const kjFlame = (() => {   // 一顆顆火：剛噴出來白藍色、小顆，越飛越大、轉成深藍再帶點紫，打到罩子變成沿著罩面濺開的火花
  const g = new THREE.BufferGeometry(), pos = new Float32Array(KJF_N * 3).fill(-999), dat = new Float32Array(KJF_N * 2).fill(1);   // dat：[飛了多久（0～1）, 0＝火、1＝火花]
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDat', new THREE.BufferAttribute(dat, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uGold: { value: 0 } },   // uGold：合體大招時火變成金色
    vertexShader: `attribute vec2 aDat; uniform float uScale; varying vec2 vDat;
      void main() { vDat = aDat; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float s = aDat.y > .5 ? mix(1.4, .3, aDat.x) : mix(1.5, 8.5, sqrt(aDat.x));
        gl_PointSize = aDat.x >= 1.0 ? 0.0 : min(240.0, s * uScale / -mv.z); }`,
    fragmentShader: `uniform float uGold; varying vec2 vDat;
      void main() { float r = length(gl_PointCoord - .5) * 2.0; if (r > 1.0) discard;
        float a = (1.0 - r) * (1.0 - r), k = vDat.x; vec3 col, gc;
        if (vDat.y > .5) { col = vec3(.8, .97, 1.0); gc = vec3(1.0, .93, .62); a *= 1.0 - k; }
        else {
          col = k < .25 ? mix(vec3(.85, .95, 1.0), vec3(.25, .5, 1.0), k / .25) : mix(vec3(.25, .5, 1.0), vec3(.4, .2, .9), (k - .25) / .75);
          gc = k < .25 ? mix(vec3(1.0, .98, .82), vec3(1.0, .76, .2), k / .25) : mix(vec3(1.0, .76, .2), vec3(1.0, .42, .08), (k - .25) / .75);
          a *= (1.0 - k) * min(1.0, k / .05) * .42;
        }
        gl_FragColor = vec4(mix(col, gc, uGold), a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false; m.visible = false;
  scene.add(m);
  return { m, mat, pos, dat, vel: new Float32Array(KJF_N * 3), age: new Float32Array(KJF_N), life: new Float32Array(KJF_N), i: 0 };
})();
const SH = { on: 0, rise: 1.1, hit: 0, up: false }, _shD = new THREE.Vector3(), SH_AT = new THREE.Vector3(0, 8, 0);
const shield = (() => {   // 防護罩：半透明的六角格子，邊緣比較亮；從海面往上長出來，被打到的地方發白、一圈圈漣漪擴散出去，收掉時一格一格消失
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uOn: { value: 0 }, uRise: { value: 1.1 }, uHit: { value: 0 }, uDir: { value: new THREE.Vector3(0, .3, 1).normalize() }, uCol: { value: new THREE.Color(0x6fdcff) } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(vec3(position.x / ${SHIELD_R}.0, position.y / ${SHIELD_H}.0, position.z / ${SHIELD_R}.0)); vV = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT, uOn, uRise, uHit; uniform vec3 uDir, uCol; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      float hexd(vec2 p) { p = abs(p); return max(dot(p, vec2(.5, .8660254)), p.x); }
      vec3 hex(vec2 uv) { vec2 r = vec2(1.0, 1.7320508), h = r * .5, a = mod(uv, r) - h, b = mod(uv - h, r) - h, gv = dot(a, a) < dot(b, b) ? a : b; return vec3(uv - gv, .5 - hexd(gv)); }
      void main() {
        vec3 p = normalize(vP);
        vec3 hs = hex(vec2(atan(p.z, p.x) * 7.0028, asin(clamp(p.y, 0.0, 1.0)) * 12.0)), ht = hex(p.xz * 13.0);   // 側面用經緯度展開、頂上用俯視，中間交接
        float wt = smoothstep(.55, .8, p.y), edge = mix(hs.z, ht.z, wt);
        vec2 id = mix(hs.xy, ht.xy + 50.0, step(.5, wt));
        float cell = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
        float line = smoothstep(.07, .0, edge), fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float d = acos(clamp(dot(p, normalize(uDir)), -1.0, 1.0));
        float ring = max(0.0, sin(d * 22.0 - uT * 9.0)) * exp(-d * 1.8) * uHit, spot = exp(-d * d * 22.0) * uHit;
        float rise = smoothstep(uRise, uRise - .12, p.y), lead = exp(-pow((p.y - uRise) * 16.0, 2.0)) * (1.0 - step(1.05, uRise));
        float flick = .85 + .15 * sin(uT * 37.0 + cell * 20.0);
        float a = ((.08 + fres * .55 + line * (.26 + .6 * uHit * exp(-d * 1.5))) * flick * rise * step(cell, uOn * 1.02) + lead * .9) * uOn + (ring * .45 + spot * 1.1) * rise * uOn;
        gl_FragColor = vec4(mix(uCol, vec3(1.0), clamp(spot * .8 + line * .15, 0.0, 1.0)), a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 24, 0, TAU, 0, Math.PI / 2), mat);
  m.scale.set(SHIELD_R, SHIELD_H, SHIELD_R); m.visible = false; m.renderOrder = 2;
  scene.add(m);
  const foot = new THREE.Mesh(new THREE.RingGeometry(SHIELD_R - .7, SHIELD_R + .5, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8fe6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  foot.position.y = .2; foot.visible = false;   // 罩子碰到海面的地方一圈光
  scene.add(foot);
  return { m, mat, foot };
})();
const KJ_MOUTH = new THREE.Sprite(new THREE.SpriteMaterial({ map: KJ_HALO.map, color: 0x7cc4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));   // 嘴裡蓄力的藍光
KJ_MOUTH.position.set(0, 1.2, 5.6); KJ_MOUTH.visible = false;
kj.head.add(KJ_MOUTH);
function kjEmit(n, P, D, v = 30, j = .42) {   // 從嘴巴 P 往 D 的方向噴出 n 顆火（散開一點）；v＝速度、j＝散開多少
  const F = kjFlame;
  for (let k = 0; k < n; k++) {
    const i = F.i = (F.i + 1) % KJF_N, sp = v + Math.random() * 14;
    F.pos.set([P.x + (Math.random() - .5) * .6, P.y + (Math.random() - .5) * .6, P.z + (Math.random() - .5) * .6], i * 3);
    F.vel.set([(D.x + (Math.random() - .5) * j) * sp, (D.y + (Math.random() - .5) * j) * sp, (D.z + (Math.random() - .5) * j) * sp], i * 3);
    F.age[i] = 0; F.life[i] = .8 + Math.random() * .25; F.dat[i * 2] = 0; F.dat[i * 2 + 1] = 0;
  }
}
function updateFlame(dt) {
  const F = kjFlame, R2 = SHIELD_R * SHIELD_R, H2 = SHIELD_H * SHIELD_H;
  let any = false, hx = 0, hy = 0, hz = 0, hn = 0, sn = 0, sx = 0, sz = 0;   // sn：這一幀打到海面的火（變成蒸氣）
  for (let i = 0; i < KJF_N; i++) {
    if (F.dat[i * 2] >= 1) continue;
    any = true;
    const o = i * 3, spark = F.dat[i * 2 + 1] > .5;
    let x = F.pos[o] + F.vel[o] * dt, y = F.pos[o + 1] + F.vel[o + 1] * dt, z = F.pos[o + 2] + F.vel[o + 2] * dt;
    F.age[i] += dt;
    if (!spark) {
      F.vel[o] += (Math.random() - .5) * 40 * dt; F.vel[o + 1] += (2.5 + (Math.random() - .5) * 40) * dt; F.vel[o + 2] += (Math.random() - .5) * 40 * dt;   // 火是熱的，微微往上飄，一路亂竄
      const q = (x * x + z * z) / R2 + y * y / H2;
      if (SH.on > .3 && q < 1 && y > 0) {   // 打到防護罩：貼著罩面往四周濺開
        const k = 1 / Math.sqrt(q);
        x *= k; y *= k; z *= k;
        let nx = x / R2, ny = y / H2, nz = z / R2;
        const nl = Math.hypot(nx, ny, nz), vn = (F.vel[o] * nx + F.vel[o + 1] * ny + F.vel[o + 2] * nz) / nl;
        nx /= nl; ny /= nl; nz /= nl;
        F.vel[o] = (F.vel[o] - vn * nx) * .45 + nx * 3; F.vel[o + 1] = (F.vel[o + 1] - vn * ny) * .45 + ny * 3; F.vel[o + 2] = (F.vel[o + 2] - vn * nz) * .45 + nz * 3;
        F.dat[i * 2 + 1] = 1; F.age[i] = 0; F.life[i] = .3 + Math.random() * .35;
        hx += x; hy += y; hz += z; hn++;
      } else if (kjReady && y < .25 && F.vel[o + 1] < 0) {   // 打到海面：嘶一聲變成一團蒸氣
        if (Math.random() < .2) steamPuff(x, .5, z, 2.4 + Math.random() * 1.8, 1.5 + Math.random() * .9, .55, (Math.random() - .5) * 1.6, 1.6 + Math.random() * 1.6, (Math.random() - .5) * 1.6);
        sn++; sx += x; sz += z;
        F.dat[i * 2] = 1; F.pos[o + 1] = -999;
        continue;
      } else if (kjReady && y > 17 && cloudHit(x, y, z)) { F.dat[i * 2] = 1; F.pos[o + 1] = -999; continue; }   // 鑽進雲裡：把雲燒熱
    } else { const k = 1 - Math.min(1, dt * 2.5); F.vel[o] *= k; F.vel[o + 1] *= k; F.vel[o + 2] *= k; }
    F.pos[o] = x; F.pos[o + 1] = y; F.pos[o + 2] = z;
    F.dat[i * 2] = Math.min(1, F.age[i] / F.life[i]);
  }
  if (sn) seaHit(sx / sn, sz / sn, sn, dt);
  if (hn) { SH.hit = Math.min(1, SH.hit + hn * .03); _shD.set(hx / hn / SHIELD_R, hy / hn / SHIELD_H, hz / hn / SHIELD_R).normalize(); shield.mat.uniforms.uDir.value.lerp(_shD, .2).normalize(); }
  if (any) { F.m.geometry.attributes.position.needsUpdate = true; F.m.geometry.attributes.aDat.needsUpdate = true; F.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); }
  F.m.visible = any;
}
function updateShield(dt, t) {
  if (SH.up) { SH.on = Math.min(1, SH.on + dt * 3); SH.rise = Math.min(1.1, SH.rise + dt / .45); }
  else SH.on = Math.max(0, SH.on - dt / 1.2);
  SH.hit = Math.max(0, SH.hit - dt * 1.6);
  const U = shield.mat.uniforms, vis = SH.on > .002;
  U.uT.value = t; U.uOn.value = SH.on; U.uRise.value = SH.rise; U.uHit.value = SH.hit;
  shield.m.visible = shield.foot.visible = vis;
  shield.foot.material.opacity = SH.on * (.35 + SH.hit * .4);
}
function kjRoar(byTap = false, rider = false, gold = false) {   // 吼叫噴火；byTap＝點牠觸發（鏡頭會調到看得到整段的角度）。先轉身對著島（rt 是負的），轉正了才開始吼
  const K = KJ;   // rider＝你騎著叫牠吼：不轉身，往牠面對的方向噴（你可以慢慢轉著瞄準）；gold＝蓄滿力的合體大招，噴金色光束
  if ((K.mode !== 'walk' && K.mode !== 'stand') || (K.rcd > 0 && !rider)) return false;
  Object.assign(K, { mode: 'roar', rt: -1, rt0: -1, rtw: 0, hv: 0, rcam: byTap, rsp: 100 + rnd() * 80, rsw: (rnd() < .5 ? -1 : 1) * (8 + rnd() * 4), rFree: rider, rGold: gold, rIsle: false });   // rsw：火往哪邊掃、掃多寬
  if (rider) { K.rt = 0; K.rt0 = -.001; }   // 騎著不用轉身（從頭開始往後仰：從中間開始的話頭會一下子往後彈）
  return true;
}
function shieldHitT(P, D) {   // 從 P 往 D 會在多遠打到罩子（半徑 SHIELD_R、高 SHIELD_H 的半球）；打不到回傳 -1
  const px = P.x / SHIELD_R, py = P.y / SHIELD_H, pz = P.z / SHIELD_R, dx = D.x / SHIELD_R, dy = D.y / SHIELD_H, dz = D.z / SHIELD_R;
  const a = dx * dx + dy * dy + dz * dz, b = 2 * (px * dx + py * dy + pz * dz), c = px * px + py * py + pz * pz - 1, q = b * b - 4 * a * c;
  if (q < 0) return -1;
  const t = (-b - Math.sqrt(q)) / (2 * a);
  return t > 0 && P.y + D.y * t > 0 ? t : -1;
}
const _rcA = new THREE.Vector3(), _rcH = new THREE.Vector3(), _rcM = new THREE.Vector3();
function kjRoarCam() {   // 鏡頭：原本就看得到牠和火會打到的地方就不動；不然照你原本看的那一側，轉到最近的、看得到「牠＋火＋罩子」的角度（每次畫面才會跟著你和牠的位置不同）
  const K = KJ, r = Math.hypot(K.x, K.z) || 1, ux = K.x / r, uz = K.z / r, C = camera.position, m = isMobile();
  const H = _rcH.set(ux * SHIELD_R * .95, 8, uz * SHIELD_R * .95), M = _rcM.set(lerp(K.x, H.x, .65), 7, lerp(K.z, H.z, .65));   // 看的點偏向火打到罩子的地方：罩子和島才拍得進來
  const sb = !m && ui.side ? $('#sidebar').getBoundingClientRect() : null, cov = sb && sb.width > 0 ? clamp((innerWidth - sb.left) / innerWidth, 0, .5) : 0;   // 電腦右邊的清單開著時蓋住畫面的比例
  const seen = P => { _rcA.copy(P).project(camera); return _rcA.x > -.8 && _rcA.x < .8 - 2 * cov && Math.abs(_rcA.y) < .8 && _rcA.z < 1; };
  if (seen(_rcA.set(K.x, 10, K.z)) && seen(H) && C.distanceTo(M) < 130) return;
  const vx = C.x - M.x, vz = C.z - M.z, vl = Math.hypot(vx, vz) || 1, side = Math.sign(ux * vz - uz * vx) || 1;
  const th = clamp(Math.acos(clamp((vx * ux + vz * uz) / vl, -1, 1)), m ? .26 : .55, m ? .87 : 1.9);   // 鏡頭偏離「島→牠」這條線幾度：0＝在牠背後、π＝在島這側（看不到罩子）；手機是直的畫面，偏後面一點
  const a = Math.atan2(uz, ux) + side * th, d = 70, el = clamp(Math.atan2(C.y - M.y, vl), .25, .6);
  const pos = new THREE.Vector3(M.x + Math.cos(a) * d * Math.cos(el), M.y + d * Math.sin(el), M.z + Math.sin(a) * d * Math.cos(el)), tgt = M.clone();
  if (cov) {   // 清單蓋住右邊：鏡頭和看的點一起往右平移，畫面內容才會落在清單左邊那塊的中間
    const sh = cov * d * camera.aspect * Math.tan(camera.fov * Math.PI / 360), fx = -Math.cos(a), fz = -Math.sin(a);
    pos.x -= fz * sh; pos.z += fx * sh; tgt.x -= fz * sh; tgt.z += fx * sh;
  }
  follow = false;
  flyTo({ pos, target: tgt }, 1.5);
}
/* 走到哪：繞著島挑下一個地方（鏡頭看得到的優先）。淺水區用走的，深水區用游的；中間會先站著看看四周 */
const KJ = { x: Math.cos(-1.76) * 50, z: Math.sin(-1.76) * 50, h: .19, v: 0, vT: 0, mode: 'walk', u: 0, t: 0, ga: 0, gr: 52, dir: 1, deep: false, ph: 0, sw: 0, sp: 0, sd: 0, ly: 0, lp: 0, lyT: 0, lpT: 0, lookT: 3, tapT: 0, tl: 0, top: 21, cx: 0, cz: 0, wake: 0, so: .6, dp: 0, spl: false, tw: 9, rt: -1, rt0: -1, rtw: 0, hv: 0, rsw: 10, rq: 0, rcd: 0, rsp: 60, rcam: false, rFree: false, rGold: false, rIsle: false, chg: 0, bump: 0, fg: 0, rc: [0, 0], imp: false, boot: -1, hu: 0, fv: 30, ff: [0, 0, 0, 0, 0, 0, 0, 0, 0], mk: 0 };   // chg：合體大招蓄力（0～1）；bump：你落在牠頭上的那一下；fg：背鰭金光；rc：放煙火時兩隻手的後座力；rt：這次吼了幾秒；rq：點牠後過多久吼；rcd：吼完多久內不再吼；rsp：多久之後才會自己吼
let kjReady = false;   // 載入時就會先算一次姿勢，那時聲音、飛船都還沒建好，先別碰
const _kA = new THREE.Vector3(), _kB = new THREE.Vector3(), _kC = new THREE.Vector3(), _kD = new THREE.Vector3(), _kT = [...Array(7)].map(() => new THREE.Vector3());
const kjView = (x, z) => _dfr.containsPoint(_dv3.set(x, 6, z)) && camera.position.distanceTo(_dv3) < 240;
const kjCross = (a, b, at) => Math.floor((a - at) / TAU) !== Math.floor((b - at) / TAU);   // 走路的相位這一格有沒有經過 at
function kjPlan() {
  const K = KJ, a = Math.atan2(K.z, K.x), wet = K.mode === 'swim' || K.mode === 'dive', deep = rnd() < (wet ? .45 : .5);
  const go = Math.cos(a + K.h) > 0 ? 1 : -1;   // 現在繞島的方向；走著的時候不改往反方向（掉頭要大迴轉），停下來之後才可能掉頭
  let best = -1;
  for (let i = 0; i < 10; i++) {   // 抽幾個候選點，鏡頭看得到的加分
    const dir = K.v > .6 ? go : rnd() < .5 ? -1 : 1, ca = a + dir * (.5 + rnd() * 1.7), cr = deep ? 72 + rnd() * 14 : 49 + rnd() * 12;
    const s = rnd() + (kjView(Math.cos(ca) * cr, Math.sin(ca) * cr) ? 1.3 : 0);
    if (s > best) { best = s; Object.assign(K, { ga: ca, gr: cr, dir }); }
  }
  K.deep = deep; K.t = 150; K.dp = Math.atan2(Math.sin(K.ga - a), Math.cos(K.ga - a));
  if (!wet && !deep && K.rsp <= 0 && K.rcd <= 0 && kjReady && !flight.phase && kjView(K.x, K.z) && rnd() < .5) kjRoar();
  else if (!wet && !deep && rnd() < .35) { K.mode = 'stand'; K.t = 5 + rnd() * 6; K.so = (rnd() < .5 ? -1 : 1) * (.45 + rnd() * .4); }
}
function kjRideMode(K, r, inp) {   // 你騎著：有推就走、沒推就站（蓄力時站著不動）；往外走到淺水區邊上撲進水裡游，游回淺水區站起來
  const out = Math.cos(K.h - Math.atan2(K.x, K.z));   // >0＝正往外海走
  if (K.mode === 'swim') { if (r < KJ_SHELF + 1 && out < 0) { K.mode = 'rise'; K.u = 0; } return; }
  if (K.chg <= 0 && r > KJ_SHELF - 1.5 && inp.y > .3 && out > .2) { K.mode = 'dive'; K.u = 0; K.spl = false; return; }
  K.mode = K.chg <= 0 && (Math.abs(inp.y) > .12 || Math.abs(inp.x) > .12) ? 'walk' : 'stand';
}
function kjFloor(x, z) {   // 開飛船經過巨獸時至少要飛多高（離牠遠＝0），比照飛到遠島上空自動拉高
  const K = KJ, d = Math.min(Math.hypot(x - K.x, z - K.z), Math.hypot(x - K.cx, z - K.cz));
  return d < 15 ? lerp(K.top + 3, 0, smooth((d - 8) / 7)) : 0;
}
function updateKaiju(dt, t) {
  const K = KJ, R = kj, a = Math.atan2(K.z, K.x), r = Math.hypot(K.x, K.z), u0 = K.u;
  const rd = kjReady && ride.ctl, wait = kjReady && !ride.ctl && ['charge', 'fly', 'hover'].includes(ride.phase), inp = rd ? pilotInput() : null;   // rd：你騎在牠頭上、牠聽你的；wait：你正飛過來，牠停下來等你
  K.rcd -= dt; K.rsp -= dt;
  if (K.rq > 0 && (K.rq -= dt) <= 0 && !rd && !wait) kjRoar(true);   // 點牠：先轉頭看你，過一下才轉過去對著島吼
  if (K.mode === 'stand') { if (rd) kjRideMode(K, r, inp); else if (!wait && (K.t -= dt) <= 0) { K.mode = 'walk'; K.t = 150; } }   // 站完照原本挑好的目的地走；騎著＝聽你的
  else if (K.mode === 'roar') { K.rt0 = K.rt; if (K.rt >= 0 && (K.rt += dt * (K.rFree && (K.rt < 1.3 || K.rt > 4.5) ? 2.4 : 1)) >= KJ_ROAR) { K.mode = rd ? 'stand' : 'walk'; K.t = 150; K.rcd = rd ? 0 : 6; K.rFree = K.rGold = false; } }
  else if (K.mode === 'dive') { if ((K.u += dt / 3.4) >= 1) K.mode = 'swim'; }
  else if (K.mode === 'rise') { if ((K.u += dt / 4) >= 1) { K.mode = 'shake'; K.u = 0; } }
  else if (K.mode === 'shake') { if ((K.u += dt / 1.8) >= 1) K.mode = rd || wait ? 'stand' : 'walk'; }   // 站起來先甩水，甩完才走
  else if (K.mode === 'stomp' || K.mode === 'works') { if ((K.u += dt / KJ_ACT[K.mode]) >= 1) { K.mode = 'stand'; K.t = 3; } }   // 騎著時的招式：跺腳、放煙火
  else if (rd) kjRideMode(K, r, inp);
  else if (wait) { if (K.mode === 'walk') { K.mode = 'stand'; K.t = 3; } else if (K.mode === 'swim') { K.mode = 'rise'; K.u = 0; } }   // 停下來等你；在潛水就浮上來接你
  else {
    const d = Math.atan2(Math.sin(K.ga - a), Math.cos(K.ga - a)), passed = Math.abs(d) < .08 || (d * K.dp < 0 && Math.abs(d) < 1);
    K.dp = d;
    if (passed || (K.t -= dt) <= 0) kjPlan();   // 走過目標那條線就算到了：等走到目標點本身，目標落在轉彎半徑裡面時會一直繞圈
    if (K.mode === 'walk' && K.deep && r > KJ_SHELF - 1.5) { K.mode = 'dive'; K.u = 0; K.spl = false; }   // 走到淺水區邊上：跳進深水
    else if (K.mode === 'swim' && !K.deep && r < KJ_SHELF + 1) { K.mode = 'rise'; K.u = 0; }   // 游回淺水區：站起來
  }
  const wet = K.mode === 'swim' || K.mode === 'dive';
  if (rd) {   // 你騎著：左右轉向、前後走（倒退慢一點）；吼的時候慢慢轉著瞄準；蓄力、跺腳、放煙火、撲水、浮上來的時候不轉
    const tr = K.mode === 'swim' ? 1.0 : (K.mode === 'walk' || K.mode === 'stand') && K.chg <= 0 ? .75 : K.mode === 'roar' ? .3 : 0;
    let want = -inp.x * tr;
    if (K.mode === 'roar' && K.rFree) {   // 噴火時你瞄的地方在頭轉不到的角度：身體跟著轉過去
      aimTarget(_kD);
      const dy = Math.atan2(Math.sin(Math.atan2(_kD.x - K.x, _kD.z - K.z) - K.h), Math.cos(Math.atan2(_kD.x - K.x, _kD.z - K.z) - K.h));
      if (Math.abs(dy) > .55) want += Math.sign(dy) * Math.min(1.1, (Math.abs(dy) - .4) * 2.2);
    }
    if (K.mode === 'works' && fw.show) want = clamp(Math.atan2(Math.sin(fw.show.h - K.h), Math.cos(fw.show.h - K.h)) * 1.8, -.7, .7);   // 放煙火：轉過去面向鏡頭和島
    K.hv = lerp(K.hv, want, Math.min(1, dt * 5));
    K.h = Math.atan2(Math.sin(K.h + K.hv * dt), Math.cos(K.h + K.hv * dt));
    K.vT = K.mode === 'walk' ? (inp.y >= 0 ? inp.y * 3.2 : inp.y * 1.3) : K.mode === 'swim' ? Math.max(0, inp.y) * 7.5 : K.mode === 'dive' ? lerp(2.4, 6, K.u) : K.mode === 'rise' ? lerp(3, .8, K.u) : 0;
  } else {
  // 轉向：繞著島往目的地走（不穿過島），游泳轉得比較快；站著時慢慢轉過來面向島；太靠近鏡頭就讓開
  let hd;
  if (K.mode === 'stand') hd = Math.atan2(-K.x, -K.z) + K.so;   // 斜斜地面向島：正面左右對稱看起來像雕像
  else if (K.mode === 'roar') hd = Math.atan2(-K.x, -K.z);   // 吼的時候正對著島
  else if (K.mode === 'stomp' || K.mode === 'works') hd = K.h;
  else {
    const d = Math.atan2(Math.sin(K.ga - a), Math.cos(K.ga - a)), ac = a + clamp(d, -.28, .28);
    const rc = wet ? clamp(r + (K.gr - r) * .6, 61, KJ_MAX - 1) : clamp(r + (K.gr - r) * .6, KJ_MIN + .5, KJ_SHELF + .5);
    let dx = Math.cos(ac) * rc - K.x, dz = Math.sin(ac) * rc - K.z;
    const q = Math.hypot(dx, dz) || 1;
    dx = dx / q + Math.sin(K.h) * .5; dz = dz / q + Math.cos(K.h) * .5;   // 偏好往前直走，不原地打轉
    if (r > KJ_MAX - 14) { const k = smooth((r - KJ_MAX + 14) / 14) * 2.5; dx -= K.x / r * k; dz -= K.z / r * k; }   // 靠近邊界就提早往回轉（游泳轉彎半徑約 17），不要貼著邊界滑
    if (r < KJ_MIN + 7) { const k = smooth((KJ_MIN + 7 - r) / 7) * 2.2; dx += K.x / r * k; dz += K.z / r * k; }
    const cx = K.x - camera.position.x, cz = K.z - camera.position.z, cd = Math.hypot(cx, cz) || 1;
    if (cd < 30 && camera.position.y < 28) {   // 鏡頭壓低在外海時別撞上鏡頭：往外推、再往行進方向那側偏，繞過去（只往外推會跟目的地拉扯、原地打轉）
      const k = smooth((30 - cd) / 12) * 2, sd = Math.sign(Math.sin(K.h) * cz - Math.cos(K.h) * cx) || 1;
      dx += (cx / cd + sd * cz / cd * .8) * k; dz += (cz / cd - sd * cx / cd * .8) * k;
    }
    hd = Math.atan2(dx, dz);
  }
  const w = K.mode === 'swim' ? .36 : K.mode === 'walk' ? .22 : K.mode === 'roar' ? .6 : K.mode === 'stand' || K.mode === 'shake' ? .1 : .14, hdiff = Math.atan2(Math.sin(hd - K.h), Math.cos(hd - K.h));
  if (K.mode === 'roar') {   // 吼之前轉過去對著島：頭先轉，身體慢慢加速、快轉正時慢慢停；轉正了（或轉太久）才開始吼
    K.hv = clamp(K.hv + clamp(5.5 * hdiff - 4.0 * K.hv, -3.0, 3.0) * dt, -1.7, 1.7);
    K.h = Math.atan2(Math.sin(K.h + K.hv * dt), Math.cos(K.h + K.hv * dt));
    if (K.rt < 0 && ((Math.abs(hdiff) < .05 && Math.abs(K.hv) < .1) || (K.rtw += dt) > 4)) { K.rt = 0; K.rt0 = -.001; }
  } else {
    const dh = clamp(hdiff, -w * dt, w * dt);
    K.h = Math.atan2(Math.sin(K.h + dh), Math.cos(K.h + dh));
  }
  K.vT = K.mode === 'walk' ? 2.4 : K.mode === 'swim' ? 6 : K.mode === 'dive' ? lerp(2.4, 6, K.u) : K.mode === 'rise' ? lerp(3, .8, K.u) : 0;   // 站起來時先煞住，不然會衝進淺水區太裡面
  if (K.mode === 'walk' || K.mode === 'swim') K.vT *= 1 - .75 * smooth((Math.abs(hdiff) - .6) / 1.4);   // 要大轉彎就先放慢，轉的圈才小（不然會一路衝到邊界）
  }
  K.v += clamp(K.vT - K.v, -(K.mode === 'rise' ? 2 : K.mode === 'roar' ? 2.5 : rd ? 2.6 : 1.2) * dt, (rd ? 1.7 : .9) * dt);   // 你騎著：起步、煞車都快一點，不然按了半天才動
  K.x += Math.sin(K.h) * K.v * dt; K.z += Math.cos(K.h) * K.v * dt;
  const r2 = Math.hypot(K.x, K.z), kk = r2 < KJ_MIN - 1 ? (KJ_MIN - 1) / r2 : r2 > KJ_MAX + 1 ? (KJ_MAX + 1) / r2 : 1;   // 保底：不會走進海豚游的水域，也不會撞上遠島
  K.x *= kk; K.z *= kk;
  // 姿勢：sp＝身體往前趴的程度（0 站直、1 游泳），sd＝沉到游泳深度的程度；撲水＝先蹲、跳起來、往前倒、肚子拍到水面；站起來＝先站直再甩水
  let sp, sd, hop = 0, crouch = 0;
  if (K.mode === 'dive') { const u = K.u; sp = smooth((u - .2) / .38); sd = smooth((u - .36) / .44); hop = Math.sin(Math.PI * clamp((u - .17) / .36, 0, 1)); crouch = smooth(u / .14) * (1 - smooth((u - .14) / .07)); }
  else if (K.mode === 'rise') { sp = 1 - smooth((K.u - .1) / .7); sd = 1 - smooth(K.u / .75); }
  else sp = sd = K.mode === 'swim' ? 1 : 0;
  const ph0 = K.ph, sk = K.mode === 'shake' ? smooth(K.u / .12) * (1 - smooth((K.u - .45) / .55)) : 0;   // sk：甩水的力道
  K.sp = sp; K.sd = sd;
  K.ph += K.v * dt / (3.6 * KJ_S) * TAU * (1 - sp) + (K.mode === 'roar' || rd ? Math.abs(K.hv) * dt * 2.6 : 0);   // 短腿小步：一步不到 2，兩步一個循環；吼之前轉身時原地踏步
  K.sw += dt * (1.2 + K.v * .22) * Math.max(sp, .001);   // 游泳時尾巴左右擺的節奏
  const gw = Math.max(smooth(Math.abs(K.v) / 1.2) * (1 - sp), K.mode === 'roar' || rd ? smooth(Math.abs(K.hv) / .45) * .85 : 0), ph = K.ph, sn = Math.sin(ph), cs = Math.cos(ph), sw = K.sw, sh = Math.sin(t * 19);
  // 吼：0～1.1 秒往後仰、張嘴、眼睛變藍、嘴裡蓄藍光；1.1 秒往前一探，1.3～4.5 秒噴火（頭慢慢左右掃）；之後閉嘴、眼睛變回紅色
  const T = K.mode === 'roar' ? K.rt : -1, T0 = K.mode === 'roar' ? K.rt0 : -1;
  const rA = T < 0 ? 0 : smooth(T / 1.1) * (1 - smooth((T - 1.1) / .25)), rB = T < 0 ? 0 : smooth((T - 1.1) / .25) * (1 - smooth((T - 4.5) / .8)), rW = rA + rB;
  const eb = T < 0 ? 0 : smooth(T / .9) * (1 - smooth((T - 4.6) / .7)), ch = T < 0 ? 0 : smooth(T / 1.2) * (1 - smooth((T - 4.4) / .5));   // eb：眼睛變藍的程度；ch：嘴裡的藍光
  // 頭往哪看：站著時慢慢四處看；被點到就轉頭盯著你、歪頭；開飛船靠近就盯著飛船
  if ((K.lookT -= dt) <= 0) { K.lookT = 2.5 + rnd() * 4; K.lyT = rnd() < .4 ? 0 : (rnd() - .5) * 1.5; K.lpT = (rnd() - .6) * .3; }
  let ly = K.lyT * (1 - sp * .7), lp = K.lpT * (1 - sp), lr = .7;
  const lookAt = (P, pmax) => {
    const ca = Math.atan2(P.x - K.x, P.z - K.z);
    ly = clamp(Math.atan2(Math.sin(ca - K.h), Math.cos(ca - K.h)), -1.1, 1.1) * (1 - sp * .6);
    lp = clamp(Math.atan2(P.y - 13, Math.hypot(P.x - K.x, P.z - K.z)), -pmax, pmax) * (1 - sp);
  };
  if (K.tapT > 0) { K.tapT -= dt; lookAt(camera.position, .35); }
  if (kjReady && flight.phase && Math.hypot(ship.position.x - K.x, ship.position.z - K.z) < 50) { lookAt(ship.position, .5); lr = 1.4; }
  if (K.mode === 'roar' && K.rt < 0) { const ca = Math.atan2(-K.x, -K.z); ly = clamp(Math.atan2(Math.sin(ca - K.h), Math.cos(ca - K.h)), -.75, .75); lp = 0; lr = 1.5; }   // 吼之前轉身：頭先轉過去看島
  if (wait) { _kC.copy(avatar.position); _kC.y += 1; lookAt(_kC, .45); lr = 1.6; }   // 你飛過來：轉頭看著你
  if (rd && aimLook() && (K.mode === 'walk' || K.mode === 'stand' || K.mode === 'roar')) { aimTarget(_kD); lookAt(_kD, 1.0); lr = K.mode === 'roar' ? 2.4 : 1.6; }   // 你開著：頭轉過去看你瞄的地方（滑鼠指著、剛點過）
  else if (rd) { ly = clamp(K.hv * .7, -.5, .5) * (1 - sp * .6); lp = K.mode === 'works' ? .32 : K.mode === 'stomp' && K.u < .4 ? -.18 : 0; lr = 1.2; }   // 頭往轉彎那邊偏一點；放煙火時抬頭看天空，跺腳前低頭看腳
  if (!K.rFree) { ly *= 1 - rW; lp *= 1 - rW; }   // 你開著噴火：頭一直對著瞄的地方
  K.ly += clamp(ly - K.ly, -lr * dt, lr * dt); K.lp += clamp(lp - K.lp, -lr * .6 * dt, lr * .6 * dt);
  K.tl += clamp((K.tapT > 0 ? .26 : 0) - K.tl, -.9 * dt, .9 * dt);
  // 擺姿勢：站著／走路＝微微駝背、一搖一擺、尾巴尖翹著甩；游泳＝整隻趴平潛在水下、臉朝下、尾巴像鱷魚一樣左右擺、兩腳踢水
  const B = (x, y) => lerp(x, y, sp);
  R.g.position.set(K.x, 0, K.z);
  R.g.rotation.y = K.h + Math.sin(sw) * .06 * sp;
  R.hip.rotation.set(B(.04 + .03 * Math.cos(2 * ph) * gw, 1.45 + .02 * Math.sin(sw * 2)), .06 * sn * gw + .04 * Math.sin(sw) * sp - .1 * sk * sh, B(.08 * cs * gw + Math.sin(t * .7) * .015, .03 * Math.sin(sw)));
  R.waist.rotation.set(B(.12 + Math.sin(t * 1.1) * .015, .1), -.05 * sn * gw + K.ly * .2 * (1 - sp) + .32 * sk * sh, .04 * cs * gw);
  R.neck.rotation.set(B(-.08, 0) - K.lp * .3, K.ly * .3 + .2 * sk * Math.sin(t * 19 - .4), 0);
  R.head.rotation.set(B(-.1, .1) - K.lp * .6, K.ly * .5 + .45 * sk * Math.sin(t * 19 - .8), K.tl);
  K.hu = approach(K.hu, rd ? 1 : 0, dt * .8);   // 你開著游泳：抬著頭游（駕駛艙露出水面），像鱷魚一樣
  R.neck.rotation.x -= 1.15 * sp * K.hu; R.head.rotation.x -= .3 * sp * K.hu;
  R.head.position.z = .15 + smooth((sd - .55) / .4) * (1 - K.hu);   // 潛到水下後頭再往下收一點（頭比背鰭大，不收的話後腦勺會露出水面）
  R.jaw.rotation.x = .04;
  R.legs.forEach((L, i) => {
    const p = ph + i * Math.PI, kick = sw * 2.2 + i * Math.PI;
    L.th.rotation.set(B(-.05 - .5 * Math.sin(p) * gw, -.3 + .45 * Math.sin(kick)) - .35 * crouch + .5 * hop, 0, (i ? -1 : 1) * B(.05, .1));   // 負的＝往前跨
    L.kn.rotation.x = B(.05 + .8 * Math.pow(Math.max(0, Math.cos(p)), 1.5) * gw, .5 + .3 * Math.sin(kick + 1)) + .7 * crouch;   // 往前跨的那段膝蓋彎起來
    L.an.rotation.x = B(-(R.hip.rotation.x + L.th.rotation.x + L.kn.rotation.x), .6);   // 站著走時腳掌保持水平
  });
  R.arms.forEach((A, i) => {
    const s = i ? 1 : -1;
    A.sh.rotation.set(B(-.5 + .25 * Math.sin(ph + (i ? 0 : Math.PI)) * gw, -.4 + .2 * Math.sin(sw * 2 + i * Math.PI)) + .7 * crouch - 1.6 * hop, 0, s * (B(.32, .2) + .3 * sk * Math.sin(t * 19 + i * Math.PI)));   // 走路時手跟對側的腳一起擺；跳起來時兩手往前伸
    A.el.rotation.x = B(-.85, -.6);
  });
  R.tail.forEach((T, i) => {
    const yw = (.05 + .04 * i) * Math.sin(ph - .4 - i * .5) * gw + Math.sin(t * 1.2 - i * .5) * .05 * (1 - sp) * (1 - gw) + .12 * sk * Math.sin(t * 19 - i * .6);
    const ys = (.1 + .06 * i) * Math.sin(sw - i * .7) * .5;
    T.rotation.set(i ? B(i > 3 ? .2 : .06, 0) : B(-.32, -1.35), B(yw, ys), 0);
  });
  R.tail[0].position.z = -2.3 + 1.4 * smooth((sd - .55) / .4);   // 尾巴根部也往下收（趴平時尾巴根在背上，比背還高）
  if (rW > 0) {   // 吼：rA＝往後仰、兩手張開，rB＝往前探、兩手往後收、頭左右掃
    const mx = (v, a, b) => v * (1 - rW) + a * rA + b * rB, sweep = .034 * K.rsw * Math.sin((T - 1.3) * 1.9), F = K.rFree;   // F：你開著噴——噴的時候頭對著你瞄的地方，不左右掃
    R.waist.rotation.x = mx(R.waist.rotation.x, -.28, .22);
    R.neck.rotation.x = mx(R.neck.rotation.x, -.15, F ? R.neck.rotation.x : .05);
    R.head.rotation.set(mx(R.head.rotation.x, -.5, F ? R.head.rotation.x : .02), mx(R.head.rotation.y, F ? R.head.rotation.y : 0, F ? R.head.rotation.y : sweep), R.head.rotation.z * (1 - rW));
    R.arms.forEach((A, i) => { const s = i ? 1 : -1; A.sh.rotation.x = mx(A.sh.rotation.x, -1.5, -.3); A.sh.rotation.z = mx(A.sh.rotation.z, s * .95, s * .5); A.el.rotation.x = mx(A.el.rotation.x, -.4, -.9); });
    R.tail[0].rotation.x = mx(R.tail[0].rotation.x, -.05, -.3);
  }
  let wl = 0, stD = 0;   // 跺腳：抬腳的程度、踩下去那一下往下沉
  if (K.mode === 'stomp') {   // 跺腳：右腳抬高、身體往後仰、兩手張開保持平衡，用力踩下去；踩到水那一刻水花炸開、一圈浪往島推過去
    const T2 = K.u * KJ_ACT.stomp, wa = smooth(T2 / .5) * (1 - smooth((T2 - 1.2) / .8)), L = R.legs[1];
    wl = smooth(T2 / .7) * (1 - smooth((T2 - .78) / .12));
    stD = T2 >= .9 ? Math.sin(Math.min(1, (T2 - .9) / .45) * Math.PI) : 0;
    L.th.rotation.x = lerp(L.th.rotation.x, -1.2, wl); L.kn.rotation.x = lerp(L.kn.rotation.x, 1.3, wl); L.an.rotation.x = lerp(L.an.rotation.x, -.1, wl);
    R.hip.rotation.z -= .1 * wl; R.waist.rotation.x += -.14 * wl + .12 * stD;
    R.arms.forEach((A, i) => { const s = i ? 1 : -1; A.sh.rotation.z = lerp(A.sh.rotation.z, s * 1.05, wa); A.sh.rotation.x = lerp(A.sh.rotation.x, -.9, wa); });
    if (!K.imp && T2 >= .9) {   // 踩下去了
      K.imp = true;
      R.g.updateMatrixWorld(true); L.an.getWorldPosition(_kC);
      kjBurst(_kC.x, .4, _kC.z, 260, 9, 10); kjRipple(_kC.x, _kC.z, 3, 30, 3.4, .8); kjRipple(_kC.x, _kC.z, 2, 18, 2.4, .7);
      if (kjReady) { sfx('stomp', _kC); rideStompHit(_kC.x, _kC.z); }
    }
  }
  let mo = 0;   // 煙火秀最後：抬頭張嘴發射大金柳
  if (K.mode === 'works') {   // 放煙火：兩手舉高、八根槍管手指朝天，一根接一根發射（每發一次那隻手往後一頓）；最後抬頭張嘴
    const st = kjReady && fw.show ? fw.show.t : K.u * KJ_ACT.works, wa = smooth((st - 1.0) / .7) * (1 - smooth((st - 18.2) / .9));
    R.arms.forEach((A, i) => { const s = i ? 1 : -1; K.rc[i] = Math.max(0, K.rc[i] - dt * 6); A.sh.rotation.x = lerp(A.sh.rotation.x, -2.75 + .18 * K.rc[i], wa); A.sh.rotation.z = lerp(A.sh.rotation.z, s * .3, wa); A.el.rotation.x = lerp(A.el.rotation.x, -.12 + .35 * K.rc[i], wa); });
    R.waist.rotation.x -= .08 * wa;
    mo = smooth((st - 13.6) / .55) * (1 - smooth((st - 15.1) / .7));
    K.mk = Math.max(0, K.mk - dt * 3);
    R.waist.rotation.x -= .07 * mo; R.neck.rotation.x -= .3 * mo - .25 * K.mk; R.head.rotation.x -= .6 * mo - .2 * K.mk;   // 發射那一下頭往後一頓
  }
  for (let i = 0; i < 9; i++) K.ff[i] = Math.max(0, K.ff[i] - dt * 2.5);   // 背鰭發射時亮一下
  if (K.boot >= 0 && (K.boot += dt) > 2.4) K.boot = -1;   // 開機：0.3 秒眼睛閃金光、0.45 秒起一道金光從頭沿著背鰭跑到尾巴、1.1 秒抬頭吼一聲
  const bt = K.boot, bE = bt >= 0 ? smooth((bt - .3) / .15) * (1 - smooth((bt - .75) / .35)) : 0, bR = bt >= 0 ? smooth((bt - 1.05) / .25) * (1 - smooth((bt - 1.75) / .4)) : 0;
  if (bR > 0) { R.neck.rotation.x -= .12 * bR; R.head.rotation.x -= .3 * bR; }
  if (kjReady && bt >= 1.05 && bt - dt < 1.05) sfx('kjRoar', R.head);
  if (K.chg > 0) {   // 合體大招蓄力：微微蹲低、兩手往後收、低頭、全身微微發抖（放開後隨著往後仰慢慢退掉）
    const c = smooth(K.chg / .3) * (1 - rW);
    R.waist.rotation.x += .1 * c; R.waist.rotation.y += .012 * Math.sin(t * 53) * K.chg;
    R.head.rotation.x += .14 * c;
    R.arms.forEach(A => { A.sh.rotation.x = lerp(A.sh.rotation.x, .25, c * .8); A.el.rotation.x = lerp(A.el.rotation.x, -1.3, c * .8); });
  }
  if (K.bump > 0) { K.bump = Math.max(0, K.bump - dt / .6); R.neck.rotation.x += .2 * Math.sin((1 - K.bump) * Math.PI); }   // 你落在頭上：頭被壓得一低
  if (K.mode === 'roar' && K.rGold) K.chg = T < 1.3 ? 1 : Math.max(0, K.chg - dt * 2);   // 大招：蓄好的力撐到光束噴出來
  R.jaw.rotation.x = .04 + .55 * rA + (.75 + .04 * Math.sin(t * 40)) * rB + .75 * mo + .55 * bR;   // 張大嘴
  const gC = Math.max(K.chg, K.rGold ? eb : 0, bE), eA = Math.max(eb, K.chg * .8, bE * .7), chA = Math.max(ch, K.chg * .85, mo * .9);   // gC：變金色的程度（合體大招）
  KJ_EYE.userData.base.lerpColors(KJ_EYE_RED, KJ_EYE_BLUE, K.rGold ? 0 : eb);   // 眼睛紅→藍（電影版噴火時眼睛變藍）；大招變金色
  KJ_HALO.color.lerpColors(KJ_HALO_RED, KJ_HALO_BLUE, K.rGold ? 0 : eb);
  if (gC > 0) { KJ_EYE.userData.base.lerp(KJ_EYE_GOLD, gC); KJ_HALO.color.lerp(KJ_HALO_GOLD, gC); }
  if (eA > 0) KJ_HALO.opacity = Math.max(KJ_HALO.opacity, eA * .9);   // 白天吼也看得到眼睛發光
  R.eyes.forEach(E => { E.rotation.z = E.userData.s * .3 * eA; E.userData.glow.scale.y = .56 * (1 - .45 * eA); });   // 噴火時眼睛變兇：內側往下斜、瞇起來
  R.brows.forEach(W => { W.rotation.z = Math.PI + W.userData.s * (.2 + .32 * eA); W.position.y = 5.62 - .3 * eA; });   // 眉毛壓低、更斜
  KJ_MOUTH.visible = chA > .01;
  KJ_MOUTH.material.color.setHex(gC > .01 || mo > .01 ? 0xffd25c : 0x7cc4ff);
  KJ_MOUTH.material.opacity = chA * (.75 + .25 * Math.sin(t * 31));
  KJ_MOUTH.scale.setScalar(2 + 3.5 * chA + rB * 1.5 * Math.sin(t * 23));
  K.fg = Math.max(K.fg - dt * .8, K.rGold ? rB : 0);   // 背鰭的金光：蓄力時從尾巴尖往肩膀一段段亮起來，光束噴完慢慢退
  const bp = bt >= 0 ? 8.6 - (bt - .45) * 10 : -99, pw = kjReady && ride.ctl ? 1 : 0;   // bp：開機那道金光跑到第幾節；pw：你開著＝背鰭微微一明一暗
  R.fins.forEach((m, i) => { m.material.emissiveIntensity = Math.max(smooth(K.chg * 10.5 - i), K.fg * (.75 + .25 * Math.sin(t * 14 - i * .7)), Math.exp(-(i - bp) * (i - bp) / 1.6), K.ff[i], pw * (.13 + .08 * Math.sin(t * 2.2 - i * .6))) * (2.1 + (kjReady ? night : 0) * 1.1); });   // 載入時 night 還沒宣告（TDZ），先當白天
  // 整隻放多深：先把根部放在 0 量背的高度；站著＝腳踩海底，游泳＝背剛好在水面下、只有背鰭露出來
  R.g.updateMatrixWorld(true);
  _kB.copy(R.back).applyMatrix4(R.waist.matrixWorld);
  const ys = -kjDepth(Math.hypot(K.x, K.z)) + .15 * KJ_S * Math.cos(2 * ph) * gw + Math.sin(t * 1.1) * .05 * (1 - sp);   // 走路一步一沉（踩下去最低）
  R.g.position.y = lerp(ys, KJ_SWIM + Math.sin(sw * 2) * .06 - _kB.y, sd) + KJ_S * (2.6 * hop - .7 * crouch - .35 * rA - .15 * rB + .2 * wl - .5 * stD - .3 * K.chg * (1 - rW));   // 吼的時候微微蹲低、站穩；跺腳抬腳時身體抬高、踩下去一沉
  R.g.updateMatrixWorld(true);
  if (T >= 1.3 && T < 4.5) {   // 噴火：從嘴巴往島的中間噴（左右掃一點），會先打到防護罩
    _kC.set(0, 1.0, 5.3).applyMatrix4(R.head.matrixWorld);
    kjFlame.mat.uniforms.uGold.value = K.rGold ? 1 : 0;
    let fv = 30;
    if (K.rFree && kjReady) {   // 你開著：往你瞄的地方噴（頭還沒轉過去就先往頭朝的方向）；火往島那邊去，罩子才升起來
      aimTarget(_kD);
      _kA.copy(_kD).sub(_kC);
      const dist = _kA.length() || 1;
      _kA.divideScalar(dist);
      _kB.set(0, 0, 1).transformDirection(R.head.matrixWorld);
      if (_kA.dot(_kB) < .8) _kA.lerp(_kB, .55).normalize();
      fv = clamp(dist / .72, 30, 125);   // 遠的地方噴得快一點，火才飛得到（雲在一百多外也燒得到）
      const tS = shieldHitT(_kC, _kA);
      if (tS > 0 && tS < dist + 12 && !K.rIsle) {
        K.rIsle = true;
        if (SH.on < .05) SH.rise = -.1;
        SH.up = true; sfx('shieldUp', SH_AT); sfx('shieldHit', SH_AT, Math.max(.6, 4.5 - T));
        if (dog.state !== 'sleep' && dog.state !== 'bed') { Object.assign(dog, { path: null, state: 'idle', t: 5 }); dog.g.rotation.y = Math.atan2(K.x - dog.g.position.x, K.z - dog.g.position.z); bubble(dog.g, '汪汪汪！', 1.25); }
      }
    } else {
      const sl = Math.hypot(K.x, K.z) || 1, sw2 = K.rsw * Math.sin((T - 1.3) * 1.9);
      _kA.set(-K.z / sl * sw2 - _kC.x, 5 - _kC.y, K.x / sl * sw2 - _kC.z).normalize();
    }
    if (K.rGold && kjReady) kjBeam(_kC, _kA, dt);
    else kjEmit(Math.floor(900 * dt + Math.random()), _kC, _kA, fv, .42 * Math.sqrt(30 / fv));
  }
  if (K.rcam && kjReady) { K.rcam = false; kjRoarCam(); }   // 點牠吼：一開始轉身時鏡頭就調過去
  if (T >= 0 && kjReady) {   // 吼的時間軸上的事：吼聲、阿滿叫、罩子升起來、火打到罩子、罩子收掉
    const at = x => T0 < x && T >= x, awake = dog.state !== 'sleep' && dog.state !== 'bed';
    if (at(.05)) sfx('kjRoar', R.head);
    if (at(.3) && awake && !K.rFree) { Object.assign(dog, { path: null, state: 'idle', t: 5 }); dog.g.rotation.y = Math.atan2(K.x - dog.g.position.x, K.z - dog.g.position.z); bubble(dog.g, '汪汪汪！', 1.25); }
    if (at(1.3)) { if (!K.rFree) { if (SH.on < .05) SH.rise = -.1; SH.up = true; sfx('shieldUp', SH_AT); } sfx(K.rGold ? 'beam' : 'kjFlame', R.head, 3.2); }   // 騎著時罩子等火真的朝島過來才升（上面噴火那段）
    if (at(1.9) && !K.rFree) sfx('shieldHit', SH_AT, 3.2);
    if (at(2.6) && awake && (!K.rFree || K.rIsle)) bubble(dog.g, '汪汪！', 1.25);
    if (at(5.3) && SH.up) { SH.up = false; sfx('shieldDown', SH_AT); }
  }
  // 水面：身體、頭、尾巴穿過水面的地方一圈白浪；腳踩下去水圈擴散出去
  const foamAt = (m, P, Q, ra, rb, op, sq = 1) => {
    if ((P.y > 0) === (Q.y > 0)) return false;
    const f = P.y / (P.y - Q.y), s = lerp(ra, rb, f) * KJ_S * (1.12 + Math.sin(t * 2.6 + m.id) * .04);
    m.position.set(lerp(P.x, Q.x, f), .14, lerp(P.z, Q.z, f));
    m.scale.set(s, 1, s * sq); m.rotation.y = K.h;
    m.material.opacity = op;
    return (m.visible = true);
  };
  _kA.set(0, 3, .2).applyMatrix4(R.waist.matrixWorld); _kB.set(0, -4.6, .2).applyMatrix4(R.hip.matrixWorld);
  if (!foamAt(kjFoam[0], _kA, _kB, 3.9, 4.3, .45 * (1 - sd), .88)) kjFoam[0].visible = false;
  _kA.set(0, 7, .3).applyMatrix4(R.head.matrixWorld); _kB.set(0, .3, .3).applyMatrix4(R.head.matrixWorld);
  if (!foamAt(kjFoam[1], _kA, _kB, 3.3, 3.6, .45 * sd, .95)) kjFoam[1].visible = false;
  R.legs.forEach((L, i) => {
    if (gw > .3 && kjFoam[0].visible && kjCross(ph0, K.ph, Math.PI / 2 + i * Math.PI)) {   // 往前跨到底、踩下去：水圈從那隻腳擴散出去
      L.an.getWorldPosition(_kC);
      const m = kjFoam[0], dx = _kC.x - m.position.x, dz = _kC.z - m.position.z, q = Math.hypot(dx, dz) || 1, e = m.scale.x * .9;
      kjRipple(_kC.x, _kC.z, 3, 12, 2.6, .5);
      kjBurst(m.position.x + dx / q * e, .3, m.position.z + dz / q * e, 10, 2.5, 3.5);
      if (kjReady) sfx('kjStep', _kC);
    }
  });
  R.tail.forEach((T, i) => T.getWorldPosition(_kT[i]));
  _kT[6].set(0, 0, -R.TL[5]).applyMatrix4(R.tail[5].matrixWorld);
  let tf = false;
  for (let i = 0; i < 6 && !tf; i++) tf = foamAt(kjFoam[2], _kT[i], _kT[i + 1], R.TR[i], R.TR[i + 1], .55 * (1 - sd));
  if (!tf) kjFoam[2].visible = false;
  R.head.getWorldPosition(_kA); R.tip.getWorldPosition(_kB);
  K.top = Math.max(_kB.y + .6, 3); K.cx = _kA.x; K.cz = _kA.z;   // 頭頂（含頭上的冠）
  if (sd > .8 && K.v > 1.5) {   // 游泳：背鰭最前面推出浪、背鰭劃過水面濺起小水花
    if ((K.wake -= dt) <= 0) {
      K.wake = .55;
      _kC.copy(R.bow).applyMatrix4(R.waist.matrixWorld);
      kjRipple(_kC.x, _kC.z, 1.5, 7, 2.4, .45);
      if (Math.random() < .6) kjBurst(_kC.x, .2, _kC.z, 5, 1.6, 2.4);
    }
    if (Math.random() < dt * 8) { const f = (Math.random() - .3) * 7; _kC.copy(R.back).applyMatrix4(R.waist.matrixWorld); kjBurst(_kC.x + Math.sin(K.h) * f, .25, _kC.z + Math.cos(K.h) * f, 2, .7, 1.8); }
  }
  if (K.mode === 'rise') {   // 站起來：頭頂一冒出水面就嘩一聲
    R.tip.getWorldPosition(_kC);
    if (K.tw < 0 && _kC.y >= 0) { R.head.getWorldPosition(_kA); kjBurst(_kA.x, .5, _kA.z, 70, 4, 7); kjRipple(_kA.x, _kA.z, 3, 15, 3.2, .65); if (kjReady) sfx('kjSplash', _kA, 1.4); }
    K.tw = _kC.y;
  } else K.tw = -1;
  if (K.mode === 'dive' && !K.spl && K.u > .35) {   // 肚子拍到水面：撲通一大片水花
    _kB.set(0, 2.5, 3.2).applyMatrix4(R.waist.matrixWorld);
    if (_kB.y < .6) {
      K.spl = true;
      kjBurst(_kB.x, .5, _kB.z, 220, 8, 11);
      kjRipple(_kB.x, _kB.z, 5, 20, 3.5, .7); kjRipple(_kB.x, _kB.z, 2.5, 13, 2.6, .6);
      if (kjReady) sfx('kjSplash', _kB, 2.4);
    }
  }
  if (K.mode === 'rise' && K.u > .1 && K.u < .7) for (let k = 0; k < 4; k++) {   // 站起來時水從頭上、肩膀和背上嘩啦啦流下來
    _kB.set((Math.random() - .5) * 7, 1 + Math.random() * 6, (Math.random() - .6) * 6).applyMatrix4((k & 1 ? R.head : R.waist).matrixWorld);
    if (_kB.y > .5) kjBurst(_kB.x, _kB.y, _kB.z, 1, .8, .4);
  }
  if (K.mode === 'shake' && u0 < .08 && K.u >= .08 && kjReady) sfx('kjShake', R.head);
  if (sk > .25) for (let k = 0; k < 5; k++) {   // 甩水：水滴往四面八方飛
    _kB.set((Math.random() - .5) * 7.5, .5 + Math.random() * 6.5, (Math.random() - .5) * 6).applyMatrix4((k % 3 ? R.head : R.waist).matrixWorld);
    if (_kB.y > .5) kjBurst(_kB.x, _kB.y, _kB.z, 1, 6, 2.5);
  }
  updateKjFx(dt); updateFlame(dt); updateShield(dt, t);
}
kjPlan();
Object.assign(KJ, { mode: 'stand', t: 9, h: .19 + .6 });   // 一開始站在島北邊外海、面向島：開場鏡頭從海上飛向島時就看得到牠
updateKaiju(0, 0);
kjReady = true;

/* 清單「島民」：點了鏡頭飛過去、牠會有反應 */
const RESIDENTS = [
  { id: 'dog', name: '阿滿', sub: '柴犬・常在島上閒晃，你走動牠會跟著', color: '#d8894b', icon: 'paw' },
  { id: 'cat', name: '花捲', sub: '白底三花貓・會在島上散步，白天常窩在小蜜蜂機台頂睡午覺；你手上有魚時會跑來討', color: '#e0954f', icon: 'paw' },
  { id: 'crab', name: '寄居蟹', sub: '沙灘上三隻，靠近就縮進殼裡', color: '#e0663f', icon: 'paw' },
  { id: 'blob', name: '柑仔丁', sub: '橘色方塊小傢伙・在廣場和機台間跳來跳去', color: '#d97757', icon: 'paw' },
  { id: 'dolphin', name: '海豚', sub: '三隻結伴在島外游來游去，偶爾表演；點牠就跳給你看', color: '#5f86a6', icon: 'wave' },
  { id: 'kaiju', name: '機械巨獸', sub: '在外海搖搖擺擺地走、潛水時只露出背鰭；點牠會對著島噴藍色火焰，島會升起防護罩；點過之後還可以飛上去，坐進頭頂的駕駛艙開牠', color: '#7b8794', icon: 'wave' },
];
function petPos(id) {
  const v = new THREE.Vector3();
  return ({ dog: dog.g, cat: cat.g, crab: crabs[0].g, blob: blob.g, dolphin: dolphins[0].g, kaiju: kj.waist })[id].getWorldPosition(v);
}
function petTap(id, fromList = false) {
  if (id === 'me') return swing();
  if (id === 'dog') {
    const D = dog;
    if (D.state === 'sleep') { bubble(D.g, 'Zzz…', 1.1); return; }
    if (!fromList) return throwBall();   // 在島上點阿滿＝丟球；從清單點只是打招呼
    D.petT = 2; D.state = D.state === 'follow' ? 'follow' : 'idle'; D.t = 3; D.path = null;
    turnTo(D.g, avatar.position.x - D.g.position.x, avatar.position.z - D.g.position.z, 1);
    bubble(D.g, '汪！', 1.25);
  } else if (id === 'cat') { if (fromList) { cat.awakeT = 3; bubble(cat.g, '喵', .75); } else catTap(); }
  else if (id === 'blob') { blob.hop = 0; blob.body.position.y = .25; bubble(blob.g, '♪', 1.0); }
  else if (id.startsWith('crab')) { const c = crabs[+id.slice(4) || 0]; c.hide = 3; }
  else if (id.startsWith('dolphin')) {   // 點了就表演一招，另外兩隻有時跟著跳
    const d = dolphins[+id.slice(7) || 0];
    if (dolTrick(d, ['spin', 'flip', 'walk', 'jump'][(rnd() * 4) | 0]) || dolTrick(d, 'jump') || dolTrick(d, 'hop')) dolphins.forEach(o => { if (o !== d && rnd() < .5) o.jt = .3 + rnd() * .5; });
    sfx('whistle', d.g);
  }
  else if (id === 'kaiju') { KJ.tapT = 3.5; if ((KJ.mode === 'walk' || KJ.mode === 'stand') && KJ.rcd <= 0 && KJ.rq <= 0) KJ.rq = .7; if (!ride.phase) ride.offer = 14; }   // 轉頭盯著你，過一下轉過去對著島吼、噴火；提示列多一個「飛上去騎牠」
}
function focusPet(id) {
  if (state.flying || !RESIDENTS.some(r => r.id === id)) return;
  if (isMobile()) { ui.side = false; syncLayout(); }
  closeCard();
  follow = false;
  if (id === 'kaiju') {   // 從島這側看過去、仰角壓低，拍得到全身（仰角不低於旋轉控制的下限，飛到後才不會跳一下）
    const K = KJ, a = Math.atan2(-K.z, -K.x) + (Math.sin(K.h - Math.atan2(-K.x, -K.z)) > 0 ? -.6 : .6), d = (isMobile() ? 64 : 50) * (K.sd > .5 ? .85 : 1), lead = K.v * (K.sd > .5 ? 2.4 : 1.4);   // 游泳時只露出背鰭：靠近一點；游得快，對準牠前面一點，鏡頭飛到後牠才會游進畫面中間   // 斜斜地從牠前方那側看（正面左右對稱像雕像）
    const t = new THREE.Vector3(K.x + Math.sin(K.h) * lead, K.sd > .5 ? 1 : 9.5, K.z + Math.cos(K.h) * lead);
    flyTo({ pos: new THREE.Vector3(t.x + Math.cos(a) * d * .97, t.y + d * .235, t.z + Math.sin(a) * d * .97), target: t }, 1.4, () => petTap(id, true));
    return;
  }
  const t = petPos(id);
  if (id === 'dolphin') { const d = dolphins[0]; t.set(d.x + Math.sin(d.h) * d.v * 1.1, 0, d.z + Math.cos(d.h) * d.v * 1.1); }   // 鏡頭飛到的時候牠已經游到前面
  t.y += id === 'cat' ? .4 : .6;
  const off = camera.position.clone().sub(controls.target).setLength((isMobile() ? 1.3 : 1) * (id === 'dolphin' ? 16 : id === 'cat' ? 7 : 10));
  if (off.y < 4) off.y = 4;
  flyTo({ pos: t.clone().add(off), target: t }, 1.1, () => petTap(id, true));
}
function updatePets(dt, t) { updateDog(dt, t); updateCat(dt, t); updateCrabs(dt, t); updateBlob(dt, t); updateFish(dt); updateDolphins(dt, t); updateKaiju(dt, t); updateSplashes(dt); updateBall(dt); updateFishing(dt, t); updateDivers(dt, t); }

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
  for (const m of marqueeMats) m.color.setScalar(lerp(.95, 1.7, night));
  if (mazeArea) mazeArea.flies.material.opacity = night * .9;
  KJ_HALO.opacity = smooth((night - .3) / .5) * .75;
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
  const target = showNight ? 1165 : timeMode === 'auto' ? nowMin() : +timeMode;   // 放煙火：天色很快暗成藍調的夜（不到阿滿去睡覺那麼暗）
  let d = target - curMin;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  curMin = (curMin + (Math.abs(d) < .05 ? d : d * Math.min(1, dt * (showNight ? 1.3 : fw.show || ride.phase ? .7 : 2.4))) + 1440) % 1440;   // 煙火秀：天色很快暗下來，放完慢慢亮回去
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
  const P = PLACE[id], cab = CAB[id], aspect = innerWidth / innerHeight, k = aspect < .85 ? 1.5 : aspect < 1.2 ? 1.15 : 1;
  let t, d, el, dist;
  if (cab) {
    const V = CAB_VIEW[id] || { look: [0, 2.6, 0], dir: [0, 1], dist: 14, el: .5 }, F = cab.F, [lx, lz] = F.w(V.look[0], V.look[2]);
    const lookY = id === 'blocks' && heap ? Math.max(V.look[1], heap.top * .55) : V.look[1];
    t = new THREE.Vector3(lx, F.y + lookY, lz);
    d = new THREE.Vector3(V.dir[0] * Math.cos(F.ry) + V.dir[1] * Math.sin(F.ry), 0, -V.dir[0] * Math.sin(F.ry) + V.dir[1] * Math.cos(F.ry)).normalize();
    el = V.el; dist = V.dist * k;
  } else {
    const V = VIEW[id] || { dir: [0, 1], dist: 14, look: 1.5 };
    t = new THREE.Vector3(P.at[0], V.look, P.at[1]);
    d = new THREE.Vector3(V.dir[0], 0, V.dir[1]).normalize();
    el = .58; dist = V.dist * k;
  }
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
  if ((!flight.phase || ['board', 'touch', 'off'].includes(flight.phase)) && !ride.phase) controls.update();   // 騎巨獸也是：鏡頭由跟著你的彈簧鏡頭接手   // 飛行中由飛船鏡頭接手：旋轉控制會限制仰角和距離，看不到往上衝的船和太空裡的島
}

/* ---------- 介面狀態 ---------- */
const ui = { side: !isMobile(), sidePref: true, card: false, log: false, tab: 'places', logTab: 'log', full: false };
const state = { selected: null, nearGame: null, names: true, freeze: reduced, bird: false, inGame: false, inEnding: false, intro: false, flying: false };
let landed = false;
const uiLock = () => state.inGame || state.inEnding || state.flying;
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
  if (!P || (id === 'gate' && !gate.visible) || state.flying) return;
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
  if (state.flying) return;
  follow = false;
  if (state.bird) setBird(false, false);
  closeCard();
  flyTo(overviewPose());
}
function setBird(on, move = true) {
  if (state.flying) return;
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
  if (id === 'pier') return '老飛船・入口石碑';
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
    }).join('') + `<div class="sec" style="margin:18px 10px 4px">島民</div>` + RESIDENTS.map(r => `<button class="idx" data-pet="${r.id}" style="--c:${r.color}"><span class="no">${svg(r.icon)}</span><span><b>${r.name}</b><small>${r.sub}</small></span><span class="go">${svg('arrow')}</span></button>`).join('')
      + `<p class="side-note">紀錄直接讀這台裝置上的遊戲存檔：直接開遊戲玩、或從島上進去玩都算。</p>`;
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
    }).join('') + `<p class="side-note">三把到齊，隱嶼之門就會出現。${keyState.coin ? '你已經穿過那道門，25¢ 復活幣留在入口。' : ''}</p>`;
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
        : `<div class="empty">還沒有紀錄。</div>`;
      h += `<p class="note">機台上空的蜜蜂隊伍跟著最高分變長：每 2,500 分多一隻，現在 ${beeCount(r)} 隻（最多 ${BEE_MAX} 隻）。</p>`;
      h += `<div class="sec">鑰匙</div>${keyBox(KEY.copper)}`;
    } else if (id === 'blocks') {
      const b = r.blocks;
      h += (b.marathon || b.sprint || b.ultra || b.zen) ? `<div class="stats">${stat('MARATHON', b.marathon ? fmt(b.marathon) : '—', b.marathon ? 'hero' : 'hero dim')}${stat('SPRINT 40', b.sprint ? fmtTime(b.sprint) : '—', b.sprint ? '' : 'dim')}${stat('ULTRA 2:00', b.ultra ? fmt(b.ultra) : '—', b.ultra ? '' : 'dim')}${stat('ZEN', b.zen ? fmt(b.zen) : '—', b.zen ? '' : 'dim')}</div>`
        : `<div class="empty">還沒有紀錄。</div>`;
      h += `<p class="note">機台旁的方塊山跟著 MARATHON 長高：每 2,500 分一層，現在 ${heapLayers(r)} 層；金線那層是 ${fmt(MARATHON_TARGET)} 分。</p>`;
      h += `<div class="sec">鑰匙</div>${keyBox(KEY.jade)}`;
    } else if (id === 'maze') {
      const m = r.maze;
      h += m.cleared ? `<div class="stats">${stat('通過', `${m.cleared} / ${MAZE_LEVELS} 關`, 'hero')}${stat('星星', `★ ${m.stars} / ${MAZE_STAR_MAX}`)}${stat('零失誤', `${m.perfect} 關`)}${stat('章節', `${m.chapters.filter(c => c.done).length} / 6`)}</div>`
        : `<div class="empty">還沒有紀錄。</div>`;
      h += `<div class="sec">每通過一章，地上的迷宮長大一圈（現在 ${mazeSize(r)}×${mazeSize(r)}）</div><div class="chapters">${m.chapters.map((c, i) => `<div class="chap${c.done ? ' done' : ''}"><i></i>${i + 1}・${c.name}</div>`).join('')}</div>`;
    } else {
      h += `<div class="empty">這個遊戲還沒有接上島上的紀錄。</div>`;
    }
    actions = `<button class="btn primary" data-act="play">${svg('play')}開始玩</button><a class="btn" href="${g.url}" target="_blank" rel="noopener">${svg('arrow')}新分頁</a>`;
  } else if (id === 'pier') {
    const best = num('sanasai_flight_best'), fn = num('sanasai_fish_n');
    h += `<div class="sec">碼頭</div><div class="stats">${stat('開飛船最快', best ? fmtSec(best) : '—', best ? 'hero' : 'hero dim')}${stat('釣到的魚', `${fn} 條`)}${stat('最大的一條', fn ? `${num('sanasai_fish_best')} 公分` : '—', fn ? '' : 'dim')}</div>`;
    h += `<div class="sec">入口石碑</div>` + (steleRead ? `<p class="quote" style="--c:#5c6570">霓虹照不到的暗處，沉著第三把鑰匙。</p>` : `<div class="empty">石碑上刻了字，走近才看得清楚。</div>`);
    if (keyState.coin) h += `<div class="sec">25¢ 復活幣</div><p class="lead" style="margin-top:0">穿過隱嶼之門的紀念，從此留在碼頭邊。</p>`;
    actions = `<button class="btn primary" data-act="fly">${svg('pier')}開飛船</button><button class="btn" data-act="fish">${svg('wave')}去釣魚</button><button class="btn" data-act="walk">${svg('walk')}走到石碑前</button>`;
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
for (const it of logItems) if (typeof it.text === 'string') it.text = it.text.replace(/沙那賽/g, '隱嶼');   // 改名前寫下的日誌換成新島名
if (!Array.isArray(logItems)) logItems = [];
const TAG = { land: ['land', '登島'], rec: ['rec', '紀錄'], key: ['key', '鑰匙'], play: ['play', '遊玩'], gate: ['gate', '門'], ship: ['ship', '飛船'], pet: ['pet', '島民'] };
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
function applyRecords() { applyOverflow(); }

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
  sfx('key');
  checkKeys();
  renderAll();
}
function spawnGate() {
  if (gate.visible) return;
  gate.visible = true;
  gateLight.intensity = 6;
  sfx('gate');
  addPin('gate', `<span class="no">${PLACE.gate.no}</span>${PLACE.gate.name}`, PLACE.gate.color, [PLACE.gate.at[0], 6.6, PLACE.gate.at[1]], () => selectPlace('gate'));
  pickables.push(hitBox({ place: 'gate' }, [PLACE.gate.at[0], 3, PLACE.gate.at[1]], [5, 6, 1.2]));
  addLog('gate', '三鑰齊聚——隱嶼之門開啟');
  toast('三鑰齊聚——隱嶼之門開啟', 'gold');
  renderAll();
}
function openEnding() {
  state.inEnding = true;
  keyState.coin = true;
  saveKeys();
  addLog('gate', '穿過隱嶼之門，獲得 25¢ 復活幣');
  $('#ending').hidden = false;
  sfx('fanfare');
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
let hintKey = '', hintAction = null;
const DEFAULT_HINT = isTouch ? '點地面走路・點機台看介紹' : '點地面走路・點機台看介紹・方向鍵也能走';
function setHint(key, text, cls = '', action = null) {
  if (key === hintKey) return;
  hintKey = key; hintAction = action;
  hintText.textContent = text;
  hintEl.className = 'hint panel ' + cls;
}
hintEl.addEventListener('click', () => hintAction && hintAction());

/* ---------- 接近偵測 ---------- */
function updateProximity() {
  if (ride.phase) {   // 騎巨獸
    const K = KJ, P = ride.phase;
    if (P !== 'ride') setHint('r:' + P, P === 'charge' ? '變身！' : P === 'fly' || P === 'hover' ? '飛過去…' : P === 'enter' ? '坐進駕駛艙…' : P === 'boot' ? '開機中…' : P === 'eject' ? '彈射！' : '回島上…', 'prompt');
    else if (ride.wantOff) setHint('r:off', '等牠這一招做完就跳下來', 'prompt');
    else if (fw.show) setHint('r:show', '煙火秀！拖曳可以換角度', 'prompt');
    else if (K.mode === 'swim' || K.mode === 'dive' || K.mode === 'rise' || K.sd > .5) setHint('r:swim', '游泳中：回淺水區才能出招', 'prompt');
    else if (K.chg >= 1) setHint('r:ready', '蓄滿了！放開就是合體大招', 'prompt');
    else if (K.chg > 0) setHint('r:chg', '蓄力中…背鰭一段段亮起來', 'prompt');
    else if (isMobile()) setHint('r:ride', isTouch ? '點畫面往那裡噴火・按住「吼」蓄力・拖曳轉鏡頭' : '點畫面噴火・按住空白鍵蓄力・拖曳轉鏡頭', 'prompt');   // 手機：提示在上面，放得下一整句
    else { const b = Math.floor(ride.t / 5) % 2; setHint('r:ride' + b, b ? (isTouch ? '搖桿走・按住「吼」蓄力' : '方向鍵走・按住空白鍵蓄力') : '點畫面噴火・拖曳轉鏡頭', 'prompt'); }   // 電腦：提示在按鈕列正上方，兩句短的輪流（其他快捷鍵寫在按鈕上；一開始先秀操作說明卡）
    return;
  }
  if (flight.phase) {
    const F = flight;
    if (F.phase === 'pilot') setHint(F.far ? 'far' : 'pilot', F.far ? '飛太遠了，自動轉回島' : isTouch ? '左下搖桿或拖曳畫面轉向・往上推升高・按「降落」回碼頭' : '方向鍵轉向・↑↓ 升降・空白鍵加速・Esc 降落', 'prompt');
    else if (['climb', 'hyper', 'descent'].includes(F.phase)) setHint('f:space', isTouch ? '衝上太空再回來…（點這裡跳過）' : '衝上太空再回來…（Esc 跳過）', 'prompt', skipFlight);
    else setHint(F.phase === 'board' || F.phase === 'lift' ? 'f:up' : 'f:down', F.phase === 'board' || F.phase === 'lift' ? '起飛中…' : '回碼頭中…', 'prompt');
    return;
  }
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
  const D = dog, dogFree = night <= .85 && !['sleep', 'bed', 'fetch', 'bring'].includes(D.state);
  const catNear = !cat.perch && !cat.jump && dist(cat.g.position.x, cat.g.position.z) < 2.4 && cat.state !== 'toFish' && cat.state !== 'eat';
  if (fishing.phase === 'wait') setHint('f:wait', isTouch ? '等魚上鉤：浮標沉下去再點畫面' : '等魚上鉤：浮標沉下去再點畫面或按空白鍵', 'lore', reel);
  else if (fishing.phase === 'bite') setHint('f:bite', '上鉤了！快點這裡', 'prompt', reel);
  else if (fishing.phase) setHint('f:' + fishing.phase, fishing.phase === 'cast' ? '拋竿中…' : '收線…', 'lore');
  else if (state.nearGame) setHint('g:' + state.nearGame, isTouch ? `點這裡開始玩《${GAME[state.nearGame].name}》` : `按 Enter（或點這裡）開始玩《${GAME[state.nearGame].name}》`, 'prompt', () => enterGame(GAME[state.nearGame]));   // 站在門口一律先給「開始玩」，蜜蜂提示不能蓋掉
  else if (divers.some(d => d.on)) setHint('bees', isTouch ? '蜜蜂俯衝過來了！點這裡揮劍' : '蜜蜂俯衝過來了！按空白鍵（或點這裡）揮劍', 'prompt', swing);
  else if (ride.offer > 0 && !state.freeze) setHint('r:offer', isTouch ? '點這裡飛上去騎牠' : '按 Enter（或點這裡）飛上去騎牠', 'prompt', startRide);   // 點過巨獸：可以飛上去
  else if (carry.color !== null && catNear) setHint('feed', '點這裡餵花捲', 'prompt', feedCat);
  else if (dist(RAMP_PTS[0][0], RAMP_PTS[0][2]) < 1.6) setHint('board', isTouch ? '點這裡登船，開飛船繞島' : '按 Enter（或點這裡）登船，開飛船繞島', 'prompt', startFlight);
  else if (carry.color === null && dist(FISH_SPOT[0], FISH_SPOT[1]) < 1.3) setHint('fishspot', isTouch ? '點這裡釣魚' : '按 Enter（或點這裡）釣魚', 'prompt', startFishing);
  else if (nearStele) setHint('stele', '石碑：「霓虹照不到的暗處，沉著第三把鑰匙。」', 'lore');
  else if (!keyState.crystal && dc < 6.5) setHint('dark', dc < 3 ? '岩洞深處有什麼在發光……' : '這裡好暗……', 'lore');
  else if (gate.visible && !keyState.coin && dist(PLACE.gate.at[0], PLACE.gate.at[1]) < 5) setHint('gate', '隱嶼之門──走進去', 'prompt');
  else if (carry.color !== null) setHint('carry', '手上有魚：花捲聞到了，正跑過來', 'lore');
  else if (onPier(ax, az)) setHint('pier', '碼頭盡頭可以釣魚（點這裡走過去）', 'lore', startFishing);   // 碼頭上先講釣魚，阿滿跟過來也不蓋掉
  else if (dogFree && fetchN < 3 && dist(D.g.position.x, D.g.position.z) < 3.2) setHint('dog', '點阿滿，丟球給牠撿', '', throwBall);
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
  sndIdle(true);
  frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch (e) {} }, { once: true });
}
function closeGame() {
  if (!state.inGame) return;
  state.inGame = false;
  overlay.hidden = true;
  frame.src = 'about:blank';
  sndIdle(false);
  const mins = Math.round((Date.now() - gameStart) / 60000);
  if (mins >= 1) addLog('play', `在《${GAME[gameId].name}》待了 ${mins} 分鐘`);
  refresh();
}
$('#btn-back').addEventListener('click', closeGame);

/* ---------- 導覽說明 ---------- */
const INTRO = [
  ['三個遊戲，一座島', '小蜜蜂、Blocks Pro、迷宮球各有一台大型機台，遊戲會從螢幕裡溢出來。點機台或清單看介紹，按「開始玩」就進遊戲。島上住著柴犬阿滿、三花貓花捲、方塊小傢伙柑仔丁和幾隻寄居蟹，海裡有魚和海豚。'],
  ['分身會替你走過去', isTouch ? '點地面，分身就走到那裡；也可以用左下角的搖桿。單指拖曳轉視角，雙指縮放。' : '點地面，分身就走到那裡；方向鍵或 WASD 也能走。拖曳轉視角，滾輪縮放。'],
  ['島會記得你的紀錄', '成績越好，溢出來的越多：小蜜蜂分數越高，飛出機台的蜜蜂越多；Blocks 的方塊山跟著分數長高；迷宮球每通過一章，地上的迷宮就長大一圈。'],
  ['三把鑰匙', '銅鑰匙看小蜜蜂，玉鑰匙看 Blocks Pro，水晶鑰匙藏在島上的暗處。三把到齊，隱嶼之門就會出現。'],
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
  const el = e.target.closest('[data-place], [data-getkey], [data-act], [data-pet]');
  if (!el) return;
  if (el.dataset.pet) return focusPet(el.dataset.pet);
  if (el.dataset.getkey) return goToKey(el.dataset.getkey);
  if (el.dataset.place) return selectPlace(el.dataset.place);
  const act = el.dataset.act, id = state.selected;
  if (act === 'play') enterGame(GAME[id]);
  if (act === 'fly') startFlight();
  if (act === 'fish') startFishing();
  if (act === 'walk') { walkTo(STELE[0] + .6, STELE[1] + 1.4, { follow: true, mark: true }); if (isMobile()) closeCard(); }
  if (act === 'gate') { walkTo(PLACE.gate.at[0], PLACE.gate.at[1], { follow: true, mark: true }); if (isMobile()) closeCard(); }
});

/* 點 3D 場景：點建築＝看介紹，點地面＝走過去 */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  dragging = true;
  if (flight.phase === 'pilot') Object.assign(steer, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });   // 開飛船：拖曳畫面轉向
  else if (ride.phase) ridePointer('down', e);   // 開巨獸：拖曳轉鏡頭、點一下噴火
  else if (fly) { fly = null; controls.enabled = true; }
});
addEventListener('pointermove', e => {
  if (ride.phase) ridePointer('move', e);
  if (e.pointerId !== steer.id) return;
  steer.x = clamp((e.clientX - steer.x0) / 90, -1, 1);
  steer.y = clamp((e.clientY - steer.y0) / 90, -1, 1);
});
addEventListener('pointerup', e => {
  dragging = false;
  if (ride.phase || rp.size) ridePointer('up', e);
  if (e.pointerId === steer.id) Object.assign(steer, { id: null, x: 0, y: 0 });
  if (!down || e.pointerId !== down.id) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dtm = performance.now() - down.t;
  down = null;
  if (moved <= 8 && dtm <= 650 && e.target === renderer.domElement && (fishing.phase === 'wait' || fishing.phase === 'bite')) return reel();   // 釣魚時點畫面任何地方都是拉竿
  if (moved > 8 || dtm > 650 || uiLock() || e.target !== renderer.domElement) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  if (hit) return hit.object.userData.pet ? petTap(hit.object.userData.pet) : selectPlace(hit.object.userData.place);
  const g = ray.intersectObjects(groundPick, false)[0];
  if (g) walkTo(g.point.x, g.point.z, { follow: true, mark: true });
});
addEventListener('pointercancel', e => { dragging = false; down = null; if (rp.size) ridePointer('cancel', e); if (e.pointerId === steer.id) Object.assign(steer, { id: null, x: 0, y: 0 }); });

/* 鍵盤 */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (ride.phase) rideExit();
    else if (flight.phase) skipFlight();
    else if (state.inGame) closeGame();
    else if (state.intro) closeIntro();
    else if (ui.card) closeCard();
    else if (ui.log) openLog(false);
    else if (isMobile() && ui.side) openSide(false);
    return;
  }
  if (flight.phase === 'pilot') {   // 開飛船：方向鍵／WASD 轉向升降、空白鍵加速
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) { keysDown[k] = true; e.preventDefault(); }
    return;
  }
  if (ride.phase) {   // 開巨獸：方向鍵／WASD 走、空白鍵吼（按住蓄力）、F 跺腳、R 放煙火、C 換鏡頭
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keysDown[k] = true; e.preventDefault(); }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) rideRoarDown(); }
    else if (k === 'f' && !e.repeat) rideStomp();
    else if (k === 'r' && !e.repeat) rideWorks();
    else if (k === 'c' && !e.repeat && ride.phase === 'ride') rideView();
    return;
  }
  if (uiLock() || state.intro) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    keysDown[k] = true;
    e.preventDefault();
  }
  const onStage = document.activeElement === body || document.activeElement === renderer.domElement;
  if ((e.key === 'Enter' || e.code === 'Space') && onStage && (fishing.phase === 'wait' || fishing.phase === 'bite')) { e.preventDefault(); return reel(); }
  if (e.key === 'Enter' && state.nearGame && onStage) enterGame(GAME[state.nearGame]);
  else if (e.key === 'Enter' && hintKey === 'board' && onStage) startFlight();
  else if (e.key === 'Enter' && hintKey === 'fishspot' && onStage) startFishing();
  else if (e.key === 'Enter' && hintKey === 'r:offer' && onStage) startRide();
  if (e.code === 'Space' && onStage) { e.preventDefault(); swing(); }
  if (DEBUG) {
    if (e.key === '7') { ls.set('bee_hi_normal', String(BEE_TARGET + 500)); toast('DEBUG：偽造小蜜蜂紀錄'); refresh(); }
    if (e.key === '8') { ls.set('tetris2_best_marathon', String(MARATHON_TARGET + 500)); toast('DEBUG：偽造 Blocks 紀錄'); refresh(); }
    if (e.key === '6') { ls.set('maze_cleared', '14'); ls.set('maze_stars', JSON.stringify(Object.fromEntries([...Array(14)].map((_, i) => [i, 3])))); toast('DEBUG：偽造迷宮球紀錄'); refresh(); }
    if (e.key === '9') { const [x, z] = polar(-2.36, .78); avatar.position.set(x, groundY(x, z), z); startFollow(); toast('DEBUG：傳送到暗處附近'); }
  }
});
addEventListener('keyup', e => { keysDown[e.key.toLowerCase()] = false; if (e.code === 'Space' && ride.phase) rideRoarUp(); });
addEventListener('blur', () => { for (const k in keysDown) keysDown[k] = false; rideRoarCancel(); });

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

/* ---------- 開飛船：走上坡道起飛後換你駕駛，穿過三台機台上空的光圈；三個都過就一鏡到底衝上太空、跳光速、降落回碼頭 ---------- */
const flight = { phase: null, t: 0, walking: false, yaw: Math.PI, bank: 0, pitch: 0, speed: 0, boostBtn: false, far: false, clock: 0, sec: -1, done: false, jumped: false, from: new THREE.Vector3(), route: null, dur: 1, kl: 0 };
const steer = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
const V3 = a => new THREE.Vector3(...a);
const FLY = { board: 1.4, lift: 2.2, climb: 7, hyper: 1.1, descent: 9, touch: 2.6, off: 1.3 };
const DESCENT = new THREE.CatmullRomCurve3([[-34, 300, -240], [-20, 180, -150], [-9, 80, -68], [-3, 26, -20], [.5, 12, 2], [3.4, 6.5, 13], [4.1, 3, 17.2], [SHIP.x, SHIP.y, SHIP.z]].map(V3), false, 'centripetal');   // 跳光速回來：從北方高空一路俯衝、減速，直接停進碼頭
const _fp = new THREE.Vector3(), _ft = new THREE.Vector3(), _cp = new THREE.Vector3(), _cl = new THREE.Vector3();
const fmtSec = s => `${Math.floor(s / 60)}:${pad2(Math.floor(s % 60))}`;
const rings = GAMES.map(g => {   // 三台機台上空各一個霓虹光圈，會轉過來面對飛船（從哪個方向都穿得過）；下面一道光柱，遠遠就看得到
  const F = cabFrame(g), col = hexNum(g.color);
  const c = new THREE.Vector3(g.at[0], F.y + 10.5, g.at[1]);
  const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .55 });
  const m = new THREE.Mesh(new THREE.TorusGeometry(3.2, .18, 8, 44), mat);
  m.position.copy(c);
  const h = c.y - 3.2 - (F.y + 5.3);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.scale.y = h;
  beam.position.set(c.x, F.y + 5.3 + h / 2, c.z);
  m.visible = beam.visible = false;
  scene.add(m, beam);
  return { g, c, m, mat, beam, done: false, bits: [new THREE.MeshBasicMaterial({ color: col }), new THREE.MeshBasicMaterial({ color: 0xffffff })] };
});
const hud = $('#flight-hud'), hudTime = $('#fh-time');
$('#fh-rings').innerHTML = rings.map(R => `<i style="--c:${R.g.color}" title="${esc(R.g.name)}上空"></i>`).join('');
for (const type of ['pointerdown', 'pointerup', 'pointerleave', 'pointercancel']) $('#fh-boost').addEventListener(type, () => { flight.boostBtn = type === 'pointerdown'; });
$('#fh-land').addEventListener('click', () => landNow());
const warpCv = document.createElement('canvas');
warpCv.id = 'warp';
$('#app').appendChild(warpCv);
const warpStars = Array.from({ length: 180 }, () => ({ a: rnd() * TAU, r: .03 + rnd() * .5, v: .4 + rnd() * .9, o: .4 + rnd() * .6 }));
function drawWarp(k) {   // 星光從中心拉長成線，最亮時白光一閃
  const dpr = Math.min(2, devicePixelRatio || 1), w = warpCv.width = innerWidth * dpr, h = warpCv.height = innerHeight * dpr, x = warpCv.getContext('2d');
  const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  if (!reduced) {
    x.lineCap = 'round';
    for (const s of warpStars) {
      const r1 = R * (s.r + k * k * 1.6 * s.v), r0 = Math.max(0, r1 - R * (.02 + k * .5 * s.v));
      x.strokeStyle = `rgba(220,240,255,${Math.min(1, k * 2.2) * s.o})`;
      x.lineWidth = (1 + k * 2.5 * s.v) * dpr;
      x.beginPath();
      x.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
      x.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
      x.stroke();
    }
  }
  const flash = smooth(1 - Math.abs(k - .55) / .14);
  if (flash > 0) { x.fillStyle = `rgba(236,246,255,${flash * .92})`; x.fillRect(0, 0, w, h); }
}
const baseFov = () => innerWidth / innerHeight < .85 ? 48 : 38;
/* 一鏡到底的鏡頭：位置和看的點都記成「相對於船」，換構圖時用彈簧慢慢滑過去（起步和停下都是緩的），船再快也不會甩掉鏡頭 */
const rig = { off: new THREE.Vector3(), look: new THREE.Vector3(), vo: new THREE.Vector3(), vl: new THREE.Vector3() }, _ro = new THREE.Vector3(), _rl = new THREE.Vector3(), _nose = new THREE.Vector3(), _srt = new THREE.Vector3(), _fh = new THREE.Vector3();
function rigFrom(A = ship.position) {   // A：鏡頭跟著誰（開飛船＝船，騎巨獸＝你）
  rig.off.copy(camera.position).sub(A);
  rig.look.copy(controls.target).sub(A);
  rig.vo.set(0, 0, 0); rig.vl.set(0, 0, 0);
}
function rigTo(off, look, dt, w = 2.4, A = ship.position) {
  const step = (x, v, target) => { v.addScaledVector(_c3.copy(target).sub(x), w * w * dt).multiplyScalar(Math.max(0, 1 - 2 * w * dt)); x.addScaledVector(v, dt); };
  step(rig.off, rig.vo, off);
  step(rig.look, rig.vl, look);
  camera.position.copy(A).add(rig.off);
  controls.target.copy(A).add(rig.look);
  camera.lookAt(controls.target);
}
const _c3 = new THREE.Vector3();
function shipAxes() {   // 船頭方向、右舷、水平航向
  _nose.set(0, 0, -1).applyQuaternion(ship.quaternion);
  _srt.crossVectors(_nose, camera.up).normalize();
  _fh.set(-Math.sin(flight.yaw), 0, -Math.cos(flight.yaw));
}
function poseAlong(C, u, dt) {   // 照路線擺船：位置、航向跟著切線，俯仰和側傾慢慢跟，不會瞬間翻過去
  C.getPointAt(u, _fp); C.getTangentAt(u, _ft);
  let dy = Math.atan2(-_ft.x, -_ft.z) - flight.yaw;
  while (dy > Math.PI) dy -= TAU;
  while (dy < -Math.PI) dy += TAU;
  const step = dy * Math.min(1, dt * 4);
  flight.yaw += step;
  flight.bank = lerp(flight.bank, clamp(step / Math.max(dt, 1e-3) * .5, -.55, .55), Math.min(1, dt * 3));
  flight.pitch = lerp(flight.pitch, Math.atan2(_ft.y, Math.hypot(_ft.x, _ft.z)) * .7, Math.min(1, dt * 5));
  ship.position.copy(_fp);
  ship.rotation.set(flight.pitch, flight.yaw, flight.bank);
}
/* 衝上太空再回來用的東西：一層雲（升空和回來時各穿過一次）、船頭的火光、火光尾巴 */
const cloudDeck = new THREE.Group();
{
  const r = mulberry32(77), cm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9aa6b5, flatShading: true, roughness: 1, transparent: true, opacity: .92 });   // 底部偏灰藍，從下面看才像雲
  for (let i = 0; i < 18; i++) {
    const L = [], a = r() * TAU, R = 4 + r() * 34, y = r() * 18;
    for (let k = 0; k < 4; k++) part('ico1', [Math.cos(a) * R + (k - 1.5) * 3.2, y + r() * 2, Math.sin(a) * R + (r() - .5) * 3], [5 + r() * 4, 3 + r() * 2, 4.5 + r() * 3], 0xffffff, { into: L });
    cloudDeck.add(merged(L, cm, false));
  }
  cloudDeck.visible = false;
  scene.add(cloudDeck);
}
const fireShell = glowSprite('rgba(255,244,214,1)', 'rgba(255,118,30,.7)', 7);   // 船頭的火球（橘黃色光暈）
scene.remove(fireShell);
fireShell.position.set(0, -.2, -2.4);   // 船頭前方（局部 -z）
fireShell.visible = false;
ship.add(fireShell);
const trail = [];
let trailMat = null;
function emitTrail(p, heat) {   // 火光尾巴：一顆顆發光的球留在後面慢慢散掉
  let q = trail.find(o => o.life <= 0);
  if (!q) {
    if (trail.length >= 70) return;
    if (!trailMat) { const g = glowSprite('rgba(255,214,140,1)', 'rgba(255,96,24,.55)', 1); trailMat = g.material; scene.remove(g); }
    q = { spr: new THREE.Sprite(trailMat.clone()), life: 0, max: .9, size: 3 };
    scene.add(q.spr);
    trail.push(q);
  }
  q.spr.position.set(p.x + (rnd() - .5) * 1.4, p.y + (rnd() - .5) * 1.4, p.z + (rnd() - .5) * 1.4);
  q.life = q.max; q.size = 1.2 + heat * 2.2; q.spr.visible = true;
}
function updateTrail(dt) {
  for (const q of trail) {
    if (q.life <= 0) continue;
    q.life -= dt;
    const f = Math.max(0, q.life / q.max);
    q.spr.scale.setScalar(q.size * (1.6 - f * .6));
    q.spr.material.opacity = f * .75;
    if (q.life <= 0) q.spr.visible = false;
  }
}
function spaceView(sp) {   // sp：0＝平常的天空，1＝太空（黑天、星星）。天空和星星跟著鏡頭走，霧跟著高度拉遠，島才不會被霧吃掉
  skyDome.position.copy(camera.position);
  stars.position.copy(camera.position);
  const h = Math.max(0, camera.position.y - 40);
  scene.fog.near = 85 + h * .9;
  scene.fog.far = 250 + h * 1.6;
  if (sp <= 0) return;
  skyMat.uniforms.top.value.lerp(_c1.setHex(0x01020a), sp);
  skyMat.uniforms.horizon.value.lerp(_c2.setHex(0x060a1c), sp);
  scene.fog.color.copy(skyMat.uniforms.horizon.value);
  stars.material.opacity = Math.max(stars.material.opacity, sp);
  if (sp > .4) sunDisc.visible = moonDisc.visible = false;
}
function spaceReset() {
  skyDome.position.set(0, 0, 0);
  stars.position.set(0, 0, 0);
  scene.fog.near = 85; scene.fog.far = 250;
  camera.up.set(0, 1, 0);
  fireShell.visible = cloudDeck.visible = false;
  warpCv.classList.remove('on');
  body.classList.remove('space');
}
function startFlight() {
  if (flight.phase || uiLock() || state.intro) return;
  const [fx, , fz] = RAMP_PTS[0];
  if (Math.hypot(avatar.position.x - fx, avatar.position.z - fz) > .5) {   // 先走到坡道腳下
    if (walkTo(fx, fz, { follow: true, mark: true, onArrive: startFlight }) && isMobile()) closeCard();
    return;
  }
  endFishing();
  closeCard();
  if (isMobile()) { ui.side = false; ui.log = false; syncLayout(); }
  if (state.bird) setBird(false, false);
  walk.path = null; follow = false; fly = null; controls.enabled = false;
  state.flying = true;
  body.classList.add('flying', 'autopilot');
  Object.assign(flight, { phase: 'board', t: 0, walking: true, yaw: Math.PI, bank: 0, pitch: 0, done: false });
  avatar.rotation.y = Math.PI / 2;   // 面向飛船
}
function setRings(show) {
  for (const R of rings) { R.done = false; R.mat.opacity = .55; R.m.rotation.set(0, Math.atan2(SHIP.x - R.c.x, SHIP.z - R.c.z), 0); R.m.visible = R.beam.visible = show; R.m.scale.setScalar(1); }
  renderHud();
}
function renderHud() { $$('#fh-rings i').forEach((el, i) => el.classList.toggle('on', rings[i].done)); }
function ringDone(R) {
  R.done = true;
  R.mat.opacity = 1;
  R.beam.visible = false;
  pixelBurst(R.c, R.bits);
  renderHud();
  sfx('ring', null, rings.every(q => q.done));
  const n = rings.filter(q => q.done).length;
  if (n < rings.length) return toast(`光圈 ${n}/3：${R.g.name}上空`);
  const tm = flight.clock, best = num('sanasai_flight_best'), rec = !best || tm < best;
  if (rec) ls.set('sanasai_flight_best', String(Math.round(tm * 10) / 10));
  toast(`三個光圈全過！${fmtSec(tm)}${rec ? '・新紀錄' : `・最快 ${fmtSec(best)}`}`, 'gold');
  addLog('ship', `開飛船穿過三個光圈：${fmtSec(tm)}${rec ? '（最快紀錄）' : ''}`);
  flight.done = true;
  nextFlight('climb');
}
function landNow() {   // 按「降落」：從現在的位置自動飛回碼頭
  const F = flight;
  if (F.phase !== 'pilot') return skipFlight();
  const p = ship.position.clone(), ahead = p.clone().add(V3([-Math.sin(F.yaw) * 7, .5, -Math.cos(F.yaw) * 7]));
  const pts = p.z > 12 ? [p, ahead, V3([SHIP.x, 6, SHIP.z + 9]), V3([SHIP.x, 3.4, SHIP.z])] : [p, ahead, V3([SHIP.x, 10, 4]), V3([SHIP.x, 6, 13.5]), V3([SHIP.x, 3.4, SHIP.z])];
  F.route = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  F.dur = Math.max(3, F.route.getLength() / 6);
  F.kl = 0;
  nextFlight('return');
}
function skipFlight() {
  const F = flight, ph = F.phase;
  if (ph === 'pilot') landNow();
  else if (ph === 'return') nextFlight('touch');
  else if (['climb', 'hyper', 'descent'].includes(ph)) {   // 看太空那段可以按 Esc：直接到碼頭上空降落
    spaceReset();
    ship.position.set(SHIP.x, SHIP.y + 2, SHIP.z);
    Object.assign(F, { yaw: Math.PI, pitch: 0, bank: 0 });
    ship.rotation.set(0, Math.PI, 0);
    const v = viewFor('pier');   // 鏡頭直接切到碼頭，不要從太空一路飛回來
    camera.position.copy(v.pos);
    controls.target.copy(v.target);
    camera.lookAt(controls.target);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
    nextFlight('touch');
  }
}
function nextFlight(phase) {
  const F = flight;
  F.phase = phase; F.t = 0;
  body.classList.toggle('autopilot', phase !== 'pilot');   // 只有自己開的時候才顯示搖桿
  if (phase === 'pilot') { Object.assign(F, { clock: 0, sec: -1, speed: 6, pitch: 0 }); setRings(true); hud.hidden = false; }
  if (phase === 'climb' || phase === 'return') { hud.hidden = true; for (const R of rings) R.beam.visible = false; }
  if (phase === 'climb') {   // 從穿過第三個光圈的地方，順著原本的方向往前、弧線拉起來衝上太空，到頂再擺平
    const p = ship.position, f = _fh.set(-Math.sin(F.yaw), 0, -Math.cos(F.yaw)).clone(), at = (h, v) => p.clone().addScaledVector(f, h).add(_c3.set(0, v, 0));
    F.route = new THREE.CatmullRomCurve3([p.clone(), at(14, 3), at(28, 22), at(36, 80), at(44, 220), at(70, 420), at(150, 520), at(260, 540)], false, 'centripetal');
    F.len = F.route.getLength();
    F.v0 = Math.max(F.speed, 6);
    F.acc = (F.len - F.v0 * FLY.climb) / FLY.climb ** 3;   // 走過的距離＝v0·t＋acc·t³：起步跟剛才的速度一樣，越飛越快
    cloudDeck.position.copy(at(36, 0)).setY(72);
    cloudDeck.visible = true;
    rigFrom();
  }
  if (phase === 'hyper') { F.jumped = false; warpCv.classList.add('on'); }
  if (phase === 'descent') {   // 白光最亮的那一刻換到北方高空（白光遮住這一次切換）
    F.route = DESCENT;
    DESCENT.getTangentAt(0, _ft);
    Object.assign(F, { yaw: Math.atan2(-_ft.x, -_ft.z), pitch: Math.atan2(_ft.y, Math.hypot(_ft.x, _ft.z)) * .7, bank: 0, pier: viewFor('pier') });
    poseAlong(DESCENT, 0, 1 / 60);
    rig.off.copy(_c3.crossVectors(_ft, camera.up).normalize()).multiplyScalar(isMobile() ? 16 : 12).addScaledVector(_ft, 4).add(_c3.set(0, isMobile() ? 12 : 9, 0));
    rig.look.set(0, 0, 0); rig.vo.set(0, 0, 0); rig.vl.set(0, 0, 0);
    rigTo(rig.off, rig.look, 1 / 60);
    cloudDeck.position.set(-10, 64, -64);
    cloudDeck.visible = true;
    setRings(false);   // 回程會飛過島，穿過的光圈先收起來
    warpCv.classList.remove('on');   // 留下最後一格白光，靠 CSS 慢慢淡掉
  }
  body.classList.toggle('space', ['climb', 'hyper', 'descent'].includes(phase));   // 太空那段把名牌藏起來
  if (phase === 'touch') { spaceReset(); F.from.copy(ship.position); flyTo(viewFor('pier'), 1.8); setRings(false); }
}
function alongRamp(k, back) {   // 沿坡道折線走（照長度分配時間）
  const P = back ? [...RAMP_PTS].reverse() : RAMP_PTS, L = P.slice(1).map((q, i) => Math.hypot(q[0] - P[i][0], q[1] - P[i][1], q[2] - P[i][2]));
  let s = k * L.reduce((a, b) => a + b, 0), i = 0;
  while (i < L.length - 1 && s > L[i]) { s -= L[i]; i++; }
  const f = Math.min(1, s / L[i]);
  avatar.position.set(lerp(P[i][0], P[i + 1][0], f), lerp(P[i][1], P[i + 1][1], f), lerp(P[i][2], P[i + 1][2], f));
}
function poseShip(pos, tan, dt) {   // 自動飛行：船頭朝前進方向；轉彎時往內側傾、爬升時抬頭
  let dy = Math.atan2(-tan.x, -tan.z) - flight.yaw;
  while (dy > Math.PI) dy -= TAU;
  while (dy < -Math.PI) dy += TAU;
  const step = dy * Math.min(1, dt * 4);
  flight.yaw += step;
  flight.bank = lerp(flight.bank, clamp(step / Math.max(dt, 1e-3) * .5, -.55, .55), Math.min(1, dt * 3));
  ship.position.copy(pos);
  ship.rotation.set(Math.atan2(tan.y, Math.hypot(tan.x, tan.z)) * .7, flight.yaw, flight.bank);
}
function chaseCam(dt, rate, back = isMobile() ? 12.5 : 9, up = isMobile() ? 5.2 : 3.8) {   // 鏡頭跟在船後上方、稍微偏右舷（手機直立畫面拉遠一點）
  const s = Math.sin(flight.yaw), c = Math.cos(flight.yaw), p = ship.position, k = Math.min(1, dt * rate);
  camera.position.lerp(_cp.set(p.x + s * back + c * 1.1, p.y + up, p.z + c * back - s * 1.1), k);
  controls.target.lerp(_cl.set(p.x - s * 6, p.y + .4, p.z - c * 6), k);
  camera.lookAt(controls.target);
}
function pilotInput() {   // 鍵盤、左下搖桿、拖曳畫面三種都能開
  const kx = (keysDown.d || keysDown.arrowright ? 1 : 0) - (keysDown.a || keysDown.arrowleft ? 1 : 0);
  const ky = (keysDown.w || keysDown.arrowup ? 1 : 0) - (keysDown.s || keysDown.arrowdown ? 1 : 0);
  return { x: clamp(kx + joy.x + steer.x, -1, 1), y: clamp(ky - joy.y - steer.y, -1, 1), boost: !!(keysDown[' '] || flight.boostBtn) };
}
function endFlight() {
  const F = flight;
  Object.assign(F, { phase: null, walking: false });
  state.flying = false;
  body.classList.remove('flying', 'autopilot');
  hud.hidden = true;
  setRings(false);
  avatar.position.set(RAMP_PTS[0][0], DECK_Y, RAMP_PTS[0][2]);
  avatar.rotation.y = Math.PI;
  controls.enabled = true;
  const n = num('sanasai_flights') + 1;
  ls.set('sanasai_flights', String(n));
  if (!F.done) addLog('ship', `開飛船繞島（第 ${n} 趟）`);
  toast('回到碼頭了');
}
function updateFlight(dt) {
  const F = flight;
  updateTrail(dt);
  if (!F.phase) return;
  F.t += dt;
  if (F.phase === 'board' || F.phase === 'off') {
    const k = Math.min(1, F.t / (F.phase === 'board' ? FLY.board : FLY.off));
    alongRamp(k, F.phase === 'off');
    avatar.rotation.y = F.phase === 'board' ? Math.PI / 2 : -Math.PI / 2;
    if (k < 1) return;
    if (F.phase === 'off') return endFlight();
    avatar.visible = false; mePin.obj.visible = false; F.walking = false;
    if (dog.state === 'follow' || Math.hypot(dog.g.position.x - avatar.position.x, dog.g.position.z - avatar.position.z) < 6) bubble(dog.g, '汪汪！', 1.25);
    nextFlight('lift');
  } else if (F.phase === 'lift') {   // 收坡道、垂直升空
    const k = Math.min(1, F.t / FLY.lift);
    ramp.scale.x = Math.max(.02, 1 - k / .3);
    ship.position.set(SHIP.x, lerp(SHIP.y, 5, smooth(k)), SHIP.z);
    ship.rotation.set(Math.sin(k * Math.PI) * .06, Math.PI, Math.sin(F.t * 6) * .02 * (1 - k));
    chaseCam(dt, 1.2);
    if (k >= 1) nextFlight('pilot');
  } else if (F.phase === 'pilot') {   // 你開：船一直往前，轉向、升降、加速
    F.clock += dt;
    const inp = pilotInput(), p = ship.position, r = Math.hypot(p.x, p.z);
    F.speed = lerp(F.speed, inp.boost ? 16 : 8, Math.min(1, dt * 2));
    let turn = -inp.x * 1.6;
    F.far = r > 110;
    if (F.far) {   // 飛太遠：自動轉回島
      let d = Math.atan2(p.x, p.z) - F.yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      turn = clamp(d * 1.5, -1.4, 1.4);
    }
    else {   // 靠近光圈時稍微幫你對準（你轉向還是比較大）
      let near = null, nd = 11;
      for (const R of rings) { const d = R.done ? 99 : Math.hypot(R.c.x - p.x, R.c.z - p.z); if (d < nd) { nd = d; near = R; } }
      if (near) {
        let d = Math.atan2(-(near.c.x - p.x), -(near.c.z - p.z)) - F.yaw;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        if (Math.abs(d) < .9) { turn += clamp(d * 1.2, -.8, .8); p.y += clamp(near.c.y - p.y, -1, 1) * 2 * dt; }
      }
    }
    F.yaw += turn * dt;
    p.x -= Math.sin(F.yaw) * F.speed * dt;
    p.z -= Math.cos(F.yaw) * F.speed * dt;
    p.y += inp.y * 6 * dt;
    let floor = r < 21 ? 8.6 : 2.4;   // 島上空要高過機台和樹，海上可以貼著飛
    for (const I of FAR_ISLES) { const d = Math.hypot(p.x - I.x, p.z - I.z); if (d < I.r + 6) floor = Math.max(floor, lerp(I.top, 2.4, smooth((d - I.r) / 6))); }   // 飛到遠島上空自動拉高
    floor = Math.max(floor, kjFloor(p.x, p.z));   // 經過外海的巨獸也是：從牠頭上飛過去
    if (p.y < floor) p.y = lerp(p.y, floor, Math.min(1, dt * 4));
    p.y = Math.min(p.y, 30);
    F.bank = lerp(F.bank, turn * .4, Math.min(1, dt * 4));
    F.pitch = lerp(F.pitch, inp.y * .3, Math.min(1, dt * 4));
    ship.rotation.set(F.pitch, F.yaw, F.bank);
    for (const R of rings) {   // 光圈慢慢轉過來面對飛船；船身穿進圈心附近就算過
      if (R.done) { R.m.rotation.y += dt * 2; continue; }
      let d = Math.atan2(p.x - R.c.x, p.z - R.c.z) - R.m.rotation.y;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      R.m.rotation.y += d * Math.min(1, dt * 2);
      R.m.scale.setScalar(1 + Math.sin(F.clock * 3) * .04);
      if (p.distanceTo(R.c) < 3) ringDone(R);
    }
    camera.fov = lerp(camera.fov, baseFov() + (inp.boost ? 7 : 0), Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
    chaseCam(dt, 3.5);
    if (Math.floor(F.clock) !== F.sec) { F.sec = Math.floor(F.clock); hudTime.textContent = fmtSec(F.clock); }
  } else if (F.phase === 'climb') {   // 一鏡到底①：船從光圈那裡順勢拉起、穿過雲層衝上太空，鏡頭跟在船旁邊慢慢換位置
    const t = Math.min(F.t, FLY.climb), d = F.v0 * t + F.acc * t * t * t;
    poseAlong(F.route, Math.min(1, d / F.len), dt);
    F.speed = F.v0 + 3 * F.acc * t * t;
    shipAxes();
    const M = isMobile(), back = M ? 12.5 : 9.5, up = M ? 5.2 : 3.8, p = ship.position;   // 手機直立畫面比較窄，鏡頭都拉遠一點、不偏左右
    if (t < 1.3) {   // 跟在船後面，看它拉起來
      _ro.copy(_nose).multiplyScalar(-back).addScaledVector(_srt, 1.1).add(_c3.set(0, up, 0));
      _rl.copy(_nose).multiplyScalar(6).add(_c3.set(0, .4, 0));
    } else if (t < 3.3) {   // 滑到船的右邊，看它垂直往上穿過雲層
      _ro.copy(_srt).multiplyScalar(M ? 19 : 14).addScaledVector(_nose, -3).add(_c3.set(0, 3, 0));
      _rl.set(0, 0, 0);
    } else if (t < 5.6) {   // 升到船的右上方往下看：雲在下面，島越縮越小
      _ro.copy(_srt).multiplyScalar(M ? 13 : 10).addScaledVector(_fh, -3).add(_c3.set(0, M ? 22 : 17, 0));
      _rl.copy(p).multiplyScalar(-.05);
    } else {   // 繞到船後上方，準備跳光速
      _ro.copy(_fh).multiplyScalar(M ? -19 : -13).addScaledVector(_srt, M ? 0 : 1.5).add(_c3.set(0, 4.5, 0));
      _rl.copy(_fh).multiplyScalar(14).add(_c3.set(0, 1, 0));   // 繞過來的半路上船也留在畫面中間
    }
    rigTo(_ro, _rl, dt);
    camera.fov = lerp(camera.fov, baseFov(), Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
    spaceView(smooth((t - 2.6) / 3.2));   // 天色照時間變：穿過雲層之後約 3 秒轉黑
    if (F.t >= FLY.climb) nextFlight('hyper');
  } else if (F.phase === 'hyper') {   // 一鏡到底②：船往前加速衝出去、越變越小，星光拉長，白光一閃
    const k = Math.min(1, F.t / FLY.hyper);
    shipAxes();
    F.speed *= 1 + dt * 2.5;
    ship.position.addScaledVector(_fh, F.speed * dt);
    F.pitch = lerp(F.pitch, 0, Math.min(1, dt * 4));
    F.bank = lerp(F.bank, 0, Math.min(1, dt * 4));
    ship.rotation.set(F.pitch, F.yaw, F.bank);
    _ro.copy(_fh).multiplyScalar((isMobile() ? -19 : -13) - 70 * k * k).addScaledVector(_srt, isMobile() ? 0 : 1.5).add(_c3.set(0, 4.5, 0));
    _rl.copy(_fh).multiplyScalar(30).add(_c3.set(0, 1, 0));
    rigTo(_ro, _rl, dt, 3.5);
    spaceView(1);
    drawWarp(k * .55);   // 白光在這一段的最後一刻最亮
    if (k >= 1) nextFlight('descent');
  } else if (F.phase === 'descent') {   // 一鏡到底③：拖著火光重返大氣層，一路減速飛過島上空，直接停進碼頭、放下坡道
    const k = Math.min(1, F.t / FLY.descent), u = 1 - (1 - k) * (1 - k), heat = 1 - smooth((k - .28) / .25);
    poseAlong(DESCENT, u, dt);
    const dock = smooth((k - .8) / .2);   // 最後一段：船擺正、轉回停靠方向
    if (dock > 0) {
      let dy = Math.PI - ship.rotation.y;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      ship.rotation.set(ship.rotation.x * (1 - dock), ship.rotation.y + dy * dock, ship.rotation.z * (1 - dock));
    }
    ramp.scale.x = k < .93 ? .02 : lerp(.02, 1, (k - .93) / .07);
    F.heat = heat;
    fireShell.visible = heat > .02;
    fireShell.material.opacity = heat * (.85 + Math.sin(F.t * 40) * .15);
    fireShell.scale.setScalar(5 + heat * 3 + Math.sin(F.t * 33) * .4);
    if (heat > .05) { emitTrail(ship.position, heat); emitTrail(ship.position, heat); }
    shipAxes();
    DESCENT.getTangentAt(u, _ft);
    const M = isMobile();   // 手機直立畫面比較窄，鏡頭拉遠一點、不偏左右
    if (F.t < 3.2) {   // 鏡頭在船的斜上方一起往下衝：看得到圓盤頂面，火光尾巴往後拖
      _ro.copy(_c3.crossVectors(_ft, camera.up).normalize()).multiplyScalar(M ? 16 : 12).addScaledVector(_ft, 4).add(_c3.set(0, M ? 12 : 9, 0));
      _rl.set(0, 0, 0);
    } else {   // 慢慢繞到船後上方，跟著它飛過島
      _ro.copy(_fh).multiplyScalar(M ? -16 : -11).addScaledVector(_srt, M ? 0 : 3).add(_c3.set(0, M ? 6.5 : 5, 0));
      _rl.copy(_fh).multiplyScalar(8).add(_c3.set(0, .5, 0));
    }
    rigTo(_ro, _rl, dt, 1.8);
    const toPier = smooth((k - .72) / .28);   // 最後滑到碼頭的固定視角
    if (toPier > 0) {
      camera.position.lerp(F.pier.pos, toPier);
      controls.target.lerp(F.pier.target, toPier);
      camera.lookAt(controls.target);
    }
    camera.fov = lerp(camera.fov, baseFov(), Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
    spaceView(1 - smooth((F.t - 1) / 3.4));   // 天色照時間變：重返大氣層後約 3 秒轉亮
    body.classList.toggle('space', k < .55);
    if (k < 1) return;
    spaceReset();
    setRings(false);
    ship.position.set(SHIP.x, SHIP.y, SHIP.z);
    ship.rotation.set(0, Math.PI, 0);
    Object.assign(F, { yaw: Math.PI, pitch: 0, bank: 0 });
    camera.position.copy(F.pier.pos);
    controls.target.copy(F.pier.target);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
    avatar.visible = true; mePin.obj.visible = true; F.walking = true;
    nextFlight('off');
  } else if (F.phase === 'return') {   // 按「降落」：自動飛回碼頭上空
    const k = Math.min(1, F.t / F.dur), u = 1 - (1 - k) * (1 - k), rp = F.route.getPointAt(u, _fp);
    F.kl = lerp(F.kl, Math.max(0, kjFloor(rp.x, rp.z) - rp.y), Math.min(1, dt * 3));   // 回程路上經過巨獸就拉高
    rp.y += F.kl;
    poseShip(rp, F.route.getTangentAt(u, _ft), dt);
    camera.fov = lerp(camera.fov, baseFov(), Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
    chaseCam(dt, 3);
    if (k >= 1) nextFlight('touch');
  } else if (F.phase === 'touch') {   // 降落、轉回停靠方向、放下坡道
    const k = Math.min(1, F.t / FLY.touch), e = smooth(k);
    let dy = Math.PI - F.yaw;
    while (dy > Math.PI) dy -= TAU;
    while (dy < -Math.PI) dy += TAU;
    ship.position.lerpVectors(F.from, _fp.set(SHIP.x, SHIP.y, SHIP.z), e);
    ship.rotation.set(ship.rotation.x * (1 - e), F.yaw + dy * e, F.bank * (1 - e));
    ramp.scale.x = k < .7 ? .02 : lerp(.02, 1, (k - .7) / .3);
    if (k < 1) return;
    F.yaw = Math.PI;
    ship.rotation.set(0, Math.PI, 0);
    camera.fov = baseFov();
    camera.updateProjectionMatrix();
    avatar.visible = true; mePin.obj.visible = true; F.walking = true;
    nextFlight('off');
  }
}

/* ---------- 開巨獸 ----------
   點巨獸之後提示列有「飛上去」：分身蹲低蓄力，爆炸頭變金色、往上豎起來，全身燒起金色火焰，拖著火光飛向牠（牠會停下來轉頭看你，在游泳就先站起來接你）。
   頭頂的駕駛艙升上來、艙蓋打開，你坐進去、艙蓋關上、巨獸開機；方向鍵／左下搖桿讓牠走，往外海走牠撲進水裡、抬著頭游，游回淺水區站起來。
   噴火往你瞄的地方（滑鼠指著／點畫面）：海面冒蒸氣、雲燒熱會蒸發、往島噴罩子才升起來；按住「吼」蓄力：背鰭從尾巴尖往頭一段段亮成金色，放開射出金色光束（可以掃）。
   「跺腳」：一圈浪往島推過去，浪到哪裡、哪裡的島民就有反應。「煙火」：天色暗下來的一場煙火秀，最後拼出你的真實紀錄和島民的臉、嘴巴發射大金柳。
   「下來」：艙蓋彈開、座椅把你彈出去，你單膝落地，火焰收掉、頭髮變回黑色，駕駛艙收回頭裡。火焰只在飛和開的時候燒。
   鏡頭：拖曳繞著巨獸轉、滾輪／兩指縮放，「鏡頭」鍵換遠景／背後／正面／駕駛艙。 */
const _UP = new THREE.Vector3(0, 1, 0);
const AURA_GOLD = [0xffd23f, 0xf5b82e, 0xffe680].map(h => new THREE.Color(h)), AURA_EM = new THREE.Color(0xff9a00), EYE_DARK = new THREE.Color(0x1d2233), EYE_TEAL = new THREE.Color(0x12b8a8);
const aura = (() => {   // 金色火焰：一直面向鏡頭的火焰板（身體後面一層、前面一層淡的）＋往上飄的火星＋一盞金色的燈；捲髮變金色往上豎、冒出一撮撮尖尖的金髮
  const mk = (front, gain) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: 0 }, uG: { value: gain }, uOcc: { value: .5 }, uSize: { value: new THREE.Vector2(2.2, 2.9) }, uDir: { value: new THREE.Vector2(0, 1) }, uFront: { value: front } },
      vertexShader: `uniform vec2 uSize, uDir; uniform float uFront; varying vec2 vQ;
        void main() {   // 板子永遠面向鏡頭，火往 uDir（畫面上的方向）竄：站著往上、飛的時候往後拖
          vQ = (uv - vec2(.5, .32)) * 2.0;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 up = normalize(uDir), rt = vec2(up.y, -up.x), c = (uv - vec2(.5, .32)) * uSize;
          mv.xy += rt * c.x + up * c.y; mv.z += uFront;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uT, uK, uG, uOcc; varying vec2 vQ;
        float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main() {
          vec2 q = vQ;   // x：-1～1；y：-0.64～1.36，身體中心在 0
          float hi = clamp(q.y, 0.0, 1.4);
          float n = .6 * n2(vec2(q.x * 3.0, q.y * 2.0 - uT * 3.2)) + .4 * n2(vec2(q.x * 6.5 + 3.0, q.y * 4.0 - uT * 5.5));
          float w = mix(.6, .2, smoothstep(0.0, 1.3, q.y)) * (q.y < 0.0 ? sqrt(max(0.0, 1.0 - q.y * q.y / .41)) : 1.0);   // 下面圓、往上收成一條條火舌
          float d = max(abs(q.x) / max(w, .02) - 1.0 - (n - .5) * (.6 + hi * 1.1), (q.y - 1.0 - (n - .5) * .8) * 2.4);
          float fill = smoothstep(.1, -.45, d), rim = exp(-pow((d + .05) * 6.0, 2.0));
          vec3 col = mix(vec3(1.0, .55, .05), vec3(1.0, .9, .45), clamp(fill * .5 + rim * .6, 0.0, 1.0));
          float a = (fill * .3 + rim * .9) * uK * uG;
          gl_FragColor = vec4(col * a, a * uOcc); }`,   // 白天會蓋住一點後面的天空（不然金色疊在亮的天空上會變白），晚上幾乎純發光
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.y = .8; m.frustumCulled = false; m.visible = false; m.renderOrder = 3;
    avatar.add(m);
    return m;
  };
  const back = mk(0, 1), front = mk(.55, .35);
  const N = 240, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3).fill(-999), dat = new Float32Array(N);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(dat, 1));
  const sparks = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute float aA; uniform float uScale; varying float vA;
      void main() { vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aA <= 0.0 ? 0.0 : min(40.0, .17 * uScale / -mv.z); }`,
    fragmentShader: `varying float vA;
      void main() { float r = length(gl_PointCoord - .5) * 2.0; if (r > 1.0) discard; float a = (1.0 - r) * vA; gl_FragColor = vec4(mix(vec3(1.0, .62, .1), vec3(1.0, .95, .7), exp(-r * r * 6.0)) * a, a * .5); }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  sparks.frustumCulled = false; sparks.visible = false;
  scene.add(sparks);
  const light = new THREE.PointLight(0xffc04a, 0, 10, 2);
  light.position.y = .9;
  avatar.add(light);
  // 尖尖的金髮：一撮撮從捲髮上面往外、往上冒（平常收起來）
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xff9a00, emissiveIntensity: .5, roughness: .55, flatShading: true });
  const sg = new THREE.ConeGeometry(.07, 1, 5).translate(0, .5, 0), spikes = [], sr = mulberry32(31);
  for (let i = 0; i < 16; i++) {
    const az = i * 2.39996 + .4, el = .2 + i / 15 * 1.1, d = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    if (d.z > .45 && d.y < .55) continue;   // 臉前面不長
    const m = new THREE.Mesh(sg, spikeMat);
    m.position.set(d.x * .3, .13 + d.y * .26, -.07 + d.z * .3);
    m.quaternion.setFromUnitVectors(_UP, d.clone().add(new THREE.Vector3(0, .9, 0)).normalize());
    m.userData = { len: .22 + sr() * .18, ph: sr() * TAU };
    m.visible = false; m.castShadow = true;
    AV.hair.add(m); spikes.push(m);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.visible = false;
  scene.add(ring);
  return { back, front, sparks, pos, dat, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), N, i: 0, emit: 0, light, spikes, spikeMat, ring, ringT: 0, k: 0, gold: 0, boost: 0, sz: 1, dir: new THREE.Vector2(0, 1) };   // sz：火焰大小（坐在駕駛艙裡小一點）
})();
const _aw = new THREE.Vector3(), _av = new THREE.Vector3();
function updateAura(dt, t) {
  const A = aura;
  if (!ride.phase) { A.k = Math.max(0, A.k - dt * 1.5); A.gold = Math.max(0, A.gold - dt * 1.2); A.boost = Math.max(0, A.boost - dt * 2); }
  const k = A.k, gk = A.gold, on = k > .01;
  A.back.visible = A.front.visible = on;
  for (const m of [A.back, A.front]) {
    const U = m.material.uniforms;
    U.uT.value = t; U.uK.value = k * (.9 + .1 * Math.sin(t * 23)) * (1 + A.boost * .5); U.uOcc.value = .62 - night * .5;
    U.uSize.value.set(2.2, 2.9).multiplyScalar(A.sz * (1 + A.boost * .4 + .03 * Math.sin(t * 17)));
    U.uDir.value.copy(A.dir);
  }
  A.light.intensity = k * (1.4 + night * 3 + A.boost * 2) * (.9 + .1 * Math.sin(t * 31));
  for (let i = 0; i < 3; i++) { AV.HM[i].color.copy(AV.HM0[i]).lerp(AURA_GOLD[i], gk); AV.HM[i].emissive.copy(AURA_EM).multiplyScalar(gk * .45); }   // 捲髮變金色、眼睛變青綠色
  AV.eyeMat.color.copy(EYE_DARK).lerp(EYE_TEAL, gk);
  for (const c of AV.curls) {   // 捲毛往外、往上豎起來，跟著火焰微微抖
    c.m.position.copy(c.p);
    if (gk > 0) c.m.position.addScaledVector(c.n, .05 * gk).y += gk * (.06 + .05 * c.n.y) + Math.sin(t * 19 + c.ph) * .012 * k;
  }
  A.spikeMat.emissiveIntensity = .45 + .3 * Math.sin(t * 13) * k;
  for (const m of A.spikes) { m.visible = gk > .02; m.scale.set(gk, gk * m.userData.len * (1 + .14 * Math.sin(t * 21 + m.userData.ph) * k), gk); }
  if (on) {   // 火星：從身體四周往上飄（用世界座標：飛的時候自然拖成一條尾巴）
    A.emit += dt * k * (55 + A.boost * 90 + (ride.phase === 'fly' || ride.phase === 'back' ? 130 : 0));
    avatar.localToWorld(_aw.set(0, .8, 0));
    while (A.emit >= 1) {
      A.emit--;
      const i = A.i = (A.i + 1) % A.N, a = Math.random() * TAU, rr = .25 + Math.random() * .3;
      A.pos.set([_aw.x + Math.cos(a) * rr, _aw.y + (Math.random() - .5) * 1.3, _aw.z + Math.sin(a) * rr], i * 3);
      A.vel.set([(Math.random() - .5) * .6, 1.6 + Math.random() * 1.8, (Math.random() - .5) * .6], i * 3);
      A.life[i] = A.max[i] = .4 + Math.random() * .45;
    }
  }
  let any = false;
  for (let i = 0; i < A.N; i++) {
    if (A.life[i] <= 0) continue;
    any = true;
    A.life[i] -= dt;
    A.pos[i * 3] += A.vel[i * 3] * dt; A.pos[i * 3 + 1] += A.vel[i * 3 + 1] * dt; A.pos[i * 3 + 2] += A.vel[i * 3 + 2] * dt;
    A.dat[i] = Math.max(0, A.life[i] / A.max[i]);
    if (A.life[i] <= 0) { A.dat[i] = 0; A.pos[i * 3 + 1] = -999; }
  }
  A.sparks.visible = any;
  if (any) { A.sparks.geometry.attributes.position.needsUpdate = A.sparks.geometry.attributes.aA.needsUpdate = true; A.sparks.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); }
  if (A.ringT > 0) { A.ringT -= dt; const q = 1 - Math.max(0, A.ringT) / .6; A.ring.scale.setScalar(.6 + q * 4.5); A.ring.material.opacity = (1 - q) * .9; A.ring.visible = A.ringT > 0; }
}
function auraRing(p) { aura.ring.position.set(p.x, p.y + .06, p.z); aura.ringT = .6; aura.ring.visible = true; }
function auraTrail(vel) {   // 火焰往速度的反方向拖（換成畫面上的方向）；停下來就慢慢回到往上竄
  const sp = vel ? vel.length() : 0, f = smooth(sp / 22) * .85;
  if (f > .01) { _av.copy(vel).transformDirection(camera.matrixWorldInverse); _aw.set(-_av.x * f, -_av.y * f + (1 - f), 0); }
  else _aw.set(0, 1, 0);
  if (_aw.x * _aw.x + _aw.y * _aw.y < .04) _aw.set(0, 1, 0);
  aura.dir.lerp(_aw, .2).normalize();
}

/* 分身的姿勢：每一節慢慢轉到目標角度（l＝腳、a＝手、L／R＝左右、x＝前後擺、z＝往外張；b＝身體前傾、by＝身體扭、bp＝身體上下、h＝抬頭） */
function poseTo(P, dt, rate = 10) {
  const k = Math.min(1, dt * rate), L = (o, key, v) => { o[key] = lerp(o[key], v || 0, k); };
  L(AV.legL.rotation, 'x', P.lLx); L(AV.legL.rotation, 'z', P.lLz); L(AV.legR.rotation, 'x', P.lRx); L(AV.legR.rotation, 'z', P.lRz);
  L(AV.armL.rotation, 'x', P.aLx); L(AV.armL.rotation, 'z', P.aLz); L(AV.armR.rotation, 'x', P.aRx); L(AV.armR.rotation, 'z', P.aRz);
  L(AV.body.rotation, 'x', P.b); L(AV.body.rotation, 'y', P.by); L(AV.body.position, 'y', P.bp); L(AV.head.rotation, 'x', P.h);
}
const SIT = { lLx: -1.5, lRx: -1.5, lLz: -.07, lRz: .07 };   // 坐著：兩腿往前伸
const POSE = {
  idle: { lLz: -.1, lRz: .1, aLx: .15, aLz: -.6, aRx: .15, aRz: .6 },   // 兩手插腰
  point: { lLz: -.12, lRz: .12, aLx: .15, aLz: -.6, aRx: -1.55, aRz: .12, by: -.12 },   // 右手往前指
  surf: { lLz: -.38, lRz: .38, aLz: -1.15, aRz: 1.15, aLx: -.2, aRx: .2, bp: -.14, by: .5 },   // 側身、兩腳張開、兩手張開保持平衡
  brace: { lLz: -.3, lRz: .3, aLx: -1.6, aLz: .12, aRx: -1.6, aRz: -.12, b: .14, bp: -.1 },   // 兩手往前推（吼的時候）
  push: { lLz: -.34, lRz: .34, lLx: .2, lRx: -.25, aLx: -1.5, aLz: .06, aRx: -1.5, aRz: -.06, b: .24, bp: -.16 },   // 大招：兩掌往前推得更用力
  power: { lLz: -.32, lRz: .32, aLx: .25, aLz: -.4, aRx: .25, aRz: .4, bp: -.16, h: -.25 },   // 蓄力：蹲低、握拳、仰頭大喊
  cheer: { lLz: -.1, lRz: .1, aLx: -2.9, aLz: -.25, aRx: -2.9, aRz: .25 },   // 放煙火：兩手舉高
  hover: { lLx: .25, lRx: .08, aLx: .2, aLz: -.5, aRx: .2, aRz: .5 },   // 飄在半空中
  charge: { lLz: -.3, lRz: .3, aLx: .3, aLz: -.5, aRx: .3, aRz: .5, bp: -.22, h: -.2 },   // 地上蓄力
  burst: { lLz: -.3, lRz: .3, aLx: .1, aLz: -1.0, aRx: .1, aRz: 1.0, bp: -.08, h: -.35 },   // 變身那一下：兩手往外一張
  fly: { aRx: -3.0, aRz: .1, aLz: -.15 },   // 往前飛：右拳往前伸（整個人往前倒成水平）
  crouch: { lLz: -.25, lRz: .25, aLx: -.4, aRx: -.4, bp: -.18 },   // 蹲在巨獸手指上
  land: { lLx: -1.35, lRx: .9, aRx: -.35, aRz: .1, aLx: .3, aLz: -.7, b: .45, bp: -.5, h: .1 },   // 單膝落地、右拳碰地
  sit: { ...SIT, aLx: -1.0, aRx: -1.0, aLz: .06, aRz: -.06 },   // 坐在駕駛艙：兩手握著操縱桿
  sitFire: { ...SIT, aLx: -1.5, aRx: -1.5, aLz: .16, aRz: -.16, b: .14, h: -.06 },   // 噴火：兩掌往前推（牠跟著噴）
  sitBeam: { ...SIT, aLx: -1.56, aRx: -1.56, aLz: .05, aRz: -.05, b: .22, h: -.1 },   // 合體大招：推得更用力
  sitCharge: { ...SIT, aLx: .15, aRx: .15, aLz: -.42, aRz: .42, b: .26, h: .12 },   // 蓄力：握拳、縮起來發抖
  sitFistUp: { ...SIT, aLx: -1.0, aLz: .06, aRx: -2.9, aRz: -.1, b: -.05 },   // 跺腳前：右拳舉高
  sitSlam: { ...SIT, aLx: -1.0, aLz: .06, aRx: -.7, aRz: -.05, b: .2 },   // 跺腳：拳頭往下一敲
  sitBrace: { ...SIT, aLx: -1.2, aRx: -1.2, aLz: -.3, aRz: .3, b: .05 },   // 撲水、甩水、被彈出去：抓緊
};

const rideable = () => KJ.mode === 'walk' || KJ.mode === 'stand';   // 站著或走著才坐得進去（牠在游泳的話會先站起來等你）
const rideFree = () => ['walk', 'stand'].includes(KJ.mode) && KJ.chg <= 0 && !ride.wantOff && !fw.show;   // 可以出招
const _sq = new THREE.Quaternion(), _sU = new THREE.Vector3();
function seatWorld(out, stand = 0) {   // 分身的原點（腳底）該在哪：坐著＝屁股貼著坐墊；stand＝1 站在坐墊上（放煙火時站起來歡呼）
  pit.g.updateMatrixWorld(true);
  pit.g.getWorldQuaternion(_sq);
  _sU.set(0, 1, 0).applyQuaternion(_sq);
  return out.copy(SEAT).applyMatrix4(pit.g.matrixWorld).addScaledVector(_sU, -.42 * (1 - stand));
}
function hoverWorld(out) { seatWorld(out, 1); return out.addScaledVector(_sU, 2.4); }   // 駕駛艙正上方：從這裡降落進座椅
function landingSpot(out) {   // 彈回島上落在哪：從島中間往巨獸那邊，找一塊能走的地
  const r = Math.hypot(KJ.x, KJ.z) || 1, ux = KJ.x / r, uz = KJ.z / r;
  for (let d = 10; d >= 0; d--) { const x = ux * d, z = uz * d; if (walkableAt(x, z)) return out.set(x, groundY(x, z), z); }
  return out.set(PLAZA[0], groundY(PLAZA[0], PLAZA[1]), PLAZA[1]);
}
function startRide() {   // 飛上去：先在原地蓄力變身
  if (ride.phase || flight.phase || uiLock() || state.intro || state.freeze || !kjReady) return;
  ride.offer = 0;
  endFishing();
  closeCard();
  if (isMobile()) { ui.side = false; ui.log = false; syncLayout(); }
  if (state.bird) setBird(false, false);
  if (fetchS.phase === 'carried') dropBall(dog.g.position.x, dog.g.position.z);
  if (dog.state === 'fetch' || dog.state === 'bring') Object.assign(dog, { state: 'idle', t: 2, path: null });
  walk.path = null; walk.moving = false; follow = false; fly = null; controls.enabled = false;
  for (const k in keysDown) keysDown[k] = false;
  state.flying = true;
  body.classList.add('flying', 'autopilot', 'riding');
  const K = KJ;
  K.rq = 0;
  if (K.mode === 'roar' && K.rt < 0) { K.mode = 'stand'; K.t = 3; K.hv = 0; }   // 正要轉身去吼：先不吼了，等你
  Object.assign(ride, { phase: 'charge', t: 0, ct: 0, ctl: false, hold: -1, wantOff: false, burst: false, stompT: 0, pw: false, stand: 0, pitOff: 0, ho: 0 });
  if (camera.position.distanceTo(avatar.position) > 16) sfx('launch', avatar);
  ride.p.copy(avatar.position);
  ride.dir.set(K.cx - avatar.position.x, 0, K.cz - avatar.position.z).normalize();
  avatar.rotation.order = 'YXZ';
  AV.halo.visible = false; mePin.obj.visible = false; AV.saberT = 0;
  Object.assign(aim, { mode: 'none', t: 0 });
  Object.assign(oc, { auto: null, mode: '' });
}
function startFlyUp() {
  Object.assign(ride, { phase: 'fly', t: 0 });
  ride.from.copy(avatar.position).y += .8;   // 身體中間
  hoverWorld(ride.to);
  ride.dur = clamp(ride.from.distanceTo(ride.to) / 26, 1.8, 3.6);
  auraRing(avatar.position);
  sfx('launch', avatar);
}
function startEnter() { Object.assign(ride, { phase: 'enter', t: 0 }); }   // 到了駕駛艙上方：往下降、坐進座椅
function startBoot() {   // 坐好了：艙蓋關上、巨獸開機（按鈕亮起來、眼睛閃一下金光、一道金光從頭沿著背鰭跑到尾巴、吼一聲）
  const K = KJ;
  Object.assign(ride, { phase: 'boot', t: 0 });
  PIT.openT = 0;
  K.bump = 1; K.boot = 0; K.chg = 0;
  if (K.mode === 'walk') { K.mode = 'stand'; K.t = 3; }
  sfx('riderLand', avatar);
}
function startPilot() {   // 開機完成：換你開
  Object.assign(ride, { phase: 'ride', t: 0, ctl: true });
  PIT.litT = 1;
  body.classList.remove('autopilot');   // 開的時候才顯示搖桿
  ride.help = HELP_T;   // 跟按鈕、搖桿一起秀操作說明（開機那兩秒不擋：眼睛閃光、背鰭一路亮到尾巴）
  const n = num('sanasai_rides') + 1;
  ls.set('sanasai_rides', String(n));
  if (n === 1 || n === 10 || n % 50 === 0) addLog('pet', n === 1 ? '第一次坐進機械巨獸的駕駛艙' : `開機械巨獸第 ${n} 次`);
}
function rideExit() {   // 下來：坐在駕駛艙裡＝艙蓋彈開、座椅把你彈出去，飛回島上；還在飛、在半空等＝自己飛回去；蓄力變身中＝直接取消
  const P = ride.phase, K = KJ;
  if (!P || P === 'eject' || P === 'back' || P === 'land') return;
  if (P === 'charge') return endRide();
  if (P === 'fly' || P === 'hover') return startBack();
  if (P === 'ride' && !['walk', 'stand', 'swim'].includes(K.mode)) { ride.wantOff = true; return; }   // 這一招做完再下來
  const k = KJ;
  ride.hold = -1; k.chg = 0;
  if (fw.show) endShow();
  Object.assign(ride, { phase: 'eject', t: 0, ctl: false, wantOff: false });
  body.classList.add('autopilot');
  PIT.openT = 1; PIT.fast = true;
  if (k.mode === 'walk') { k.mode = 'stand'; k.t = 3; }
}
function startBack(eject = false) {   // 飛回島上（被彈出去或自己飛）；駕駛艙過一下關上、收回頭裡
  const K = KJ;
  ride.hold = -1; K.chg = 0;
  if (fw.show) endShow();
  Object.assign(ride, { phase: 'back', t: 0, ctl: false, wantOff: false, arc: eject ? 16 : 10, pitOff: 1.3 });
  body.classList.add('autopilot');
  ride.from.copy(avatar.position).y += .8;
  landingSpot(ride.to).y += .8;
  ride.dur = clamp(ride.from.distanceTo(ride.to) / 22, 1.6, 3.2) + (eject ? .35 : 0);
  if (K.mode === 'walk') { K.mode = 'stand'; K.t = 2.5; }
  sfx('launch', avatar);
}
function endRide() {   // 回到島上走路
  Object.assign(ride, { phase: null, ctl: false, hold: -1, wantOff: false, stand: 0 });
  KJ.chg = 0;
  if (PIT.upT && ride.pitOff <= 0) ride.pitOff = .7;
  state.flying = false;
  body.classList.remove('flying', 'autopilot', 'riding');
  for (const L of [AV.legL, AV.legR, AV.armL, AV.armR]) L.rotation.set(0, 0, 0);
  AV.body.rotation.set(0, 0, 0); AV.body.position.set(0, 0, 0); AV.head.rotation.set(0, 0, 0);
  _e.setFromQuaternion(avatar.quaternion, 'YXZ');
  avatar.rotation.set(0, _e.y, 0);
  avatar.position.y = groundY(avatar.position.x, avatar.position.z);
  AV.halo.visible = true; mePin.obj.visible = true; AV.head.visible = true; for (const h of pit.halves) h.visible = true;
  aura.dir.set(0, 1); aura.sz = 1; aura.back.material.uniforms.uG.value = 1; aura.front.material.uniforms.uG.value = .35;
  camera.fov = baseFov(); camera.updateProjectionMatrix();
  controls.target.set(avatar.position.x, avatar.position.y + .8, avatar.position.z);
  controls.enabled = true;
  follow = true;
}

const rideHelp = $('#ride-help'), rhpBar = $('#rhp-bar'), HELP_T = 6.5;
function rideHelpSync(dt) {   // 開機完先秀幾秒操作說明；開始蓄力、下海、放煙火、要下來就提早收掉（那時提示列有更要緊的話）
  const K = KJ;
  if (ride.help > 0 && (ride.phase !== 'ride' || K.chg > 0 || fw.show || ride.wantOff || K.mode === 'dive' || K.mode === 'swim')) ride.help = 0;
  ride.help = Math.max(0, ride.help - dt);
  const on = ride.help > 0;
  if (rideHelp.classList.contains('on') !== on) { rideHelp.classList.toggle('on', on); body.classList.toggle('help-on', on); }
  if (on) rhpBar.style.transform = `scaleX(${(ride.help / HELP_T).toFixed(3)})`;
}

/* 吼：點一下噴藍色火焰；按住 0.25 秒以上開始蓄力（約 1.5 秒蓄滿），放開：蓄滿＝合體大招金色光束，沒蓄滿＝照樣噴藍色火焰。都往你瞄的地方噴 */
function rideRoarDown() { if (ride.phase === 'ride' && ride.hold < 0 && rideFree()) { ride.hold = 0; ride.ready = false; } }
function rideRoarUp() {
  if (ride.hold < 0) return;
  ride.hold = -1;
  const K = KJ, full = K.chg >= 1;
  if (ride.phase !== 'ride' || !['walk', 'stand'].includes(K.mode)) { K.chg = 0; return; }
  if (!full) K.chg = 0;
  kjRoar(false, true, full);
}
function rideRoarCancel() { if (ride.hold >= 0) { ride.hold = -1; KJ.chg = 0; } }
function rideFireAt(nx, ny) {   // 點畫面：往點的地方噴火（正在噴就改瞄那裡）
  if (ride.phase !== 'ride') return;
  if (!aimPick(nx, ny, aim.T, true)) aim.mode = 'none';   // 點到巨獸自己＝往前噴
  else { aim.mode = 'world'; aim.t = 4; }
  if (KJ.mode === 'roar' && KJ.rFree) return;
  if (rideFree() && ride.hold < 0) kjRoar(false, true, false);
}
function rideStomp() {
  if (ride.phase !== 'ride' || !rideFree()) return;
  Object.assign(KJ, { mode: 'stomp', u: 0, imp: false, v: 0 });
  ride.stompT = 0;
}
function rideStompHit(x, z) {   // 跺腳踩到水的那一刻（巨獸那邊呼叫）
  startWave(x, z);
  ride.shake = 1; ride.stompT = 4.4;   // 鏡頭拉高看島，等浪推過島
  const n = num('sanasai_stomps') + 1;
  ls.set('sanasai_stomps', String(n));
}
function rideWorks() {
  if (ride.phase !== 'ride' || !rideFree()) return;
  Object.assign(KJ, { mode: 'works', u: 0, v: 0 });
  KJ.rc[0] = KJ.rc[1] = 0;
  startShow();
}

/* 瞄準：電腦＝滑鼠指到哪、頭就跟著看哪，點下去往那裡噴；手機＝點哪裡噴哪裡，噴的時候手指拖到哪火就跟到哪 */
function aimPick(nx, ny, out, body = false) {   // 畫面上的點 → 世界上的目標：雲、島（防護罩的範圍）、海面，都沒有就是天空；body：點到巨獸自己回傳 false
  ray.setFromCamera(ndc.set(nx, ny), camera);
  if (body && ray.intersectObject(kj.g, true).some(h => h.object.visible && h.object.isMesh && !h.object.material.transparent)) return false;
  const o = ray.ray.origin, d = ray.ray.direction;
  let best = 320; aim.kind = 'sky';   // 遠到看不清楚的雲、海面也算
  const c = cloudRay(o, d);
  if (c.t < best) { best = c.t; aim.kind = 'cloud'; }
  const ts = shieldHitT(o, d);
  if (ts > 0 && ts < best) { best = ts; aim.kind = 'isle'; }
  if (d.y < -1e-4 && -o.y / d.y < best) { best = -o.y / d.y; aim.kind = 'sea'; }
  out.copy(o).addScaledVector(d, aim.kind === 'sky' ? 150 : best);
  return true;
}
function aimTarget(out) {   // 巨獸要噴的地方（沒瞄＝前面 40 外的海面）
  if (aim.mode === 'none') { const K = KJ; return out.set(K.cx + Math.sin(K.h) * 40, 1, K.cz + Math.cos(K.h) * 40); }
  return out.copy(aim.T);
}
const aimLook = () => aim.mode === 'screen' || aim.t > 0;   // 頭要不要轉過去看瞄的地方
function aimScreen(e) { aim.nx = e.clientX / innerWidth * 2 - 1; aim.ny = -(e.clientY / innerHeight) * 2 + 1; aim.mode = 'screen'; }

/* 雲：噴火打到會慢慢變熱、發紅，打夠了就蒸發成一團團蒸氣，過半分鐘再慢慢長回來（光束一打就散） */
const CLOUD = clouds.children.map((m, i) => {
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  m.material = m.material.clone();
  return { m, i, c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).multiplyScalar(.55), heat: 0, burn: 0, gone: 0, s: 1, quiet: false };
});
const cloudLocal = (x, z, out) => { const th = clouds.rotation.y, cs = Math.cos(th), sn = Math.sin(th); return out.set(x * cs - z * sn, 0, x * sn + z * cs); };   // 世界 → 雲那一組的局部（雲會慢慢轉）
const cloudWorld = (v, out) => { const th = clouds.rotation.y, cs = Math.cos(th), sn = Math.sin(th); return out.set(v.x * cs + v.z * sn, v.y, -v.x * sn + v.z * cs); };
const _cl1 = new THREE.Vector3(), _cl2 = new THREE.Vector3(), _crs = { t: Infinity, i: -1 };
function cloudRay(o, d) {   // 從 o 往 d 最先打到哪一朵雲（橢球）
  _crs.t = Infinity; _crs.i = -1;
  const lo = cloudLocal(o.x, o.z, _cl1), ld = cloudLocal(d.x, d.z, _cl2);
  lo.y = o.y; ld.y = d.y;
  for (const C of CLOUD) {
    if (C.s < .35) continue;
    const rx = C.r.x * C.s, ry = C.r.y * C.s, rz = C.r.z * C.s;
    const px = (lo.x - C.c.x) / rx, py = (lo.y - C.c.y) / ry, pz = (lo.z - C.c.z) / rz, qx = ld.x / rx, qy = ld.y / ry, qz = ld.z / rz;
    const a = qx * qx + qy * qy + qz * qz, b = 2 * (px * qx + py * qy + pz * qz), c = px * px + py * py + pz * pz - 1, q = b * b - 4 * a * c;
    if (q < 0) continue;
    const t = (-b - Math.sqrt(q)) / (2 * a);
    if (t > 0 && t < _crs.t) { _crs.t = t; _crs.i = C.i; }
  }
  return _crs;
}
let cloudCS = 1, cloudSN = 0;
function cloudHit(x, y, z) {   // 一顆火在雲裡面嗎（打到就加熱那朵雲）
  const lx = x * cloudCS - z * cloudSN, lz = x * cloudSN + z * cloudCS;
  for (const C of CLOUD) {
    if (C.s < .35) continue;
    const dx = (lx - C.c.x) / (C.r.x * C.s), dy = (y - C.c.y) / (C.r.y * C.s), dz = (lz - C.c.z) / (C.r.z * C.s);
    if (dx * dx + dy * dy + dz * dz < 1) {
      if ((C.heat += 1) > 46) cloudBurn(C.i);
      if (Math.random() < .08) steamPuff(x, y, z, 3.5, 1.4, 1, 0, 1.5, 0);
      return true;
    }
  }
  return false;
}
function cloudBurn(i, quiet = false) {
  const C = CLOUD[i];
  if (C.burn > 0 || C.s < .5) return;
  C.burn = .001; C.quiet = quiet;
  if (!quiet) { sfx('poof', cloudWorld(C.c, _cl1)); const n = num('sanasai_clouds') + 1; ls.set('sanasai_clouds', String(n)); if (n === 1) addLog('pet', '機械巨獸噴火把一朵雲燒掉了'); }
}
function updateClouds(dt) {
  cloudCS = Math.cos(clouds.rotation.y); cloudSN = Math.sin(clouds.rotation.y);
  for (const C of CLOUD) {
    C.heat = Math.max(0, C.heat - dt * 9);
    if (C.burn > 0) {   // 蒸發：縮小、冒出一團團蒸氣（被火照成橘色）
      C.burn += dt;
      C.s = 1 - smooth(C.burn / 1.4);
      if (Math.random() < dt * (C.quiet ? 14 : 34)) {
        _cl2.set(C.c.x + (Math.random() - .5) * 2 * C.r.x * C.s, C.c.y + (Math.random() - .5) * C.r.y * C.s, C.c.z + (Math.random() - .5) * 2 * C.r.z * C.s);
        cloudWorld(_cl2, _cl1);
        steamPuff(_cl1.x, _cl1.y, _cl1.z, 6 + Math.random() * 4, 2.2, C.quiet ? 0 : .8, (Math.random() - .5) * 3, 1 + Math.random() * 2, (Math.random() - .5) * 3);
      }
      if (C.burn >= 1.4) { C.burn = 0; C.gone = 28 + Math.random() * 14; C.s = 0; }
    } else if (C.gone > 0) C.gone -= dt;
    else if (C.s < 1) C.s = Math.min(1, C.s + dt / 5);   // 慢慢長回來
    const on = C.s > .01;
    C.m.visible = on;
    if (on) { C.m.scale.setScalar(C.s); C.m.position.copy(C.c).multiplyScalar(1 - C.s); }
    const hk = C.burn > 0 ? 1 - C.burn / 1.4 : Math.min(1, C.heat / 46) * .6;
    C.m.material.emissive.setRGB(1, .42, .12).multiplyScalar(hk * (C.quiet ? 0 : .7));
  }
}

/* 蒸氣：火打到海面、雲蒸發、煙火發射的煙（一般的半透明白煙，被火照到的帶點橘色） */
const STM_N = 520;
const steam = (() => {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(STM_N * 3).fill(-999), dat = new Float32Array(STM_N * 3).fill(1);   // dat：[飛了多久（0～1，1＝沒在用）, 大小, 帶橘色的程度]
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDat', new THREE.BufferAttribute(dat, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uLit: { value: 1 } },
    vertexShader: `attribute vec3 aDat; uniform float uScale; varying vec3 vD;
      void main() { vD = aDat; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aDat.x >= 1.0 ? 0.0 : min(320.0, aDat.y * (.45 + 1.5 * sqrt(aDat.x)) * uScale / -mv.z); }`,
    fragmentShader: `uniform float uLit; varying vec3 vD;
      void main() { float r = length(gl_PointCoord - .5) * 2.0; if (r > 1.0) discard;
        float k = vD.x, a = (1.0 - r * r) * pow(1.0 - k, 1.5) * smoothstep(0.0, .07, k) * .5;
        gl_FragColor = vec4(mix(vec3(uLit), vec3(1.0, .6, .28), vD.z * (1.0 - k * .7)), a); }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false; m.visible = false; m.renderOrder = 2;
  scene.add(m);
  return { m, mat, pos, dat, vel: new Float32Array(STM_N * 3), age: new Float32Array(STM_N), life: new Float32Array(STM_N).fill(1), i: 0 };
})();
function steamPuff(x, y, z, size = 2.4, life = 1.8, warm = 0, vx = 0, vy = 2, vz = 0) {
  const S = steam, i = S.i = (S.i + 1) % STM_N;
  S.pos[i * 3] = x; S.pos[i * 3 + 1] = y; S.pos[i * 3 + 2] = z;
  S.vel[i * 3] = vx; S.vel[i * 3 + 1] = vy; S.vel[i * 3 + 2] = vz;
  S.age[i] = 0; S.life[i] = life; S.dat[i * 3] = 0; S.dat[i * 3 + 1] = size; S.dat[i * 3 + 2] = warm;
}
function updateSteam(dt) {
  const S = steam;
  let any = false;
  for (let i = 0; i < STM_N; i++) {
    if (S.dat[i * 3] >= 1) continue;
    any = true;
    const o = i * 3, k = Math.min(1, (S.age[i] += dt) / S.life[i]), dr = Math.max(0, 1 - 1.4 * dt);
    S.vel[o] *= dr; S.vel[o + 1] = S.vel[o + 1] * dr + .6 * dt; S.vel[o + 2] *= dr;
    S.pos[o] += S.vel[o] * dt; S.pos[o + 1] += S.vel[o + 1] * dt; S.pos[o + 2] += S.vel[o + 2] * dt;
    S.dat[o] = k;
    if (k >= 1) S.pos[o + 1] = -999;
  }
  S.m.visible = any;
  if (any) {
    S.m.geometry.attributes.position.needsUpdate = S.m.geometry.attributes.aDat.needsUpdate = true;
    S.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    S.mat.uniforms.uLit.value = 1 - night * .6;
  }
}
let sizzleT = 0;
function seaHit(x, z, n, dt) {   // 這一幀有 n 顆火打到海面（平均落在 x, z）：水面一圈圈、偶爾濺水花、嘶嘶聲
  sizzleT -= dt;
  if (sizzleT <= 0) { sizzleT = .5; sfx('sizzle', _cl1.set(x, 0, z)); kjRipple(x, z, 1.5, 9, 1.6, .55); }
  if (Math.random() < n * .02) kjBurst(x + (Math.random() - .5) * 4, .3, z + (Math.random() - .5) * 4, 4, 2, 4);
}

/* 駕駛艙：升上來、艙蓋開關、按鈕亮暗（每一幀都跑：你下來之後艙蓋還要關、駕駛艙還要收回去） */
function updatePit(dt, t) {
  const P = PIT;
  if (ride.pitOff > 0) {   // 你下來了：艙蓋關上、駕駛艙收回頭裡、按鈕暗掉
    ride.pitOff -= dt;
    if (ride.pitOff < .7) P.openT = 0;
    if (ride.pitOff <= 0) { P.upT = 0; P.litT = 0; }
  }
  const up0 = P.up, op0 = P.open;
  P.up = approach(P.up, P.upT, dt / .75);
  P.open = approach(P.open, P.openT, dt / (P.fast ? .2 : .55));
  if (P.open === P.openT) P.fast = false;
  P.lit = approach(P.lit, P.litT, dt / .45);
  if (kjReady) {
    if (P.up !== up0 && (up0 === 0 || up0 === 1)) sfx('pitRise', kj.head, P.upT ? 0 : 1);
    if (P.open !== op0 && (op0 === 0 || op0 === 1)) sfx('canopy', kj.head, P.openT);
  }
  const g = pit.g;
  g.visible = P.up > .001;
  if (!g.visible) return;
  const x = P.up - 1, e = P.upT ? 1 + 2.7 * x * x * x + 1.7 * x * x : smooth(P.up);   // 升上來時衝過頭一點再停住
  g.position.y = PIT_DOWN * (1 - e);
  const o = smooth(P.open) * 1.95;
  pit.halves[0].rotation.z = o; pit.halves[1].rotation.z = -o;
  pit.litMat.color.setScalar(.12 + P.lit * (.9 + night * .9) * (.93 + .07 * Math.sin(t * 9)));
  pit.glass.uniforms.uDim.value = night;
  pit.glass.uniforms.uGold.value = ride.phase && ride.phase !== 'back' && ride.phase !== 'land' ? aura.k : 0;
}

const _rA = new THREE.Vector3(), _rB = new THREE.Vector3(), _rF = new THREE.Vector3(), _rS = new THREE.Vector3(), _rC = new THREE.Vector3(), _rC2 = new THREE.Vector3(), _rM = new THREE.Vector3(), _rT = new THREE.Vector3(), _rP = new THREE.Vector3(), _rV = new THREE.Vector3();
function updateRide(dt, t) {
  if (ride.offer > 0) ride.offer -= dt;
  updatePit(dt, t);
  updateAura(dt, t);
  updateWave(dt);
  updateShow(dt);
  updateFireworks(dt);
  updateSteam(dt);
  updateClouds(dt);
  updateBeamFx(dt, t);
  rideHelpSync(dt);
  const P = ride.phase, K = KJ, A = aura;
  if (!P) return rideHudSync();
  ride.t += dt;
  if (aim.mode === 'screen') aimPick(aim.nx, aim.ny, aim.T) || (aim.mode = 'none');   // 滑鼠停著不動、鏡頭在動：指到的地方跟著變
  aim.t = Math.max(0, aim.t - dt);
  let pose = 'idle', vel = null, seated = false;
  if (P === 'charge') {   // 原地蓄力變身：蹲低、握拳，金色從腳底往上燒起來，最後兩手一張（鏡頭先飛到你身邊才開始，不然看不到）
    if (camera.position.distanceTo(avatar.position) < 18 || ride.t > 2.6) ride.ct += dt;
    const k = ride.ct / 1.15;
    ride.dir.set(K.cx - avatar.position.x, 0, K.cz - avatar.position.z).normalize();
    faceTo(ride.dir.x, ride.dir.z, dt);
    A.k = smooth(k / .75); A.gold = smooth((k - .15) / .5); A.boost = k < .78 ? smooth(k / .78) : 1 - smooth((k - .78) / .22) * .6;
    pose = k < .78 ? 'charge' : 'burst';
    if (ride.ct > 0 && !ride.pw) { ride.pw = true; sfx('powerUp', avatar); }
    if (k >= .78 && !ride.burst) { ride.burst = true; auraRing(avatar.position); ride.shake = .5; }
    ride.p.copy(avatar.position);
    if (k >= 1) startFlyUp();
  } else if (P === 'fly' || P === 'back') {   // 拖著火光飛過去（或飛回島上）：一條彎彎的弧線，快到的時候身體翻正
    const k = Math.min(1, ride.t / ride.dur), u = P === 'fly' ? easeIO(k) : 1 - Math.pow(1 - k, 1.6);   // 飛過去：慢慢起飛、慢慢降落；被彈出去：一出去最快
    if (P === 'fly') {
      ride.ho = lerp(ride.ho, rideable() ? 0 : 2.6, Math.min(1, dt * 3));   // 牠還在吼／甩水：先飛到頭頂上方等
      hoverWorld(ride.to); ride.to.y += .8 + ride.ho;
      if (k > .3) PIT.upT = 1;   // 駕駛艙升上來、艙蓋打開等你
      if (PIT.up >= 1) PIT.openT = 1;
    }
    const d = _rT.copy(ride.to).sub(ride.from).setY(0), dl = d.length() || 1;
    d.divideScalar(dl);
    _rA.copy(ride.from).addScaledVector(d, Math.min(8, dl * .2)).add(_rC.set(0, P === 'fly' ? 11 : ride.arc, 0));
    _rB.copy(ride.to).addScaledVector(d, -Math.min(6, dl * .15)).add(_rC.set(0, P === 'fly' ? 8 : ride.arc, 0));
    bez(_rP, ride.from, _rA, _rB, ride.to, u);
    bez(_rV, ride.from, _rA, _rB, ride.to, Math.min(1, u + .01)).sub(_rP).multiplyScalar(100 / ride.dur);   // 大約的速度（給火焰拖尾巴、鏡頭用）
    vel = _rV;
    const hv = Math.hypot(vel.x, vel.z);
    if (hv > .5) { ride.dir.set(vel.x / hv, 0, vel.z / hv); faceTo(ride.dir.x, ride.dir.z, dt * 2); }
    const lean = smooth(k / .12) * (1 - smooth((k - .78) / .2));
    avatar.rotation.x = lean * 1.3; avatar.rotation.z = 0;
    _aw.set(0, .8, 0).applyEuler(avatar.rotation);
    avatar.position.copy(_rP).sub(_aw);
    ride.p.copy(avatar.position);
    pose = lean > .5 ? 'fly' : k > .8 ? (P === 'fly' ? 'hover' : 'crouch') : 'burst';
    A.k = 1; A.gold = 1; A.boost = .3 * lean;
    if (k >= 1) {
      avatar.rotation.x = 0;
      if (P === 'back') { Object.assign(ride, { phase: 'land', t: 0 }); auraRing(ride.p); ride.shake = .7; sfx('heroLand', avatar); dogGreets(); }
      else if (rideable() && PIT.open >= 1) startEnter();
      else Object.assign(ride, { phase: 'hover', t: 0 });
    }
  } else if (P === 'hover') {   // 在駕駛艙上方飄著，等牠吼完／甩完水、艙蓋打開
    hoverWorld(_rT).y += .5 + Math.sin(t * 2.2) * .2;
    ride.p.lerp(_rT, Math.min(1, dt * 4));
    avatar.position.copy(ride.p);
    faceTo(Math.sin(K.h), Math.cos(K.h), dt);
    pose = 'hover'; A.k = 1; A.gold = 1;
    PIT.upT = 1;
    if (PIT.up >= 1) PIT.openT = 1;
    if (rideable() && PIT.open >= 1 && ride.t > .3) startEnter();
  } else if (P === 'enter') {   // 往下降、轉成跟牠同一個方向、坐進去
    const k = smooth(ride.t / .6);
    hoverWorld(_rA); seatWorld(_rB);
    avatar.position.lerpVectors(_rA, _rB, k);
    avatar.quaternion.slerp(_sq, Math.min(1, dt * 12));
    ride.p.copy(avatar.position);
    pose = k < .5 ? 'hover' : 'sit'; seated = k > .4;
    A.k = 1; A.gold = 1;
    if (ride.t >= .6) startBoot();
  } else if (P === 'boot' || P === 'ride' || P === 'eject') {   // 坐在駕駛艙裡：跟著頭一起動
    seatWorld(avatar.position, ride.stand);
    avatar.quaternion.copy(_sq);
    ride.p.copy(avatar.position);
    seated = ride.stand < .5;
    A.k = 1; A.gold = 1;
    if (P === 'boot') {
      pose = 'sit';
      if (ride.t > .35) PIT.litT = 1;
      const I = pilotInput();
      if (ride.t >= 2.1 || (ride.t > .9 && Math.abs(I.x) + Math.abs(I.y) > .2)) startPilot();
    } else if (P === 'eject') {   // 艙蓋彈開，座椅一彈：你往上飛出去
      pose = 'sitBrace';
      if (ride.t >= .3) {
        auraRing(ride.p); ride.shake = .6; sfx('eject', kj.head);
        for (let k = 0; k < 14; k++) steamPuff(ride.p.x + (Math.random() - .5), ride.p.y + .3, ride.p.z + (Math.random() - .5), 1.6, 1.2, .9, (Math.random() - .5) * 5, Math.random() * 2, (Math.random() - .5) * 5);
        avatar.rotation.set(0, K.h, 0);
        startBack(true);
      }
    } else {
      ride.ctl = true;
      if (ride.hold >= 0) {   // 按住「吼」：0.25 秒後開始蓄力
        ride.hold += dt;
        if (ride.hold > .25 && ['walk', 'stand'].includes(K.mode) && !ride.wantOff) {
          if (K.chg <= 0) sfx('charge', kj.head);
          K.chg = Math.min(1, K.chg + dt / 1.5);
          if (K.chg >= 1 && !ride.ready) { ride.ready = true; sfx('ready', kj.head); }
        }
        if (ride.hold > 6.5) rideRoarUp();   // 按太久就自動放
      }
      A.boost = Math.max(K.chg, K.mode === 'roar' && K.rGold ? smooth((K.rt - 1.1) / .3) * (1 - smooth((K.rt - 4.4) / .6)) : 0);
      if (ride.wantOff && ['walk', 'stand', 'swim'].includes(K.mode)) rideExit();
      if (ride.stompT > 0) { ride.stompT -= dt; const I = pilotInput(); if (Math.abs(I.x) + Math.abs(I.y) > .2) ride.stompT = 0; }
      const S = fw.show, up = S && S.t < S.end - 1.6 ? 1 : 0;   // 放煙火：打開艙蓋站起來
      PIT.openT = up || ride.stand > .02 ? 1 : 0;
      ride.stand = approach(ride.stand, up && PIT.open > .85 ? 1 : 0, dt * 2.2);
      pose = ride.stand > .5 ? 'cheer' : K.mode === 'roar' ? (K.rGold ? 'sitBeam' : 'sitFire') : K.chg > 0 ? 'sitCharge' : K.mode === 'stomp' ? (K.u * KJ_ACT.stomp < .88 ? 'sitFistUp' : 'sitSlam') : K.mode === 'dive' || K.mode === 'rise' || K.mode === 'shake' ? 'sitBrace' : 'sit';
    }
  } else if (P === 'land') {   // 單膝落地 → 站起來，火焰慢慢收掉、頭髮變回黑色
    const k = ride.t;
    pose = k < .95 ? 'land' : 'idle';
    A.k = 1 - smooth((k - .55) / 1.1); A.gold = 1 - smooth((k - .75) / 1.0); A.boost = 0;
    avatar.position.y = groundY(avatar.position.x, avatar.position.z);
    ride.p.copy(avatar.position);
    if (k >= 1.85) { endRide(); return rideHudSync(); }
  }
  A.sz = lerp(A.sz, seated ? .7 : 1, Math.min(1, dt * 6));   // 坐在駕駛艙裡：火焰小一點，大部分包在玻璃裡
  let PO = POSE[pose];
  if (pose === 'sit') { const push = Math.abs(K.v) > .3 ? .22 : 0; PO = { ...PO, aLx: PO.aLx + K.hv * .5 - push, aRx: PO.aRx - K.hv * .5 - push, b: push * .4 }; }   // 兩根操縱桿：轉彎時一前一後、往前走時一起往前推
  if (P === 'ride' && pose === 'cheer') AV.body.position.y = Math.abs(Math.sin(t * 7)) * .1;
  if (pose === 'sitCharge' || pose === 'sitBeam' || pose === 'charge') AV.body.position.x = Math.sin(t * 61) * .015; else AV.body.position.x = 0;   // 發抖
  poseTo(PO, dt, P === 'land' && ride.t < .2 ? 30 : 10);
  if (pose === 'sit') AV.body.position.y += Math.sin(t * 2.4) * .01;   // 呼吸
  auraTrail(vel);
  camera.fov = lerp(camera.fov, baseFov() + (K.mode === 'roar' && K.rGold && P === 'ride' ? 5 : 0), Math.min(1, dt * 3));
  camera.updateProjectionMatrix();
  rideCam(dt);
  rideHudSync();
}
function dogGreets() {   // 你單膝落地：阿滿跑過來
  const D = dog, p = D.g.position;
  if (night > .85 || D.state === 'sleep' || D.state === 'bed') return;
  if (Math.hypot(p.x - avatar.position.x, p.z - avatar.position.z) > 16) return;
  bubble(D.g, '汪！', 1.25);
  if (goTo(D, avatar.position.x + 1.1, avatar.position.z + .6)) { D.state = 'walk'; D.petT = 2; }
}

/* 開巨獸的鏡頭：一台彈簧鏡頭（位置用「繞著某一點的角度＋距離」），換構圖都慢慢滑過去、轉速有上限；不升進雲裡、不沉到水下
   坐進駕駛艙之後繞著巨獸轉：拖曳畫面轉角度、滾輪／兩指縮放，「鏡頭」鍵換遠景／側面／正面／駕駛艙；跺腳、放煙火時自己找角度（一拖就交回給你） */
const CLOUDS = clouds.children.map(m => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, r: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2, y: b.min.y }; });
function cloudCeil(x, z) {   // 這裡往上多高會撞進雲裡（離每一朵雲都遠＝60；燒掉的雲不算）
  const th = clouds.rotation.y, cs = Math.cos(th), sn = Math.sin(th);
  let c = 60;
  CLOUDS.forEach((C, i) => {
    if (CLOUD[i].s < .3) return;
    const cx = C.x * cs + C.z * sn, cz = -C.x * sn + C.z * cs, d = Math.hypot(x - cx, z - cz);
    c = Math.min(c, lerp(C.y - 1.2, 60, smooth((d - C.r) / 6)));
  });
  return c;
}
const rcam = { az: 0, el: 0, d: 10, vaz: 0, vel: 0, vd: 0, yaw: 0, pit: 0, vyaw: 0, vpit: 0, ld: 15, dir: new THREE.Vector3(0, 0, -1) };
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
function rcamFrom(A) {   // 換繞的中心點：從鏡頭現在的位置重新算角度和距離（畫面不跳）
  const o = _rT.copy(camera.position).sub(A), d = o.length() || 1;
  Object.assign(rcam, { d, az: Math.atan2(o.x, o.z), el: Math.asin(clamp(o.y / d, -1, 1)), vaz: 0, vel: 0, vd: 0, vyaw: 0, vpit: 0, ld: camera.position.distanceTo(controls.target) || 15 });
  camera.getWorldDirection(_rT);
  rcam.yaw = Math.atan2(_rT.x, _rT.z); rcam.pit = Math.asin(clamp(_rT.y, -1, 1));
}
function rcamTo(off, look, dt, w, A, snap = false, lock = 0, cap = 9) {   // snap：你正在拖曳——直接跟手；lock：看的方向直接跟著（繞著巨獸轉時一直看著牠，不會轉丟），每秒最多轉 cap
  const ang = (x, v, err, k = snap ? 16 : 0) => {   // 角度彈簧：w＝5 跟得緊（牠轉彎時鏡頭只落後十幾度）；加速度、轉速有上限
    if (k) { rcam[v] = 0; rcam[x] += clamp(err * (1 - Math.exp(-k * dt)), -cap * dt, cap * dt); return; }
    rcam[v] = clamp(rcam[v] + clamp(25 * err - 10 * rcam[v], -4.5, 4.5) * dt, -1.55, 1.55);
    rcam[x] += rcam[v] * dt;
  };
  const d = off.length() || 1;
  ang('az', 'vaz', wrapA(Math.atan2(off.x, off.z) - rcam.az));
  ang('el', 'vel', Math.asin(clamp(off.y / d, -1, 1)) - rcam.el);
  if (snap) { rcam.vd = 0; rcam.d += (d - rcam.d) * (1 - Math.exp(-10 * dt)); }
  else { rcam.vd = (rcam.vd + (d - rcam.d) * w * w * dt) * Math.max(0, 1 - 2 * w * dt); rcam.d += rcam.vd * dt; }
  const c = Math.cos(rcam.el);
  camera.position.set(A.x + rcam.d * c * Math.sin(rcam.az), A.y + rcam.d * Math.sin(rcam.el), A.z + rcam.d * c * Math.cos(rcam.az));
  const L = _rC.copy(A).add(look).sub(camera.position), ll = L.length() || 1;   // 看的方向
  ang('yaw', 'vyaw', wrapA(Math.atan2(L.x, L.z) - rcam.yaw), lock || (snap ? 16 : 0));
  ang('pit', 'vpit', Math.asin(clamp(L.y / ll, -1, 1)) - rcam.pit, lock || (snap ? 16 : 0));
  rcam.ld = lerp(rcam.ld, ll, 1 - Math.exp(-3 * dt));
  rcam.dir.set(Math.cos(rcam.pit) * Math.sin(rcam.yaw), Math.sin(rcam.pit), Math.cos(rcam.pit) * Math.cos(rcam.yaw));
}
const VIEWS = [   // rel：從牠的正前方轉多少（π＝正後方、負的＝牠的右手邊）；el：仰角；d／dM：電腦／手機直立畫面的距離（拍得到整隻）
  { name: '遠景', rel: -1.1, el: .2, d: 50, dM: 64 },   // 右前方斜斜看：臉、駕駛艙裡的你、整隻身體到尾巴
  { name: '背後', rel: -2.75, el: .34, d: 40, dM: 52 },   // 跟在後上方：看得到牠往哪走、前面有什麼
  { name: '正面', rel: .45, el: .1, d: 30, dM: 40, ly: 5 },   // 近一點從正前方看：臉和駕駛艙裡的你
  { name: '駕駛艙', fp: true },   // 坐在你的位子上往前看
];
const oc = { v: 0, rel: -1.1, el: .2, d: 50, ly: 0, A: new THREE.Vector3(), L: new THREE.Vector3(), Lv: 0, mode: '', auto: null, snap: 0, fy: 0, fp: 0, pinch: 0, pd: 40 };   // 鏡頭現在用哪個構圖、你拖過的角度和距離；auto：自己找的構圖（stomp／show）
function rideView(i = (oc.v + 1) % VIEWS.length, quiet = false) {   // 換鏡頭
  const V = VIEWS[i];
  oc.v = i; oc.fy = oc.fp = 0; oc.auto = null; ride.stompT = 0;
  if (fw.show) fw.show.cam = false;   // 煙火秀時換鏡頭：交回給你，不再跳回煙火秀的角度
  if (!V.fp) Object.assign(oc, { rel: V.rel, el: V.el, d: camera.aspect < .85 ? V.dM : V.d, ly: V.ly || 0 });
  if (!quiet) { rhViewText.textContent = V.name; clearTimeout(rideView.tm); rideView.tm = setTimeout(() => { rhViewText.textContent = '鏡頭'; }, 1600); }   // 按鈕上先顯示換到哪個鏡頭
}
function camTakeOver() {   // 你一拖：從現在的畫面接手（不跳回原本的構圖）
  if (!oc.auto) return;
  oc.auto = null; ride.stompT = 0;
  if (fw.show) fw.show.cam = false;
  if (oc.mode === 'kaiju') Object.assign(oc, { rel: wrapA(rcam.az - KJ.h), el: clamp(rcam.el, -.04, 1.25), d: clamp(rcam.d, 12, 110) });
  if (VIEWS[oc.v].fp) oc.v = 0;
}
function camDrag(dx, dy) {
  const k = 3.8 / innerHeight;
  camTakeOver();
  if (oc.mode === 'pit') { oc.fy = clamp(oc.fy + dx * k, -1.4, 1.4); oc.fp = clamp(oc.fp + dy * k, -.6, .8); }
  else if (oc.mode === 'kaiju') { oc.rel = wrapA(oc.rel - dx * k); oc.el = clamp(oc.el + dy * k, -.04, 1.25); }
  oc.snap = .25;
}
function camZoom(f) {
  if (oc.mode === 'pit') { if (f > 1.01) rideView(0); return; }
  if (oc.mode !== 'kaiju') return;
  camTakeOver();
  oc.d = clamp(oc.d * f, 12, 110);
  oc.snap = .25;
}
function rideCam(dt) {
  const K = KJ, M = camera.aspect < .85, P = ride.phase, off = _rA, look = _rB;
  const f = _rF.set(Math.sin(K.h), 0, Math.cos(K.h)), s = _rS.set(-Math.cos(K.h), 0, Math.sin(K.h));   // 巨獸的前方、右手邊
  const set = (fo, so, uo, fl, ul, base = f, side = s) => { off.copy(base).multiplyScalar(fo).addScaledVector(side, so).add(_rC.set(0, uo, 0)); look.copy(base).multiplyScalar(fl).add(_rC.set(0, ul, 0)); };
  oc.snap = Math.max(0, oc.snap - dt);
  let mode, A, w = 2.4;
  if (P === 'charge' || P === 'fly' || P === 'back' || P === 'land' || P === 'hover') {   // 跟著你：蓄力時朝著巨獸、飛的時候朝著飛的方向
    mode = 'rider'; A = _rM.copy(ride.p);
    const d = ride.dir, sd = _rC2.set(-d.z, 0, d.x);
    if (P === 'charge') set(M ? -10 : -7.5, M ? 1.2 : 2.6, M ? 3.6 : 2.4, 6, 1.6, d, sd);
    else if (P === 'land') set(M ? -11 : -8.5, M ? 2 : 3, M ? 5.5 : 4.2, 0, .9, d, sd);
    else if (P === 'hover') { mode = 'kaiju'; }
    else { const k = P === 'fly' ? smooth((ride.t / ride.dur - .2) / .5) : 0; set((M ? -12 : -9) - 8 * k, (M ? .8 : 1.6) + 7 * k, (M ? 4 : 3) + 4 * k, 9, -.4 - 2 * k, d, sd); }   // 飛過去：越接近巨獸，鏡頭越往後上方拉，看得到你降落在牠頭上
    if (P === 'fly' && ride.t / ride.dur > .8) mode = 'kaiju';   // 快到了：鏡頭換成繞著巨獸，看得到你降進駕駛艙
  } else mode = VIEWS[oc.v].fp && P === 'ride' && !oc.auto ? 'pit' : 'kaiju';
  if (mode === 'kaiju') {   // 繞著巨獸：中心點跟著牠（濾掉走路一沉一沉），高度在身體中間（游泳時壓低）
    A = oc.A.lerp(_rC.set(K.x, lerp(9.5, 3.5, K.sd), K.z), oc.mode === 'kaiju' ? 1 - Math.exp(-4 * dt) : 1);
    const S = fw.show;
    if (P === 'ride' && ride.stompT > 0 && !oc.user) oc.auto = 'stomp';
    else if (P === 'ride' && S && S.cam) oc.auto = 'show';
    else if (oc.auto === 'stomp' || oc.auto === 'show') oc.auto = null;
    const r = Math.hypot(K.x, K.z) || 1, c = _rC2.set(-K.x / r, 0, -K.z / r);   // 往島的方向
    if (oc.auto === 'show') { off.copy(S.C).sub(A); look.copy(S.L).sub(A); w = 1.8; }   // 從島那側斜斜地看牠和牠頭上的天空
    else if (oc.auto === 'stomp') { set(M ? -26 : -22, M ? 4 : 6, M ? 26 : 22, 22, -12, c, _rT.set(-c.z, 0, c.x)); }   // 拉高轉過去看島：一圈浪從牠腳邊往島推過去
    else if (P === 'fly' || P === 'hover' || P === 'enter' || P === 'boot') {   // 坐進去、開機：從斜前方看駕駛艙，開機時慢慢繞到你選的角度
      const k = P === 'boot' ? smooth((ride.t - .5) / 1.4) : 0, V = VIEWS[oc.v].fp ? VIEWS[0] : { rel: oc.rel, el: oc.el, d: oc.d };
      const rel = lerp(.85, V.rel, k), el = lerp(.45, V.el, k), dd = lerp(M ? 36 : 28, V.fp ? 48 : V.d, k);
      off.set(Math.sin(K.h + rel) * Math.cos(el), Math.sin(el), Math.cos(K.h + rel) * Math.cos(el)).multiplyScalar(dd);
      look.copy(f).multiplyScalar(1.5).add(_rC.set(0, lerp(8, 0, k), 0));   // 看駕駛艙（頭頂）
    } else {   // 你選的角度
      const d = oc.d, el = oc.el, az = K.h + oc.rel;
      off.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
      look.copy(f).multiplyScalar(2).y += oc.ly * (1 - K.sd);
    }
  } else if (mode === 'pit') {   // 駕駛艙：從你的肩膀後面往前看（拖曳可以轉頭看旁邊）
    avatar.updateMatrixWorld(true);
    A = avatar.localToWorld(_rM.set(0, 1.72, .26));   // 比頭再高一點、往前一點：越過儀表板往外看
    pit.g.getWorldQuaternion(_sq);
    off.set(0, .02, -.05).applyQuaternion(_sq);
    const pt = oc.fp - (M ? .17 : .3);   // 手機直立畫面上下比較寬：少往下看一點，儀表板才不會太大
    look.set(Math.sin(oc.fy) * Math.cos(pt), Math.sin(pt), Math.cos(oc.fy) * Math.cos(pt)).applyQuaternion(_sq).multiplyScalar(14);
    w = 4;
  }
  if (mode !== oc.mode) {
    const cut = mode === 'pit' || oc.mode === 'pit';   // 進出駕駛艙視角：直接切過去（飛過去的話會穿過你的頭、出來時有一下子看著海）
    rcamFrom(A); oc.mode = mode; oc.L.copy(camera.position).addScaledVector(rcam.dir, rcam.ld); oc.Lv = 0;
    if (cut) {
      const d = off.length() || 1, L = _rT.copy(A).add(look);
      Object.assign(rcam, { d, az: Math.atan2(off.x, off.z), el: Math.asin(clamp(off.y / d, -1, 1)), vaz: 0, vel: 0, vd: 0, vyaw: 0, vpit: 0 });
      camera.position.copy(A).add(off);
      oc.L.copy(L); L.sub(camera.position);
      rcam.ld = L.length() || 1; rcam.yaw = Math.atan2(L.x, L.z); rcam.pit = Math.asin(clamp(L.y / rcam.ld, -1, 1));
    }
  }
  if (mode === 'kaiju') {   // 看的那一點在世界裡平滑地移過去（換構圖、煙火秀開始時不會一下子甩過去），方向一直對準它（繞著牠轉時不會轉丟）
    const D = _rT.copy(A).add(look).sub(oc.L), dl = D.length();
    oc.Lv = Math.min(oc.Lv + 90 * dt, 70, dl * 5);   // 速度：慢慢加速、最快每秒 70、快到了慢下來
    if (dl > 1e-4) oc.L.addScaledVector(D, Math.min(1, oc.Lv * dt / dl));
    look.copy(oc.L).sub(A);
  }
  const fp = mode === 'pit' && rcam.d < 1.5;   // 鏡頭進到駕駛艙：藏起你的頭和火焰板（不然整個畫面都是金色）
  AV.head.visible = !fp; aura.back.material.uniforms.uG.value = fp ? 0 : 1; aura.front.material.uniforms.uG.value = fp ? 0 : .35;
  for (const h of pit.halves) h.visible = !fp;   // 玻璃從裡面看邊緣會反白：駕駛艙視角時不畫
  rcamTo(off, look, dt, w, A, oc.snap > 0 && mode !== 'rider', mode === 'kaiju' ? 40 : mode === 'pit' ? 10 : 0, oc.snap > 0 ? 9 : mode === 'pit' ? 1.8 : 2.6);   // 看的方向每秒最多轉 150 度（駕駛艙 100 度：牠吼、跺腳時頭甩得快，畫面不跟著甩）
  if (mode !== 'pit') {
    const sb = !M && ui.side ? $('#sidebar').getBoundingClientRect() : null, cov = sb && sb.width > 0 ? clamp((innerWidth - sb.left) / innerWidth, 0, .5) : 0;   // 電腦右邊的清單蓋住多少：鏡頭往右平移，主角落在清單左邊那塊的中間
    if (cov) { const sh = cov * rcam.ld * camera.aspect * Math.tan(camera.fov * Math.PI / 360); camera.position.x += rcam.dir.z * sh * -1; camera.position.z += rcam.dir.x * sh; }
    camera.position.y = clamp(camera.position.y, groundY(camera.position.x, camera.position.z) + 1.4, cloudCeil(camera.position.x, camera.position.z) - 1);
  }
  if (ride.shake > 0) {   // 震一下：幾個不同頻率的晃動疊起來，慢慢停
    ride.shake = Math.max(0, ride.shake - dt * 1.8);
    const a = ride.shake * ride.shake * (mode === 'pit' ? .12 : .35), q = performance.now() / 1000;
    camera.position.x += Math.sin(q * 27) * a; camera.position.y += Math.sin(q * 33 + 1) * a; camera.position.z += Math.sin(q * 29 + 2) * a;
  }
  controls.target.copy(camera.position).addScaledVector(rcam.dir, rcam.ld);   // 聲音以這一點當耳朵
  camera.lookAt(controls.target);
}

/* 騎著時拖曳畫面＝轉鏡頭、兩指／滾輪縮放、點一下＝往那裡噴火；噴火的時候手指拖到哪火就跟到哪；電腦滑鼠指著就是瞄準 */
const rp = new Map();
function ridePointer(type, e) {
  const Q = rp.get(e.pointerId), firing = KJ.mode === 'roar' && KJ.rFree;
  if (type === 'down') {
    if (e.target !== renderer.domElement) return;
    rp.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, aim: firing && e.pointerType !== 'mouse' });
    if (firing && e.pointerType !== 'mouse') aimScreen(e);
    if (rp.size === 2) { const [a, b] = [...rp.values()]; oc.pinch = Math.hypot(a.x - b.x, a.y - b.y) || 1; oc.pd = oc.d; }
    return;
  }
  if (type === 'move') {
    if (!Q) { if (e.pointerType === 'mouse' && e.target === renderer.domElement && ride.phase === 'ride') aimScreen(e); return; }   // 滑鼠移動：瞄準（頭跟著看）
    const dx = e.clientX - Q.x, dy = e.clientY - Q.y;
    Q.x = e.clientX; Q.y = e.clientY;
    if (Math.hypot(Q.x - Q.x0, Q.y - Q.y0) > 8) Q.moved = true;
    if (rp.size >= 2) { if (oc.pinch) { const [a, b] = [...rp.values()]; camTakeOver(); oc.d = clamp(oc.pd * oc.pinch / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 12, 110); oc.snap = .25; } return; }
    if (Q.aim || (firing && e.pointerType !== 'mouse')) { Q.aim = true; aimScreen(e); return; }   // 正在噴火：手指拖到哪火就往哪
    if (Q.moved) camDrag(dx, dy);
    if (e.pointerType === 'mouse') aimScreen(e);
    return;
  }
  if (!Q) return;
  rp.delete(e.pointerId);
  if (rp.size < 2) oc.pinch = 0;
  if (Q.aim) { aim.mode = 'world'; aim.t = 2.5; }   // 放開：停在最後瞄的地方
  else if (type === 'up' && !Q.moved && performance.now() - Q.t0 < 500) rideFireAt(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}
renderer.domElement.addEventListener('wheel', e => { if (!ride.phase) return; e.preventDefault(); camZoom(Math.exp(clamp(e.deltaY, -120, 120) * .0016)); }, { passive: false });

/* 介面：開的時候下面一排按鈕（吼／跺腳／煙火／鏡頭／下來）；「吼」按住會亮起蓄力條 */
const rideHud = $('#ride-hud'), rhRoar = $('#rh-roar'), rhStomp = $('#rh-stomp'), rhWorks = $('#rh-works'), rhView = $('#rh-view'), rhOff = $('#rh-off'), rhRoarText = rhRoar.querySelector('span'), rhViewText = rhView.querySelector('span');
rhRoar.addEventListener('pointerdown', e => { e.preventDefault(); try { rhRoar.setPointerCapture(e.pointerId); } catch (er) {} rideRoarDown(); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rhRoar.addEventListener(type, rideRoarUp);
rhStomp.addEventListener('click', rideStomp);
rhWorks.addEventListener('click', rideWorks);
rhView.addEventListener('click', () => rideView());
rhOff.addEventListener('click', rideExit);
const hudState = { roar: '', chg: '' };
function rideHudSync() {
  const on = ride.phase === 'ride';
  if (rideHud.hidden === on) rideHud.hidden = !on;
  if (!on) return;
  const K = KJ, free = rideFree(), lbl = K.chg >= 1 ? '放開！' : K.chg > 0 ? '蓄力中' : '吼', c = K.chg.toFixed(2);
  rhRoar.disabled = !free && ride.hold < 0;
  rhStomp.disabled = rhWorks.disabled = !free;
  if (hudState.roar !== lbl) { hudState.roar = lbl; rhRoarText.textContent = lbl; rhRoar.classList.toggle('ready', K.chg >= 1); }
  if (hudState.chg !== c) { hudState.chg = c; rhRoar.style.setProperty('--chg', c); }
}

/* 跺腳的浪：一圈白浪從腳邊往外推，浪推到哪裡、哪裡就有反應（海豚順著浪連跳、魚嚇得跳出水面、碼頭的飛船晃、寄居蟹縮殼、海鳥飛起來、阿滿叫、花捲嚇一跳、柑仔丁跳起來） */
let shipRock = 0, foamSurge = 0;
const wave = (() => {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uR: { value: 0 }, uA: { value: 0 }, uO: { value: new THREE.Vector2() } },
    vertexShader: `uniform vec2 uO; varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz - uO; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uR, uA; varying vec2 vP;
      void main() { float d = length(vP), x = d - uR;
        float crest = exp(-x * x * .45), back = smoothstep(-12.0, -1.5, x) * (1.0 - smoothstep(-1.5, .8, x)) * .4;   // 一道白浪頭，後面拖一片淡淡的白沫
        float n = .75 + .25 * sin(atan(vP.y, vP.x) * 46.0 + d * 1.7);
        gl_FragColor = vec4(1.0, 1.0, 1.0, min(1.0, crest * n * 1.1 + back) * uA); }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
  m.visible = false; m.frustumCulled = false; m.renderOrder = 1;
  scene.add(m);
  return { m, mat, on: false, x: 0, z: 0, R: 0, max: 0, hits: [] };
})();
const _wv = new THREE.Vector3();
function startWave(x, z) {
  const W = wave, a = Math.atan2(z, x), shore = polar(a, 1.06);
  Object.assign(W, { on: true, x, z, R: 1.5, max: Math.hypot(x, z) + 30 });
  W.m.position.set(x, .3, z); W.m.scale.setScalar(W.max); W.mat.uniforms.uO.value.set(x, z);
  W.hits = [
    { at: () => _wv.set(pod.x, 0, pod.z), fire: dolphinsRide },
    { at: () => _wv.set(shore[0], 0, shore[1]), fire: () => { foamSurge = 1; fishLeap(a); for (const b of birds) b.userData.sc = 1; sfx('gull', birds[0]); } },
    { at: () => _wv.set(SHIP.x, 0, SHIP.z), fire: () => { shipRock = 1; sfx('land', ship); } },
    ...crabs.map(c => ({ at: () => c.g.position, fire: () => { c.hide = 4.5; } })),
    { at: () => dog.g.position, fire: dogStartle },
    { at: () => cat.g.position, fire: catStartle },
    { at: () => blob.g.position, fire: () => { blob.jolt = .6; bubble(blob.g, '！', 1.0); } },
  ];
}
function updateWave(dt) {
  const W = wave;
  if (!W.on) return;
  W.R += 17 * dt;
  W.m.visible = true;
  W.mat.uniforms.uR.value = W.R;
  W.mat.uniforms.uA.value = smooth(W.R / 4) * (1 - smooth((W.R - W.max + 14) / 14)) * .85;
  for (const h of W.hits) if (!h.done && Math.hypot(h.at().x - W.x, h.at().z - W.z) <= W.R) { h.done = true; h.fire(); }
  if (W.R >= W.max) { W.on = false; W.m.visible = false; }
}
function dolphinsRide() {   // 海豚順著浪一隻接一隻連跳
  if (!pod.show && !dolphins.some(d => d.tr)) { pod.show = { k: 'wave', t: 3.2, v0: pod.vT }; pod.form = 1; pod.vT = 3.6; dolphins.forEach((d, i) => d.nh = .15 + i * .25); }
  else dolphins.forEach(d => dolTrick(d, 'jump'));
  sfx('whistle', dolphins[0].g);
}
function fishLeap(a) { fishes.forEach((f, i) => { if (f.u < 0) { f.t = .1 + i * .22; f.fa = a + (i - 1) * .3; } }); }   // 三條魚在浪打上岸的地方嚇得跳出水面
function dogStartle() {
  const D = dog;
  if (night > .85 || D.state === 'sleep' || D.state === 'bed') return bubble(D.g, 'Zzz…？', 1.1);
  if (D.state !== 'fetch' && D.state !== 'bring') Object.assign(D, { path: null, state: 'idle', t: 4 });
  D.petT = 2;
  D.g.rotation.y = Math.atan2(KJ.x - D.g.position.x, KJ.z - D.g.position.z);
  bubble(D.g, '汪汪！', 1.25);
}
function catStartle() {
  const c = cat;
  if (c.jump) return;
  bubble(c.g, '喵！', .75);
  c.awakeT = Math.max(c.awakeT, 4);
  if (c.state === 'nap' || c.state === 'idle') c.jump = { from: c.g.position.clone(), to: c.g.position.clone(), t: 0, up: c.perch, next: 'idle' };   // 嚇得原地跳起來
}

/* 煙火秀（約 20 秒）：天色暗下來、你打開艙蓋站起來歡呼；牠舉起雙手——
   八根槍管手指輪流發射大朵的牡丹和菊花 → 背鰭從尾巴到頭一節節射出金色分裂彈，排成一道拱門 →
   拼出形狀：像素蜜蜂、小蜜蜂最高分、拿到的鑰匙、島民的臉（還沒有紀錄或鑰匙就換成星星和愛心） → 最後抬頭張嘴發射一顆大的金色垂柳收尾 */
const FW_N = 9000;
const fw = (() => {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(FW_N * 3).fill(-999), col = new Float32Array(FW_N * 3), dat = new Float32Array(FW_N * 2);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aDat', new THREE.BufferAttribute(dat, 2));
  const mat = new THREE.ShaderMaterial({   // 晚上像光一樣疊加；白天會蓋住一點後面的天空，顏色才看得出來
    uniforms: { uScale: { value: 600 }, uDay: { value: 0 } },
    vertexShader: `attribute vec3 aCol; attribute vec2 aDat; uniform float uScale; varying vec3 vCol; varying float vA;
      void main() { vCol = aCol; vA = aDat.x; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aDat.x <= 0.0 ? 0.0 : min(220.0, aDat.y * uScale / -mv.z); }`,
    fragmentShader: `uniform float uDay; varying vec3 vCol; varying float vA;
      void main() { float r = length(gl_PointCoord - .5) * 2.0; if (r > 1.0) discard;
        float core = exp(-r * r * 9.0), halo = (1.0 - r) * (1.0 - r), a = vA * (core + halo * .5);
        gl_FragColor = vec4(mix(vCol, vec3(1.0), core * .6) * a, min(1.0, a * uDay)); }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false; m.visible = false;
  scene.add(m);
  const light = new THREE.PointLight(0xffffff, 0, 0, 1.4);   // 炸開那一下把巨獸、島和海照亮
  scene.add(light);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: KJ_HALO.map, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));   // 海面上的倒影：一大片跟著煙火顏色閃的光
  sea.position.y = .25; sea.scale.setScalar(150); sea.visible = false; sea.renderOrder = 1;
  scene.add(sea);
  const N = FW_N;
  return { m, mat, pos, col, dat, vel: new Float32Array(N * 3), tgt: new Float32Array(N * 3), age: new Float32Array(N), life: new Float32Array(N), hold: new Float32Array(N), drag: new Float32Array(N), grav: new Float32Array(N), trl: new Float32Array(N), trT: new Float32Array(N), spl: new Float32Array(N), kind: new Uint8Array(N), i: 0, rockets: [], show: null, light, lk: 0, sea };
})();
let showNight = 0;   // 放煙火時天色暗下來（日夜那邊讀）
const FW_GLYPH = {   // 5×7 點陣數字
  0: [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '], 1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'], 3: ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '], 5: ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  6: ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '], 7: ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  8: [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '], 9: [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
};
const FW_SHAPE = {   // 自己畫的點陣圖：字母＝顏色；黑色放不出來，眼睛、鼻子留空
  bee: { rows: ['..a...a..', '...a.a...', 'ww.YYY.ww', 'wwwRYRwww', '.wwYYYww.', '...OOO...', '...YYY...', '...OOO...', '....Y....'], col: { a: 0xffd84a, Y: 0xffd23a, w: 0xdff0ff, R: 0xff4646, O: 0xff7a1a } },
  heart: { rows: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], col: { X: 0xff5a8a } },
  star: { rows: ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'XX...XX'], col: { X: 0xffd23a } },
  key: { rows: ['.XXX......', 'X...X.....', 'X...XXXXXX', 'X...X..X.X', '.XXX......'], col: {} },
  dog: { rows: ['O.......O', 'OO.....OO', 'OOOOOOOOO', 'OO.OOO.OO', 'OWWWOWWWO', '.WWW.WWW.', '..WWWWW..'], col: { O: 0xff9a3c, W: 0xfff2dc } },   // 阿滿：柴犬的臉，白色兩頰
  cat: { rows: ['P.......O', 'PP.....OO', 'PPWWWWOOO', 'PW.WWW.WO', 'WWWWWWWWW', 'WWWWRWWWW', '.WWWWWWW.'], col: { P: 0xb98cff, O: 0xff9a3c, W: 0xfff2dc, R: 0xff7aa8 } },   // 花捲：三花（黑色那塊用紫色）
  kaiju: { rows: ['....S....', '...SS....', 'GGGGGGGGG', 'GRRRGRRRG', 'GGGGGGGGG', 'GGGGGGGGG', '.TGTGTGT.'], col: { S: 0xe6eef7, G: 0x9fb8d0, R: 0xff3a2a, T: 0xffffff } },   // 機械巨獸：積木頭、橫的紅眼睛、頭頂的冠
  hermit: { rows: ['..YYYYY..', '.YYYYYYY.', 'YYYYYYYYY', 'YYSSSSSYY', 'YS.SSS.SY', 'YSSSSSSSY', '.YSS.SSY.', '..SSSSS..'], col: { Y: 0xffc53a, S: 0xffd9b0 } },   // 你：金色爆炸頭
};
const rgb = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
function fwDots(rows, col, sp, dx = 0, fixed = null) {   // 點陣 → [左右, 上下, 顏色]（以圖的中間為原點）
  const out = [], H = rows.length, W = rows[0].length;
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.' && ch !== ' ') out.push([dx + (x - (W - 1) / 2) * sp, ((H - 1) / 2 - y) * sp, fixed ?? col[ch] ?? 0xffffff]); }));
  return out;
}
const FIN_TIP = kj.fins.map(m => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - .2, (b.min.z + b.max.z) / 2); });   // 每一節背鰭的尖端（發射口）
const fingerWorld = (i, out) => out.set([-.66, .66, -.22, .22][i >> 1] * (i % 2 ? -1 : 1), -3.5, .2).applyMatrix4(kj.arms[i % 2].el.matrixWorld);   // 第 i 根手指的槍口：外側的先，左右手交替
const mouthWorld = out => out.set(0, 1.0, 5.3).applyMatrix4(kj.head.matrixWorld);
function startShow() {   // 排好每一發要從哪裡射、炸在哪裡（鏡頭從島那側斜斜地往上看：牠在下面，煙火炸滿牠頭上的天空）
  const K = KJ, M = camera.aspect < .85, toI = new THREE.Vector3(-K.x, 0, -K.z).normalize();
  const cv = new THREE.Vector3(camera.position.x - K.x, 0, camera.position.z - K.z).normalize(), dA = toI.clone().applyAxisAngle(_UP, .88), dB = toI.clone().applyAxisAngle(_UP, -.88), dir = dA.dot(cv) > dB.dot(cv) ? dA : dB;   // 偏向你原本在看的那一側
  const D = M ? 100 : 84, C = new THREE.Vector3(K.x + dir.x * D, M ? 5 : 4, K.z + dir.z * D), L = new THREE.Vector3(K.x - dir.x * 6, M ? 34 : 28, K.z - dir.z * 6);   // 拍得到整隻（腳在水裡）和上面一大片天空
  const f = L.clone().sub(C).normalize(), rt = new THREE.Vector3().crossVectors(f, _UP).normalize(), up = new THREE.Vector3().crossVectors(rt, f);
  const sb = !M && ui.side ? $('#sidebar').getBoundingClientRect() : null, cov = sb && sb.width > 0 ? clamp((innerWidth - sb.left) / innerWidth, 0, .5) : 0;   // 電腦右邊的清單蓋住多少
  const hh = C.distanceTo(L) * Math.tan(baseFov() * Math.PI / 360), hw = hh * camera.aspect * (1 - cov);   // 只排在清單左邊看得到的那一塊（鏡頭會往右平移，那一塊的中間就是 L）
  const at = (x, y) => L.clone().addScaledVector(rt, x * hw).addScaledVector(up, y * hh);
  const fit = (cols, base, frac = .62) => Math.min(base, frac * 2 * hw / cols);   // 點的間距：圖太寬就縮小
  const best = Math.floor(records.bee.best), keys = KEYS.filter(k => keyState[k.id]), digits = best > 0 ? String(best) : '';
  const shape = (name, sp) => fwDots(FW_SHAPE[name].rows, FW_SHAPE[name].col, sp);
  const dsp = fit(digits.length * 6, 1.9, M ? .8 : .5), ksp = fit(keys.length * 12, 1.5, M ? .8 : .55), ssp = M ? fit(9, 1.6, .38) : 1.9;
  const numDots = digits ? [...digits].flatMap((ch, j) => fwDots(FW_GLYPH[ch], null, dsp, (j - (digits.length - 1) / 2) * 6 * dsp, 0xffcf3a)) : shape('star', ssp * 1.1);
  const keyDots = keys.length ? keys.flatMap((k, j) => fwDots(FW_SHAPE.key.rows, null, ksp, (j - (keys.length - 1) / 2) * 12 * ksp, k.hex)) : shape('heart', ssp * 1.1);
  const ev = [], fh = Math.atan2(dir.x * .55 + toI.x * .45, dir.z * .55 + toI.z * .45), S = { C, L, rt, up, f, t: 0, end: 19.6, ev, ei: 0, h: fh, cam: true, big: M ? .78 : 1 };
  const finger = (t, i, x, y, spec, T = 1.25) => ev.push({ t, go: () => { const P = fingerWorld(i, new THREE.Vector3()); KJ.rc[i % 2] = 1; fwRocket(P, at(x, y), T, spec); } });
  // 1. 手指輪流發射：大朵的牡丹、菊花
  const F1 = M ? [[-.4, .5], [.42, .4], [-.3, .2], [.36, .66], [-.45, .02], [.45, .12], [0, .32], [0, .72]] : [[-.62, .4], [.62, .44], [-.32, .62], [.3, .6], [-.74, .06], [.76, .1], [-.06, .34], [.12, .7]];
  const C1 = [0xffc53a, 0x4ad8ff, 0xff6fb0, 0x7dff6a, 0xb27bff, 0xff8a2a, 0xfff4e0, 0xff4a3a];
  for (let i = 0; i < 8; i++) finger(2.0 + i * .26, i, ...F1[i], { kind: i % 2 ? 'chrys' : 'peony', col: C1[i] });
  // 2. 背鰭從尾巴到頭一節節射出金色分裂彈：排成一道拱門
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (.93 - i / 8 * .86), x = Math.cos(a) * (M ? .62 : .58), y = (M ? .04 : -.02) + Math.sin(a) * (M ? .5 : .56);
    ev.push({ t: 4.7 + i * .17, go: () => { const P = FIN_TIP[i].clone().applyMatrix4(kj.fins[i].matrixWorld); KJ.ff[i] = 1; fwRocket(P, at(x, y), 1.05, { kind: 'cross', col: i % 2 ? 0xfff0c0 : 0xffc53a }, .8, true); } });
  }
  // 3. 拼形狀：蜜蜂＋小蜜蜂最高分 → 鑰匙＋阿滿＋花捲 → 巨獸＋你＋愛心
  const R = M ? { bee: [0, .62], num: [0, .22], keys: [0, .64], dog: [-.42, .26], cat: [.42, .26], kj: [-.42, .56], me: [.42, .56], heart: [0, .18] }
    : { bee: [-.56, .38], num: [.18, .5], keys: [0, .6], dog: [-.58, .26], cat: [.58, .26], kj: [-.52, .42], me: [.52, .42], heart: [0, .62] };
  finger(7.2, 0, ...R.bee, { kind: 'shape', dots: shape('bee', ssp), col: 0xffd23a }, 1.4);
  finger(7.45, 1, ...R.num, { kind: 'shape', dots: numDots, col: 0xffcf3a }, 1.5);
  finger(9.7, 3, ...R.keys, { kind: 'shape', dots: keyDots, col: keys.length ? keys[0].hex : 0xff5a8a }, 1.45);
  finger(9.85, 2, ...R.dog, { kind: 'shape', dots: shape('dog', ssp), col: 0xff9a3c }, 1.3);
  finger(10.0, 5, ...R.cat, { kind: 'shape', dots: shape('cat', ssp), col: 0xfff2dc }, 1.3);
  finger(12.1, 4, ...R.kj, { kind: 'shape', dots: shape('kaiju', ssp), col: 0x9fb8d0 }, 1.3);
  finger(12.25, 7, ...R.me, { kind: 'shape', dots: shape('hermit', ssp), col: 0xffc53a }, 1.3);
  finger(12.5, 6, ...R.heart, { kind: 'shape', dots: shape('heart', ssp * 1.15), col: 0xff5a8a }, 1.45);
  // 4. 收尾：抬頭張嘴發射一顆大的金色垂柳，兩邊手指補兩圈環
  ev.push({ t: 14.3, go: () => { const P = mouthWorld(new THREE.Vector3()); KJ.mk = 1; fwRocket(P, at(0, M ? .5 : .52), 1.7, { kind: 'willow', col: 0xffc85a }, 1.6); sfx('mortar', P); } });
  finger(15.15, 0, M ? -.3 : -.6, M ? .12 : .3, { kind: 'ring', col: 0x4ad8ff });
  finger(15.3, 1, M ? .3 : .6, M ? .12 : .3, { kind: 'ring', col: 0xff6fb0 });
  ev.push({ t: 16.1, go: () => { dogStartle(); bubble(cat.g, '喵～', .75); dolphins.forEach(d => dolTrick(d, 'jump')); } });   // 島上的大家抬頭看
  ev.sort((a, b) => a.t - b.t);
  fw.show = S;
  showNight = 1;
  const v = new THREE.Vector3();
  CLOUD.forEach(Cl => { cloudWorld(Cl.c, v).sub(C); if (v.dot(f) > 0 && v.normalize().dot(f) > .78) cloudBurn(Cl.i, true); });   // 擋在煙火前面的雲先散掉
  const n = num('sanasai_fireworks') + 1;
  ls.set('sanasai_fireworks', String(n));
  if (n === 1) addLog('pet', '機械巨獸第一次放煙火');
}
function endShow() {   // 放完（或你中途下來）：天色亮回來、艙蓋關上、你坐回去
  fw.show = null; showNight = 0;
  if (KJ.mode === 'works') { KJ.mode = 'stand'; KJ.t = 3; }
}
function updateShow(dt) {
  const S = fw.show;
  if (!S) return;
  S.t += dt;
  while (S.ei < S.ev.length && S.t >= S.ev[S.ei].t) S.ev[S.ei++].go();
  if (S.t > S.end - .7) showNight = 0;   // 金柳快落完：天色開始亮回來
  if (S.t >= S.end) endShow();
}
function fwSpawn(kind, x, y, z, vx, vy, vz, c, size, life, hold = 0, drag = 1.3, grav = 3.2, trail = 0, split = 0) {
  const F = fw, i = F.i = (F.i + 1) % FW_N, [r, g, b] = typeof c === 'number' ? rgb(c) : c;
  F.kind[i] = kind; F.age[i] = 0; F.life[i] = life; F.hold[i] = hold; F.drag[i] = drag; F.grav[i] = grav; F.trl[i] = trail; F.trT[i] = 0; F.spl[i] = split;
  F.pos.set([x, y, z], i * 3); F.vel.set([vx, vy, vz], i * 3); F.col.set([r, g, b], i * 3);
  F.dat[i * 2] = 1; F.dat[i * 2 + 1] = size;
  return i;
}
function fwRocket(P, at, T, sp, big = 1, spin = false) {   // 從 P 射出去，照拋物線飛 T 秒到 at 炸開：槍口一團火光和煙、一路拖著粗粗的火光尾巴
  const g = 9, v = at.clone().sub(P).divideScalar(T);
  v.y += .5 * g * T;
  fw.rockets.push({ p: P.clone(), q: P.clone(), v, g, t: 0, T, sp, big, spin: spin ? Math.random() * TAU : -1 });
  const B = (fw.show ? fw.show.big : 1) * big;
  fwSpawn(4, P.x, P.y, P.z, 0, 0, 0, 0xfff0c0, 8 * B, .26);
  for (let k = 0; k < 14; k++) { _fwv.randomDirection().multiplyScalar(4 + Math.random() * 4); fwSpawn(2, P.x, P.y, P.z, _fwv.x + v.x * .15, _fwv.y + v.y * .15, _fwv.z + v.z * .15, 0xffd890, 1.1, .45 + Math.random() * .3); }
  steamPuff(P.x, P.y, P.z, 3.2 * big, 1.7, .9, 0, 1.4, 0);
  sfx('fwLaunch', P, big);
}
const _fwv = new THREE.Vector3(), _fwa = new THREE.Vector3(), _fwb = new THREE.Vector3();
function fwBurst(sp, p, big) {
  const S = fw.show, [r, g, b] = rgb(sp.col), B = (S ? S.big : 1) * (sp.kind === 'willow' ? 1.25 : 1);
  fwSpawn(4, p.x, p.y, p.z, 0, 0, 0, 0xffffff, 18 * B * big, .32);
  fw.light.position.copy(p); fw.light.color.setRGB(r, g, b); fw.lk = Math.min(1.5, fw.lk + (sp.kind === 'willow' ? 1.4 : .75));
  fw.sea.position.set(p.x, .25, p.z); fw.sea.material.color.setRGB(r, g, b);
  sfx(sp.kind === 'willow' ? 'fwBig' : 'fwBurst', p, sp.kind === 'shape' ? 1 : .85);
  const tint = k => [lerp(r, 1, k), lerp(g, 1, k), lerp(b, 1, k)];
  const ball = (n, v0, life, size, trail = 0, drag = 1.3, grav = 3.2) => {
    for (let k = 0; k < n; k++) { _fwv.randomDirection().multiplyScalar(v0 * B * (.88 + Math.random() * .24)); fwSpawn(1, p.x, p.y, p.z, _fwv.x, _fwv.y, _fwv.z, tint(Math.random() * .25), size, life * (.85 + Math.random() * .3), 0, drag, grav, trail); }
  };
  if (sp.kind === 'peony') ball(210, 25, 2.0, 1.55);
  else if (sp.kind === 'chrys') ball(150, 23, 2.2, 1.3, .05);   // 菊花：每一顆拖著尾巴
  else if (sp.kind === 'willow') { ball(380, 31, 5.2, 1.7, .05, 1.15, 2.8); for (let k = 0; k < 90; k++) { _fwv.randomDirection().multiplyScalar(20 * B); fwSpawn(5, p.x, p.y, p.z, _fwv.x, _fwv.y, _fwv.z, 0xfff6e0, 1.15, 3.6 + Math.random() * 1.2, 0, 1.2, 2.6); } }   // 金色垂柳：最大的一朵，拖著金色的尾巴慢慢垂下來、一路閃
  else if (sp.kind === 'cross') { ball(70, 13, 1.3, 1.2); for (let k = 0; k < 10; k++) { _fwv.randomDirection().multiplyScalar(17 * B); fwSpawn(1, p.x, p.y, p.z, _fwv.x, _fwv.y, _fwv.z, tint(.1), 1.7, 1.9, 0, 1.15, 2.6, .04, .5); } }   // 分裂彈：一朵小金花，再有十顆星飛出去、過一下各自炸成四顆
  else if (sp.kind === 'ring') {   // 一圈：在面向鏡頭的平面上
    const ra = S ? S.rt : _fwa.set(1, 0, 0), ua = S ? S.up : _fwb.set(0, 1, 0);
    for (let k = 0; k < 120; k++) { const a = k / 120 * TAU; _fwv.copy(ra).multiplyScalar(Math.cos(a) * 21 * B).addScaledVector(ua, Math.sin(a) * 21 * B); fwSpawn(1, p.x, p.y, p.z, _fwv.x, _fwv.y, _fwv.z, tint(.15), 1.45, 1.9 + Math.random() * .3); }
  } else {   // 拼成形狀：每一點從中間飛到自己的位置，停一下、閃一閃，再慢慢落下、淡掉
    for (const [dx, dy, c] of sp.dots) {
      const i = fwSpawn(3, p.x, p.y, p.z, p.x, p.y, p.z, c, 1.75, 3.6, 2.3);
      _fwv.copy(p).addScaledVector(S.rt, dx).addScaledVector(S.up, dy);
      fw.tgt.set([_fwv.x, _fwv.y, _fwv.z], i * 3);
    }
    for (let k = 0; k < 40; k++) { _fwv.randomDirection().multiplyScalar(7 * B); fwSpawn(1, p.x, p.y, p.z, _fwv.x, _fwv.y, _fwv.z, tint(.3), .9, 1.1 + Math.random() * .4); }
  }
}
function updateFireworks(dt) {
  const F = fw;
  for (const R of F.rockets) {   // 飛行中的火箭：粗粗的火光尾巴（背鰭射的會螺旋）
    R.t += dt; R.v.y -= R.g * dt; R.q.copy(R.p); R.p.addScaledVector(R.v, dt);
    const B = (F.show ? F.show.big : 1) * R.big;
    let x = R.p.x, y = R.p.y, z = R.p.z;
    if (R.spin >= 0) { R.spin += dt * 16; _fwa.set(R.v.z, 0, -R.v.x).normalize(); x += _fwa.x * Math.cos(R.spin) * .9; z += _fwa.z * Math.cos(R.spin) * .9; y += Math.sin(R.spin) * .9; }
    for (let k = 0; k < 4; k++) { const u = k / 4; fwSpawn(2, lerp(R.q.x, x, u), lerp(R.q.y, y, u), lerp(R.q.z, z, u), (Math.random() - .5) * 1.2, -.8 - Math.random() * .9, (Math.random() - .5) * 1.2, R.spin >= 0 ? 0xfff0b0 : 0xffd890, 1.15 * B, .5 + Math.random() * .25); }
    fwSpawn(4, x, y, z, 0, 0, 0, 0xfff6d8, 2.8 * B, .05);   // 火箭頭
    if (R.t >= R.T) { R.done = true; fwBurst(R.sp, _fwa.set(x, y, z), R.big); }
  }
  if (F.rockets.some(R => R.done)) F.rockets = F.rockets.filter(R => !R.done);
  F.lk = Math.max(0, F.lk - dt * 2.6);
  F.light.intensity = F.lk * F.lk * (60 + night * 1100);
  F.sea.visible = F.lk > .01;
  F.sea.material.opacity = Math.min(1, F.lk) * (.12 + night * .45);
  F.mat.uniforms.uDay.value = 1 - night * .92;
  let any = F.rockets.length > 0, budget = 900;   // budget：這一幀最多再生幾顆尾巴（顆粒不夠時舊的會被蓋掉）
  for (let i = 0; i < FW_N; i++) {
    const kd = F.kind[i];
    if (!kd) continue;
    any = true;
    const o = i * 3, a = (F.age[i] += dt), k = a / F.life[i];
    if (k >= 1) { F.kind[i] = 0; F.dat[i * 2] = 0; F.pos[o + 1] = -999; continue; }
    if (kd === 1 || kd === 5) {   // 星：散開、空氣阻力、慢慢往下掉；最後閃一閃（5＝一路閃的亮片）
      const dr = Math.max(0, 1 - F.drag[i] * dt);
      F.vel[o] *= dr; F.vel[o + 1] = F.vel[o + 1] * dr - F.grav[i] * dt; F.vel[o + 2] *= dr;
      F.pos[o] += F.vel[o] * dt; F.pos[o + 1] += F.vel[o + 1] * dt; F.pos[o + 2] += F.vel[o + 2] * dt;
      F.dat[i * 2] = kd === 5 ? (Math.sin(a * 47 + i * 2.3) > .2 ? 1 : .12) * (1 - k) : Math.pow(1 - k, 1.1) * (k > .6 ? .6 + .4 * Math.sin(a * 38 + i) : 1);
      if (F.trl[i] > 0 && budget > 0 && (F.trT[i] += dt) >= F.trl[i]) {   // 拖尾巴
        F.trT[i] = 0; budget--;
        const c = F.col.subarray(o, o + 3);
        fwSpawn(2, F.pos[o], F.pos[o + 1], F.pos[o + 2], 0, -.4, 0, [c[0] * .85, c[1] * .7, c[2] * .5], F.dat[i * 2 + 1] * .7, .7);
      }
      if (F.spl[i] > 0 && a >= F.spl[i]) {   // 分裂：這一顆炸成四顆
        F.spl[i] = 0;
        const c = [F.col[o], F.col[o + 1], F.col[o + 2]], px = F.pos[o], py = F.pos[o + 1], pz = F.pos[o + 2];
        for (let q = 0; q < 4; q++) { _fwv.randomDirection().multiplyScalar(10); fwSpawn(1, px, py, pz, _fwv.x + F.vel[o] * .3, _fwv.y + F.vel[o + 1] * .3, _fwv.z + F.vel[o + 2] * .3, c, 1.35, 1.2, 0, 1.3, 3, .05); }
        F.kind[i] = 0; F.dat[i * 2] = 0; F.pos[o + 1] = -999;
      }
    } else if (kd === 2) {   // 火星、尾巴
      F.pos[o] += F.vel[o] * dt; F.pos[o + 1] += F.vel[o + 1] * dt; F.pos[o + 2] += F.vel[o + 2] * dt;
      F.dat[i * 2] = (1 - k) * .75;
    } else if (kd === 3) {   // 拼形狀的點：vel 記的是炸開的中心
      const H = F.hold[i], e = 1 - Math.pow(1 - Math.min(1, a / .35), 3), fall = Math.max(0, a - H);
      F.pos[o] = lerp(F.vel[o], F.tgt[o], e); F.pos[o + 1] = lerp(F.vel[o + 1], F.tgt[o + 1], e) - 1.6 * fall * fall; F.pos[o + 2] = lerp(F.vel[o + 2], F.tgt[o + 2], e);
      F.dat[i * 2] = (a < H ? .85 + .15 * Math.sin(a * 25 + i * 1.7) : 1 - (a - H) / (F.life[i] - H));
    } else F.dat[i * 2] = Math.pow(1 - k, 2);   // 閃光
  }
  F.m.visible = any;
  if (any) {
    const G = F.m.geometry.attributes;
    G.position.needsUpdate = G.aCol.needsUpdate = G.aDat.needsUpdate = true;
    F.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
}

/* 合體大招的金色光束：一根很粗的光柱（中間白、外面金）從嘴巴射出去；前面有罩子就打在罩子上（發白、漣漪），不然打在外海的海面上炸起一根水柱 */
const beamFx = (() => {
  const mk = core => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 0 }, uCore: { value: core }, uC: { value: new THREE.Color(1, .6, .06) } },
      vertexShader: `varying vec3 vN, vV; varying float vY;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vY = uv.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uT, uA, uCore; uniform vec3 uC; varying vec3 vN, vV; varying float vY;
        void main() { float f = abs(dot(normalize(vN), normalize(vV))), c = pow(f, 1.6), flow = .8 + .2 * sin(vY * 70.0 - uT * 45.0);
          gl_FragColor = vec4(mix(uC, vec3(1.0, .98, .9), c * uCore), c * uA * flow); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), mat);
    m.visible = false; m.frustumCulled = false; m.renderOrder = 2;
    scene.add(m);
    return m;
  };
  const tip = glowSprite('rgba(255,250,225,1)', 'rgba(255,190,60,.55)', 6), hit = glowSprite('rgba(255,252,235,1)', 'rgba(255,170,40,.5)', 11);
  tip.visible = hit.visible = false;
  return { core: mk(1), glow: mk(0), tip, hit, a: 0, live: 0, spl: 0, sky: false, E: new THREE.Vector3() };
})();
const _bm = new THREE.Vector3();
function kjBeam(P, D, dt) {   // 巨獸噴大招的那幾秒每一幀呼叫：先打到罩子、海面還是雲就停在那裡，都沒有就一路射上天
  const B = beamFx, tH = shieldHitT(P, D), tS = D.y < -.02 ? (P.y - .2) / -D.y : Infinity, c = cloudRay(P, D);
  let L = 190, hit = 'sky';
  if (tH > 0 && tH < L) { L = tH; hit = 'isle'; }
  if (tS < L) { L = tS; hit = 'sea'; }
  if (c.t < L) { L = c.t; hit = 'cloud'; }
  B.sky = hit === 'sky';
  B.E.copy(P).addScaledVector(D, L);
  B.live = .12;
  _bm.copy(P).add(B.E).multiplyScalar(.5);
  const t = performance.now() / 1000, w = 1 + .1 * Math.sin(t * 37);
  for (const [m, rr] of [[B.core, .75], [B.glow, 1.9]]) { m.position.copy(_bm); m.quaternion.setFromUnitVectors(_UP, D); m.scale.set(rr * w, L, rr * w); }
  B.tip.position.copy(P); B.hit.position.copy(B.E);
  if (hit === 'cloud') cloudBurn(c.i);   // 雲一打就散
  else if (hit === 'isle') {   // 打在罩子上
    SH.hit = 1;
    _shD.set(B.E.x / SHIELD_R, B.E.y / SHIELD_H, B.E.z / SHIELD_R).normalize();
    shield.mat.uniforms.uDir.value.lerp(_shD, .3).normalize();
  } else if (hit === 'sea' && (B.spl -= dt) <= 0) {   // 打在海面上：一直炸起水柱、冒蒸氣（掃過去就是一排）
    B.spl = .07;
    kjBurst(B.E.x, .3, B.E.z, 26, 3.5, 17);
    steamPuff(B.E.x, 1, B.E.z, 6, 2, .5, (Math.random() - .5) * 3, 3 + Math.random() * 2, (Math.random() - .5) * 3);
    if (Math.random() < .35) kjRipple(B.E.x, B.E.z, 2, 14, 1.8, .6);
  }
  kjEmit(Math.floor(260 * dt + Math.random()), P, D, 58, .1);   // 光束裡流動的金色顆粒（打到罩子會濺開）
  ride.shake = Math.max(ride.shake, .35);
}
{   // 先把開巨獸會用到的材質編譯好（駕駛艙、噴火、防護罩、蒸氣、煙火）：不然第一次跺腳、放煙火、噴光束時畫面會卡一下
  const hid = [aura.back, aura.front, aura.sparks, aura.ring, ...aura.spikes, wave.m, fw.m, fw.sea, steam.m, pit.g, beamFx.core, beamFx.glow, beamFx.tip, beamFx.hit, kjFlame.m, shield.m, shield.foot].filter(o => !o.visible);
  hid.forEach(o => { o.visible = true; });
  renderer.compile(scene, camera);
  hid.forEach(o => { o.visible = false; });
}
function updateBeamFx(dt, t) {
  const B = beamFx;
  B.live -= dt;
  B.a = clamp(B.a + (B.live > 0 ? dt / .12 : -dt / .3), 0, 1);
  const on = B.a > .01;
  B.core.visible = B.glow.visible = B.tip.visible = B.hit.visible = on;
  if (!on) return;
  B.core.material.uniforms.uA.value = B.a * .95; B.glow.material.uniforms.uA.value = B.a * .45;
  B.core.material.uniforms.uT.value = B.glow.material.uniforms.uT.value = t;
  B.tip.material.opacity = B.hit.material.opacity = B.a;
  B.hit.scale.setScalar(B.sky ? 0 : 9 + 3 * Math.sin(t * 29));   // 射上天空：沒有打中的那一團光
}

/* ---------- 聲音：全部用 Web Audio 即時合成，不載入音檔 ----------
   瀏覽器規定要等第一次點畫面或按鍵才能出聲；右上角的開關記在 sanasai_sound（預設開）。
   iPhone 預設會跟著側邊的靜音開關一起靜音，所以把網頁的聲音模式設成「播放」（iOS 17 起有 navigator.audioSession），
   舊版 iOS 改成播一段無聲音檔來切換。代價：開著聲音時，手機上正在放的音樂會被暫停。 */
const IS_IOS = /iP(hone|od|ad)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const snd = { on: ls.get('sanasai_sound') !== '0', ctx: null, master: null, amb: null, sfx: null, noise: null, hum: null, eng: null, tag: null, meter: null, log: [], step: -1, blade: 0, ramp: 1, fph: null, birdT: 4, crick: [.3, .8, 1.4] };
const CRICKETS = [[.6, .62, 4300], [2.5, .7, 4700], [4.3, .66, 3900]].map(([a, d, f]) => { const [x, z] = polar(a, d); return { p: new THREE.Vector3(x, 1.2, z), f }; });
const SND_ICON = {
  on: '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  off: '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
};
function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} }
function silentWav() {   // 半秒鐘的無聲 WAV（舊版 iOS 解鎖用）
  const n = 4000, v = new DataView(new ArrayBuffer(44 + n)), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }));
}
function biq(type, f, q = .7) { const b = snd.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function lfo(hz, depth, param) { const o = snd.ctx.createOscillator(), g = snd.ctx.createGain(); o.frequency.value = hz; g.gain.value = depth; o.connect(g).connect(param); o.start(); }
function noiseLoop() { const s = snd.ctx.createBufferSource(); s.buffer = snd.noise; s.loop = true; s.start(0, Math.random() * 1.9); return s; }
function buildAudio() {
  const c = snd.ctx, comp = c.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .003; comp.release.value = .25;
  snd.master = c.createGain();
  snd.meter = c.createAnalyser();   // 測試用：量有沒有出聲
  snd.meter.fftSize = 2048;
  snd.master.connect(comp).connect(snd.meter).connect(c.destination);
  snd.amb = c.createGain(); snd.amb.connect(snd.master);
  snd.sfx = c.createGain(); snd.sfx.connect(snd.master);
  const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  snd.noise = buf;
  // 海浪：低沉的雜訊加兩個很慢的起伏，一波一波打上岸；再疊一層浪花的沙沙聲
  const sea = noiseLoop(), swell = c.createGain(), foam = c.createGain();
  swell.gain.value = .045; foam.gain.value = .006;
  lfo(.07, .028, swell.gain); lfo(.113, .018, swell.gain); lfo(.09, .005, foam.gain);
  sea.connect(biq('lowpass', 480)).connect(swell).connect(snd.amb);
  sea.connect(biq('highpass', 2600)).connect(foam).connect(snd.amb);
  // 能量劍的嗡嗡聲：兩個差一點點的低音，劍身亮著才開
  const h1 = c.createOscillator(), h2 = c.createOscillator(), hl = biq('lowpass', 520);
  h1.type = h2.type = 'sawtooth'; h1.frequency.value = 88; h2.frequency.value = 89.6;
  snd.hum = c.createGain(); snd.hum.gain.value = 0;
  h1.connect(hl); h2.connect(hl); hl.connect(snd.hum).connect(snd.sfx);
  h1.start(); h2.start();
  // 飛船：引擎低音（跟著速度升高）＋隆隆的風聲；重返大氣層的火光是另一層轟隆聲
  const eo = c.createOscillator(), elp = biq('lowpass', 300), eg = c.createGain(), rlp = biq('lowpass', 300), rg = c.createGain(), og = c.createGain();
  eo.type = 'sawtooth'; eo.frequency.value = 45; eg.gain.value = rg.gain.value = og.gain.value = 0;
  eo.connect(elp).connect(eg).connect(snd.sfx);
  noiseLoop().connect(rlp).connect(rg).connect(snd.sfx);
  noiseLoop().connect(biq('bandpass', 420, .6)).connect(og).connect(snd.sfx);
  eo.start();
  snd.eng = { eo, elp, eg, rlp, rg, og };
  // 金色火焰：一直燒著的低低的轟轟聲（變身時才開）
  const ag = c.createGain(), abp = biq('bandpass', 260, .8), ao = c.createOscillator(), aog = c.createGain();
  ag.gain.value = 0; aog.gain.value = .5; ao.frequency.value = 62;
  noiseLoop().connect(abp).connect(ag);
  ao.connect(aog).connect(ag);
  lfo(5.5, 70, abp.frequency);
  ag.connect(snd.sfx);
  ao.start();
  snd.aura = ag;
}
function audioUnlock() {
  if (!snd.on) return;
  setSession('playback');
  if (!snd.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { snd.ctx = new AC(); } catch (e) { return; }
    buildAudio();
  }
  if (snd.ctx.state !== 'running' && !document.hidden && !state.inGame) snd.ctx.resume().catch(() => {});
  if (IS_IOS && !navigator.audioSession) {   // 舊版 iOS：播一段無聲音檔，靜音開關才不會把聲音關掉
    if (!snd.tag) { snd.tag = new Audio(silentWav()); snd.tag.loop = true; snd.tag.setAttribute('x-webkit-airplay', 'deny'); }
    snd.tag.play().catch(() => {});
  }
}
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(type, audioUnlock, true);
function sndIdle(idle) {   // 進遊戲（遊戲有自己的聲音）或切到別的分頁時整個停掉
  if (!snd.ctx) return;
  if (idle) { snd.ctx.suspend(); if (snd.tag) snd.tag.pause(); }
  else if (snd.on) audioUnlock();
}
document.addEventListener('visibilitychange', () => sndIdle(document.hidden || state.inGame));
function soundUI() {
  const b = $('#btn-sound');
  b.setAttribute('aria-pressed', String(snd.on));
  b.querySelector('svg').innerHTML = snd.on ? SND_ICON.on : SND_ICON.off;
  b.querySelector('span').textContent = snd.on ? '聲音' : '靜音';
  b.title = snd.on ? '關掉聲音' : '打開聲音';
}
function setSound(on) {
  snd.on = on;
  ls.set('sanasai_sound', on ? '1' : '0');
  soundUI();
  if (on) { audioUnlock(); if (snd.ctx) snd.ctx.resume().then(() => sfx('bip')).catch(() => {}); }
  else { if (snd.ctx) snd.ctx.suspend(); if (snd.tag) snd.tag.pause(); setSession('auto'); }
}
$('#btn-sound').addEventListener('click', () => setSound(!snd.on));
soundUI();

const _sv = new THREE.Vector3(), _sdir = new THREE.Vector3(), _sx = new THREE.Vector3(), _ssp = new THREE.Vector3();
function place(at, ref = 14) {   // 聲音的位置 → [音量, 左右]：以鏡頭看的地方當耳朵，越遠越小聲（ref＝多遠時小一半；巨獸的聲音傳得遠），左右照鏡頭的方向
  if (!at) return [1, 0];
  const p = at.isObject3D ? at.getWorldPosition(_sv) : at, d = p.distanceTo(controls.target), v = _sdir.copy(p).sub(camera.position);
  _sx.set(1, 0, 0).applyQuaternion(camera.quaternion);
  return [1 / (1 + (d / ref) ** 2), clamp(v.dot(_sx) / Math.max(4, v.length()) * 1.3, -.8, .8)];
}
function osc(out, { type = 'sine', f = 440, f2 = 0, curve = null, t = 0, dur = .2, v = .2, a = .005, filter = null, vib = null }) {
  const c = snd.ctx, t0 = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  if (curve) { o.frequency.setValueAtTime(curve[0], t0); curve.forEach((fq, i) => { if (i) o.frequency.linearRampToValueAtTime(fq, t0 + dur * i / (curve.length - 1)); }); }
  else { o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur); }
  if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg).connect(o.frequency); l.start(t0); l.stop(t0 + dur + .05); }
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  (filter ? o.connect(biq(...filter)) : o).connect(g).connect(out);
  o.start(t0); o.stop(t0 + dur + .05);
}
function hiss(out, { t = 0, dur = .2, v = .2, a = .004, type = 'bandpass', f = 1000, f2 = 0, q = 1 }) {
  const c = snd.ctx, t0 = c.currentTime + t, s = c.createBufferSource(), fl = biq(type, f, q), g = c.createGain();
  s.buffer = snd.noise;
  fl.frequency.setValueAtTime(f, t0); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  s.connect(fl).connect(g).connect(out);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + .05);
}
const SFX = {
  bip(o) { osc(o, { type: 'triangle', f: 880, dur: .09, v: .12 }); },
  // 島民
  bark(o, n = 1, ask = false) { for (let i = 0; i < n; i++) { const t = i * .17; osc(o, { type: 'sawtooth', curve: ask && i === n - 1 ? [300, 270, 430] : [390, 340, 210], t, dur: .13, v: .2, filter: ['lowpass', 1300, 1] }); hiss(o, { t, dur: .08, v: .16, f: 650, q: 1.5 }); } },
  meow(o, long = false) { const dur = long ? .62 : .42, curve = [520, 780, 860, 640, 470]; osc(o, { type: 'sawtooth', curve, dur, v: .13, a: .05, filter: ['bandpass', 1300, 1.6], vib: [6, 16] }); osc(o, { curve, dur, v: .05, a: .05 }); },
  purr(o) {
    const c = snd.ctx, t0 = c.currentTime, s = c.createBufferSource(), am = c.createGain(), env = c.createGain();
    s.buffer = snd.noise;
    am.gain.value = .5; lfoAt(23, .5, am.gain, t0, 1.3);
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(.2, t0 + .15); env.gain.linearRampToValueAtTime(0, t0 + 1.2);
    s.connect(biq('lowpass', 260)).connect(am).connect(env).connect(o);
    s.start(t0, Math.random()); s.stop(t0 + 1.3);
  },
  boing(o) { osc(o, { curve: [200, 560, 420, 470, 380], dur: .38, v: .2, vib: [16, 22] }); },
  whistle(o) { osc(o, { curve: [1300, 2500, 2100, 2800, 1700], dur: .5, v: .07 }); },
  gull(o) { const n = 2 + ((Math.random() * 2) | 0); for (let i = 0; i < n; i++) osc(o, { type: 'sawtooth', curve: [1250, 1450, 950], t: i * .3, dur: .24, v: .08, filter: ['bandpass', 1500, 3], vib: [30, 40] }); },
  chirp(o, f) { for (let i = 0; i < 3; i++) osc(o, { f, t: i * .05, dur: .03, v: .045, a: .003 }); },
  splash(o, size = 1) {
    hiss(o, { dur: .18 + size * .35, v: .06 + size * .09, type: 'highpass', f: 700 + 300 / size, q: .5 });
    hiss(o, { dur: .12, v: .07 * size, f: 400, f2: 1600, q: 1 });
    if (size < .9) osc(o, { f: 520, f2: 140, dur: .12, v: .1 });
  },
  step(o, kind) {
    if (kind === 'wood' || kind === 'metal') { const m = kind === 'metal'; osc(o, { type: 'triangle', f: m ? 420 : 210, f2: m ? 300 : 120, dur: .07, v: .09 }); hiss(o, { dur: .03, v: .04, f: m ? 3000 : 1500, q: 2 }); }
    else if (kind === 'sand') { hiss(o, { dur: .07, v: .07, type: 'highpass', f: 2600, q: .5 }); hiss(o, { t: .03, dur: .05, v: .045, type: 'highpass', f: 3200, q: .5 }); }
    else { hiss(o, { dur: .07, v: .14, type: 'lowpass', f: 1400, q: .7 }); hiss(o, { dur: .03, v: .03, f: 2500, q: 1 }); }
  },
  // 能量劍、蜜蜂
  ignite(o) { osc(o, { type: 'sawtooth', f: 60, f2: 120, dur: .4, v: .15, filter: ['lowpass', 2200, 2] }); hiss(o, { dur: .3, v: .05, f: 600, f2: 3000, q: 3 }); },
  retract(o) { osc(o, { type: 'sawtooth', f: 130, f2: 50, dur: .3, v: .09, filter: ['lowpass', 1400, 2] }); },
  whoosh(o) { osc(o, { type: 'sawtooth', curve: [100, 175, 95], dur: .32, v: .11, filter: ['lowpass', 1500, 3] }); hiss(o, { dur: .28, v: .07, f: 500, f2: 2600, q: 2 }); },
  zap(o) { [880, 660, 494, 330, 220].forEach((f, i) => osc(o, { type: 'square', f, t: i * .035, dur: .05, v: .05 })); hiss(o, { dur: .25, v: .07, type: 'lowpass', f: 2500, f2: 300, q: .7 }); },
  // 阿滿的球、釣魚
  toss(o) { hiss(o, { dur: .2, v: .14, f: 700, f2: 2200, q: 1.5 }); },
  bounce(o, k = 1) { osc(o, { f: 260, f2: 150, dur: .07, v: .13 * k }); hiss(o, { dur: .02, v: .04 * k, f: 2000, q: 1 }); },
  cast(o) { hiss(o, { dur: .3, v: .15, f: 2600, f2: 700, q: 2 }); },
  plip(o) { osc(o, { f: 900, f2: 450, dur: .06, v: .07 }); },
  bite(o) { osc(o, { type: 'triangle', f: 880, dur: .12, v: .15 }); osc(o, { type: 'triangle', f: 1320, t: .1, dur: .2, v: .15 }); },
  reel(o) { for (let i = 0; i < 9; i++) hiss(o, { t: i * .055, dur: .025, v: .12, f: 3200, q: 3 }); },
  fail(o) { osc(o, { type: 'triangle', f: 330, f2: 180, dur: .35, v: .11 }); },
  jingle(o, big = false) { (big ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047]).forEach((f, i) => { osc(o, { type: 'triangle', f, t: i * .075, dur: .3, v: .11 }); osc(o, { f: f * 2, t: i * .075, dur: .2, v: .03 }); }); },
  // 鑰匙、門、結局
  key(o) { [784, 988, 1175, 1568, 1976].forEach((f, i) => { osc(o, { type: 'triangle', f, t: i * .09, dur: .6, v: .11 }); osc(o, { f: f * 2.01, t: i * .09, dur: .4, v: .035 }); }); },
  gate(o) { osc(o, { type: 'sawtooth', f: 55, f2: 110, dur: 2.2, v: .11, a: .8, filter: ['lowpass', 900, 1] }); [523, 659, 784, 1047].forEach((f, i) => osc(o, { f, t: .9 + i * .12, dur: 2.2, v: .07 })); },
  fanfare(o) { [523, 659, 784, 1047].forEach((f, i) => osc(o, { type: 'square', f, t: i * .14, dur: .22, v: .045, filter: ['lowpass', 3000, 1] })); [523, 659, 784, 1047].forEach(f => osc(o, { type: 'triangle', f, t: .6, dur: 1.6, v: .06 })); },
  // 飛船
  ring(o, last = false) { (last ? [1047, 1319, 1568, 2093] : [1047, 1568]).forEach((f, i) => osc(o, { type: 'triangle', f, t: i * .07, dur: .5, v: .1 })); },
  servo(o) { osc(o, { type: 'square', f: 300, f2: 520, dur: .45, v: .05, filter: ['lowpass', 1200, 1] }); },
  warp(o) { hiss(o, { dur: 1.15, v: .16, a: .9, f: 300, f2: 5000, q: 1.2 }); osc(o, { type: 'sawtooth', f: 180, f2: 1400, dur: 1.15, v: .05, a: .9, filter: ['lowpass', 2500, 1] }); },
  boom(o) { osc(o, { f: 95, f2: 32, dur: 1.3, v: .3 }); hiss(o, { dur: 1.1, v: .22, type: 'lowpass', f: 900, f2: 90, q: .7 }); },
  land(o) { osc(o, { f: 70, f2: 40, dur: .35, v: .2 }); hiss(o, { t: .05, dur: .7, v: .05, type: 'highpass', f: 3000, q: .5 }); },
  // 外海的巨獸
  kjRoar(o) {   // 機械巨獸的吼聲：低沉的咆哮＋金屬感的尖嘯＋一口氣的雜訊
    osc(o, { type: 'sawtooth', curve: [62, 92, 84, 58], dur: 2.3, v: .3, a: .25, filter: ['lowpass', 650, 1.2], vib: [7, 5] });
    osc(o, { type: 'sawtooth', curve: [240, 500, 440, 260], dur: 2.0, v: .12, a: .2, filter: ['bandpass', 1050, 4], vib: [11, 16] });
    osc(o, { type: 'square', curve: [370, 760, 690, 420], dur: 1.9, v: .045, a: .25, filter: ['bandpass', 1500, 6] });
    hiss(o, { dur: 2.2, v: .12, a: .3, f: 650, f2: 260, q: .8 });
  },
  kjFlame(o, dur = 3.2) {   // 噴火：一直轟轟響的風聲（忽大忽小）＋低低的隆隆聲＋劈哩啪啦
    const c = snd.ctx, t0 = c.currentTime, s = c.createBufferSource(), f = biq('bandpass', 700, .7), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    s.buffer = snd.noise; s.loop = true;
    f.frequency.setValueAtTime(400, t0); f.frequency.linearRampToValueAtTime(900, t0 + .3); f.frequency.linearRampToValueAtTime(650, t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.24, t0 + .25); g.gain.setValueAtTime(.24, t0 + dur - .4); g.gain.linearRampToValueAtTime(0, t0 + dur);
    l.frequency.value = 7; lg.gain.value = .05; l.connect(lg).connect(g.gain);
    s.connect(f).connect(g).connect(o);
    s.start(t0, Math.random() * 1.5); l.start(t0); s.stop(t0 + dur + .05); l.stop(t0 + dur + .05);
    osc(o, { f: 48, dur, v: .16, a: .3 });
    for (let i = 0; i < 22; i++) hiss(o, { t: Math.random() * (dur - .2), dur: .05, v: .06, type: 'highpass', f: 2500 + Math.random() * 2000, q: .6 });
  },
  shieldUp(o) { osc(o, { curve: [170, 520, 470], dur: .8, v: .13, a: .05 }); osc(o, { type: 'triangle', curve: [1046, 1568], t: .08, dur: .7, v: .05, vib: [9, 14] }); hiss(o, { dur: .6, v: .05, type: 'highpass', f: 3500, f2: 6000, q: .5 }); },
  shieldHit(o, dur = 3) {   // 火打在防護罩上：電流的嗡嗡聲＋滋滋聲
    const c = snd.ctx, t0 = c.currentTime, x = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    x.type = 'square'; x.frequency.value = 118;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.05, t0 + .15); g.gain.setValueAtTime(.05, t0 + dur - .3); g.gain.linearRampToValueAtTime(0, t0 + dur);
    l.frequency.value = 17; lg.gain.value = .025; l.connect(lg).connect(g.gain);
    x.connect(biq('lowpass', 900, 1)).connect(g).connect(o);
    x.start(t0); l.start(t0); x.stop(t0 + dur + .05); l.stop(t0 + dur + .05);
    for (let i = 0; i < 16; i++) hiss(o, { t: Math.random() * (dur - .2), dur: .07, v: .05, type: 'highpass', f: 4000, q: .7 });
  },
  shieldDown(o) { osc(o, { curve: [520, 300, 140], dur: .9, v: .1, a: .02 }); hiss(o, { dur: .7, v: .04, type: 'highpass', f: 5000, f2: 1500, q: .5 }); },
  kjStep(o) { osc(o, { f: 78, f2: 36, dur: .34, v: .24 }); hiss(o, { dur: .25, v: .08, type: 'lowpass', f: 600, q: .6 }); },   // 腳踩進水裡的悶響
  kjSplash(o, size = 2) { SFX.splash(o, size); osc(o, { f: 85, f2: 32, dur: .3 + size * .15, v: .1 * size }); },
  kjShake(o) { for (let i = 0; i < 10; i++) hiss(o, { t: i * .1, dur: .09, v: .07, type: 'highpass', f: 1800, q: .5 }); },   // 甩水：一陣嘩嘩嘩
  // 騎巨獸
  powerUp(o) {   // 變身：越來越高的嗡嗡聲＋風聲，最後「轟」一聲
    osc(o, { type: 'sawtooth', curve: [70, 85, 130, 260], dur: 1.0, v: .12, a: .2, filter: ['lowpass', 1400, 1.5], vib: [9, 6] });
    hiss(o, { dur: 1.0, v: .1, a: .5, f: 300, f2: 2600, q: 1.2 });
    osc(o, { t: .9, f: 110, f2: 38, dur: .7, v: .26 });
    hiss(o, { t: .9, dur: .6, v: .16, type: 'lowpass', f: 1600, f2: 200, q: .7 });
  },
  launch(o) { hiss(o, { dur: .55, v: .2, f: 350, f2: 2800, q: 1.3 }); osc(o, { type: 'sawtooth', f: 140, f2: 55, dur: .45, v: .1, filter: ['lowpass', 900, 1] }); },   // 咻一聲飛出去
  riderLand(o) { osc(o, { f: 140, f2: 55, dur: .28, v: .2 }); hiss(o, { dur: .35, v: .08, type: 'highpass', f: 3000, q: .6 }); },   // 落在巨獸頭上
  heroLand(o) { osc(o, { f: 90, f2: 30, dur: .7, v: .32 }); hiss(o, { dur: .7, v: .2, type: 'lowpass', f: 1400, f2: 120, q: .7 }); hiss(o, { t: .05, dur: .5, v: .06, type: 'highpass', f: 3500, q: .5 }); },   // 單膝落地
  stomp(o) { osc(o, { f: 60, f2: 24, dur: 1.4, v: .22 }); hiss(o, { dur: 1.2, v: .14, type: 'lowpass', f: 800, f2: 90, q: .7 }); SFX.splash(o, 1.6); },   // 跺腳：很低的一聲咚＋嘩啦（峰值壓在其他巨獸聲音那一級）
  charge(o) {   // 合體大招蓄力：越來越高的嗡嗡聲＋劈哩啪啦的電
    osc(o, { type: 'sawtooth', curve: [80, 110, 170, 260], dur: 1.6, v: .1, a: .3, filter: ['lowpass', 1600, 2], vib: [14, 8] });
    hiss(o, { dur: 1.6, v: .07, a: .8, f: 600, f2: 3200, q: 2 });
    for (let i = 0; i < 14; i++) hiss(o, { t: .3 + Math.random() * 1.2, dur: .04, v: .06, type: 'highpass', f: 4000, q: .7 });
  },
  ready(o) { [784, 1175, 1568].forEach((f, i) => osc(o, { type: 'triangle', f, t: i * .05, dur: .5, v: .08 })); },   // 蓄滿了
  beam(o, dur = 3.2) {   // 金色光束：比噴火更低、更滿的轟——加一層高高的嘶鳴
    const c = snd.ctx, t0 = c.currentTime, s = c.createBufferSource(), f = biq('bandpass', 500, .6), g = c.createGain();
    s.buffer = snd.noise; s.loop = true;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.3, t0 + .15); g.gain.setValueAtTime(.3, t0 + dur - .5); g.gain.linearRampToValueAtTime(0, t0 + dur);
    s.connect(f).connect(g).connect(o);
    s.start(t0, Math.random()); s.stop(t0 + dur + .05);
    osc(o, { type: 'sawtooth', curve: [70, 62, 58, 52], dur, v: .2, a: .1, filter: ['lowpass', 700, 1.2], vib: [6, 3] });
    osc(o, { type: 'square', curve: [880, 990, 940, 900], dur, v: .035, a: .2, filter: ['bandpass', 1800, 4], vib: [23, 30] });
  },
  fwLaunch(o, big = 1) { osc(o, { curve: [420, 1300, 1900, 1700], dur: 1.1, v: .045, a: .05, vib: [20, 25] }); hiss(o, { dur: .35, v: .07, type: 'highpass', f: 2500, q: .5 }); osc(o, { f: 170, f2: 55, dur: .18, v: .1 * big }); },   // 煙火升空：碰一聲＋咻——
  fwBurst(o, big = 1) {   // 煙火炸開：碰！＋劈哩啪啦
    osc(o, { f: 75, f2: 30, dur: .9, v: .22 * big });
    hiss(o, { dur: .6, v: .16 * big, type: 'lowpass', f: 2200, f2: 180, q: .7 });
    for (let i = 0; i < 16; i++) hiss(o, { t: .25 + Math.random() * 1.1, dur: .03, v: .05, type: 'highpass', f: 3000 + Math.random() * 3000, q: .7 });
  },
  fwBig(o) {   // 大金柳：更低的碰＋一大片慢慢落下的劈哩啪啦
    osc(o, { f: 58, f2: 24, dur: 1.6, v: .26 });
    hiss(o, { dur: 1.1, v: .17, type: 'lowpass', f: 1800, f2: 120, q: .7 });
    for (let i = 0; i < 44; i++) hiss(o, { t: .4 + Math.random() * 3.2, dur: .03, v: .04, type: 'highpass', f: 3000 + Math.random() * 3500, q: .7 });
  },
  mortar(o) { osc(o, { f: 95, f2: 30, dur: .55, v: .24 }); hiss(o, { dur: .4, v: .12, type: 'lowpass', f: 1500, f2: 200, q: .7 }); osc(o, { t: .12, curve: [300, 900, 1500, 1300], dur: 1.6, v: .04, vib: [14, 20] }); },   // 嘴巴發射：咚＋長長的咻——
  pitRise(o, down = 0) { osc(o, { type: 'sawtooth', f: down ? 120 : 55, f2: down ? 50 : 125, dur: .7, v: .08, a: .08, filter: ['lowpass', 650, 1.5] }); hiss(o, { dur: .6, v: .035, f: 900, f2: 400, q: 2 }); osc(o, { t: .68, f: 150, f2: 70, dur: .12, v: .12 }); },   // 駕駛艙升上來／收回去：馬達聲＋喀一聲
  canopy(o, open = 1) {   // 艙蓋：打開＝噗一聲氣壓＋馬達；關上＝馬達＋喀一聲
    if (open) { hiss(o, { dur: .4, v: .1, type: 'highpass', f: 2200, f2: 1200, q: .6 }); osc(o, { type: 'square', f: 260, f2: 420, dur: .45, v: .035, filter: ['lowpass', 1200, 1] }); }
    else { osc(o, { type: 'square', f: 420, f2: 240, dur: .4, v: .035, filter: ['lowpass', 1200, 1] }); osc(o, { t: .4, f: 150, f2: 70, dur: .12, v: .14 }); hiss(o, { t: .4, dur: .05, v: .05, f: 2400, q: 1 }); }
  },
  boot(o) { osc(o, { type: 'sawtooth', f: 50, f2: 150, dur: 1.2, v: .06, a: .2, filter: ['lowpass', 900, 1.2] }); [392, 523, 659, 784, 1047].forEach((f, i) => osc(o, { type: 'triangle', f, t: .15 + i * .09, dur: .35, v: .06 })); },   // 開機：越來越高的嗡＋一串往上的嗶
  eject(o) { osc(o, { f: 170, f2: 40, dur: .35, v: .22 }); hiss(o, { dur: .3, v: .17, type: 'lowpass', f: 2600, f2: 300, q: .7 }); hiss(o, { t: .05, dur: .7, v: .12, f: 400, f2: 3200, q: 1.2 }); },   // 彈射：碰一聲＋咻
  sizzle(o) { hiss(o, { dur: .5, v: .08, type: 'highpass', f: 3200, f2: 2000, q: .5 }); hiss(o, { dur: .3, v: .045, f: 900, q: .8 }); },   // 火打到海面：嘶——
  poof(o) { hiss(o, { dur: 1.0, v: .14, f: 700, f2: 180, q: .6 }); osc(o, { f: 85, f2: 40, dur: .5, v: .09 }); },   // 雲被燒掉：噗——
};
Object.assign(SFX.kjRoar, { ref: 70 }); Object.assign(SFX.kjFlame, { ref: 55 }); Object.assign(SFX.kjSplash, { ref: 40 }); Object.assign(SFX.kjStep, { ref: 26 }); Object.assign(SFX.kjShake, { ref: 30 });   // 巨獸的聲音傳得遠
for (const k of ['shieldUp', 'shieldHit', 'shieldDown']) SFX[k].ref = 45;
Object.assign(SFX.stomp, { ref: 70 }); Object.assign(SFX.beam, { ref: 70 }); Object.assign(SFX.charge, { ref: 40 }); Object.assign(SFX.fwLaunch, { ref: 50 }); Object.assign(SFX.fwBurst, { ref: 120 });
Object.assign(SFX.fwBig, { ref: 140 }); Object.assign(SFX.mortar, { ref: 70 }); Object.assign(SFX.eject, { ref: 40 }); Object.assign(SFX.sizzle, { ref: 50 }); Object.assign(SFX.poof, { ref: 120 });
for (const k of ['pitRise', 'canopy', 'boot']) SFX[k].ref = 30;
function lfoAt(hz, depth, param, t0, dur) { const o = snd.ctx.createOscillator(), g = snd.ctx.createGain(); o.type = 'square'; o.frequency.value = hz; g.gain.value = depth; o.connect(g).connect(param); o.start(t0); o.stop(t0 + dur); }
function sfx(name, at, ...args) {   // at：聲音從哪裡來（3D 物件或位置；不給＝介面音效，不分遠近）
  if (!snd.on || !snd.ctx || snd.ctx.state !== 'running') return;
  const [v, pan] = place(at, SFX[name].ref);
  if (v < .015) return;
  const g = snd.ctx.createGain();
  g.gain.value = v;
  if (snd.ctx.createStereoPanner) { const p = snd.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(snd.sfx); }
  else g.connect(snd.sfx);
  SFX[name](g, ...args);
  snd.log.push(name);
  if (snd.log.length > 80) snd.log.shift();
}
function voice(g, text) {   // 對話泡泡冒出來時配上叫聲
  if (g === dog.g && text.includes('汪')) sfx('bark', g, (text.match(/汪/g) || []).length, text.includes('？'));
  else if (g === cat.g) { if (text.includes('♥')) sfx('purr', g); else if (text.includes('喵')) sfx('meow', g, text.length > 1); }
  else if (g === blob.g) sfx('boing', g);
}
function updateSound(dt) {
  if (!snd.ctx || snd.ctx.state !== 'running') return;
  const now = snd.ctx.currentTime, F = flight;
  // 環境音：海浪在高空會淡掉；白天偶爾有海鳥叫，晚上換成蟲鳴
  snd.amb.gain.setTargetAtTime(1 - smooth((camera.position.y - 25) / 90), now, .5);
  if (!state.freeze) {
    if (night < .5 && (snd.birdT -= dt) <= 0) { snd.birdT = 7 + Math.random() * 10; sfx('gull', birds[(Math.random() * birds.length) | 0]); }
    if (night > .6) CRICKETS.forEach((k, i) => { if ((snd.crick[i] -= dt) <= 0) { snd.crick[i] = .5 + Math.random() * 1.1; sfx('chirp', k.p, k.f); } });
  }
  // 腳步：草地、沙灘、木頭碼頭、飛船的金屬坡道聲音不一樣
  if (walk.moving || F.walking) {
    const k = Math.floor(walk.phase / Math.PI);
    if (k !== snd.step) { snd.step = k; const p = avatar.position; sfx('step', avatar, F.walking ? 'metal' : onPier(p.x, p.z) ? 'wood' : baseHeight(p.x, p.z) < .55 ? 'sand' : 'grass'); }
  }
  // 能量劍：亮出來「嗡」一聲、亮著有低低的嗡嗡聲、收回去「咻」一聲
  const b = AV.bladeK;
  if (b > .05 && snd.blade <= .05) sfx('ignite', avatar);
  if (b < .9 && snd.blade >= .9 && AV.swingT <= 0) sfx('retract', avatar);
  snd.blade = b;
  snd.hum.gain.setTargetAtTime(b * .03 * place(avatar)[0], now, .05);
  // 飛船：坡道收放、跳光速、白光、降落；引擎跟著速度，重返大氣層時多一層轟隆聲
  const r = ramp.scale.x;
  if ((r > .03 && snd.ramp <= .03) || (r < .97 && snd.ramp >= .97)) sfx('servo', ship);
  snd.ramp = r;
  if (F.phase !== snd.fph) {
    if (F.phase === 'hyper') sfx('warp');
    else if (F.phase === 'descent') sfx('boom');
    else if (F.phase === 'off') sfx('land', ship);
    snd.fph = F.phase;
  }
  let lvl = 0, spd = 0;
  if (F.phase === 'lift') { const k = Math.min(1, F.t / FLY.lift); lvl = .35 + .65 * k; spd = 3 + 5 * k; }
  else if (['pilot', 'climb', 'hyper', 'return'].includes(F.phase)) { lvl = 1; spd = F.speed; }
  else if (F.phase === 'descent') { const k = Math.min(1, F.t / FLY.descent); lvl = 1 - .6 * smooth((k - .85) / .15); spd = lerp(40, 4, k); }
  else if (F.phase === 'touch') { lvl = 1 - Math.min(1, F.t / FLY.touch); spd = 5; }
  else if (F.phase === 'board' || F.phase === 'off') lvl = .25;
  const E = snd.eng, sp = Math.min(spd, 60);
  E.eo.frequency.setTargetAtTime(40 + sp * 2.2, now, .25);
  E.elp.frequency.setTargetAtTime(220 + sp * 30, now, .25);
  E.eg.gain.setTargetAtTime(lvl * .06, now, .15);
  E.rlp.frequency.setTargetAtTime(160 + sp * 16, now, .25);
  E.rg.gain.setTargetAtTime(lvl * (.03 + sp * .0018), now, .15);
  E.og.gain.setTargetAtTime(F.phase === 'descent' ? (F.heat || 0) * .2 : 0, now, .1);
  snd.aura.gain.setTargetAtTime(aura.k * (.06 + aura.boost * .06) * place(avatar, 18)[0], now, .12);   // 金色火焰燒著的聲音
}

/* ---------- 主迴圈 ---------- */
const clock = new THREE.Clock();
let elapsed = 0;
function updateAmbient(dt, t) {
  const wp = water.geometry.attributes.position, amp = water.userData.amp;
  for (let i = 0; i < wp.count; i++) {
    const a = amp[i];
    if (!a) continue;
    const x = wp.getX(i), z = wp.getZ(i);
    wp.setY(i, a * (Math.sin(x * .32 + t * 1.2) + .8 * Math.sin(z * .41 - t * .9) + .5 * Math.sin((x - z) * .23 + t * .7)));
  }
  wp.needsUpdate = true;
  foamSurge = Math.max(0, foamSurge - dt * .6); shipRock = Math.max(0, shipRock - dt * .45);   // 跺腳的浪打上岸、打到飛船
  foam.material.opacity = .32 + .2 * Math.sin(t * 1.3) + foamSurge * .45;
  foam.scale.setScalar(1 + .006 * Math.sin(t * 1.3) + foamSurge * .025);
  if (!flight.phase) {
    ship.position.y = SHIP.y + Math.sin(t * 1.1) * .045 + shipRock * Math.sin(t * 5.5) * .28;
    ship.rotation.z = Math.sin(t * .8) * .006 + shipRock * Math.sin(t * 4.2) * .07;
    ship.rotation.x = shipRock * Math.sin(t * 3.6 + 1) * .04;
  }
  shipGlow.color.setScalar(lerp(.9, 2.1, night) * (flight.phase ? 1.6 : 1));
  clouds.rotation.y = t * .004;
  for (const b of birds) {
    const u = b.userData, a = t * u.sp + u.ph;
    u.sc = Math.max(0, (u.sc || 0) - dt * .22); u.sy = lerp(u.sy || 0, u.sc * 6, Math.min(1, dt * 2.5));   // 被跺腳的浪嚇到：飛高、拍翅膀拍得快
    b.position.set(Math.cos(a) * u.R, u.h + Math.sin(t * .8 + u.ph) * .6 + u.sy, Math.sin(a) * u.R);
    b.rotation.y = -a;
    const f = Math.sin(t * (9 + u.sc * 14) + u.ph) * .5;
    u.w1.rotation.z = f; u.w2.rotation.z = -f;
  }
  if (gate.visible && gateShimmer) gateShimmer.material.opacity = .18 + .12 * Math.sin(t * 2.2);
  if (neonMat && night > .5) neonMat.color.setScalar(2.0 * (Math.sin(t * 23) > .97 ? .55 : 1));
  for (const id in pedestals) { const p = pedestals[id]; p.key.rotation.y = t * 1.5; p.key.position.y = 1.55 + Math.sin(t * 2.2) * .1; }
  if (coin.visible) coin.userData.disc.rotation.z = t * 1.6;
  crystal.group.rotation.y = t * .25;
  updateOverflow(dt, t);
}
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), .05);
  if (state.inGame) return;
  if (!state.freeze) elapsed += dt;
  updateTime(dt);
  updateAvatar(dt);
  updateCamera(dt);
  updateFlight(dt);
  updateSound(dt);
  if (!state.freeze) { updateAmbient(dt, elapsed); updatePets(dt, elapsed); updateRide(dt, elapsed); }
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

/* ---------- 登島：一打開就是島，鏡頭從海上飛向島（碰一下就停），分身從飛船走上岸 ---------- */
for (const id of [...GAMES.map(g => g.id), 'pier']) {
  const P = PLACE[id];
  const y = CAB[id] ? CAB[id].F.y + 6.0 : 2.5;
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

function land() {
  if (landed) return;
  landed = true;
  if (!ls.get('sanasai_intro_v2')) showIntro(0);
  pendingToasts.splice(0).forEach(([text, tone], i) => setTimeout(() => toast(text, tone), i * 3000));
}
walkTo(0, 13.6);
flyTo(overviewPose(), 3.2, land);
setTimeout(land, 3500);  // 鏡頭半路被手指或清單打斷時 done 不會跑，到點照樣上岸
tick();
body.classList.remove('booting');

/* 除錯／測試用的唯讀入口 */
window.sanasai = { PLACE, GAMES, KEYS, CAB, keyState, state, ui, avatar, camera, controls, records: () => records, overflow: () => ({ bees: swarm && swarm.n, heap: heap && heap.layers, maze: mazeArea && mazeArea.n }), pets: () => ({ dog: dog.state, dogPos: dog.g.position.toArray().map(v => +v.toFixed(2)), cat: cat.awakeT > 0 || night > .6, crabs: crabs.map(c => +c.hide.toFixed(1)), blob: blob.state }), petTap, view: (pos, target) => { follow = false; fly = null; controls.enabled = true; camera.position.set(...pos); controls.target.set(...target); controls.update(); }, select: selectPlace, walkTo, overview, setTime, land, findPath, dolphins, pod, dolTrick, updateDolphins, updateSplashes, ship, AV, FAR_ISLES, snd, SFX, setSound, flight, startFlight, skipFlight, throwBall, fetchS, fishing, startFishing, reel, feedCat, carry, catGo, catJump, rings, landNow, swing, divers, spawnDiver, cat, dog, KJ, kj, updateKaiju, kjDepth, kjFloor, kjRipples, kjSpray, kjRoar, kjFlame, SH, shield, ride, aura, startRide, rideExit, rideRoarDown, rideRoarUp, rideStomp, rideWorks, rideFireAt, rideView, wave, fw, beamFx, seatWorld, cloudCeil, shieldHitT, updateRide, PIT, pit, oc, rcam, aim, aimPick, VIEWS, steam, CLOUD, cloudBurn, startShow, endShow, ridePointer, fishes, birds, crabs, blob, POSE, joy, keysDown, updatePets, updateAmbient };
