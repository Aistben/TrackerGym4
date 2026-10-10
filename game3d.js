/* ============================================================
   ПЕРВОБЫТНЫЙ ВЫЖИВАЧ 2.5D — 2D-карта (вид сверху), 3D-ассеты
   Тот же автономный ИИ, что и в классической версии, но все
   объекты — настоящие 3D-модели (Three.js), свет и тени динамические.
   ============================================================ */
"use strict";
import * as THREE from "three";

/* Хук для headless-тестов: пропускаем только WebGL-рендерер */
const NO_RENDER = typeof window !== "undefined" && window.__NO_RENDER__ === true;

/* ---------------- МИР / БАЛАНС (как в классике) ---------------- */
const W = 2600, H = 1900;
const BASE = { x: W / 2, y: H / 2 };
const DAY_LEN = 130;
const NIGHT_AT = 0.62;
const HOME_R = 92;

const human = {
  x: BASE.x + 120, y: BASE.y + 40,
  dir: 0, ph: 0, speed: 132,
  hp: 100, maxHp: 100,
  atkCd: 0, attackT: 1, attackResolved: true, swingActive: false,
  eatT: 0,
  carry: { wood: 0, stone: 0, food: 0 },
  kills: 0,
  task: null, moveGoal: null,
  combat: false,
};
const lv = { house: 1, weapon: 1, bag: 1 };
let prio = "house";
const inv = { wood: 0, stone: 0, food: 0 };
const house = { hp: 120, maxHp: 120 };
const HOUSE_HP = l => 120 + 90 * (l - 1);
const HOUSE_NAMES = ["Костёр и шалаш", "Хижина", "Дом с частоколом", "Дом с каменной оградой", "Цитадель"];
const WEAPON_NAMES = ["Дубина", "Каменный топор", "Копьё", "Булава", "Великий топор"];
const houseCost = l => ({ wood: 12 + l * 10, stone: l >= 2 ? 8 * l : 0 });
const weaponCost = l => ({ wood: 8 + l * 6, stone: 4 + l * 6 });
const bagCost = l => ({ wood: 10 + l * 5, stone: 4 + l * 3 });
const weaponDmg = () => 12 + (lv.weapon - 1) * 9;
const bagCap = () => 10 + (lv.bag - 1) * 6;
const carryTotal = () => human.carry.wood + human.carry.stone + human.carry.food;
const MAX_LV = 5;

/* ---------------- УТИЛИТЫ ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const smooth = t => t * t * (3 - 2 * t);
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ---------------- ЗВУК ---------------- */
let AC = null, master = null, muted = false, noiseBuf = null;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.5;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.25, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { /* без звука */ }
}
window.addEventListener("pointerdown", initAudio);
window.addEventListener("keydown", initAudio);
function tone(f1, f2, dur, type, vol, delay = 0) {
  if (!AC || muted) return;
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f1, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseSfx(dur, freq, vol, delay = 0) {
  if (!AC || muted) return;
  const t0 = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t0); s.stop(t0 + dur + 0.03);
}
const sfx = {
  chop() { noiseSfx(0.09, 700, 0.5); tone(120, 70, 0.09, "triangle", 0.3); },
  mine() { tone(900, 250, 0.06, "square", 0.13); noiseSfx(0.05, 2600, 0.28); },
  pick() { tone(500, 700, 0.07, "sine", 0.25); },
  hit() { noiseSfx(0.07, 900, 0.42); tone(160, 80, 0.08, "triangle", 0.35); },
  zdie() { tone(220, 55, 0.35, "sawtooth", 0.28); },
  growl() { tone(90, 60, 0.5, "sawtooth", 0.2); },
  hammer() { noiseSfx(0.05, 1200, 0.3); tone(220, 160, 0.06, "square", 0.18); },
  upgrade() { [440, 554, 659, 880].forEach((f, i) => tone(f, f, 0.14, "triangle", 0.26, i * 0.09)); },
  eat() { tone(300, 420, 0.08, "sine", 0.22); tone(280, 380, 0.08, "sine", 0.2, 0.1); },
  hurt() { tone(200, 90, 0.16, "sawtooth", 0.3); },
  horn() { tone(180, 140, 0.7, "sawtooth", 0.3); tone(120, 95, 0.9, "sawtooth", 0.24, 0.12); },
  dawn() { [523, 659, 784].forEach((f, i) => tone(f, f, 0.18, "sine", 0.22, i * 0.12)); },
  lose() { [330, 262, 208, 156].forEach((f, i) => tone(f, f * 0.94, 0.3, "sawtooth", 0.26, i * 0.22)); },
};

/* ---------------- МИР: РЕСУРСЫ ---------------- */
const nodes = [];
let nid = 0;
function addNode(type, x, y) {
  nodes.push({
    id: nid++, type, x, y,
    hp: type === "tree" ? 3 : type === "rock" ? 4 : 1,
    maxHp: type === "tree" ? 3 : type === "rock" ? 4 : 1,
    seed: hash(x * 0.37 + y * 0.11), scale: 0.85 + hash(x + y * 2.7) * 0.4,
    shake: 0, flash: 0, dead: false, respawn: 0, grow: 10,
    fallT: -1, fallDir: 0, view: null,
  });
}
function genWorld() {
  const tryAdd = (type, minBase) => {
    for (let t = 0; t < 24; t++) {
      const x = 90 + hash(type.length * 7 + t * 13.3 + nid) * (W - 180);
      const y = 90 + hash(type.length * 3 + t * 7.7 + nid * 1.7) * (H - 180);
      const db = dist(x, y, BASE.x, BASE.y);
      if (db < minBase || (db > 700 && nodes.length < 8)) continue;
      let ok = true;
      for (const n of nodes) if (dist(x, y, n.x, n.y) < 78) { ok = false; break; }
      if (ok) { addNode(type, x, y); return; }
    }
  };
  addNode("tree", BASE.x - 210, BASE.y - 60);
  addNode("tree", BASE.x + 190, BASE.y - 140);
  addNode("tree", BASE.x - 90, BASE.y + 230);
  addNode("rock", BASE.x + 240, BASE.y + 170);
  addNode("rock", BASE.x - 280, BASE.y + 120);
  addNode("bush", BASE.x + 120, BASE.y - 260);
  for (let i = 0; i < 46; i++) tryAdd("tree", 170);
  for (let i = 0; i < 26; i++) tryAdd("rock", 190);
  for (let i = 0; i < 15; i++) tryAdd("bush", 150);
}

/* ---------------- ЭФФЕКТЫ ---------------- */
const zombies = [];
const parts = [];
const texts = [];
const stains = [];
function spawnParts(x, y, n, color, opt = {}) {
  for (let i = 0; i < n; i++) {
    const a = opt.dir !== undefined ? opt.dir + (Math.random() - 0.5) * (opt.spread || 1.6) : Math.random() * Math.PI * 2;
    const sp = (opt.sp || 110) * (0.4 + Math.random() * 0.9);
    parts.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, decay: opt.decay || 1.7,
      size: 2 + Math.random() * 3, color,
    });
  }
}
function floatText(x, y, txt, color, big) {
  texts.push({ x, y, txt, color, life: 1, big: !!big });
}
function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.5 * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const f = texts[i];
    f.y -= 30 * dt; f.life -= 0.85 * dt;
    if (f.life <= 0) texts.splice(i, 1);
  }
  for (let i = stains.length - 1; i >= 0; i--) {
    stains[i].life -= dt / 10;
    if (stains[i].life <= 0) stains.splice(i, 1);
  }
}

/* ---------------- ДОБЫЧА ---------------- */
function yieldOf(type) {
  if (type === "tree") return { wood: 3 };
  if (type === "rock") return { stone: 3 };
  return { food: 2 };
}
function giveYield(type) {
  const y = yieldOf(type);
  for (const k in y) {
    const space = bagCap() - carryTotal();
    const amt = Math.min(y[k], Math.max(space, 0));
    human.carry[k] += amt;
    if (amt < y[k]) floatText(human.x, human.y - 30, "Сумка полна!", "#ffb56b");
  }
  const col = type === "tree" ? "#e8c68a" : type === "rock" ? "#d7deeb" : "#ff9e9e";
  const ic = type === "tree" ? "🪵" : type === "rock" ? "🪨" : "🍒";
  floatText(human.x, human.y - 34, "+" + Object.values(yieldOf(type))[0] + " " + ic, col);
  refreshHUD();
}
function nodeRespawnTime(type) { return type === "tree" ? 42 : type === "rock" ? 60 : 30; }
function applyNodeHit(n) {
  n.hp--; n.shake = 1; n.flash = 1;
  giveYield(n.type);
  if (n.type === "tree") { spawnParts(n.x, n.y, 7, "#a3703f", { sp: 130 }); sfx.chop(); }
  else if (n.type === "rock") { spawnParts(n.x, n.y, 7, "#9aa3b2", { sp: 140 }); sfx.mine(); }
  else { spawnParts(n.x, n.y, 6, "#e0524d", { sp: 90 }); sfx.pick(); }
  if (n.hp <= 0) {
    n.dead = true; n.respawn = 0;
    n.fallT = 0;
    n.fallDir = hash(n.id * 7.7) * Math.PI * 2;
    if (n.type === "tree") spawnParts(n.x, n.y, 14, "#7a4f2a", { sp: 150 });
    if (n.type === "rock") spawnParts(n.x, n.y, 16, "#8b93a3", { sp: 170 });
  }
}

/* ---------------- ДОМ / УЛУЧШЕНИЯ ---------------- */
function canAfford(c) { return inv.wood >= c.wood && inv.stone >= c.stone; }
function payCost(c) { inv.wood -= c.wood; inv.stone -= c.stone; refreshHUD(); }
function nextUpgrade() {
  const order = [prio, ...["house", "weapon", "bag"].filter(k => k !== prio)];
  for (const k of order) {
    if (lv[k] >= MAX_LV) continue;
    const cost = k === "house" ? houseCost(lv.house) : k === "weapon" ? weaponCost(lv.weapon) : bagCost(lv.bag);
    if (canAfford(cost)) return { kind: k, cost };
  }
  return null;
}
function applyUpgrade(kind) {
  lv[kind]++;
  if (kind === "house") { house.maxHp = HOUSE_HP(lv.house); house.hp = house.maxHp; }
  sfx.upgrade();
  const nm = kind === "house" ? HOUSE_NAMES[lv.house - 1] : kind === "weapon" ? WEAPON_NAMES[lv.weapon - 1] : "Большая сумка";
  floatText(BASE.x, BASE.y - 90, "⬆ " + nm, "#ffd76e", true);
  toast("⬆ Улучшение: " + nm + " (ур. " + lv[kind] + ")");
  spawnParts(BASE.x, BASE.y, 22, "#ffd76e", { sp: 170 });
  if (kind === "house") rebuildHouseView();
  if (kind === "weapon") rebuildWeapon();
  refreshHUD();
}

/* ---------------- ЗОМБИ ---------------- */
let wave = 0;
let toSpawn = 0, spawnCd = 0;
let growlCd = 3;
const waveCount = n => 2 + n * 2;
const waveHp = n => 24 + n * 9;
const waveSpd = n => Math.min(42 + n * 2.4, 96);
const waveDmg = n => 5 + n;

function spawnZombie() {
  const a = Math.random() * Math.PI * 2;
  const r = Math.hypot(W, H) / 2 + 60;
  const hue = 95 + Math.random() * 30;
  zombies.push({
    x: clamp(BASE.x + Math.cos(a) * r, -40, W + 40),
    y: clamp(BASE.y + Math.sin(a) * r, -40, H + 40),
    dir: 0, ph: Math.random() * 7,
    hp: waveHp(wave), maxHp: waveHp(wave),
    spd: waveSpd(wave) * (0.9 + Math.random() * 0.25),
    dmg: waveDmg(wave),
    atkCd: 0, flash: 0, lurch: Math.random() * 7, attackT: 1, dead: false,
    g1: new THREE.Color(`hsl(${hue}, 38%, ${34 + Math.random() * 10}%)`),
    g2: new THREE.Color(`hsl(${hue}, 32%, ${24 + Math.random() * 8}%)`),
  });
}
function zombieHitHuman(z) {
  human.hp -= z.dmg;
  sfx.hurt();
  hurtFlash = 1;
  spawnParts(human.x, human.y, 8, "#c0392b", { sp: 130 });
  floatText(human.x, human.y - 36, "-" + z.dmg, "#ff7b6e");
  if (human.hp <= 0) gameOver("Человек пал в бою…");
}
function zombieHitHouse(z) {
  house.hp -= z.dmg;
  sfx.hit();
  houseShake = 1;
  spawnParts(z.x, z.y, 6, "#a3703f", { sp: 100 });
  if (house.hp <= 0) { house.hp = 0; gameOver("Дом разрушен — база пала…"); }
}

/* ---------------- БОЙ ---------------- */
function humanAttack() {
  human.attackT = 0;
  human.atkCd = 0.55;
  human.attackResolved = false;
  human.swingActive = true;
}
function resolveAttack() {
  const range = lv.weapon >= 3 ? 56 : 48;
  const arc = 1.25;
  let hitAny = false;
  for (const z of zombies) {
    if (z.dead) continue;
    const d = dist(human.x, human.y, z.x, z.y);
    if (d > range + 12) continue;
    const a = Math.atan2(z.y - human.y, z.x - human.x);
    if (Math.abs(angleDiff(human.dir, a)) > arc) continue;
    const dmg = weaponDmg();
    z.hp -= dmg; z.flash = 1;
    z.x += Math.cos(a) * 14; z.y += Math.sin(a) * 14;
    spawnParts(z.x, z.y, 7, "#5d8a3a", { dir: a, spread: 1, sp: 150 });
    floatText(z.x, z.y - 24, "-" + dmg, "#ffe08a");
    sfx.hit();
    hitAny = true;
    if (z.hp <= 0) killZombie(z);
  }
  if (!hitAny && human.task && human.task.type === "gather" && !human.task.node.dead) {
    const n = human.task.node;
    const d = dist(human.x, human.y, n.x, n.y);
    if (d < 64) {
      const a = Math.atan2(n.y - human.y, n.x - human.x);
      if (Math.abs(angleDiff(human.dir, a)) < 1.15) applyNodeHit(n);
    }
  }
}
function killZombie(z) {
  z.dead = true;
  human.kills++;
  human.maxHp = Math.min(100 + human.kills * 2, 170);
  spawnParts(z.x, z.y, 14, "#4e7a3a", { sp: 160 });
  spawnParts(z.x, z.y, 8, "#7a1f1f", { sp: 130 });
  stains.push({ x: z.x, y: z.y, r: 15, life: 1 });
  sfx.zdie();
}

/* ---------------- ИИ ЧЕЛОВЕКА (как в классике) ---------------- */
function nearestZombie(x, y, r) {
  let best = null, bd = r;
  for (const z of zombies) {
    if (z.dead) continue;
    const d = dist(x, y, z.x, z.y);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
function nearestNode(type, x, y) {
  let best = null, bd = 1e9;
  for (const n of nodes) {
    if (n.dead || n.type !== type) continue;
    const d = dist(x, y, n.x, n.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function needType() {
  const ups = [prio, ...["house", "weapon", "bag"].filter(k => k !== prio)];
  for (const k of ups) {
    if (lv[k] >= MAX_LV) continue;
    const c = k === "house" ? houseCost(lv.house) : k === "weapon" ? weaponCost(lv.weapon) : bagCost(lv.bag);
    if (inv.wood < c.wood) return "wood";
    if (inv.stone < c.stone) return "stone";
  }
  if (human.hp < 80 && inv.food < 3) return "food";
  return (dayN % 2 === 0) ? "wood" : "stone";
}
function needTypeSafe(task) {
  return task.node.type === "tree" ? "wood" : task.node.type === "rock" ? "stone" : "food";
}
function moveToward(tx, ty, dt, spdMul = 1) {
  const d = dist(human.x, human.y, tx, ty);
  if (d < 3) return true;
  const sp = human.speed * spdMul;
  human.x = clamp(human.x + (tx - human.x) / d * sp * dt, 26, W - 26);
  human.y = clamp(human.y + (ty - human.y) / d * sp * dt, 26, H - 26);
  const ta = Math.atan2(ty - human.y, tx - human.x);
  human.dir += angleDiff(human.dir, ta) * Math.min(1, 10 * dt);
  human.ph += sp * dt * 0.075;
  return false;
}
function faceToward(tx, ty, dt) {
  const ta = Math.atan2(ty - human.y, tx - human.x);
  human.dir += angleDiff(human.dir, ta) * Math.min(1, 12 * dt);
}

function updateHuman(dt, isNight, nf) {
  human.atkCd -= dt;
  human.attackT = Math.min(human.attackT + dt / 0.38, 1);
  if (human.attackT >= 1) human.swingActive = false;
  if (human.eatT > 0) human.eatT -= dt;

  if (human.swingActive && !human.attackResolved && human.attackT >= 0.42) {
    human.attackResolved = true;
    resolveAttack();
  }

  const zNear = nearestZombie(human.x, human.y, isNight ? 190 : 150);
  human.combat = false;

  if (zNear) {
    human.combat = true;
    human.task = null;
    const d = dist(human.x, human.y, zNear.x, zNear.y);
    const range = lv.weapon >= 3 ? 50 : 42;
    if (d > range) moveToward(zNear.x, zNear.y, dt);
    else {
      faceToward(zNear.x, zNear.y, dt);
      if (human.atkCd <= 0 && human.attackT >= 1) humanAttack();
    }
    if (human.hp < human.maxHp * 0.3 && isNight) {
      const a = Math.atan2(human.y - BASE.y, human.x - BASE.x);
      moveToward(BASE.x + Math.cos(a) * 40, BASE.y + Math.sin(a) * 40, dt, 0.9);
    }
    return;
  }

  if (human.moveGoal) {
    human.moveGoal.ttl -= dt;
    const arrived = moveToward(human.moveGoal.x, human.moveGoal.y, dt);
    if (arrived || human.moveGoal.ttl <= 0) human.moveGoal = null;
    return;
  }

  if (human.hp < human.maxHp * 0.55 && human.carry.food > 0 && human.eatT <= 0) {
    human.eatT = 0.7;
    human.carry.food--;
    human.hp = Math.min(human.maxHp, human.hp + 30);
    floatText(human.x, human.y - 36, "+30 ❤️", "#8fe08f");
    sfx.eat();
    refreshHUD();
    return;
  }
  if (human.hp < human.maxHp * 0.55 && human.carry.food <= 0 && inv.food > 0 &&
      dist(human.x, human.y, BASE.x, BASE.y) < HOME_R) {
    inv.food--; human.hp = Math.min(human.maxHp, human.hp + 30);
    floatText(human.x, human.y - 36, "+30 ❤️", "#8fe08f");
    sfx.eat();
    refreshHUD();
    return;
  }

  if (isNight) {
    const dHome = dist(human.x, human.y, BASE.x, BASE.y);
    if (dHome > HOME_R * 0.8) moveToward(BASE.x, BASE.y + 46, dt);
    return;
  }

  const cTotal = carryTotal();
  const cap = bagCap();
  const atHome = dist(human.x, human.y, BASE.x, BASE.y) < HOME_R * 0.9;

  if (cTotal > 0 && (cTotal >= cap || !human.task || human.task.type === "home")) {
    if (!atHome) { moveToward(BASE.x, BASE.y + 40, dt); return; }
    if (cTotal > 0) {
      inv.wood += human.carry.wood; inv.stone += human.carry.stone; inv.food += human.carry.food;
      if (cTotal >= cap) floatText(BASE.x, BASE.y - 70, "Добыча сдана", "#c9e8a0");
      human.carry = { wood: 0, stone: 0, food: 0 };
      refreshHUD();
    }
  }

  if (atHome && house.hp < house.maxHp && inv.wood > 0) {
    human.buildKind = "repair";
    human.hammerT = (human.hammerT || 0) + dt;
    human.attackT = clamp(human.hammerT / 0.45, 0, 1) * 0.9;
    faceToward(BASE.x, BASE.y - 30, dt);
    if (human.hammerT >= 0.45) {
      human.hammerT = 0;
      sfx.hammer();
      house.hp = Math.min(house.maxHp, house.hp + 10);
      inv.wood = Math.max(0, inv.wood - 1);
      spawnParts(BASE.x + (Math.random() - 0.5) * 60, BASE.y + (Math.random() - 0.5) * 40, 4, "#c9a06a", { sp: 80 });
      refreshHUD();
    }
    return;
  }
  if (human.buildKind === "repair") human.buildKind = null;

  if (atHome && !human.buildKind) {
    const up = nextUpgrade();
    if (up) {
      payCost(up.cost);
      human.buildKind = up.kind;
      human.buildTotal = 2.2; human.buildT = 0;
      human.hammerT = 0;
    }
  }
  if (human.buildKind && human.buildKind !== "repair") {
    human.buildT += dt;
    human.hammerT = (human.hammerT || 0) + dt;
    human.attackT = clamp((human.hammerT % 0.45) / 0.45, 0, 1) * 0.9;
    faceToward(BASE.x, BASE.y - 30, dt);
    if (human.hammerT >= 0.45) {
      human.hammerT = 0;
      sfx.hammer();
      spawnParts(BASE.x + (Math.random() - 0.5) * 70, BASE.y + (Math.random() - 0.5) * 50, 5, "#c9a06a", { sp: 90 });
    }
    if (human.buildT >= human.buildTotal) {
      applyUpgrade(human.buildKind);
      human.buildKind = null;
    }
    return;
  }

  const want = needType();
  if (human.task && (human.task.node.dead || needTypeSafe(human.task) !== want)) human.task = null;
  if (!human.task) {
    const tmap = { wood: "tree", stone: "rock", food: "bush" };
    const n = nearestNode(tmap[want], human.x, human.y) ||
              nearestNode("tree", human.x, human.y) ||
              nearestNode("rock", human.x, human.y) ||
              nearestNode("bush", human.x, human.y);
    if (n) human.task = { type: "gather", node: n };
    else { moveToward(BASE.x + 60, BASE.y + 60, dt); return; }
  }
  const n = human.task.node;
  const d = dist(human.x, human.y, n.x, n.y);
  if (d > 40) { moveToward(n.x, n.y, dt); return; }
  faceToward(n.x, n.y, dt);
  if (human.atkCd <= 0 && human.attackT >= 1) {
    humanAttack(); human.atkCd = 0.5;
  }
}

/* ---------------- ИИ ЗОМБИ ---------------- */
function updateZombies(dt, isNight, nf) {
  if (toSpawn > 0) {
    spawnCd -= dt;
    if (spawnCd <= 0) { spawnZombie(); toSpawn--; spawnCd = 0.85; }
  }
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (z.dead) { zombies.splice(i, 1); continue; }
    z.flash *= Math.exp(-8 * dt);
    z.atkCd -= dt;
    z.lurch += dt;

    if (!isNight && nf < 0.5) {
      z.hp -= 34 * dt;
      if (Math.random() < 0.3) spawnParts(z.x, z.y, 1, "#ff9e5c", { sp: 40 });
      if (z.hp <= 0) { killZombie(z); continue; }
    }

    const dH = dist(z.x, z.y, human.x, human.y);
    const dB = dist(z.x, z.y, BASE.x, BASE.y);
    let tx, ty, targetHuman;
    if (dH < 260 || dH < dB) { tx = human.x; ty = human.y; targetHuman = true; }
    else { tx = BASE.x; ty = BASE.y; targetHuman = false; }

    const d = dist(z.x, z.y, tx, ty);
    const reach = targetHuman ? 30 : 44;
    if (d > reach) {
      const wob = Math.sin(z.lurch * 3.1) * 0.35;
      const a = Math.atan2(ty - z.y, tx - z.x) + wob;
      const sp = z.spd * (0.75 + 0.25 * Math.abs(Math.sin(z.lurch * 2.4)));
      z.x += Math.cos(a) * sp * dt;
      z.y += Math.sin(a) * sp * dt;
      z.dir += angleDiff(z.dir, a) * Math.min(1, 6 * dt);
      z.ph += sp * dt * 0.07;
    } else if (z.atkCd <= 0) {
      z.atkCd = 0.95;
      z.attackT = 0;
      if (targetHuman) zombieHitHuman(z); else zombieHitHouse(z);
    }
    z.attackT = Math.min((z.attackT || 1) + dt / 0.3, 1);

    for (let j = i + 1; j < zombies.length; j++) {
      const o = zombies[j];
      if (o.dead) continue;
      const dd = dist(z.x, z.y, o.x, o.y);
      if (dd < 24 && dd > 0.01) {
        const push = (24 - dd) / 2;
        const a = Math.atan2(o.y - z.y, o.x - z.x);
        z.x -= Math.cos(a) * push * dt * 8; z.y -= Math.sin(a) * push * dt * 8;
        o.x += Math.cos(a) * push * dt * 8; o.y += Math.sin(a) * push * dt * 8;
      }
    }
  }
  if (zombies.length > 0) {
    growlCd -= dt;
    if (growlCd <= 0) { sfx.growl(); growlCd = 2.5 + Math.random() * 4; }
  }
}

/* ============================ THREE.JS СЦЕНА ============================ */
const cv = document.getElementById("cv");
let renderer = null;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 4000);
let zoom = 1;
const VIEW_HALF = 400;              // половина высоты обзора в мировых юнитах
const CAM_TILT = 1.05;              // угол наклона камеры (рад от горизонта)

const ov = document.getElementById("ov");
const octx = ov.getContext("2d");
const mini = document.getElementById("mini");
const mx = mini.getContext("2d");

let VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  ov.width = VW * DPR; ov.height = VH * DPR;
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (renderer) renderer.setSize(VW, VH);
  updateProjection();
}
function updateProjection() {
  const aspect = VW / VH;
  const halfH = VIEW_HALF / zoom, halfW = halfH * aspect;
  camera.left = -halfW; camera.right = halfW;
  camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

/* ---- освещение ---- */
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a5a2e, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.castShadow = !NO_RENDER;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -560; sun.shadow.camera.right = 560;
sun.shadow.camera.top = 560; sun.shadow.camera.bottom = -560;
sun.shadow.camera.near = 50; sun.shadow.camera.far = 2600;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);
const fireLight = new THREE.PointLight(0xff9a40, 0.6, 520, 2);
fireLight.position.set(BASE.x + 26, 26, BASE.y + 26);
scene.add(fireLight);
const heroLight = new THREE.PointLight(0xffd9a0, 0.2, 210, 2);
scene.add(heroLight);

/* ---- земля (canvas-текстура) ---- */
function makeGroundTexture() {
  const S = 2048;
  const g = document.createElement("canvas");
  g.width = S; g.height = S;
  const c = g.getContext("2d");
  c.fillStyle = "#4a7c3a";
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 520; i++) {
    const x = hash(i * 3.1) * S, y = hash(i * 7.7) * S;
    const r = 20 + hash(i * 13.3) * 70;
    const tone = hash(i * 1.7);
    c.fillStyle = tone > 0.6 ? "rgba(100,152,70,0.35)" : tone > 0.3 ? "rgba(62,105,46,0.4)" : "rgba(84,130,60,0.3)";
    c.beginPath();
    c.ellipse(x, y, r, r * 0.62, hash(i) * 3, 0, 7);
    c.fill();
  }
  // вытоптанный двор у базы
  const kx = S / W, ky = S / H;
  c.fillStyle = "rgba(125,95,56,0.55)";
  c.beginPath();
  c.ellipse(BASE.x * kx, BASE.y * ky, (HOME_R + 42) * kx, (HOME_R + 42) * ky, 0, 0, 7);
  c.fill();
  c.fillStyle = "rgba(140,108,64,0.5)";
  c.beginPath();
  c.ellipse(BASE.x * kx, BASE.y * ky, (HOME_R - 8) * kx, (HOME_R - 8) * ky, 0, 0, 7);
  c.fill();
  // тёмная кромка мира
  c.strokeStyle = "rgba(25,40,20,0.9)";
  c.lineWidth = 70;
  c.strokeRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(g);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(W, H),
  new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(W / 2, 0, H / 2);
ground.receiveShadow = !NO_RENDER;
scene.add(ground);

/* ---- звёзды ---- */
let stars = null;
{
  const count = 350;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = hash(i * 3.3) * W;
    pos[i * 3 + 1] = 420 + hash(i * 7.1) * 300;
    pos[i * 3 + 2] = hash(i * 5.7) * H;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 3.4, transparent: true, opacity: 0 }));
  scene.add(stars);
}

/* ---- общие геометрии ---- */
const geoSphere = new THREE.SphereGeometry(1, 12, 10);
const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const geoCone = new THREE.ConeGeometry(1, 1, 8);
const geoIco = new THREE.IcosahedronGeometry(1, 0);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...opts });
}
function mesh(geo, m, sx, sy, sz, x, y, z) {
  const me = new THREE.Mesh(geo, m);
  me.scale.set(sx, sy, sz);
  me.position.set(x, y, z);
  me.castShadow = !NO_RENDER;
  return me;
}

/* ---- ассеты: деревья / камни / кусты ---- */
const treeTrunkMat = mat(0x6b4526);
const treeLeafMats = [mat(0x2f6b33), mat(0x3f8b44), mat(0x4e9b4e)];
const rockMat = mat(0x8b93a3);
const rockDarkMat = mat(0x6e7686);
const bushMat = mat(0x35793a);
const berryMat = mat(0xe0524d, { emissive: 0x330000 });

function buildNodeView(n) {
  const g = new THREE.Group();
  g.position.set(n.x, 0, n.y);
  const s = n.scale;
  if (n.type === "tree") {
    const trunk = mesh(geoCyl, treeTrunkMat, 4.5 * s, 34 * s, 4.5 * s, 0, 17 * s, 0);
    g.add(trunk);
    const canopy = new THREE.Group();
    canopy.position.y = 34 * s;
    canopy.add(mesh(geoIco, treeLeafMats[0], 22 * s, 19 * s, 22 * s, 0, 12 * s, 0));
    canopy.add(mesh(geoIco, treeLeafMats[1], 15 * s, 13 * s, 15 * s, -10 * s, 4 * s, 6 * s));
    canopy.add(mesh(geoIco, treeLeafMats[2], 12 * s, 11 * s, 12 * s, 9 * s, 18 * s, -5 * s));
    g.add(canopy);
    g.userData.canopy = canopy;
    g.userData.trunk = trunk;
  } else if (n.type === "rock") {
    const r = mesh(geoIco, rockMat, 16 * s, 12 * s, 15 * s, 0, 8 * s, 0);
    r.rotation.set(hash(n.id) * 3, hash(n.id * 3) * 3, 0);
    g.add(r);
    g.add(mesh(geoIco, rockDarkMat, 8 * s, 6 * s, 8 * s, 9 * s, 4 * s, 6 * s));
    g.userData.rock = r;
  } else {
    const b = mesh(geoSphere, bushMat, 13 * s, 10 * s, 13 * s, 0, 7 * s, 0);
    g.add(b);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + n.seed * 6;
      g.add(mesh(geoSphere, berryMat, 1.8, 1.8, 1.8, Math.cos(a) * 8 * s, 8 * s, Math.sin(a) * 8 * s));
    }
    g.userData.bush = b;
  }
  // пнёк (после смерти)
  const stump = new THREE.Group();
  if (n.type === "tree") stump.add(mesh(geoCyl, treeTrunkMat, 7 * s, 8, 7 * s, 0, 4, 0));
  else if (n.type === "rock") stump.add(mesh(geoIco, rockMat, 7 * s, 4 * s, 6 * s, 0, 3, 0));
  else stump.add(mesh(geoSphere, bushMat, 4, 2.6, 4, 0, 2, 0));
  stump.visible = false;
  g.add(stump);
  g.userData.stump = stump;
  g.userData.body = new THREE.Group();
  for (const ch of [...g.children]) if (ch !== stump) g.userData.body.add(ch);
  g.add(g.userData.body);
  scene.add(g);
  return g;
}

/* ---- ассеты: дом (растёт с уровнями) ---- */
const woodMat = mat(0x8a5a30);
const woodDarkMat = mat(0x5f3c1e);
const stoneMat = mat(0x8b93a3);
const stoneDarkMat = mat(0x6e7686);
const roofMat = mat(0xa0522d);
const fireLogMat = mat(0x6f4826);
const flameMatA = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.92 });
const flameMatB = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
const goldMat = mat(0xffd76e, { emissive: 0x664400, emissiveIntensity: 0.6 });

let houseView = null;
function buildHouseInto(g, level) {
  // костёр всегда
  const fire = new THREE.Group();
  fire.position.set(26, 0, 26);
  for (let i = 0; i < 3; i++) {
    const log = mesh(geoCyl, fireLogMat, 2.2, 16, 2.2, 0, 2.2, 0);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * Math.PI / 3;
    fire.add(log);
  }
  const f1 = mesh(geoCone, flameMatA, 8, 16, 8, 0, 12, 0);
  const f2 = mesh(geoCone, flameMatB, 4, 9, 4, 0, 10, 0);
  fire.add(f1); fire.add(f2);
  fire.userData.f1 = f1; fire.userData.f2 = f2;
  g.add(fire);
  g.userData.fire = fire;

  if (level === 1) {
    // шалаш
    const hut = mesh(geoCone, woodMat, 42, 40, 42, -14, 20, -8);
    g.add(hut);
    g.userData.hutTop = 44;
  } else {
    const hs = 24 + level * 4;
    const hut = mesh(geoBox, woodMat, hs * 2, hs * 1.1, hs * 1.7, -14, hs * 0.55, -8);
    g.add(hut);
    const roof = mesh(geoCone, roofMat, hs * 1.5, hs * 0.9, hs * 1.3, -14, hs * 1.1 + hs * 0.45, -8);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    // брёвна сруба
    for (let i = 0; i < 4; i++) {
      g.add(mesh(geoCyl, woodDarkMat, 2.2, hs * 1.7, 2.2, -14 - hs + 8 + i * (hs * 2 - 16) / 3, hs * 0.55, -8 + hs * 0.86));
    }
    // флажок
    const pole = mesh(geoCyl, woodDarkMat, 1.2, 26, 1.2, -14 + hs * 0.6, hs * 1.1 + hs * 0.9 + 12, -8);
    g.add(pole);
    const flag = mesh(geoBox, level >= 4 ? goldMat : mat(0xe0524d), 12, 7, 0.8, -14 + hs * 0.6 + 6, hs * 1.1 + hs * 0.9 + 20, -8);
    g.add(flag);
    g.userData.hutTop = hs * 1.1 + hs * 0.9 + 30;
    if (level >= 4) {
      // каменная ограда-кольцо
      const wall = new THREE.Group();
      const posts = 30;
      for (let i = 0; i < posts; i++) {
        const a = (i / posts) * Math.PI * 2;
        wall.add(mesh(geoBox, stoneMat, 16, 14, 10, Math.cos(a) * 96, 7, Math.sin(a) * 88));
      }
      g.add(wall);
    }
    if (level >= 3) {
      // частокол
      const fence = new THREE.Group();
      const posts = level >= 5 ? 40 : 26;
      for (let i = 0; i < posts; i++) {
        const a = (i / posts) * Math.PI * 2 + 0.15;
        const r = level >= 4 ? 108 : 84;
        const p = mesh(geoCyl, woodDarkMat, 3.4, 20, 3.4, Math.cos(a) * r, 10, Math.sin(a) * r * 0.92);
        fence.add(p);
      }
      g.add(fence);
    }
    if (level >= 5) {
      // башни цитадели
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        const tx = Math.cos(a) * 96, tz = Math.sin(a) * 88;
        g.add(mesh(geoCyl, stoneMat, 12, 44, 12, tx, 22, tz));
        g.add(mesh(geoCone, stoneDarkMat, 15, 16, 15, tx, 52, tz));
        g.add(mesh(geoSphere, goldMat, 3, 3, 3, tx, 62, tz));
      }
    }
  }
}
function rebuildHouseView() {
  if (houseView) {
    scene.remove(houseView);
    houseView.traverse(o => { if (o.material && o.material !== flameMatA && o.material !== flameMatB) { /* общие материалы — не dispose */ } });
  }
  houseView = new THREE.Group();
  houseView.position.set(BASE.x, 0, BASE.y);
  buildHouseInto(houseView, lv.house);
  scene.add(houseView);
}

/* ---- ассеты: гуманоиды (человек / зомби) ---- */
function makeHumanoid(cfg) {
  const root = new THREE.Group();
  const mats = [];
  const M = (c, opts) => { const m = mat(c, opts); mats.push(m); return m; };
  const skin = M(cfg.skin, cfg.emissiveSkin ? { emissive: cfg.emissiveSkin } : {});
  const body = M(cfg.body);
  const dark = M(cfg.dark);
  const acc = M(cfg.acc);

  const legs = new THREE.Group();
  legs.position.y = 15;
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(0, 0, -5); legR.position.set(0, 0, 5);
  for (const [grp, m] of [[legL, dark], [legR, dark]]) {
    grp.add(mesh(geoCyl, m, 3.4, 15, 3.4, 0, -7.5, 0));
    grp.add(mesh(geoBox, M(cfg.dark), 7, 3, 5.4, 1.5, -15, 0));
  }
  legs.add(legL); legs.add(legR);
  root.add(legs);

  const torso = mesh(geoSphere, body, 9.5, 11.5, 8.2, 0, 24, 0);
  root.add(torso);
  root.add(mesh(geoBox, acc, 4.6, 11, 13.6, -1, 24, 0));      // ремень/полоса

  const head = new THREE.Group();
  head.position.set(2.4, 36, 0);
  head.add(mesh(geoSphere, skin, 6.8, 7.2, 6.8, 0, 0, 0));
  if (cfg.hair) head.add(mesh(geoSphere, M(cfg.hair), 6.9, 5.4, 6.9, -1.6, 1.4, 0));
  // глаза (смотрим вдоль +X)
  const eyeMat = new THREE.MeshBasicMaterial({ color: cfg.eyeColor || 0x22283a });
  head.add(mesh(geoSphere, eyeMat, 1.15, 1.35, 1.15, 5, 0.8, -2.6));
  head.add(mesh(geoSphere, eyeMat, 1.15, 1.35, 1.15, 5, 0.8, 2.6));
  if (cfg.band) head.add(mesh(geoCyl, M(cfg.band), 6.6, 1.7, 6.6, -0.6, 2.2, 0));
  root.add(head);

  const arms = new THREE.Group();
  arms.position.y = 31;
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(0, 0, -10); armR.position.set(0, 0, 10);
  for (const [grp, m] of [[armL, skin], [armR, skin]]) {
    grp.add(mesh(geoCyl, m, 2.9, 16, 2.9, 0, -8, 0));
  }
  arms.add(armL); arms.add(armR);
  root.add(arms);

  // оружие в правой руке
  const weapon = new THREE.Group();
  weapon.position.set(0, -16, 0);
  weapon.rotation.z = -Math.PI / 2;      // лежит вдоль +X (вперёд)
  armR.add(weapon);

  root.traverse(o => { if (o.isMesh) o.castShadow = !NO_RENDER; });
  return { root, armL, armR, legL, legR, head, weapon, mats, torso };
}

function buildWeaponMesh(g, level) {
  g.clear();
  if (level === 1) {
    const c = mesh(geoCyl, woodMat, 2.2, 24, 2.2, 12, 0, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    g.add(mesh(geoSphere, mat(0xa3703f), 4.4, 4.4, 4.4, 23, 0, 0));
  } else if (level === 2) {
    const c = mesh(geoCyl, woodMat, 1.8, 24, 1.8, 12, 0, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    g.add(mesh(geoBox, stoneMat, 12, 12, 4, 24, 2, 0));
  } else if (level === 3) {
    const c = mesh(geoCyl, woodMat, 1.5, 38, 1.5, 19, 0, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    const tip = mesh(geoCone, mat(0xc8d0dc), 3.4, 12, 3.4, 42, 0, 0);
    tip.rotation.z = -Math.PI / 2;
    g.add(tip);
  } else if (level === 4) {
    const c = mesh(geoCyl, mat(0x6e5236), 2, 24, 2, 12, 0, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    g.add(mesh(geoSphere, stoneMat, 7.4, 7.4, 7.4, 26, 0, 0));
  } else {
    const c = mesh(geoCyl, woodDarkMat, 2.2, 30, 2.2, 15, 0, 0);
    c.rotation.z = Math.PI / 2;
    g.add(c);
    g.add(mesh(geoBox, mat(0xc8d0dc), 16, 20, 4.4, 33, 3, 0));
  }
}

const humanLook = (() => {
  const skins = [0xf0c090, 0xe0a878, 0xc88a5a, 0xa06a42];
  const hairs = [0x2a1c10, 0x4a2f18, 0x151310, 0x6b4423];
  const furs = [0x8a5a30, 0x7a4f2a, 0x96683c, 0x6e4526];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return { skin: pick(skins), hair: pick(hairs), body: pick(furs) };
})();
const hero = makeHumanoid({
  skin: humanLook.skin, body: humanLook.body, dark: 0x4a3625,
  hair: humanLook.hair, acc: 0x7a4f2a, band: 0xc0563e,
});
scene.add(hero.root);
buildWeaponMesh(hero.weapon, lv.weapon);
function rebuildWeapon() { buildWeaponMesh(hero.weapon, lv.weapon); }
hero.root.position.set(human.x, 0, human.y);

const heroBarAnchor = new THREE.Object3D();
heroBarAnchor.position.y = 52;
hero.root.add(heroBarAnchor);

/* ---- маркер движения ---- */
const marker = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(10, 13, 28), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(2.6, 12), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, depthWrite: false }));
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.3;
  marker.add(dot);
}
marker.visible = false;
scene.add(marker);

/* ---- пятна от зомби ---- */
const stainMat = new THREE.MeshBasicMaterial({ color: 0x2a3d1e, transparent: true });
function spawnStain(x, y, r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), stainMat.clone());
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.25 + Math.random() * 0.2, y);
  scene.add(m);
  stainsView.push({ mesh: m, life: 1 });
}
const stainsView = [];

/* ---- частицы (пул 3D-кубиков) ---- */
const partPool = [];
for (let i = 0; i < 90; i++) {
  const m = new THREE.Mesh(geoBox, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  m.visible = false;
  scene.add(m);
  partPool.push({ mesh: m, busy: false, vx: 0, vy: 0, life: 0 });
}
function updatePartsView(dt) {
  let pi = 0;
  for (const p of parts) {
    if (pi >= partPool.length) break;
    const slot = partPool[pi++];
    slot.mesh.visible = true;
    slot.mesh.position.set(p.x, 10 + p.life * 14, p.y);
    slot.mesh.scale.setScalar(0.5 + p.size * 0.22);
    slot.mesh.material.color.set(p.color);
  }
  for (; pi < partPool.length; pi++) partPool[pi].mesh.visible = false;
}

/* ---- синхронизация вида ---- */
function syncNodesView(t, dt) {
  for (const n of nodes) {
    if (!n.view) n.view = buildNodeView(n);
    const v = n.view;
    const growK = clamp(n.grow / 4, 0.15, 1);
    if (n.dead) {
      // падение дерева / оседание камня
      if (n.fallT >= 0 && n.fallT < 1.4) {
        n.fallT += dt;
        const k = clamp(n.fallT / 0.7, 0, 1);
        v.userData.body.visible = true;
        v.userData.body.rotation.x = n.type === "tree" ? k * k * Math.PI / 2 * (n.seed > 0.5 ? 1 : -1) : 0;
        v.userData.body.scale.setScalar(n.type === "tree" ? 1 : 1 - k * 0.5);
        v.userData.body.position.y = n.type === "tree" ? 0 : -k * 3;
        v.userData.stump.visible = false;
      } else {
        v.userData.body.visible = false;
        v.userData.stump.visible = true;
        v.userData.stump.scale.setScalar(growK < 0.3 ? 1 : 1);
      }
    } else {
      v.userData.body.visible = true;
      v.userData.body.rotation.x = 0;
      v.userData.body.scale.setScalar(n.dead ? 1 : growK);
      v.userData.stump.visible = false;
      // покачивание и встряхивание
      if (v.userData.canopy) v.userData.canopy.rotation.z = Math.sin(t * 0.9 + n.seed * 9) * 0.04;
      v.rotation.y = Math.sin(t * 40) * n.shake * 0.08;
      const s = n.scale * growK;
      v.userData.body.scale.setScalar(s / Math.max(n.scale, 0.001) * n.scale);
      if (n.flash > 0.02) {
        for (const ch of v.userData.body.children) {
          const mm = ch.material;
          if (mm && mm.emissive) mm.emissive.setScalar(n.flash * 0.35);
        }
      } else {
        for (const ch of v.userData.body.children) {
          const mm = ch.material;
          if (mm && mm.emissive && mm !== berryMat && mm !== goldMat) mm.emissive.setScalar(0);
        }
      }
    }
  }
}

function syncHumanView(t) {
  hero.root.position.set(human.x, 0, human.y);
  hero.root.rotation.y = -human.dir;
  const swing = Math.sin(human.ph);
  const moving = Math.abs(human.ph) > 0;
  // ноги
  hero.legL.rotation.z = swing * 0.55;
  hero.legR.rotation.z = -swing * 0.55;
  // левая рука
  hero.armL.rotation.z = 0.15 + swing * 0.5;
  // правая рука: замах атаки или ходьба
  if (human.attackT < 1) {
    const k = human.attackT;
    const e = k < 0.35 ? -(k / 0.35) * 0.9 : k < 0.55 ? lerp(-0.9, 1.7, ((k - 0.35) / 0.2) ** 2) : lerp(1.7, 0.2, smooth((k - 0.55) / 0.45));
    hero.armR.rotation.z = e - 0.2;
  } else {
    hero.armR.rotation.z = 0.15 - swing * 0.5;
  }
  heroLight.position.set(human.x, 26, human.y);
}

const zombieViews = new Map();
function makeZombieView(z) {
  const h = makeHumanoid({
    skin: z.g1.getHex(), body: z.g2.getHex(), dark: 0x3a4d2a,
    acc: 0x4a5540, eyeColor: 0xff3226,
    emissiveSkin: 0x0a1f08,
  });
  h.armL.rotation.z = 1.35;
  h.armR.rotation.z = 1.35;
  scene.add(h.root);
  return h;
}
function syncZombiesView(t, dt) {
  const alive = new Set();
  for (const z of zombies) {
    alive.add(z);
    let v = zombieViews.get(z);
    if (!v) { v = makeZombieView(z); zombieViews.set(z, v); }
    v.root.position.set(z.x, 0, z.y);
    v.root.rotation.y = -z.dir;
    const lurch = Math.sin(z.lurch * 3.1);
    v.legL.rotation.z = lurch * 0.5;
    v.legR.rotation.z = -lurch * 0.5;
    const reach = z.attackT < 1 ? (1 - z.attackT) * 0.5 : 0;
    v.armL.rotation.z = 1.35 + lurch * 0.16 + reach;
    v.armR.rotation.z = 1.35 - lurch * 0.16 + reach;
    v.head.rotation.z = lurch * 0.14;
    // вспышка урона
    for (const m of v.mats) if (m.emissive) m.emissive.setScalar(z.flash * 0.55);
  }
  for (const [z, v] of zombieViews) {
    if (!alive.has(z)) {
      // смерть: падение и растворение
      v.dying = (v.dying || 0) + dt;
      const k = clamp(v.dying / 0.4, 0, 1);
      v.root.rotation.x = -k * Math.PI / 2;
      if (v.dying > 1.6) {
        const f = clamp(1 - (v.dying - 1.6) / 0.8, 0, 1);
        v.root.traverse(o => {
          if (o.isMesh) {
            o.material.transparent = true;
            o.material.opacity = f;
          }
        });
      }
      if (v.dying > 2.5) {
        scene.remove(v.root);
        zombieViews.delete(z);
      }
    }
  }
}

function syncHouseView(t, nf) {
  if (!houseView) rebuildHouseView();
  houseView.position.x = BASE.x + (Math.random() - 0.5) * houseShake * 5;
  houseView.position.z = BASE.y + (Math.random() - 0.5) * houseShake * 5;
  const fire = houseView.userData.fire;
  if (fire) {
    const fl = Math.sin(t * 11) * 0.14 + Math.sin(t * 23) * 0.06;
    fire.userData.f1.scale.set(8 * (1 + fl), 16 * (1 + fl * 1.6), 8 * (1 + fl));
    fire.userData.f2.scale.set(4, 9 * (1 - fl), 4);
    fireLight.intensity = (0.5 + 2.6 * nf) * (1 + fl * 0.5);
  }
}

function syncMarker() {
  if (human.moveGoal) {
    marker.visible = true;
    marker.position.set(human.moveGoal.x, 0.4, human.moveGoal.y);
    const k = 1 + Math.sin(elapsed * 7) * 0.12;
    marker.scale.setScalar(k);
  } else {
    marker.visible = false;
  }
}

/* ---- камера ---- */
const camTarget = new THREE.Vector3(BASE.x, 0, BASE.y);
let camX = 0, camY = 0;   // для миникарты (левый верхний угол)
function updateCamera(dt) {
  const k = 1 - Math.exp(-5 * dt);
  camTarget.x = lerp(camTarget.x, human.x, k);
  camTarget.z = lerp(camTarget.z, human.y, k);
  const tx = clamp(camTarget.x, 0, W);
  const tz = clamp(camTarget.z, 0, H);
  const d = 950;
  camera.position.set(tx, Math.sin(CAM_TILT) * d, tz + Math.cos(CAM_TILT) * d);
  camera.lookAt(tx, 0, tz);
  // для миникарты: приблизительный видимый прямоугольник
  const halfH = VIEW_HALF / zoom, halfW = halfH * VW / VH;
  camX = tx - halfW;
  camY = tz - halfH * 1.15;
}

/* ---- солнце / день-ночь ---- */
const colDayTop = new THREE.Color(0x87b0d8);
const colNightTop = new THREE.Color(0x060a1c);
const colDayFog = new THREE.Color(0xa5c8e0);
const colNightFog = new THREE.Color(0x0a1024);
function updateSkyLight(nf, t) {
  scene.background = scene.background || new THREE.Color();
  scene.background.lerpColors(colDayTop, colNightTop, nf);
  scene.fog = scene.fog || new THREE.Fog(0x000000, 900, 2400);
  scene.fog.color.lerpColors(colDayFog, colNightFog, nf);
  scene.fog.near = lerp(1100, 700, nf);
  scene.fog.far = lerp(2800, 1600, nf);
  sun.intensity = lerp(1.35, 0.05, nf);
  sun.color.lerpColors(new THREE.Color(0xfff2dd), new THREE.Color(0x8aa0ff), nf);
  hemi.intensity = lerp(0.95, 0.16, nf);
  stars.material.opacity = nf * 0.9;
  // положение солнца по времени суток
  const p = clamp(cycleT / NIGHT_AT, 0, 1);
  const az = lerp(-2.1, 2.1, p);
  const elev = lerp(0.35, 1.15, Math.sin(p * Math.PI));
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
  sun.position.copy(camTarget).addScaledVector(dir, 1000);
  sun.target.position.copy(camTarget);
}

/* ---------------- ВВОД ---------------- */
const keys = {};
let hurtFlash = 0, houseShake = 0;
let speedMult = 1, paused = false;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "Space") togglePause();
  if (e.code === "KeyM") toggleMute();
  if (e.code === "Digit1") setPrio("house");
  if (e.code === "Digit2") setPrio("weapon");
  if (e.code === "Digit3") setPrio("bag");
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });
cv.addEventListener("pointerdown", (e) => {
  if (gameOverFlag) return;
  ndc.x = (e.clientX / VW) * 2 - 1;
  ndc.y = -(e.clientY / VH) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    const wx = clamp(hitPoint.x, 30, W - 30);
    const wy = clamp(hitPoint.z, 30, H - 30);
    human.moveGoal = { x: wx, y: wy, ttl: 6 };
    spawnParts(wx, wy, 6, "#ffe08a", { sp: 60 });
  }
});
window.addEventListener("wheel", (e) => {
  zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.09), 0.5, 2.2);
  updateProjection();
}, { passive: true });

/* ---------------- HUD ---------------- */
const $ = id => document.getElementById(id);
const toastEl = $("toast");
let toastTimer = null;
function toast(msg, dur = 3400) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), dur);
}
function fmtCost(c) {
  const a = [];
  if (c.wood) a.push("🪵" + c.wood);
  if (c.stone) a.push("🪨" + c.stone);
  return a.join(" ");
}
function refreshHUD() {
  $("inv-wood").textContent = inv.wood;
  $("inv-stone").textContent = inv.stone;
  $("inv-food").textContent = inv.food;
  $("bagTxt").textContent = carryTotal() + " / " + bagCap();
  $("lv-house").textContent = lv.house;
  $("lv-weapon").textContent = lv.weapon;
  $("lv-bag").textContent = lv.bag;
  const set = (id, c, enabled) => {
    const el = $(id);
    el.textContent = enabled ? fmtCost(c) : "МАКС";
    el.classList.toggle("no", enabled && !canAfford(c));
  };
  set("cost-house", houseCost(lv.house), lv.house < MAX_LV);
  set("cost-weapon", weaponCost(lv.weapon), lv.weapon < MAX_LV);
  set("cost-bag", bagCost(lv.bag), lv.bag < MAX_LV);
}
function setPrio(k) {
  prio = k;
  for (const id of ["house", "weapon", "bag"]) $(`prio-${id}`).classList.toggle("sel", id === k);
  if (human.buildKind && human.buildKind !== "repair") { human.buildKind = null; }
}
for (const id of ["house", "weapon", "bag"]) $(`prio-${id}`).addEventListener("click", () => setPrio(id));
$("btnSpeed").addEventListener("click", () => {
  speedMult = speedMult === 1 ? 2 : speedMult === 2 ? 3 : 1;
  $("btnSpeed").textContent = "×" + speedMult;
});
function togglePause() {
  paused = !paused;
  $("btnPause").textContent = paused ? "▶" : "⏸";
}
$("btnPause").addEventListener("click", togglePause);
function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  $("btnMute").textContent = muted ? "🔇" : "🔊";
}
$("btnMute").addEventListener("click", toggleMute);
$("overBtn").addEventListener("click", () => location.reload());

let gameOverFlag = false;
function gameOver(reason) {
  if (gameOverFlag) return;
  gameOverFlag = true;
  sfx.lose();
  let best = 0, bestKills = 0;
  try {
    best = +localStorage.getItem("survTD_best") || 0;
    bestKills = +localStorage.getItem("survTD_bestKills") || 0;
    if (wave > best) { best = wave; localStorage.setItem("survTD_best", best); }
    if (human.kills > bestKills) { bestKills = human.kills; localStorage.setItem("survTD_bestKills", bestKills); }
  } catch (e) { /* ignore */ }
  $("overTitle").textContent = reason.startsWith("Человек") ? "☠ Вы погибли" : "☠ База разрушена";
  $("overStats").textContent =
    `${reason}\n\nДней выжито: ${dayN - 1}\nВолн отбито: ${Math.max(wave - 1, 0)}\nЗомби убито: ${human.kills}\n` +
    `Дом: ${HOUSE_NAMES[lv.house - 1]} (ур. ${lv.house})\nОружие: ${WEAPON_NAMES[lv.weapon - 1]}\n\n` +
    `🏆 Рекорд: ${best} волн · ${bestKills} убийств`;
  $("over").classList.add("show");
}

/* ---------------- ОВЕРЛЕЙ (полоски HP, текст) ---------------- */
const _proj = new THREE.Vector3();
function worldToScreen(x, y, h) {
  _proj.set(x, h, y).project(camera);
  return { x: (_proj.x * 0.5 + 0.5) * VW, y: (-_proj.y * 0.5 + 0.5) * VH, ok: _proj.z < 1 };
}
function drawBar(sx, sy, w, frac, color) {
  octx.fillStyle = "rgba(0,0,0,0.55)";
  octx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 7);
  octx.fillStyle = color;
  octx.fillRect(sx - w / 2, sy, w * clamp(frac, 0, 1), 5);
}
function drawOverlay() {
  octx.clearRect(0, 0, VW, VH);
  // HP человека
  if (human.hp < human.maxHp) {
    const s = worldToScreen(human.x, human.y, 56);
    if (s.ok) drawBar(s.x, s.y, 40, human.hp / human.maxHp, "#ff8a6a");
  }
  // HP зомби
  for (const z of zombies) {
    const s = worldToScreen(z.x, z.y, 52);
    if (!s.ok || s.x < -40 || s.x > VW + 40 || s.y < -40 || s.y > VH + 40) continue;
    drawBar(s.x, s.y, 32, z.hp / z.maxHp, "#8fce6a");
  }
  // HP дома
  if (house.hp < house.maxHp && houseView) {
    const s = worldToScreen(BASE.x, BASE.y, houseView.userData.hutTop + 20 || 70);
    if (s.ok) drawBar(s.x, s.y, 70, house.hp / house.maxHp, "#7ec96d");
  }
  // всплывающий текст
  octx.textAlign = "center";
  for (const f of texts) {
    const s = worldToScreen(f.x, f.y, 34);
    if (!s.ok) continue;
    octx.font = `bold ${f.big ? 17 : 13}px system-ui`;
    octx.globalAlpha = clamp(f.life * 1.3, 0, 1);
    octx.fillStyle = "rgba(0,0,0,0.55)";
    octx.fillText(f.txt, s.x + 1, s.y + 1);
    octx.fillStyle = f.color;
    octx.fillText(f.txt, s.x, s.y);
  }
  octx.globalAlpha = 1;
  if (hurtFlash > 0.02) {
    octx.fillStyle = `rgba(200,30,20,${hurtFlash * 0.22})`;
    octx.fillRect(0, 0, VW, VH);
  }
}

/* ---------------- МИНИКАРТА ---------------- */
function drawMiniMap() {
  const mw = mini.width, mh = mini.height;
  mx.setTransform(1, 0, 0, 1, 0, 0);
  mx.fillStyle = "#26331f";
  mx.fillRect(0, 0, mw, mh);
  const kx = mw / W, ky = mh / H;
  for (const n of nodes) {
    if (n.dead) continue;
    mx.fillStyle = n.type === "tree" ? "#3f8b44" : n.type === "rock" ? "#9aa3b2" : "#e0524d";
    mx.fillRect(n.x * kx - 1, n.y * ky - 1, 2.4, 2.4);
  }
  mx.fillStyle = "#ffd76e";
  mx.fillRect(BASE.x * kx - 3, BASE.y * ky - 3, 6, 6);
  mx.fillStyle = "#ff5a4d";
  for (const z of zombies) mx.fillRect(z.x * kx - 1.4, z.y * ky - 1.4, 2.8, 2.8);
  mx.fillStyle = "#ffffff";
  mx.fillRect(human.x * kx - 2, human.y * ky - 2, 4, 4);
  mx.strokeStyle = "rgba(255,255,255,0.35)";
  mx.lineWidth = 1;
  const halfH = VIEW_HALF / zoom, halfW = halfH * VW / VH;
  mx.strokeRect((camTarget.x - halfW) * kx, (camTarget.z - halfH * 1.15) * ky, halfW * 2 * kx, halfH * 2.3 * ky);
}

/* ---------------- ВРЕМЯ / ЦИКЛ ---------------- */
let cycleT = 0.08;
let dayN = 1;
let elapsed = 0;
let nightToastShown = false;
function isNightNow() { return cycleT >= NIGHT_AT; }
function nightFactorCalc() {
  const t = cycleT;
  if (t < 0.56) return 0;
  if (t < 0.65) return smooth((t - 0.56) / 0.09);
  if (t < 0.94) return 1;
  return 1 - smooth(clamp((t - 0.94) / 0.06, 0, 1));
}

function updateHUDTime() {
  $("dayLabel").textContent = "День " + dayN + " · Волна " + Math.max(wave + (isNightNow() ? 0 : 1), 1);
  $("timefill").style.width = (cycleT * 100).toFixed(1) + "%";
  if (!isNightNow()) {
    const sec = Math.ceil((NIGHT_AT - cycleT) * DAY_LEN);
    $("phaseLabel").textContent = "☀️ До ночи: " + sec + "с";
  } else {
    const sec = Math.ceil((1 - cycleT) * DAY_LEN);
    $("phaseLabel").textContent = "🌙 Зомби: " + zombies.length + " · До рассвета: " + sec + "с";
  }
  $("hpfill").style.width = clamp(human.hp / human.maxHp * 100, 0, 100) + "%";
}

/* ---------------- ГЛАВНЫЙ ЦИКЛ ---------------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (paused || gameOverFlag) return;
  dt *= speedMult;
  elapsed += dt;

  // время суток
  const wasNight = isNightNow();
  cycleT += dt / DAY_LEN;
  if (cycleT >= 1) {
    cycleT -= 1;
    dayN++;
    wave = Math.max(wave, 1);
    toast("🌅 День " + dayN + ". Успейте подготовиться!", 2800);
    sfx.dawn();
    refreshHUD();
  }
  const isNight = isNightNow();
  if (isNight && !wasNight) {
    wave++;
    toSpawn = waveCount(wave);
    spawnCd = 1.5;
    toast("🌙 Ночь " + (dayN - 1) + "! Волна " + wave + " — " + toSpawn + " зомби идут к дому!", 4200);
    sfx.horn();
  }
  const nf = nightFactorCalc();

  hurtFlash *= Math.exp(-3 * dt);
  houseShake *= Math.exp(-5 * dt);
  for (const n of nodes) { n.shake *= Math.exp(-6 * dt); n.flash *= Math.exp(-8 * dt); }

  for (const n of nodes) {
    if (n.dead) {
      n.respawn += dt;
      if (n.respawn > nodeRespawnTime(n.type)) { n.dead = false; n.hp = n.maxHp; n.grow = 0; n.fallT = -1; }
    } else if (n.grow < 4) n.grow += dt;
  }

  if (!isNight && dist(human.x, human.y, BASE.x, BASE.y) < HOME_R && human.hp < human.maxHp) {
    human.hp = Math.min(human.maxHp, human.hp + 1.6 * dt);
  }

  updateHuman(dt, isNight, nf);
  updateZombies(dt, isNight, nf);
  updateFx(dt);
  updateCamera(dt);

  // вид
  syncNodesView(elapsed, dt);
  syncHumanView(elapsed);
  syncZombiesView(elapsed, dt);
  syncHouseView(elapsed, nf);
  syncMarker();
  updateSkyLight(nf, elapsed);
  updatePartsView(dt);
  for (let i = stainsView.length - 1; i >= 0; i--) {
    const s = stainsView[i];
    s.life -= dt / 12;
    if (s.life <= 0) { scene.remove(s.mesh); stainsView.splice(i, 1); }
    else s.mesh.material.opacity = clamp(s.life, 0, 1) * 0.75;
  }
  if (renderer) renderer.render(scene, camera);
  drawOverlay();
  drawMiniMap();
  updateHUDTime();
}

/* ---------------- СТАРТ ---------------- */
genWorld();
rebuildHouseView();
resize();
updateCamera(1);
refreshHUD();
toast("🪓 2.5D: все ассеты — настоящие 3D-модели. Колонист сам добывает, строит и дерётся. ЛКМ — послать его, 1/2/3 — приоритет, колесо — зум. Ночью — волна зомби!", 6500);
requestAnimationFrame(frame);
