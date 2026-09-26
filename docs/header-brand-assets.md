# Логотип в шапке

Две прозрачные версии исходного знака `main_logo.png` подготовлены встроенным imagegen, затем уменьшены до 128 × 128 и сохранены в WebP с альфа-каналом:

- `miniapp/src/business/brand-mark-dark.webp` — светлый знак для тёмной темы, 4,9 КБ.
- `miniapp/src/business/brand-mark-light.webp` — графитовый знак для светлой темы, 4,5 КБ.

`HomePage` выбирает файл через `useSystemTheme`. Цвет соответствует центральной надписи. Фон и отверстие буквы прозрачные; CSS-фильтры и непрозрачная круглая обрезка не используются. Vite добавляет хеш в имя файла для кеширования. Исходный логотип сохранён.

## Запросы imagegen

Тёмная тема, исходное изображение `miniapp/src/business/main-logo.webp`:

> Edit this exact existing Opora O. logo for use as a mobile header brand mark. Preserve the exact tilted thick ring letter O and circular period, proportions, orientation, white silver pearlescent material, subtle cool edges. REMOVE the entire black background and ambient haze, fully transparent alpha including the hole in O. No background, no panel, no scene, no cast shadow outside letters, no glow halo. The isolated O. fills 86% of a square canvas, centered, not cropped. Crisp silhouette legible at 44px. Output a transparent PNG asset, white/silver version for a dark UI. Save output locally.

Светлая тема, исходное изображение — результат предыдущего запроса:

> Edit only the material color of this isolated O. logo. Preserve exact geometry, silhouette, scale, position and transparent alpha background and transparent hole. Make a restrained dark graphite satin metal version (body #303137, softly lit gray bevels) for a serious business app on a white background. No purple/pink, no glow, no colored reflections, no backdrop, no cast shadows, no extra objects. Output transparent PNG same square canvas and placement as reference. This is the light UI variant matching a graphite 3D Opora wordmark.
