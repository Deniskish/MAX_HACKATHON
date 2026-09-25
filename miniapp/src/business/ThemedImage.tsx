import type { ImgHTMLAttributes } from 'react';
import { useSystemTheme } from '../theme';

/** Separate artwork per OS theme; only the selected image is downloaded. */
export function ThemedImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const theme = useSystemTheme();
  const lightName = src.slice(src.lastIndexOf('/') + 1).replace(/\.png$/, '.webp');
  return <img {...props} src={theme === 'light' ? `/assets/light/neutral/${lightName}` : src} />;
}
