import React, { type ImgHTMLAttributes } from 'react';
import { useSystemTheme } from '../theme';
import { artwork } from './artwork';

/** Separate artwork per OS theme; only the selected image is downloaded. */
export function ThemedImage({ src, sizes, onError, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const theme = useSystemTheme();
  const [failedSource, setFailedSource] = React.useState<string | null>(null);
  const image = artwork[src];
  const variant = image?.[theme];
  const source = `${variant?.src ?? src}|${variant?.srcSet ?? ''}`;
  // Hide failed decorative artwork; retry naturally when its theme/source changes.
  if (props.alt === '' && failedSource === source) return null;
  return <img decoding="async" {...props} sizes={sizes ?? image?.sizes}
    onError={(event) => { setFailedSource(source); onError?.(event); }}
    srcSet={variant?.srcSet} src={variant?.src ?? src} />;
}
