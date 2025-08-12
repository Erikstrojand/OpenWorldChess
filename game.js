
const firebaseConfig = {
  apiKey: "AIzaSyDMgeTsL8mMyL9urlBDSXwlV00WO-_NPQw",
  authDomain: "openworldchess-26d9d.firebaseapp.com",
  databaseURL: "https://openworldchess-26d9d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "openworldchess-26d9d",
  storageBucket: "openworldchess-26d9d.firebasestorage.app",
  messagingSenderId: "786962360377",
  appId: "1:786962360377:web:d393d2f3e12205f7e245e8"
};


try {
  firebase.initializeApp(firebaseConfig);
  document.getElementById('loading').classList.remove('hidden');
  console.log('Firebase initialized');
} catch (err) {
  console.error('Firebase init error', err);
  showError('Failed to connect to server: ' + err.message);
}


const BOARD_SIZE = 100;
const RENDER_DISTANCE = 5;
const BASE_COOLDOWN = 3000;
const RANK_COOLDOWN_REDUCTION = 400;
const MIN_COOLDOWN = 500;
const BASE_PLAYER_ANIMATION_DURATION = 400; 
const OPPONENT_ANIMATION_DURATION = 300; 

const database = firebase.database();
const canvas = document.getElementById('chessboard');
const ctx = canvas.getContext('2d');
let squareSize = canvas.width / (RENDER_DISTANCE * 2 + 1);
let moveCooldown = 0;
let cooldownStart = 0;
let cooldownDuration = 0;
let cameraX = 0;
let cameraY = 0;
let targetCameraX = 0;
let targetCameraY = 0;
let playerAnimDuration = BASE_PLAYER_ANIMATION_DURATION;


const playerNameDisplay = document.getElementById('player-name');
const playerRankDisplay = document.getElementById('player-rank');
const playerPointsDisplay = document.getElementById('player-points');
const playerStatusDisplay = document.getElementById('player-status');
const playersListEl = document.getElementById('players-list');
const playerNameInput = document.getElementById('player-name-input');
const setNameBtn = document.getElementById('set-name');
const removeMeBtn = document.getElementById('remove-me');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const playerCoordsDisplay = document.getElementById('player-coords'); 


const playerId = localStorage.getItem('owc_player_id') || `player_${Math.random().toString(36).slice(2,11)}`;
localStorage.setItem('owc_player_id', playerId);

let player = {
  id: playerId,
  name: `Player_${playerId.slice(-4)}`,
  x: Math.floor(Math.random() * BOARD_SIZE),
  y: Math.floor(Math.random() * BOARD_SIZE),
  rank: 'Pawn',
  points: 0,
  dead: false,
  targetX: null,
  targetY: null,
  animStart: null,
  highestRank: 'Pawn'
};

const ranks = [
  { name: 'Pawn', value: 1, image: new Image() },
  { name: 'Knight', value: 3, image: new Image() },
  { name: 'Bishop', value: 3, image: new Image() },
  { name: 'Rook', value: 5, image: new Image() },
  { name: 'Queen', value: 9, image: new Image() },
  { name: 'King', value: 11, image: new Image() }
];
ranks.forEach((r, i) => r.image.src = `${r.name.toLowerCase()}.png`);

const pointsToRankUp = { Pawn: 0, Knight: 10, Bishop: 15, Rook: 25, Queen: 35, King: 50};

// Firebase shit
function savePlayer() {
  const ref = database.ref(`players/${player.id}`);
  ref.onDisconnect().remove();
  return ref.set(player).catch(err => {
    console.error('Save error', err);
    showError('Failed to save player data');
  });
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  setTimeout(() => errorEl.classList.add('hidden'), 5000);
}


window.addEventListener('beforeunload', () => {
  try { database.ref(`players/${player.id}`).remove(); } catch (e) {}
});

removeMeBtn.addEventListener('click', () => {
  database.ref(`players/${player.id}`).remove();
  localStorage.removeItem('owc_player_id');
  player.dead = true;
  updateUI();
  showError('You left the game. Set name to join again.');
});

setNameBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (name && name.length <= 20 && /^[a-zA-Z0-9_ ]+$/.test(name)) {
    player.name = name;
    player.x = Math.floor(Math.random() * BOARD_SIZE);
    player.y = Math.floor(Math.random() * BOARD_SIZE);
    player.rank = 'Pawn';
    player.points = 0;
    player.dead = false;
    player.targetX = null;
    player.targetY = null;
    cameraX = player.x - RENDER_DISTANCE;
    cameraY = player.y - RENDER_DISTANCE;
    targetCameraX = cameraX;
    targetCameraY = cameraY;
    playerAnimDuration = BASE_PLAYER_ANIMATION_DURATION;
    savePlayer();
    drawBoard();
  } else {
    showError('Name must be 1-20 characters (letters, numbers, spaces, or underscores)');
  }
});


const randomPoints = [];

function generateRandomPoints(count) {
  randomPoints.length = 0;
  for (let i = 0; i < count; i++) {
    randomPoints.push({
      x: Math.floor(Math.random() * BOARD_SIZE),
      y: Math.floor(Math.random() * BOARD_SIZE)
    });
  }
}

let players = {};
database.ref('players').on('value', snapshot => {
  loadingEl.classList.add('hidden');
  const remotePlayers = snapshot.val() || {};

  // Sync current player's state from Firebase, or mark dead if not found
  if (remotePlayers[player.id]) {
    const remotePlayer = remotePlayers[player.id];
    player.dead = !!remotePlayer.dead;
    player.points = remotePlayer.points;
    player.rank = remotePlayer.rank;
    player.x = remotePlayer.x;
    player.y = remotePlayer.y;
    player.name = remotePlayer.name;
  } else {
    player.dead = true;
  }

  // Sync other players and track animations
  for (const id in remotePlayers) {
    if (!players[id]) {
      players[id] = { ...remotePlayers[id], targetX: null, targetY: null, animStart: null };
    } else {
      const p = players[id];
      const r = remotePlayers[id];
      if (p.x !== r.x || p.y !== r.y) {
        p.targetX = r.x;
        p.targetY = r.y;
        p.animStart = performance.now();
      }
      p.x = r.x;
      p.y = r.y;
      p.name = r.name;
      p.rank = r.rank;
      p.points = r.points;
      p.dead = r.dead || false;
    }
  }

  // Remove players that disappeared from Firebase, mark current player dead if removed
  for (const id in players) {
    if (!remotePlayers[id]) {
      if (id === player.id && !player.dead) {
        player.dead = true;
        showError('You were captured! Set name to respawn.');
      }
      delete players[id];
    }
  }

  updateUI();
  drawBoard();
});

// Utility functionss
function updateUI() {
  playerNameDisplay.textContent = `Name: ${player.name}`;
  playerRankDisplay.textContent = `Rank: ${player.rank}`;
  playerPointsDisplay.textContent = `Points: ${player.points}`;
  playerStatusDisplay.textContent = `Status: ${player.dead ? 'Dead' : 'Alive'}`;
  playerCoordsDisplay.textContent = `Coordinates: (${player.x}, ${player.y})`; 
  setNameBtn.disabled = !player.dead;
  refreshPlayersList();
}

function refreshPlayersList() {
  const arr = Object.values(players).sort((a, b) => b.points - a.points);
  playersListEl.innerHTML = arr.length
    ? arr.map(p => `<div>${escapeHtml(p.name)} (${p.rank}) — ${p.points} pts${p.dead ? ' (Dead)' : ''}</div>`).join('')
    : '(none)';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function resizeCanvasToFit() {
  const maxW = Math.min(window.innerWidth - 40, 720);
  const size = Math.max(320, Math.min(720, maxW));
  canvas.width = size;
  canvas.height = size;
  squareSize = canvas.width / (RENDER_DISTANCE * 2 + 1);
}

window.addEventListener('resize', () => { resizeCanvasToFit(); drawBoard(); });
resizeCanvasToFit();


function easeInOut(t) {
  return t * t * (3 - 2 * t); 
}

function lerp(start, end, t) {
  return start + (end - start) * easeInOut(t);
}


function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const viewSize = RENDER_DISTANCE * 2 + 1;
  const offsetX = cameraX;
  const offsetY = cameraY;

  
  const minCameraX = -RENDER_DISTANCE;
  const maxCameraX = BOARD_SIZE - 1 - RENDER_DISTANCE;
  const minCameraY = -RENDER_DISTANCE;
  const maxCameraY = BOARD_SIZE - 1 - RENDER_DISTANCE;
  cameraX = Math.max(minCameraX, Math.min(maxCameraX, cameraX));
  cameraY = Math.max(minCameraY, Math.min(maxCameraY, cameraY));

  
  for (let y = 0; y < viewSize; y++) {
    for (let x = 0; x < viewSize; x++) {
      const boardX = Math.floor(x + offsetX);
      const boardY = Math.floor(y + offsetY);
      if (boardX < 0 || boardX >= BOARD_SIZE || boardY < 0 || boardY >= BOARD_SIZE) {
        ctx.fillStyle = '#333';
        ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize);
      } else {
        ctx.fillStyle = (boardX + boardY) % 2 === 0 ? '#fff' : '#769656';
        ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize);
      }
    }
  }

  
  ctx.fillStyle = 'red'; 
  randomPoints.forEach(pt => {
    let viewX = pt.x - offsetX;
    let viewY = pt.y - offsetY;
    if (viewX >= 0 && viewX < viewSize && viewY >= 0 && viewY < viewSize) {
      const px = (viewX + 0.5) * squareSize;
      const py = (viewY + 0.5) * squareSize;
      ctx.beginPath();
      ctx.arc(px, py, squareSize / 6, 0, 2 * Math.PI);
      ctx.fill();
    }
  });

  
  for (const id in players) {
    const p = players[id];
    if (p.dead) continue;
    const rankData = ranks.find(r => r.name === p.rank);
    let viewX = p.x - offsetX;
    let viewY = p.y - offsetY;
    let px = (viewX + 0.5) * squareSize;
    let py = (viewY + 0.5) * squareSize;

    
    if (p.targetX !== null && p.targetY !== null && p.animStart !== null) {
      const duration = p.id === player.id ? playerAnimDuration : OPPONENT_ANIMATION_DURATION;
      const t = Math.min((performance.now() - p.animStart) / duration, 1);
      px = lerp((p.x - offsetX + 0.5) * squareSize, (p.targetX - offsetX + 0.5) * squareSize, t);
      py = lerp((p.y - offsetY + 0.5) * squareSize, (p.targetY - offsetY + 0.5) * squareSize, t);
      if (t >= 1) {
        p.targetX = null;
        p.targetY = null;
        p.animStart = null;
      }
    }

    if (viewX >= 0 && viewX < viewSize && viewY >= 0 && viewY < viewSize) {
      if (rankData && rankData.image.complete && rankData.image.naturalWidth !== 0) {
        ctx.drawImage(rankData.image, px - squareSize / 2, py - squareSize / 2, squareSize, squareSize);
      } else {
        ctx.fillStyle = p.id === player.id ? '#ff5555' : '#5555ff';
        ctx.beginPath();
        ctx.arc(px, py, squareSize / 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawCooldownBar();
  
  if (Object.values(players).some(p => p.targetX !== null)) {
    requestAnimationFrame(drawBoard);
  }
}

function drawCooldownBar() {
  if (player.dead) return;
  const now = performance.now();
  if (now > cooldownStart + cooldownDuration) return;
  const elapsed = now - cooldownStart;
  const ratio = 1 - elapsed / cooldownDuration;
  const barWidth = squareSize * 2;
  const barHeight = 6;
  const px = (RENDER_DISTANCE + 0.5) * squareSize - barWidth / 2;
  const py = (RENDER_DISTANCE + 1) * squareSize + 4;
  ctx.fillStyle = '#fff';
  ctx.fillRect(px - 1, py - 1, barWidth + 2, barHeight + 2);
  ctx.fillStyle = '#4caf50';
  ctx.fillRect(px, py, barWidth * ratio, barHeight);
  requestAnimationFrame(drawCooldownBar);
}


function getRankIndex(rankName) {
  return ranks.findIndex(r => r.name === rankName);
}


const currentHighestIndex = getRankIndex(player.highestRank);

for (let i = ranks.length - 1; i >= 0; i--) {
  if (player.points >= (pointsToRankUp[ranks[i].name] || Infinity)) {
    if (i > currentHighestIndex) {
      player.highestRank = ranks[i].name;
    }
    break;
  }
}


function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  let clientX = e.clientX, clientY = e.clientY;
  if (e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  const viewSize = RENDER_DISTANCE * 2 + 1;
  const offsetX = cameraX;
  const offsetY = cameraY;
  const x = Math.floor((clientX - rect.left) / squareSize + offsetX);
  const y = Math.floor((clientY - rect.top) / squareSize + offsetY);
  return { x, y };
}

function isValidMove(x, y, targetX, targetY, rank) {
  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  if (targetX < 0 || targetX >= BOARD_SIZE || targetY < 0 || targetY >= BOARD_SIZE) return false;
  
  if (rank === 'Pawn') {
    return (dx + dy === 1); 
  } else if (rank === 'King') {
    return (dx <= 1 && dy <= 1) && !(dx === 0 && dy === 0); 
  } else if (rank === 'Knight') {
    return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
  } else if (rank === 'Bishop') {
    return dx === dy && dx <= 5; 
  } else if (rank === 'Rook') {
    return (dx === 0 || dy === 0) && !(dx === 0 && dy === 0); 
  } else if (rank === 'Queen') {
    return (dx === 0 || dy === 0 || dx === dy) && !(dx === 0 && dy === 0); 
  }
  return false;
}

async function handleClickEvent(e) {
  e.preventDefault();
  if (player.dead) return;
  const now = performance.now();
  if (now < moveCooldown) return;

  const pos = getCanvasPos(e);
  if (!isValidMove(player.x, player.y, pos.x, pos.y, player.rank)) return;

  let canMove = true;

  
  for (const id in players) {
    if (id !== player.id && players[id].x === pos.x && players[id].y === pos.y && !players[id].dead) {
      const capturedRank = ranks.find(r => r.name === players[id].rank) || { value: 1 };
      player.points += capturedRank.value;
      await database.ref(`players/${id}`).update({ dead: true });
      canMove = true;
    }
  }
  if (!canMove) return;

  
  player.targetX = pos.x;
  player.targetY = pos.y;
  player.animStart = now;

  
  const dx = Math.abs(pos.x - player.x);
  const dy = Math.abs(pos.y - player.y);
  const distance = dx + dy;
  playerAnimDuration = BASE_PLAYER_ANIMATION_DURATION + distance * 50; 

  player.x = pos.x;
  player.y = pos.y;

  
  const pickupRadius = 0.2;
  for (let i = randomPoints.length - 1; i >= 0; i--) {
    const point = randomPoints[i];
    const distX = Math.abs(point.x - player.x);
    const distY = Math.abs(point.y - player.y);
    if (distX <= pickupRadius && distY <= pickupRadius) {
      randomPoints.splice(i, 1);
      player.points += 1;
      showError('You collected a point! +1 point');
    }
  }

  
  targetCameraX = pos.x - RENDER_DISTANCE;
  targetCameraY = pos.y - RENDER_DISTANCE;
  cameraX = targetCameraX;
  cameraY = targetCameraY;

  
  const currentHighestIndex = getRankIndex(player.highestRank);
  for (let i = ranks.length - 1; i >= 0; i--) {
    if (player.points >= (pointsToRankUp[ranks[i].name] || Infinity)) {
      if (i > currentHighestIndex) {
        player.highestRank = ranks[i].name;
      }
      break;
    }
  }
  await savePlayer();

  
  const currentRankIndex = getRankIndex(player.rank);
  cooldownDuration = BASE_COOLDOWN - currentRankIndex * RANK_COOLDOWN_REDUCTION;
  if (cooldownDuration < MIN_COOLDOWN) cooldownDuration = MIN_COOLDOWN;
  cooldownStart = now;
  moveCooldown = cooldownStart + cooldownDuration;

  drawBoard();
  requestAnimationFrame(drawBoard);
}



const rankButtonsContainer = document.getElementById('rank-buttons-container');


if (!player.unlockedRanks) {
  player.unlockedRanks = ['Pawn']; 
}

function updateRankButtons() {
  const container = document.getElementById('rank-buttons-container');
  container.innerHTML = '';

  const highestRankIndex = getRankIndex(player.highestRank);

  for (const rank of ranks) {
    const btn = document.createElement('button');
    btn.textContent = rank.name;

    const rankIndex = getRankIndex(rank.name);
    if (rankIndex <= highestRankIndex) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
      btn.addEventListener('click', () => {
        player.rank = rank.name;
        savePlayer();
        updateUI();
        updateRankButtons();
        drawBoard();
      });
    } else {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.backgroundColor = '';
    }

    container.appendChild(btn);
  }
}

const originalUpdateUI = updateUI;
updateUI = function() {
  originalUpdateUI();
  updateRankButtons();
};


const originalSavePlayer = savePlayer;
savePlayer = async function() {
  const currentHighestIndex = getRankIndex(player.highestRank);
  for (let i = ranks.length - 1; i >= 0; i--) {
    if (player.points >= (pointsToRankUp[ranks[i].name] || Infinity)) {
      if (i > currentHighestIndex) {
        player.highestRank = ranks[i].name;
      }
      break;
    }
  }
  await originalSavePlayer();
};

function animationLoop() {
  drawBoard();
  requestAnimationFrame(animationLoop);
}


animationLoop();





function regeneratePoints() {
  const maxPoints = 1000;
  const pointsToAddEachTick = 50;

  if (randomPoints.length < maxPoints) {
    for (let i = 0; i < pointsToAddEachTick; i++) {
      randomPoints.push({
        x: Math.floor(Math.random() * BOARD_SIZE),
        y: Math.floor(Math.random() * BOARD_SIZE)
      });
    }
  }
}


setInterval(regeneratePoints, 50);




canvas.addEventListener('click', handleClickEvent);
canvas.addEventListener('touchstart', handleClickEvent, { passive: false });

// Initialize
playerNameInput.value = player.name;
cameraX = player.x - RENDER_DISTANCE;
cameraY = player.y - RENDER_DISTANCE;
targetCameraX = cameraX;
targetCameraY = cameraY;
savePlayer();
updateUI();
generateRandomPoints(50); 
