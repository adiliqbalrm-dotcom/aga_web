const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const WORLD_SIZE = 7000;
const HALF_WORLD = WORLD_SIZE / 2;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 12;
const FOOD_COUNT = 800;
const VIRUS_COUNT = 7;
const TARGET_PLAYER_COUNT = 6;
const START_RADIUS = Math.sqrt(1000); // visible mass ~= 10
const START_NET_WORTH = 5;
const MAX_CELLS = 12;
const RESET_SECONDS = 10 * 60;
const CASHOUT_SECONDS = 10;
const CASHOUT_LOCK_SECONDS = 5;

// Tunables for smoother, slightly slower motion.
const PLAYER_SPEED_BASE = 310;
const PLAYER_SPEED_MIN = 34;
const PLAYER_STEER_RATE = 9.0;
const BOT_STEER_RATE = 6.6;
const BOT_TARGET_BLEND = 0.30;
const SPLIT_BOOST_SPEED = 565;
const EJECT_PELLET_SPEED = 410;
const VIRUS_POP_SPEED = 455;

const WS_OPEN = 1;
const WS_CLOSED = 3;

class MiniWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.readyState = WS_OPEN;
    this.buffer = Buffer.alloc(0);
    this.handlers = { message: [], close: [], error: [] };

    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => this.closeFromSocket());
    socket.on('end', () => this.closeFromSocket());
    socket.on('error', (err) => {
      this.emit('error', err);
      this.closeFromSocket();
    });
  }

  on(event, handler) {
    if (this.handlers[event]) this.handlers[event].push(handler);
  }

  emit(event, arg) {
    for (const handler of this.handlers[event] || []) {
      try { handler(arg); } catch (_) {}
    }
  }

  send(data) {
    if (this.readyState !== WS_OPEN) return;
    const payload = Buffer.from(String(data));
    const header = this.makeHeader(0x1, payload.length);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close() {
    if (this.readyState !== WS_OPEN) return;
    this.readyState = WS_CLOSED;
    try {
      this.socket.write(Buffer.from([0x88, 0x00]));
      this.socket.end();
    } catch (_) {}
    this.emit('close');
  }

  closeFromSocket() {
    if (this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSED;
    this.emit('close');
  }

  makeHeader(opcode, length) {
    if (length < 126) {
      return Buffer.from([0x80 | opcode, length]);
    }
    if (length <= 0xffff) {
      const h = Buffer.alloc(4);
      h[0] = 0x80 | opcode;
      h[1] = 126;
      h.writeUInt16BE(length, 2);
      return h;
    }
    const h = Buffer.alloc(10);
    h[0] = 0x80 | opcode;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(length), 2);
    return h;
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const big = this.buffer.readBigUInt64BE(offset);
        if (big > BigInt(10 * 1024 * 1024)) {
          this.close();
          return;
        }
        length = Number(big);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) return;

      let mask;
      if (masked) {
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      const payload = Buffer.from(this.buffer.slice(offset, offset + length));
      this.buffer = this.buffer.slice(offset + length);

      if (masked) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }

      if (opcode === 0x8) {
        this.close();
        return;
      }
      if (opcode === 0x9) {
        const pongHeader = this.makeHeader(0xA, payload.length);
        this.socket.write(Buffer.concat([pongHeader, payload]));
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        this.emit('message', payload);
      }
    }
  }
}

function websocketAcceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function upgradeToWebSocket(req, socket, head, onConnection) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (!key || upgrade !== 'websocket') {
    socket.destroy();
    return;
  }
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
    '',
    ''
  ].join('\r\n'));
  const ws = new MiniWebSocket(socket);
  onConnection(ws);
  if (head && head.length) ws.handleData(head);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const COLORS = [
  '#ff2d1a', '#18e90b', '#0b7cff', '#ffe000', '#ff1493', '#00d4ff', '#ff7f12',
  '#baff00', '#7cf000', '#ff6700', '#2cecff', '#ff3da0', '#7e5cff', '#00e676'
];
const BOT_NAMES = ['glitchdad', 'OrbitFox', 'ByteRunner', 'caughtinlag', 'sidequestleo', 'Noodle', 'Z4Z4', 'a4tryl', 'MoonCell'];
const AVAILABLE_SKINS = [
  'eye', 'cake', 'panther', 'rider', 'blue_player', 'football_a', 'party_player',
  'fire_player', 'basket_player', 'suit_player', 'football_b', 'flag_suit', 'flame_player',
  'meme_dog', 'bat', 'dino_skull', 'fly', 'alien', 'angler', 'purple_dino', 'red_dino'
];

let nextId = 1;
let botSpawnIndex = 0;
let resetTimer = RESET_SECONDS;
let timerRunning = false;
let lastTick = Date.now();

const players = new Map();
const sockets = new Map();
const food = [];
const viruses = [];
const activity = [];
const chat = [];

function random(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(random(min, max + 1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distance(a, b) {
  return Math.sqrt(distSq(a, b));
}

function color() {
  return COLORS[randInt(0, COLORS.length - 1)];
}

function createId() {
  return nextId++;
}

function spawnPoint(margin = 300) {
  return {
    x: random(-HALF_WORLD + margin, HALF_WORLD - margin),
    y: random(-HALF_WORLD + margin, HALF_WORLD - margin)
  };
}

function safeName(name) {
  const cleaned = String(name || 'Player')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return cleaned || 'Player';
}

function massFromRadius(r) {
  return (r * r) / 100;
}

function radiusFromMass(m) {
  return Math.sqrt(Math.max(1, m) * 100);
}

function totalMass(player) {
  return player.cells.reduce((sum, cell) => sum + massFromRadius(cell.r), 0);
}

function netWorth(player) {
  if (!player || !player.joined) return 0;
  if (!player.cells || player.cells.length === 0) return Number(player.money || 0);
  const sum = player.cells.reduce((total, cell) => total + Number(cell.value || 0), 0);
  player.money = sum;
  return sum;
}

function makeCell(owner, x, y, r, value = 0) {
  return {
    id: createId(),
    ownerId: owner.id,
    x,
    y,
    r,
    value: Math.max(0, Number(value || 0)),
    vx: 0,
    vy: 0,
    moveVx: 0,
    moveVy: 0,
    mergeAt: Date.now() + 8000,
    dead: false
  };
}

function makeFood(kind = 'food') {
  const p = spawnPoint(80);
  const isVirus = kind === 'virus';
  return {
    id: createId(),
    x: p.x,
    y: p.y,
    r: isVirus ? random(84, 98) : random(7, 16),
    color: isVirus ? '#70f000' : color(),
    kind,
    vx: 0,
    vy: 0,
    expiresAt: 0
  };
}

function refillFood() {
  while (food.length < FOOD_COUNT) food.push(makeFood('food'));
}

function seedViruses() {
  viruses.length = 0;
  while (viruses.length < VIRUS_COUNT) viruses.push(makeFood('virus'));
}

function createPlayer({ ws = null, name = 'Player', bot = false, skin = '' } = {}) {
  const id = createId();
  const player = {
    id,
    ws,
    bot,
    name: safeName(name),
    color: color(),
    skin: AVAILABLE_SKINS.includes(skin) ? skin : '',
    cells: [],
    target: spawnPoint(),
    alive: false,
    joined: false,
    joinedAt: Date.now(),
    kills: 0,
    money: START_NET_WORTH,
    lastSplit: 0,
    lastEject: 0,
    lastChat: 0,
    botNextThink: 0,
    cashout: {
      active: false,
      timer: 0,
      locked: false
    }
  };
  players.set(id, player);
  return player;
}

function botSpawnStats() {
  const roll = Math.random();
  let mass;
  if (roll < 0.35) mass = random(7, 13);       // small bots
  else if (roll < 0.78) mass = random(14, 28); // medium bots
  else mass = random(30, 62);                  // bigger target bots
  const value = Math.max(1.5, mass * random(0.34, 0.62));
  return { radius: radiusFromMass(mass), value: Number(value.toFixed(2)) };
}

function spawnPlayer(player) {
  const p = spawnPoint(500);
  if (player.bot && !player.skin) {
    player.skin = AVAILABLE_SKINS[botSpawnIndex++ % AVAILABLE_SKINS.length];
  }
  const stats = player.bot ? botSpawnStats() : { radius: START_RADIUS, value: START_NET_WORTH };
  player.cells = [makeCell(player, p.x, p.y, stats.radius, stats.value)];
  player.target = { x: p.x + random(-500, 500), y: p.y + random(-500, 500) };
  player.alive = true;
  player.joined = true;
  player.kills = 0;
  player.money = stats.value;
  player.cashout = { active: false, timer: 0, locked: false };
  player.joinedAt = Date.now();
  send(player, { type: 'spawned', id: player.id, world: { size: WORLD_SIZE } });
  pushActivity(`${player.name} joined the game`);
}

function removePlayer(player) {
  if (!player) return;
  players.delete(player.id);
  if (player.ws) sockets.delete(player.ws);
  balanceBots();
}

function pushActivity(message) {
  const item = { type: 'activity', message, time: Date.now() };
  activity.push(item);
  while (activity.length > 25) activity.shift();
  broadcastSmall(item);
}

function pushChat(player, message) {
  const item = {
    type: 'chat',
    name: player.name,
    color: player.color,
    message: String(message || '').slice(0, 180),
    time: Date.now()
  };
  chat.push(item);
  while (chat.length > 40) chat.shift();
  broadcastSmall(item);
}

function send(player, data) {
  if (!player || !player.ws || player.ws.readyState !== WS_OPEN) return;
  try {
    player.ws.send(JSON.stringify(data));
  } catch (_) {}
}

function broadcastSmall(data) {
  const payload = JSON.stringify(data);
  for (const player of players.values()) {
    if (player.ws && player.ws.readyState === WS_OPEN) {
      try { player.ws.send(payload); } catch (_) {}
    }
  }
}

function splitPlayer(player) {
  const now = Date.now();
  if (!player.alive || now - player.lastSplit < 350) return;
  player.lastSplit = now;
  const newCells = [];
  const angle = Math.atan2(player.target.y - avgY(player), player.target.x - avgX(player));
  for (const cell of player.cells) {
    if (player.cells.length + newCells.length >= MAX_CELLS) break;
    if (cell.r < 43) continue;
    const newR = cell.r / Math.SQRT2;
    const originalValue = Number(cell.value || 0);
    const childValue = originalValue * 0.5;
    cell.value = originalValue - childValue;
    cell.r = newR;
    cell.mergeAt = now + 9000;
    const child = makeCell(
      player,
      cell.x + Math.cos(angle) * newR * 1.5,
      cell.y + Math.sin(angle) * newR * 1.5,
      newR,
      childValue
    );
    child.vx = Math.cos(angle) * SPLIT_BOOST_SPEED;
    child.vy = Math.sin(angle) * SPLIT_BOOST_SPEED;
    child.mergeAt = now + 9000;
    newCells.push(child);
  }
  player.cells.push(...newCells);
  player.money = netWorth(player);
}

function ejectMass(player) {
  const now = Date.now();
  if (!player.alive || now - player.lastEject < 95) return;
  player.lastEject = now;
  for (const cell of player.cells) {
    if (cell.r < 30) continue;
    const angle = Math.atan2(player.target.y - cell.y, player.target.x - cell.x);
    const lostMass = 1.4;
    const newMass = Math.max(4, massFromRadius(cell.r) - lostMass);
    cell.r = radiusFromMass(newMass);
    const pellet = {
      id: createId(),
      x: cell.x + Math.cos(angle) * (cell.r + 22),
      y: cell.y + Math.sin(angle) * (cell.r + 22),
      r: 12,
      color: player.color,
      kind: 'ejected',
      vx: Math.cos(angle) * EJECT_PELLET_SPEED,
      vy: Math.sin(angle) * EJECT_PELLET_SPEED,
      expiresAt: Date.now() + 24000
    };
    food.push(pellet);
    break;
  }
}

function toggleCashout(player) {
  if (!player.alive || player.cells.length === 0) return;
  if (player.cashout.active && !player.cashout.locked) {
    player.cashout = { active: false, timer: 0, locked: false };
    return;
  }
  if (!player.cashout.active) {
    player.cashout = { active: true, timer: 0, locked: false };
    send(player, { type: 'system', message: 'Cashout started. Stay alive for 10 seconds.' });
  }
}

function avgX(player) {
  if (!player.cells.length) return 0;
  return player.cells.reduce((s, c) => s + c.x, 0) / player.cells.length;
}

function avgY(player) {
  if (!player.cells.length) return 0;
  return player.cells.reduce((s, c) => s + c.y, 0) / player.cells.length;
}

function blendBotTarget(player, desired, blend = BOT_TARGET_BLEND) {
  if (!desired) return;
  player.target = {
    x: clamp(player.target.x + (desired.x - player.target.x) * blend, -HALF_WORLD, HALF_WORLD),
    y: clamp(player.target.y + (desired.y - player.target.y) * blend, -HALF_WORLD, HALF_WORLD)
  };
}

function thinkBot(player) {
  const now = Date.now();
  if (now < player.botNextThink) return;
  // Bots now choose goals less abruptly and blend toward them to avoid twitchy paths.
  player.botNextThink = now + randInt(500, 1200);

  let best = null;
  let bestScore = Infinity;
  const cx = avgX(player);
  const cy = avgY(player);
  for (const f of food) {
    if (f.kind !== 'food') continue;
    const dx = f.x - cx;
    const dy = f.y - cy;
    const score = dx * dx + dy * dy;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }

  // Sometimes chase a smaller nearby player or run from a larger one.
  let danger = null;
  let prey = null;
  const myLargest = Math.max(...player.cells.map(c => c.r), START_RADIUS);
  for (const other of players.values()) {
    if (other === player || !other.alive) continue;
    for (const oc of other.cells) {
      const d = Math.hypot(oc.x - cx, oc.y - cy);
      if (d < 700 && oc.r > myLargest * 1.18) danger = oc;
      if (d < 900 && myLargest > oc.r * 1.22) prey = oc;
    }
  }

  let desiredTarget = null;
  let blend = BOT_TARGET_BLEND;
  if (danger) {
    desiredTarget = {
      x: clamp(cx - (danger.x - cx) * 2, -HALF_WORLD, HALF_WORLD),
      y: clamp(cy - (danger.y - cy) * 2, -HALF_WORLD, HALF_WORLD)
    };
    blend = 0.58;
  } else if (prey && Math.random() < 0.45) {
    desiredTarget = { x: prey.x, y: prey.y };
    if (myLargest > prey.r * 1.55 && player.cells.length < MAX_CELLS && Math.random() < 0.10) splitPlayer(player);
  } else if (best) {
    desiredTarget = { x: best.x, y: best.y };
  } else {
    desiredTarget = spawnPoint();
    blend = 0.22;
  }

  blendBotTarget(player, desiredTarget, blend);

  if (Math.random() < 0.010) splitPlayer(player);
}

function clampCellToWorld(cell) {
  const minX = -HALF_WORLD + cell.r;
  const maxX = HALF_WORLD - cell.r;
  const minY = -HALF_WORLD + cell.r;
  const maxY = HALF_WORLD - cell.r;

  if (cell.x < minX) {
    cell.x = minX;
    cell.vx = Math.max(0, cell.vx) * 0.22;
    cell.moveVx = Math.max(0, cell.moveVx || 0) * 0.22;
  } else if (cell.x > maxX) {
    cell.x = maxX;
    cell.vx = Math.min(0, cell.vx) * 0.22;
    cell.moveVx = Math.min(0, cell.moveVx || 0) * 0.22;
  }

  if (cell.y < minY) {
    cell.y = minY;
    cell.vy = Math.max(0, cell.vy) * 0.22;
    cell.moveVy = Math.max(0, cell.moveVy || 0) * 0.22;
  } else if (cell.y > maxY) {
    cell.y = maxY;
    cell.vy = Math.min(0, cell.vy) * 0.22;
    cell.moveVy = Math.min(0, cell.moveVy || 0) * 0.22;
  }
}

function moveCells(player, dt) {
  if (!player.alive) return;
  if (player.bot) thinkBot(player);

  for (const cell of player.cells) {
    const dx = player.target.x - cell.x;
    const dy = player.target.y - cell.y;
    const d = Math.hypot(dx, dy) || 1;
    const startMass = massFromRadius(START_RADIUS);
    const cellMass = Math.max(startMass, massFromRadius(cell.r));
    const massRatio = cellMass / startMass;
    const speed = Math.max(PLAYER_SPEED_MIN, PLAYER_SPEED_BASE / Math.pow(massRatio, 0.33));
    const desiredVx = (dx / d) * speed;
    const desiredVy = (dy / d) * speed;
    const steerRate = player.bot ? BOT_STEER_RATE : PLAYER_STEER_RATE;
    const steerEase = 1 - Math.exp(-steerRate * dt);

    cell.moveVx = (cell.moveVx || 0) + (desiredVx - (cell.moveVx || 0)) * steerEase;
    cell.moveVy = (cell.moveVy || 0) + (desiredVy - (cell.moveVy || 0)) * steerEase;

    cell.x += cell.moveVx * dt;
    cell.y += cell.moveVy * dt;
    cell.x += cell.vx * dt;
    cell.y += cell.vy * dt;
    cell.vx *= Math.pow(0.08, dt);
    cell.vy *= Math.pow(0.08, dt);
    clampCellToWorld(cell);
  }
}

function separateAndMergeOwnCells(player) {
  if (!player.alive || player.cells.length < 2) return;
  const now = Date.now();
  for (let i = 0; i < player.cells.length; i++) {
    for (let j = i + 1; j < player.cells.length; j++) {
      const a = player.cells[i];
      const b = player.cells[j];
      if (!a || !b || a.dead || b.dead) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const mergeable = now > a.mergeAt && now > b.mergeAt;
      const targetDistance = mergeable ? Math.max(a.r, b.r) * 0.32 : (a.r + b.r) * 0.82;

      if (mergeable && d < targetDistance) {
        a.r = Math.sqrt(a.r * a.r + b.r * b.r);
        a.value = Number(a.value || 0) + Number(b.value || 0);
        b.value = 0;
        b.dead = true;
      } else if (d < targetDistance) {
        const push = (targetDistance - d) * 0.48;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        clampCellToWorld(a);
        clampCellToWorld(b);
      }
    }
  }
  player.cells = player.cells.filter(c => !c.dead);
  player.money = netWorth(player);
}

function moveFood(dt) {
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    if (f.kind === 'ejected') {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vx *= Math.pow(0.10, dt);
      f.vy *= Math.pow(0.10, dt);
      f.x = clamp(f.x, -HALF_WORLD + f.r, HALF_WORLD - f.r);
      f.y = clamp(f.y, -HALF_WORLD + f.r, HALF_WORLD - f.r);
      if (f.expiresAt && f.expiresAt < Date.now()) food.splice(i, 1);
    }
  }
}

function eatFoodAndViruses(player) {
  if (!player.alive) return;
  for (const cell of player.cells) {
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i];
      const eatDistance = Math.max(cell.r - f.r * 0.2, cell.r * 0.65);
      if (distSq(cell, f) < eatDistance * eatDistance) {
        cell.r = Math.sqrt(cell.r * cell.r + f.r * f.r * 0.72);
        food.splice(i, 1);
      }
    }
    for (let i = viruses.length - 1; i >= 0; i--) {
      const virus = viruses[i];
      const popDistance = cell.r + virus.r * 0.48;
      if (cell.r > virus.r * 0.92 && distSq(cell, virus) < popDistance * popDistance) {
        popVirus(player, cell);
        viruses[i] = makeFood('virus');
      }
    }
  }
}

function popVirus(player, cell) {
  if (player.cells.length >= MAX_CELLS || cell.r < 70) return;
  const pieces = Math.min(MAX_CELLS - player.cells.length + 1, 6);
  const mass = massFromRadius(cell.r);
  const pieceMass = mass / pieces;
  const now = Date.now();

  // Virus hit: the player's total earnings are NOT lost.
  // The touched cell's value is divided across the new split cells, so each
  // small piece shows a smaller earning. If the owner later merges every piece
  // back together, the total value returns to exactly what it was before the hit.
  const beforeMoney = netWorth(player);
  const originalCellValue = Number(cell.value || 0);
  const pieceValue = originalCellValue / pieces;

  cell.r = radiusFromMass(pieceMass);
  cell.value = pieceValue;

  for (let i = 1; i < pieces; i++) {
    const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.3;
    const child = makeCell(
      player,
      cell.x + Math.cos(angle) * cell.r,
      cell.y + Math.sin(angle) * cell.r,
      radiusFromMass(pieceMass),
      pieceValue
    );
    child.vx = Math.cos(angle) * VIRUS_POP_SPEED;
    child.vy = Math.sin(angle) * VIRUS_POP_SPEED;
    child.mergeAt = now + 11000;
    player.cells.push(child);
  }

  // Correct any floating-point drift so total earnings stay equal to beforeMoney.
  const currentAfterSplit = player.cells.reduce((sum, c) => sum + Number(c.value || 0), 0);
  const drift = beforeMoney - currentAfterSplit;
  if (Math.abs(drift) > 0.000001) {
    cell.value = Math.max(0, Number(cell.value || 0) + drift);
  }

  cell.mergeAt = now + 11000;
  player.money = netWorth(player);
  if (!player.bot) {
    send(player, { type: 'system', message: `Virus hit! $${beforeMoney.toFixed(2)} was divided across your split cells. Merge all pieces to restore the full amount.` });
  }
}

function eatPlayers() {
  const allCells = [];
  for (const player of players.values()) {
    if (!player.alive) continue;
    for (const cell of player.cells) allCells.push({ player, cell });
  }

  for (let i = 0; i < allCells.length; i++) {
    const a = allCells[i];
    if (a.cell.dead) continue;
    for (let j = i + 1; j < allCells.length; j++) {
      const b = allCells[j];
      if (b.cell.dead || a.player === b.player) continue;
      tryEatCell(a, b);
      tryEatCell(b, a);
    }
  }

  for (const player of players.values()) {
    if (!player.alive) continue;
    const before = player.cells.length;
    player.cells = player.cells.filter(c => !c.dead);
    if (before > 0 && player.cells.length === 0) {
      eliminate(player, null);
    }
  }
}

function tryEatCell(bigRef, smallRef) {
  const big = bigRef.cell;
  const small = smallRef.cell;
  if (big.dead || small.dead) return;
  if (big.r < small.r * 1.13) return;
  const eatDistance = big.r - small.r * 0.32;
  if (eatDistance <= 0) return;
  const dx = small.x - big.x;
  const dy = small.y - big.y;
  if (dx * dx + dy * dy < eatDistance * eatDistance) {
    const victim = smallRef.player;
    const killer = bigRef.player;
    const reward = Number(small.value || 0);

    big.r = Math.sqrt(big.r * big.r + small.r * small.r * 0.84);
    big.value = Number(big.value || 0) + reward;
    small.value = 0;
    small.dead = true;

    const victimWillDie = victim.cells.every(c => c.dead || c === small);
    killer.money = netWorth(killer);
    victim.money = Math.max(0, victim.cells.reduce((total, c) => total + (c.dead ? 0 : Number(c.value || 0)), 0));

    if (reward > 0 && !killer.bot) {
      send(killer, { type: 'kill', victim: victim.name, amount: reward, bot: victim.bot, final: victimWillDie });
    }
    if (victimWillDie) {
      killer.kills += 1;
      pushActivity(`${killer.name} ate ${victim.name} and claimed $${reward.toFixed(2)}`);
    }
  }
}

function eliminate(player, killer) {
  if (!player.alive) return;
  const cashoutFailed = !!player.cashout.active;
  player.alive = false;
  player.cashout = { active: false, timer: 0, locked: false };
  if (player.bot) {
    setTimeout(() => {
      if (players.has(player.id)) {
        const desiredBots = Math.max(0, TARGET_PLAYER_COUNT - countActiveHumans());
        if (countBots() <= desiredBots) spawnPlayer(player);
        else players.delete(player.id);
      }
      balanceBots();
    }, randInt(650, 1500));
  } else {
    send(player, {
      type: 'death',
      timeAlive: Math.floor((Date.now() - player.joinedAt) / 1000),
      kills: player.kills,
      cashoutFailed
    });
  }
  balanceBots();
}

function handleCashout(player, dt) {
  if (!player.alive || !player.cashout.active) return;
  player.cashout.timer += dt;
  player.cashout.locked = player.cashout.timer >= CASHOUT_LOCK_SECONDS;
  if (player.cashout.timer >= CASHOUT_SECONDS) {
    const amount = netWorth(player);
    const timeAlive = Math.floor((Date.now() - player.joinedAt) / 1000);
    player.alive = false;
    player.cells = [];
    player.cashout = { active: false, timer: 0, locked: false };
    send(player, {
      type: 'cashout',
      amount,
      timeAlive,
      kills: player.kills
    });
    pushActivity(`${player.name} cashed out $${amount.toFixed(2)}`);
    balanceBots();
  }
}

function resetMasses(silent = false, resetEarnings = false) {
  for (const player of players.values()) {
    if (!player.alive) continue;
    const p = { x: avgX(player), y: avgY(player) };
    const currentWorth = resetEarnings ? START_NET_WORTH : Math.max(0, netWorth(player));
    player.cells = [makeCell(player, p.x, p.y, START_RADIUS, currentWorth || START_NET_WORTH)];
    if (resetEarnings) player.kills = 0;
    player.money = netWorth(player);
    player.cashout = { active: false, timer: 0, locked: false };
  }
  food.length = 0;
  refillFood();
  seedViruses();
  if (!silent) pushActivity('Mass reset completed');
}

function tick() {
  const now = Date.now();
  const dt = Math.min(0.08, (now - lastTick) / 1000);
  lastTick = now;

  const humanCount = countActiveHumans();
  if (humanCount > 0) {
    if (!timerRunning) {
      timerRunning = true;
      resetTimer = RESET_SECONDS;
    }
    resetTimer -= dt;
    if (resetTimer <= 0) {
      resetTimer = RESET_SECONDS;
      resetMasses();
    }
  } else {
    if (timerRunning || resetTimer !== RESET_SECONDS) {
      resetMasses(true, true);
    }
    timerRunning = false;
    resetTimer = RESET_SECONDS;
  }

  for (const player of players.values()) moveCells(player, dt);
  moveFood(dt);
  for (const player of players.values()) separateAndMergeOwnCells(player);
  for (const player of players.values()) eatFoodAndViruses(player);
  eatPlayers();
  for (const player of players.values()) handleCashout(player, dt);
  refillFood();
  balanceBots();
}

function snapshotFor(requestingPlayer) {
  const viewX = avgX(requestingPlayer);
  const viewY = avgY(requestingPlayer);
  const viewRange = 1800;

  const board = [...players.values()]
    .filter(p => p.alive && p.cells.length)
    .map(p => ({ id: p.id, name: p.name, netWorth: netWorth(p), me: p.id === requestingPlayer.id }))
    .sort((a, b) => b.netWorth - a.netWorth)
    .slice(0, TARGET_PLAYER_COUNT);

  const playerData = [...players.values()]
    .filter(p => p.alive && p.cells.length)
    .map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      skin: p.skin || '',
      bot: p.bot,
      money: netWorth(p),
      kills: p.kills,
      cashout: p.cashout,
      cells: p.cells.map(c => ({ id: c.id, x: c.x, y: c.y, r: c.r, value: Number(c.value || 0), vx: c.vx || 0, vy: c.vy || 0, mergeAt: c.mergeAt || 0 }))
    }));

  const visibleFood = food.filter(f => Math.abs(f.x - viewX) < viewRange && Math.abs(f.y - viewY) < viewRange);
  const visibleViruses = viruses.filter(v => Math.abs(v.x - viewX) < viewRange && Math.abs(v.y - viewY) < viewRange);

  return {
    type: 'snapshot',
    id: requestingPlayer.id,
    world: { size: WORLD_SIZE },
    reset: resetTimer,
    leaderboard: board,
    players: playerData,
    food: visibleFood.map(f => ({ id: f.id, x: f.x, y: f.y, r: f.r, color: f.color, kind: f.kind })),
    viruses: visibleViruses.map(v => ({ id: v.id, x: v.x, y: v.y, r: v.r, color: v.color, kind: 'virus' }))
  };
}

function sendSnapshots() {
  for (const player of players.values()) {
    if (!player.ws || player.ws.readyState !== WS_OPEN) continue;
    send(player, snapshotFor(player));
  }
}

function handleMessage(player, raw) {
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch (_) {
    return;
  }

  switch (data.type) {
    case 'join': {
      const hadHumans = countActiveHumans() > 0;
      player.name = safeName(data.name || player.name || 'Player');
      player.color = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : player.color;
      player.skin = AVAILABLE_SKINS.includes(data.skin) ? data.skin : '';
      spawnPlayer(player);
      if (!hadHumans) {
        timerRunning = true;
        resetTimer = RESET_SECONDS;
        resetMasses(true, true);
      }
      balanceBots();
      send(player, { type: 'history', items: [...activity.slice(-15), ...chat.slice(-15)].sort((a, b) => a.time - b.time) });
      break;
    }
    case 'target': {
      if (!player.alive) return;
      const x = Number(data.x);
      const y = Number(data.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        player.target = { x: clamp(x, -HALF_WORLD, HALF_WORLD), y: clamp(y, -HALF_WORLD, HALF_WORLD) };
      }
      break;
    }
    case 'split':
      splitPlayer(player);
      break;
    case 'eject':
      ejectMass(player);
      break;
    case 'cashout':
      toggleCashout(player);
      break;
    case 'chat': {
      const now = Date.now();
      if (!player.alive || now - player.lastChat < 450) return;
      player.lastChat = now;
      const message = String(data.message || '').trim();
      if (message) pushChat(player, message);
      break;
    }
    case 'respawn': {
      if (!player.alive) {
        const hadHumans = countActiveHumans() > 0;
        spawnPlayer(player);
        if (!hadHumans) {
          timerRunning = true;
          resetTimer = RESET_SECONDS;
          resetMasses(true, true);
        }
        balanceBots();
      }
      break;
    }
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/stats.txt') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ title: 'PvP Games - Aga', mode: 'demo' }));
    return;
  }
  if (url.pathname === '/api/skins') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, skins: AVAILABLE_SKINS }));
    return;
  }

  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/' || filePath.startsWith('/aga')) filePath = '/index.html';
  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(fullPath, (err, body) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  });
}

const server = http.createServer(serveStatic);
server.on('upgrade', (req, socket, head) => {
  upgradeToWebSocket(req, socket, head, (ws) => {
  const player = createPlayer({ ws, name: `Player${randInt(100, 999)}` });
  sockets.set(ws, player);
  send(player, { type: 'welcome', id: player.id, world: { size: WORLD_SIZE } });

  ws.on('message', (raw) => handleMessage(player, raw));
  ws.on('close', () => {
    if (player.joined || player.alive) pushActivity(`${player.name} left the game`);
    removePlayer(player);
  });
  ws.on('error', () => removePlayer(player));
  });
});

function countActiveHumans() {
  let count = 0;
  for (const player of players.values()) {
    if (!player.bot && player.alive && player.joined) count++;
  }
  return count;
}

function countBots() {
  let count = 0;
  for (const player of players.values()) if (player.bot) count++;
  return count;
}

function balanceBots() {
  const desiredBots = Math.max(0, TARGET_PLAYER_COUNT - countActiveHumans());
  const botList = [...players.values()].filter(p => p.bot);

  while (botList.length > desiredBots) {
    const bot = botList.pop();
    players.delete(bot.id);
  }

  while (botList.length < desiredBots) {
    const index = botSpawnIndex++;
    const bot = createPlayer({
      name: BOT_NAMES[index % BOT_NAMES.length],
      bot: true,
      skin: AVAILABLE_SKINS[index % AVAILABLE_SKINS.length]
    });
    spawnPlayer(bot);
    botList.push(bot);
  }
}

function seedBots() {
  balanceBots();
}

refillFood();
seedViruses();
seedBots();
setInterval(tick, 1000 / TICK_RATE);
setInterval(sendSnapshots, 1000 / SNAPSHOT_RATE);

server.listen(PORT, () => {
  console.log(`PVP Agar-style game running at http://localhost:${PORT}`);
});
