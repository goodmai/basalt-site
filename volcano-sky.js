const METEOR_INTERVAL_MS = 60_000;
const COMET_INTERVAL_MS = 300_000;
const DAY_NIGHT_INTERVAL_MS = 600_000;
const TWILIGHT_DURATION_MS = 4_400;

export function initVolcanoSky({ isDarkScheme, setScheme }) {
  const canvas = document.getElementById('volcano-canvas');
  const stage = document.querySelector('.volcano-stage');
  if (!canvas || !stage) return null;

  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) return null;

  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');

  let width = 1280;
  let height = 720;
  let rafId = 0;
  let running = false;
  let lastNow = performance.now();

  // Continuous sky state: 0 = deep night, 1 = full daylight
  let dayFactor = isDarkScheme() ? 0 : 1;
  let targetDayFactor = dayFactor;
  let twilight = null; // { mode: 'sunrise' | 'sunset', start: number, switchedTheme: boolean }

  // Elapsed accumulators (only advance while unpaused & visible)
  let meteorAccumulator = 0;
  let cometAccumulator = 0;
  let cycleAccumulator = 0;

  // Pre-allocated starfield (zero per-frame allocations)
  const STAR_COUNT = 96;
  const starX = new Float32Array(STAR_COUNT);
  const starY = new Float32Array(STAR_COUNT);
  const starSize = new Float32Array(STAR_COUNT);
  const starPhase = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    starX[i] = ((i * 73 + 19) % 997) / 997;
    starY[i] = (((i * 191 + 43) % 613) / 613) * 0.62;
    starSize[i] = 0.7 + ((i * 37) % 15) * 0.09;
    starPhase[i] = (i * 1.37) % (Math.PI * 2);
  }

  // Pre-allocated volcanic embers rising & cooling above the caldera
  const EMBER_COUNT = 26;
  const emberX = new Float32Array(EMBER_COUNT);
  const emberY = new Float32Array(EMBER_COUNT);
  const emberVx = new Float32Array(EMBER_COUNT);
  const emberVy = new Float32Array(EMBER_COUNT);
  const emberHeat = new Float32Array(EMBER_COUNT);

  function resetEmber(i, randomLife = false) {
    emberX[i] = 0.5 + (Math.random() - 0.5) * 0.045;
    emberY[i] = 0.555 + (randomLife ? -Math.random() * 0.18 : 0);
    emberVx[i] = (Math.random() - 0.5) * 0.012;
    emberVy[i] = 0.014 + Math.random() * 0.018;
    emberHeat[i] = randomLife ? Math.random() : 1.0;
  }
  for (let i = 0; i < EMBER_COUNT; i++) resetEmber(i, true);

  // 7 sinuous lava channels radiating down the volcanic cone and cooling into basalt crust
  const LAVA_PATHS = [
    { spread: -0.22, bend: -0.05, speed: 0.55, width: 3.1, reach: 0.96 },
    { spread: -0.13, bend: 0.03, speed: 0.68, width: 3.8, reach: 1.0 },
    { spread: -0.05, bend: -0.025, speed: 0.74, width: 4.4, reach: 0.98 },
    { spread: 0.02, bend: 0.02, speed: 0.62, width: 4.6, reach: 1.0 },
    { spread: 0.09, bend: -0.03, speed: 0.71, width: 3.6, reach: 0.95 },
    { spread: 0.16, bend: 0.04, speed: 0.58, width: 3.2, reach: 0.92 },
    { spread: 0.24, bend: 0.05, speed: 0.49, width: 2.6, reach: 0.88 },
  ];

  // Active rare night-sky events
  const meteorite = {
    active: false,
    x0: 0,
    y0: 0,
    dx: 0,
    dy: 0,
    elapsed: 0,
    duration: 1.45,
  };

  const comet = {
    active: false,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    cx: 0,
    cy: 0,
    elapsed: 0,
    duration: 7.8,
  };

  function spawnMeteorite() {
    if (dayFactor > 0.35 && !twilight) return false;
    meteorite.active = true;
    meteorite.elapsed = 0;
    meteorite.duration = 1.45 + Math.random() * 0.25;
    meteorite.x0 = 0.36 + Math.random() * 0.24;
    meteorite.y0 = 0.05 + Math.random() * 0.07;
    meteorite.dx = 0.22 + Math.random() * 0.07;
    meteorite.dy = 0.19 + Math.random() * 0.06;
    return true;
  }

  function spawnComet() {
    if (dayFactor > 0.35 && !twilight) return false;
    comet.active = true;
    comet.elapsed = 0;
    comet.duration = 7.8;
    comet.x0 = 0.04;
    comet.y0 = 0.13;
    comet.x1 = 0.96;
    comet.y1 = 0.16;
    comet.cx = 0.52;
    comet.cy = 0.06;
    return true;
  }

  function startTwilightTransition(toLight, persistOverride = false) {
    const mode = toLight ? 'sunrise' : 'sunset';
    targetDayFactor = toLight ? 1 : 0;
    twilight = {
      mode,
      start: performance.now(),
      switchedTheme: false,
      persistOverride,
    };
    stage.setAttribute('data-twilight', mode);
    ensureLoop();
  }

  // Low-fill-rate ResizeObserver (clamped DPR <= 1.25 * 0.78 scale for 60fps zero-jank rendering)
  const resizeObserver = new ResizeObserver(([entry]) => {
    const rect = entry.contentRect;
    const scale = Math.min(window.devicePixelRatio || 1, 1.25) * 0.78;
    width = Math.max(320, Math.round(rect.width * scale));
    height = Math.max(240, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      renderFrame(performance.now(), 0);
    }
  });
  resizeObserver.observe(stage);

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function mixRGB(c1, c2, t) {
    const r = Math.round(mix(c1[0], c2[0], t));
    const g = Math.round(mix(c1[1], c2[1], t));
    const b = Math.round(mix(c1[2], c2[2], t));
    return `rgb(${r},${g},${b})`;
  }

  function drawSkyAndTwilight(timeSec, twilightGlow) {
    const zenithNight = [5, 8, 18];
    const zenithDay = [226, 236, 250];
    const midNight = [11, 17, 34];
    const midDay = [238, 244, 252];
    const horizonNight = [24, 19, 36];
    const horizonDay = [246, 248, 252];

    const twilightMid = twilight?.mode === 'sunrise' ? [186, 86, 128] : [138, 54, 118];
    const twilightHorizon = twilight?.mode === 'sunrise' ? [255, 158, 68] : [249, 98, 52];

    const topCol = mixRGB(zenithNight, zenithDay, dayFactor);
    const baseMid = [
      mix(midNight[0], midDay[0], dayFactor),
      mix(midNight[1], midDay[1], dayFactor),
      mix(midNight[2], midDay[2], dayFactor),
    ];
    const baseHor = [
      mix(horizonNight[0], horizonDay[0], dayFactor),
      mix(horizonNight[1], horizonDay[1], dayFactor),
      mix(horizonNight[2], horizonDay[2], dayFactor),
    ];

    const midCol = mixRGB(baseMid, twilightMid, twilightGlow * 0.72);
    const horCol = mixRGB(baseHor, twilightHorizon, twilightGlow * 0.88);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.78);
    skyGrad.addColorStop(0, topCol);
    skyGrad.addColorStop(0.56, midCol);
    skyGrad.addColorStop(1, horCol);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Rising or setting solar disk during sunrise / sunset
    if (twilightGlow > 0.02 || dayFactor > 0.15) {
      const sunX = width * 0.72;
      const sunY = height * mix(0.66, 0.22, dayFactor);
      const sunR = Math.min(width, height) * (0.09 + twilightGlow * 0.05);
      const sunAlpha = Math.min(0.85, twilightGlow * 0.85 + dayFactor * 0.28);
      const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
      sunGrad.addColorStop(0, `rgba(255, 232, 170, ${sunAlpha})`);
      sunGrad.addColorStop(0.35, `rgba(255, 146, 68, ${sunAlpha * 0.55})`);
      sunGrad.addColorStop(1, 'rgba(255, 120, 50, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(sunX - sunR * 3.2, sunY - sunR * 3.2, sunR * 6.4, sunR * 6.4);
    }

    // Night stars (fade cleanly during sunrise)
    const starVisibility = Math.max(0, 1 - dayFactor * 1.45 - twilightGlow * 0.35);
    if (starVisibility > 0.02) {
      for (let i = 0; i < STAR_COUNT; i++) {
        const twinkle = 0.45 + 0.55 * Math.sin(timeSec * 1.1 + starPhase[i]);
        ctx.fillStyle = `rgba(226, 238, 255, ${(starVisibility * twinkle * 0.78).toFixed(3)})`;
        const sx = starX[i] * width;
        const sy = starY[i] * height;
        const r = starSize[i];
        ctx.fillRect(sx, sy, r, r);
      }
    }
  }

  function drawComet() {
    if (!comet.active) return;
    const p = comet.elapsed / comet.duration;
    if (p >= 1) {
      comet.active = false;
      return;
    }
    const inv = 1 - p;
    const x = (inv * inv * comet.x0 + 2 * inv * p * comet.cx + p * p * comet.x1) * width;
    const y = (inv * inv * comet.y0 + 2 * inv * p * comet.cy + p * p * comet.y1) * height;
    const vx = 2 * ((comet.cx - comet.x0) * inv + (comet.x1 - comet.cx) * p) * width;
    const vy = 2 * ((comet.cy - comet.y0) * inv + (comet.y1 - comet.cy) * p) * height;
    const len = Math.hypot(vx, vy) || 1;
    const ux = -vx / len;
    const uy = -vy / len;
    const fade = Math.sin(Math.min(1, p) * Math.PI);
    const tailLen = Math.min(width, height) * 0.24;

    // Straight cobalt-cyan ion tail
    const ionGrad = ctx.createLinearGradient(x, y, x + ux * tailLen * 1.15, y + uy * tailLen * 1.15);
    ionGrad.addColorStop(0, `rgba(125, 211, 252, ${(0.72 * fade).toFixed(3)})`);
    ionGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.strokeStyle = ionGrad;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ux * tailLen * 1.15, y + uy * tailLen * 1.15);
    ctx.stroke();

    // Gently curved warm-white dust tail
    const dustGrad = ctx.createLinearGradient(x, y, x + ux * tailLen, y + uy * tailLen - 18);
    dustGrad.addColorStop(0, `rgba(240, 249, 255, ${(0.88 * fade).toFixed(3)})`);
    dustGrad.addColorStop(0.45, `rgba(186, 230, 253, ${(0.38 * fade).toFixed(3)})`);
    dustGrad.addColorStop(1, 'rgba(186, 230, 253, 0)');
    ctx.strokeStyle = dustGrad;
    ctx.lineWidth = 5.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + ux * tailLen * 0.5,
      y + uy * tailLen * 0.5 - 10,
      x + ux * tailLen,
      y + uy * tailLen - 22
    );
    ctx.stroke();

    // Luminous coma
    const comaGrad = ctx.createRadialGradient(x, y, 0, x, y, 13);
    comaGrad.addColorStop(0, `rgba(255, 255, 255, ${(0.96 * fade).toFixed(3)})`);
    comaGrad.addColorStop(0.4, `rgba(103, 232, 249, ${(0.62 * fade).toFixed(3)})`);
    comaGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = comaGrad;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMeteorite() {
    if (!meteorite.active) return;
    const p = meteorite.elapsed / meteorite.duration;
    if (p >= 1) {
      meteorite.active = false;
      return;
    }
    const ease = 1 - Math.pow(1 - p, 1.6);
    const x = (meteorite.x0 + meteorite.dx * ease) * width;
    const y = (meteorite.y0 + meteorite.dy * ease) * height;
    const mag = Math.hypot(meteorite.dx * width, meteorite.dy * height) || 1;
    const ux = (-meteorite.dx * width) / mag;
    const uy = (-meteorite.dy * height) / mag;
    const fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
    const streak = Math.min(width, height) * 0.16;

    const grad = ctx.createLinearGradient(x, y, x + ux * streak, y + uy * streak);
    grad.addColorStop(0, `rgba(255, 250, 220, ${(0.95 * fade).toFixed(3)})`);
    grad.addColorStop(0.3, `rgba(251, 146, 60, ${(0.68 * fade).toFixed(3)})`);
    grad.addColorStop(0.7, `rgba(52, 211, 153, ${(0.28 * fade).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(52, 211, 153, 0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ux * streak, y + uy * streak);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 255, 240, ${(0.98 * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawVolcanoAndCoolingLava(timeSec, dt) {
    const cx = width * 0.5;
    const craterY = height * 0.565;
    const baseY = height * 1.02;

    // 1. Distant basalt mountain range
    ctx.fillStyle = dayFactor > 0.5
      ? `rgba(182, 196, 218, ${(0.42 + dayFactor * 0.25).toFixed(3)})`
      : 'rgba(14, 20, 36, 0.82)';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.74);
    ctx.lineTo(width * 0.18, height * 0.66);
    ctx.lineTo(width * 0.34, height * 0.73);
    ctx.lineTo(width * 0.67, height * 0.72);
    ctx.lineTo(width * 0.84, height * 0.64);
    ctx.lineTo(width, height * 0.73);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    // 2. Caldera magma plume glow behind crater rim
    const pulse = 0.84 + 0.16 * Math.sin(timeSec * 1.35);
    const glowAlpha = mix(0.46, 0.22, dayFactor) * pulse;
    const craterGlow = ctx.createRadialGradient(cx, craterY, 4, cx, craterY, width * 0.22);
    craterGlow.addColorStop(0, `rgba(255, 196, 92, ${glowAlpha.toFixed(3)})`);
    craterGlow.addColorStop(0.38, `rgba(239, 68, 68, ${(glowAlpha * 0.55).toFixed(3)})`);
    craterGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = craterGlow;
    ctx.fillRect(cx - width * 0.24, craterY - width * 0.22, width * 0.48, width * 0.36);

    // 3. Main Basalt Volcano Cone
    const coneGrad = ctx.createLinearGradient(0, craterY, 0, height);
    if (dayFactor > 0.5) {
      coneGrad.addColorStop(0, 'rgba(68, 79, 102, 0.42)');
      coneGrad.addColorStop(0.55, 'rgba(45, 54, 74, 0.52)');
      coneGrad.addColorStop(1, 'rgba(28, 35, 50, 0.64)');
    } else {
      coneGrad.addColorStop(0, '#1a1b2e');
      coneGrad.addColorStop(0.5, '#101524');
      coneGrad.addColorStop(1, '#070a12');
    }

    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(width * 0.08, height * 0.92);
    ctx.quadraticCurveTo(width * 0.31, height * 0.78, cx - width * 0.042, craterY);
    ctx.lineTo(cx - width * 0.018, craterY + height * 0.012);
    ctx.lineTo(cx + width * 0.018, craterY + height * 0.012);
    ctx.lineTo(cx + width * 0.042, craterY);
    ctx.quadraticCurveTo(width * 0.69, height * 0.78, width * 0.92, height * 0.92);
    ctx.lineTo(width, baseY);
    ctx.closePath();
    ctx.fill();

    // 4. Sinuous Lava Streams Cooling Downward into Solid Basalt Crust
    const lavaVisibility = mix(0.88, 0.42, dayFactor);
    const SEGMENTS = 14;
    for (let pIdx = 0; pIdx < LAVA_PATHS.length; pIdx++) {
      const path = LAVA_PATHS[pIdx];
      const startX = cx + path.spread * width * 0.14;
      const endX = cx + path.spread * width * 1.45;
      const endY = craterY + (height - craterY) * path.reach;

      for (let s = 0; s < SEGMENTS; s++) {
        const t0 = s / SEGMENTS;
        const t1 = (s + 1) / SEGMENTS;
        const wave0 = Math.sin(t0 * 8.5 + pIdx * 1.7) * path.bend * width;
        const wave1 = Math.sin(t1 * 8.5 + pIdx * 1.7) * path.bend * width;
        const x0 = mix(startX, endX, t0) + wave0 * t0;
        const y0 = mix(craterY + 4, endY, t0);
        const x1 = mix(startX, endX, t1) + wave1 * t1;
        const y1 = mix(craterY + 4, endY, t1);

        // Slow downward thermal surge that cools & solidifies into dark basalt rock
        const surge = 0.5 + 0.5 * Math.sin(timeSec * path.speed - t0 * 6.2 + pIdx * 1.3);
        const heat = Math.max(0, (1 - t0 * 0.92) * (0.62 + 0.38 * surge));

        // Dark solidified basalt crust bed underneath cooling magma
        ctx.strokeStyle = `rgba(22, 27, 42, ${(0.55 * lavaVisibility).toFixed(3)})`;
        ctx.lineWidth = path.width * (1.25 + t0 * 0.9);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        // Incandescent core -> cooling crimson -> faint ember fissure
        let r = 255;
        let g = 215;
        let b = 110;
        let alpha = lavaVisibility;
        if (heat > 0.66) {
          const k = (heat - 0.66) / 0.34;
          r = 255;
          g = Math.round(mix(125, 228, k));
          b = Math.round(mix(28, 128, k));
          alpha *= 0.88;
        } else if (heat > 0.32) {
          const k = (heat - 0.32) / 0.34;
          r = Math.round(mix(148, 248, k));
          g = Math.round(mix(28, 118, k));
          b = Math.round(mix(24, 28, k));
          alpha *= mix(0.32, 0.78, k);
        } else {
          const k = heat / 0.32;
          r = Math.round(mix(48, 138, k));
          g = Math.round(mix(36, 28, k));
          b = Math.round(mix(56, 34, k));
          alpha *= mix(0.08, 0.32, k);
        }

        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.9, path.width * (1.05 - t0 * 0.45));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    // 5. Rising volcanic embers that cool as they ascend
    if (dt > 0) {
      for (let i = 0; i < EMBER_COUNT; i++) {
        emberX[i] += emberVx[i] * dt;
        emberY[i] -= emberVy[i] * dt;
        emberHeat[i] -= dt * 0.22;
        if (emberHeat[i] <= 0 || emberY[i] < 0.34) {
          resetEmber(i, false);
        }
      }
    }
    for (let i = 0; i < EMBER_COUNT; i++) {
      const h = emberHeat[i];
      const ex = emberX[i] * width;
      const ey = emberY[i] * height;
      const g = Math.round(mix(50, 195, h));
      ctx.fillStyle = `rgba(255,${g},42,${(h * 0.65 * lavaVisibility).toFixed(3)})`;
      ctx.fillRect(ex, ey, 1.8, 1.8);
    }

    // 6. Subtle atmospheric veil so foreground typography always maintains WCAG AAA/AA contrast
    const veil = ctx.createLinearGradient(0, 0, 0, height);
    if (dayFactor > 0.5) {
      veil.addColorStop(0, 'rgba(246, 248, 252, 0.56)');
      veil.addColorStop(0.6, 'rgba(246, 248, 252, 0.38)');
      veil.addColorStop(1, 'rgba(246, 248, 252, 0.18)');
    } else {
      veil.addColorStop(0, 'rgba(7, 9, 15, 0.42)');
      veil.addColorStop(0.6, 'rgba(7, 9, 15, 0.28)');
      veil.addColorStop(1, 'rgba(7, 9, 15, 0.14)');
    }
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, width, height);
  }

  function isMotionSuppressed() {
    return (
      reducedMotionQuery.matches ||
      document.body.hasAttribute('data-motion-paused') ||
      document.hidden
    );
  }

  function renderFrame(now, dtSec) {
    let twilightGlow = 0;
    if (twilight) {
      const progress = Math.min(1, (now - twilight.start) / TWILIGHT_DURATION_MS);
      twilightGlow = Math.sin(progress * Math.PI);
      dayFactor = twilight.mode === 'sunrise' ? progress : 1 - progress;
      if (progress >= 0.48 && !twilight.switchedTheme) {
        twilight.switchedTheme = true;
        setScheme(twilight.mode === 'sunrise' ? 'light' : 'dark', twilight.persistOverride);
      }
      if (progress >= 1) {
        dayFactor = targetDayFactor;
        twilight = null;
        stage.removeAttribute('data-twilight');
      }
    }

    if (dtSec > 0 && !isMotionSuppressed()) {
      const dtMs = dtSec * 1000;
      cycleAccumulator += dtMs;
      if (cycleAccumulator >= DAY_NIGHT_INTERVAL_MS && !twilight) {
        cycleAccumulator = 0;
        startTwilightTransition(isDarkScheme(), false);
      }

      if (dayFactor < 0.35) {
        meteorAccumulator += dtMs;
        cometAccumulator += dtMs;
        if (meteorAccumulator >= METEOR_INTERVAL_MS) {
          meteorAccumulator = 0;
          spawnMeteorite();
        }
        if (cometAccumulator >= COMET_INTERVAL_MS) {
          cometAccumulator = 0;
          spawnComet();
        }
      }

      if (meteorite.active) meteorite.elapsed += dtSec;
      if (comet.active) comet.elapsed += dtSec;
    }

    const timeSec = now * 0.001;
    drawSkyAndTwilight(timeSec, twilightGlow);
    drawComet();
    drawMeteorite();
    drawVolcanoAndCoolingLava(timeSec, dtSec);
  }

  function tick(now) {
    if (!running) return;
    const dtSec = Math.min(0.05, Math.max(0, (now - lastNow) * 0.001));
    lastNow = now;
    renderFrame(now, dtSec);

    if (isMotionSuppressed() && !twilight) {
      running = false;
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function ensureLoop() {
    if (isMotionSuppressed() && !twilight) {
      renderFrame(performance.now(), 0);
      return;
    }
    if (!running) {
      running = true;
      lastNow = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    running = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else {
      ensureLoop();
    }
  });

  reducedMotionQuery.addEventListener('change', () => {
    if (reducedMotionQuery.matches) {
      stopLoop();
      dayFactor = isDarkScheme() ? 0 : 1;
      renderFrame(performance.now(), 0);
    } else {
      ensureLoop();
    }
  });

  renderFrame(performance.now(), 0);
  ensureLoop();

  const api = {
    syncMotionState() {
      if (isMotionSuppressed()) {
        stopLoop();
        renderFrame(performance.now(), 0);
      } else {
        ensureLoop();
      }
    },
    transitionToScheme(targetScheme, persistOverride = true) {
      cycleAccumulator = 0;
      const toLight = targetScheme === 'light';
      if (reducedMotionQuery.matches || document.body.hasAttribute('data-motion-paused')) {
        dayFactor = toLight ? 1 : 0;
        targetDayFactor = dayFactor;
        setScheme(targetScheme, persistOverride);
        renderFrame(performance.now(), 0);
        return;
      }
      startTwilightTransition(toLight, persistOverride);
    },
    syncImmediateScheme() {
      if (!twilight) {
        dayFactor = isDarkScheme() ? 0 : 1;
        targetDayFactor = dayFactor;
        renderFrame(performance.now(), 0);
      }
    },
    spawnMeteorite() {
      const ok = spawnMeteorite();
      if (ok) renderFrame(performance.now(), 0.016);
      ensureLoop();
      return ok;
    },
    spawnComet() {
      const ok = spawnComet();
      if (ok) renderFrame(performance.now(), 0.016);
      ensureLoop();
      return ok;
    },
    triggerCycle() {
      startTwilightTransition(isDarkScheme(), false);
    },
  };

  window.__basaltSky = api;
  return api;
}
