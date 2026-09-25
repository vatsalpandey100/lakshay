// Lakshay World-Class Flagship Splash Screen Engine (Apple, Pixel & Samsung Inspired)
(() => {
  // Prevent duplicate insertion
  if (document.getElementById('lakshay-splash-screen')) return;

  // Create Splash DOM
  const splash = document.createElement('div');
  splash.id = 'lakshay-splash-screen';
  splash.className = 'splash-overlay';
  splash.innerHTML = `
    <canvas id="splash-starfield" class="splash-canvas"></canvas>
    
    <!-- Top Left: Spatial Audio Indicator -->
    <div class="splash-sound-pill" id="splash-sound-toggle" title="Spatial Cinema Audio">
      <span id="sound-pill-icon">🔊</span>
      <span id="sound-pill-text">Spatial Audio</span>
      <div class="sound-wave-bars">
        <div class="sound-wave-bar"></div>
        <div class="sound-wave-bar"></div>
        <div class="sound-wave-bar"></div>
        <div class="sound-wave-bar"></div>
      </div>
    </div>

    <!-- Top Right: Skip Action -->
    <button type="button" class="splash-skip-btn" id="splash-skip-btn" title="Skip Intro (Space / Esc)">
      <span>Skip Intro ⏭</span>
    </button>

    <!-- Main Central Presentation -->
    <div class="splash-content" id="splash-3d-target">
      <div class="splash-emblem-wrapper" id="splash-emblem">
        <div class="splash-ring splash-ring-1"></div>
        <div class="splash-ring splash-ring-2"></div>
        <div class="splash-ring splash-ring-3"></div>
        <div class="splash-shockwave"></div>
        <div class="splash-shockwave" style="animation-delay: 1.1s;"></div>
        <div class="splash-core">
          <span>⚡</span>
        </div>
      </div>

      <div class="splash-title-wrap">
        <h1 class="splash-title">LAKSHAY</h1>
      </div>

      <div class="splash-subtitle">
        <span class="splash-sub-line"></span>
        <span>Anime & Cinema Ultra Sync</span>
        <span class="splash-sub-line"></span>
      </div>
    </div>

    <!-- Bottom Progress & Calibration Bar -->
    <div class="splash-bottom-bar">
      <div class="splash-status-text" id="splash-status-text">CALIBRATING QUANTUM SYNC ENGINE...</div>
      <div class="splash-progress-track">
        <div class="splash-progress-fill" id="splash-progress-fill"></div>
      </div>
    </div>
  `;

  document.body.prepend(splash);

  // 3D Starfield & Lightwarp Canvas
  const canvas = document.getElementById('splash-starfield');
  const ctx = canvas?.getContext('2d');
  let animationFrameId = null;
  let stars = [];
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Create 180 Cosmic Lightstreak Particles
  const numStars = 180;
  for (let i = 0; i < numStars; i++) {
    stars.push({
      x: (Math.random() - 0.5) * window.innerWidth * 2,
      y: (Math.random() - 0.5) * window.innerHeight * 2,
      z: Math.random() * window.innerWidth,
      prevZ: 0,
      size: Math.random() * 2.2 + 0.8,
      color: ['#8b5cf6', '#06b6d4', '#ec4899', '#ffffff', '#38bdf8', '#c084fc'][Math.floor(Math.random() * 6)]
    });
  }

  // Interactive Parallax on Mouse Move (Apple / Pixel style)
  window.addEventListener('mousemove', (e) => {
    targetMouseX = (e.clientX - window.innerWidth / 2) * 0.4;
    targetMouseY = (e.clientY - window.innerHeight / 2) * 0.4;

    // 3D Card Tilt
    const emblem = document.getElementById('splash-3d-target');
    if (emblem) {
      const tiltX = (e.clientY - window.innerHeight / 2) * -0.02;
      const tiltY = (e.clientX - window.innerWidth / 2) * 0.02;
      emblem.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    }
  });

  function renderStars() {
    if (!ctx || !canvas) return;

    mouseX += (targetMouseX - mouseX) * 0.08;
    mouseY += (targetMouseY - mouseY) * 0.08;

    ctx.fillStyle = 'rgba(4, 5, 9, 0.22)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2 + mouseX * 0.3;
    const cy = canvas.height / 2 + mouseY * 0.3;

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.prevZ = s.z;
      s.z -= 6.5;

      if (s.z <= 0) {
        s.z = canvas.width;
        s.prevZ = s.z;
        s.x = (Math.random() - 0.5) * canvas.width * 2;
        s.y = (Math.random() - 0.5) * canvas.height * 2;
      }

      const k = 260 / s.z;
      const px = s.x * k + cx;
      const py = s.y * k + cy;

      const prevK = 260 / s.prevZ;
      const prevPx = s.x * prevK + cx;
      const prevPy = s.y * prevK + cy;

      if (px >= 0 && px <= canvas.width && py >= 0 && py <= canvas.height) {
        const alpha = Math.min(1, (1 - s.z / canvas.width) * 1.8);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size * k * 0.6;
        ctx.globalAlpha = alpha;

        // Draw light speed streak
        ctx.beginPath();
        ctx.moveTo(prevPx, prevPy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Draw star head
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(px, py, s.size * k * 0.7, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
      }
    }

    animationFrameId = requestAnimationFrame(renderStars);
  }
  renderStars();

  // World-Class Cinematic Spatial Audio (THX / Dolby Atmos / Apple Inspired)
  let audioCtx = null;
  let audioPlayed = false;

  function playSpatialCinemaSound() {
    if (audioPlayed) return;
    audioPlayed = true;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;

      // 1. Deep Sub-Bass Cinema Impact Drop (80Hz down to 28Hz)
      const subOsc = audioCtx.createOscillator();
      const subGain = audioCtx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(110, now);
      subOsc.frequency.exponentialRampToValueAtTime(28, now + 1.4);
      subGain.gain.setValueAtTime(0.4, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      subOsc.connect(subGain);
      subGain.connect(audioCtx.destination);
      subOsc.start(now);
      subOsc.stop(now + 2.5);

      // 2. High-Tech Shimmering Riser (Exponential laser riser)
      const riseOsc = audioCtx.createOscillator();
      const riseGain = audioCtx.createGain();
      riseOsc.type = 'triangle';
      riseOsc.frequency.setValueAtTime(180, now);
      riseOsc.frequency.exponentialRampToValueAtTime(1200, now + 0.9);
      riseGain.gain.setValueAtTime(0.07, now);
      riseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
      riseOsc.connect(riseGain);
      riseGain.connect(audioCtx.destination);
      riseOsc.start(now);
      riseOsc.stop(now + 1.4);

      // 3. Stereo Panning Cosmic Arpeggio (Spatial left/right movement)
      const notes = [
        { freq: 440, delay: 0.1, pan: -0.6 },
        { freq: 554.37, delay: 0.25, pan: -0.2 },
        { freq: 659.25, delay: 0.4, pan: 0.2 },
        { freq: 880, delay: 0.55, pan: 0.6 },
        { freq: 1108.73, delay: 0.7, pan: 0 }
      ];

      notes.forEach((item) => {
        const chordOsc = audioCtx.createOscillator();
        const chordGain = audioCtx.createGain();
        chordOsc.type = 'sine';
        chordOsc.frequency.setValueAtTime(item.freq, now + item.delay);

        chordGain.gain.setValueAtTime(0.06, now + item.delay);
        chordGain.gain.exponentialRampToValueAtTime(0.001, now + item.delay + 1.8);

        // Stereo Panner
        if (audioCtx.createStereoPanner) {
          const panner = audioCtx.createStereoPanner();
          panner.pan.setValueAtTime(item.pan, now + item.delay);
          chordOsc.connect(chordGain);
          chordGain.connect(panner);
          panner.connect(audioCtx.destination);
        } else {
          chordOsc.connect(chordGain);
          chordGain.connect(audioCtx.destination);
        }

        chordOsc.start(now + item.delay);
        chordOsc.stop(now + item.delay + 1.8);
      });
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  // Audio Toggle Pill handler
  const soundPill = document.getElementById('splash-sound-toggle');
  if (soundPill) {
    soundPill.addEventListener('click', (e) => {
      e.stopPropagation();
      playSpatialCinemaSound();
    });
  }

  // Auto-play audio on first gesture or timeout
  window.addEventListener('click', playSpatialCinemaSound, { once: true });
  window.addEventListener('keydown', playSpatialCinemaSound, { once: true });
  setTimeout(playSpatialCinemaSound, 350);

  // Progress Bar & Phase Calibration
  const progressFill = document.getElementById('splash-progress-fill');
  const statusText = document.getElementById('splash-status-text');
  const startTime = performance.now();
  const totalDuration = 2700; // 2.7s for maximum cinematic elegance

  const phases = [
    { at: 0.12, text: 'INITIALIZING ZERO-LAG PIPELINE...' },
    { at: 0.38, text: 'CALIBRATING ATOMIC NTP CLOCKS...' },
    { at: 0.65, text: 'PREPARING ANIME THEATER STAGE...' },
    { at: 0.90, text: 'LAKSHAY CINEMA SYNCHRONIZED.' }
  ];

  function updateProgress(now) {
    const elapsed = now - startTime;
    const pct = Math.min(100, (elapsed / totalDuration) * 100);

    if (progressFill) progressFill.style.width = `${pct}%`;

    const ratio = pct / 100;
    const currentPhase = phases.filter(p => ratio >= p.at).pop();
    if (currentPhase && statusText) {
      statusText.textContent = currentPhase.text;
    }

    if (elapsed < totalDuration) {
      requestAnimationFrame(updateProgress);
    } else {
      exitSplash();
    }
  }

  requestAnimationFrame(updateProgress);

  // Anamorphic Lens Flare Exit
  let isExited = false;
  function exitSplash() {
    if (isExited) return;
    isExited = true;

    splash.classList.add('splash-exit');
    setTimeout(() => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      splash.remove();
    }, 850);
  }

  // Skip & Keyboard Shortcuts
  document.getElementById('splash-skip-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exitSplash();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'Space') {
      exitSplash();
    }
  }, { once: true });

  // Global Replay function
  window.playLakshayIntro = () => {
    window.location.reload();
  };
})();
