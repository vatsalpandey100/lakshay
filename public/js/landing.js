// Landing page scripts
document.addEventListener('DOMContentLoaded', () => {
  // Setup avatar selectors
  setupAvatarSelector('create-avatar-grid');
  setupAvatarSelector('join-avatar-grid');

  // Load existing avatar from localStorage if previously used
  const savedAvatar = localStorage.getItem('syncpulse_avatar');

  // Remove prefilled 'Vatsal' or default name so the input is completely clean
  let savedName = localStorage.getItem('syncpulse_username');
  if (savedName && (savedName.trim().toLowerCase() === 'vatsal' || savedName.trim().toLowerCase() === 'lakshay')) {
    localStorage.removeItem('syncpulse_username');
    savedName = null;
  }
  const cleanSavedName = savedName || '';

  const createNameInput = document.getElementById('create-user-name');
  if (createNameInput) {
    createNameInput.value = cleanSavedName;
  }

  const joinNameInput = document.getElementById('join-user-name');
  if (joinNameInput) {
    joinNameInput.value = cleanSavedName;
  }

  if (savedAvatar) {
    selectAvatar('create-avatar-grid', savedAvatar);
    selectAvatar('join-avatar-grid', savedAvatar);
  } else {
    selectAvatar('create-avatar-grid', '🍿');
  }

  // Handle Create Room
  const createForm = document.getElementById('create-room-form');
  createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('create-room-name').value.trim() || 'Anime Cinema Party';
    const username = document.getElementById('create-user-name').value.trim();
    if (!username) {
      showToast('Please enter your nickname!');
      document.getElementById('create-user-name')?.focus();
      return;
    }
    const avatar = getSelectedAvatar('create-avatar-grid') || '🍿';

    // Save profile
    localStorage.setItem('syncpulse_username', username);
    localStorage.setItem('syncpulse_avatar', avatar);

    // Generate readable random room code
    const adjectives = ['cosmic', 'neon', 'cyber', 'velvet', 'stellar', 'midnight', 'retro', 'astral', 'hyper', 'pulse'];
    const nouns = ['cinema', 'lounge', 'theater', 'nexus', 'station', 'club', 'hub', 'orbit', 'haven', 'vault'];
    const randCode = `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${nouns[Math.floor(Math.random() * nouns.length)]}-${Math.floor(Math.random() * 899 + 100)}`;

    const hostToken = `host-tok-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
    localStorage.setItem(`lakshay_host_token_${randCode}`, hostToken);
    sessionStorage.setItem('syncpulse_host_token', hostToken);
    sessionStorage.setItem('syncpulse_is_creating', 'true');
    sessionStorage.setItem('syncpulse_room_name', roomName);

    window.location.href = `/room/${randCode}`;
  });

  // Handle Join Room
  const joinForm = document.getElementById('join-room-form');
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let roomInput = document.getElementById('join-room-code').value.trim();
    const username = document.getElementById('join-user-name').value.trim();
    const avatar = getSelectedAvatar('join-avatar-grid');

    if (!roomInput) {
      showToast('Please enter a room code or invite URL!');
      return;
    }

    if (!username) {
      showToast('Please enter your nickname!');
      return;
    }

    // Save profile
    localStorage.setItem('syncpulse_username', username);
    localStorage.setItem('syncpulse_avatar', avatar);

    // Extract room ID if full URL pasted
    if (roomInput.includes('/room/')) {
      const parts = roomInput.split('/room/');
      roomInput = parts[1].split('?')[0].split('#')[0];
    }

    // Remove unwanted query parameters or trailing slashes
    roomInput = roomInput.replace(/\/+$/, '');

    window.location.href = `/room/${encodeURIComponent(roomInput)}`;
  });

  // Fetch Public Rooms
  fetchPublicRooms();
});

function setupAvatarSelector(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.avatar-choice');
    if (!btn) return;
    grid.querySelectorAll('.avatar-choice').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
}

function selectAvatar(gridId, emoji) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const match = Array.from(grid.querySelectorAll('.avatar-choice')).find(b => b.dataset.emoji === emoji);
  if (match) {
    grid.querySelectorAll('.avatar-choice').forEach(b => b.classList.remove('selected'));
    match.classList.add('selected');
  }
}

function getSelectedAvatar(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return '🍿';
  const selected = grid.querySelector('.avatar-choice.selected');
  return selected ? selected.dataset.emoji : '🍿';
}

async function fetchPublicRooms() {
  const container = document.getElementById('public-rooms-list');
  if (!container) return;

  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();

    if (!data.rooms || data.rooms.length === 0) {
      container.innerHTML = `
        <div class="room-preview-card" style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem;">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🍿</div>
          <h3 style="font-size: 1.1rem; margin-bottom: 0.4rem;">No Active Public Lounges Right Now</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.25rem;">Start your own party and invite friends with a single click!</p>
          <a href="#quick-start" class="btn btn-primary btn-sm">Launch a Room</a>
        </div>
      `;
      return;
    }

    container.innerHTML = data.rooms.map(room => `
      <div class="room-preview-card">
        <div>
          <div class="room-card-header">
            <h3 style="font-size: 1.05rem; font-weight: 700;">${escapeHtml(room.name)}</h3>
            <span class="room-user-badge">
              <span class="pulse-circle"></span>
              ${room.userCount} watching
            </span>
          </div>
          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            🎬 ${escapeHtml(room.currentVideo?.title || 'Video')}
          </p>
        </div>
        <a href="/room/${room.id}" class="btn btn-secondary btn-sm" style="width: 100%;">
          Enter Theater
        </a>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to fetch rooms', err);
  }
}

function showToast(text) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>✨</span><span>${escapeHtml(text)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
