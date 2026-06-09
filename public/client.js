(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const resetEl = document.getElementById('mass-reset-timer');
  const massEl = document.getElementById('current-mass-stats');
  const leaderboardRows = document.getElementById('leaderboard-rows');
  const cashoutBtn = document.getElementById('cashout-btn');
  const cashoutText = document.getElementById('cashout-text');
  const cashoutProgress = document.getElementById('cashout-progress');
  const activityFeed = document.getElementById('activity-feed');
  const killPopups = document.getElementById('kill-popups');
  const chatInput = document.getElementById('chat-input');
  const lobby = document.getElementById('lobby');
  const nameInput = document.getElementById('name-input');
  const playBtn = document.getElementById('play-btn');
  const resultModal = document.getElementById('result-modal');
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');
  const resultIcon = document.getElementById('result-icon');
  const respawnBtn = document.getElementById('respawn-btn');
  const themeToggle = document.getElementById('theme-toggle');
  const themeSwitch = document.querySelector('.theme-switch');
  const skinGrid = document.getElementById('skin-grid');

  let dpr = 1;
  let width = 0;
  let height = 0;
  let ws = null;
  let myId = null;
  let hasJoined = false;
  let gameVisible = false;
  let userName = localStorage.getItem('username') || `Player${Math.floor(Math.random() * 900 + 100)}`;
  let darkTheme = localStorage.getItem('aga-theme-preference') !== 'false';
  let selectedSkin = localStorage.getItem('selected-skin') || 'panther';
  let lastFrameTime = performance.now();
  let resultCountdownTimer = null;



  const AVAILABLE_SKINS = [
    'panther', 'eye', 'cake', 'rider', 'blue_player', 'football_a', 'party_player',
    'fire_player', 'basket_player', 'suit_player', 'football_b', 'flag_suit', 'flame_player',
    'meme_dog', 'bat', 'dino_skull', 'fly', 'alien', 'angler', 'purple_dino', 'red_dino'
  ];
  const skinImages = new Map();
  const cellShapeCache = new Map();
  const virusShapeCache = new Map();

  const state = {
    worldSize: 7000,
    reset: 600,
    players: new Map(),
    food: [],
    viruses: [],
    leaderboard: []
  };

  const camera = { x: 0, y: 0, zoom: 1 };
  const mouse = { x: 0, y: 0, worldX: 0, worldY: 0 };
  const keys = { w: false };
  let lastTargetSent = 0;
  let lastEjectSent = 0;
  let leftTouchId = -1;
  let ejectTouchId = -1;
  let ejectTouchActive = false;
  let leftStart = { x: 0, y: 0 };
  let leftPos = { x: 0, y: 0 };
  let touchList = [];
  const touchable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Smoother client-side easing. These are rates per second so motion stays
  // consistent on both high and low refresh-rate screens.
  const POSITION_SMOOTHING_RATE = 8.8;
  const LOCAL_POSITION_SMOOTHING_RATE = 14;
  const RADIUS_SMOOTHING_RATE = 10.0;
  const CAMERA_POSITION_RATE = 8;
  const CAMERA_ZOOM_RATE = 3.6;
  const SNAPSHOT_MAX_EXTRAPOLATE = 0.08;
  const IDLE_CAMERA_RATE = 1.2;

  nameInput.value = userName;
  themeToggle.checked = darkTheme;
  updateThemeSwitch();
  if (!AVAILABLE_SKINS.includes(selectedSkin)) selectedSkin = 'panther';
  buildSkinPicker();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function frameEase(rate, dt) {
    return 1 - Math.exp(-rate * dt);
  }

  function updateThemeSwitch() {
    if (!themeToggle) return;
    themeToggle.checked = darkTheme;
    if (themeSwitch) {
      themeSwitch.classList.toggle('dark', darkTheme);
      themeSwitch.classList.toggle('light', !darkTheme);
      themeSwitch.title = darkTheme ? 'Dark mode on' : 'Light mode on';
    }
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function shade(hex, factor) {
    const raw = (hex || '#ffffff').replace('#', '');
    const n = parseInt(raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw, 16);
    const r = clamp(Math.floor(((n >> 16) & 255) * factor), 0, 255);
    const g = clamp(Math.floor(((n >> 8) & 255) * factor), 0, 255);
    const b = clamp(Math.floor((n & 255) * factor), 0, 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function getSkinImage(name) {
    if (!name || !AVAILABLE_SKINS.includes(name)) return null;
    if (!skinImages.has(name)) {
      const img = new Image();
      img.src = `skins/${name}.png`;
      skinImages.set(name, img);
    }
    const img = skinImages.get(name);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  function buildSkinPicker() {
    if (!skinGrid) return;
    skinGrid.innerHTML = '';
    const choices = ['', ...AVAILABLE_SKINS];
    for (const skin of choices) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `skin-tile${skin ? '' : ' none'}${selectedSkin === skin ? ' selected' : ''}`;
      tile.title = skin ? skin.replace(/_/g, ' ') : 'No skin';
      tile.dataset.skin = skin;
      if (skin) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = `skins/${skin}.png`;
        tile.appendChild(img);
      }
      const check = document.createElement('span');
      check.className = 'skin-check';
      check.textContent = '✓';
      tile.appendChild(check);
      tile.addEventListener('click', () => selectSkin(skin));
      skinGrid.appendChild(tile);
    }
  }

  function selectSkin(skin) {
    selectedSkin = AVAILABLE_SKINS.includes(skin) ? skin : '';
    localStorage.setItem('selected-skin', selectedSkin);
    if (!skinGrid) return;
    for (const tile of skinGrid.querySelectorAll('.skin-tile')) {
      tile.classList.toggle('selected', tile.dataset.skin === selectedSkin);
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}${location.pathname}`);

    ws.onopen = () => {
      addEphemeralLine('Connected to game server');
      if (hasJoined) joinGame();
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      handleMessage(data);
    };

    ws.onclose = () => {
      addEphemeralLine('Disconnected. Reconnecting...');
      setTimeout(connect, 900);
    };
  }

  function send(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(data));
  }

  function joinGame() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    localStorage.setItem('username', userName);
    send({ type: 'join', name: userName, skin: selectedSkin });
    gameVisible = true;
    canvas.focus();
  }

  function returnToSelection() {
    if (resultCountdownTimer) {
      clearInterval(resultCountdownTimer);
      resultCountdownTimer = null;
    }
    resultModal.className = 'overlay';
    resultModal.classList.remove('show', 'result-death', 'result-win');
    lobby.classList.add('show');
    cashoutBtn.style.display = 'none';
    gameVisible = false;
    canvas.focus();
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'welcome':
        myId = data.id;
        if (data.world) state.worldSize = data.world.size;
        break;
      case 'spawned':
        myId = data.id;
        if (data.world) state.worldSize = data.world.size;
        if (resultCountdownTimer) {
          clearInterval(resultCountdownTimer);
          resultCountdownTimer = null;
        }
        resultModal.className = 'overlay';
        resultModal.classList.remove('show', 'result-death', 'result-win');
        lobby.classList.remove('show');
        gameVisible = true;
        cashoutBtn.style.display = 'block';
        break;
      case 'snapshot':
        myId = data.id;
        if (data.world) state.worldSize = data.world.size;
        state.reset = data.reset || 0;
        assimilatePlayers(data.players || []);
        state.food = data.food || [];
        state.viruses = data.viruses || [];
        const liveVirusIds = new Set((data.viruses || []).map(v => v.id));
        for (const cachedId of virusShapeCache.keys()) {
          if (!liveVirusIds.has(cachedId)) virusShapeCache.delete(cachedId);
        }
        state.leaderboard = data.leaderboard || [];
        updateHud();
        break;
      case 'history':
        (data.items || []).forEach(addMessageItem);
        break;
      case 'activity':
      case 'chat':
        addMessageItem(data);
        break;
      case 'system':
        addEphemeralLine(data.message || 'System message');
        break;
      case 'kill':
        addKillPopup(data.victim, data.amount, data.final);
        break;
      case 'death':
        showDeathResult(data);
        break;
      case 'cashout':
        showCashoutResult(data);
        break;
    }
  }

  function assimilatePlayers(list) {
    const incoming = new Set();
    const snapAt = performance.now();
    for (const p of list) {
      incoming.add(p.id);
      const old = state.players.get(p.id);
      const oldCells = new Map((old?.cells || []).map(c => [c.id, c]));
      const cells = (p.cells || []).map(c => {
        const oldCell = oldCells.get(c.id);
        const vx = Number(c.vx || 0);
        const vy = Number(c.vy || 0);
        const mvx = Number(c.mvx || 0);
        const mvy = Number(c.mvy || 0);
        return {
          id: c.id,
          x: oldCell ? oldCell.x : c.x,
          y: oldCell ? oldCell.y : c.y,
          r: oldCell ? oldCell.r : c.r,
          tx: c.x,
          ty: c.y,
          tr: c.r,
          value: Number(c.value || 0),
          vx,
          vy,
          mvx,
          mvy,
          snapAt,
          mergeAt: c.mergeAt || 0,
          birthTime: oldCell ? oldCell.birthTime : performance.now()
        };
      });
      state.players.set(p.id, {
        id: p.id,
        name: p.name || 'Player',
        color: p.color || '#ffffff',
        skin: AVAILABLE_SKINS.includes(p.skin) ? p.skin : '',
        money: p.money || 0,
        bot: !!p.bot,
        kills: p.kills || 0,
        cashout: p.cashout || { active: false, timer: 0, locked: false },
        cells
      });
    }
    const liveCellIds = new Set();
    for (const p of state.players.values()) {
      for (const c of p.cells) liveCellIds.add(c.id);
    }
    for (const cachedId of cellShapeCache.keys()) {
      if (!liveCellIds.has(cachedId)) cellShapeCache.delete(cachedId);
    }
    for (const id of state.players.keys()) {
      if (!incoming.has(id)) state.players.delete(id);
    }
  }

  const CHAT_FEED_MAX = 10;
  const EPHEMERAL_FEED_MS = 6000;
  const KILL_POPUP_MS = 3400;
  const KILL_POPUP_MAX = 3;
  const seenChatKeys = new Set();
  const MAX_SEEN_CHAT = 60;
  let chatLineCount = 0;

  function chatKey(item) {
    if (item.id != null) return `id:${item.id}`;
    return `t:${item.time}|${item.name}|${item.message}`;
  }

  function addMessageItem(item) {
    if (!item) return;
    if (item.type === 'chat') {
      const key = chatKey(item);
      if (seenChatKeys.has(key)) return;
      seenChatKeys.add(key);
      if (seenChatKeys.size > MAX_SEEN_CHAT) {
        const oldest = seenChatKeys.values().next().value;
        seenChatKeys.delete(oldest);
      }
      addChatLine(`${item.name}: ${item.message}`, item.color);
    } else if (item.message) {
      addEphemeralLine(item.message);
    }
  }

  function addKillPopup(victim, amount, final) {
    if (!killPopups) return;
    const name = String(victim || 'Player').trim() || 'Player';
    const earned = Number(amount || 0).toFixed(4);
    const label = final ? 'Killed' : 'Ate';

    for (const el of killPopups.querySelectorAll('.kill-popup:not(.kill-popup--exit)')) {
      el.classList.add('kill-popup--fade');
    }

    const popup = document.createElement('div');
    popup.className = 'kill-popup';
    popup.textContent = `${label} ${name} • Earned $${earned}`;
    killPopups.appendChild(popup);

    while (killPopups.children.length > KILL_POPUP_MAX) {
      killPopups.firstChild?.remove();
    }

    setTimeout(() => {
      if (!popup.isConnected) return;
      popup.classList.add('kill-popup--exit');
      popup.addEventListener('transitionend', () => popup.remove(), { once: true });
      setTimeout(() => popup.remove(), 500);
    }, KILL_POPUP_MS);
  }

  function addChatLine(message, color) {
    const line = document.createElement('div');
    line.className = 'activity-line activity-line--chat';
    line.textContent = message;
    if (color) line.style.color = color;
    activityFeed.appendChild(line);
    chatLineCount += 1;
    while (chatLineCount > CHAT_FEED_MAX) {
      const first = activityFeed.querySelector('.activity-line--chat');
      if (!first) break;
      first.remove();
      chatLineCount -= 1;
    }
  }

  function addEphemeralLine(message, color) {
    const line = document.createElement('div');
    line.className = 'activity-line activity-line--ephemeral';
    line.textContent = message;
    if (color) line.style.color = color;
    activityFeed.appendChild(line);
    setTimeout(() => {
      if (!line.isConnected) return;
      line.classList.add('activity-line--fade-out');
      line.addEventListener('transitionend', () => line.remove(), { once: true });
      setTimeout(() => line.remove(), 500);
    }, EPHEMERAL_FEED_MS);
  }

  function startFailCountdown(seconds = 5) {
    if (resultCountdownTimer) clearInterval(resultCountdownTimer);
    let left = seconds;
    const countdownEl = document.getElementById('result-countdown');
    const update = () => {
      if (countdownEl) countdownEl.textContent = `Returning to lobby in ${left}s`;
      if (left <= 0) {
        clearInterval(resultCountdownTimer);
        resultCountdownTimer = null;
        returnToSelection();
      }
      left -= 1;
    };
    update();
    resultCountdownTimer = setInterval(update, 1000);
  }

  function showDeathResult(data) {
    cashoutBtn.style.display = 'none';
    gameVisible = false;
    resultModal.className = 'overlay show result-death';
    resultIcon.textContent = '♢';
    resultTitle.textContent = data.cashoutFailed ? 'Cashout Failed' : 'Eliminated';
    resultBody.innerHTML = `
      <div class="result-subtitle">${data.cashoutFailed ? 'You were consumed before the cashout finished.' : "You've been consumed"}</div>
      <div class="result-stats">
        <div class="result-stat"><div class="result-stat-label">Survival Time</div><div class="result-stat-value">${formatTime(data.timeAlive)}</div></div>
        <div class="result-stat"><div class="result-stat-label">Kills</div><div class="result-stat-value">${Number(data.kills || 0)}</div></div>
      </div>
      <div id="result-countdown" class="result-countdown">Returning to lobby in 5s</div>`;
    respawnBtn.textContent = 'RETURN TO LOBBY';
    resultModal.classList.add('show');
    startFailCountdown(5);
  }

  function showCashoutResult(data) {
    if (resultCountdownTimer) {
      clearInterval(resultCountdownTimer);
      resultCountdownTimer = null;
    }
    cashoutBtn.style.display = 'none';
    gameVisible = false;
    resultModal.className = 'overlay show result-win';
    resultIcon.textContent = '♕';
    resultTitle.textContent = 'You Won!';
    resultBody.innerHTML = `
      <div class="result-subtitle">Successful Cashout!</div>
      <div class="result-stats">
        <div class="result-stat"><div class="result-stat-label">Net Winnings</div><div class="result-stat-value">$${Number(data.amount || 0).toFixed(2)}</div></div>
        <div class="result-stat"><div class="result-stat-label">Kills</div><div class="result-stat-value">${Number(data.kills || 0)}</div></div>
        <div class="result-stat"><div class="result-stat-label">Time Played</div><div class="result-stat-value">${formatTime(data.timeAlive)}</div></div>
        <div class="result-stat"><div class="result-stat-label">Status</div><div class="result-stat-value">Paid</div></div>
      </div>`;
    respawnBtn.textContent = 'RETURN TO LOBBY';
    resultModal.classList.add('show');
  }

  function getMe() {
    return state.players.get(myId) || null;
  }

  function playerMass(player) {
    if (!player) return 0;
    return player.cells.reduce((sum, cell) => sum + (cell.r * cell.r) / 100, 0);
  }

  function updateHud() {
    resetEl.textContent = `Reset ${formatTime(state.reset)}`;
    resetEl.style.color = state.reset <= 30 ? '#ff4444' : '#ffd700';

    const me = getMe();
    if (me && me.cells.length) {
      massEl.textContent = `Current Mass: ${Math.floor(playerMass(me))}`;
    } else {
      massEl.textContent = 'Current Mass: 0';
    }

    leaderboardRows.innerHTML = '';
    state.leaderboard.forEach((row, index) => {
      const div = document.createElement('div');
      div.className = `lb-row${row.me ? ' me' : ''}`;
      div.innerHTML = `<span class="lb-name">${index + 1}. ${escapeHtml(row.name || 'Player')}</span><span class="lb-money">$${Number(row.netWorth || 0).toFixed(2)}</span>`;
      leaderboardRows.appendChild(div);
    });

    if (!me || !me.cells.length) {
      cashoutBtn.style.display = 'none';
      return;
    }

    cashoutBtn.style.display = 'block';
    const cashout = me.cashout || { active: false, timer: 0, locked: false };
    if (cashout.active) {
      cashoutBtn.classList.add('active');
      const timer = Number(cashout.timer || 0);
      const progress = clamp((timer / 10) * 100, 0, 100);
      cashoutProgress.style.width = `${progress}%`;
      if (cashout.locked) {
        const left = Math.max(0, 10 - timer);
        cashoutText.textContent = `CASHING OUT: ${left.toFixed(2)}s`;
        cashoutBtn.style.animation = 'pulse 1.4s ease-in-out infinite';
      } else {
        const lockLeft = Math.max(0, 5 - timer);
        const cashLeft = Math.max(0, 10 - timer);
        cashoutText.textContent = `LOCK: ${lockLeft.toFixed(2)}s | CASH: ${cashLeft.toFixed(2)}s`;
        cashoutBtn.style.animation = 'none';
      }
    } else {
      cashoutBtn.classList.remove('active');
      cashoutProgress.style.width = '0%';
      cashoutText.textContent = `CASHOUT • $${Number(me.money || 0).toFixed(2)}`;
      cashoutBtn.style.animation = 'none';
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - width / 2) / camera.zoom + camera.x,
      y: (sy - height / 2) / camera.zoom + camera.y
    };
  }

  function updateMouseWorld() {
    const p = screenToWorld(mouse.x, mouse.y);
    mouse.worldX = p.x;
    mouse.worldY = p.y;
  }

  function getViewBounds(margin = 100) {
    const halfW = width / (2 * camera.zoom);
    const halfH = height / (2 * camera.zoom);
    return {
      minX: camera.x - halfW - margin,
      maxX: camera.x + halfW + margin,
      minY: camera.y - halfH - margin,
      maxY: camera.y + halfH + margin
    };
  }

  function inView(x, y, r, bounds) {
    return x + r >= bounds.minX && x - r <= bounds.maxX &&
      y + r >= bounds.minY && y - r <= bounds.maxY;
  }

  function maybeSendTarget(force = false) {
    const now = performance.now();
    if (!force && now - lastTargetSent < 38) return;
    lastTargetSent = now;
    send({ type: 'target', x: mouse.worldX, y: mouse.worldY });
  }

  function predictedCellPosition(cell, now) {
    const elapsed = Math.min(SNAPSHOT_MAX_EXTRAPOLATE, Math.max(0, (now - (cell.snapAt || now)) / 1000));
    return {
      x: cell.tx + (cell.mvx || 0) * elapsed,
      y: cell.ty + (cell.mvy || 0) * elapsed
    };
  }

  function interpolateCells(dt, now) {
    const remoteEase = frameEase(POSITION_SMOOTHING_RATE, dt);
    const localEase = frameEase(LOCAL_POSITION_SMOOTHING_RATE, dt);
    const radiusEase = frameEase(RADIUS_SMOOTHING_RATE, dt);
    for (const p of state.players.values()) {
      const posEase = p.id === myId ? localEase : remoteEase;
      for (const cell of p.cells) {
        const predicted = predictedCellPosition(cell, now);
        cell.x = lerp(cell.x, predicted.x, posEase);
        cell.y = lerp(cell.y, predicted.y, posEase);
        cell.r = lerp(cell.r, cell.tr, radiusEase);
      }
    }
  }

  function updateCamera(dt) {
    const me = getMe();
    if (me && me.cells.length) {
      let x = 0;
      let y = 0;
      let rSum = 0;
      for (const c of me.cells) {
        x += c.x;
        y += c.y;
        rSum += c.r;
      }
      x /= me.cells.length;
      y /= me.cells.length;
      camera.x = lerp(camera.x, x, frameEase(CAMERA_POSITION_RATE, dt));
      camera.y = lerp(camera.y, y, frameEase(CAMERA_POSITION_RATE, dt));
      const targetZoom = clamp(Math.pow(78 / Math.max(78, rSum), 0.45), 0.20, 1.18);
      camera.zoom = lerp(camera.zoom, targetZoom, frameEase(CAMERA_ZOOM_RATE, dt));
    } else {
      const idleEase = frameEase(IDLE_CAMERA_RATE, dt);
      camera.x = lerp(camera.x, 0, idleEase);
      camera.y = lerp(camera.y, 0, idleEase);
      camera.zoom = lerp(camera.zoom, 0.42, idleEase);
    }
  }

  function drawGrid() {
    ctx.fillStyle = darkTheme ? '#111111' : '#f2fbff';
    ctx.fillRect(0, 0, width, height);

    const grid = 50 * camera.zoom;
    let offsetX = width / 2 - camera.x * camera.zoom;
    let offsetY = height / 2 - camera.y * camera.zoom;
    offsetX %= grid;
    offsetY %= grid;
    if (offsetX < 0) offsetX += grid;
    if (offsetY < 0) offsetY += grid;

    ctx.beginPath();
    ctx.strokeStyle = darkTheme ? 'rgba(170,170,170,0.17)' : 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    for (let x = offsetX; x < width; x += grid) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = offsetY; y < height; y += grid) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }

  function beginWorld() {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  function drawWorldBorder() {
    const size = state.worldSize;
    ctx.save();
    ctx.strokeStyle = darkTheme ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 8;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function circle(item) {
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
  }

  function drawFoodPellet(f, simple = false) {
    const base = f.color || '#ffe000';
    const r = Math.max(3, f.r || 7);
    if (simple) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = base;
      ctx.fill();
      return;
    }
    ctx.save();
    const pulse = 1 + Math.sin(performance.now() / 420 + (f.id || 0)) * 0.035;
    ctx.fillStyle = base;
    ctx.strokeStyle = shade(base, f.kind === 'ejected' ? 0.55 : 0.70);
    ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.beginPath();
    ctx.arc(f.x, f.y, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(f.x - r * 0.28, f.y - r * 0.32, Math.max(1.5, r * 0.23), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function getVirusShape(v, points) {
    let shape = virusShapeCache.get(v.id);
    if (!shape || shape.values.length !== points) {
      const values = new Array(points);
      const velocity = new Array(points);
      const phase = (Number(v.id) || Math.random() * 9999) * 0.011;
      for (let i = 0; i < points; i++) {
        values[i] = Math.sin(phase + i * 1.31) * 0.024;
        velocity[i] = 0;
      }
      shape = { values, velocity, phase, last: performance.now() };
      virusShapeCache.set(v.id, shape);
    }
    return shape;
  }

  function updateVirusShape(v, shape) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - shape.last) / 1000));
    shape.last = now;
    const n = shape.values.length;
    for (let i = 0; i < n; i++) {
      const prev = shape.values[(i - 1 + n) % n];
      const next = shape.values[(i + 1) % n];
      const wave = Math.sin(now * 0.0031 + shape.phase + i * 0.62) * 0.032;
      const target = (prev + next) * 0.34 + wave;
      shape.velocity[i] += (target - shape.values[i]) * 3.8 * dt;
      shape.velocity[i] *= Math.pow(0.025, dt);
      shape.values[i] += shape.velocity[i];
      shape.values[i] = clamp(shape.values[i], -0.085, 0.085);
    }
  }

  function drawVirus(v) {
    ctx.save();
    const teeth = 40;
    const points = teeth * 2;
    const outer = v.r * 1.02;
    const inner = v.r * 0.945;
    const shape = getVirusShape(v, points);
    updateVirusShape(v, shape);
    const now = performance.now();
    const bodyPulse = 1 + Math.sin(now * 0.0026 + shape.phase) * 0.024;
    const wobble = v.r * 0.12;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const idx = i % points;
      const a = (Math.PI * idx) / teeth;
      const isOuter = idx % 2 === 0;
      const base = (isOuter ? outer : inner) * bodyPulse;
      const organic = shape.values[idx] * wobble * (isOuter ? 1 : 0.78);
      const rr = base + organic;
      const x = v.x + Math.cos(a) * rr;
      const y = v.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = '#00ff00';
    ctx.strokeStyle = '#13bf00';
    ctx.lineWidth = Math.max(2.5, v.r * 0.045);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function wallMoldInfo(cell, radius = cell.r) {
    const half = state.worldSize / 2;

    // A small band is enough: the server keeps the physics cell clamped inside
    // the map, so when it is touching a wall the visual blob must be pushed
    // slightly *through* that wall, then sliced flat by the wall line.
    const edgeBand = Math.max(12, radius * 0.38);
    const leftGap = (cell.x - radius) + half;
    const rightGap = half - (cell.x + radius);
    const topGap = (cell.y - radius) + half;
    const bottomGap = half - (cell.y + radius);

    const leftPressure = clamp((edgeBand - leftGap) / edgeBand, 0, 1);
    const rightPressure = clamp((edgeBand - rightGap) / edgeBand, 0, 1);
    const topPressure = clamp((edgeBand - topGap) / edgeBand, 0, 1);
    const bottomPressure = clamp((edgeBand - bottomGap) / edgeBand, 0, 1);
    const pressure = Math.max(leftPressure, rightPressure, topPressure, bottomPressure);

    // Push the drawn center toward the wall. The path is then clipped by the
    // wall side. This makes a soft chord/flat side without folding the shape.
    const push = radius * 0.30;
    return {
      half,
      pressure,
      leftPressure,
      rightPressure,
      topPressure,
      bottomPressure,
      offsetX: (rightPressure - leftPressure) * push,
      offsetY: (bottomPressure - topPressure) * push
    };
  }

  function splitStretchInfo(cell) {
    // Keep split cells round — stretch was causing a wrong initial orientation
    // before velocity synced, then snapping back to a circle.
    return { amount: 0, angle: 0 };
  }

  function getCellShape(cell, segments) {
    let shape = cellShapeCache.get(cell.id);
    if (!shape || shape.values.length !== segments) {
      const values = new Array(segments);
      const velocity = new Array(segments);
      const phase = (Number(cell.id) || Math.random() * 9999) * 0.013;
      for (let i = 0; i < segments; i++) {
        values[i] = Math.sin(phase + i * 1.73) * 0.018;
        velocity[i] = 0;
      }
      shape = { values, velocity, phase, last: performance.now() };
      cellShapeCache.set(cell.id, shape);
    }
    return shape;
  }

  function updateCellShape(cell, shape, radius) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - shape.last) / 1000));
    shape.last = now;
    const speed = Math.hypot(cell.vx || 0, cell.vy || 0);
    const activity = clamp(speed / 520, 0, 1);
    const n = shape.values.length;
    for (let i = 0; i < n; i++) {
      const prev = shape.values[(i - 1 + n) % n];
      const next = shape.values[(i + 1) % n];
      const wave = Math.sin(now * 0.004 + shape.phase + i * 0.71) * (0.010 + activity * 0.020);
      const target = (prev + next) * 0.28 + wave;
      shape.velocity[i] += (target - shape.values[i]) * (5.5 + activity * 4.0) * dt;
      shape.velocity[i] *= Math.pow(0.035, dt);
      shape.values[i] += shape.velocity[i];
      shape.values[i] = clamp(shape.values[i], -0.055, 0.055);
    }
  }

  function drawCellPath(cell, radius, split) {
    const mold = wallMoldInfo(cell, radius);
    if (!split) split = splitStretchInfo(cell);
    const molded = mold.pressure > 0.001;
    const viewDist = Math.hypot(cell.x - camera.x, cell.y - camera.y);
    const detail = viewDist > 1400 ? 0.55 : viewDist > 800 ? 0.78 : 1;
    const segments = Math.max(40, Math.min(72, Math.floor(radius * 0.75 * detail)));
    const shape = radius > 24 ? getCellShape(cell, segments) : null;
    if (shape) updateCellShape(cell, shape, radius);

    const half = mold.half;
    const cx = cell.x + mold.offsetX;
    const cy = cell.y + mold.offsetY;
    const ca = Math.cos(split.angle);
    const sa = Math.sin(split.angle);

    for (let i = 0; i <= segments; i++) {
      const idx = i % segments;
      const angle = (Math.PI * 2 * idx) / segments;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Avoid noisy points exactly on the flattened wall side. This is what
      // stops the folded/creased look while keeping the rest of the blob alive.
      let organic = radius > 18 && shape ? shape.values[idx] * radius : 0;
      if (molded) {
        const onFlatSide =
          (mold.rightPressure > 0 && cos > 0.35) ||
          (mold.leftPressure > 0 && cos < -0.35) ||
          (mold.topPressure > 0 && sin < -0.35) ||
          (mold.bottomPressure > 0 && sin > 0.35);
        if (onFlatSide) organic *= 0.25;
      }

      let lx = cos * (radius + organic);
      let ly = sin * (radius + organic);

      if (split.amount > 0.01) {
        const along = lx * ca + ly * sa;
        const side = -lx * sa + ly * ca;
        const frontBias = along > 0 ? split.amount * 0.25 * radius : 0;
        const along2 = along * (1 + split.amount * 1.18) + frontBias;
        const side2 = side * (1 - split.amount * 0.24);
        lx = ca * along2 - sa * side2;
        ly = sa * along2 + ca * side2;
      }

      let x = cx + lx;
      let y = cy + ly;

      if (molded) {
        // IMPORTANT: independent side clamps only. Do not recalculate x from y
        // or y from x after a clamp, because that creates the folding artifact.
        if (mold.rightPressure > 0 && x > half) x = half;
        if (mold.leftPressure > 0 && x < -half) x = -half;
        if (mold.topPressure > 0 && y < -half) y = -half;
        if (mold.bottomPressure > 0 && y > half) y = half;
      }

      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  function drawSplitSkin(skin, x, y, radius, split) {
    ctx.save();
    const drawR = radius * (1.06 + split.amount * 0.12);
    const drawSize = Math.round(drawR * 2);
    const oldSmooth = ctx.imageSmoothingEnabled;
    const oldQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch (_) {}
    ctx.translate(x, y);
    if (split.amount > 0.01) {
      ctx.rotate(split.angle);
      ctx.scale(1 + split.amount * 1.43, 1 - split.amount * 0.24);
    }
    ctx.drawImage(skin, Math.round(-drawR), Math.round(-drawR), drawSize, drawSize);
    ctx.imageSmoothingEnabled = oldSmooth;
    try { ctx.imageSmoothingQuality = oldQuality || 'high'; } catch (_) {}
    ctx.restore();
  }

  function drawCell(cell, player, bounds) {
    const r = cell.r;
    if (bounds && !inView(cell.x, cell.y, r + 20, bounds)) return;
    const isMe = player.id === myId;
    const mold = wallMoldInfo(cell, r);
    const split = splitStretchInfo(cell);
    const visualX = cell.x + mold.offsetX;
    const visualY = cell.y + mold.offsetY;
    const skin = getSkinImage(player.skin);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    drawCellPath(cell, r, split);
    ctx.closePath();

    if (skin) {
      ctx.save();
      ctx.clip();
      drawSplitSkin(skin, visualX, visualY, r, split);
      ctx.restore();
    } else {
      ctx.fillStyle = player.color;
      ctx.fill();
    }

    ctx.lineWidth = Math.max(3, r * 0.055);
    ctx.strokeStyle = isMe ? '#214bff' : shade(player.color, 0.78);
    ctx.stroke();

    if (isMe) {
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = Math.max(2, r * 0.026);
      ctx.strokeStyle = '#ff8a00';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (player.cashout?.active) {
      const progress = clamp((Number(player.cashout.timer || 0) / 10), 0, 1);
      ctx.strokeStyle = player.cashout.locked ? '#e74c3c' : '#f39c12';
      ctx.globalAlpha = 0.86;
      ctx.lineWidth = Math.max(5, r * 0.08);
      ctx.beginPath();
      ctx.arc(visualX, visualY, r + 15, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawCellText(cell, player, visualX, visualY);
    ctx.restore();
  }

  function drawCellText(cell, player, textX = cell.x, textY = cell.y) {
    if (cell.r < 15) return;
    const cellMoney = Number(cell.value ?? 0);
    const nameSize = Math.max(18, cell.r * 0.34);
    const moneySize = Math.max(15, cell.r * 0.26);
    const lineGap = Math.max(3, cell.r * 0.04);
    const totalH = nameSize + (cellMoney > 0 ? moneySize + lineGap : 0);
    let y = textY - totalH / 2 + nameSize * 0.75;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `700 ${nameSize}px Ubuntu, Arial, sans-serif`;
    ctx.lineWidth = Math.max(3, nameSize * 0.13);
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(player.name || 'Player', textX, y);
    ctx.fillText(player.name || 'Player', textX, y);

    if (cellMoney > 0) {
      y += nameSize * 0.58 + lineGap + moneySize * 0.45;
      ctx.font = `700 ${moneySize}px Ubuntu, Arial, sans-serif`;
      ctx.lineWidth = Math.max(3, moneySize * 0.16);
      ctx.strokeText(`$${cellMoney.toFixed(2)}`, textX, y);
      ctx.fillText(`$${cellMoney.toFixed(2)}`, textX, y);
    }
  }

  function drawTouchUi() {
    if (!touchable) return;
    const size = Math.floor(width / 7);
    const splitX = width - size / 2 - 8;
    const splitY = height - size / 2 - 8;
    const ejectX = splitX;
    const ejectY = height - size * 1.5 - 18;

    ctx.save();
    ctx.globalAlpha = 0.78;
    drawTouchButton(splitX, splitY, size * 0.42, 'split');
    drawTouchButton(ejectX, ejectY, size * 0.42, 'eject');
    ctx.globalAlpha = 1;

    const joystickActive = leftTouchId >= 0;
    const baseX = joystickActive ? leftStart.x : 100;
    const baseY = joystickActive ? leftStart.y : height - 100;
    const knobX = joystickActive ? leftPos.x : baseX;
    const knobY = joystickActive ? leftPos.y : baseY;
    ctx.strokeStyle = joystickActive ? 'rgba(0,150,255,0.8)' : 'rgba(0,150,255,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(baseX, baseY, 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = joystickActive ? 'rgba(0,150,255,0.40)' : 'rgba(0,150,255,0.10)';
    ctx.beginPath();
    ctx.arc(baseX, baseY, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = joystickActive ? 'rgba(0,180,255,0.85)' : 'rgba(0,180,255,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(knobX, knobY, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawTouchButton(x, y, r, label) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (label === 'split') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2.5, r * 0.10);
      ctx.beginPath();
      ctx.arc(x - r * 0.18, y + r * 0.06, r * 0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + r * 0.18, y - r * 0.06, r * 0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.03, y + r * 0.02);
      ctx.lineTo(x + r * 0.13, y - r * 0.10);
      ctx.stroke();
      return;
    }

    if (label === 'eject') {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x - r * 0.06, y, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + r * 0.02, y);
      ctx.lineTo(x + r * 0.28, y - r * 0.16);
      ctx.lineTo(x + r * 0.28, y + r * 0.16);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(12, r * 0.34)}px Ubuntu, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  function render(now) {
    requestAnimationFrame(render);
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
    lastFrameTime = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    interpolateCells(dt, now);
    updateCamera(dt);
    updateMouseWorld();
    maybeSendTarget(false);

    if (keys.w && now - lastEjectSent > 100) {
      lastEjectSent = now;
      send({ type: 'eject' });
    }
    if (ejectTouchActive && now - lastEjectSent > 100) {
      lastEjectSent = now;
      send({ type: 'eject' });
    }

    drawGrid();
    beginWorld();
    drawWorldBorder();
    const bounds = getViewBounds(160);
    const simpleFood = state.food.length > 100 || camera.zoom < 0.45;
    for (const f of state.food) {
      const fr = Math.max(3, f.r || 7);
      if (inView(f.x, f.y, fr, bounds)) drawFoodPellet(f, simpleFood);
    }
    const playerList = [...state.players.values()];
    playerList.sort((a, b) => {
      let ar = 0;
      let br = 0;
      for (const c of a.cells) if (c.r > ar) ar = c.r;
      for (const c of b.cells) if (c.r > br) br = c.r;
      return ar - br;
    });
    for (const p of playerList) {
      for (const cell of p.cells) drawCell(cell, p, bounds);
    }
    for (const v of state.viruses) {
      if (inView(v.x, v.y, v.r || 80, bounds)) drawVirus(v);
    }
    ctx.restore();
    drawTouchUi();
  }

  function startFromLobby() {
    userName = (nameInput.value || 'Player').trim().slice(0, 18) || 'Player';
    hasJoined = true;
    resultModal.className = 'overlay';
    resultModal.classList.remove('show', 'result-death', 'result-win');
    lobby.classList.remove('show');
    connect();
    if (ws?.readyState === WebSocket.OPEN) joinGame();
  }

  function cashout() {
    send({ type: 'cashout' });
    canvas.focus();
  }

  canvas.addEventListener('mousemove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    updateMouseWorld();
  });

  canvas.addEventListener('mousedown', () => canvas.focus());

  window.addEventListener('keydown', (event) => {
    const typing = document.activeElement === chatInput || document.activeElement === nameInput;
    if (event.key === 'Enter') {
      if (document.activeElement === chatInput) {
        const message = chatInput.value.trim();
        if (message) send({ type: 'chat', message });
        chatInput.value = '';
        chatInput.blur();
        canvas.focus();
      } else if (!lobby.classList.contains('show') && !resultModal.classList.contains('show')) {
        chatInput.focus();
      }
      event.preventDefault();
      return;
    }
    if (typing || lobby.classList.contains('show') || resultModal.classList.contains('show')) return;

    switch (event.code) {
      case 'Space':
        send({ type: 'split' });
        event.preventDefault();
        break;
      case 'KeyW':
        keys.w = true;
        event.preventDefault();
        break;
      case 'KeyC':
        cashout();
        event.preventDefault();
        break;
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'KeyW') keys.w = false;
  });

  window.addEventListener('blur', () => {
    keys.w = false;
    ejectTouchActive = false;
  });

  cashoutBtn.addEventListener('click', cashout);
  playBtn.addEventListener('click', startFromLobby);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startFromLobby();
  });
  respawnBtn.addEventListener('click', returnToSelection);
  themeToggle.addEventListener('change', () => {
    darkTheme = themeToggle.checked;
    updateThemeSwitch();
    localStorage.setItem('aga-theme-preference', String(darkTheme));
  });

  canvas.addEventListener('touchstart', (event) => {
    if (!gameVisible) return;
    event.preventDefault();
    const size = Math.floor(width / 7);
    for (const touch of event.changedTouches) {
      if (touch.clientX > width - size && touch.clientY > height - size) {
        send({ type: 'split' });
        continue;
      }
      if (touch.clientX > width - size && touch.clientY > height - 2 * size - 24 && touch.clientY < height - size - 10) {
        ejectTouchId = touch.identifier;
        ejectTouchActive = true;
        send({ type: 'eject' });
        continue;
      }
      if (leftTouchId < 0 && touch.clientX < width * 0.7) {
        leftTouchId = touch.identifier;
        leftStart = { x: touch.clientX, y: touch.clientY };
        leftPos = { x: touch.clientX, y: touch.clientY };
      }
    }
    touchList = [...event.touches];
  }, { passive: false });

  canvas.addEventListener('touchmove', (event) => {
    if (!gameVisible) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      if (touch.identifier === leftTouchId) {
        leftPos = { x: touch.clientX, y: touch.clientY };
        const vx = (leftPos.x - leftStart.x) * 3;
        const vy = (leftPos.y - leftStart.y) * 3;
        const p = screenToWorld(width / 2 + vx, height / 2 + vy);
        mouse.worldX = p.x;
        mouse.worldY = p.y;
        maybeSendTarget(true);
      }
    }
    touchList = [...event.touches];
  }, { passive: false });

  canvas.addEventListener('touchend', (event) => {
    if (!gameVisible) return;
    event.preventDefault();
    for (const touch of event.changedTouches) {
      if (touch.identifier === leftTouchId) leftTouchId = -1;
      if (touch.identifier === ejectTouchId) {
        ejectTouchId = -1;
        ejectTouchActive = false;
      }
    }
    touchList = [...event.touches];
  }, { passive: false });

  window.addEventListener('resize', resize);
  resize();
  connect();
  requestAnimationFrame(render);
})();
