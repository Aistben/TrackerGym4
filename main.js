import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* ============================ НАСТРОЙКИ ============================ */
const PLATFORM_RADIUS = 14;   // радиус космической платформы
const WALK_SPEED = 2.1;       // скорость шага, м/с
const RUN_SPEED = 5.4;        // скорость бега, м/с
const MODEL_YAW = Math.PI;    // модель в файле смотрит в -Z → разворачиваем на +Z
const TOTAL_ORBS = 7;

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

// «Киль» платформы — она парит в космосе
const under = new THREE.Mesh(
  new THREE.ConeGeometry(PLATFORM_RADIUS + 0.75, 7, 32, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide })
);
under.rotation.x = Math.PI;
under.position.y = -4.7;
scene.add(under);

// Светящиеся кольца
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

// Кристаллы по краю платформы
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

/* ============================ АСТЕРОИДЫ ВОКРУГ ============================ */
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

/* ============================ ПЕРСОНАЖ ============================ */
const pivot = new THREE.Group();   // точка, которой мы управляем
scene.add(pivot);

let mixer = null;
const actions = {};
let activeAction = null;
let modelReady = false;

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

    mixer = new THREE.AnimationMixer(model);
    const pick = (n) => THREE.AnimationClip.findByName(gltf.animations, n);
    actions.idle = mixer.clipAction(pick("Idle"));
    actions.walk = mixer.clipAction(pick("Walk"));
    actions.run = mixer.clipAction(pick("Run"));
    actions.idle.play();
    activeAction = actions.idle;
    modelReady = true;

    document.getElementById("overlay").classList.add("hidden");
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
  keys[e.code] = true;
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// Орбитальная камера (мышь)
const cam = { yaw: Math.PI, pitch: 0.32, dist: 6.5 };
let dragging = false, px = 0, py = 0;
const el = renderer.domElement;
el.addEventListener("pointerdown", (e) => {
  dragging = true; px = e.clientX; py = e.clientY;
  el.setPointerCapture(e.pointerId);
});
el.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  cam.yaw -= (e.clientX - px) * 0.005;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + (e.clientY - py) * 0.005, 0.05, 1.15);
  px = e.clientX; py = e.clientY;
});
el.addEventListener("pointerup", () => { dragging = false; });
el.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.004, 3, 14);
}, { passive: false });

/* ============================ СОСТОЯНИЕ ИГРОКА ============================ */
const pos = new THREE.Vector3(0, 0, 0);
const vel = new THREE.Vector3();
let yaw = 0;
const UP = new THREE.Vector3(0, 1, 0);
const smoothTarget = new THREE.Vector3(0, 1.5, 0);

function dampAngle(current, target, lambda, dt) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/* ============================ HUD ============================ */
let score = 0;
const scoreEl = document.getElementById("score");
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ============================ ИГРОВОЙ ЦИКЛ ============================ */
const clock = new THREE.Clock();

function updatePlayer(dt) {
  // Ввод относительно камеры
  const input = new THREE.Vector3(
    (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), 0,
    (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0)
  );
  let targetSpeed = 0;
  if (input.lengthSq() > 0) {
    input.normalize().applyAxisAngle(UP, cam.yaw);
    targetSpeed = (keys.ShiftLeft || keys.ShiftRight) ? RUN_SPEED : WALK_SPEED;
  }
  input.multiplyScalar(targetSpeed);

  const k = 1 - Math.exp(-8 * dt);
  vel.x += (input.x - vel.x) * k;
  vel.z += (input.z - vel.z) * k;
  pos.addScaledVector(vel, dt);

  // Не сходить с платформы (скольжение вдоль края)
  const r = Math.hypot(pos.x, pos.z);
  const maxR = PLATFORM_RADIUS - 1.0;
  if (r > maxR) {
    pos.x *= maxR / r;
    pos.z *= maxR / r;
    const nx = pos.x / maxR, nz = pos.z / maxR;
    const d = vel.x * nx + vel.z * nz;
    if (d > 0) { vel.x -= nx * d; vel.z -= nz * d; }
  }

  // Плавный поворот в сторону движения
  const speed = Math.hypot(vel.x, vel.z);
  if (speed > 0.25) yaw = dampAngle(yaw, Math.atan2(vel.x, vel.z), 12, dt);
  pivot.position.set(pos.x, 0, pos.z);
  pivot.rotation.y = yaw;

  // Анимации: idle / walk / run с плавным переходом
  if (modelReady) {
    if (speed < 0.25) setAction(actions.idle);
    else if (speed < 3.2) setAction(actions.walk);
    else setAction(actions.run);
    if (activeAction === actions.walk) actions.walk.timeScale = THREE.MathUtils.clamp(speed / 1.7, 0.7, 1.6);
    if (activeAction === actions.run) actions.run.timeScale = THREE.MathUtils.clamp(speed / 4.6, 0.8, 1.5);
  }

  // Сбор сфер
  for (let i = orbs.length - 1; i >= 0; i--) {
    const orb = orbs[i];
    if (orb.userData.picked) continue;
    const dx = orb.position.x - pos.x, dz = orb.position.z - pos.z;
    if (dx * dx + dz * dz < 0.95) {
      orb.userData.picked = true;
      score++;
      scoreEl.textContent = `Сферы: ${score} / ${TOTAL_ORBS}`;
      if (score === TOTAL_ORBS) toast("🎉 Все сферы собраны!");
    }
  }
}

function updateWorld(t, dt) {
  for (const a of asteroids) {
    a.rotation.y += a.userData.spin * dt;
    a.position.y = a.userData.baseY + Math.sin(t * 0.4 + a.userData.bobS) * a.userData.bobA * 0.5;
  }
  for (const orb of orbs) {
    if (orb.userData.picked) {
      orb.scale.multiplyScalar(1 - 5 * dt);
      orb.position.y += 1.8 * dt;
      if (orb.scale.x < 0.04) { scene.remove(orb); orbs.splice(orbs.indexOf(orb), 1); }
      continue;
    }
    orb.position.y = 0.9 + Math.sin(t * 2 + orb.userData.phase) * 0.15;
    orb.rotation.y += dt * 1.2;
  }
  planet.rotation.y += dt * 0.02;
  planetRing.rotation.z += dt * 0.01;
  ringEdge.material.opacity = 0.75 + Math.sin(t * 2.2) * 0.2;
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
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updatePlayer(dt);
  updateWorld(t, dt);
  updateCamera(dt);
  if (mixer) mixer.update(dt);
  renderer.render(scene, camera);
}
animate();

/* ============================ РАЗМЕР ОКНА ============================ */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
