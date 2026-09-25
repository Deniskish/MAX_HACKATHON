import type { ImgHTMLAttributes } from 'react';
import { useSystemTheme } from '../theme';
import { artwork } from './artwork';

/** Separate artwork per OS theme; only the selected image is downloaded. */
export function ThemedImage({ src, sizes, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const theme = useSystemTheme();
  const image = artwork[src];
  const variant = image?.[theme];
  return <img decoding="async" {...props} sizes={sizes ?? image?.sizes}
    srcSet={variant?.srcSet} src={variant?.src ?? src} />;
}
