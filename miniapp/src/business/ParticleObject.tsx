import { useEffect, useRef } from 'react';
import { createParticles, drawParticles, particleCount, type ParticleIntensity } from './particle-engine';
import './particle-object.css';

/**
 * Экспериментальный компонент, нигде не монтируется. Текущая сфера — не утверждённый дизайн.
 * Следующая версия должна осмысленно показывать переход
 * «разрозненные элементы → структурированное решение», поддерживать morph
 * и scroll-driven transition. Это отдельная будущая задача, здесь не реализованная.
 */
export type ParticleObjectProps = {
  variant?: 'orb';
  intensity?: ParticleIntensity;
  /** This decorative version deliberately has no pointer or device listeners. */
  interactive?: false;
  className?: string;
};

// Survives route remounts without storage access in the MAX WebView.
let hasShownIntro = false;

export function ParticleObject({ variant = 'orb', intensity = 'normal', className = '' }: ParticleObjectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 767px), (pointer: coarse)');
    const light = window.matchMedia('(prefers-color-scheme: light)');
    let particles = createParticles(particleCount(mobile.matches, intensity));
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame: number | null = null;
    let previous: number | null = null;
    let elapsed = hasShownIntro ? 1800 : 0;
    let inView = !('IntersectionObserver' in window);
    let disposed = false;

    const draw = () => drawParticles(ctx, particles, width, height, elapsed, motion.matches, light.matches);
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previous = null;
    };
    const tick = (now: number) => {
      frame = null;
      if (disposed || document.hidden || !inView || motion.matches || !width || !height) return;
      const delta = previous === null ? 0 : now - previous;
      // Mobile stays at ~30 fps, including on 120 Hz displays.
      if (previous === null || delta >= (mobile.matches ? 1000 / 30 : 1000 / 60) - 0.5) {
        elapsed += Math.min(delta, 64);
        previous = now;
        draw();
        if (elapsed >= 1800) hasShownIntro = true;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      if (disposed || document.hidden || !inView || !width || !height) return;
      if (motion.matches) {
        elapsed = 1800;
        hasShownIntro = true;
        draw();
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextDpr = Math.min(window.devicePixelRatio || 1, mobile.matches ? 1.5 : 2);
      if (width === rect.width && height === rect.height && dpr === nextDpr) return;
      width = rect.width;
      height = rect.height;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!document.hidden && inView) draw();
      sync();
    };
    const changeDensity = () => {
      particles = createParticles(particleCount(mobile.matches, intensity));
      resize();
      sync();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersection = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }) : null;
    intersection?.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', resize);
    motion.addEventListener('change', sync);
    mobile.addEventListener('change', changeDensity);
    light.addEventListener('change', sync);
    resize();

    return () => {
      disposed = true;
      // A brief first visit also skips the long entrance on the next visit.
      if (elapsed > 0) hasShownIntro = true;
      stop();
      observer.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', resize);
      motion.removeEventListener('change', sync);
      mobile.removeEventListener('change', changeDensity);
      light.removeEventListener('change', sync);
    };
  }, [intensity, variant]);

  return <canvas ref={canvasRef} className={`particle-object ${className}`} aria-hidden="true" />;
}
