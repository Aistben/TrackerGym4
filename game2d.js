/* ============================================================
   КОЛОНИСТ — 2D-игра: собирай ресурсы и строй базу
   Персонаж нарисован на canvas с процедурной скелетной
   анимацией (ходьба, прыжок, замах инструментом).
   ============================================================ */
"use strict";

/* ---------------- КОНСТАНТЫ ---------------- */
const W_WORLD = 6400;          // ширина мира, px
const GROUND = 640;            // базовый уровень земли
const GRID = 32;               // сетка строительства
const GRAV = 1700;
const JUMP_V = -640;
const ACC = 1900;
const MAX_V = 270;
const REACH = 105;             // дистанция до дерева/камня
const PLACE_DIST = 330;        // дистанция строительства
const DAY_LEN = 160;           // длительность суток, сек
const SAVE_KEY = "colonist2d_v1";

const SOLID = { platform: true, wall: true, stone: true, fire: false };

const SLOTS = [
  { id: "tool",     icon: "🪓", name: "Инструм.", wood: 0, stone: 0 },
  { id: "platform", icon: "▭",  name: "Платформа", wood: 5, stone: 0 },
  { id: "wall",     icon: "🧱", name: "Стена",     wood: 4, stone: 0 },
  { id: "stone",    icon: "🪨", name: "Блок",      wood: 0, stone: 6 },
  { id: "fire",     icon: "🔥", name: "Костёр",    wood: 12, stone: 6 },
];

/* ---------------- ХОЛСТ ---------------- */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
let VW = 0, VH = 0, DPR = 1;
const dk = document.createElement("canvas");       // слой темноты
const dkx = dk.getContext("2d");

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  dk.width = VW * DPR; dk.height = VH * DPR;
  dkx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/* ---------------- УТИЛИТЫ ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (t) => t * t * (3 - 2 * t);
function lerpHex(h1, h2, k) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const r = Math.round(lerp(a >> 16, b >> 16, k));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
  const bl = Math.round(lerp(a & 255, b & 255, k));
  return `rgb(${r},${g},${bl})`;
}
// детерминированный шум по целому
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/* ---------------- МИР ---------------- */
function heightAt(x) {
  return GROUND
    - 46 * Math.sin(x * 0.0016 + 1.7)
    - 24 * Math.sin(x * 0.0043 + 0.6)
    - 12 * Math.sin(x * 0.009 + 3.1);
}

const nodes = [];   // деревья и камни
let nid = 0;
function addNode(type, x) {
  const n = {
    id: nid++, type, x, baseY: heightAt(x),
    hp: type === "tree" ? 3 : 4, maxHp: type === "tree" ? 3 : 4,
    seed: hash(x), scale: 0.8 + hash(x * 3) * 0.5,
    shake: 0, dead: false, fall: 0, respawn: 0, grow: 10,
  };
  nodes.push(n);
  return n;
}
function genWorld() {
  // гарантированные ресурсы у спавна
  addNode("tree", 260); addNode("tree", 470); addNode("rock", 610); addNode("tree", 760);
  for (let x = 1000; x < W_WORLD - 300; x += 320 + hash(x) * 380) {
    addNode(hash(x * 7) < 0.62 ? "tree" : "rock", x);
  }
}

const blocks = [];              // постройки {gx,gy,t}
const occ = new Map();          // "gx,gy" -> block
const cellKey = (gx, gy) => gx + "," + gy;

/* ---------------- СОСТОЯНИЕ ---------------- */
const c = { x: 400, y: 0, vx: 0, vy: 0, face: 1, onGround: true, ph: 0, action: null };
c.y = heightAt(c.x);
const inv = { wood: 0, stone: 0 };
let sel = 0;
let camX = 0, camY = 0;
let dayT = 0.12, dayN = 1;
let elapsed = 0;
const mouse = { x: 0, y: 0, down: false };
const keys = {};
let swingCd = 0;
let errCd = 0;
const ms = { wood: false, stone: false, fire: false, v10: false, night: false };
let saveCd = 0;

/* ---------------- ЗВУК (WebAudio) ---------------- */
let AC = null, master = null, muted = false, noiseBuf = null;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { /* без звука */ }
}
function tone(freq, freq2, dur, type, vol) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(freq2, 1), AC.currentTime + dur);
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(AC.currentTime + dur + 0.02);
}
function noise(dur, freq, vol) {
  if (!AC) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(); s.stop(AC.currentTime + dur + 0.02);
}
function sfx(name) {
  if (!AC || muted) return;
  if (name === "chop") { noise(0.09, 700, 0.5); tone(130, 70, 0.09, "triangle", 0.35); }
  else if (name === "mine") { tone(880, 240, 0.07, "square", 0.16); noise(0.06, 2400, 0.3); }
  else if (name === "place") { tone(330, 180, 0.08, "triangle", 0.4); noise(0.05, 500, 0.25); }
  else if (name === "error") { tone(170, 120, 0.13, "sawtooth", 0.2); }
  else if (name === "win") { tone(523, 523, 0.12, "triangle", 0.3); setTimeout(() => tone(659, 659, 0.12, "triangle", 0.3), 90); setTimeout(() => tone(784, 784, 0.18, "triangle", 0.3), 180); }
}
window.addEventListener("pointerdown", initAudio, { once: false });
window.addEventListener("keydown", initAudio, { once: false });

/* ---------------- HUD ---------------- */
const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
let toastTimer = null;
function toast(msg, dur = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), dur);
}
function refreshHotbar() {
  const bar = $("hotbar");
  bar.innerHTML = "";
  SLOTS.forEach((s, i) => {
    const d = document.createElement("div");
    const poor = inv.wood < s.wood || inv.stone < s.stone;
    d.className = "slot" + (i === sel ? " sel" : "") + (poor && i > 0 ? " poor" : "");
    const cost = [];
    if (s.wood) cost.push(`🪵${s.wood}`);
    if (s.stone) cost.push(`🪨${s.stone}`);
    d.innerHTML = `<span class="key">${i + 1}</span><span class="ic">${s.icon}</span><span class="nm">${s.name}</span>` +
      (i > 0 ? `<span class="cost">${cost.join(" ")}</span>` : `<span class="cost">&nbsp;</span>`);
    d.addEventListener("pointerdown", (e) => { e.stopPropagation(); sel = i; refreshHotbar(); });
    bar.appendChild(d);
  });
}
function updateHUD() {
  $("inv-wood").textContent = inv.wood;
  $("inv-stone").textContent = inv.stone;
  $("dayLabel").textContent = "День " + dayN;
  $("clockIcon").textContent = dayT < 0.07 ? "🌅" : dayT < 0.55 ? "☀️" : dayT < 0.7 ? "🌇" : "🌙";
}
$("btnReset").addEventListener("click", () => { localStorage.removeItem(SAVE_KEY); location.reload(); });
$("btnMute").addEventListener("click", toggleMute);
function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  $("btnMute").textContent = muted ? "🔇" : "🔊";
}

/* ---------------- ЧАСТИЦЫ И ТЕКСТ ---------------- */
const parts = [];
function spawnParts(x, y, n, color, opt = {}) {
  for (let i = 0; i < n; i++) {
    const a = (opt.up ? -Math.PI / 2 : Math.random() * Math.PI * 2);
    const sp = (opt.sp || 120) * (0.4 + Math.random() * 0.9);
    parts.push({
      x, y,
      vx: Math.cos(a) * sp + (opt.vx || 0),
      vy: Math.sin(a) * sp + (opt.vy || 0),
      g: opt.g !== undefined ? opt.g : 900,
      life: 1, decay: opt.decay || 1.6,
      size: 2 + Math.random() * 3, color,
    });
  }
}
const floaters = [];
function floatText(x, y, txt, color) {
  floaters.push({ x, y, txt, color, life: 1 });
}

/* ---------------- ДЕЙСТВИЯ ПЕРСОНАЖА ---------------- */
function findTarget() {
  let best = null, bd = REACH;
  for (const n of nodes) {
    if (n.dead) continue;
    const dx = Math.abs(n.x - c.x);
    if (dx < bd && Math.abs(n.baseY - c.y) < 170) { bd = dx; best = n; }
  }
  return best;
}
function startSwing() {
  const t = findTarget();
  if (!t) return;
  c.face = t.x >= c.x ? 1 : -1;
  c.action = {
    type: "swing", node: t,
    tool: t.type === "tree" ? "axe" : "pick",
    t: 0, dur: 0.5, hit: false,
  };
}
function applyHit(n) {
  n.shake = 1;
  n.hp--;
  if (n.type === "tree") {
    inv.wood += 2;
    floatText(n.x, n.baseY - 60, "+2 🪵", "#e8c68a");
    spawnParts(n.x, n.baseY - 50, 8, "#a3703f", { up: true, sp: 150 });
    spawnParts(n.x + (Math.random() - 0.5) * 30, n.baseY - 80, 5, "#6fbf62", { up: true, sp: 80, g: 250, decay: 1 });
    sfx("chop");
    if (!ms.wood) { ms.wood = true; toast("🪵 Первое дерево срублено!"); }
  } else {
    inv.stone += 2;
    floatText(n.x, n.baseY - 30, "+2 🪨", "#d7deeb");
    spawnParts(n.x, n.baseY - 16, 8, "#9aa3b2", { up: true, sp: 160 });
    sfx("mine");
    if (!ms.stone) { ms.stone = true; toast("🪨 Камень добыт!"); }
  }
  checkMilestones();
  if (n.hp <= 0) {
    n.dead = true; n.fall = 0;
    if (n.type === "tree") { inv.wood += 2; floatText(n.x, n.baseY - 80, "+2 🪵", "#e8c68a"); }
    else { inv.stone += 2; floatText(n.x, n.baseY - 40, "+2 🪨", "#d7deeb"); spawnParts(n.x, n.baseY - 20, 16, "#8b93a3", { up: true, sp: 200 }); }
  }
}
function mouseWorld() { return { x: mouse.x + camX, y: mouse.y + camY }; }

function placeCheck(gx, gy) {
  const cx = gx * GRID + GRID / 2, cyTop = gy * GRID;
  const slot = SLOTS[sel];
  if (occ.has(cellKey(gx, gy))) return "Здесь уже что-то стоит";
  const dist = Math.hypot(cx - c.x, cyTop + 16 - (c.y - 30));
  if (dist > PLACE_DIST) return "Слишком далеко";
  // не ставить внутрь персонажа
  if (Math.abs(cx - c.x) < 30 && cyTop + GRID > c.y - 60 && cyTop < c.y) return "Персонаж мешает";
  // опора: земля или соседний блок
  const grounded = heightAt(cx) >= cyTop + GRID - 6;
  const nb = occ.has(cellKey(gx - 1, gy)) || occ.has(cellKey(gx + 1, gy)) ||
             occ.has(cellKey(gx, gy - 1)) || occ.has(cellKey(gx, gy + 1));
  if (slot.id === "fire") {
    if (!grounded && !nb) return "Костру нужна опора";
  } else if (!grounded && !nb) {
    return "Нужна опора (земля или блок)";
  }
  return null;
}
function tryPlace() {
  const w = mouseWorld();
  const gx = Math.floor(w.x / GRID), gy = Math.floor(w.y / GRID);
  const slot = SLOTS[sel];
  const err = placeCheck(gx, gy);
  if (err) { if (errCd <= 0) { toast("⛔ " + err, 1400); sfx("error"); errCd = 0.9; } return; }
  if (inv.wood < slot.wood || inv.stone < slot.stone) {
    if (errCd <= 0) { toast("⛔ Не хватает ресурсов", 1400); sfx("error"); errCd = 0.9; }
    return;
  }
  inv.wood -= slot.wood; inv.stone -= slot.stone;
  const b = { gx, gy, t: slot.id, born: elapsed };
  blocks.push(b); occ.set(cellKey(gx, gy), b);
  c.face = gx * GRID + 16 >= c.x ? 1 : -1;
  c.action = { type: "build", t: 0, dur: 0.32, tool: "hammer", hit: true };
  sfx("place");
  spawnParts(gx * GRID + 16, gy * GRID + 16, 6, "#c9a06a", { sp: 90 });
  if (slot.id === "fire" && !ms.fire) {
    ms.fire = true;
    toast("🔥 Костёр горит — база основана! Ночью он освещает площадку");
    sfx("win");
  }
  checkMilestones();
  refreshHotbar();
}
function checkMilestones() {
  if (!ms.v10 && blocks.length >= 10) {
    ms.v10 = true; toast("🏠 База разрастается: 10 построек!", 3500); sfx("win");
  }
}

/* ---------------- ВВОД ---------------- */
window.addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") c.jumpBuf = 0.12;
  if (e.code === "KeyM") toggleMute();
  if (e.code === "Escape") { sel = 0; refreshHotbar(); }
  const m = e.code.match(/^Digit([1-5])$/);
  if (m) { sel = +m[1] - 1; refreshHotbar(); }
  if (e.code === "KeyE" && sel === 0 && !c.action && swingCd <= 0) { startSwing(); swingCd = 0.1; }
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.down = false; });

cv.addEventListener("pointerdown", (e) => {
  if (e.button === 2) { sel = 0; refreshHotbar(); return; }
  if (e.button !== 0) return;
  mouse.down = true;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (sel > 0) tryPlace();
  else if (!c.action && swingCd <= 0) { startSwing(); swingCd = 0.1; }
});
cv.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener("pointerup", () => { mouse.down = false; });
cv.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("wheel", (e) => {
  sel = (sel + (e.deltaY > 0 ? 1 : -1) + SLOTS.length) % SLOTS.length;
  refreshHotbar();
}, { passive: true });

/* ---------------- ФИЗИКА / ОБНОВЛЕНИЕ ---------------- */
function updateCharacter(dt) {
  const dir = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const acc = c.onGround ? ACC : ACC * 0.55;
  if (dir !== 0 && !(c.action && c.action.type === "swing")) {
    c.vx += dir * acc * dt;
    if (!c.action) c.face = dir;
  } else {
    const fr = (c.onGround ? 2300 : 500) * dt;
    if (Math.abs(c.vx) <= fr) c.vx = 0; else c.vx -= Math.sign(c.vx) * fr;
  }
  c.vx = clamp(c.vx, -MAX_V, MAX_V);

  // прыжок с буфером и «койотом»
  c.jumpBuf = (c.jumpBuf || 0) - dt;
  c.coyote = c.onGround ? 0.1 : (c.coyote || 0) - dt;
  if (c.jumpBuf > 0 && c.coyote > 0) {
    c.vy = JUMP_V; c.jumpBuf = 0; c.coyote = 0; c.onGround = false;
  }

  c.vy = Math.min(c.vy + GRAV * dt, 1300);
  const prevY = c.y;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.x = clamp(c.x, 30, W_WORLD - 30);

  // приземление на постройки (платформы-«полукирпичи»)
  let landed = false;
  if (c.vy >= 0) {
    for (const b of blocks) {
      if (!SOLID[b.t]) continue;
      const top = b.gy * GRID;
      if (c.x > b.gx * GRID - 10 && c.x < b.gx * GRID + GRID + 10 &&
          prevY <= top + 6 && c.y >= top) {
        c.y = top; c.vy = 0; landed = true; break;
      }
    }
  }
  const g = heightAt(c.x);
  if (c.y >= g) { c.y = g; c.vy = 0; landed = true; }
  c.onGround = landed;

  // фаза шага
  c.ph += Math.abs(c.vx) * dt * 0.055;

  // авто-повтор удара при удержании ЛКМ
  swingCd -= dt; errCd -= dt;
  if (sel === 0 && mouse.down && !c.action && swingCd <= 0) { startSwing(); swingCd = 0.12; }

  // прогресс действия
  const a = c.action;
  if (a) {
    a.t += dt;
    if (a.type === "swing" && !a.hit && a.t >= a.dur * 0.48) {
      a.hit = true;
      const n = a.node;
      if (n && !n.dead && Math.abs(n.x - c.x) < REACH + 25) applyHit(n);
    }
    if (a.t >= a.dur) c.action = null;
  }
}

function updateNodes(dt) {
  for (const n of nodes) {
    n.shake *= Math.exp(-6 * dt);
    if (n.dead) {
      n.fall += dt;
      if (n.fall > 1.2) {
        n.respawn += dt;
        if (n.respawn > (n.type === "tree" ? 45 : 70)) {
          n.dead = false; n.hp = n.maxHp; n.fall = 0; n.respawn = 0; n.grow = 0;
        }
      }
    } else if (n.grow < 4) {
      n.grow += dt;
    }
  }
}

function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y -= 32 * dt; f.life -= 0.9 * dt;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}

/* ---------------- ДЕНЬ / НОЧЬ ---------------- */
const SKY = [
  { t: 0.00, top: "#35306b", bot: "#ff9e6d" },
  { t: 0.10, top: "#3f8fd6", bot: "#b8e0f5" },
  { t: 0.50, top: "#3f8fd6", bot: "#b8e0f5" },
  { t: 0.62, top: "#46316e", bot: "#ff8a5c" },
  { t: 0.72, top: "#060a1c", bot: "#131f3d" },
  { t: 0.95, top: "#060a1c", bot: "#131f3d" },
  { t: 1.00, top: "#35306b", bot: "#ff9e6d" },
];
function skyColors() {
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i], b = SKY[i + 1];
    if (dayT >= a.t && dayT <= b.t) {
      const k = smooth((dayT - a.t) / (b.t - a.t));
      return { top: lerpHex(a.top, b.top, k), bot: lerpHex(a.bot, b.bot, k) };
    }
  }
  return { top: SKY[0].top, bot: SKY[0].bot };
}
function nightFactor() {
  if (dayT < 0.55) return 0;
  if (dayT < 0.7) return smooth((dayT - 0.55) / 0.15);
  if (dayT < 0.93) return 1;
  return 1 - smooth(clamp((dayT - 0.93) / 0.065, 0, 1));
}
const stars = [];
for (let i = 0; i < 90; i++) stars.push({ x: hash(i * 13) , y: hash(i * 7) * 0.55, s: 0.8 + hash(i * 29) * 1.6, tw: 1 + hash(i * 3) * 3 });
const clouds = [];
for (let i = 0; i < 7; i++) clouds.push({ wx: hash(i * 31) * 3200, y: 60 + hash(i * 17) * 170, s: 0.7 + hash(i * 5) * 1.1, v: 5 + hash(i * 11) * 8 });

/* ---------------- СБЕРЕЖЕНИЯ ---------------- */
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      w: inv.wood, s: inv.stone, dayT, dayN, ms,
      px: c.x, py: c.y,
      blocks: blocks.map(b => [b.gx, b.gy, b.t]),
    }));
  } catch (e) { /* переполнение — игнорируем */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d) return false;
    inv.wood = d.w || 0; inv.stone = d.s || 0;
    dayT = d.dayT || 0.12; dayN = d.dayN || 1;
    Object.assign(ms, d.ms || {});
    c.x = d.px || 400; c.y = Math.min(d.py || heightAt(d.px || 400), heightAt(d.px || 400));
    for (const [gx, gy, t] of d.blocks || []) {
      const b = { gx, gy, t, born: 0 };
      if (!occ.has(cellKey(gx, gy))) { blocks.push(b); occ.set(cellKey(gx, gy), b); }
    }
    return true;
  } catch (e) { return false; }
}
setInterval(() => save(), 5000);
window.addEventListener("beforeunload", save);

/* ---------------- РИСОВАНИЕ ---------------- */
const w2sx = (x) => x - camX;
const w2sy = (y) => y - camY;

function drawSky(t) {
  const sc = skyColors();
  const grad = ctx.createLinearGradient(0, 0, 0, VH);
  grad.addColorStop(0, sc.top); grad.addColorStop(1, sc.bot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VW, VH);

  // звёзды
  const nf = nightFactor();
  if (nf > 0.02) {
    ctx.fillStyle = "#e8f0ff";
    for (const s of stars) {
      const sx = ((s.x * VW * 1.3 - camX * 0.02) % VW + VW) % VW;
      const sy = s.y * VH;
      ctx.globalAlpha = nf * (0.35 + 0.65 * Math.abs(Math.sin(t * s.tw + s.x * 20)));
      ctx.fillRect(sx, sy, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  const horizon = (GROUND - 90) - camY;
  // солнце
  if (dayT < 0.68) {
    const u = clamp(dayT / 0.66, 0, 1);
    const sx = VW * (0.08 + 0.84 * u);
    const sy = horizon - Math.sin(u * Math.PI) * (VH * 0.45);
    ctx.fillStyle = "rgba(255,220,120,0.25)";
    ctx.beginPath(); ctx.arc(sx, sy, 46, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffdf7e";
    ctx.beginPath(); ctx.arc(sx, sy, 26, 0, 7); ctx.fill();
  }
  // луна
  if (dayT > 0.6) {
    const v = clamp((dayT - 0.6) / 0.42, 0, 1);
    const sx = VW * (0.08 + 0.84 * v);
    const sy = horizon - Math.sin(v * Math.PI) * (VH * 0.45);
    ctx.fillStyle = "#dfe7f5";
    ctx.beginPath(); ctx.arc(sx, sy, 20, 0, 7); ctx.fill();
    ctx.fillStyle = lerpHex("#060a1c", "#060a1c", 0); // цвет выреза = небо
    ctx.fillStyle = skyColors().top;
    ctx.beginPath(); ctx.arc(sx + 8, sy - 5, 16, 0, 7); ctx.fill();
  }

  // облака
  for (const cl of clouds) {
    const span = 3400;
    let sx = ((cl.wx - camX * 0.35) % span + span) % span - 300;
    if (sx > VW + 250) continue;
    const sy = cl.y - camY * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - nf * 0.55)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 44 * cl.s, 15 * cl.s, 0, 0, 7);
    ctx.ellipse(sx + 30 * cl.s, sy + 4, 30 * cl.s, 12 * cl.s, 0, 0, 7);
    ctx.ellipse(sx - 32 * cl.s, sy + 5, 26 * cl.s, 10 * cl.s, 0, 0, 7);
    ctx.fill();
    cl.wx += cl.v * 0.016; // медленный дрейф
  }
}

function drawMountains() {
  const nf = nightFactor();
  const horizon = (GROUND - 90) - camY;
  const layers = [
    { p: 0.22, amp: 110, k: 0.0012, day: "#8fa8c8", night: "#1a2440" },
    { p: 0.45, amp: 70, k: 0.0023, day: "#6d88ab", night: "#131c33" },
  ];
  for (const L of layers) {
    ctx.fillStyle = lerpHex(L.day, L.night, nf * 0.9);
    ctx.beginPath();
    ctx.moveTo(0, VH);
    for (let sx = 0; sx <= VW + 16; sx += 16) {
      const wx = sx + camX * L.p;
      const y = horizon - L.amp * (0.55 + 0.45 * Math.sin(wx * L.k)) - 18 * Math.sin(wx * L.k * 3.7);
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(VW, VH);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTerrain() {
  const x0 = camX - 24, x1 = camX + VW + 24;
  ctx.beginPath();
  ctx.moveTo(w2sx(x0), VH + 40);
  for (let x = x0; x <= x1; x += 22) ctx.lineTo(w2sx(x), w2sy(heightAt(x)));
  ctx.lineTo(w2sx(x1), VH + 40);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, w2sy(GROUND - 90), 0, VH + 40);
  grad.addColorStop(0, "#7c5836"); grad.addColorStop(1, "#45301d");
  ctx.fillStyle = grad;
  ctx.fill();
  // трава
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 22) {
    const y = w2sy(heightAt(x));
    if (x === x0) ctx.moveTo(w2sx(x), y); else ctx.lineTo(w2sx(x), y);
  }
  ctx.strokeStyle = "#5aa14e"; ctx.lineWidth = 7; ctx.stroke();
  ctx.strokeStyle = "#7ec96d"; ctx.lineWidth = 3; ctx.stroke();
}

function drawTree(n, t) {
  const s = n.scale * clamp(n.grow / 3, 0.12, 1) * 1.15;
  const x = w2sx(n.x) + Math.sin(t * 42) * n.shake * 5;
  const y = w2sy(n.baseY);
  ctx.save();
  ctx.translate(x, y);
  if (n.dead) {
    const k = clamp(n.fall / 0.7, 0, 1);
    ctx.rotate(k * k * (Math.PI / 2) * (n.seed > 0.5 ? 1 : -1));
    ctx.globalAlpha = n.fall > 1.2 ? clamp(1 - (n.fall - 1.2) * 2, 0, 1) : 1;
  }
  ctx.scale(s, s);
  // тень
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(0, 2, 26, 6, 0, 0, 7); ctx.fill();
  // ствол
  ctx.fillStyle = "#7a4f2a";
  ctx.fillRect(-5, -52, 10, 52);
  ctx.fillStyle = "#5f3c1e";
  ctx.fillRect(-5, -52, 3, 52);
  // крона
  const sway = Math.sin(t * 1.3 + n.seed * 9) * 2;
  ctx.fillStyle = "#3f8b44";
  ctx.beginPath(); ctx.arc(sway, -78, 30, 0, 7); ctx.fill();
  ctx.fillStyle = "#4e9b4e";
  ctx.beginPath(); ctx.arc(sway - 16, -64, 20, 0, 7); ctx.arc(sway + 18, -66, 22, 0, 7); ctx.fill();
  ctx.fillStyle = "#66b95d";
  ctx.beginPath(); ctx.arc(sway + 4, -92, 18, 0, 7); ctx.fill();
  if (n.seed > 0.6) {
    ctx.fillStyle = "#e0524d";
    ctx.beginPath();
    ctx.arc(-12, -70, 3.4, 0, 7); ctx.arc(14, -84, 3.4, 0, 7); ctx.arc(2, -58, 3.4, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

function drawRock(n) {
  const s = n.scale * clamp(n.grow / 3, 0.12, 1);
  const x = w2sx(n.x) + Math.sin(0) * n.shake * 3;
  const y = w2sy(n.baseY);
  ctx.save();
  ctx.translate(x, y);
  if (n.dead) {
    const k = clamp(n.fall / 0.5, 0, 1);
    ctx.scale(1 - k * 0.6, 1 - k * 0.6);
    ctx.globalAlpha = n.fall > 1.2 ? clamp(1 - (n.fall - 1.2) * 2, 0, 1) : 1;
  }
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(0, 2, 30, 6, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  const pts = 7;
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = 22 + hash(n.id * 31 + i) * 12;
    const px = Math.cos(a) * r * 1.25, py = Math.sin(a) * r * 0.75 - 14;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#8b93a3"; ctx.fill();
  ctx.fillStyle = "#6e7686";
  ctx.beginPath();
  ctx.moveTo(-14, -4); ctx.lineTo(2, -26); ctx.lineTo(12, -8); ctx.lineTo(-2, 2);
  ctx.closePath(); ctx.fill();
  if (n.hp <= 2 && !n.dead) {
    ctx.strokeStyle = "#4d5462"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-8, -20); ctx.lineTo(-2, -12); ctx.lineTo(-9, -5); ctx.stroke();
  }
  ctx.restore();
}

function drawBlock(b, t) {
  const x = w2sx(b.gx * GRID), y = w2sy(b.gy * GRID);
  if (b.t === "fire") { drawFire(b, x, y, t); return; }
  if (b.t === "platform") {
    ctx.fillStyle = "#a9713d";
    ctx.fillRect(x, y, GRID, 12);
    ctx.fillStyle = "#8a5a30";
    for (let i = 0; i < 2; i++) ctx.fillRect(x + 4 + i * 14, y, 3, 12);
    ctx.fillStyle = "#6f4826";
    ctx.fillRect(x + 3, y + 12, 4, 7); ctx.fillRect(x + GRID - 7, y + 12, 4, 7);
  } else if (b.t === "wall") {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(x, y, GRID, GRID);
    ctx.fillStyle = "#754b27";
    ctx.fillRect(x, y + 10, GRID, 3); ctx.fillRect(x, y + 22, GRID, 3);
    ctx.fillStyle = "#c8b08a";
    ctx.fillRect(x + 4, y + 4, 2, 2); ctx.fillRect(x + 26, y + 15, 2, 2);
  } else if (b.t === "stone") {
    ctx.fillStyle = "#7d8494"; ctx.fillRect(x, y, GRID, GRID);
    ctx.strokeStyle = "#5f6674"; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, GRID - 2, GRID - 2);
    ctx.beginPath();
    ctx.moveTo(x, y + 16); ctx.lineTo(x + GRID, y + 16);
    ctx.moveTo(x + 16, y); ctx.lineTo(x + 16, y + 16);
    ctx.moveTo(x + 8, y + 16); ctx.lineTo(x + 8, y + GRID);
    ctx.moveTo(x + 24, y + 16); ctx.lineTo(x + 24, y + GRID);
    ctx.stroke();
  }
}

function drawFire(b, x, y, t) {
  const gx = x + GRID / 2, gy = y + GRID;
  // брёвна
  ctx.save();
  ctx.translate(gx, gy);
  ctx.fillStyle = "#6f4826";
  ctx.rotate(0.5); ctx.fillRect(-14, -4, 28, 6);
  ctx.rotate(-1.0); ctx.fillRect(-14, -4, 28, 6);
  ctx.restore();
  // огонь
  const fl = Math.sin(t * 11 + b.gx) * 2;
  ctx.fillStyle = "rgba(255,122,42,0.85)";
  ctx.beginPath(); ctx.ellipse(gx, gy - 16 + fl * 0.4, 11, 17 + fl, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(255,176,58,0.9)";
  ctx.beginPath(); ctx.ellipse(gx, gy - 12 + fl * 0.3, 7, 11 + fl * 0.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath(); ctx.ellipse(gx, gy - 9, 3.6, 6 + fl * 0.5, 0, 0, 7); ctx.fill();
  // дым
  if (Math.random() < 0.09) {
    parts.push({ x: gx + (Math.random() - 0.5) * 6, y: gy - 30, vx: (Math.random() - 0.5) * 12, vy: -26 - Math.random() * 14, g: -14, life: 1, decay: 0.55, size: 3 + Math.random() * 3, color: "rgba(150,150,160,0.4)" });
  }
}

function drawArmArm(sx, sy, ang, len) {
  const hx = sx + Math.sin(ang) * len, hy = sy + Math.cos(ang) * len;
  ctx.strokeStyle = "#2f5a8a"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = "#f0c090";
  ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, 7); ctx.fill();
  return { hx, hy };
}

function drawTool(hx, hy, ang, tool) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang + 0.85);
  if (tool === "axe") {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(-2, -4, 5, 26);
    ctx.fillStyle = "#b8c2cf";
    ctx.beginPath(); ctx.moveTo(3, -4); ctx.lineTo(15, -1); ctx.lineTo(13, 8); ctx.lineTo(3, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#8f99a8";
    ctx.fillRect(3, -1, 3, 6);
  } else if (tool === "pick") {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(-2, -4, 5, 26);
    ctx.strokeStyle = "#9aa3b2"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(2, 2, 13, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
  } else if (tool === "hammer") {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(-2, -4, 5, 22);
    ctx.fillStyle = "#8f99a8"; ctx.fillRect(-7, -10, 16, 9);
  }
  ctx.restore();
}

function swingArmAngle(k) {
  // 0..1 -> угол руки: замах -> удар -> возврат
  if (k < 0.3) return lerp(-0.5, -2.3, k / 0.3);
  if (k < 0.5) { const u = (k - 0.3) / 0.2; return lerp(-2.3, 0.7, u * u * u); }
  const u = (k - 0.5) / 0.5;
  return lerp(0.7, -0.5, smooth(u));
}

function drawCharacter(t) {
  const x = w2sx(c.x), y = w2sy(c.y);
  const sf = clamp(Math.abs(c.vx) / MAX_V, 0, 1);
  const air = !c.onGround;
  // тень на земле
  const gy = heightAt(c.x);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(x, w2sy(gy) - 2, 18 * clamp(1 - (gy - c.y) / 300, 0.3, 1), 5, 0, 0, 7);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(c.face, 1);

  const ph = c.ph, legA = Math.sin(ph) * 0.65 * sf;
  const breathe = 1 + (sf < 0.05 && !c.action ? Math.sin(t * 2.2) * 0.02 : 0);

  // задняя нога
  ctx.save();
  ctx.translate(-2, -26); ctx.rotate(air ? -0.5 : -legA);
  ctx.strokeStyle = "#33507c"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.stroke();
  ctx.fillStyle = "#4a3625"; ctx.fillRect(-5, 20, 12, 6);
  ctx.restore();
  // задняя рука
  const backA = air ? -1.4 : -Math.sin(ph) * 0.45 * sf - 0.08;
  drawArmArm(-3, -46, backA, 19);

  // торс + рюкзак
  ctx.save();
  ctx.scale(1, breathe);
  ctx.fillStyle = "#3b6ea5";
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-9, -52, 19, 28, 5) : ctx.rect(-9, -52, 19, 28);
  ctx.fill();
  ctx.fillStyle = "#2b527c";
  ctx.fillRect(-9, -30, 19, 5); // ремень
  ctx.fillStyle = "#7a5230";
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-17, -48, 9, 20, 3) : ctx.rect(-17, -48, 9, 20);
  ctx.fill();
  ctx.restore();

  // передняя нога
  ctx.save();
  ctx.translate(3, -26); ctx.rotate(air ? 0.45 : legA);
  ctx.strokeStyle = "#3b6ea5"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 24); ctx.stroke();
  ctx.fillStyle = "#5d4430"; ctx.fillRect(-5, 20, 13, 6);
  ctx.restore();

  // голова
  const bob = Math.sin(ph * 2) * 1.2 * sf;
  ctx.save();
  ctx.translate(2, -52 + bob);
  ctx.fillStyle = "#f0c090";
  ctx.beginPath(); ctx.arc(0, -9, 11, 0, 7); ctx.fill();
  // кепка
  ctx.fillStyle = "#e07b39";
  ctx.beginPath(); ctx.arc(0, -12, 11, Math.PI, 0); ctx.fill();
  ctx.fillRect(0, -14, 14, 4);
  // глаз
  ctx.fillStyle = "#22283a";
  ctx.beginPath(); ctx.arc(5.5, -9, 1.9, 0, 7); ctx.fill();
  ctx.restore();

  // передняя рука + инструмент
  let armA = air ? -1.8 : Math.sin(ph) * 0.45 * sf + 0.08;
  let tool = "axe";
  const a = c.action;
  if (a && (a.type === "swing" || a.type === "build")) {
    armA = swingArmAngle(clamp(a.t / a.dur, 0, 1));
    tool = a.tool || "axe";
    // лёгкий наклон корпуса в ударе
    ctx.rotate(clamp((armA + 2.3) * 0.06, 0, 0.16));
  }
  const hand = drawArmArm(3, -46, armA, 20);
  drawTool(hand.hx, hand.hy, armA, tool);

  ctx.restore();
}

function drawGhost() {
  if (sel === 0) return;
  const w = mouseWorld();
  const gx = Math.floor(w.x / GRID), gy = Math.floor(w.y / GRID);
  const x = gx * GRID, y = gy * GRID;
  const err = placeCheck(gx, gy);
  const slot = SLOTS[sel];
  const poor = inv.wood < slot.wood || inv.stone < slot.stone;
  const ok = !err && !poor;
  ctx.fillStyle = ok ? "rgba(120,220,140,0.25)" : "rgba(230,90,90,0.22)";
  ctx.strokeStyle = ok ? "rgba(140,240,160,0.9)" : "rgba(240,110,110,0.9)";
  ctx.lineWidth = 2;
  ctx.fillRect(x - camX, y - camY, GRID, GRID);
  ctx.strokeRect(x - camX, y - camY, GRID, GRID);
  // иконка внутри
  ctx.font = "16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(slot.icon, x - camX + GRID / 2, y - camY + 22);
}

function drawDarkness(t) {
  const nf = nightFactor();
  if (nf < 0.02) return;
  dkx.clearRect(0, 0, VW, VH);
  dkx.fillStyle = `rgba(6,9,26,${0.82 * nf})`;
  dkx.fillRect(0, 0, VW, VH);
  dkx.globalCompositeOperation = "destination-out";
  function punch(wx, wy, r, str) {
    const x = w2sx(wx), y = w2sy(wy);
    if (x < -r || x > VW + r) return;
    const g = dkx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${str})`);
    g.addColorStop(0.6, `rgba(0,0,0,${str * 0.55})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    dkx.fillStyle = g;
    dkx.beginPath(); dkx.arc(x, y, r, 0, 7); dkx.fill();
  }
  for (const b of blocks) {
    if (b.t !== "fire") continue;
    punch(b.gx * GRID + 16, b.gy * GRID + 6, 250 + Math.sin(t * 9 + b.gx) * 14, 0.96);
  }
  punch(c.x, c.y - 28, 130, 0.8);
  dkx.globalCompositeOperation = "source-over";
  ctx.drawImage(dk, 0, 0, VW, VH);
  // тёплое свечение костров
  for (const b of blocks) {
    if (b.t !== "fire") continue;
    const x = w2sx(b.gx * GRID + 16), y = w2sy(b.gy * GRID + 6);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 90);
    g.addColorStop(0, `rgba(255,160,60,${0.22 * nf})`);
    g.addColorStop(1, "rgba(255,160,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 90, 0, 7); ctx.fill();
  }
}

function drawTargetHighlight(t) {
  if (sel !== 0 || c.action) return;
  const n = findTarget();
  if (!n) return;
  const x = w2sx(n.x), y = w2sy(n.type === "tree" ? n.baseY - 55 : n.baseY - 18);
  ctx.strokeStyle = `rgba(255,255,255,${0.45 + 0.3 * Math.sin(t * 5)})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, n.type === "tree" ? 42 : 30, 0, 7); ctx.stroke();
}

function drawParticles() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(w2sx(p.x) - p.size / 2, w2sy(p.y) - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
function drawFloaters() {
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life * 1.4, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(f.txt, w2sx(f.x) + 1, w2sy(f.y) + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, w2sx(f.x), w2sy(f.y));
  }
  ctx.globalAlpha = 1;
}

/* ---------------- СВЕТЛЯЧКИ (ночью) ---------------- */
const flies = [];
for (let i = 0; i < 10; i++) flies.push({ x: hash(i * 3) * W_WORLD, y: 0, ph: hash(i * 9) * 7, sp: 12 + hash(i * 5) * 20 });
function drawFlies(t, dt) {
  const nf = nightFactor();
  if (nf < 0.05) return;
  for (const f of flies) {
    f.x += Math.sin(t * 0.4 + f.ph) * f.sp * dt;
    const gy = heightAt(f.x);
    f.y = gy - 40 - Math.sin(t * 1.3 + f.ph) * 26;
    const x = w2sx(f.x), y = w2sy(f.y);
    if (x < -20 || x > VW + 20) continue;
    const a = nf * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.2 + f.ph * 3)));
    ctx.fillStyle = `rgba(190,255,120,${a})`;
    ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
  }
}

/* ---------------- ЦИКЛ ---------------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  const t = elapsed;

  // время суток
  const prevDayT = dayT;
  dayT += dt / DAY_LEN;
  if (dayT >= 1) {
    dayT -= 1; dayN++;
    toast("🌅 Наступил день " + dayN);
    if (blocks.some(b => b.t === "fire") && !ms.night) {
      ms.night = true; toast("🌙 Первая ночь пережита! База жива", 3500); sfx("win");
    }
    save();
  }

  updateCharacter(dt);
  updateNodes(dt);
  updateParticles(dt);

  // камера
  const tx = clamp(c.x + c.face * 40 - VW / 2, 0, Math.max(W_WORLD - VW, 0));
  const ty = clamp(c.y - VH * 0.62, -900, Math.max(GROUND + 150 - VH, -900));
  const ck = 1 - Math.exp(-6 * dt);
  camX = lerp(camX, tx, ck);
  camY = lerp(camY, ty, ck);

  // ---- отрисовка ----
  drawSky(t);
  drawMountains();
  drawTerrain();
  drawTargetHighlight(t);
  for (const n of nodes) {
    if (w2sx(n.x) < -160 || w2sx(n.x) > VW + 160) continue;
    if (n.type === "tree") drawTree(n, t); else drawRock(n);
  }
  for (const b of blocks) {
    const x = w2sx(b.gx * GRID);
    if (x < -60 || x > VW + 60) continue;
    drawBlock(b, t);
  }
  drawGhost();
  drawCharacter(t);
  drawParticles();
  drawFlies(t, dt);
  drawDarkness(t);
  drawFloaters();

  updateHUD();
}

/* ---------------- СТАРТ ---------------- */
genWorld();
const loaded = load();
if (!loaded) {
  toast("Добро пожаловать, колонист! 🪓 Руби деревья ЛКМ, строй базу слотами 2–5", 5200);
} else {
  toast("Игра загружена. Продолжай строить базу!", 3000);
}
camX = clamp(c.x - VW / 2, 0, W_WORLD - VW);
camY = clamp(c.y - VH * 0.62, -900, Math.max(GROUND + 150 - VH, -900));
refreshHotbar();
updateHUD();
requestAnimationFrame(frame);
