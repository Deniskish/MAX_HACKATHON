export type ParticleIntensity = 'quiet' | 'normal';

type Particle = {
  x: number; y: number; z: number;
  fromX: number; fromY: number; fromZ: number;
  phase: number; size: number; color: number; ambient: boolean;
  corners: number[];
};

const TAU = Math.PI * 2;
const DARK_COLORS = ['#9475ed', '#b39af4', '#7654cb', '#e0a563', '#628f9e'];
const LIGHT_COLORS = ['#7550bf', '#8863ca', '#6540ad', '#a96932', '#437582'];

export function particleCount(mobile: boolean, intensity: ParticleIntensity) {
  return mobile ? (intensity === 'quiet' ? 280 : 420) : (intensity === 'quiet' ? 700 : 1000);
}

// Seeded geometry: resizing / reduced motion always retain the same composition.
export function createParticles(count: number): Particle[] {
  let seed = 731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const fraction = i / count;
    const ambient = fraction >= 0.9;
    const orbit = fraction >= 0.72 && !ambient;
    const angle = i * 2.399963229728653;
    const y = 1 - 2 * (i + 0.5) / (count * 0.72);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = 0.72 + random() * 0.075;
    let x = Math.cos(angle) * ring * radius;
    let targetY = y * radius;
    let z = Math.sin(angle) * ring * radius;
    if (orbit) {
      // A tilted belt supports the core: independent data finding a shared orbit.
      const r = 1.04 + (random() - 0.5) * 0.095;
      x = Math.cos(angle) * r;
      targetY = Math.sin(angle) * r * 0.32 + (random() - 0.5) * 0.055;
      z = Math.sin(angle) * r * 0.78;
    } else if (ambient) {
      x = (random() - 0.5) * 2.9;
      targetY = (random() - 0.5) * 2.15;
      z = (random() - 0.5) * 1.8;
    }
    const orientation = random() * TAU;
    const color = random();
    return {
      x, y: targetY, z, ambient,
      fromX: (random() - 0.5) * 3.6,
      fromY: (random() - 0.5) * 2.8,
      fromZ: (random() - 0.5) * 2.4,
      phase: random() * TAU,
      size: 0.65 + random() * 0.85,
      color: color < 0.07 ? 3 : color < 0.13 ? 4 : i % 3,
      corners: Array.from({ length: 6 }, (_, j) => {
        const a = orientation + Math.floor(j / 2) * TAU / 3;
        return j % 2 ? Math.sin(a) : Math.cos(a);
      }),
    };
  });
}

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function drawParticles(
  ctx: CanvasRenderingContext2D, particles: Particle[], width: number, height: number,
  elapsed: number, reducedMotion: boolean, light: boolean,
) {
  ctx.clearRect(0, 0, width, height);
  const assembly = reducedMotion ? 1 : smooth((elapsed - 500) / 1300);
  const opacity = reducedMotion ? 1 : smooth(elapsed / 500);
  const time = reducedMotion ? 0 : Math.max(0, elapsed - 1800) / 1000;
  const rotation = time * 0.045; // One revolution in ~140 seconds.
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const breath = 1 + Math.sin(time * 0.65) * 0.018;
  const scale = Math.min(width / 3.15, height / 2.65);
  const colors = light ? LIGHT_COLORS : DARK_COLORS;

  for (const p of particles) {
    const drift = Math.sin(time * 0.5 + p.phase) * 0.012;
    const x = p.fromX + (p.x * breath - p.fromX) * assembly;
    const y = p.fromY + (p.y * breath - p.fromY) * assembly + drift * assembly;
    const z = p.fromZ + (p.z * breath - p.fromZ) * assembly;
    const rx = x * cos + z * sin;
    const rz = z * cos - x * sin;
    const perspective = 3.8 / (3.8 - rz);
    // Slight in-plane tilt makes the supporting belt readable at small sizes.
    const px = width / 2 + (rx * 0.966 - y * 0.259) * scale * perspective;
    const py = height / 2 + (rx * 0.259 + y * 0.966) * scale * perspective;
    const depth = Math.max(0, Math.min(1, (rz + 1.2) / 2.4));
    const size = p.size * perspective * Math.max(0.8, Math.min(1.35, scale / 95));
    ctx.globalAlpha = opacity * (p.ambient ? 0.22 : 0.3 + depth * 0.62);
    ctx.fillStyle = colors[p.color];
    ctx.beginPath();
    ctx.moveTo(px + p.corners[0] * size, py + p.corners[1] * size);
    ctx.lineTo(px + p.corners[2] * size, py + p.corners[3] * size);
    ctx.lineTo(px + p.corners[4] * size, py + p.corners[5] * size);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
