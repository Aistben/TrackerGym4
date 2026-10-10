/* ============================================================
   ПЕРВОБЫТНЫЙ ВЫЖИВАЧ — top-down 2D
   Человек-автоном: сам добывает ресурсы, строит и улучшает дом,
   ночью отбивается от волн зомби. Игрок задаёт приоритеты.
   ============================================================ */
"use strict";

/* ---------------- МИР / БАЛАНС ---------------- */
const W = 2600, H = 1900;            // размер мира
const BASE = { x: W / 2, y: H / 2 }; // дом в центре
const DAY_LEN = 130;                 // длительность суток, с
const NIGHT_AT = 0.62;               // доля суток, когда начинается ночь
const HOME_R = 92;                   // «дворовая» зона дома

const human = {
  x: BASE.x + 120, y: BASE.y + 40,
  dir: 0, ph: 0, speed: 132,
  hp: 100, maxHp: 100,
  atkCd: 0, attackT: 1,           // attackT: 1 = не бьёт
  eatT: 0, buildT: 0, buildKind: null,
  carry: { wood: 0, stone: 0, food: 0 },
  kills: 0,
  task: null,                     // {type:'gather',node} | {type:'home'} | {type:'guard'}
  moveGoal: null,                 // {x,y,ttl}
  look: null,                     // внешность (генерируется)
};

const lv = { house: 1, weapon: 1, bag: 1 };
let prio = "house";               // что улучшать следующим
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

/* ---------------- ХОЛСТ ---------------- */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
let VW = 0, VH = 0, DPR = 1;
const dk = document.createElement("canvas");
const dkx = dk.getContext("2d");
const mini = document.getElementById("mini");
const mx = mini.getContext("2d");
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
  growl() { tone(90, 60, 0.5, "sawtooth", 0.22); },
  place() { tone(330, 190, 0.07, "triangle", 0.32); noiseSfx(0.05, 500, 0.2); },
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
    shake: 0, dead: false, respawn: 0, grow: 10, flash: 0,
  });
}
function genWorld() {
  const tryAdd = (type, minBase) => {
    for (let t = 0; t < 24; t++) {
      const x = 90 + hash(type.length * 7 + t * 13.3 + nid) * (W - 180);
      const y = 90 + hash(type.length * 3 + t * 7.7 + nid * 1.7) * (H - 180);
      const db = dist(x, y, BASE.x, BASE.y);
      if (db < minBase || db > 700 && nodes.length < 8) continue;
      let ok = true;
      for (const n of nodes) if (dist(x, y, n.x, n.y) < 78) { ok = false; break; }
      if (ok) { addNode(type, x, y); return; }
    }
  };
  // стартовые рядом с базой
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

/* ---------------- СУЩНОСТИ ---------------- */
const zombies = [];
const parts = [];
const texts = [];
const stains = [];
const corpses = [];

function spawnParts(x, y, n, color, opt = {}) {
  for (let i = 0; i < n; i++) {
    const a = opt.dir !== undefined ? opt.dir + (Math.random() - 0.5) * (opt.spread || 1.6) : Math.random() * Math.PI * 2;
    const sp = (opt.sp || 110) * (0.4 + Math.random() * 0.9);
    parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      g: opt.g !== undefined ? opt.g : 0,
      life: 1, decay: opt.decay || 1.7,
      size: 2 + Math.random() * 3, color,
    });
  }
}
function floatText(x, y, txt, color, big) {
  texts.push({ x, y, txt, color, life: 1, big: !!big });
}

/* ---------------- ЧАСТИЦЫ ОБНОВЛЕНИЕ ---------------- */
function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy += p.g * dt;
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
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.life -= dt / 6;
    if (c.life <= 0) { stains.push({ x: c.x, y: c.y, r: 15, color: "rgba(40,60,30,0.35)", life: 1 }); corpses.splice(i, 1); }
  }
}

/* ---------------- РЕСУРСНЫЕ ДЕЙСТВИЯ ---------------- */
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
}
function nodeRespawnTime(type) { return type === "tree" ? 42 : type === "rock" ? 60 : 30; }

function applyNodeHit(n) {
  n.hp--; n.shake = 1; n.flash = 1;
  giveYield(n.type);
  if (n.type === "tree") {
    spawnParts(n.x, n.y - 6, 7, "#a3703f", { sp: 130 });
    sfx.chop();
  } else if (n.type === "rock") {
    spawnParts(n.x, n.y, 7, "#9aa3b2", { sp: 140 });
    sfx.mine();
  } else {
    spawnParts(n.x, n.y - 6, 6, "#e0524d", { sp: 90 });
    sfx.pick();
  }
  if (n.hp <= 0) {
    n.dead = true; n.respawn = 0;
    if (n.type === "tree") spawnParts(n.x, n.y - 4, 14, "#7a4f2a", { sp: 150 });
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
  refreshHUD();
}

/* ---------------- ЗОМБИ ---------------- */
let wave = 0;          // номер прошедшей/текущей волны
let toSpawn = 0, spawnCd = 0;
let growlCd = 3;
const waveCount = n => 2 + n * 2;
const waveHp = n => 24 + n * 9;
const waveSpd = n => Math.min(42 + n * 2.4, 96);
const waveDmg = n => 5 + n;

function spawnZombie() {
  const a = Math.random() * Math.PI * 2;
  const r = Math.hypot(W, H) / 2 + 60;
  const g1 = 0.35 + Math.random() * 0.25;
  zombies.push({
    x: clamp(BASE.x + Math.cos(a) * r, -40, W + 40),
    y: clamp(BASE.y + Math.sin(a) * r, -40, H + 40),
    dir: 0, ph: Math.random() * 7,
    hp: waveHp(wave), maxHp: waveHp(wave),
    spd: waveSpd(wave) * (0.9 + Math.random() * 0.25),
    dmg: waveDmg(wave),
    atkCd: 0, flash: 0, lurch: Math.random() * 7,
    skin: `hsl(${95 + Math.random() * 30}, 35%, ${28 + Math.random() * 12}%)`,
    g1, g2: `hsl(${95 + Math.random() * 30}, 30%, ${20 + Math.random() * 10}%)`,
  });
}

function zombieHitHuman(z) {
  const dmg = z.dmg;
  human.hp -= dmg;
  human.atkCd = Math.max(human.atkCd, 0.18);
  sfx.hurt();
  hurtFlash = 1;
  spawnParts(human.x, human.y, 8, "#c0392b", { sp: 130 });
  floatText(human.x, human.y - 36, "-" + dmg, "#ff7b6e");
  if (human.hp <= 0) gameOver("Человек пал в бою…");
}
function zombieHitHouse(z) {
  house.hp -= z.dmg;
  sfx.hit();
  houseShake = 1;
  spawnParts(z.x, z.y, 6, "#a3703f", { sp: 100 });
  if (house.hp <= 0) { house.hp = 0; gameOver("Дом разрушен — база пала…"); }
}

/* ---------------- БОЙ ЧЕЛОВЕКА ---------------- */
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
    const d = dist(human.x, human.y, z.x, z.y);
    if (d > range + 12) continue;
    const a = Math.atan2(z.y - human.y, z.x - human.x);
    if (Math.abs(angleDiff(human.dir, a)) > arc) continue;
    const dmg = weaponDmg();
    z.hp -= dmg; z.flash = 1;
    // отброс
    z.x += Math.cos(a) * 14; z.y += Math.sin(a) * 14;
    spawnParts(z.x, z.y, 7, "#5d8a3a", { dir: a, spread: 1, sp: 150 });
    floatText(z.x, z.y - 24, "-" + dmg, "#ffe08a");
    sfx.hit();
    hitAny = true;
    if (z.hp <= 0) killZombie(z);
  }
  // дереву/кусту под ударом тоже достаётся (добыча тем же замахом)
  if (!hitAny && human.task && human.task.type === "gather" && !human.task.node.dead) {
    const n = human.task.node;
    const d = dist(human.x, human.y, n.x, n.y);
    if (d < 64) {
      const a = Math.atan2(n.y - human.y, n.x - human.x);
      if (Math.abs(angleDiff(human.dir, a)) < 1.15) applyNodeHit(n);
    }
  }
  return hitAny;
}
function killZombie(z) {
  z.dead = true;
  human.kills++;
  human.maxHp = Math.min(100 + human.kills * 2, 170);
  corpses.push({ x: z.x, y: z.y, dir: z.dir, life: 1, skin: z.skin });
  spawnParts(z.x, z.y, 14, "#4e7a3a", { sp: 160 });
  spawnParts(z.x, z.y, 8, "#7a1f1f", { sp: 130 });
  sfx.zdie();
}

/* ---------------- ИИ ЧЕЛОВЕКА ---------------- */
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
  // какой ресурс нужнее для выбранного улучшения (или дефицит дома)
  const ups = [prio, ...["house", "weapon", "bag"].filter(k => k !== prio)];
  for (const k of ups) {
    if (lv[k] >= MAX_LV) continue;
    const c = k === "house" ? houseCost(lv.house) : k === "weapon" ? weaponCost(lv.weapon) : bagCost(lv.bag);
    if (inv.wood < c.wood) return "wood";
    if (inv.stone < c.stone) return "stone";
  }
  if (human.hp < 80 && inv.food < 3) return "food";
  return Math.random() < 0.6 ? "wood" : "stone";
}
function moveToward(tx, ty, dt, spdMul = 1) {
  const d = dist(human.x, human.y, tx, ty);
  if (d < 3) return true;
  const sp = human.speed * spdMul;
  const nx = human.x + (tx - human.x) / d * sp * dt;
  const ny = human.y + (ty - human.y) / d * sp * dt;
  human.x = clamp(nx, 26, W - 26); human.y = clamp(ny, 26, H - 26);
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

  // удар в середине замаха (и в бою, и при добыче)
  if (human.swingActive && !human.attackResolved && human.attackT >= 0.42) {
    human.attackResolved = true;
    resolveAttack();
  }

  const zNear = nearestZombie(human.x, human.y, isNight ? 190 : 150);
  human.combat = false;

  // ---- бой всегда в приоритете ----
  if (zNear) {
    human.combat = true;
    human.task = null;
    const d = dist(human.x, human.y, zNear.x, zNear.y);
    const range = lv.weapon >= 3 ? 50 : 42;
    if (d > range) moveToward(zNear.x, zNear.y, dt);
    else {
      faceToward(zNear.x, zNear.y, dt);
      if (human.atkCd <= 0 && human.attackT >= 1) { humanAttack(); human.attackResolved = false; }
    }
    // не давать себя окружить: лёгкий отход при hp<30%
    if (human.hp < human.maxHp * 0.3 && isNight) {
      const a = Math.atan2(human.y - BASE.y, human.x - BASE.x);
      moveToward(BASE.x + Math.cos(a) * 40, BASE.y + Math.sin(a) * 40, dt, 0.9);
    }
    return;
  }

  // ---- ручной приказ ----
  if (human.moveGoal) {
    human.moveGoal.ttl -= dt;
    const arrived = moveToward(human.moveGoal.x, human.moveGoal.y, dt);
    if (arrived || human.moveGoal.ttl <= 0) human.moveGoal = null;
    return;
  }

  // ---- еда ----
  if (human.hp < human.maxHp * 0.55 && human.carry.food > 0 && human.eatT <= 0) {
    human.eatT = 0.7;
    human.carry.food--;
    human.hp = Math.min(human.maxHp, human.hp + 30);
    floatText(human.x, human.y - 36, "+30 ❤️", "#8fe08f");
    sfx.eat();
    return;
  }
  if (human.hp < human.maxHp * 0.55 && human.carry.food <= 0 && inv.food > 0 &&
      dist(human.x, human.y, BASE.x, BASE.y) < HOME_R) {
    inv.food--; human.hp = Math.min(human.maxHp, human.hp + 30);
    floatText(human.x, human.y - 36, "+30 ❤️", "#8fe08f");
    sfx.eat();
    return;
  }

  // ---- ночь: охрана базы ----
  if (isNight) {
    const dHome = dist(human.x, human.y, BASE.x, BASE.y);
    if (dHome > HOME_R * 0.8) moveToward(BASE.x, BASE.y + 46, dt);
    return;
  }

  // ---- день: работа ----
  const cTotal = carryTotal();
  const cap = bagCap();
  const atHome = dist(human.x, human.y, BASE.x, BASE.y) < HOME_R * 0.9;

  // 1) сдать добычу
  if (cTotal > 0 && (cTotal >= cap || !human.task || human.task.type === "home")) {
    if (!atHome) { moveToward(BASE.x, BASE.y + 40, dt); return; }
    // сдать
    if (cTotal > 0) {
      inv.wood += human.carry.wood; inv.stone += human.carry.stone; inv.food += human.carry.food;
      if (cTotal >= cap) floatText(BASE.x, BASE.y - 70, "Добыча сдана", "#c9e8a0");
      human.carry = { wood: 0, stone: 0, food: 0 };
      refreshHUD();
    }
  }

  // 2) ремонт дома (если повреждён и есть дерево)
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

  // 3) строительство/улучшение (у дома, днём)
  if (atHome && !human.buildKind) {
    const up = nextUpgrade();
    if (up) {
      payCost(up.cost);                       // ресурсы списываем сразу
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

  // 4) сбор ресурсов
  const want = needType();
  if (human.task && (human.task.node.dead || needTypeSafe(human.task) !== want)) human.task = null;
  if (!human.task) {
    const tmap = { wood: "tree", stone: "rock", food: "bush" };
    const n = nearestNode(tmap[want], human.x, human.y) ||
              nearestNode("tree", human.x, human.y) ||
              nearestNode("rock", human.x, human.y) ||
              nearestNode("bush", human.x, human.y);
    if (n) human.task = { type: "gather", node: n };
    else { // нечего добывать — вернуться к дому
      moveToward(BASE.x + 60, BASE.y + 60, dt);
      return;
    }
  }
  const n = human.task.node;
  const d = dist(human.x, human.y, n.x, n.y);
  const reach = 40;
  if (d > reach) { moveToward(n.x, n.y, dt); return; }
  faceToward(n.x, n.y, dt);
  if (human.atkCd <= 0 && human.attackT >= 1) {
    humanAttack(); human.attackResolved = false; human.atkCd = 0.5;
  }
}
function needTypeSafe(task) {
  // тип ресурса, который даёт узел задачи
  return task.node.type === "tree" ? "wood" : task.node.type === "rock" ? "stone" : "food";
}

/* ---------------- ЗОМБИ ИИ ---------------- */
function updateZombies(dt, isNight, nf) {
  // спавн волны
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

    // рассвет выжигает зомби
    if (!isNight && nf < 0.5) {
      z.hp -= 34 * dt;
      if (Math.random() < 0.3) spawnParts(z.x, z.y - 8, 1, "#ff9e5c", { sp: 40, g: -60, decay: 2.2 });
      if (z.hp <= 0) { killZombie(z); continue; }
    }

    // выбор цели
    const dH = dist(z.x, z.y, human.x, human.y);
    const dB = dist(z.x, z.y, BASE.x, BASE.y);
    let tx, ty, targetHuman;
    if (dH < 260 || dH < dB) { tx = human.x; ty = human.y; targetHuman = true; }
    else { tx = BASE.x; ty = BASE.y; targetHuman = false; }

    const d = dist(z.x, z.y, tx, ty);
    const reach = targetHuman ? 30 : 44;
    if (d > reach) {
      // походка с пошатыванием
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

    // расталкивание зомби
    for (let j = i + 1; j < zombies.length; j++) {
      const o = zombies[j];
      const dd = dist(z.x, z.y, o.x, o.y);
      if (dd < 24 && dd > 0.01) {
        const push = (24 - dd) / 2;
        const a = Math.atan2(o.y - z.y, o.x - z.x);
        z.x -= Math.cos(a) * push * dt * 8; z.y -= Math.sin(a) * push * dt * 8;
        o.x += Math.cos(a) * push * dt * 8; o.y += Math.sin(a) * push * dt * 8;
      }
    }
  }

  // рычание
  if (zombies.length > 0) {
    growlCd -= dt;
    if (growlCd <= 0) { sfx.growl(); growlCd = 2.5 + Math.random() * 4; }
  }
}

/* ---------------- ВВОД ---------------- */
const keys = {};
let hurtFlash = 0, houseShake = 0;
let speedMult = 1, paused = false;
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
  const wx = e.clientX + camX, wy = e.clientY + camY;
  human.moveGoal = { x: clamp(wx, 30, W - 30), y: clamp(wy, 30, H - 30), ttl: 6 };
  spawnParts(wx, wy, 6, "#ffe08a", { sp: 60, decay: 2.4 });
});

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
  const partsArr = [];
  if (c.wood) partsArr.push("🪵" + c.wood);
  if (c.stone) partsArr.push("🪨" + c.stone);
  return partsArr.join(" ");
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
  if (human.buildKind && human.buildKind !== "repair") { human.buildKind = null; human.pendingUpgrade = null; }
}
for (const id of ["house", "weapon", "bag"]) {
  $(`prio-${id}`).addEventListener("click", () => setPrio(id));
}
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

/* ---------------- ИГРА ОКОНЧЕНА ---------------- */
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

/* ---------------- ВРЕМЯ СУТОК ---------------- */
let cycleT = 0.08;   // начинаем утром
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

/* ---------------- КАМЕРА ---------------- */
let camX = 0, camY = 0;
function updateCamera(dt) {
  const tx = clamp(human.x + Math.cos(human.dir) * 30 - VW / 2, -200, Math.max(W - VW + 200, -200));
  const ty = clamp(human.y + Math.sin(human.dir) * 30 - VH / 2, -200, Math.max(H - VH + 200, -200));
  const k = 1 - Math.exp(-5 * dt);
  camX = lerp(camX, tx, k);
  camY = lerp(camY, ty, k);
}

/* ---------------- РИСОВАНИЕ ---------------- */
const w2sx = x => x - camX;
const w2sy = y => y - camY;

function drawGround() {
  ctx.fillStyle = "#4a7c3a";
  ctx.fillRect(0, 0, VW, VH);
  // пятна травы (статичные по сетке)
  const CS = 180;
  const gx0 = Math.floor(camX / CS), gy0 = Math.floor(camY / CS);
  for (let gy = gy0; gy <= (camY + VH) / CS + 1; gy++) {
    for (let gx = gx0; gx <= (camX + VW) / CS + 1; gx++) {
      const h1 = hash(gx * 3 + gy * 17);
      if (h1 < 0.55) continue;
      const px = gx * CS + hash(gx + gy * 5) * 120;
      const py = gy * CS + hash(gx * 7 + gy) * 120;
      ctx.fillStyle = h1 > 0.8 ? "rgba(94,144,66,0.5)" : "rgba(64,110,50,0.45)";
      ctx.beginPath();
      ctx.ellipse(w2sx(px), w2sy(py), 40 + h1 * 46, 26 + h1 * 30, h1 * 3, 0, 7);
      ctx.fill();
    }
  }
  // граница мира
  ctx.strokeStyle = "rgba(30,50,25,0.8)";
  ctx.lineWidth = 6;
  ctx.strokeRect(w2sx(0), w2sy(0), W, H);
  // двор дома — утоптанная земля
  const bx = w2sx(BASE.x), by = w2sy(BASE.y);
  ctx.fillStyle = "rgba(120,90,55,0.35)";
  ctx.beginPath(); ctx.ellipse(bx, by, HOME_R + 26, HOME_R + 8, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(140,105,62,0.4)";
  ctx.beginPath(); ctx.ellipse(bx, by, HOME_R - 14, HOME_R - 26, 0, 0, 7); ctx.fill();
}

function drawStains() {
  for (const s of stains) {
    ctx.globalAlpha = clamp(s.life, 0, 1) * 0.8;
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.ellipse(w2sx(s.x), w2sy(s.y), s.r, s.r * 0.7, 0, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawNode(n, t) {
  const x = w2sx(n.x) + Math.sin(t * 40) * n.shake * 4;
  const y = w2sy(n.y);
  const s = n.scale * clamp(n.grow / 4, 0.15, 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(3, 4, 16 * s, 7 * s, 0, 0, 7); ctx.fill();
  if (n.dead) {
    // пнёк
    ctx.fillStyle = n.type === "tree" ? "#7a4f2a" : "#6e7686";
    ctx.beginPath(); ctx.ellipse(0, 0, n.type === "tree" ? 8 : 13, n.type === "tree" ? 5 : 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = n.type === "tree" ? "#a3703f" : "#8b93a3";
    ctx.beginPath(); ctx.ellipse(0, -2, n.type === "tree" ? 6 : 10, n.type === "tree" ? 4 : 6, 0, 0, 7); ctx.fill();
    ctx.restore();
    return;
  }
  if (n.type === "tree") {
    ctx.fillStyle = "#5f3c1e";
    ctx.beginPath(); ctx.arc(0, 0, 6 * s, 0, 7); ctx.fill();
    const sway = Math.sin(t * 0.9 + n.seed * 9) * 1.5;
    ctx.fillStyle = "#2f6b33";
    ctx.beginPath(); ctx.arc(sway, -2, 22 * s, 0, 7); ctx.fill();
    ctx.fillStyle = "#3f8b44";
    ctx.beginPath(); ctx.arc(sway - 6 * s, -7 * s, 15 * s, 0, 7); ctx.arc(sway + 8 * s, 4 * s, 13 * s, 0, 7); ctx.fill();
    ctx.fillStyle = "#4e9b4e";
    ctx.beginPath(); ctx.arc(sway + 2 * s, -10 * s, 10 * s, 0, 7); ctx.fill();
  } else if (n.type === "rock") {
    ctx.beginPath();
    const pts = 7;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2 + n.seed * 3;
      const r = (14 + hash(n.id * 31 + i) * 7) * s;
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.8;
      if (i === 0) ctx.moveTo(px, py - 2); else ctx.lineTo(px, py - 2);
    }
    ctx.closePath();
    ctx.fillStyle = "#8b93a3"; ctx.fill();
    ctx.fillStyle = "#6e7686";
    ctx.beginPath(); ctx.ellipse(-4 * s, 2 * s, 7 * s, 5 * s, 0.4, 0, 7); ctx.fill();
  } else {
    // куст с ягодами
    ctx.fillStyle = "#2f6b33";
    ctx.beginPath(); ctx.arc(0, -2, 13 * s, 0, 7); ctx.fill();
    ctx.fillStyle = "#3f8b44";
    ctx.beginPath(); ctx.arc(-5 * s, -6 * s, 8 * s, 0, 7); ctx.arc(6 * s, -3 * s, 7 * s, 0, 7); ctx.fill();
    if (n.hp > 0) {
      ctx.fillStyle = "#e0524d";
      const berries = 4;
      for (let i = 0; i < berries; i++) {
        const a = (i / berries) * Math.PI * 2 + n.seed * 6;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 7 * s, -3 + Math.sin(a) * 5 * s, 2.4, 0, 7); ctx.fill();
      }
    }
  }
  if (n.flash > 0.02) {
    ctx.globalAlpha = n.flash * 0.5;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, -4, 18 * s, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawHouse(t) {
  const x = w2sx(BASE.x) + (Math.random() - 0.5) * houseShake * 6;
  const y = w2sy(BASE.y) + (Math.random() - 0.5) * houseShake * 6;
  const l = lv.house;
  ctx.save();
  ctx.translate(x, y);

  // ограда по уровню
  if (l >= 3) {
    const posts = l >= 4 ? 26 : 18;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2 + 0.15;
      const r = l >= 4 ? 96 : 84;
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.92;
      ctx.fillStyle = l >= 4 ? "#7d8494" : "#7a4f2a";
      ctx.beginPath(); ctx.arc(px, py, l >= 4 ? 5 : 4, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath(); ctx.arc(px + 2, py + 2, 2.4, 0, 7); ctx.fill();
    }
  }
  // башни цитадели
  if (l >= 5) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const px = Math.cos(a) * 96, py = Math.sin(a) * 88;
      ctx.fillStyle = "#8b93a3";
      ctx.beginPath(); ctx.arc(px, py, 10, 0, 7); ctx.fill();
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath(); ctx.arc(px, py - 4, 3, 0, 7); ctx.fill();
    }
  }

  // костёр (всегда)
  const fl = Math.sin(t * 10) * 1.6;
  ctx.fillStyle = "#6f4826";
  ctx.save(); ctx.translate(26, 30); ctx.rotate(0.5); ctx.fillRect(-10, -3, 20, 5); ctx.rotate(-1); ctx.fillRect(-10, -3, 20, 5); ctx.restore();
  ctx.fillStyle = "rgba(255,122,42,0.9)";
  ctx.beginPath(); ctx.ellipse(26, 24 + fl * 0.4, 8, 11 + fl, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath(); ctx.ellipse(26, 26, 3.4, 5.4, 0, 0, 7); ctx.fill();
  if (Math.random() < 0.06) parts.push({ x: BASE.x + 26, y: BASE.y + 20, vx: (Math.random() - 0.5) * 10, vy: -24, g: -12, life: 1, decay: 0.6, size: 3, color: "rgba(150,150,160,0.4)" });

  // жильё
  if (l === 1) {
    // шалаш-навес
    ctx.fillStyle = "#8a5a30";
    ctx.beginPath(); ctx.moveTo(-40, 6); ctx.lineTo(-12, -34); ctx.lineTo(16, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#754b27";
    ctx.beginPath(); ctx.moveTo(-30, 6); ctx.lineTo(-12, -22); ctx.lineTo(6, 6); ctx.closePath(); ctx.fill();
  } else {
    // хижина/дом сверху: сруб
    const hs = 26 + l * 4;
    ctx.fillStyle = "#8a5a30";
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-hs, -hs * 0.8, hs * 2, hs * 1.6, 8) : ctx.rect(-hs, -hs * 0.8, hs * 2, hs * 1.6); ctx.fill();
    ctx.strokeStyle = "#5f3c1e";
    ctx.lineWidth = 3;
    for (let i = -hs + 10; i < hs; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, -hs * 0.8 + 3); ctx.lineTo(i, hs * 0.8 - 3); ctx.stroke();
    }
    // конёк крыши
    ctx.strokeStyle = "#c8b08a";
    ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-hs * 0.75, 0); ctx.lineTo(hs * 0.75, 0); ctx.stroke();
    if (l >= 4) {
      ctx.fillStyle = "#7d8494";
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-hs - 6, -hs * 0.8 - 6, hs * 2 + 12, hs * 1.6 + 12, 10) : ctx.rect(-hs - 6, -hs * 0.8 - 6, hs * 2 + 12, hs * 1.6 + 12); ctx.fill();
      ctx.strokeStyle = "#5f6674"; ctx.lineWidth = 2;
      ctx.strokeRect(-hs - 6, -hs * 0.8 - 6, hs * 2 + 12, hs * 1.6 + 12);
    }
    // флажок
    ctx.strokeStyle = "#5f3c1e"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hs * 0.5, -hs * 0.8); ctx.lineTo(hs * 0.5, -hs * 0.8 - 16); ctx.stroke();
    ctx.fillStyle = l >= 4 ? "#ffd76e" : "#e0524d";
    ctx.beginPath(); ctx.moveTo(hs * 0.5, -hs * 0.8 - 16); ctx.lineTo(hs * 0.5 + 12, -hs * 0.8 - 12); ctx.lineTo(hs * 0.5, -hs * 0.8 - 8); ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // полоса HP дома
  if (house.hp < house.maxHp) {
    drawBar(w2sx(BASE.x), w2sy(BASE.y) - (lv.house === 1 ? 52 : lv.house * 4 + 46), 64, house.hp / house.maxHp, "#7ec96d");
  }
}

function drawBar(sx, sy, w, frac, color) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 6);
  ctx.fillStyle = color;
  ctx.fillRect(sx - w / 2, sy, w * clamp(frac, 0, 1), 4);
}

function drawWeapon(sx, sy, dir, ang, lvl) {
  // ang — угол оружия относительно dir
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(dir + ang);
  const a2 = ang;
  ctx.rotate(0);
  if (lvl === 1) {
    // дубина
    ctx.fillStyle = "#8a5a30";
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(8, -2.4, 24, 4.8, 2.4) : ctx.rect(8, -2.4, 24, 4.8); ctx.fill();
    ctx.fillStyle = "#a3703f";
    ctx.beginPath(); ctx.arc(32, 0, 4.6, 0, 7); ctx.fill();
  } else if (lvl === 2) {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(8, -1.8, 24, 3.6);
    ctx.fillStyle = "#9aa3b2";
    ctx.beginPath(); ctx.moveTo(28, -8); ctx.lineTo(37, -6); ctx.lineTo(36, 6); ctx.lineTo(28, 8); ctx.closePath(); ctx.fill();
  } else if (lvl === 3) {
    ctx.fillStyle = "#8a5a30"; ctx.fillRect(6, -1.4, 34, 2.8);
    ctx.fillStyle = "#c8d0dc";
    ctx.beginPath(); ctx.moveTo(40, -3); ctx.lineTo(48, 0); ctx.lineTo(40, 3); ctx.closePath(); ctx.fill();
  } else if (lvl === 4) {
    ctx.fillStyle = "#6e5236"; ctx.fillRect(8, -2, 22, 4);
    ctx.fillStyle = "#8b93a3";
    ctx.beginPath(); ctx.arc(32, 0, 7.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#6e7686";
    ctx.beginPath(); ctx.arc(30.4, -1.6, 5, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = "#5f3c1e"; ctx.fillRect(6, -2.2, 30, 4.4);
    ctx.fillStyle = "#c8d0dc";
    ctx.beginPath(); ctx.moveTo(32, -11); ctx.lineTo(44, -7); ctx.lineTo(43, 7); ctx.lineTo(32, 11); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawHuman(t) {
  const x = w2sx(human.x), y = w2sy(human.y);
  const L = human.look;
  const moving = human.ph !== 0 && !human.combatStale;
  const swing = Math.sin(human.ph);
  ctx.save();
  ctx.translate(x, y);

  // тень
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(2, 4, 13, 8, 0, 0, 7); ctx.fill();

  ctx.rotate(human.dir);

  // ступни
  ctx.fillStyle = "#5d4430";
  ctx.beginPath(); ctx.ellipse(1 + swing * 4.5, -5.5, 3.4, 2.6, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(1 - swing * 4.5, 5.5, 3.4, 2.6, 0, 0, 7); ctx.fill();

  // левая рука (в боку, качается)
  const lA = swing * 0.5;
  ctx.fillStyle = L.skin;
  ctx.beginPath(); ctx.arc(2 - lA * 3, -10.5, 3.4, 0, 7); ctx.fill();

  // тело (шкура)
  ctx.fillStyle = L.fur;
  ctx.beginPath(); ctx.arc(0, 0, 10.4, 0, 7); ctx.fill();
  ctx.fillStyle = L.furDark;
  ctx.beginPath(); ctx.arc(-3, 0, 8.6, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
  // пояс
  ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(0, 0, 9.4, -0.5, 0.5); ctx.stroke();

  // голова
  ctx.fillStyle = L.skin;
  ctx.beginPath(); ctx.arc(3, 0, 7.4, 0, 7); ctx.fill();
  // волосы (сзади головы)
  ctx.fillStyle = L.hair;
  ctx.beginPath(); ctx.arc(3, 0, 7.4, Math.PI * 0.42, Math.PI * 1.58); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.4, 0, 3.4, 6.6, 0, 0, 7); ctx.fill();
  // повязка
  ctx.strokeStyle = "#c0563e"; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(3, 0, 7.1, -Math.PI * 0.32, Math.PI * 0.32); ctx.stroke();
  // нос
  ctx.fillStyle = L.skinDark;
  ctx.beginPath(); ctx.arc(10.2, 0, 1.7, 0, 7); ctx.fill();

  // правая рука + оружие
  if (human.attackT < 1) {
    // замах: от -1.6 до +1.5
    const k = human.attackT;
    const e = k < 0.35 ? -(k / 0.35) * 0.9 : k < 0.55 ? lerp(-0.9, 1.5, ((k - 0.35) / 0.2) ** 2) : lerp(1.5, 0, smooth((k - 0.55) / 0.45));
    const ang = -0.55 + e;
    ctx.fillStyle = L.skin;
    ctx.beginPath(); ctx.arc(Math.cos(ang) * 11, Math.sin(ang) * 11 + 2, 3.4, 0, 7); ctx.fill();
    drawWeapon(Math.cos(ang) * 11, Math.sin(ang) * 11 + 2, 0, ang, lv.weapon);
  } else {
    const ang = 0.5 + swing * 0.25;
    ctx.fillStyle = L.skin;
    ctx.beginPath(); ctx.arc(Math.cos(ang) * 11, Math.sin(ang) * 11 + 2, 3.4, 0, 7); ctx.fill();
    drawWeapon(Math.cos(ang) * 11, Math.sin(ang) * 11 + 2, 0, ang, lv.weapon);
  }

  // еда: crumbs
  if (human.eatT > 0) {
    ctx.fillStyle = "#e0524d";
    ctx.beginPath(); ctx.arc(9, -3, 1.6, 0, 7); ctx.fill();
  }
  ctx.restore();

  // полоса HP
  if (human.hp < human.maxHp) drawBar(x, y - 26, 34, human.hp / human.maxHp, "#ff8a6a");
}

function drawZombie(z) {
  const x = w2sx(z.x), y = w2sy(z.y);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(2, 4, 12, 7.4, 0, 0, 7); ctx.fill();
  ctx.rotate(z.dir);
  const lurch = Math.sin(z.lurch * 3.1);
  // ступни шаркают
  ctx.fillStyle = "#3a4d2a";
  ctx.beginPath(); ctx.ellipse(1 + lurch * 3, -5, 3, 2.4, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(1 - lurch * 3, 5, 3, 2.4, 0, 0, 7); ctx.fill();
  // вытянутые руки вперёд
  const reach = z.attackT < 1 ? 4 + (1 - z.attackT) * 6 : 0;
  ctx.fillStyle = z.g1;
  ctx.beginPath(); ctx.arc(11 + reach + lurch * 1.4, -6.6, 3.2, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(11 + reach - lurch * 1.4, 6.6, 3.2, 0, 7); ctx.fill();
  // тело
  ctx.fillStyle = z.g2;
  ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath(); ctx.arc(-3, 0, 8, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
  // рваная одежда — пятна
  ctx.fillStyle = "rgba(60,70,50,0.5)";
  ctx.beginPath(); ctx.arc(2, -4, 3, 0, 7); ctx.arc(-1, 3, 2.6, 0, 7); ctx.fill();
  // голова
  ctx.fillStyle = z.g1;
  ctx.beginPath(); ctx.arc(3.4, 0, 7, 0, 7); ctx.fill();
  // клоки волос
  ctx.fillStyle = "#26301c";
  ctx.beginPath(); ctx.arc(1, -3, 2.4, 0, 7); ctx.arc(0.4, 2.6, 2, 0, 7); ctx.arc(2.4, 0.4, 2, 0, 7); ctx.fill();
  // глаза
  const eg = z.attackT < 1 ? "#ff3b30" : "#e0472e";
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.arc(7.6, -2.6, 1.5, 0, 7); ctx.arc(7.6, 2.6, 1.5, 0, 7); ctx.fill();
  if (z.flash > 0.02) {
    ctx.globalAlpha = z.flash * 0.6;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  drawBar(x, y - 24, 30, z.hp / z.maxHp, "#8fce6a");
}

function drawCorpses() {
  for (const c of corpses) {
    ctx.save();
    ctx.translate(w2sx(c.x), w2sy(c.y));
    ctx.globalAlpha = clamp(c.life, 0, 1) * 0.9;
    ctx.rotate(c.dir + 0.8);
    ctx.fillStyle = c.skin;
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath(); ctx.ellipse(-6, 0, 5, 4, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFx() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(w2sx(p.x) - p.size / 2, w2sy(p.y) - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  for (const f of texts) {
    const sz = f.big ? 17 : 13;
    ctx.font = `bold ${sz}px system-ui`;
    ctx.globalAlpha = clamp(f.life * 1.3, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(f.txt, w2sx(f.x) + 1, w2sy(f.y) + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, w2sx(f.x), w2sy(f.y));
  }
  ctx.globalAlpha = 1;
}

function drawMoveMarker() {
  if (!human.moveGoal) return;
  const m = human.moveGoal;
  const a = clamp(m.ttl / 6, 0, 1);
  const r = 12 + Math.sin(elapsed * 7) * 3;
  ctx.strokeStyle = `rgba(255,224,138,${0.85 * a})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(w2sx(m.x), w2sy(m.y), r, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(w2sx(m.x), w2sy(m.y), 3, 0, 7); ctx.fillStyle = `rgba(255,224,138,${a})`; ctx.fill();
}

function drawDarkness(nf, t) {
  if (nf < 0.02) return;
  dkx.clearRect(0, 0, VW, VH);
  dkx.fillStyle = `rgba(5,8,20,${0.84 * nf})`;
  dkx.fillRect(0, 0, VW, VH);
  dkx.globalCompositeOperation = "destination-out";
  const punch = (wx, wy, r, str) => {
    const x = w2sx(wx), y = w2sy(wy);
    if (x < -r || x > VW + r || y < -r || y > VH + r) return;
    const g = dkx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${str})`);
    g.addColorStop(0.6, `rgba(0,0,0,${str * 0.5})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    dkx.fillStyle = g;
    dkx.beginPath(); dkx.arc(x, y, r, 0, 7); dkx.fill();
  };
  punch(BASE.x, BASE.y, 290 + Math.sin(t * 8) * 16, 0.97);   // костёр
  punch(human.x, human.y, 130, 0.75);                        // человек
  ctx.drawImage(dk, 0, 0, VW, VH);
  // тёплое свечение костра
  const bx = w2sx(BASE.x), by = w2sy(BASE.y);
  const g = ctx.createRadialGradient(bx, by, 0, bx, by, 110);
  g.addColorStop(0, `rgba(255,150,50,${0.25 * nf})`);
  g.addColorStop(1, "rgba(255,150,50,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(bx, by, 110, 0, 7); ctx.fill();
}

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
  // дом
  mx.fillStyle = "#ffd76e";
  mx.fillRect(BASE.x * kx - 3, BASE.y * ky - 3, 6, 6);
  // зомби
  mx.fillStyle = "#ff5a4d";
  for (const z of zombies) mx.fillRect(z.x * kx - 1.4, z.y * ky - 1.4, 2.8, 2.8);
  // человек
  mx.fillStyle = "#ffffff";
  mx.fillRect(human.x * kx - 2, human.y * ky - 2, 4, 4);
  // рамка обзора
  mx.strokeStyle = "rgba(255,255,255,0.35)";
  mx.lineWidth = 1;
  mx.strokeRect(camX * kx, camY * ky, VW * kx, VH * ky);
}

/* ---------------- ВНЕШНОСТЬ ---------------- */
function genLook() {
  const skins = ["#f0c090", "#e0a878", "#c88a5a", "#a06a42", "#8a5432"];
  const hairs = ["#2a1c10", "#4a2f18", "#151310", "#6b4423", "#8a6a3a"];
  const furs = ["#8a5a30", "#7a4f2a", "#96683c", "#6e4526", "#a0713f"];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const skin = pick(skins);
  return {
    skin, hair: pick(hairs), fur: pick(furs),
    skinDark: skin,
  };
}

/* ---------------- СТАРТ / ЦИКЛ ---------------- */
let last = performance.now();
let msShown = { wood: false, night: false, wave1: false };

function updateHUDTime() {
  $("dayLabel").textContent = "День " + dayN + " · Волна " + Math.max(wave + (isNightNow() ? 0 : 1), 1);
  const t = cycleT;
  $("timefill").style.width = (t * 100).toFixed(1) + "%";
  if (!isNightNow()) {
    const sec = Math.ceil((NIGHT_AT - t) * DAY_LEN);
    $("phaseLabel").textContent = "☀️ До ночи: " + sec + "с";
  } else {
    const sec = Math.ceil((1 - t) * DAY_LEN);
    $("phaseLabel").textContent = "🌙 Зомби: " + zombies.length + " · До рассвета: " + sec + "с";
  }
  $("hpfill").style.width = clamp(human.hp / human.maxHp * 100, 0, 100) + "%";
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (paused || gameOverFlag) {
    if (gameOverFlag) rendererPausedStill();
    return;
  }
  dt *= speedMult;
  elapsed += dt;

  // время суток
  const wasNight = isNightNow();
  cycleT += dt / DAY_LEN;
  if (cycleT >= 1) {
    cycleT -= 1;
    dayN++;
    wave = Math.max(wave, 1); // прошедшей ночью была волна
    toast("🌅 День " + dayN + ". Успейте подготовиться!", 2800);
    sfx.dawn();
    refreshHUD();
  }
  const isNight = isNightNow();
  if (isNight && !wasNight) {
    // наступила ночь — запускаем волну
    wave++;
    toSpawn = waveCount(wave);
    spawnCd = 1.5;
    toast("🌙 Ночь " + (dayN - 1) + "! Волна " + wave + " — " + toSpawn + " зомби идут к дому!", 4200);
    sfx.horn();
  }
  const nf = nightFactorCalc();

  // затухание трясок/вспышек
  hurtFlash *= Math.exp(-3 * dt);
  houseShake *= Math.exp(-5 * dt);
  for (const n of nodes) { n.shake *= Math.exp(-6 * dt); n.flash *= Math.exp(-8 * dt); }

  // рост/возрождение ресурсов
  for (const n of nodes) {
    if (n.dead) {
      n.respawn += dt;
      if (n.respawn > nodeRespawnTime(n.type)) { n.dead = false; n.hp = n.maxHp; n.grow = 0; }
    } else if (n.grow < 4) n.grow += dt;
  }

  // регенерация у дома днём
  if (!isNight && dist(human.x, human.y, BASE.x, BASE.y) < HOME_R && human.hp < human.maxHp) {
    human.hp = Math.min(human.maxHp, human.hp + 1.6 * dt);
  }

  updateHuman(dt, isNight, nf);
  updateZombies(dt, isNight, nf);
  updateFx(dt);
  updateCamera(dt);

  // ---- рендер ----
  drawGround();
  drawStains();
  // сортировка по y для псевдоглубины
  const drawables = [];
  for (const n of nodes) drawables.push({ y: n.y, f: () => drawNode(n, elapsed) });
  drawables.push({ y: BASE.y, f: () => drawHouse(elapsed) });
  drawables.push({ y: human.y, f: () => drawHuman(elapsed) });
  for (const z of zombies) drawables.push({ y: z.y, f: () => drawZombie(z) });
  drawables.sort((a, b) => a.y - b.y);
  drawCorpses();
  for (const d of drawables) d.f();
  drawMoveMarker();
  drawFx();
  drawDarkness(nf, elapsed);
  drawMiniMap();

  // красная вспышка урона
  if (hurtFlash > 0.02) {
    ctx.fillStyle = `rgba(200,30,20,${hurtFlash * 0.25})`;
    ctx.fillRect(0, 0, VW, VH);
  }

  updateHUDTime();

  // подсказки по ходу
  if (!msShown.wood && inv.wood >= 20) { msShown.wood = true; toast("🪐 Ресурсов хватает — человек сам построит улучшение у дома"); }
  if (!msShown.wave1 && wave >= 1 && !isNight) { msShown.wave1 = true; }
}

function rendererPausedStill() {
  // при паузе просто держим последний кадр (ничего не перерисовываем)
}

/* ---------------- GO ---------------- */
human.look = genLook();
genWorld();
camX = clamp(human.x - VW / 2, -200, W - VW + 200);
camY = clamp(human.y - VH / 2, -200, H - VH + 200);
refreshHUD();
toast("🪓 Колонист всё делает сам: добирает ресурсы, носит их домой, строит и улучшает дом. ЛКМ — послать его в точку, 1/2/3 — приоритет улучшений. Ночью придёт первая волна!", 6500);
requestAnimationFrame(frame);
