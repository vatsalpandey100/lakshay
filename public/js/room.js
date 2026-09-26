// SyncPulse Cinema Room Controller
(() => {
  // State
  let socket = null;
  let roomId = null;
  let currentUser = null;
  let roomState = null;
  let isSyncingFromServer = false;
  let ytPlayer = null;
  let isYtReady = false;
  let activePlayerType = 'html5'; // 'html5' | 'youtube'
  let ambientAnimationId = null;
  let syncInterval = null;
  let ntpInterval = null;

  // Zero-Lag NTP & Rate Steering State
  let serverClockOffset = 0;
  let rttLatencyMs = 0;
  let basePlaybackRate = 1.0;
  let lastAmbientFrame = 0;

  // DOM Elements
  const html5Player = document.getElementById('html5-player');
  const ytPlayerContainer = document.getElementById('youtube-player-frame');
  const playerWrapper = document.getElementById('player-wrapper');
  const videoViewport = document.getElementById('video-viewport');
  const ambientCanvas = document.getElementById('ambient-canvas');
  const ambientCtx = ambientCanvas?.getContext('2d');
  const actionSplash = document.getElementById('action-splash');
  const playPauseBtn = document.getElementById('ctrl-play-pause');
  const playPauseIcon = document.getElementById('play-pause-icon');
  const timelineTrack = document.getElementById('timeline-track');
  const timelineFill = document.getElementById('timeline-fill');
  const timelineBuffer = document.getElementById('timeline-buffer');
  const timelineScrubber = document.getElementById('timeline-scrubber');
  const timelineHoverTime = document.getElementById('timeline-hover-time');
  const timeCurrentEl = document.getElementById('time-current');
  const timeDurationEl = document.getElementById('time-duration');
  const volumeSlider = document.getElementById('ctrl-volume-slider');
  const muteBtn = document.getElementById('ctrl-mute-btn');
  const muteIcon = document.getElementById('mute-icon');
  const rateSelect = document.getElementById('ctrl-playback-rate');
  const fullscreenBtn = document.getElementById('ctrl-fullscreen-btn');
  const pipBtn = document.getElementById('ctrl-pip-btn');
  const syncBeaconBtn = document.getElementById('sync-beacon-btn');
  const syncStatusText = document.getElementById('sync-status-text');
  const activeVideoTitle = document.getElementById('active-video-title');
  const chatMessagesList = document.getElementById('chat-messages-list');
  const chatForm = document.getElementById('chat-send-form');
  const chatInput = document.getElementById('chat-text-input');
  const queueItemsList = document.getElementById('queue-items-list');
  const membersItemsList = document.getElementById('members-items-list');
  const floatingContainer = document.getElementById('floating-reactions');
  const copyCodeBtn = document.getElementById('copy-code-btn');
  const roomIdDisplay = document.getElementById('room-id-display');
  const roomNameHeader = document.getElementById('room-name-header');

  // Extract Room ID
  const pathParts = window.location.pathname.split('/');
  roomId = decodeURIComponent(pathParts[pathParts.length - 1] || 'default-room');
  if (roomIdDisplay) roomIdDisplay.textContent = roomId;

  // Avatar Formatting Helper (supports emoji and image URLs)
  function renderAvatar(avatar) {
    if (!avatar) return '🍿';
    if (avatar.startsWith('/') || avatar.startsWith('http') || avatar.includes('.jpg') || avatar.includes('.png')) {
      return `<img src="${avatar}" alt="Avatar" class="avatar-img" style="width:100%;height:100%;max-width:100%;max-height:100%;object-fit:cover;border-radius:inherit;display:block;">`;
    }
    return avatar;
  }

  // Dynamic Media Section placement between desktop and mobile tabs
  function syncMediaSectionPlacement() {
    const isMobile = window.innerWidth <= 768;
    const mediaSection = document.getElementById('media-source-section');
    const desktopContainer = document.getElementById('desktop-media-container');
    const mobileContainer = document.getElementById('mobile-media-container');
    if (!mediaSection) return;

    if (isMobile) {
      if (mobileContainer && mediaSection.parentElement !== mobileContainer) {
        mobileContainer.appendChild(mediaSection);
      }
    } else {
      if (desktopContainer && mediaSection.parentElement !== desktopContainer) {
        desktopContainer.appendChild(mediaSection);
      }
    }
  }
  window.addEventListener('resize', syncMediaSectionPlacement);
  syncMediaSectionPlacement();

  // Sound Synthesizer via Web Audio API (Zero external assets)
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playUiTone(type) {
    const soundEnabled = document.getElementById('setting-sound-effects')?.checked ?? true;
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'chat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'pop') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(554.37, now + 0.09);
        osc.frequency.setValueAtTime(659.25, now + 0.18);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      } else if (type === 'mention') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.28);
      }
    } catch (e) {
      // Audio autoplay restriction fallback
    }
  }

  // Check Profile
  const storedName = localStorage.getItem('syncpulse_username');
  const storedAvatar = localStorage.getItem('syncpulse_avatar') || '🍿';

  if (!storedName) {
    // Show prompt modal
    const promptModal = document.getElementById('modal-profile-prompt');
    promptModal.classList.add('open');
    setupAvatarPicker('prompt-avatar-grid');

    document.getElementById('profile-prompt-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('prompt-username').value.trim();
      const grid = document.getElementById('prompt-avatar-grid');
      const av = grid.querySelector('.avatar-choice.selected')?.dataset.emoji || '🍿';
      if (name) {
        localStorage.setItem('syncpulse_username', name);
        localStorage.setItem('syncpulse_avatar', av);
        promptModal.classList.remove('open');
        initSocket(name, av);
      }
    });
  } else {
    initSocket(storedName, storedAvatar);
  }

  // Initialize Socket.io Connection
  function initSocket(username, avatar) {
    socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    const storedRoomName = sessionStorage.getItem('syncpulse_room_name');
    const isCreating = sessionStorage.getItem('syncpulse_is_creating') === 'true';

    function sendJoinRoom() {
      const hostToken = sessionStorage.getItem('syncpulse_host_token') || localStorage.getItem('lakshay_host_token_' + roomId);
      socket.emit('join-room', {
        roomId,
        username,
        avatar,
        roomName: storedRoomName,
        hostToken,
        isCreating
      });
    }

    // Always emit join-room on initial connect and on every reconnect
    if (socket.connected) {
      sendJoinRoom();
    }
    socket.on('connect', () => {
      sendJoinRoom();
    });

    socket.on('room-state', (data) => {
      roomState = data.room;
      currentUser = data.you;

      if (data.you.hostToken) {
        localStorage.setItem(`lakshay_host_token_${roomId}`, data.you.hostToken);
      }

      applyHostViewerPermissions(currentUser.isHost);

      if (roomNameHeader && roomState.name) {
        roomNameHeader.textContent = roomState.name;
        document.title = `${roomState.name} — Lakshay`;
      }

      // Update Host lock checkbox
      const hostLockCheckbox = document.getElementById('setting-host-lock');
      if (hostLockCheckbox) {
        hostLockCheckbox.checked = roomState.isHostOnly;
        hostLockCheckbox.disabled = !currentUser.isHost;
      }

      // Render room state
      renderChatMessages(roomState.messages);
      renderQueue(roomState.queue);
      renderMembers(roomState.users);
      loadVideoSource(roomState.currentVideo, roomState.playback.currentTime, roomState.playback.state === 'playing');

      // Periodic sync check & NTP time synchronization
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(() => {
        socket.emit('query-sync');
      }, 5000);

      if (ntpInterval) clearInterval(ntpInterval);
      pingNtp();
      ntpInterval = setInterval(pingNtp, 4000);
    });

    // High-precision NTP clock offset measuring (Cristian's Algorithm)
    function pingNtp() {
      if (socket && socket.connected) {
        socket.emit('ntp-ping', performance.now());
      }
    }

    socket.on('ntp-pong', ({ clientSendTime, serverTime }) => {
      const rtt = performance.now() - clientSendTime;
      rttLatencyMs = Math.round(rtt / 2);
      const serverEstimatedNow = serverTime + (rtt / 2);
      const offset = serverEstimatedNow - Date.now();
      serverClockOffset = serverClockOffset === 0 ? offset : (serverClockOffset * 0.7 + offset * 0.3);
    });

    socket.on('user-joined', ({ user, users, message }) => {
      renderMembers(users);
      appendChatMessage(message);
      playUiTone('join');
    });

    socket.on('user-left', ({ users, message }) => {
      renderMembers(users);
      appendChatMessage(message);
    });

    socket.on('sync-playback', (data) => {
      handleServerPlaybackSync(data);
    });

    socket.on('sync-response', (data) => {
      handleTimeDriftCheck(data);
    });

    socket.on('peer-upload-progress', ({ sender, filename, progress }) => {
      const streamTransferBanner = document.getElementById('stream-transfer-banner');
      const streamTransferTitle = document.getElementById('stream-transfer-title');
      const streamTransferPercent = document.getElementById('stream-transfer-percent');
      const streamTransferBar = document.getElementById('stream-transfer-bar');
      const playerStreamBeacon = document.getElementById('player-stream-beacon');
      const playerStreamBeaconText = document.getElementById('player-stream-beacon-text');

      if (streamTransferBanner) {
        if (streamTransferTitle) streamTransferTitle.textContent = `📡 ${sender} is transmitting "${filename}" to your screen...`;
        if (streamTransferPercent) streamTransferPercent.textContent = `${progress}%`;
        if (streamTransferBar) streamTransferBar.style.width = `${progress}%`;
        streamTransferBanner.style.display = 'block';
      }
      if (playerStreamBeacon) {
        if (playerStreamBeaconText) playerStreamBeaconText.textContent = `📡 ${sender} transmitting anime • ${progress}%`;
        playerStreamBeacon.style.display = 'flex';
      }
      if (progress >= 100) {
        setTimeout(() => {
          if (streamTransferBanner) streamTransferBanner.style.display = 'none';
          if (playerStreamBeacon) playerStreamBeacon.style.display = 'none';
        }, 1800);
      }
    });

    socket.on('video-changed', ({ currentVideo, playback, message }) => {
      if (roomState) {
        roomState.currentVideo = currentVideo;
        roomState.playback = playback;
      }
      const streamTransferBanner = document.getElementById('stream-transfer-banner');
      const playerStreamBeacon = document.getElementById('player-stream-beacon');
      if (streamTransferBanner) streamTransferBanner.style.display = 'none';
      if (playerStreamBeacon) playerStreamBeacon.style.display = 'none';

      loadVideoSource(currentVideo, playback.currentTime || 0, playback.state === 'playing');
      appendChatMessage(message);
      showToast(`🎬 Video changed: ${currentVideo.title}`);
    });

    socket.on('queue-updated', ({ queue, message }) => {
      if (roomState) roomState.queue = queue;
      renderQueue(queue);
      if (message) appendChatMessage(message);
    });

    socket.on('new-message', (msg) => {
      appendChatMessage(msg);
      playUiTone('chat');
    });

    socket.on('user-typing', ({ socketId, username, avatar, isTyping }) => {
      if (typeof handleUserTypingEvent === 'function') {
        handleUserTypingEvent({ socketId, username, avatar, isTyping });
      }
    });

    socket.on('floating-reaction', (data) => {
      spawnFloatingReaction(data.emoji);
      triggerReactionPill(data.emoji);
      playUiTone('pop');
    });

    socket.on('host-lock-changed', ({ isHostOnly, message }) => {
      if (roomState) roomState.isHostOnly = isHostOnly;
      const hostLockCheckbox = document.getElementById('setting-host-lock');
      if (hostLockCheckbox) hostLockCheckbox.checked = isHostOnly;
      appendChatMessage(message);
      showToast(isHostOnly ? '🔒 Host control locked.' : '🔓 Room control unlocked.');
    });

    socket.on('host-transferred', ({ hostId, users, message }) => {
      if (roomState) roomState.hostId = hostId;
      if (currentUser) currentUser.isHost = hostId === socket.id;
      const hostLockCheckbox = document.getElementById('setting-host-lock');
      if (hostLockCheckbox) hostLockCheckbox.disabled = !currentUser.isHost;
      renderMembers(users);
      appendChatMessage(message);
    });

    socket.on('error-msg', ({ message }) => {
      showToast(`⚠️ ${message}`);
    });

    socket.on('local-file-prompt', (data) => {
      const matchBanner = document.getElementById('local-file-match-banner');
      const filenameDisplay = document.getElementById('match-filename-display');
      if (matchBanner && filenameDisplay) {
        filenameDisplay.textContent = data.filename || data.title;
        matchBanner.style.display = 'block';
        showToast(`⚡ Host started playing "${data.filename}". Select this file on your device to sync instantly!`);
      }
    });
  }

  // Video Source Loader (Dual Engine: HTML5 & YouTube)
  function loadVideoSource(video, startTime = 0, autoPlay = true) {
    if (!video || !video.url) return;
    if (activeVideoTitle) activeVideoTitle.textContent = video.title || 'Untitled Video';

    const isYoutube = video.type === 'youtube' || isYoutubeUrl(video.url);
    activePlayerType = isYoutube ? 'youtube' : 'html5';

    if (isYoutube) {
      const videoId = extractYoutubeId(video.url);
      html5Player.pause();
      html5Player.style.display = 'none';
      ytPlayerContainer.style.display = 'block';

      if (isYtReady && ytPlayer && ytPlayer.loadVideoById) {
        isSyncingFromServer = true;
        ytPlayer.loadVideoById({ videoId, startSeconds: startTime });
        if (!autoPlay) ytPlayer.pauseVideo();
        setTimeout(() => { isSyncingFromServer = false; }, 600);
      } else {
        initYoutubePlayer(videoId, startTime, autoPlay);
      }
    } else {
      // Direct HTML5 video
      if (ytPlayer && ytPlayer.pauseVideo) {
        try { ytPlayer.pauseVideo(); } catch (e) {}
      }
      ytPlayerContainer.style.display = 'none';
      html5Player.style.display = 'block';

      isSyncingFromServer = true;
      const targetSrc = new URL(video.url, window.location.href).href;
      const needsSrcChange = html5Player.src !== targetSrc;
      if (needsSrcChange) {
        html5Player.src = targetSrc;
        try { html5Player.load(); } catch (e) {}
      }

      let hasExecuted = false;
      const applySeekAndPlay = () => {
        if (hasExecuted) return;
        hasExecuted = true;

        if (startTime > 0) {
          try {
            html5Player.currentTime = startTime;
          } catch (e) {
            console.warn('Seek error:', e);
          }
        }

        if (autoPlay) {
          const playPromise = html5Player.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              hideViewerStartOverlay();
            }).catch((err) => {
              console.warn('Autoplay blocked by browser policy:', err);
              // Fallback 1: Play muted immediately (browsers always permit muted autoplay)
              html5Player.muted = true;
              html5Player.play().then(() => {
                showAutoplayUnmutePrompt();
                hideViewerStartOverlay();
              }).catch(() => {
                // Fallback 2: Show viewer click overlay to unlock playback on user tap
                showViewerStartOverlay();
              });
            });
          }
        } else {
          html5Player.pause();
        }
        setTimeout(() => { isSyncingFromServer = false; }, 500);
      };

      if (!needsSrcChange && html5Player.readyState >= 1) {
        applySeekAndPlay();
      } else {
        html5Player.addEventListener('loadedmetadata', applySeekAndPlay, { once: true });
        html5Player.addEventListener('canplay', applySeekAndPlay, { once: true });
        // Guarantee execution: if browser metadata event is delayed, fire within 350ms
        setTimeout(applySeekAndPlay, 350);
      }
    }

    updatePlayPauseIcon(!autoPlay);
    startAmbientGlow();
  }

  // YouTube IFrame API Setup
  function initYoutubePlayer(videoId, startSeconds = 0, autoPlay = true) {
    if (window.YT && window.YT.Player) {
      createYtPlayerInstance(videoId, startSeconds, autoPlay);
    } else {
      window.onYouTubeIframeAPIReady = () => {
        createYtPlayerInstance(videoId, startSeconds, autoPlay);
      };
    }
  }

  function createYtPlayerInstance(videoId, startSeconds = 0, autoPlay = true) {
    if (ytPlayer && ytPlayer.destroy) {
      try { ytPlayer.destroy(); } catch (e) {}
    }

    ytPlayer = new YT.Player('youtube-player-frame', {
      videoId: videoId,
      playerVars: {
        autoplay: autoPlay ? 1 : 0,
        controls: 0, // Use our sleek custom controls
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        start: Math.floor(startSeconds)
      },
      events: {
        onReady: (event) => {
          isYtReady = true;
          if (startSeconds > 0) event.target.seekTo(startSeconds, true);
          if (autoPlay) event.target.playVideo();
          event.target.setVolume((volumeSlider?.value || 0.9) * 100);
        },
        onStateChange: (event) => {
          handleYtStateChange(event);
        }
      }
    });
  }

  function handleYtStateChange(event) {
    if (isSyncingFromServer) return;
    if (roomState && roomState.isHostOnly && !currentUser?.isHost) return;

    if (event.data === YT.PlayerState.PLAYING) {
      updatePlayPauseIcon(false);
      emitPlaybackAction('play', ytPlayer.getCurrentTime());
      triggerActionSplash('▶');
    } else if (event.data === YT.PlayerState.PAUSED) {
      updatePlayPauseIcon(true);
      emitPlaybackAction('pause', ytPlayer.getCurrentTime());
      triggerActionSplash('⏸');
    }
  }

  // Accurate server time calculation using measured NTP offset
  function getAccurateServerTime() {
    return Date.now() + serverClockOffset;
  }

  // Smooth Rate-Steering & Zero-Lag Playback Synchronizer
  function applySmartSync(targetTime, state, desiredRate = 1.0, isActionSplash = false, splashIcon = '▶') {
    isSyncingFromServer = true;
    basePlaybackRate = desiredRate;
    const localTime = getCurrentPlaybackTime();
    const drift = localTime - targetTime; // > 0: ahead of server, < 0: behind server
    const absDrift = Math.abs(drift);

    updateSyncStatusBeacon(absDrift, rttLatencyMs);

    if (state === 'paused') {
      // For paused state: hard seek only if drift is perceptible
      if (absDrift > 0.18) {
        seekToTime(targetTime);
      }
      pauseActivePlayer();
      restorePlaybackRate(desiredRate);
    } else {
      // For playing state: NO HARD SEEKS unless major jump!
      // This eliminates 100% of buffer flushes and video stuttering.
      if (absDrift <= 0.12) {
        // Imperceptible drift (within 120ms): optimal sync
        restorePlaybackRate(desiredRate);
      } else if (absDrift <= 1.3) {
        // Micro pitch-rate steering: smoothly glide into sync without pause!
        if (drift < 0) {
          // Slightly behind: speed up by 6% to catch up seamlessly
          setEnginePlaybackRate(desiredRate * 1.06);
        } else {
          // Slightly ahead: slow down by 6% to allow host to catch up
          setEnginePlaybackRate(desiredRate * 0.94);
        }
      } else {
        // Large skip / seek (> 1.3s): hard seek then continue
        seekToTime(targetTime);
        restorePlaybackRate(desiredRate);
      }

      playActivePlayer();
    }

    if (isActionSplash) {
      triggerActionSplash(splashIcon);
    }

    setTimeout(() => {
      isSyncingFromServer = false;
    }, 450);
  }

  function setEnginePlaybackRate(rate) {
    if (activePlayerType === 'html5') {
      html5Player.playbackRate = rate;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.setPlaybackRate) {
      ytPlayer.setPlaybackRate(rate);
    }
  }

  function restorePlaybackRate(rate) {
    setEnginePlaybackRate(rate || basePlaybackRate || 1.0);
  }

  // Server Playback Sync Event Handler
  function handleServerPlaybackSync(data) {
    const accurateNow = getAccurateServerTime();
    const elapsed = Math.max(0, (accurateNow - data.serverTime) / 1000);
    const targetTime = data.state === 'playing'
      ? data.currentTime + elapsed * (data.playbackRate || 1.0)
      : data.currentTime;

    const icon = data.action === 'play' ? '▶' : (data.action === 'pause' ? '⏸' : '⚡');
    applySmartSync(targetTime, data.state, data.playbackRate || 1.0, true, icon);
  }

  // Periodic Drift Checker (Checks in background without interrupting playback)
  function handleTimeDriftCheck(data) {
    const accurateNow = getAccurateServerTime();
    const elapsed = Math.max(0, (accurateNow - data.serverTime) / 1000);
    const targetTime = data.state === 'playing'
      ? data.currentTime + elapsed * (data.playbackRate || 1.0)
      : data.currentTime;

    applySmartSync(targetTime, data.state, data.playbackRate || 1.0, false);
  }

  function updateSyncStatusBeacon(drift, ping) {
    if (!syncBeaconBtn || !syncStatusText) return;
    const pingStr = ping ? ` • ${ping}ms` : '';
    if (drift > 1.3) {
      syncBeaconBtn.classList.add('desync');
      syncStatusText.textContent = `Drift (${drift.toFixed(1)}s${pingStr}) • Resync`;
    } else {
      syncBeaconBtn.classList.remove('desync');
      syncStatusText.textContent = `In Sync (${Math.max(0.01, drift).toFixed(2)}s${pingStr})`;
    }
  }

  // Action Dispatcher
  function emitPlaybackAction(action, currentTime, playbackRate) {
    if (!socket) return;
    if (roomState && roomState.isHostOnly && !currentUser?.isHost) {
      showToast('⚠️ Playback is currently locked to host only.');
      return;
    }
    socket.emit('playback-action', {
      action,
      currentTime,
      playbackRate: playbackRate || Number(rateSelect?.value || 1.0)
    });
  }

  function getCurrentPlaybackTime() {
    if (activePlayerType === 'html5' && html5Player) {
      const t = html5Player.currentTime;
      if (typeof t === 'number' && !isNaN(t) && t > 0) return t;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.getCurrentTime) {
      const t = ytPlayer.getCurrentTime();
      if (typeof t === 'number' && !isNaN(t) && t > 0) return t;
    }
    // Fallback to roomState calculated playback time so timestamp never freezes
    if (roomState && roomState.playback) {
      if (roomState.playback.state === 'playing') {
        const elapsed = (Date.now() - roomState.playback.lastTimestamp) / 1000;
        return Math.max(0, (roomState.playback.currentTime || 0) + elapsed * (roomState.playback.playbackRate || 1.0));
      }
      return roomState.playback.currentTime || 0;
    }
    return 0;
  }

  function getPlaybackDuration() {
    if (activePlayerType === 'html5' && html5Player) {
      return html5Player.duration || 0;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.getDuration) {
      return ytPlayer.getDuration() || 0;
    }
    return 0;
  }

  function seekToTime(seconds) {
    const time = Math.max(0, seconds);
    if (activePlayerType === 'html5' && html5Player) {
      html5Player.currentTime = time;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.seekTo) {
      ytPlayer.seekTo(time, true);
    }
    if (timeCurrentEl) timeCurrentEl.textContent = formatTime(time);
    updateTimelineProgress();
  }

  const unmuteBanner = document.getElementById('unmute-banner');
  function showAutoplayUnmutePrompt() {
    if (unmuteBanner) unmuteBanner.style.display = 'block';
  }
  function hideAutoplayUnmutePrompt() {
    if (unmuteBanner) unmuteBanner.style.display = 'none';
  }

  // Pointer listener to dismiss unmute prompt and restore audio
  window.addEventListener('pointerdown', () => {
    if (html5Player && html5Player.muted && unmuteBanner && unmuteBanner.style.display === 'block') {
      html5Player.muted = false;
      hideAutoplayUnmutePrompt();
      showToast('🔊 Audio unmuted & synced with Lakshay');
    }
  }, { passive: true });

  if (unmuteBanner) {
    unmuteBanner.addEventListener('click', () => {
      if (html5Player) {
        html5Player.muted = false;
        hideAutoplayUnmutePrompt();
        showToast('🔊 Audio unmuted & synced with Lakshay');
      }
    });
  }

  function playActivePlayer() {
    if (activePlayerType === 'html5') {
      const p = html5Player.play();
      if (p !== undefined) {
        p.catch(() => {
          // Mobile Autoplay Policy fallback: start muted & prompt user to tap to unmute
          html5Player.muted = true;
          html5Player.play().catch(() => {});
          showAutoplayUnmutePrompt();
        });
      }
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.playVideo) {
      ytPlayer.playVideo();
    }
    updatePlayPauseIcon(false);
  }

  function pauseActivePlayer() {
    if (activePlayerType === 'html5') {
      html5Player.pause();
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.pauseVideo) {
      ytPlayer.pauseVideo();
    }
    updatePlayPauseIcon(true);
  }

  function isPaused() {
    if (activePlayerType === 'html5') {
      return html5Player.paused;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.getPlayerState) {
      return ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING;
    }
    return true;
  }

  const viewerStartOverlay = document.getElementById('viewer-start-overlay');
  function showViewerStartOverlay() {
    if (viewerStartOverlay) viewerStartOverlay.style.display = 'flex';
  }
  function hideViewerStartOverlay() {
    if (viewerStartOverlay) viewerStartOverlay.style.display = 'none';
  }

  if (viewerStartOverlay) {
    viewerStartOverlay.addEventListener('click', () => {
      hideViewerStartOverlay();
      html5Player.muted = false;
      playActivePlayer();
      const hostTime = roomState?.playback?.currentTime || getCurrentPlaybackTime();
      if (hostTime > 0) {
        seekToTime(hostTime);
      }
      showToast('▶ In sync with Lakshay');
    });
  }

  function togglePlayPause() {
    if (roomState && roomState.isHostOnly && !currentUser?.isHost) {
      // If room is playing but viewer is paused/blocked, allow viewer to resume playback locally!
      if (roomState.playback?.state === 'playing' && isPaused()) {
        hideViewerStartOverlay();
        html5Player.muted = false;
        playActivePlayer();
        const hostTime = roomState.playback?.currentTime || getCurrentPlaybackTime();
        if (hostTime > 0) seekToTime(hostTime);
        showToast('▶ Resumed sync with Lakshay');
        return;
      }
      showToast('🔒 Only Host (Lakshay) can pause or seek for the room.');
      return;
    }

    const paused = isPaused();
    const currTime = getCurrentPlaybackTime();

    if (paused) {
      playActivePlayer();
      emitPlaybackAction('play', currTime);
      triggerActionSplash('▶');
    } else {
      pauseActivePlayer();
      emitPlaybackAction('pause', currTime);
      triggerActionSplash('⏸');
    }
  }

  function updatePlayPauseIcon(isPausedState) {
    if (playPauseIcon) playPauseIcon.textContent = isPausedState ? '▶' : '⏸';
    const soundWaves = document.getElementById('island-sound-waves');
    if (soundWaves) soundWaves.style.display = isPausedState ? 'none' : 'flex';
  }

  function triggerActionSplash(icon) {
    if (!actionSplash) return;
    actionSplash.textContent = icon;
    actionSplash.classList.remove('splash-active');
    void actionSplash.offsetWidth; // trigger reflow
    actionSplash.classList.add('splash-active');
    setTimeout(() => {
      actionSplash.classList.remove('splash-active');
    }, 450);
  }

  // Custom Controls Timeline & Event Bindings
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);

  // Controls Auto-Hide & Cursor Management
  // User Requirement: Hovering through bottom 1/10 of video then only that control should be shown
  let controlsHideTimer = null;
  let isSubtitleMenuOpen = false;
  let isScrubbingTimeline = false;

  function isCursorInBottomTenth(e) {
    if (!playerWrapper) return false;
    if (e.target && e.target.closest && e.target.closest('#custom-controls')) return true;
    const rect = playerWrapper.getBoundingClientRect();
    if (!rect || !rect.height) return false;
    const mouseY = e.clientY - rect.top;
    return mouseY >= (rect.height * 0.90);
  }

  let cursorHideTimer = null;

  function showControls(durationMs = 3200) {
    if (!playerWrapper) return;
    playerWrapper.classList.add('show-controls');
    playerWrapper.classList.remove('hide-cursor', 'hide-controls-idle');
    clearTimeout(controlsHideTimer);

    controlsHideTimer = setTimeout(() => {
      if (isSubtitleMenuOpen || isScrubbingTimeline) return;
      playerWrapper.classList.remove('show-controls');
      playerWrapper.classList.add('hide-controls-idle');
    }, durationMs);
  }

  function hideControlsOnly() {
    // Only hides the controls bar — NEVER hides the cursor immediately
    if (!playerWrapper) return;
    if (isSubtitleMenuOpen || isScrubbingTimeline) return;
    playerWrapper.classList.remove('show-controls', 'is-paused');
    playerWrapper.classList.add('hide-controls-idle');
  }

  function hideControlsNow() {
    if (!playerWrapper) return;
    if (isSubtitleMenuOpen || isScrubbingTimeline) return;
    playerWrapper.classList.remove('show-controls', 'is-paused');
    playerWrapper.classList.add('hide-cursor', 'hide-controls-idle');
  }

  function resetCursorIdleTimer() {
    if (!playerWrapper) return;
    playerWrapper.classList.remove('hide-cursor');
    clearTimeout(cursorHideTimer);
    cursorHideTimer = setTimeout(() => {
      if (!isScrubbingTimeline && !isSubtitleMenuOpen) {
        playerWrapper.classList.add('hide-cursor');
      }
    }, 2800);
  }

  if (playerWrapper) {
    // Show controls initially briefly
    showControls(3000);

    // Mouse movement: Controls only show when hovering bottom 1/10th, cursor always remains visible while moving
    playerWrapper.addEventListener('mouseenter', (e) => {
      resetCursorIdleTimer();
      if (isCursorInBottomTenth(e)) {
        showControls(3200);
      } else {
        hideControlsOnly();
      }
    });

    playerWrapper.addEventListener('mousemove', (e) => {
      resetCursorIdleTimer();
      if (isCursorInBottomTenth(e) || isScrubbingTimeline) {
        showControls(3200);
      } else {
        if (!isScrubbingTimeline && !isSubtitleMenuOpen) {
          hideControlsOnly();
        }
      }
    });

    // Mouse leaving player hides controls immediately
    playerWrapper.addEventListener('mouseleave', () => {
      clearTimeout(controlsHideTimer);
      hideControlsNow();
    });

    // Touch support for mobile
    playerWrapper.addEventListener('touchstart', (e) => {
      if (e.target.closest('#custom-controls') || e.target.closest('.floating-reaction-item') || e.target.closest('#video-floating-chat-overlay') || e.target.closest('#video-corner-chat-btn')) return;
      const touch = e.touches[0];
      if (touch) {
        const rect = playerWrapper.getBoundingClientRect();
        const touchY = touch.clientY - rect.top;
        if (touchY >= rect.height * 0.88) {
          showControls(3500);
        }
      }
    }, { passive: true });
  }

  if (videoViewport) {
    // Click on video viewport toggles play/pause or toggles controls on touch
    document.getElementById('video-viewport')?.addEventListener('click', (e) => {
      if (
        e.target.closest('#custom-controls') || 
        e.target.closest('.floating-reaction-item') || 
        e.target.closest('#subtitle-menu') ||
        e.target.closest('#video-floating-chat-overlay') ||
        e.target.closest('#video-corner-chat-btn')
      ) return;
      if (window.innerWidth <= 768 && playerWrapper) {
        if (!playerWrapper.classList.contains('show-controls')) {
          showControls(3500);
          return;
        }
      }
      togglePlayPause();
    });
  }

  // HTML5 Video Events
  html5Player.addEventListener('play', () => {
    showControls(2500);
    if (isSyncingFromServer) return;
    updatePlayPauseIcon(false);
    emitPlaybackAction('play', html5Player.currentTime);
  });

  html5Player.addEventListener('pause', () => {
    if (playerWrapper) {
      playerWrapper.classList.add('show-controls');
      playerWrapper.classList.remove('hide-cursor');
    }
    clearTimeout(controlsHideTimer);
    if (isSyncingFromServer) return;
    updatePlayPauseIcon(true);
    emitPlaybackAction('pause', html5Player.currentTime);
  });

  html5Player.addEventListener('seeked', () => {
    if (isSyncingFromServer) return;
    emitPlaybackAction('seek', html5Player.currentTime);
  });

  // Timeline Scrubber Updates
  function updateProgress() {
    const current = getCurrentPlaybackTime();
    const duration = getPlaybackDuration();

    if (timeCurrentEl) timeCurrentEl.textContent = formatTime(current);
    if (timeDurationEl && duration > 0) timeDurationEl.textContent = formatTime(duration);

    if (duration > 0) {
      const pct = (current / duration) * 100;
      if (timelineFill) timelineFill.style.width = `${pct}%`;
      if (timelineScrubber) timelineScrubber.style.left = `${pct}%`;
    }

    // Buffer percentage
    if (activePlayerType === 'html5' && html5Player.buffered.length > 0 && duration > 0) {
      const bufferedEnd = html5Player.buffered.end(html5Player.buffered.length - 1);
      const bufPct = (bufferedEnd / duration) * 100;
      if (timelineBuffer) timelineBuffer.style.width = `${bufPct}%`;
    }

    // Synced Subtitle text rendering
    if (typeof updateSubtitleDisplay === 'function') {
      updateSubtitleDisplay(current);
    }

    requestAnimationFrame(updateProgress);
  }
  requestAnimationFrame(updateProgress);

  // Timeline Click / Scrub
  let isDraggingScrubber = false;
  if (timelineTrack) {
    timelineTrack.addEventListener('click', (e) => {
      if (roomState && roomState.isHostOnly && !currentUser?.isHost) {
        showToast('🔒 Only Host (Lakshay) can seek the video.');
        return;
      }
      const rect = timelineTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = getPlaybackDuration();
      if (duration > 0) {
        const seekTarget = pos * duration;
        seekToTime(seekTarget);
        emitPlaybackAction('seek', seekTarget);
      }
    });

    // Touch Support for Mobile (iPhone, Pixel, Samsung)
    function handleTouchTimeline(e) {
      if (roomState && roomState.isHostOnly && !currentUser?.isHost) return;
      const touch = e.touches[0] || e.changedTouches[0];
      if (!touch) return;
      const rect = timelineTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      const duration = getPlaybackDuration();
      if (duration > 0) {
        const seekTarget = pos * duration;
        seekToTime(seekTarget);
        if (e.type === 'touchend') {
          emitPlaybackAction('seek', seekTarget);
        }
      }
    }
    timelineTrack.addEventListener('touchstart', handleTouchTimeline, { passive: true });
    timelineTrack.addEventListener('touchmove', handleTouchTimeline, { passive: true });
    timelineTrack.addEventListener('touchend', handleTouchTimeline, { passive: true });

    timelineTrack.addEventListener('mousemove', (e) => {
      const rect = timelineTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = getPlaybackDuration();
      if (duration > 0 && timelineHoverTime) {
        timelineHoverTime.style.display = 'block';
        timelineHoverTime.style.left = `${pos * 100}%`;
        timelineHoverTime.textContent = formatTime(pos * duration);
      }
    });

    timelineTrack.addEventListener('mouseleave', () => {
      if (timelineHoverTime) timelineHoverTime.style.display = 'none';
    });
  }

  // Host vs Guest Viewer Mode
  function applyHostViewerPermissions(isHost) {
    const playPause = document.getElementById('ctrl-play-pause');
    const rewindBtn = document.getElementById('ctrl-rewind');
    const forwardBtn = document.getElementById('ctrl-forward');
    const playNowBtn = document.getElementById('btn-play-now');
    const addQueueBtn = document.getElementById('btn-add-to-queue');
    const rateSelectEl = document.getElementById('ctrl-playback-rate');

    if (!isHost) {
      // Guest Viewer Mode
      if (playPause) {
        playPause.title = '🔒 Playback controlled by Host (Lakshay)';
        playPause.style.opacity = '0.6';
      }
      if (rewindBtn) rewindBtn.style.opacity = '0.4';
      if (forwardBtn) forwardBtn.style.opacity = '0.4';
      if (rateSelectEl) rateSelectEl.disabled = true;

      // Update room header to indicate hosted by Lakshay
      const hostPill = document.getElementById('room-name-header');
      if (hostPill) {
        hostPill.innerHTML = `<span>${escapeHtml(roomState?.name || 'Party')}</span> <span class="member-badge" style="margin-left: 6px;">👑 Host: Lakshay</span>`;
      }
    } else {
      // Sovereign Host Mode
      if (playPause) {
        playPause.title = 'Play / Pause (Space)';
        playPause.style.opacity = '1';
      }
      if (rewindBtn) rewindBtn.style.opacity = '1';
      if (forwardBtn) forwardBtn.style.opacity = '1';
      if (rateSelectEl) rateSelectEl.disabled = false;

      const hostPill = document.getElementById('room-name-header');
      if (hostPill) {
        hostPill.innerHTML = `<span>${escapeHtml(roomState?.name || 'Party')}</span> <span class="member-badge" style="margin-left: 6px;">👑 You (Host)</span>`;
      }
    }
  }

  // Rewind & Forward 10s
  document.getElementById('ctrl-rewind')?.addEventListener('click', () => {
    const target = Math.max(0, getCurrentPlaybackTime() - 10);
    seekToTime(target);
    emitPlaybackAction('seek', target);
    triggerActionSplash('↺ 10');
  });

  document.getElementById('ctrl-forward')?.addEventListener('click', () => {
    const target = getCurrentPlaybackTime() + 10;
    seekToTime(target);
    emitPlaybackAction('seek', target);
    triggerActionSplash('10 ↻');
  });

  // Volume & Mute
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      html5Player.volume = val;
      if (isYtReady && ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(val * 100);
      updateMuteIcon(val === 0);
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const currentlyMuted = html5Player.muted || (volumeSlider && parseFloat(volumeSlider.value) === 0);
      if (currentlyMuted) {
        html5Player.muted = false;
        if (volumeSlider) volumeSlider.value = '0.9';
        html5Player.volume = 0.9;
        if (isYtReady && ytPlayer && ytPlayer.unMute) {
          ytPlayer.unMute();
          ytPlayer.setVolume(90);
        }
        updateMuteIcon(false);
      } else {
        html5Player.muted = true;
        if (volumeSlider) volumeSlider.value = '0';
        if (isYtReady && ytPlayer && ytPlayer.mute) ytPlayer.mute();
        updateMuteIcon(true);
      }
    });
  }

  function updateMuteIcon(isMuted) {
    if (muteIcon) muteIcon.textContent = isMuted ? '🔇' : '🔊';
  }

  // Playback Rate
  if (rateSelect) {
    rateSelect.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value);
      html5Player.playbackRate = rate;
      if (isYtReady && ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(rate);
      emitPlaybackAction('rate', getCurrentPlaybackTime(), rate);
    });
  }

  // Force Resync buttons
  const resyncAction = () => {
    if (socket) {
      socket.emit('query-sync');
      showToast('⚡ Synchronizing with room host...');
    }
  };
  document.getElementById('btn-force-sync')?.addEventListener('click', resyncAction);
  syncBeaconBtn?.addEventListener('click', resyncAction);

  // Fullscreen & PIP
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        playerWrapper.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (html5Player.readyState >= 2) {
          await html5Player.requestPictureInPicture();
        }
      } catch (err) {
        showToast('Picture-in-Picture not supported for this stream.');
      }
    });
  }

  // -------------------------------------------------------------
  // Subtitle / Closed Caption ([CC]) Engine
  // -------------------------------------------------------------
  const ctrlCcBtn = document.getElementById('ctrl-cc-btn');
  const subtitleMenu = document.getElementById('subtitle-menu');
  const subtitleTracksList = document.getElementById('subtitle-tracks-list');
  const btnCloseSubMenu = document.getElementById('btn-close-sub-menu');
  const subFileInput = document.getElementById('sub-file-input');
  const btnToggleNativeControls = document.getElementById('btn-toggle-native-controls');
  const customSubtitlesContainer = document.getElementById('custom-subtitles-container');
  const customSubtitleText = document.getElementById('custom-subtitle-text');
  const btnLoadSubMedia = document.getElementById('btn-load-sub-media');

  let activeSubtitleCues = [];
  let currentSubtitleTrack = 'off';
  let customLoadedSubtitles = [];

  function openSubtitleMenu() {
    if (!subtitleMenu) return;
    isSubtitleMenuOpen = true;
    renderSubtitleTracksMenu();
    subtitleMenu.style.display = 'flex';
    if (playerWrapper) playerWrapper.classList.add('show-controls');
  }

  function closeSubtitleMenu() {
    if (!subtitleMenu) return;
    isSubtitleMenuOpen = false;
    subtitleMenu.style.display = 'none';
  }

  function renderSubtitleTracksMenu() {
    if (!subtitleTracksList) return;
    subtitleTracksList.innerHTML = '';

    // "Off" option
    const offBtn = document.createElement('button');
    offBtn.type = 'button';
    offBtn.className = `sub-track-opt ${currentSubtitleTrack === 'off' ? 'active' : ''}`;
    offBtn.textContent = currentSubtitleTrack === 'off' ? '✓ Off' : 'Off';
    offBtn.addEventListener('click', () => {
      setSubtitleTrack('off');
      closeSubtitleMenu();
    });
    subtitleTracksList.appendChild(offBtn);

    // Native embedded tracks in video
    if (html5Player && html5Player.textTracks) {
      for (let i = 0; i < html5Player.textTracks.length; i++) {
        const track = html5Player.textTracks[i];
        if (track.kind === 'subtitles' || track.kind === 'captions') {
          const trackId = `native-${i}`;
          const trackLabel = track.label || track.language || `Track ${i + 1}`;
          const isSelected = currentSubtitleTrack === trackId;

          const opt = document.createElement('button');
          opt.type = 'button';
          opt.className = `sub-track-opt ${isSelected ? 'active' : ''}`;
          opt.textContent = `${isSelected ? '✓ ' : ''}${trackLabel} (Embedded)`;
          opt.addEventListener('click', () => {
            setSubtitleTrack(trackId, track);
            closeSubtitleMenu();
          });
          subtitleTracksList.appendChild(opt);
        }
      }
    }

    // Custom uploaded tracks
    customLoadedSubtitles.forEach((sub, idx) => {
      const trackId = `custom-${idx}`;
      const isSelected = currentSubtitleTrack === trackId;
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = `sub-track-opt ${isSelected ? 'active' : ''}`;
      opt.textContent = `${isSelected ? '✓ ' : ''}${sub.name}`;
      opt.addEventListener('click', () => {
        setSubtitleTrack(trackId, null, sub);
        closeSubtitleMenu();
      });
      subtitleTracksList.appendChild(opt);
    });
  }

  function setSubtitleTrack(trackId, nativeTrack = null, customSub = null) {
    currentSubtitleTrack = trackId;

    // Turn off all native tracks first
    if (html5Player && html5Player.textTracks) {
      for (let i = 0; i < html5Player.textTracks.length; i++) {
        html5Player.textTracks[i].mode = 'disabled';
      }
    }

    if (trackId === 'off') {
      activeSubtitleCues = [];
      ctrlCcBtn?.classList.remove('cc-active');
      if (customSubtitlesContainer) customSubtitlesContainer.style.display = 'none';
      showToast('💬 Subtitles turned off');
      return;
    }

    ctrlCcBtn?.classList.add('cc-active');

    if (nativeTrack) {
      nativeTrack.mode = 'showing';
      showToast(`💬 Subtitles: ${nativeTrack.label || 'Embedded'}`);
    } else if (customSub) {
      activeSubtitleCues = customSub.cues;
      showToast(`💬 Subtitles: ${customSub.name}`);
    }
  }

  // Parse SRT and WebVTT formats
  function parseSubtitleText(raw) {
    const clean = raw.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n').trim();
    const blocks = clean.split(/\n\s*\n/);
    const cues = [];

    const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,\.](\d{2,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[,\.](\d{2,3})/;

    function toSec(h, m, s, ms) {
      const hours = h ? parseInt(h, 10) : 0;
      const minutes = parseInt(m, 10);
      const seconds = parseInt(s, 10);
      const millis = ms.length === 2 ? parseInt(ms, 10) * 10 : parseInt(ms, 10);
      return hours * 3600 + minutes * 60 + seconds + millis / 1000;
    }

    for (const block of blocks) {
      const lines = block.split('\n');
      let timeLineIndex = -1;
      let match = null;

      for (let i = 0; i < lines.length; i++) {
        match = lines[i].match(timeRegex);
        if (match) {
          timeLineIndex = i;
          break;
        }
      }

      if (match && timeLineIndex !== -1) {
        const start = toSec(match[1], match[2], match[3], match[4]);
        const end = toSec(match[5], match[6], match[7], match[8]);
        const textLines = lines.slice(timeLineIndex + 1)
          .map(l => l.replace(/<[^>]*>/g, '').trim())
          .filter(Boolean);

        if (textLines.length > 0) {
          cues.push({
            start,
            end,
            text: textLines.join('\n')
          });
        }
      }
    }
    return cues;
  }

  function srtToVtt(srtContent) {
    let clean = srtContent.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
    if (clean.startsWith('WEBVTT')) return clean;
    clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + clean;
  }

  function loadSubtitleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const cues = parseSubtitleText(content);
      const vttContent = srtToVtt(content);

      const blob = new Blob([vttContent], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(blob);

      const subObj = {
        name: file.name,
        cues,
        blobUrl
      };

      customLoadedSubtitles.push(subObj);
      const trackId = `custom-${customLoadedSubtitles.length - 1}`;

      // Add as HTML5 track element for native browser support
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = file.name.replace(/\.[^/.]+$/, '');
      trackEl.srclang = 'en';
      trackEl.src = blobUrl;
      trackEl.default = true;
      html5Player.appendChild(trackEl);

      setSubtitleTrack(trackId, null, subObj);
      closeSubtitleMenu();
      showToast(`💬 Subtitles loaded: ${file.name}`);
    };
    reader.readAsText(file);
  }

  function updateSubtitleDisplay(currentTime) {
    if (!customSubtitlesContainer || !customSubtitleText) return;
    if (currentSubtitleTrack === 'off' || activeSubtitleCues.length === 0) {
      if (customSubtitlesContainer.style.display !== 'none') {
        customSubtitlesContainer.style.display = 'none';
      }
      return;
    }

    const cue = activeSubtitleCues.find(c => currentTime >= c.start && currentTime <= c.end);
    if (cue) {
      if (customSubtitleText.textContent !== cue.text) {
        customSubtitleText.textContent = cue.text;
      }
      if (customSubtitlesContainer.style.display !== 'flex') {
        customSubtitlesContainer.style.display = 'flex';
      }
    } else {
      if (customSubtitlesContainer.style.display !== 'none') {
        customSubtitlesContainer.style.display = 'none';
      }
    }
  }

  // CC Button Click
  if (ctrlCcBtn) {
    ctrlCcBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (subtitleMenu && subtitleMenu.style.display === 'flex') {
        closeSubtitleMenu();
      } else {
        openSubtitleMenu();
      }
    });
  }

  if (btnCloseSubMenu) {
    btnCloseSubMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSubtitleMenu();
    });
  }

  // Close subtitle menu on click outside
  document.addEventListener('click', (e) => {
    if (subtitleMenu && subtitleMenu.style.display === 'flex') {
      if (!e.target.closest('#subtitle-wrap')) {
        closeSubtitleMenu();
      }
    }
  });

  // Subtitle file upload
  if (subFileInput) {
    subFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        loadSubtitleFile(file);
        subFileInput.value = '';
      }
    });
  }

  // Media Tab Subtitle button
  if (btnLoadSubMedia && subFileInput) {
    btnLoadSubMedia.addEventListener('click', () => {
      subFileInput.click();
    });
  }

  // Toggle Native Browser Controls
  let isNativeControlsActive = false;
  if (btnToggleNativeControls) {
    btnToggleNativeControls.addEventListener('click', () => {
      isNativeControlsActive = !isNativeControlsActive;
      html5Player.controls = isNativeControlsActive;
      const customControls = document.getElementById('custom-controls');
      if (customControls) {
        customControls.style.display = isNativeControlsActive ? 'none' : 'flex';
      }
      showToast(isNativeControlsActive ? '🎛️ Switched to Native Browser Controls' : '🎬 Switched to Custom Cinema Controls');
      closeSubtitleMenu();
    });
  }

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Ignore keyboard shortcuts if user is typing in chat or input fields
    if (e.target.matches('input, textarea, select')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      const target = Math.max(0, getCurrentPlaybackTime() - 5);
      seekToTime(target);
      emitPlaybackAction('seek', target);
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      const target = getCurrentPlaybackTime() + 5;
      seekToTime(target);
      emitPlaybackAction('seek', target);
    } else if (e.code === 'KeyM') {
      muteBtn?.click();
    } else if (e.code === 'KeyF') {
      fullscreenBtn?.click();
    } else if (e.code === 'KeyC') {
      ctrlCcBtn?.click();
    } else if (e.code === 'KeyT' || e.code === 'KeyV') {
      // T/V toggles overlay chat visibility
      setOverlayChatEnabled(!isOverlayChatEnabled);
    } else if (e.code === 'Enter') {
      // Enter opens the quick chat input to type
      if (isOverlayChatEnabled && floatingQuickChatForm && floatingQuickChatInput) {
        e.preventDefault();
        floatingQuickChatForm.style.display = 'flex';
        floatingQuickChatInput.focus();
      }
    }
  });

  // Ambient Lighting Glow Canvas
  function startAmbientGlow() {
    if (ambientAnimationId) cancelAnimationFrame(ambientAnimationId);
    if (!ambientCanvas || !ambientCtx) return;

    ambientCanvas.width = 160;
    ambientCanvas.height = 90;

    function renderGlow(timestamp) {
      const isAmbientEnabled = document.getElementById('setting-ambient-glow')?.checked ?? true;
      if (!isAmbientEnabled) {
        ambientCtx.clearRect(0, 0, ambientCanvas.width, ambientCanvas.height);
        ambientAnimationId = requestAnimationFrame(renderGlow);
        return;
      }

      // Throttle to max 18fps: imperceptible difference for ambient light, 80% CPU savings
      if (timestamp - lastAmbientFrame >= 55) {
        lastAmbientFrame = timestamp;
        if (activePlayerType === 'html5' && !html5Player.paused && html5Player.readyState >= 2) {
          try {
            ambientCtx.drawImage(html5Player, 0, 0, ambientCanvas.width, ambientCanvas.height);
          } catch (e) {
            renderFallbackGlow();
          }
        } else {
          renderFallbackGlow();
        }
      }
      ambientAnimationId = requestAnimationFrame(renderGlow);
    }
    ambientAnimationId = requestAnimationFrame(renderGlow);
  }

  let hueShift = 0;
  function renderFallbackGlow() {
    if (!ambientCtx) return;
    hueShift = (hueShift + 0.5) % 360;
    const grad = ambientCtx.createLinearGradient(0, 0, ambientCanvas.width, ambientCanvas.height);
    grad.addColorStop(0, `hsla(${hueShift}, 70%, 50%, 0.4)`);
    grad.addColorStop(1, `hsla(${(hueShift + 60) % 360}, 70%, 50%, 0.4)`);
    ambientCtx.fillStyle = grad;
    ambientCtx.fillRect(0, 0, ambientCanvas.width, ambientCanvas.height);
  }

  // Floating Reactions Engine
  function spawnFloatingReaction(emoji) {
    if (!floatingContainer) return;
    const item = document.createElement('div');
    item.className = 'floating-reaction-item';
    item.textContent = emoji;

    // Random horizontal start (10% to 90%)
    const randX = Math.random() * 80 + 10;
    const randRot = (Math.random() - 0.5) * 45;
    item.style.left = `${randX}%`;
    item.style.setProperty('--rand-rot', `${randRot}`);

    floatingContainer.appendChild(item);
    setTimeout(() => {
      item.remove();
    }, 2800);
  }

  // Anime Reaction Bar Functionality
  function triggerReactionPill(emoji) {
    if (!emoji) return;
    const btn = document.querySelector(`.reaction-bar [data-emoji="${emoji}"]`);
    if (btn) {
      btn.classList.remove('pill-bump');
      // Trigger reflow to restart animation if clicked rapidly
      void btn.offsetWidth;
      btn.classList.add('pill-bump', 'has-bumped');
      const countEl = btn.querySelector('.react-count');
      if (countEl) {
        const cur = parseInt(countEl.textContent || '0', 10) || 0;
        countEl.textContent = cur + 1;
      }
    }
  }

  // Reaction Bar Click Events
  document.querySelectorAll('.reaction-bar .react-pill-btn, .reaction-bar .react-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (socket && emoji) {
        socket.emit('send-reaction', { emoji });
        spawnFloatingReaction(emoji);
        triggerReactionPill(emoji);
        playUiTone('pop');
      }
    });
  });

  // Media Source Form (Play Now / Add to Queue)
  const mediaForm = document.getElementById('media-source-form');
  const videoUrlInput = document.getElementById('video-url-input');

  if (mediaForm) {
    mediaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = videoUrlInput.value.trim();
      if (!url) return;
      loadCustomVideo(url, false);
      videoUrlInput.value = '';
    });
  }

  document.getElementById('btn-add-to-queue')?.addEventListener('click', () => {
    const url = videoUrlInput.value.trim();
    if (!url) {
      showToast('Please enter a video URL first.');
      return;
    }
    loadCustomVideo(url, true);
    videoUrlInput.value = '';
  });

  function loadCustomVideo(url, isQueue = false) {
    const isYt = isYoutubeUrl(url);
    const videoData = {
      title: isYt ? 'YouTube Video' : 'Custom Web Video',
      type: isYt ? 'youtube' : 'html5',
      url: url,
      thumbnail: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&auto=format&fit=crop&q=80',
      duration: 0
    };

    if (isQueue) {
      socket.emit('queue-add', videoData);
      showToast('📋 Added to upcoming queue!');
    } else {
      socket.emit('change-video', videoData);
    }
  }

  // Local Anime Video File Integration (Play Now or Add to Queue)
  const localFileInput = document.getElementById('local-video-file-input');
  const localQueueInput = document.getElementById('local-video-queue-input');
  const btnSelectLocal = document.getElementById('btn-select-local-video');
  const btnQueueLocal = document.getElementById('btn-queue-local-video');
  const btnTabQueueAnime = document.getElementById('btn-tab-queue-anime');
  const localFileNotice = document.getElementById('local-file-notice');
  const localFileNameText = document.getElementById('local-file-name-text');
  const btnMatchLocal = document.getElementById('btn-match-local-file');

  if (btnSelectLocal && localFileInput) {
    btnSelectLocal.addEventListener('click', () => {
      localFileInput.click();
    });
  }

  if (btnQueueLocal && localQueueInput) {
    btnQueueLocal.addEventListener('click', () => {
      localQueueInput.click();
    });
  }

  if (btnTabQueueAnime && localQueueInput) {
    btnTabQueueAnime.addEventListener('click', () => {
      localQueueInput.click();
    });
  }

  if (btnMatchLocal && localFileInput) {
    btnMatchLocal.addEventListener('click', () => {
      localFileInput.click();
    });
  }

  if (localFileInput) {
    localFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      handleLocalVideoFile(file, false);
      localFileInput.value = '';
    });
  }

  if (localQueueInput) {
    localQueueInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      handleLocalVideoFile(file, true);
      localQueueInput.value = '';
    });
  }

  // Drag and drop video directly onto the player (Plays Now)
  if (playerWrapper) {
    playerWrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      playerWrapper.style.boxShadow = '0 0 40px rgba(139, 92, 246, 0.9)';
    });

    playerWrapper.addEventListener('dragleave', () => {
      playerWrapper.style.boxShadow = '';
    });

    playerWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      playerWrapper.style.boxShadow = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        const subFile = files.find(f => f.name.match(/\.(srt|vtt|ass|ssa)$/i));
        const videoFile = files.find(f => f.type.startsWith('video/') || f.name.match(/\.(mp4|mkv|webm|mov|avi)$/i));

        if (videoFile) {
          handleLocalVideoFile(videoFile, false);
        }
        if (subFile) {
          loadSubtitleFile(subFile);
        }
        if (!videoFile && !subFile) {
          showToast('⚠️ Please drop a video or subtitle file (.srt, .vtt, .mp4, .mkv).');
        }
      }
    });
  }

  // Drag and drop video directly onto the Queue Tab (Adds to Queue)
  const tabQueue = document.getElementById('tab-queue');
  if (tabQueue) {
    tabQueue.addEventListener('dragover', (e) => {
      e.preventDefault();
      tabQueue.style.outline = '2px dashed var(--primary)';
      tabQueue.style.outlineOffset = '-4px';
    });

    tabQueue.addEventListener('dragleave', () => {
      tabQueue.style.outline = '';
    });

    tabQueue.addEventListener('drop', (e) => {
      e.preventDefault();
      tabQueue.style.outline = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mkv|webm|mov|avi)$/i)) {
          handleLocalVideoFile(file, true);
        } else {
          showToast('⚠️ Please drop a valid video file (MP4, WebM, MKV).');
        }
      }
    });
  }

  // Instant Match for Viewers (0s wait if friend has file)
  const matchInput = document.getElementById('viewer-local-match-input');
  const btnMatchSelect = document.getElementById('btn-match-select-file');
  const btnMatchDismiss = document.getElementById('btn-match-dismiss');
  const matchBanner = document.getElementById('local-file-match-banner');

  if (btnMatchSelect && matchInput) {
    btnMatchSelect.addEventListener('click', () => {
      matchInput.click();
    });
  }

  if (btnMatchDismiss && matchBanner) {
    btnMatchDismiss.addEventListener('click', () => {
      matchBanner.style.display = 'none';
    });
  }

  if (matchInput) {
    matchInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ');
      loadVideoSource({
        title: `⚡ ${cleanTitle} (Instant 0s Sync)`,
        type: 'html5',
        url: objectUrl,
        duration: 0
      }, 0, true);
      if (matchBanner) matchBanner.style.display = 'none';
      showToast(`⚡ Instant sync active! Watching "${cleanTitle}" in full 4K with 0s wait.`);
      if (socket) socket.emit('query-sync');
      matchInput.value = '';
    });
  }

  // Stream Transfer Elements
  const streamTransferBanner = document.getElementById('stream-transfer-banner');
  const streamTransferTitle = document.getElementById('stream-transfer-title');
  const streamTransferPercent = document.getElementById('stream-transfer-percent');
  const streamTransferBar = document.getElementById('stream-transfer-bar');
  const streamTransferSub = document.getElementById('stream-transfer-sub');
  const playerStreamBeacon = document.getElementById('player-stream-beacon');
  const playerStreamBeaconText = document.getElementById('player-stream-beacon-text');

  async function handleLocalVideoFile(file, isQueue = false) {
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]+/g, ' ');

    if (!isQueue) {
      // 1. Immediate zero-wait local playback for the host
      const objectUrl = URL.createObjectURL(file);
      const initialVideoData = {
        title: `🎬 ${cleanTitle}`,
        type: 'html5',
        url: objectUrl,
        duration: 0
      };
      loadVideoSource(initialVideoData, 0, true);

      // 2. Alert room members so anyone with the same file can match instantly with 0s waiting
      if (socket) {
        socket.emit('local-file-started', {
          filename: file.name,
          size: file.size,
          title: cleanTitle
        });
      }
    }

    // 2. Display transmission status with speed meter
    if (streamTransferBanner) {
      if (streamTransferTitle) streamTransferTitle.textContent = isQueue ? `Uploading "${file.name}" to Upcoming Queue...` : `Streaming "${file.name}" to friend...`;
      if (streamTransferPercent) streamTransferPercent.textContent = '0%';
      if (streamTransferBar) streamTransferBar.style.width = '0%';
      if (streamTransferSub) streamTransferSub.textContent = 'High-speed parallel stream: initializing chunks...';
      streamTransferBanner.style.display = 'block';
    }
    if (playerStreamBeacon) {
      if (playerStreamBeaconText) playerStreamBeaconText.textContent = isQueue ? `Queueing Anime • 0%` : `Streaming Anime to Friend • 0%`;
      playerStreamBeacon.style.display = 'flex';
    }

    showToast(isQueue ? `📋 Uploading "${cleanTitle}" to queue...` : `🚀 Streaming "${cleanTitle}" to your friend...`);

    // 3. High-Speed Parallel Chunked Upload (12MB chunks, 3 concurrent workers)
    const CHUNK_SIZE = 12 * 1024 * 1024; // 12 MB
    const CONCURRENCY = 3;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uniqueUploadName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    let completedChunks = 0;
    let bytesUploaded = 0;
    const uploadStartTime = Date.now();
    let finalResult = null;
    let nextChunkIdx = 0;
    let hasError = false;

    async function uploadWorker() {
      while (nextChunkIdx < totalChunks && !hasError) {
        const chunkIdx = nextChunkIdx++;
        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);
        const chunkSize = end - start;

        let retries = 3;
        let success = false;
        while (retries > 0 && !success && !hasError) {
          try {
            const response = await fetch('/api/upload-chunk', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'x-file-name': encodeURIComponent(uniqueUploadName),
                'x-chunk-index': String(chunkIdx),
                'x-total-chunks': String(totalChunks)
              },
              body: chunkBlob
            });

            if (!response.ok) throw new Error(`Chunk ${chunkIdx + 1} failed: status ${response.status}`);
            const data = await response.json();
            success = true;
            completedChunks++;
            bytesUploaded += chunkSize;

            const elapsedSec = (Date.now() - uploadStartTime) / 1000;
            const speedMBps = elapsedSec > 0.4 ? ((bytesUploaded / 1024 / 1024) / elapsedSec).toFixed(1) : '—';
            const remainingMB = (file.size - bytesUploaded) / 1024 / 1024;
            const etaSec = (parseFloat(speedMBps) > 0) ? Math.max(1, Math.ceil(remainingMB / parseFloat(speedMBps))) : '...';
            const percent = Math.min(100, Math.round((completedChunks / totalChunks) * 100));

            const progressInfo = `${percent}% • ${speedMBps} MB/s • ETA: ${etaSec}s`;

            if (streamTransferPercent) streamTransferPercent.textContent = `${percent}%`;
            if (streamTransferBar) streamTransferBar.style.width = `${percent}%`;
            if (playerStreamBeaconText) {
              playerStreamBeaconText.textContent = isQueue ? `Queueing: ${progressInfo}` : `Streaming: ${progressInfo}`;
            }
            if (streamTransferSub) {
              streamTransferSub.textContent = `High-speed parallel stream: ${progressInfo}`;
            }

            // Relay progress to friend's device
            if (socket && !isQueue) {
              socket.emit('upload-progress', { filename: file.name, progress: percent });
            }

            if (data.complete) {
              finalResult = data;
            }
          } catch (err) {
            retries--;
            if (retries === 0) {
              hasError = true;
              throw err;
            }
            await new Promise(r => setTimeout(r, 600));
          }
        }
      }
    }

    try {
      const workers = [];
      const workerCount = Math.min(CONCURRENCY, totalChunks);
      for (let w = 0; w < workerCount; w++) {
        workers.push(uploadWorker());
      }
      await Promise.all(workers);

      if (finalResult && finalResult.url) {
        if (streamTransferPercent) streamTransferPercent.textContent = '100%';
        if (streamTransferBar) streamTransferBar.style.width = '100%';
        if (playerStreamBeaconText) playerStreamBeaconText.textContent = isQueue ? `✅ Added to Queue!` : `✅ Transmitted to Friend!`;

        setTimeout(() => {
          if (streamTransferBanner) streamTransferBanner.style.display = 'none';
          if (playerStreamBeacon) playerStreamBeacon.style.display = 'none';
        }, 1800);

        if (isQueue) {
          if (socket) {
            socket.emit('queue-add', {
              title: `🎬 ${cleanTitle}`,
              type: 'html5',
              url: finalResult.url,
              duration: 0,
              thumbnail: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80'
            });
          }
          showToast(`📋 Anime file "${cleanTitle}" added to upcoming queue!`);
        } else {
          // Broadcast change-video with the server's stream URL and current playback position
          if (socket) {
            const currentPlaybackTime = getCurrentPlaybackTime() || 0;
            socket.emit('change-video', {
              title: `🎬 ${cleanTitle}`,
              type: 'html5',
              url: finalResult.url,
              currentTime: currentPlaybackTime
            });
          }
          showToast(`✨ Stream live! Your friend's device is now playing in sync.`);
        }
      }
    } catch (err) {
      console.error('Video upload error:', err);
      showToast('⚠️ Transfer error. Please try selecting the video again.');
      if (playerStreamBeaconText) playerStreamBeaconText.textContent = `⚠️ Transfer error`;
      setTimeout(() => {
        if (streamTransferBanner) streamTransferBanner.style.display = 'none';
        if (playerStreamBeacon) playerStreamBeacon.style.display = 'none';
      }, 4000);
    }
  }

  // Presets Loading (only if container is in DOM)
  if (document.getElementById('preset-cards-container')) {
    fetchPresets();
  }
  async function fetchPresets() {
    try {
      const res = await fetch('/api/presets');
      const data = await res.json();
      const container = document.getElementById('preset-cards-container');
      if (!container || !data.presets) return;

      container.innerHTML = data.presets.map((preset, idx) => `
        <div class="preset-card" data-index="${idx}">
          <div class="preset-thumb-wrap">
            <img src="${preset.thumbnail}" alt="${escapeHtml(preset.title)}" class="preset-thumb">
            <span class="preset-badge">${preset.type}</span>
          </div>
          <div class="preset-info">
            <div class="preset-title" title="${escapeHtml(preset.title)}">${escapeHtml(preset.title)}</div>
            <div class="preset-type">${preset.duration ? formatTime(preset.duration) : 'Stream'} • 1-Click Sync</div>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.preset-card').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.dataset.index, 10);
          const p = data.presets[idx];
          if (p && socket) {
            socket.emit('change-video', p);
          }
        });
      });
    } catch (err) {
      console.error('Failed to load presets', err);
    }
  }

  // Sidebar Tab Switching
  document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.theater-sidebar .tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId)?.classList.add('active');

      if (targetId === 'tab-chat') {
        const badge = document.getElementById('chat-count-badge');
        if (badge) badge.style.display = 'none';
      }
    });
  });

  // Chat Submission & Video Timestamp Attachment
  const chatStampBtn = document.getElementById('btn-stamp-time');
  const chatCurrentTsPill = document.getElementById('chat-current-ts-pill');

  // Continuously refresh current video time in chat input button
  setInterval(() => {
    if (chatCurrentTsPill) {
      const curr = getCurrentPlaybackTime();
      chatCurrentTsPill.textContent = `⏱️ ${formatTime(curr)}`;
    }
  }, 500);

  // Click on stamp button: prepends or updates [mm:ss] in chat input field
  if (chatStampBtn && chatInput) {
    chatStampBtn.addEventListener('click', () => {
      const curr = Math.floor(getCurrentPlaybackTime());
      const stamp = `[${formatTime(curr)}] `;
      if (/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/.test(chatInput.value)) {
        chatInput.value = chatInput.value.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, stamp);
      } else {
        chatInput.value = stamp + chatInput.value;
      }
      chatInput.focus();
    });
  }

  // -------------------------------------------------------------
  // WhatsApp-style "Who is writing" (Typing Indicator) & @ Mentions
  // -------------------------------------------------------------
  const chatTypingBar = document.getElementById('chat-typing-bar');
  const typingAvatar = document.getElementById('typing-avatar');
  const typingText = document.getElementById('typing-text');
  const mentionMenu = document.getElementById('mention-autocomplete-menu');
  const mentionList = document.getElementById('mention-list');

  const typingUsers = new Map(); // socketId -> { username, avatar }
  let stopTypingTimer = null;
  let isCurrentlyTyping = false;
  let activeMentionMatch = null;
  let mentionSelectedIndex = 0;

  function handleUserTypingEvent({ socketId, username, avatar, isTyping }) {
    if (!chatTypingBar || !typingText) return;
    if (isTyping) {
      typingUsers.set(socketId, { username, avatar });
    } else {
      typingUsers.delete(socketId);
    }

    if (typingUsers.size === 0) {
      chatTypingBar.style.display = 'none';
      return;
    }

    const users = Array.from(typingUsers.values());
    if (users.length === 1) {
      if (typingAvatar) typingAvatar.innerHTML = renderAvatar(users[0].avatar);
      typingText.textContent = `${users[0].username} is writing...`;
    } else if (users.length === 2) {
      if (typingAvatar) typingAvatar.innerHTML = '💬';
      typingText.textContent = `${users[0].username} and ${users[1].username} are writing...`;
    } else {
      if (typingAvatar) typingAvatar.innerHTML = '💬';
      typingText.textContent = `${users.length} members are writing...`;
    }

    chatTypingBar.style.display = 'block';
    scrollChatToBottom();
  }

  // Detect typing & @ mention trigger in chat input
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      const val = chatInput.value;
      if (val.trim().length > 0) {
        if (!isCurrentlyTyping && socket && socket.connected) {
          isCurrentlyTyping = true;
          socket.emit('typing-start');
        }
        clearTimeout(stopTypingTimer);
        stopTypingTimer = setTimeout(() => {
          if (isCurrentlyTyping && socket && socket.connected) {
            isCurrentlyTyping = false;
            socket.emit('typing-stop');
          }
        }, 2200);
      } else {
        if (isCurrentlyTyping && socket && socket.connected) {
          isCurrentlyTyping = false;
          socket.emit('typing-stop');
        }
      }

      handleMentionAutocomplete();
    });

    chatInput.addEventListener('blur', () => {
      setTimeout(() => {
        closeMentionMenu();
      }, 250);
    });

    chatInput.addEventListener('keydown', (e) => {
      if (mentionMenu && mentionMenu.style.display === 'block') {
        const items = mentionList.querySelectorAll('.mention-item');
        if (items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
            items.forEach((it, i) => it.classList.toggle('active', i === mentionSelectedIndex));
            items[mentionSelectedIndex]?.scrollIntoView({ block: 'nearest' });
            return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
            items.forEach((it, i) => it.classList.toggle('active', i === mentionSelectedIndex));
            items[mentionSelectedIndex]?.scrollIntoView({ block: 'nearest' });
            return;
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (items[mentionSelectedIndex]) {
              e.preventDefault();
              items[mentionSelectedIndex].click();
              return;
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            closeMentionMenu();
            return;
          }
        }
      }
    });
  }

  function handleMentionAutocomplete() {
    if (!mentionMenu || !mentionList || !chatInput) return;
    const text = chatInput.value;
    const cursorPos = chatInput.selectionStart;
    const beforeCursor = text.substring(0, cursorPos);
    const match = beforeCursor.match(/@([a-zA-Z0-9_\u00C0-\u017F]*)$/);

    if (!match) {
      closeMentionMenu();
      return;
    }

    const query = match[1].toLowerCase();
    activeMentionMatch = {
      startPos: match.index,
      endPos: cursorPos
    };

    const suggestions = [];

    // Add @everyone / @all if matching
    if (!query || 'everyone'.startsWith(query) || 'all'.startsWith(query)) {
      suggestions.push({
        username: 'everyone',
        avatar: '📢',
        badge: 'All'
      });
    }

    const users = (roomState && roomState.users) ? roomState.users : [];
    users.forEach(u => {
      if (!query || u.username.toLowerCase().includes(query)) {
        suggestions.push({
          username: u.username,
          avatar: u.avatar,
          badge: u.isHost ? 'Host' : ''
        });
      }
    });

    if (suggestions.length === 0) {
      closeMentionMenu();
      return;
    }

    mentionList.innerHTML = '';
    mentionSelectedIndex = 0;

    suggestions.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mention-item ${index === 0 ? 'active' : ''}`;
      btn.innerHTML = `
        <span class="mention-item-avatar">${renderAvatar(item.avatar)}</span>
        <span class="mention-item-name">@${escapeHtml(item.username)}</span>
        ${item.badge ? `<span class="mention-item-badge">${item.badge}</span>` : ''}
      `;

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMention(item.username);
      });

      mentionList.appendChild(btn);
    });

    mentionMenu.style.display = 'block';
  }

  function insertMention(username) {
    if (!activeMentionMatch || !chatInput) return;
    const text = chatInput.value;
    const before = text.substring(0, activeMentionMatch.startPos);
    const after = text.substring(activeMentionMatch.endPos);
    const mentionTag = `@${username} `;
    chatInput.value = before + mentionTag + after;
    const nextCursor = before.length + mentionTag.length;
    chatInput.focus();
    chatInput.setSelectionRange(nextCursor, nextCursor);
    closeMentionMenu();
  }

  function closeMentionMenu() {
    if (mentionMenu) mentionMenu.style.display = 'none';
    activeMentionMatch = null;
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      if (!socket || !socket.connected) {
        showToast('⚠️ Reconnecting to chat server...');
        if (socket) socket.connect();
        return;
      }
      const videoTime = Math.floor(getCurrentPlaybackTime());
      socket.emit('send-message', { text, videoTime });

      if (isCurrentlyTyping && socket && socket.connected) {
        isCurrentlyTyping = false;
        socket.emit('typing-stop');
      }
      closeMentionMenu();

      chatInput.value = '';
      chatInput.focus();
    });
  }

  function renderChatMessages(messages) {
    if (!chatMessagesList) return;
    chatMessagesList.innerHTML = '';
    messages.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
  }

  function formatChatMessageWithTimestamps(rawText) {
    if (!rawText) return '';
    let escaped = escapeHtml(rawText);

    // Clickable timestamp badges [01:23] or 01:23
    escaped = escaped.replace(/(\[?(?:\b\d{1,2}:)?\d{1,2}:\d{2}\b\]?)/g, (match) => {
      const clean = match.replace(/[\[\]]/g, '');
      const parts = clean.split(':').map(Number);
      let sec = 0;
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        sec = parts[0] * 60 + parts[1];
      } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        return match;
      }
      return `<button type="button" class="chat-video-ts-badge inline-ts" data-seek-time="${sec}" title="Click to jump to ${clean} in video"><span class="ts-icon">▶</span> ${clean}</button>`;
    });

    // WhatsApp-style @ Mentions
    const myName = currentUser?.username ? currentUser.username.toLowerCase() : '';
    escaped = escaped.replace(/@([a-zA-Z0-9_\u00C0-\u017F]+)/g, (match, username) => {
      const lower = username.toLowerCase();
      const isMe = myName && (lower === myName || lower === 'everyone' || lower === 'all');
      return `<span class="chat-mention ${isMe ? 'mention-me' : ''}">@${username}</span>`;
    });

    return escaped;
  }

  function jumpToTimestamp(target) {
    if (isNaN(target)) return;
    seekToTime(target);
    emitPlaybackAction('seek', target);
    showToast(`⚡ Jumped to scene at ${formatTime(target)}`);
  }

  function appendChatMessage(msg, scroll = true) {
    if (!chatMessagesList) return;

    if (msg.system) {
      const sysEl = document.createElement('div');
      sysEl.className = 'chat-system-message';
      const text = msg.text || '';
      if (text.startsWith('/avatars/') || text.startsWith('http') || text.includes('.jpg') || text.includes('.png')) {
        const parts = text.split(' ');
        const imgUrl = parts[0];
        const rest = parts.slice(1).join(' ');
        sysEl.innerHTML = `<img src="${imgUrl}" alt="avatar" style="width: 16px; height: 16px; border-radius: 4px; vertical-align: middle; display: inline-block; margin-right: 4px; object-fit: cover;"> ${escapeHtml(rest)}`;
      } else {
        sysEl.textContent = text;
      }
      chatMessagesList.appendChild(sysEl);
    } else {
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message';
      const isYou = currentUser && msg.user && msg.user.socketId === currentUser.socketId;

      const myName = currentUser?.username ? currentUser.username.toLowerCase() : '';
      const hasMentionMe = myName && msg.text && (
        msg.text.toLowerCase().includes(`@${myName}`) ||
        msg.text.toLowerCase().includes('@everyone') ||
        msg.text.toLowerCase().includes('@all')
      );

      if (hasMentionMe && !isYou) {
        msgEl.classList.add('has-mention-me');
        playUiTone('mention');
      }

      const hasVideoTime = typeof msg.videoTime === 'number' && msg.videoTime >= 0;
      const tsHtml = hasVideoTime ? `
        <button type="button" class="chat-video-ts-badge" data-seek-time="${msg.videoTime}" title="Click to jump to ${formatTime(msg.videoTime)} in video">
          <span class="ts-icon">▶</span> ${formatTime(msg.videoTime)}
        </button>
      ` : '';

      msgEl.innerHTML = `
        <div class="chat-avatar">${renderAvatar(msg.user?.avatar)}</div>
        <div class="chat-content">
          <div class="chat-author-line">
            <span class="chat-author ${isYou ? 'you' : ''}">
              ${escapeHtml(msg.user?.username || 'Guest')}
              ${msg.user?.isHost ? '<span class="member-badge" style="margin-left: 4px;">Host</span>' : ''}
              ${isYou ? '<span style="font-size: 0.7rem; color: var(--text-muted); font-weight: normal;">(You)</span>' : ''}
            </span>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              ${tsHtml}
              <span class="chat-time">${formatClock(msg.timestamp)}</span>
            </div>
          </div>
          <div class="chat-text">${formatChatMessageWithTimestamps(msg.text)}</div>
        </div>
      `;

      // Make all timestamp badges in header and inside message text clickable
      msgEl.querySelectorAll('.chat-video-ts-badge').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = parseFloat(btn.dataset.seekTime);
          jumpToTimestamp(target);
        });
      });

      chatMessagesList.appendChild(msgEl);

      // Render directly over the video in fullscreen / maximized mode
      if (typeof appendFloatingOverlayMessage === 'function') {
        appendFloatingOverlayMessage(msg);
      }
    }

    if (scroll) scrollChatToBottom();
  }

  function scrollChatToBottom() {
    if (chatMessagesList) {
      chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
    }
  }

  // -------------------------------------------------------------
  // Fullscreen / Maximized On-Video Transparent Floating Chat
  // -------------------------------------------------------------
  const floatingChatOverlay = document.getElementById('video-floating-chat-overlay');
  const floatingChatStream = document.getElementById('floating-chat-stream');
  const videoCornerChatBtn = document.getElementById('video-corner-chat-btn');
  const ctrlOverlayChatBtn = document.getElementById('ctrl-overlay-chat-btn');
  const cornerChatDot = document.getElementById('corner-chat-dot');
  const floatingQuickChatForm = document.getElementById('floating-quick-chat-form');
  const floatingQuickChatInput = document.getElementById('floating-quick-chat-input');

  let isOverlayChatEnabled = true;

  function setOverlayChatEnabled(enabled) {
    isOverlayChatEnabled = enabled;
    if (floatingChatOverlay) {
      floatingChatOverlay.style.display = enabled ? 'flex' : 'none';
    }
    if (videoCornerChatBtn) {
      videoCornerChatBtn.classList.toggle('active', enabled);
    }
    if (ctrlOverlayChatBtn) {
      ctrlOverlayChatBtn.classList.toggle('overlay-chat-active', enabled);
    }
    if (enabled && cornerChatDot) {
      cornerChatDot.style.display = 'none';
    }
    showToast(enabled ? '💬 On-Video Chat Enabled' : '🔇 On-Video Chat Hidden');
  }

  // Corner chat button: opens quick chat input to type; if hidden, shows it first
  if (videoCornerChatBtn) {
    videoCornerChatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isOverlayChatEnabled) {
        setOverlayChatEnabled(true);
      } else {
        if (floatingQuickChatForm && floatingQuickChatInput) {
          floatingQuickChatForm.style.display = 'flex';
          floatingQuickChatInput.focus();
        }
      }
    });
  }

  // Controls bar chat button: toggles overlay visibility
  if (ctrlOverlayChatBtn) {
    ctrlOverlayChatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOverlayChatEnabled(!isOverlayChatEnabled);
    });
  }

  // Track Fullscreen state
  document.addEventListener('fullscreenchange', () => {
    const isFull = !!document.fullscreenElement;
    if (playerWrapper) {
      playerWrapper.classList.toggle('is-fullscreen', isFull);
    }
    if (fullscreenBtn) {
      const icon = fullscreenBtn.querySelector('#fullscreen-icon') || fullscreenBtn;
      icon.textContent = isFull ? '🗗' : '⛶';
    }
    if (isFull) {
      showControls(3000);
    }
  });

  // Append a transparent floating message directly over the video
  function appendFloatingOverlayMessage(msg) {
    if (!floatingChatStream) return;
    if (!isOverlayChatEnabled) {
      if (cornerChatDot) cornerChatDot.style.display = 'block';
      return;
    }

    const wasNearBottom = (floatingChatStream.scrollHeight - floatingChatStream.scrollTop - floatingChatStream.clientHeight) < 75;
    const isYou = currentUser && msg.user && msg.user.socketId === currentUser.socketId;

    const row = document.createElement('div');
    row.className = 'floating-msg-row';
    row.dataset.msgId = msg.id || String(Date.now());

    const hasVideoTime = typeof msg.videoTime === 'number' && msg.videoTime >= 0;
    const tsHtml = hasVideoTime ? `
      <button type="button" class="chat-video-ts-badge floating-ts" data-seek-time="${msg.videoTime}" title="Jump to ${formatTime(msg.videoTime)}">
        ▶ ${formatTime(msg.videoTime)}
      </button>
    ` : '';

    row.innerHTML = `
      <span class="floating-msg-avatar">${renderAvatar(msg.user?.avatar)}</span>
      <span class="floating-msg-author ${isYou ? 'is-you' : ''}">${escapeHtml(msg.user?.username || 'Guest')}:</span>
      <span class="floating-msg-text">${formatChatMessageWithTimestamps(msg.text)}</span>
      ${tsHtml}
    `;

    // Make timestamp badges clickable in floating messages
    row.querySelectorAll('.chat-video-ts-badge').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = parseFloat(btn.dataset.seekTime);
        jumpToTimestamp(target);
      });
    });

    floatingChatStream.appendChild(row);

    // Keep up to 30 messages in the stream so users can scroll up and review
    while (floatingChatStream.children.length > 30) {
      floatingChatStream.removeChild(floatingChatStream.firstChild);
    }

    // Auto-scroll to keep newest message visible unless user scrolled upward
    if (wasNearBottom) {
      floatingChatStream.scrollTop = floatingChatStream.scrollHeight;
    }
  }

  // Quick chat input form
  if (floatingQuickChatForm && floatingQuickChatInput) {
    floatingQuickChatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = floatingQuickChatInput.value.trim();
      if (!text) return;
      const videoTime = Math.floor(getCurrentPlaybackTime());
      socket.emit('send-message', { text, videoTime });
      floatingQuickChatInput.value = '';
      floatingQuickChatForm.style.display = 'none';
    });

    floatingQuickChatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // prevent T/Enter from triggering player shortcuts while typing
      if (e.key === 'Escape') {
        e.preventDefault();
        floatingQuickChatForm.style.display = 'none';
        floatingQuickChatInput.blur();
      }
    });

    floatingQuickChatInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== floatingQuickChatInput) {
          floatingQuickChatForm.style.display = 'none';
        }
      }, 180);
    });
  }

  // -------------------------------------------------------------
  // Dynamic Video Luminance Detector (Light vs Dark Video Scenes)
  // -------------------------------------------------------------
  const lumCanvas = document.createElement('canvas');
  lumCanvas.width = 32;
  lumCanvas.height = 24;
  let lumCtx = null;
  try {
    lumCtx = lumCanvas.getContext('2d', { willReadFrequently: true });
  } catch (e) {}

  let currentVideoLuminance = 'dark';

  function sampleVideoLuminance() {
    if (!floatingChatOverlay || !html5Player || !lumCtx) return;
    if (activePlayerType !== 'html5' || html5Player.readyState < 2 || html5Player.paused) return;

    try {
      const vw = html5Player.videoWidth;
      const vh = html5Player.videoHeight;
      if (!vw || !vh) return;

      // Sample bottom-right quadrant where messages float
      const sx = Math.floor(vw * 0.55);
      const sy = Math.floor(vh * 0.5);
      const sw = Math.floor(vw * 0.43);
      const sh = Math.floor(vh * 0.45);

      lumCtx.drawImage(html5Player, sx, sy, sw, sh, 0, 0, 32, 24);
      const imgData = lumCtx.getImageData(0, 0, 32, 24).data;

      let totalLum = 0;
      let lightPixels = 0;
      const totalPixels = imgData.length / 4;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b);
        totalLum += lum;
        if (lum > 135) lightPixels++;
      }

      const avgLum = totalLum / totalPixels;
      const isLightScene = avgLum > 135 || (lightPixels / totalPixels) > 0.55;
      const sceneType = isLightScene ? 'light' : 'dark';

      if (sceneType !== currentVideoLuminance) {
        currentVideoLuminance = sceneType;
        if (sceneType === 'light') {
          floatingChatOverlay.classList.add('lum-light-scene');
          floatingChatOverlay.classList.remove('lum-dark-scene');
        } else {
          floatingChatOverlay.classList.add('lum-dark-scene');
          floatingChatOverlay.classList.remove('lum-light-scene');
        }
      }
    } catch (err) {
      if (!floatingChatOverlay.classList.contains('lum-dark-scene')) {
        floatingChatOverlay.classList.add('lum-dark-scene');
      }
    }
  }

  setInterval(sampleVideoLuminance, 250);

  // Initialize overlay chat in active state
  if (videoCornerChatBtn) videoCornerChatBtn.classList.add('active');
  if (ctrlOverlayChatBtn) ctrlOverlayChatBtn.classList.add('overlay-chat-active');
  if (floatingChatOverlay) {
    floatingChatOverlay.classList.add('lum-dark-scene');
    floatingChatOverlay.style.display = 'flex';
  }

  // Queue Rendering
  function renderQueue(queue) {
    if (!queueItemsList) return;
    const badge = document.getElementById('queue-count-badge');
    if (badge) badge.textContent = queue.length;

    if (queue.length === 0) {
      queueItemsList.innerHTML = `
        <div style="text-align: center; padding: 2.2rem 1rem; color: var(--text-muted); font-size: 0.88rem;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📋</div>
          <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.3rem;">The queue is empty</div>
          <div style="font-size: 0.8rem; margin-bottom: 1rem; color: var(--text-muted);">Paste a video URL or upload an anime file to line up upcoming episodes!</div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-empty-queue-upload" style="margin: 0 auto;">
            <span>📂 Upload Anime to Queue</span>
          </button>
        </div>
      `;
      document.getElementById('btn-empty-queue-upload')?.addEventListener('click', () => {
        document.getElementById('local-video-queue-input')?.click();
      });
      return;
    }

    queueItemsList.innerHTML = queue.map((item, idx) => `
      <div class="queue-item">
        <img src="${item.thumbnail}" alt="${escapeHtml(item.title)}" class="queue-thumb">
        <div class="queue-info">
          <div class="queue-title">${escapeHtml(item.title)}</div>
          <div class="queue-meta">Added by ${escapeHtml(item.addedBy || 'Guest')}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button type="button" class="btn btn-primary btn-sm btn-play-queue" data-index="${idx}" title="Play Now">▶</button>
          <button type="button" class="btn btn-ghost btn-sm btn-remove-queue" data-index="${idx}" title="Remove">✕</button>
        </div>
      </div>
    `).join('');

    queueItemsList.querySelectorAll('.btn-play-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        socket.emit('queue-play-item', { index });
      });
    });

    queueItemsList.querySelectorAll('.btn-remove-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        socket.emit('queue-remove', { index });
      });
    });
  }

  // Members Rendering
  function renderMembers(users) {
    if (!membersItemsList) return;
    const badge = document.getElementById('member-count-badge');
    if (badge) badge.textContent = users.length;

    membersItemsList.innerHTML = users.map(user => {
      const isYou = currentUser && user.socketId === currentUser.socketId;
      const canTransfer = currentUser?.isHost && !user.isHost;

      return `
        <div class="member-item">
          <div class="member-info">
            <span style="font-size: 1.3rem; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; overflow: hidden;">${renderAvatar(user.avatar)}</span>
            <div>
              <div class="member-name">
                ${escapeHtml(user.username)}
                ${isYou ? '<span style="font-size: 0.72rem; color: var(--accent-cyan);"> (You)</span>' : ''}
              </div>
              <div style="font-size: 0.7rem; color: var(--accent-emerald);">● Online</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${user.isHost ? '<span class="member-badge">👑 Host</span>' : ''}
            ${canTransfer ? `
              <button type="button" class="btn btn-secondary btn-sm btn-make-host" data-socket-id="${user.socketId}" style="font-size: 0.7rem; padding: 2px 6px;">
                Make Host
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    membersItemsList.querySelectorAll('.btn-make-host').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.socketId;
        if (socket && sid) {
          socket.emit('transfer-host', { newHostSocketId: sid });
        }
      });
    });
  }

  // Share Modal & Copy Link
  const shareModal = document.getElementById('modal-share');
  const shareLinkInput = document.getElementById('share-link-input');
  const shareCodeInput = document.getElementById('share-code-input');

  document.getElementById('btn-open-share')?.addEventListener('click', () => {
    if (shareLinkInput) shareLinkInput.value = window.location.href;
    if (shareCodeInput) shareCodeInput.value = roomId;

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const remoteTunnelBox = document.getElementById('remote-tunnel-box');
    const remoteActiveBox = document.getElementById('remote-tunnel-active-box');
    if (remoteTunnelBox) remoteTunnelBox.style.display = isLocalhost ? 'block' : 'none';
    if (remoteActiveBox) remoteActiveBox.style.display = isLocalhost ? 'none' : 'block';

    shareModal.classList.add('open');
  });

  document.getElementById('btn-copy-tunnel-cmd')?.addEventListener('click', () => {
    navigator.clipboard.writeText('npm run tunnel').then(() => {
      showToast('📋 Copied "npm run tunnel"! Run this in your Mac Terminal.');
    });
  });

  copyCodeBtn?.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('📋 Room link copied to clipboard!');
    });
  });

  document.getElementById('btn-copy-share-link')?.addEventListener('click', () => {
    if (shareLinkInput) {
      navigator.clipboard.writeText(shareLinkInput.value).then(() => {
        showToast('📋 Link copied to clipboard!');
      });
    }
  });

  // Settings Modal
  const settingsModal = document.getElementById('modal-settings');
  document.getElementById('btn-room-settings')?.addEventListener('click', () => {
    settingsModal.classList.add('open');
  });

  document.getElementById('setting-host-lock')?.addEventListener('change', () => {
    if (socket && currentUser?.isHost) {
      socket.emit('toggle-host-lock');
    }
  });

  // Close Modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      document.getElementById(modalId)?.classList.remove('open');
    });
  });

  // Helpers
  function isYoutubeUrl(url) {
    return /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i.test(url);
  }

  function extractYoutubeId(url) {
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    return match ? match[1] : '';
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    if (h > 0) {
      return `${h}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
    }
    return `${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }

  function formatClock(timestamp) {
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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

  function setupAvatarPicker(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.avatar-choice');
      if (!btn) return;
      grid.querySelectorAll('.avatar-choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
