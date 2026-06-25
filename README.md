# NAGIHD

**Mejora de vídeo con IA** — sube vídeos antiguos de baja resolución a 1080p / 1440p / 4K, con escalado por IA y opción de aumentar los FPS (fluidez). 100% offline, corre en tu GPU.

© 2026 NAGI STUDIOS

---

## Qué hace

1. **Extrae** los fotogramas y el audio del vídeo (FFmpeg).
2. **Escala con IA** cada fotograma con **Real-ESRGAN** (reconstruye detalle, limpia ruido, define bordes) — no es un simple estirado.
3. *(Opcional)* **Interpola** fotogramas con **RIFE** para duplicar los FPS (24→48/60).
4. **Recompone** el vídeo final en MP4 con el audio original (NVENC en GPU o x264 en CPU).

### Modos de contenido
- **Anime / Dibujos** → `realesr-animevideov3` (bordes nítidos, rápido).
- **Vídeo real** → `realesrgan-x4plus` (limpieza de ruido, detalle en grabaciones reales).
- **Gameplay** → modelo rápido tipo vídeo para clips de juegos.

> Expectativa honesta: en anime/dibujos/gameplay el salto es espectacular. En vídeo real (personas) la mejora es clara, pero la IA no inventa detalle que no existía.

---

## Instalación (desarrollo)

```bash
npm install          # Electron + FFmpeg
npm run fetch-bin    # descarga los motores de IA (Real-ESRGAN + RIFE) a bin\
npm start            # arranca la app
```

Los motores (`bin\realesrgan`, `bin\rife`) son binarios ncnn-vulkan portables: corren en
cualquier GPU vía Vulkan (NVIDIA/AMD/Intel), sin Python y sin internet una vez descargados.

## Empaquetar (instalador + auto-update)

```bash
npm run dist         # genera el instalador NSIS en dist\
npm run release      # build + publica la Release en GitHub (auto-update)
```

El auto-update usa `electron-updater` + GitHub Releases (repo `djgaiaffxiv-ctrl/NAGIHD`).

---

## Requisitos
- Windows 10/11 con GPU compatible con Vulkan (probado en **RTX 3080**).
- Node.js 18+ (para desarrollo).

## Rendimiento
El cuello de botella es el escalado por IA (depende de la GPU y de la duración/resolución del vídeo).
La codificación final usa **NVENC** para ir rápida. Para máxima calidad, elige x264 (CPU, más lento).
