import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* ============================ НАСТРОЙКИ ============================ */
const PLATFORM_RADIUS = 14;   // радиус космической платформы
const WALK_SPEED = 2.1;       // скорость шага, м/с
const RUN_SPEED = 5.4;        // скорость бега, м/с
const MODEL_YAW = Math.PI;    // модель в файле смотрит в -Z → разворачиваем на +Z
const TOTAL_ORBS = 7;
const BAG_HIT_DIST = 2.05;    // дистанция достижения удара

/* ============================ РЕНДЕРЕР / СЦЕНА ============================ */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060f);
scene.fog = new THREE.FogExp2(0x04060f, 0.014);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2500);

/* ============================ КОСМОС: ЗВЁЗДЫ И ПЛАНЕТА ============================ */
{
  const count = 2600;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 380 + Math.random() * 450;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i * 3]     = r * Math.sin(p) * Math.cos(t);
    pos[i * 3 + 1] = r * Math.cos(p);
    pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, fog: false,
    transparent: true, opacity: 0.9
  }));
  scene.add(stars);
}

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(34, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0x5a48c8, roughness: 1, metalness: 0, emissive: 0x241a5e, emissiveIntensity: 1, fog: false })
);
planet.position.set(-150, 110, -320);
scene.add(planet);

const planetRing = new THREE.Mesh(
  new THREE.TorusGeometry(52, 2.4, 2, 120),
  new THREE.MeshBasicMaterial({ color: 0x8f7bff, transparent: true, opacity: 0.45, fog: false })
);
planetRing.position.copy(planet.position);
planetRing.rotation.set(Math.PI / 2.3, 0.5, 0);
scene.add(planetRing);

/* ============================ ОСВЕЩЕНИЕ ============================ */
scene.add(new THREE.HemisphereLight(0x8fa3c8, 0x0a0a12, 0.55));

const key = new THREE.DirectionalLight(0xffe9d0, 2.4);
key.position.set(10, 16, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -20;
key.shadow.camera.right = 20;
key.shadow.camera.top = 20;
key.shadow.camera.bottom = -20;
key.shadow.camera.near = 2;
key.shadow.camera.far = 50;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);

const rim = new THREE.PointLight(0x00c8ff, 60, 80, 2);
rim.position.set(-9, 5, -9);
scene.add(rim);

const fill = new THREE.PointLight(0x7a5cff, 40, 80, 2);
fill.position.set(8, 4, 9);
scene.add(fill);

/* ============================ ПЛАТФОРМА ============================ */
const platform = new THREE.Mesh(
  new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 0.8, 1.2, 64),
  new THREE.MeshStandardMaterial({ color: 0x11141f, roughness: 0.85, metalness: 0.4 })
);
platform.position.y = -0.6;
platform.receiveShadow = true;
scene.add(platform);

const under = new THREE.Mesh(
  new THREE.ConeGeometry(PLATFORM_RADIUS + 0.75, 7, 32, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide })
);
under.rotation.x = Math.PI;
under.position.y = -4.7;
scene.add(under);

function glowRing(radius, opacity, y) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.06, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0x27e5ff, transparent: true, opacity })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  scene.add(m);
  return m;
}
const ringEdge = glowRing(PLATFORM_RADIUS + 0.05, 0.95, 0.03);
glowRing(PLATFORM_RADIUS * 0.66, 0.35, 0.02);
glowRing(PLATFORM_RADIUS * 0.33, 0.30, 0.02);

const grid = new THREE.PolarGridHelper(PLATFORM_RADIUS - 0.3, 12, 4, 64, 0x0d3a4a, 0x092833);
grid.position.y = 0.012;
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);

const crystalMat = new THREE.MeshStandardMaterial({
  color: 0x0d2f38, emissive: 0x00b8d9, emissiveIntensity: 0.55,
  roughness: 0.25, metalness: 0.1, flatShading: true
});
const crystalGeo = new THREE.OctahedronGeometry(1, 0);
for (let i = 0; i < 9; i++) {
  const h = 0.5 + Math.random() * 1.4;
  const c = new THREE.Mesh(crystalGeo, crystalMat);
  const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
  const r = PLATFORM_RADIUS - 0.5;
  c.position.set(Math.cos(a) * r, h * 0.5, Math.sin(a) * r);
  c.scale.set(0.35 + Math.random() * 0.25, h, 0.35 + Math.random() * 0.25);
  c.rotation.y = Math.random() * Math.PI;
  c.castShadow = true;
  scene.add(c);
}

/* ============================ АСТЕРОИДЫ ============================ */
const asteroids = [];
{
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.9, metalness: 0.2, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = Math.random() * Math.PI * 2;
    const r = 45 + Math.random() * 130;
    m.position.set(Math.cos(a) * r, -25 + Math.random() * 70, Math.sin(a) * r);
    m.scale.setScalar(0.8 + Math.random() * 3.2);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    m.userData = { spin: (Math.random() - 0.5) * 0.3, bobA: 0.5 + Math.random() * 2, bobS: Math.random() * Math.PI * 2, baseY: m.position.y };
    scene.add(m);
    asteroids.push(m);
  }
}

/* ============================ СФЕРЫ ДЛЯ СБОРА ============================ */
const orbMat = new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x00cfff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0 });
const orbGeo = new THREE.SphereGeometry(0.32, 24, 16);
const orbs = [];
for (let i = 0; i < TOTAL_ORBS; i++) {
  const orb = new THREE.Mesh(orbGeo, orbMat);
  const a = (i / TOTAL_ORBS) * Math.PI * 2 + 0.5;
  const r = 4 + (i % 3) * 3.2;
  orb.position.set(Math.cos(a) * r, 0.9, Math.sin(a) * r);
  orb.userData = { phase: Math.random() * Math.PI * 2, picked: false };
  scene.add(orb);
  orbs.push(orb);
}

/* ============================ БОКСЁРСКАЯ ГРУША (центр платформы) ============================ */
const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 0.35, metalness: 0.85 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.5, metalness: 0.7 });

// Стойка
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 0.1, 32), steelDark);
base.position.y = 0.05;
base.castShadow = base.receiveShadow = true;
scene.add(base);

const column = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.52, 16), steel);
column.position.y = 0.36;
column.castShadow = true;
scene.add(column);

const joint = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), steel);
joint.position.y = 0.62;
joint.castShadow = true;
scene.add(joint);

// Маятник: группа-точка вращения на шарнире
const bagPivot = new THREE.Group();
bagPivot.position.y = 0.62;
scene.add(bagPivot);

const leather = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.55, metalness: 0.05 });
const bagBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 1.22, 24), leather);
bagBody.position.y = 0.65;
bagBody.castShadow = true;
bagPivot.add(bagBody);

const bandMat = new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.6, metalness: 0.3 });
for (const y of [0.1, 1.18]) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.032, 10, 32), bandMat);
  band.rotation.x = Math.PI / 2;
  band.position.y = y;
  band.castShadow = true;
  bagPivot.add(band);
}
const bagCap = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.34, 0.07, 24), bandMat);
bagCap.position.y = 1.29;
bagCap.castShadow = true;
bagPivot.add(bagCap);

// Физика маятника (углы наклона + скорости)
const bag = { ax: 0, az: 0, vx: 0, vz: 0, pulse: 0 };
const BAG_K = 11, BAG_C = 1.25, BAG_MAX = 0.62;

/* ============================ БОЕВАЯ СИСТЕМА: ПОЗЫ УДАРОВ ============================
   Позы подобраны и проверены численно на скелете модели.
   Оси в локальных системах костей Mixamo: для правой руки +X вперёд, для левой -X.
   Формат: [наклон X, поворот Y, крен Z] в радианах. */
const BONE = {
  RA: "mixamorig:RightArm",  RF: "mixamorig:RightForeArm",
  LA: "mixamorig:LeftArm",   LF: "mixamorig:LeftForeArm",
  S1: "mixamorig:Spine1",    S2: "mixamorig:Spine2",
};

const PUNCHES = [
  {
    name: "Джаб", D: 0.38, lunge: 1.8, power: 2.4,
    windup: { [BONE.RA]: [0.35, 0, 0.3],  [BONE.RF]: [0.7, 0, 0],   [BONE.LA]: [-0.5, 0, 0.55],  [BONE.LF]: [-1.9, 0, 0], [BONE.S1]: [0, 0.12, 0],   [BONE.S2]: [0, 0.12, 0] },
    strike: { [BONE.RA]: [1.95, 0.5, -0.2], [BONE.RF]: [-0.2, 0, 0], [BONE.LA]: [-0.5, 0, 0.55], [BONE.LF]: [-1.9, 0, 0], [BONE.S1]: [0, 0.35, 0],   [BONE.S2]: [0, 0.35, 0] },
  },
  {
    name: "Кросс", D: 0.42, lunge: 2.1, power: 2.8,
    windup: { [BONE.LA]: [-0.3, 0, 0.3],  [BONE.LF]: [-0.8, 0, 0],  [BONE.RA]: [0.5, 0, 0.55],   [BONE.RF]: [1.9, 0, 0],  [BONE.S1]: [0, -0.15, 0],  [BONE.S2]: [0, -0.15, 0] },
    strike: { [BONE.LA]: [-1.6, -0.2, -0.7], [BONE.LF]: [0.2, 0, 0], [BONE.RA]: [0.5, 0, 0.55], [BONE.RF]: [1.9, 0, 0],  [BONE.S1]: [0, -0.42, 0],  [BONE.S2]: [0, -0.42, 0] },
  },
  {
    name: "Хук", D: 0.46, lunge: 1.9, power: 3.2,
    windup: { [BONE.RA]: [0.9, 0.4, -0.5], [BONE.RF]: [-0.4, 0, 0], [BONE.LA]: [-0.5, 0, 0.55], [BONE.LF]: [-1.9, 0, 0], [BONE.S1]: [0, 0.2, 0],    [BONE.S2]: [0, 0.2, 0] },
    strike: { [BONE.RA]: [1.6, 0.6, 0.7],  [BONE.RF]: [-0.35, 0, 0], [BONE.LA]: [-0.45, 0, 0.5], [BONE.LF]: [-1.8, 0, 0], [BONE.S1]: [0.08, 0.55, 0], [BONE.S2]: [0.08, 0.55, 0] },
  },
  {
    name: "Апперкот", D: 0.52, lunge: 1.7, power: 3.6,
    windup: { [BONE.LA]: [-0.35, 0, 0.35], [BONE.LF]: [-0.5, 0, 0], [BONE.RA]: [0.35, 0, 0.5],  [BONE.RF]: [1.6, 0, 0],  [BONE.S1]: [0.15, -0.1, 0], [BONE.S2]: [0.15, -0.1, 0] },
    strike: { [BONE.LA]: [-1.25, -0.6, 0.53], [BONE.LF]: [-1.2, 0, 0], [BONE.RA]: [0.5, 0, 0.55], [BONE.RF]: [1.9, 0, 0], [BONE.S1]: [-0.12, -0.15, 0], [BONE.S2]: [-0.12, -0.15, 0] },
  },
];

function lerpPose(a, b, k) {
  const out = {};
  for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const ea = a[n] || [0, 0, 0], eb = b[n] || [0, 0, 0];
    out[n] = [ea[0] + (eb[0] - ea[0]) * k, ea[1] + (eb[1] - ea[1]) * k, ea[2] + (eb[2] - ea[2]) * k];
  }
  return out;
}

/* ============================ ПЕРСОНАЖ ============================ */
const pivot = new THREE.Group();
scene.add(pivot);

let mixer = null;
const actions = {};
let activeAction = null;
let modelReady = false;
const punchBones = {};   // ключ кости -> THREE.Bone

const loader = new GLTFLoader();
loader.load(
  "./models/Soldier.glb",
  (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    model.rotation.y = MODEL_YAW;
    pivot.add(model);

    for (const [k, name] of Object.entries(BONE)) {
      const b = model.getObjectByName(name);
      if (b) punchBones[k] = b;
    }

    mixer = new THREE.AnimationMixer(model);
    const pick = (n) => THREE.AnimationClip.findByName(gltf.animations, n);
    actions.idle = mixer.clipAction(pick("Idle"));
    actions.walk = mixer.clipAction(pick("Walk"));
    actions.run = mixer.clipAction(pick("Run"));
    actions.idle.play();
    activeAction = actions.idle;
    modelReady = true;

    document.getElementById("overlay").classList.add("hidden");
    toast("🥊 Бей грушу в центре! ЛКМ — серия ударов");
  },
  (e) => {
    if (e.total > 0) {
      const p = Math.round((e.loaded / e.total) * 100);
      document.querySelector("#bar div").style.width = p + "%";
      document.getElementById("loadtext").textContent = `Загрузка модели персонажа… ${p}%`;
    }
  },
  (err) => {
    console.error(err);
    document.querySelector("#overlay .spin").style.display = "none";
    document.getElementById("loadtext").textContent = "⚠ Ошибка загрузки модели. Обновите страницу.";
  }
);

function setAction(next, fade = 0.25) {
  if (!next || next === activeAction) return;
  next.reset();
  next.play();
  if (activeAction) next.crossFadeFrom(activeAction, fade, true);
  activeAction = next;
}

/* ============================ УПРАВЛЕНИЕ ============================ */
const keys = {};
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.code === "Space" && !e.repeat) requestPunch();
  keys[e.code] = true;
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// Камера: перетаскивание ЛКМ/ПКМ; короткий клик ЛКМ = удар
const cam = { yaw: 0, pitch: 0.30, dist: 6.5 };
let dragging = false, px = 0, py = 0;
let downInfo = null;
const el = renderer.domElement;
el.addEventListener("pointerdown", (e) => {
  dragging = true; px = e.clientX; py = e.clientY;
  downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  el.setPointerCapture(e.pointerId);
});
el.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - px, dy = e.clientY - py;
  if (downInfo) downInfo.moved += Math.abs(dx) + Math.abs(dy);
  cam.yaw -= dx * 0.005;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.005, 0.05, 1.15);
  px = e.clientX; py = e.clientY;
});
el.addEventListener("pointerup", (e) => {
  dragging = false;
  if (e.button === 0 && downInfo && downInfo.moved < 7 && performance.now() - downInfo.t < 400) {
    requestPunch();
  }
  downInfo = null;
});
el.addEventListener("contextmenu", (e) => e.preventDefault());
el.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.004, 3, 14);
}, { passive: false });

/* ============================ СОСТОЯНИЕ ИГРОКА ============================ */
const pos = new THREE.Vector3(0, 0, 4.6);   // спавн перед грушей
const vel = new THREE.Vector3();
let yaw = Math.PI;                          // лицом к груше (в -Z)
const UP = new THREE.Vector3(0, 1, 0);
const smoothTarget = new THREE.Vector3(0, 1.5, 4.6);
let shake = 0;
let gameTime = 0;

function dampAngle(current, target, lambda, dt) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/* ============================ СОСТОЯНИЕ КОМБО ============================ */
const ps = { active: null, p: 0, nextIdx: 0, lastStart: -10, chain: [], impacted: false };
let hits = 0;

function requestPunch() {
  if (!modelReady) return;
  if (ps.active && ps.p < 0.5) return;                    // прошлый удар ещё не отработал
  if (gameTime - ps.lastStart > 1.1) { ps.nextIdx = 0; ps.chain = []; }  // комбо остыло
  const punch = PUNCHES[ps.nextIdx];
  ps.nextIdx = (ps.nextIdx + 1) % PUNCHES.length;
  ps.active = punch;
  ps.p = 0;
  ps.impacted = false;
  ps.lastStart = gameTime;
  ps.chain.push(punch.name);
  if (ps.chain.length > 4) ps.chain.shift();
  if (ps.chain.length === 4) toast("💥 КОМБО x4!");
  showCombo();
  // рывок вперёд
  vel.x += Math.sin(yaw) * punch.lunge;
  vel.z += Math.cos(yaw) * punch.lunge;
}

function tryHit(punch) {
  const dx = -pos.x, dz = -pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > BAG_HIT_DIST || dist < 1e-4) return;
  const nx = dx / dist, nz = dz / dist;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (fx * nx + fz * nz < 0.5) return;                    // бьём не в сторону груши
  // импульс маятнику: rotation.x наклоняет верх к +Z, rotation.z — к -X
  bag.vx += nz * punch.power;
  bag.vz += -nx * punch.power;
  bag.pulse = 1;
  hits++;
  updateScore();
  shake = 0.045 + punch.power * 0.008;
  spawnRing(-nx * 0.38, 1.32, -nz * 0.38);
}

const _euler = new THREE.Euler();
function applyPunch(dt) {
  if (!modelReady || !ps.active) return;
  ps.p += dt / ps.active.D;
  const p = Math.min(ps.p, 1);
  const w = Math.min(
    THREE.MathUtils.smoothstep(p, 0, 0.15),
    1 - THREE.MathUtils.smoothstep(p, 0.5, 1)
  );
  const k = THREE.MathUtils.smoothstep(p, 0.28, 0.45);
  const pose = lerpPose(ps.active.windup, ps.active.strike, k);
  for (const name in pose) {
    const bone = punchBones[name];
    if (!bone) continue;
    const e = pose[name];
    _euler.set(e[0], e[1], e[2]);
    const q = bone.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(_euler));
    bone.quaternion.slerp(q, w);
  }
  if (!ps.impacted && p >= 0.45) {
    ps.impacted = true;
    tryHit(ps.active);
  }
  if (ps.p >= 1) ps.active = null;
}

/* ============================ ЭФФЕКТЫ УДАРА ============================ */
const rings = [];
const ringGeo = new THREE.RingGeometry(0.55, 0.72, 32);
function spawnRing(x, y, z) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xbff8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
  }));
  m.position.set(x, y, z);
  scene.add(m);
  rings.push({ mesh: m, life: 0 });
}
function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life += dt;
    r.mesh.scale.setScalar(0.25 + r.life * 6);
    r.mesh.material.opacity = 0.9 * (1 - r.life / 0.28);
    r.mesh.lookAt(camera.position);
    if (r.life > 0.28) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      rings.splice(i, 1);
    }
  }
}

/* ============================ HUD ============================ */
let score = 0;
const scoreEl = document.getElementById("score");
const toastEl = document.getElementById("toast");
const comboEl = document.getElementById("combo");
let toastTimer = null, comboTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}
function showCombo() {
  comboEl.textContent = ps.chain.join(" → ") + (ps.chain.length >= 4 ? " 💥" : "");
  comboEl.classList.add("show");
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => comboEl.classList.remove("show"), 1300);
}
function updateScore() {
  scoreEl.textContent = `Сферы: ${score} / ${TOTAL_ORBS} · Удары: ${hits}`;
}
updateScore();

/* ============================ ИГРОВОЙ ЦИКЛ ============================ */
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const input = new THREE.Vector3(
    (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), 0,
    (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0)
  );
  let targetSpeed = 0;
  if (input.lengthSq() > 0) {
    input.normalize().applyAxisAngle(UP, cam.yaw);
    targetSpeed = (keys.ShiftLeft || keys.ShiftRight) ? RUN_SPEED : WALK_SPEED;
    if (ps.active) targetSpeed *= 0.4;   // во время удара двигаемся медленнее
  }
  input.multiplyScalar(targetSpeed);

  const k = 1 - Math.exp(-8 * dt);
  vel.x += (input.x - vel.x) * k;
  vel.z += (input.z - vel.z) * k;
  pos.addScaledVector(vel, dt);

  // Границы платформы (скольжение вдоль края)
  const r = Math.hypot(pos.x, pos.z);
  const maxR = PLATFORM_RADIUS - 1.0;
  if (r > maxR) {
    pos.x *= maxR / r;
    pos.z *= maxR / r;
    const nx = pos.x / maxR, nz = pos.z / maxR;
    const d = vel.x * nx + vel.z * nz;
    if (d > 0) { vel.x -= nx * d; vel.z -= nz * d; }
  }

  // Столкновение с грушей + лёгкое расталкивание при подходе
  const bdx = pos.x, bdz = pos.z;
  const bd = Math.hypot(bdx, bdz);
  const speed2 = Math.hypot(vel.x, vel.z);
  if (bd < 1.15 && bd > 1e-4 && speed2 > 0.4) {
    bag.vx += (vel.z / speed2) * dt * 1.4;
    bag.vz += (-vel.x / speed2) * dt * 1.4;
  }
  if (bd < 0.88 && bd > 1e-4) {
    pos.x *= 0.88 / bd;
    pos.z *= 0.88 / bd;
    const nx = bdx / bd, nz = bdz / bd;
    const d = vel.x * nx + vel.z * nz;
    if (d < 0) { vel.x -= nx * d; vel.z -= nz * d; }
  }

  // Плавный поворот в сторону движения
  if (speed2 > 0.25 && !ps.active) yaw = dampAngle(yaw, Math.atan2(vel.x, vel.z), 12, dt);
  pivot.position.set(pos.x, 0, pos.z);
  pivot.rotation.y = yaw;

  // Анимации ходьбы/бега
  if (modelReady) {
    if (speed2 < 0.25) setAction(actions.idle);
    else if (speed2 < 3.2) setAction(actions.walk);
    else setAction(actions.run);
    if (activeAction === actions.walk) actions.walk.timeScale = THREE.MathUtils.clamp(speed2 / 1.7, 0.7, 1.6);
    if (activeAction === actions.run) actions.run.timeScale = THREE.MathUtils.clamp(speed2 / 4.6, 0.8, 1.5);
  }

  // Сбор сфер
  for (let i = orbs.length - 1; i >= 0; i--) {
    const orb = orbs[i];
    if (orb.userData.picked) continue;
    const dx = orb.position.x - pos.x, dz = orb.position.z - pos.z;
    if (dx * dx + dz * dz < 0.95) {
      orb.userData.picked = true;
      score++;
      updateScore();
      if (score === TOTAL_ORBS) toast("🎉 Все сферы собраны!");
    }
  }
}

function updateBag(dt, t) {
  const ax2 = -BAG_K * bag.ax - BAG_C * bag.vx;
  const az2 = -BAG_K * bag.az - BAG_C * bag.vz;
  bag.vx += ax2 * dt; bag.vz += az2 * dt;
  bag.ax += bag.vx * dt; bag.az += bag.vz * dt;
  if (Math.abs(bag.ax) > BAG_MAX) { bag.ax = Math.sign(bag.ax) * BAG_MAX; bag.vx *= -0.25; }
  if (Math.abs(bag.az) > BAG_MAX) { bag.az = Math.sign(bag.az) * BAG_MAX; bag.vz *= -0.25; }
  bagPivot.rotation.x = bag.ax + Math.sin(t * 1.6) * 0.006;
  bagPivot.rotation.z = bag.az + Math.cos(t * 1.3) * 0.006;
  bag.pulse *= Math.exp(-6 * dt);
  bagBody.scale.set(1 + 0.05 * bag.pulse, 1 - 0.07 * bag.pulse, 1 + 0.05 * bag.pulse);
}

function updateWorld(t, dt) {
  for (const a of asteroids) {
    a.rotation.y += a.userData.spin * dt;
    a.position.y = a.userData.baseY + Math.sin(t * 0.4 + a.userData.bobS) * a.userData.bobA * 0.5;
  }
  for (let i = orbs.length - 1; i >= 0; i--) {
    const orb = orbs[i];
    if (orb.userData.picked) {
      orb.scale.multiplyScalar(1 - 5 * dt);
      orb.position.y += 1.8 * dt;
      if (orb.scale.x < 0.04) { scene.remove(orb); orbs.splice(i, 1); }
      continue;
    }
    orb.position.y = 0.9 + Math.sin(t * 2 + orb.userData.phase) * 0.15;
    orb.rotation.y += dt * 1.2;
  }
  planet.rotation.y += dt * 0.02;
  planetRing.rotation.z += dt * 0.01;
  ringEdge.material.opacity = 0.75 + Math.sin(t * 2.2) * 0.2;
  updateBag(dt, t);
  updateRings(dt);
}

function updateCamera(dt) {
  const target = new THREE.Vector3(pos.x, 1.5, pos.z);
  smoothTarget.lerp(target, 1 - Math.exp(-10 * dt));
  const off = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch),
    Math.sin(cam.pitch),
    Math.cos(cam.yaw) * Math.cos(cam.pitch)
  ).multiplyScalar(cam.dist);
  camera.position.copy(smoothTarget).add(off);
  camera.lookAt(smoothTarget);
  if (shake > 0.0008) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-7 * dt);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  gameTime += dt;
  updatePlayer(dt);
  if (mixer) mixer.update(dt);   // сначала скелетная анимация…
  applyPunch(dt);                // …зПоверх неё — процедурный удар
  updateWorld(t, dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}
animate();

/* ============================ РАЗМЕР ОКНА ============================ */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
