// Lakshay Ultra-Fast Cinematic Splash Screen (Apple / A24 / Linear Inspired)
(() => {
  if (document.getElementById('lakshay-splash-screen')) return;

  // If already seen in this tab session, do an ultra-quick 180ms seamless transition
  const hasSeenSplash = sessionStorage.getItem('lakshay_splash_seen') === 'true';
  const totalDuration = hasSeenSplash ? 280 : 950;

  // Create Splash Overlay DOM
  const splash = document.createElement('div');
  splash.id = 'lakshay-splash-screen';
  splash.className = 'splash-overlay';
  splash.innerHTML = `
    <div class="splash-ambient-aura"></div>

    <div class="splash-content" id="splash-card">
      <div class="splash-logo-mark">
        <div class="splash-logo-glow"></div>
        <div class="splash-logo-icon">⚡</div>
      </div>

      <div class="splash-brand-text">
        <h1 class="splash-brand-title">LAKSHAY</h1>
        <p class="splash-brand-tagline">SYNCHRONIZED CINEMA</p>
      </div>

      <div class="splash-loader-wrap">
        <div class="splash-loader-bar" id="splash-loader-bar"></div>
      </div>
    </div>
  `;

  document.body.prepend(splash);

  // Smooth progress filling
  const bar = document.getElementById('splash-loader-bar');
  const startTime = performance.now();
  let isDismissed = false;

  function dismissSplash() {
    if (isDismissed) return;
    isDismissed = true;
    sessionStorage.setItem('lakshay_splash_seen', 'true');

    splash.classList.add('splash-exit');
    setTimeout(() => {
      splash.remove();
    }, 450);
  }

  function step(now) {
    if (isDismissed) return;
    const elapsed = now - startTime;
    const progress = Math.min(100, (elapsed / totalDuration) * 100);

    if (bar) bar.style.width = `${progress}%`;

    if (elapsed < totalDuration) {
      requestAnimationFrame(step);
    } else {
      dismissSplash();
    }
  }

  requestAnimationFrame(step);

  // Instant dismiss on any click or tap anywhere on the screen
  splash.addEventListener('click', dismissSplash, { once: true });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') {
      dismissSplash();
    }
  }, { once: true });
})();
