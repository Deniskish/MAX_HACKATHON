type GlassShape = 'ring' | 'loop' | 'tiles';

/** Decorative only: the artwork never replaces a label or captures a touch. */
export function GlassArt({ shape, size = 112, className = '' }: {
  shape: GlassShape; size?: number; className?: string;
}) {
  return <img className={`glass-art glass-art-${shape} ${className}`}
    src={`/assets/glass/${shape}.png`} alt="" aria-hidden="true"
    width={size} height={size} draggable={false} decoding="async" />;
}
