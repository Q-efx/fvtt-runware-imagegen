/**
 * Client-side image compositing for token outputs.
 *
 * Runware returns separate layers (the background-free subject, a generated
 * background, a generated ring), and the module stacks, clips, and scales them
 * into one PNG. That happens here, in the browser, rather than as another
 * Runware task: canvas work is free, instant, and deterministic, whereas every
 * Runware request costs money and would regenerate (and change) the pixels.
 *
 * Only same-origin sources are ever drawn. A cross-origin image drawn into a
 * canvas "taints" it, after which exporting the canvas throws a SecurityError -
 * so a cross-origin URL is refused up front with a readable error instead of
 * failing obscurely at export time. Base64 and data: URIs are decoded locally,
 * never fetched.
 *
 * No Foundry, Runware, or settings imports: this is plain canvas code.
 */

/**
 * @typedef {{ imageBase64Data: string }} Base64Image
 * Raw base64 PNG; a "data:" prefix is tolerated on input.
 */

/**
 * @typedef {ImageBitmap|Blob|Base64Image|string} ImageSource
 * A string is a data: URI OR a same-origin path/URL (e.g. the Foundry data path
 * "images/runware/rings/ring_3.png"). Raw base64 must be wrapped as
 * `{ imageBase64Data }`; a bare string is never treated as base64.
 */

/**
 * @typedef {object} CompositeLayer
 * @property {ImageSource} src - The image to draw.
 * @property {'cover'|'contain'|'stretch'} [fit='contain'] - How the image fills its box.
 * @property {number} [scale=1] - Box edge as a fraction of the output size, centred.
 * @property {number|null} [clipCircle=null] - Clip radius as a fraction of
 *   min(width, height) / 2, centred; clamped to at most 1.
 */

/**
 * Decode any supported image source into an ImageBitmap.
 * An ImageBitmap passed in is returned as-is (the caller still owns it); any
 * other source yields a new bitmap the caller is responsible for closing.
 * @param {ImageSource} src
 * @returns {Promise<ImageBitmap>}
 */
export async function loadBitmap(src) {
  if (isImageBitmap(src)) return src;

  if (typeof Blob !== 'undefined' && src instanceof Blob) {
    return decodeBlob(src);
  }

  if (src && typeof src === 'object' && 'imageBase64Data' in src) {
    return decodeBlob(base64ToBlob(src.imageBase64Data));
  }

  if (typeof src === 'string' && src) {
    if (/^data:/i.test(src)) return decodeBlob(base64ToBlob(src));
    return decodeBlob(await fetchSameOrigin(src));
  }

  throw new Error('No image to load.');
}

/**
 * Natural pixel size of an image source.
 * @param {ImageSource} src
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function getImageSize(src) {
  const bitmap = await loadBitmap(src);
  const { width, height } = bitmap;
  if (bitmap !== src) bitmap.close();
  return { width, height };
}

/**
 * Stack layers bottom -> top into one PNG of the given size.
 * Falsy entries in `layers` are skipped, so callers can write
 * `[background && {...}, subject, ring]`.
 * @param {object} options
 * @param {number} options.width - Output width, px.
 * @param {number} options.height - Output height, px.
 * @param {Array<CompositeLayer|null|undefined|false>} options.layers
 * @returns {Promise<Base64Image>}
 */
export async function compositeLayers({ width, height, layers }) {
  const outputWidth = toCanvasDimension(width, 'width');
  const outputHeight = toCanvasDimension(height, 'height');
  const activeLayers = (Array.isArray(layers) ? layers : []).filter(Boolean);

  // Decode every layer up front (in parallel). allSettled rather than all, so
  // that when one layer fails the bitmaps that did load can still be closed.
  const settled = await Promise.allSettled(activeLayers.map((layer) => loadBitmap(layer.src)));
  const bitmaps = settled.map((result) => (result.status === 'fulfilled' ? result.value : null));

  try {
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;

    const { canvas, ctx } = createCanvas(outputWidth, outputHeight);
    const halfMin = Math.min(outputWidth, outputHeight) / 2;

    activeLayers.forEach((layer, index) => {
      const bitmap = bitmaps[index];
      const scale = Number.isFinite(layer.scale) && layer.scale > 0 ? layer.scale : 1;
      const box = {
        width: outputWidth * scale,
        height: outputHeight * scale
      };
      box.x = (outputWidth - box.width) / 2;
      box.y = (outputHeight - box.height) / 2;

      const rect = fitRect(bitmap.width, bitmap.height, box, layer.fit);
      const clip = Number(layer.clipCircle);
      const hasClip = layer.clipCircle !== null && layer.clipCircle !== undefined
        && layer.clipCircle !== false && Number.isFinite(clip);

      ctx.save();
      if (layer.fit === 'cover') {
        // A cover-fit image overflows its box; crop it to the box, not the canvas.
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.clip();
      }
      if (hasClip) {
        ctx.beginPath();
        ctx.arc(outputWidth / 2, outputHeight / 2, Math.max(0, Math.min(1, clip)) * halfMin, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    });

    return await exportPng(canvas);
  } finally {
    // Close only the bitmaps decoded here, never ones the caller passed in.
    bitmaps.forEach((bitmap, index) => {
      if (bitmap && bitmap !== activeLayers[index].src) bitmap.close();
    });
  }
}

/**
 * Cut a centred transparent hole into an image (e.g. the empty centre of a
 * generated ring), optionally also clearing everything outside a larger circle.
 * The output has the source's size.
 * @param {ImageSource} src
 * @param {number} innerRadius - Hole radius as a fraction of min(w, h) / 2.
 * @param {object} [options]
 * @param {number|null} [options.outerRadius=null] - Keep only pixels inside this
 *   radius (same units); null keeps the corners.
 * @returns {Promise<Base64Image>}
 */
export async function punchCircle(src, innerRadius, { outerRadius = null } = {}) {
  const bitmap = await loadBitmap(src);
  try {
    const { width, height } = bitmap;
    const { canvas, ctx } = createCanvas(width, height);
    const halfMin = Math.min(width, height) / 2;
    const centreX = width / 2;
    const centreY = height / 2;

    ctx.drawImage(bitmap, 0, 0, width, height);

    const inner = Number(innerRadius);
    if (Number.isFinite(inner) && inner > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(centreX, centreY, inner * halfMin, 0, Math.PI * 2);
      ctx.fill();
    }

    const outer = Number(outerRadius);
    if (outerRadius !== null && outerRadius !== undefined && Number.isFinite(outer)) {
      // destination-in keeps existing pixels only where the new shape is drawn.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.arc(centreX, centreY, Math.max(0, outer) * halfMin, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    return await exportPng(canvas);
  } finally {
    if (bitmap !== src) bitmap.close();
  }
}

/**
 * Turn base64 image data into a PNG data URI, e.g. for an <img> src or a
 * Runware `inputImage`. A string that already is a data: URI is returned
 * as-is; any other string is taken to be raw base64.
 * @param {Base64Image|string} image
 * @returns {string} The data URI, or '' when there is no image data.
 */
export function toDataURI(image) {
  const data = typeof image === 'string' ? image : image?.imageBase64Data;
  if (typeof data !== 'string') return '';
  const trimmed = data.trim();
  if (!trimmed) return '';
  if (/^data:/i.test(trimmed)) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isImageBitmap(value) {
  return typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
}

/**
 * Where an image of iw x ih lands inside `box` for the given fit mode.
 * cover crops centred, contain letterboxes centred, stretch fills the box.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {'cover'|'contain'|'stretch'} [fit='contain']
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function fitRect(imageWidth, imageHeight, box, fit = 'contain') {
  if (fit === 'stretch' || !imageWidth || !imageHeight) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const ratioX = box.width / imageWidth;
  const ratioY = box.height / imageHeight;
  const ratio = fit === 'cover' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY);
  const width = imageWidth * ratio;
  const height = imageHeight * ratio;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height
  };
}

function toCanvasDimension(value, name) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`Invalid composite ${name}: ${value}`);
  }
  return number;
}

/**
 * Decode base64 (bare, or a data: URI) into a Blob without going through
 * fetch(). Non-base64 data: URIs (percent-encoded text such as SVG) are
 * decoded too.
 * @param {string} data
 * @returns {Blob}
 */
function base64ToBlob(data) {
  if (typeof data !== 'string' || !data.trim()) {
    throw new Error('No image data to decode.');
  }

  let mimeType = 'image/png';
  let payload = data.trim();
  let isBase64 = true;

  const match = /^data:([^,]*),/i.exec(payload);
  if (match) {
    const params = match[1].split(';').map((part) => part.trim());
    if (params[0]) mimeType = params[0].toLowerCase();
    isBase64 = params.slice(1).some((part) => part.toLowerCase() === 'base64');
    payload = payload.slice(match[0].length);
  }

  if (!isBase64) {
    try {
      return new Blob([decodeURIComponent(payload)], { type: mimeType });
    } catch {
      throw new Error('Could not decode the image data URI.');
    }
  }

  let binary;
  try {
    binary = atob(payload.replace(/\s+/g, ''));
  } catch {
    throw new Error('Could not decode the image: the data is not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function decodeBlob(blob) {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    const reason = error?.message ? `: ${error.message}` : '';
    throw new Error(`Could not decode the image${reason}`);
  }
}

/**
 * Fetch an image from the Foundry server. Relative paths (Foundry data paths)
 * resolve against the current page, so a route prefix is honoured.
 * @param {string} path
 * @returns {Promise<Blob>}
 */
async function fetchSameOrigin(path) {
  let url;
  try {
    url = new URL(path, window.location.href);
  } catch {
    throw new Error(`Invalid image path: ${path}`);
  }
  if (url.origin !== window.location.origin) {
    throw new Error('Refusing to load a cross-origin image (canvas would be tainted).');
  }

  let response;
  try {
    response = await fetch(url.href);
  } catch (error) {
    const reason = error?.message ? `: ${error.message}` : '';
    throw new Error(`Could not load image "${path}"${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Could not load image "${path}" (HTTP ${response.status}).`);
  }
  return response.blob();
}

/**
 * A 2D canvas of the given size. Prefers OffscreenCanvas (no DOM involvement),
 * but only when it can both draw and export - some browsers shipped the
 * constructor without a working 2D context or without convertToBlob(). Falls
 * back to a detached <canvas> element.
 * @param {number} width
 * @param {number} height
 * @returns {{ canvas: OffscreenCanvas|HTMLCanvasElement, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D }}
 */
function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function'
    && typeof OffscreenCanvas.prototype?.convertToBlob === 'function') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (ctx) return { canvas, ctx: configureContext(ctx) };
    } catch {
      // Fall through to the DOM canvas.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for image compositing.');
  return { canvas, ctx: configureContext(ctx) };
}

function configureContext(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Encode a canvas as PNG and return its bare base64.
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @returns {Promise<Base64Image>}
 */
async function exportPng(canvas) {
  const blob = await canvasToBlob(canvas);
  const dataUrl = await blobToDataURL(blob);
  const comma = dataUrl.indexOf(',');
  const imageBase64Data = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  if (!imageBase64Data) throw new Error('Could not export the composited image.');
  return { imageBase64Data };
}

function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // toBlob() hands back null (instead of throwing) when the canvas is too
      // large or can't be encoded.
      if (blob) resolve(blob);
      else reject(new Error('Could not export the composited image.'));
    }, 'image/png');
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the composited image.'));
    reader.readAsDataURL(blob);
  });
}
