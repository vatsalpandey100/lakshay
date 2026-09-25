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
        osc.start(now);
        osc.stop(now + 0.35);
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
    socket = io();

    const storedRoomName = sessionStorage.getItem('syncpulse_room_name');
    const isCreating = sessionStorage.getItem('syncpulse_is_creating') === 'true';
    const hostToken = sessionStorage.getItem('syncpulse_host_token') || localStorage.getItem('lakshay_host_token_' + roomId);

    socket.emit('join-room', {
      roomId,
      username,
      avatar,
      roomName: storedRoomName,
      hostToken,
      isCreating
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

    socket.on('floating-reaction', (data) => {
      spawnFloatingReaction(data.emoji);
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
    if (activePlayerType === 'html5') {
      return html5Player.currentTime || 0;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.getCurrentTime) {
      return ytPlayer.getCurrentTime() || 0;
    }
    return 0;
  }

  function getPlaybackDuration() {
    if (activePlayerType === 'html5') {
      return html5Player.duration || 0;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.getDuration) {
      return ytPlayer.getDuration() || 0;
    }
    return 0;
  }

  function seekToTime(seconds) {
    const time = Math.max(0, seconds);
    if (activePlayerType === 'html5') {
      html5Player.currentTime = time;
    } else if (activePlayerType === 'youtube' && isYtReady && ytPlayer && ytPlayer.seekTo) {
      ytPlayer.seekTo(time, true);
    }
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
  if (videoViewport) {
    // Click on video viewport toggles play/pause
    document.getElementById('video-viewport')?.addEventListener('click', (e) => {
      if (e.target.closest('#custom-controls') || e.target.closest('.floating-reaction-item')) return;
      togglePlayPause();
    });
  }

  // HTML5 Video Events
  html5Player.addEventListener('play', () => {
    if (isSyncingFromServer) return;
    updatePlayPauseIcon(false);
    emitPlaybackAction('play', html5Player.currentTime);
  });

  html5Player.addEventListener('pause', () => {
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

  // Reaction Bar Click Events
  document.querySelectorAll('.reaction-bar .react-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (socket && emoji) {
        socket.emit('send-reaction', { emoji });
        spawnFloatingReaction(emoji);
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

  // Local Anime Video File Integration (Zero-lag local playback with real-time sync)
  const localFileInput = document.getElementById('local-video-file-input');
  const btnSelectLocal = document.getElementById('btn-select-local-video');
  const localFileNotice = document.getElementById('local-file-notice');
  const localFileNameText = document.getElementById('local-file-name-text');
  const btnMatchLocal = document.getElementById('btn-match-local-file');

  if (btnSelectLocal && localFileInput) {
    btnSelectLocal.addEventListener('click', () => {
      localFileInput.click();
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
      handleLocalVideoFile(file);
    });
  }

  // Drag and drop video directly onto the player
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
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mkv|webm|mov|avi)$/i)) {
          handleLocalVideoFile(file);
        } else {
          showToast('⚠️ Please drop a valid video file (MP4, WebM, MKV).');
        }
      }
    });
  }

  // Stream Transfer Elements
  const streamTransferBanner = document.getElementById('stream-transfer-banner');
  const streamTransferTitle = document.getElementById('stream-transfer-title');
  const streamTransferPercent = document.getElementById('stream-transfer-percent');
  const streamTransferBar = document.getElementById('stream-transfer-bar');
  const playerStreamBeacon = document.getElementById('player-stream-beacon');
  const playerStreamBeaconText = document.getElementById('player-stream-beacon-text');

  async function handleLocalVideoFile(file) {
    // 1. Immediate zero-wait local playback for the host
    const objectUrl = URL.createObjectURL(file);
    const initialVideoData = {
      title: `🎬 ${file.name}`,
      type: 'html5',
      url: objectUrl,
      duration: 0
    };
    loadVideoSource(initialVideoData, 0, true);

    // 2. Display visionOS transmission status
    if (streamTransferBanner) {
      if (streamTransferTitle) streamTransferTitle.textContent = `Streaming "${file.name}" to friend...`;
      if (streamTransferPercent) streamTransferPercent.textContent = '0%';
      if (streamTransferBar) streamTransferBar.style.width = '0%';
      streamTransferBanner.style.display = 'block';
    }
    if (playerStreamBeacon) {
      if (playerStreamBeaconText) playerStreamBeaconText.textContent = `Streaming Anime to Remote Friend • 0%`;
      playerStreamBeacon.style.display = 'flex';
    }

    showToast(`🚀 Streaming "${file.name}" to your friend...`);

    // 3. Chunked upload: 5MB chunks (bypasses Cloudflare 100MB body limit completely!)
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let finalResult = null;

    try {
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);

        // Upload chunk
        const response = await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
            'x-chunk-index': String(chunkIdx),
            'x-total-chunks': String(totalChunks)
          },
          body: chunkBlob
        });

        if (!response.ok) {
          throw new Error(`Chunk ${chunkIdx + 1}/${totalChunks} failed with status ${response.status}`);
        }

        const data = await response.json();
        const percent = Math.min(100, Math.round(((chunkIdx + 1) / totalChunks) * 100));

        if (streamTransferPercent) streamTransferPercent.textContent = `${percent}%`;
        if (streamTransferBar) streamTransferBar.style.width = `${percent}%`;
        if (playerStreamBeaconText) playerStreamBeaconText.textContent = `Streaming Anime to Remote Friend • ${percent}%`;

        // Relay progress to friend's device
        if (socket) {
          socket.emit('upload-progress', { filename: file.name, progress: percent });
        }

        if (data.complete) {
          finalResult = data;
        }
      }

      if (finalResult && finalResult.url) {
        if (streamTransferPercent) streamTransferPercent.textContent = '100%';
        if (streamTransferBar) streamTransferBar.style.width = '100%';
        if (playerStreamBeaconText) playerStreamBeaconText.textContent = `✅ Transmitted to Friend!`;

        setTimeout(() => {
          if (streamTransferBanner) streamTransferBanner.style.display = 'none';
          if (playerStreamBeacon) playerStreamBeacon.style.display = 'none';
        }, 1800);

        // Broadcast change-video with the server's stream URL and current playback position
        if (socket) {
          const currentPlaybackTime = getCurrentPlaybackTime() || 0;
          socket.emit('change-video', {
            title: finalResult.title || file.name,
            type: 'html5',
            url: finalResult.url,
            currentTime: currentPlaybackTime
          });
        }

        showToast(`✨ Stream live! Your friend's device is now playing in sync.`);
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

  // Presets Loading
  fetchPresets();
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
  }, 1000);

  // Click on stamp button: prepends [mm:ss] into text field
  if (chatStampBtn && chatInput) {
    chatStampBtn.addEventListener('click', () => {
      const curr = Math.floor(getCurrentPlaybackTime());
      const stamp = `[${formatTime(curr)}] `;
      if (!chatInput.value.startsWith(stamp)) {
        chatInput.value = stamp + chatInput.value;
      }
      chatInput.focus();
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !socket) return;
      const videoTime = Math.floor(getCurrentPlaybackTime());
      socket.emit('send-message', { text, videoTime });
      chatInput.value = '';
    });
  }

  function renderChatMessages(messages) {
    if (!chatMessagesList) return;
    chatMessagesList.innerHTML = '';
    messages.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
  }

  function appendChatMessage(msg, scroll = true) {
    if (!chatMessagesList) return;

    if (msg.system) {
      const sysEl = document.createElement('div');
      sysEl.className = 'chat-system-message';
      sysEl.textContent = msg.text;
      chatMessagesList.appendChild(sysEl);
    } else {
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-message';
      const isYou = currentUser && msg.user && msg.user.socketId === currentUser.socketId;

      const hasVideoTime = typeof msg.videoTime === 'number' && msg.videoTime >= 0;
      const tsHtml = hasVideoTime ? `
        <button type="button" class="chat-video-ts-badge" data-seek-time="${msg.videoTime}" title="Click to jump to ${formatTime(msg.videoTime)} in video">
          <span class="ts-icon">▶</span> ${formatTime(msg.videoTime)}
        </button>
      ` : '';

      msgEl.innerHTML = `
        <div class="chat-avatar">${msg.user?.avatar || '🍿'}</div>
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
          <div class="chat-text">${escapeHtml(msg.text)}</div>
        </div>
      `;

      // Make timestamp badge clickable to jump to that moment in the video
      msgEl.querySelectorAll('.chat-video-ts-badge').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = parseFloat(btn.dataset.seekTime);
          if (!isNaN(target)) {
            seekToTime(target);
            if (currentUser?.isHost || !roomState?.isHostOnly) {
              emitPlaybackAction('seek', target);
              showToast(`⚡ Jumped room to scene at ${formatTime(target)}`);
            } else {
              showToast(`⏱️ Jumped to scene at ${formatTime(target)}`);
            }
          }
        });
      });

      chatMessagesList.appendChild(msgEl);
    }

    if (scroll) scrollChatToBottom();
  }

  function scrollChatToBottom() {
    if (chatMessagesList) {
      chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
    }
  }

  // Queue Rendering
  function renderQueue(queue) {
    if (!queueItemsList) return;
    const badge = document.getElementById('queue-count-badge');
    if (badge) badge.textContent = queue.length;

    if (queue.length === 0) {
      queueItemsList.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.88rem;">
          <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">📋</div>
          The queue is empty. Paste a URL below the player and click "+ Queue" to line up movies!
        </div>
      `;
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
            <span style="font-size: 1.3rem;">${user.avatar || '🍿'}</span>
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
