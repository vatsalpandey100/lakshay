// Landing page interactive scripts for Lakshay
document.addEventListener('DOMContentLoaded', () => {
  // Setup avatar selectors
  setupAvatarSelector('create-avatar-grid', 'create-avatar-upload');
  setupAvatarSelector('join-avatar-grid', 'join-avatar-upload');

  // Keep inputs empty with placeholders - no autofill


  // Handle Create Room
  const createForm = document.getElementById('create-room-form');
  if (createForm) {
    createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const roomName = document.getElementById('create-room-name').value.trim() || 'Watch Party';
      const username = document.getElementById('create-user-name').value.trim();
      const avatar = getSelectedAvatar('create-avatar-grid') || '🍿';

      if (!username) {
        showToast('Please enter your nickname!');
        document.getElementById('create-user-name')?.focus();
        return;
      }

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
  }

  // Handle Join Room
  const joinForm = document.getElementById('join-room-form');
  if (joinForm) {
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      let roomInput = document.getElementById('join-room-code').value.trim();
      const username = document.getElementById('join-user-name').value.trim();
      const avatar = getSelectedAvatar('join-avatar-grid') || '🍿';

      if (!roomInput) {
        showToast('Please enter a room code or invite URL!');
        document.getElementById('join-room-code')?.focus();
        return;
      }

      if (!username) {
        showToast('Please enter your nickname!');
        document.getElementById('join-user-name')?.focus();
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
  }

  // Fetch Public Rooms
  fetchPublicRooms();
  setInterval(fetchPublicRooms, 8000);
});

function setupAvatarSelector(gridId, uploadInputId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.avatar-circle-opt:not(.avatar-add-btn)');
    if (!btn) return;
    grid.querySelectorAll('.avatar-circle-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  // Handle custom upload if present
  if (uploadInputId) {
    const uploadInput = document.getElementById(uploadInputId);
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          
          // Check if custom avatar button already exists
          let customBtn = grid.querySelector('.avatar-circle-opt.custom-uploaded-avatar');
          if (!customBtn) {
            customBtn = document.createElement('button');
            customBtn.type = 'button';
            customBtn.className = 'avatar-circle-opt custom-uploaded-avatar';
            const addBtn = grid.querySelector('.avatar-add-btn');
            grid.insertBefore(customBtn, addBtn);
          }
          customBtn.dataset.emoji = dataUrl;
          customBtn.innerHTML = `<img src="${dataUrl}" alt="Custom Avatar">`;

          grid.querySelectorAll('.avatar-circle-opt').forEach(b => b.classList.remove('selected'));
          customBtn.classList.add('selected');
          showToast('Custom avatar uploaded!');
        };
        reader.readAsDataURL(file);
      });
    }
  }
}

function selectAvatar(gridId, emoji) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const match = Array.from(grid.querySelectorAll('.avatar-circle-opt')).find(b => b.dataset.emoji === emoji);
  if (match) {
    grid.querySelectorAll('.avatar-circle-opt').forEach(b => b.classList.remove('selected'));
    match.classList.add('selected');
  }
}

function getSelectedAvatar(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return '🍿';
  const selected = grid.querySelector('.avatar-circle-opt.selected');
  return selected ? selected.dataset.emoji : '🍿';
}

async function fetchPublicRooms() {
  const container = document.getElementById('public-rooms-list');
  if (!container) return;

  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();

    if (data.rooms && data.rooms.length > 0) {
      container.innerHTML = data.rooms.map(room => {
        const thumbUrl = room.currentVideo?.thumbnail || '/lounge-thumb.jpg';
        const videoTitle = room.currentVideo?.title || 'Watch Party Video';
        const roomName = room.name || `Party ${room.id}`;
        const hostName = room.hostName || 'Host';
        const watchers = room.userCount || 1;

        // Generate avatar cluster
        const defaultAvatars = ['/avatars/luffy.jpg', '/avatars/ichigo.jpg', '/avatars/gojo.jpg', '/avatars/miku.jpg'];
        const userAvatars = (room.avatars && room.avatars.length > 0) ? room.avatars : defaultAvatars;
        const avatarImgs = userAvatars.slice(0, 4).map(av => {
          if (typeof av === 'string' && (av.startsWith('/') || av.startsWith('http') || av.startsWith('data:'))) {
            return `<img src="${escapeHtml(av)}" alt="Member">`;
          }
          return `<span class="participant-avatar-emoji">${escapeHtml(av || '🍿')}</span>`;
        }).join('');

        return `
          <div class="lounge-wide-card">
            <div class="lounge-thumb-wrap">
              <img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(roomName)}" class="lounge-thumb-img" onerror="this.src='/lounge-thumb.jpg'">
              <span class="lounge-live-badge">LIVE</span>
            </div>
            <div class="lounge-info-content">
              <div class="lounge-name-row">
                <h3 class="lounge-name">${escapeHtml(roomName)}</h3>
                <span class="lounge-watchers-badge">
                  <span class="lounge-watchers-spark">✦</span> ${watchers} watching
                </span>
              </div>
              <div class="lounge-media-title">
                🎬 <span>${escapeHtml(videoTitle)}</span>
              </div>
              <div class="lounge-host-tag">
                👤 Room by <strong>${escapeHtml(hostName)}</strong>
              </div>
              <div class="participant-avatars-cluster">
                ${avatarImgs}
                <span class="participant-more">+</span>
              </div>
            </div>
            <a href="/room/${encodeURIComponent(room.id)}" class="btn-enter-theater">
              <span>Enter Theater →</span>
            </a>
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = `
        <div class="lounges-empty-state">
          <div class="empty-icon-bubble">🍿</div>
          <div class="empty-title">No Active Public Lounges Right Now</div>
          <div class="empty-sub">Be the first to start a synchronized watch party! Create your room above.</div>
          <a href="#quick-start" class="btn btn-party-action btn-purple-glow" style="max-width: 220px; margin-top: 1rem; height: 42px; font-size: 0.88rem;">
            <span>✨ Create Watch Room →</span>
          </a>
        </div>
      `;
    }
  } catch (err) {
    console.warn('Could not fetch active rooms:', err);
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
