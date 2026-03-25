'use client';

import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let haptics: any = null;
if (typeof window !== 'undefined') {
  import('web-haptics').then((mod) => {
    haptics = new mod.WebHaptics();
  }).catch(() => {});
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface DitherParams {
  dotCount: number;
  dotRadius: number;
  contrast: number;
  brightness: number;
  bgSkip: number;
  cornerRadius: number;
  spring: number;
  damping: number;
  repulsionRadius: number;
  repulsionStrength: number;
  clickForce: number;
}

const DEFAULTS: DitherParams = {
  dotCount: 8000,
  dotRadius: 1.2,
  contrast: 1.2,
  brightness: 1.0,
  bgSkip: 240,
  cornerRadius: 0.5,
  spring: 0.05,
  damping: 0.7,
  repulsionRadius: 45,
  repulsionStrength: 2,
  clickForce: 12,
};

// ─── Colorful Pointillist Sampling ───────────────────────────────────────────

interface ColorDot {
  x: number; y: number;
  r: number; g: number; b: number;
}

// iOS-style squircle: |x|^n + |y|^n <= 1 where n controls the shape
// n=2 is a circle, n→∞ is a square, ~4-5 gives the iOS squircle feel
function insideSquircle(x: number, y: number, hw: number, hh: number, radius: number): boolean {
  if (radius <= 0) return true; // no rounding
  // Normalize to [-1, 1]
  const nx = Math.abs(x) / hw;
  const ny = Math.abs(y) / hh;
  // Only test corners — if within the inner rect, always inside
  const cutoff = 1 - radius;
  if (nx <= cutoff || ny <= cutoff) return true;
  // Remap the corner region to [0,1]
  const cx = (nx - cutoff) / radius;
  const cy = (ny - cutoff) / radius;
  // Squircle exponent ~4.5 for iOS feel
  const n = 4.5;
  return Math.pow(cx, n) + Math.pow(cy, n) <= 1;
}

function sampleImageColors(
  imageSrc: string,
  maxDots: number,
  contrast: number,
  brightness: number,
  bgSkip: number,
  cornerRadius: number,
  targetWidth: number,
  targetHeight: number,
): Promise<ColorDot[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      let dw: number, dh: number;
      if (aspectRatio > targetWidth / targetHeight) {
        dw = targetWidth;
        dh = targetWidth / aspectRatio;
      } else {
        dh = targetHeight;
        dw = targetHeight * aspectRatio;
      }

      const sw = Math.round(dw);
      const sh = Math.round(dh);
      if (sw <= 0 || sh <= 0) { resolve([]); return; }

      const offscreen = document.createElement('canvas');
      offscreen.width = sw;
      offscreen.height = sh;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(img, 0, 0, sw, sh);
      const imageData = ctx.getImageData(0, 0, sw, sh);
      const data = imageData.data;

      // Grid sampling with jitter
      const spacing = Math.sqrt((sw * sh) / maxDots);
      const dots: ColorDot[] = [];

      for (let gy = spacing / 2; gy < sh; gy += spacing) {
        for (let gx = spacing / 2; gx < sw; gx += spacing) {
          // Add random jitter within the grid cell
          const jx = gx + (Math.random() - 0.5) * spacing * 0.8;
          const jy = gy + (Math.random() - 0.5) * spacing * 0.8;
          const px = Math.floor(Math.max(0, Math.min(sw - 1, jx)));
          const py = Math.floor(Math.max(0, Math.min(sh - 1, jy)));
          const idx = (py * sw + px) * 4;

          const a = data[idx + 3];
          if (a < 20) continue; // skip transparent

          let cr = data[idx];
          let cg = data[idx + 1];
          let cb = data[idx + 2];

          // Luminance check — skip near-white background
          const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          if (lum > bgSkip) continue;

          // Squircle mask — skip dots outside the rounded shape
          const dotX = jx - sw / 2;
          const dotY = jy - sh / 2;
          if (!insideSquircle(dotX, dotY, sw / 2, sh / 2, cornerRadius)) continue;

          // Apply brightness then contrast
          cr = Math.max(0, Math.min(255, cr * brightness));
          cg = Math.max(0, Math.min(255, cg * brightness));
          cb = Math.max(0, Math.min(255, cb * brightness));
          cr = Math.max(0, Math.min(255, ((cr / 255 - 0.5) * contrast + 0.5) * 255));
          cg = Math.max(0, Math.min(255, ((cg / 255 - 0.5) * contrast + 0.5) * 255));
          cb = Math.max(0, Math.min(255, ((cb / 255 - 0.5) * contrast + 0.5) * 255));

          dots.push({
            x: jx - sw / 2,
            y: jy - sh / 2,
            r: cr, g: cg, b: cb,
          });
        }
      }

      // If we got more than maxDots, shuffle and trim
      if (dots.length > maxDots) {
        for (let i = dots.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [dots[i], dots[j]] = [dots[j], dots[i]];
        }
        dots.length = maxDots;
      }

      resolve(dots);
    };
    img.onerror = () => resolve([]);
    img.src = imageSrc;
  });
}

// ─── Slider Component — filled pill with drag ────────────────────────────────

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fraction = (value - min) / (max - min);
  const textColor = fraction > 0.35 ? '#000' : '#fff';

  function calcValue(clientX: number) {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const raw = min + (x / rect.width) * (max - min);
    const stepped = Math.round(raw / step) * step;
    const clamped = Math.max(min, Math.min(max, parseFloat(stepped.toFixed(6))));
    onChange(clamped);
    try { haptics?.trigger('selection'); } catch {}
  }

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!dragging.current) return;
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      calcValue(cx);
    }
    function onUp() { dragging.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, step]);

  return (
    <div
      ref={ref}
      data-panel
      onMouseDown={(e) => { dragging.current = true; calcValue(e.clientX); }}
      onTouchStart={(e) => { dragging.current = true; calcValue(e.touches[0].clientX); }}
      style={{
        position: 'relative', height: 48, borderRadius: 12,
        background: 'rgba(255,255,255,0.08)', marginBottom: 8, cursor: 'pointer',
        overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none',
      }}
    >
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: fraction * 100 + '%', background: 'rgba(255,255,255,0.9)', borderRadius: 12,
      }} />
      <div style={{
        position: 'absolute', left: `calc(${fraction * 100}% - 1px)`,
        top: 10, width: 2, height: 28,
        background: fraction > 0.02 ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.2)',
        borderRadius: 1,
      }} />
      <div style={{
        position: 'relative', zIndex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        height: '100%', padding: '0 16px', pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: textColor }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 400, color: textColor, fontVariantNumeric: 'tabular-nums' }}>
          {step >= 1 ? value : value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// ─── Particle data holder ────────────────────────────────────────────────────

interface Particles {
  posX: Float32Array; posY: Float32Array;
  velX: Float32Array; velY: Float32Array;
  targetX: Float32Array; targetY: Float32Array;
  radii: Float32Array;
  colorR: Float32Array; colorG: Float32Array; colorB: Float32Array;
  phaseX: Float32Array; phaseY: Float32Array;
  freqX: Float32Array; freqY: Float32Array;
  lastDisturbed: Float64Array;
  count: number;
}

function createParticles(count: number): Particles {
  const p: Particles = {
    posX: new Float32Array(count), posY: new Float32Array(count),
    velX: new Float32Array(count), velY: new Float32Array(count),
    targetX: new Float32Array(count), targetY: new Float32Array(count),
    radii: new Float32Array(count),
    colorR: new Float32Array(count), colorG: new Float32Array(count), colorB: new Float32Array(count),
    phaseX: new Float32Array(count), phaseY: new Float32Array(count),
    freqX: new Float32Array(count), freqY: new Float32Array(count),
    lastDisturbed: new Float64Array(count),
    count,
  };
  for (let i = 0; i < count; i++) {
    p.radii[i] = 0.85 + Math.random() * 0.3;
    p.phaseX[i] = Math.random() * Math.PI * 2;
    p.phaseY[i] = Math.random() * Math.PI * 2;
    p.freqX[i] = 0.3 + Math.random() * 0.7;
    p.freqY[i] = 0.3 + Math.random() * 0.7;
  }
  return p;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  interface Ripple {
    x: number; y: number;
    radius: number; maxRadius: number;
    speed: number; strength: number; width: number;
  }

  const stateRef = useRef({
    mouse: { x: -9999, y: -9999 },
    ripples: [] as Ripple[],
    particles: null as Particles | null,
    params: DEFAULTS,
    imageSrc: '/avatar.png',
    time: 0,
    ditherVersion: 0,
  });

  const [panelOpen, setPanelOpen] = useState(false);
  const [params, setParams] = useState<DitherParams>(DEFAULTS);
  const [imageSrc, setImageSrc] = useState<string>('/avatar.png');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      if (result) setImageSrc(result);
    };
    reader.readAsDataURL(file);
  }

  // Sync params to ref for animation loop
  stateRef.current.params = params;
  stateRef.current.imageSrc = imageSrc;

  // Sample image colors & update targets
  useEffect(() => {
    let cancelled = false;
    const s = stateRef.current;
    const p = s.params;
    const version = ++s.ditherVersion;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const targetH = Math.min(h * 0.7, 400);
    const targetW = Math.min(w * 0.7, 400);

    sampleImageColors(imageSrc, p.dotCount, p.contrast, p.brightness, p.bgSkip, p.cornerRadius, targetW, targetH)
      .then((dots) => {
        if (cancelled || version !== s.ditherVersion || dots.length === 0) return;

        const count = dots.length;
        const cx = w / 2;
        const cy = h / 2;
        const old = s.particles;
        let particles: Particles;

        if (!old || old.count !== count) {
          particles = createParticles(count);
          if (old) {
            const copy = Math.min(old.count, count);
            for (let i = 0; i < copy; i++) {
              particles.posX[i] = old.posX[i];
              particles.posY[i] = old.posY[i];
              particles.velX[i] = old.velX[i];
              particles.velY[i] = old.velY[i];
            }
            for (let i = copy; i < count; i++) {
              particles.posX[i] = cx + (Math.random() - 0.5) * 400;
              particles.posY[i] = cy + (Math.random() - 0.5) * 400;
            }
          } else {
            for (let i = 0; i < count; i++) {
              particles.posX[i] = cx + (Math.random() - 0.5) * w * 0.8;
              particles.posY[i] = cy + (Math.random() - 0.5) * h * 0.8;
            }
          }
          s.particles = particles;
        } else {
          particles = old;
        }

        for (let i = 0; i < count; i++) {
          particles.targetX[i] = cx + dots[i].x;
          particles.targetY[i] = cy + dots[i].y;
          particles.colorR[i] = dots[i].r;
          particles.colorG[i] = dots[i].g;
          particles.colorB[i] = dots[i].b;
        }
      });

    return () => { cancelled = true; };
  }, [params.dotCount, params.contrast, params.brightness, params.bgSkip, params.cornerRadius, imageSrc]);

  // Animation loop — runs once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let animationId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = width + 'px';
      canvas!.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();

    function animate() {
      const s = stateRef.current;
      const p = s.particles;
      const cfg = s.params;
      s.time += 0.016;
      const time = s.time;

      // Clear — dark charcoal background
      ctx.fillStyle = 'rgb(12, 12, 14)';
      ctx.fillRect(0, 0, width, height);

      if (!p) {
        animationId = requestAnimationFrame(animate);
        return;
      }

      const mx = s.mouse.x;
      const my = s.mouse.y;
      const count = p.count;
      const now = Date.now();

      // Advance ripples
      const ripples = s.ripples;
      for (let r = 0; r < ripples.length; r++) {
        ripples[r].radius += ripples[r].speed;
      }
      s.ripples = ripples.filter((r) => r.radius < r.maxRadius);

      // Physics
      for (let i = 0; i < count; i++) {
        // Return delay
        const sinceDist = now - p.lastDisturbed[i];
        const returnFactor = sinceDist < 100 ? sinceDist / 100 : 1;
        const springStr = cfg.spring * returnFactor;

        // Spring
        const dx = p.targetX[i] - p.posX[i];
        const dy = p.targetY[i] - p.posY[i];
        p.velX[i] += dx * springStr;
        p.velY[i] += dy * springStr;

        // Cursor repulsion — cubic falloff
        const cdx = p.posX[i] - mx;
        const cdy = p.posY[i] - my;
        const dist = Math.sqrt(cdx * cdx + cdy * cdy);
        if (dist < cfg.repulsionRadius && dist > 0) {
          const t = 1 - dist / cfg.repulsionRadius;
          const force = t * t * t;
          const angle = Math.atan2(cdy, cdx);
          p.velX[i] += Math.cos(angle) * force * cfg.repulsionStrength;
          p.velY[i] += Math.sin(angle) * force * cfg.repulsionStrength;
          p.lastDisturbed[i] = now;
        }

        // Ripple wave forces
        for (let r = 0; r < s.ripples.length; r++) {
          const rip = s.ripples[r];
          const rdx = p.posX[i] - rip.x;
          const rdy = p.posY[i] - rip.y;
          const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
          const ringInner = rip.radius - rip.width / 2;
          const ringOuter = rip.radius + rip.width / 2;
          if (rdist > ringInner && rdist < ringOuter && rdist > 0) {
            const t = 1 - Math.abs(rdist - rip.radius) / (rip.width / 2);
            const fadeFactor = 1 - rip.radius / rip.maxRadius;
            const force = t * t * fadeFactor * rip.strength * 0.6;
            const angle = Math.atan2(rdy, rdx);
            p.velX[i] += Math.cos(angle) * force;
            p.velY[i] += Math.sin(angle) * force;
            p.lastDisturbed[i] = now;
          }
        }

        // Idle drift
        p.velX[i] += Math.sin(time * p.freqX[i] + p.phaseX[i]) * 0.03;
        p.velY[i] += Math.cos(time * p.freqY[i] + p.phaseY[i]) * 0.03;

        // Damping
        p.velX[i] *= cfg.damping;
        p.velY[i] *= cfg.damping;

        // Position
        p.posX[i] += p.velX[i];
        p.posY[i] += p.velY[i];
      }

      // Render — colored dots
      const baseRadius = cfg.dotRadius;
      for (let i = 0; i < count; i++) {
        const r = p.radii[i] * baseRadius;
        ctx.fillStyle = `rgb(${p.colorR[i] | 0},${p.colorG[i] | 0},${p.colorB[i] | 0})`;
        ctx.beginPath();
        ctx.arc(p.posX[i], p.posY[i], r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Faint expanding ripple rings
      for (let r = 0; r < s.ripples.length; r++) {
        const rip = s.ripples[r];
        const alpha = 0.04 * (1 - rip.radius / rip.maxRadius);
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      animationId = requestAnimationFrame(animate);
    }

    animationId = requestAnimationFrame(animate);

    function handleResize() {
      resize();
      const s = stateRef.current;
      const p = s.params;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const targetH = Math.min(h * 0.7, 400);
      const targetW = Math.min(w * 0.7, 400);
      const version = ++s.ditherVersion;
      sampleImageColors(s.imageSrc, p.dotCount, p.contrast, p.brightness, p.bgSkip, p.cornerRadius, targetW, targetH)
        .then((dots) => {
          if (version !== s.ditherVersion || dots.length === 0) return;
          const particles = s.particles;
          if (!particles) return;
          const cx = w / 2;
          const cy = h / 2;
          for (let i = 0; i < Math.min(particles.count, dots.length); i++) {
            particles.targetX[i] = cx + dots[i].x;
            particles.targetY[i] = cy + dots[i].y;
            particles.colorR[i] = dots[i].r;
            particles.colorG[i] = dots[i].g;
            particles.colorB[i] = dots[i].b;
          }
        });
    }

    function handleMouseMove(e: MouseEvent) {
      stateRef.current.mouse.x = e.clientX;
      stateRef.current.mouse.y = e.clientY;
    }

    let lastTouchEnd = 0;
    function handleClick(e: MouseEvent) {
      // Skip synthesized click events from touch — touchEnd already handled it
      if (Date.now() - lastTouchEnd < 500) return;
      if ((e.target as HTMLElement).closest('[data-panel]')) return;
      const imgCx = window.innerWidth / 2;
      const imgCy = window.innerHeight / 2;
      const clickDist = Math.sqrt((e.clientX - imgCx) ** 2 + (e.clientY - imgCy) ** 2);
      if (clickDist > 300) return;
      const cfg = stateRef.current.params;
      stateRef.current.ripples.push({
        x: e.clientX, y: e.clientY,
        radius: 0, maxRadius: 300,
        speed: 7, strength: cfg.clickForce, width: 70,
      });
      try { haptics?.trigger('medium'); } catch {}
    }

    function handleMouseLeave() {
      stateRef.current.mouse.x = -9999;
      stateRef.current.mouse.y = -9999;
    }

    let touchStart: { x: number; y: number; time: number } | null = null;

    function handleTouchStart(e: TouchEvent) {
      if ((e.target as HTMLElement).closest('[data-panel]')) return;
      e.preventDefault();
      const touch = e.touches[0];
      stateRef.current.mouse.x = touch.clientX;
      stateRef.current.mouse.y = touch.clientY;
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      try { haptics?.trigger('light'); } catch {}
    }

    function handleTouchMove(e: TouchEvent) {
      if ((e.target as HTMLElement).closest('[data-panel]')) return;
      e.preventDefault();
      const touch = e.touches[0];
      stateRef.current.mouse.x = touch.clientX;
      stateRef.current.mouse.y = touch.clientY;
    }

    function handleTouchEnd(e: TouchEvent) {
      if (touchStart) {
        const touch = e.changedTouches[0];
        if (touch) {
          const tapX = touch.clientX;
          const tapY = touch.clientY;
          const elapsed = Date.now() - touchStart.time;
          const dx = tapX - touchStart.x;
          const dy = tapY - touchStart.y;
          const moved = Math.sqrt(dx * dx + dy * dy);
          if (elapsed < 300 && moved < 15) {
            if (!(e.target as HTMLElement).closest('[data-panel]')) {
              const imgCx = window.innerWidth / 2;
              const imgCy = window.innerHeight / 2;
              const tapDist = Math.sqrt((tapX - imgCx) ** 2 + (tapY - imgCy) ** 2);
              if (tapDist <= 300) {
              const cfg = stateRef.current.params;
              stateRef.current.ripples.push({
                x: tapX,
                y: tapY,
                radius: 0,
                maxRadius: 300,
                speed: 7,
                strength: cfg.clickForce,
                width: 70,
              });
              try { haptics?.trigger('medium'); } catch {}
              }
            }
          }
        }
      }
      stateRef.current.mouse.x = -9999;
      stateRef.current.mouse.y = -9999;
      touchStart = null;
      lastTouchEnd = Date.now();
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Dark theme colors
  const t = {
    bg: 'rgb(12, 12, 14)', btnBg: 'rgba(20,20,20,0.8)', btnBorder: '#333',
    btnColor: '#888', btnHover: '#fff',
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed', top: 0, left: 0,
          width: '100vw', height: '100vh',
          background: 'rgb(12, 12, 14)', cursor: 'default', touchAction: 'none',
        }}
      />

      {/* Image upload */}
      <button
        data-panel
        onClick={() => fileInputRef.current?.click()}
        style={{
          position: 'fixed', top: 12, left: 12,
          width: 44, height: 44, borderRadius: 10,
          border: `1px solid ${t.btnBorder}`, background: t.btnBg,
          color: t.btnColor, fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001, transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.btnHover)}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.btnColor)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="3"/>
          <circle cx="8" cy="8" r="2"/>
          <path d="M22 16l-5.5-5.5L4 22"/>
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageUpload}
      />

      {/* Settings toggle */}
      <button
        data-panel
        onClick={() => setPanelOpen((o) => !o)}
        style={{
          position: 'fixed', top: 12, right: 12,
          width: 44, height: 44, borderRadius: 10,
          border: `1px solid ${t.btnBorder}`, background: t.btnBg,
          color: t.btnColor,
          fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001, transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.btnHover)}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.btnColor)}
      >
        {panelOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="14" y2="18"/>
          </svg>
        )}
      </button>

      {/* Settings panel */}
      <div
        data-panel
        style={{
          position: 'fixed', top: 0, right: 0,
          width: 320, height: '100vh',
          background: 'rgba(18,18,20,0.95)',
          borderLeft: 'none',
          borderRadius: '24px 0 0 24px',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
          padding: '60px 16px 16px',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          fontSize: 14, color: '#fff', zIndex: 1000,
          transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          overflowY: 'auto', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: 20, fontSize: 18, fontWeight: 700, color: '#fff' }}>
          Dither Tool
        </div>

        <div style={{ margin: '16px 0 8px 4px', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          POINTILLIST
        </div>

        <Slider label="Dot Count" value={params.dotCount} min={1000} max={8000} step={100} onChange={(v) => setParams((p) => ({ ...p, dotCount: v }))} />
        <Slider label="Dot Radius" value={params.dotRadius} min={0.5} max={4} step={0.1} onChange={(v) => setParams((p) => ({ ...p, dotRadius: v }))} />
        <Slider label="Contrast" value={params.contrast} min={0.5} max={3} step={0.05} onChange={(v) => setParams((p) => ({ ...p, contrast: v }))} />
        <Slider label="Brightness" value={params.brightness} min={0.5} max={2} step={0.05} onChange={(v) => setParams((p) => ({ ...p, brightness: v }))} />
        <Slider label="Background Skip" value={params.bgSkip} min={200} max={255} step={1} onChange={(v) => setParams((p) => ({ ...p, bgSkip: v }))} />
        <Slider label="Corner Radius" value={params.cornerRadius} min={0} max={0.5} step={0.01} onChange={(v) => setParams((p) => ({ ...p, cornerRadius: v }))} />

        <div style={{ margin: '16px 0 8px 4px', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          PHYSICS
        </div>
        <Slider label="Spring Stiffness" value={params.spring} min={0.01} max={0.1} step={0.005} onChange={(v) => setParams((p) => ({ ...p, spring: v }))} />
        <Slider label="Damping" value={params.damping} min={0.7} max={0.98} step={0.01} onChange={(v) => setParams((p) => ({ ...p, damping: v }))} />
        <Slider label="Repulsion Radius" value={params.repulsionRadius} min={10} max={300} step={5} onChange={(v) => setParams((p) => ({ ...p, repulsionRadius: v }))} />
        <Slider label="Repulsion Strength" value={params.repulsionStrength} min={2} max={20} step={0.5} onChange={(v) => setParams((p) => ({ ...p, repulsionStrength: v }))} />
        <Slider label="Click Explosion Force" value={params.clickForce} min={5} max={50} step={1} onChange={(v) => setParams((p) => ({ ...p, clickForce: v }))} />

        <div style={{ marginTop: 16 }}>
          <button
            style={{
              width: '100%', height: 48,
              background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 12,
              color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onClick={() => setParams(DEFAULTS)}
          >
            Reset Defaults
          </button>
          <button
            style={{
              width: '100%', height: 48, marginTop: 8,
              background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 12,
              color: '#fff', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onClick={() => {
              const pts = stateRef.current.particles;
              if (!pts) return;
              const coords = [];
              for (let i = 0; i < pts.count; i++) {
                coords.push({ x: Math.round(pts.targetX[i] * 100) / 100, y: Math.round(pts.targetY[i] * 100) / 100 });
              }
              console.log(JSON.stringify(coords, null, 2));
              console.log(`Exported ${coords.length} coordinates`);
            }}
          >
            Export Coordinates
          </button>
        </div>
      </div>
    </>
  );
}
