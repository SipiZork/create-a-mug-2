import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CM_TO_UNITS = 0.01;
const MUG_WIDTH_CM = 21;
const MUG_HEIGHT_CM = 9;
/** Átlagos európai 330 ml-es bögre méretei. */
const MUG_3DL_HEIGHT_CM = 9.5;
const MUG_TOP_RADIUS_CM = 4.1;
const MUG_BOTTOM_RADIUS_CM = 4.0;
const MUG_AVG_RADIUS_CM = (MUG_TOP_RADIUS_CM + MUG_BOTTOM_RADIUS_CM) / 2;
/** Minimális üres sáv a peremeken és a fül mellett. */
const MUG_MARGIN_CM = 0.5;
const MUG_WHITE = 0xffffff;
/** Textúra szélén ennyi px fehér padding a szűrési csíkok ellen. */
const TEXTURE_PAD_PX = 3;
const HANDLE_SIZE = 10;

/** Egységes skála: a 21×9 cm vászon cm-helyesen férjen a bögrére (torzítás nélkül). */
function getMugDesignLayout() {
  const circumference = 2 * Math.PI * MUG_AVG_RADIUS_CM;
  const maxWidthCm = circumference - 2 * MUG_MARGIN_CM;
  // 1:1 cm leképezés, csak ha a szélesség nem fér, akkor zsugorítunk
  const scale = Math.min(1, maxWidthCm / MUG_WIDTH_CM);
  const designWidthCm = MUG_WIDTH_CM * scale;
  const designHeightCm = MUG_HEIGHT_CM * scale;
  const designArc = designWidthCm / MUG_AVG_RADIUS_CM;
  const sideGap = (2 * Math.PI - designArc) / 2;
  const bottomCm = Math.max(0, (MUG_3DL_HEIGHT_CM - designHeightCm) / 2);

  return { scale, designWidthCm, designHeightCm, designArc, sideGap, bottomCm };
}

const canvas = document.getElementById('designCanvas');
const ctx = canvas.getContext('2d');
const previewContainer = document.getElementById('mugPreview');

/** A 3D textúra erről a vászonról jön — kijelölő keret nélkül. */
const textureCanvas = document.createElement('canvas');
textureCanvas.width = canvas.width;
textureCanvas.height = canvas.height;
const textureCtx = textureCanvas.getContext('2d');

let shiftPressed = false;
let dragLayerId = null;

function isTypingInField() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') shiftPressed = true;

  const key = event.key.toLowerCase();
  const withCtrl = event.ctrlKey || event.metaKey;

  if (withCtrl && key === 'z' && !event.shiftKey) {
    if (isTypingInField()) return;
    event.preventDefault();
    undo();
    return;
  }

  if (withCtrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
    if (isTypingInField()) return;
    event.preventDefault();
    redo();
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (isTypingInField()) return;
    if (!selectedLayerId) return;
    event.preventDefault();
    deleteSelectedLayer();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') shiftPressed = false;
});

const imageUpload = document.getElementById('imageUpload');
const textInput = document.getElementById('textInput');
const textColor = document.getElementById('textColor');
const textStrokeColor = document.getElementById('textStrokeColor');
const textStrokeWidth = document.getElementById('textStrokeWidth');
const textFont = document.getElementById('textFont');
const textFontTrigger = document.getElementById('textFontTrigger');
const textFontList = document.getElementById('textFontList');
const textSize = document.getElementById('textSize');
const addTextBtn = document.getElementById('addTextBtn');
const layerList = document.getElementById('layerList');
const layerProps = document.getElementById('layerProps');
const selectedLayerName = document.getElementById('selectedLayerName');
const imageSizeControls = document.getElementById('imageSizeControls');
const textSizeControls = document.getElementById('textSizeControls');
const layerWidth = document.getElementById('layerWidth');
const layerHeight = document.getElementById('layerHeight');
const layerWidthValue = document.getElementById('layerWidthValue');
const layerHeightValue = document.getElementById('layerHeightValue');
const layerFontSize = document.getElementById('layerFontSize');
const layerFontSizeValue = document.getElementById('layerFontSizeValue');
const layerFont = document.getElementById('layerFont');
const layerFontTrigger = document.getElementById('layerFontTrigger');
const layerFontList = document.getElementById('layerFontList');
const layerTextContent = document.getElementById('layerTextContent');
const layerTextColor = document.getElementById('layerTextColor');
const layerStrokeColor = document.getElementById('layerStrokeColor');
const layerStrokeWidth = document.getElementById('layerStrokeWidth');
const layerStrokeWidthValue = document.getElementById('layerStrokeWidthValue');

const GOOGLE_FONTS_JSON =
  'https://cdn.jsdelivr.net/gh/hasinhayder/google-fonts/fonts.json';
const FALLBACK_FONTS = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Oswald',
  'Raleway',
  'Poppins',
  'Nunito',
  'Playfair Display',
  'Merriweather',
];

/** @type {string[]} */
let googleFonts = [...FALLBACK_FONTS];
const loadedFontFamilies = new Set();
const loadingFontFamilies = new Map();

function cssFontFamily(family) {
  return `"${String(family).replace(/"/g, '')}"`;
}

function googleFontsCssUrl(family) {
  const param = encodeURIComponent(family).replace(/%20/g, '+');
  return `https://fonts.googleapis.com/css2?family=${param}:wght@400;700&display=swap`;
}

function ensureFontLoaded(family) {
  const name = family || 'Roboto';
  if (loadedFontFamilies.has(name)) return Promise.resolve(name);
  if (loadingFontFamilies.has(name)) return loadingFontFamilies.get(name);

  const promise = new Promise((resolve) => {
    const id = `gf-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = googleFontsCssUrl(name);
      link.dataset.googleFont = name;
      document.head.appendChild(link);
    }

    const quoted = cssFontFamily(name);
    const loadPromise =
      document.fonts && document.fonts.load
        ? Promise.all([
            document.fonts.load(`400 32px ${quoted}`),
            document.fonts.load(`700 32px ${quoted}`),
          ])
        : Promise.resolve();

    loadPromise
      .catch(() => {})
      .finally(() => {
        loadedFontFamilies.add(name);
        loadingFontFamilies.delete(name);
        resolve(name);
      });
  });

  loadingFontFamilies.set(name, promise);
  return promise;
}

function setFontPickerValue(hiddenInput, triggerBtn, family) {
  const name = family || 'Roboto';
  hiddenInput.value = name;
  triggerBtn.replaceChildren();
  const label = document.createElement('span');
  label.textContent = name;
  label.style.fontFamily = cssFontFamily(name);
  triggerBtn.appendChild(label);
}

function setupFontPicker({ triggerBtn, listEl, hiddenInput, onSelect }) {
  const root = triggerBtn.closest('.font-picker');
  /** @type {IntersectionObserver | null} */
  let previewObserver = null;
  let activeIndex = -1;

  function closeList() {
    if (previewObserver) {
      previewObserver.disconnect();
      previewObserver = null;
    }
    listEl.hidden = true;
    listEl.innerHTML = '';
    triggerBtn.setAttribute('aria-expanded', 'false');
    root?.classList.remove('is-open');
    activeIndex = -1;
  }

  function openList() {
    if (previewObserver) {
      previewObserver.disconnect();
      previewObserver = null;
    }

    listEl.innerHTML = '';
    const selected = hiddenInput.value || 'Roboto';

    previewObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const li = entry.target;
          const family = li.dataset.font;
          if (!family) return;
          previewObserver?.unobserve(li);
          ensureFontLoaded(family).then(() => {
            if (li.isConnected) li.style.fontFamily = cssFontFamily(family);
          });
        });
      },
      { root: listEl, rootMargin: '80px 0px', threshold: 0.01 }
    );

    googleFonts.forEach((family, index) => {
      const li = document.createElement('li');
      li.textContent = family;
      li.dataset.font = family;
      li.setAttribute('role', 'option');
      if (loadedFontFamilies.has(family)) {
        li.style.fontFamily = cssFontFamily(family);
      }
      if (family === selected) {
        li.classList.add('is-active');
        activeIndex = index;
      }
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        selectFont(family);
      });
      listEl.appendChild(li);
      previewObserver.observe(li);
    });

    listEl.hidden = false;
    triggerBtn.setAttribute('aria-expanded', 'true');
    root?.classList.add('is-open');

    requestAnimationFrame(() => {
      const active = listEl.querySelector('li.is-active');
      active?.scrollIntoView({ block: 'nearest' });
    });
  }

  function selectFont(family) {
    setFontPickerValue(hiddenInput, triggerBtn, family);
    closeList();
    ensureFontLoaded(family).then(() => onSelect?.(family));
  }

  function highlight(delta) {
    const items = [...listEl.querySelectorAll('li[data-font]')];
    if (!items.length) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    items.forEach((li, i) => {
      li.classList.toggle('is-active', i === activeIndex);
      if (i === activeIndex) li.scrollIntoView({ block: 'nearest' });
    });
  }

  triggerBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (listEl.hidden) openList();
    else closeList();
  });

  triggerBtn.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (listEl.hidden) openList();
      else if (event.key === 'ArrowDown') highlight(1);
      else if (event.key === 'Enter' || event.key === ' ') {
        const items = [...listEl.querySelectorAll('li[data-font]')];
        const family = items[activeIndex]?.dataset.font;
        if (family) selectFont(family);
      }
    } else if (event.key === 'ArrowUp' && !listEl.hidden) {
      event.preventDefault();
      highlight(-1);
    } else if (event.key === 'Escape') {
      closeList();
    }
  });

  document.addEventListener('click', (event) => {
    if (!root?.contains(event.target)) closeList();
  });

  setFontPickerValue(hiddenInput, triggerBtn, hiddenInput.value || 'Roboto');
  ensureFontLoaded(hiddenInput.value || 'Roboto');
}

async function loadGoogleFontsCatalog() {
  try {
    const response = await fetch(GOOGLE_FONTS_JSON);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.fonts;
    if (Array.isArray(list) && list.length) {
      googleFonts = list
        .map((item) => (typeof item === 'string' ? item : item.family || item.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    }
  } catch (error) {
    console.warn('Google Fonts lista betöltése sikertelen, tartalék lista használata.', error);
  }
}
const layerRotation = document.getElementById('layerRotation');
const layerRotationValue = document.getElementById('layerRotationValue');
const keepAspect = document.getElementById('keepAspect');
const flipHorizontalBtn = document.getElementById('flipHorizontalBtn');
const flipVerticalBtn = document.getElementById('flipVerticalBtn');
const deleteLayerBtn = document.getElementById('deleteLayerBtn');
const saveDesignBtn = document.getElementById('saveDesignBtn');
const designCodeBox = document.getElementById('designCodeBox');
const designCodeValue = document.getElementById('designCodeValue');
const designCodeHint = document.getElementById('designCodeHint');
const copyDesignCodeBtn = document.getElementById('copyDesignCodeBtn');
const designSaveError = document.getElementById('designSaveError');
const saveModal = document.getElementById('saveModal');
const saveModalCard = document.getElementById('saveModalCard');
const saveModalTitle = document.getElementById('saveModalTitle');
const saveModalMessage = document.getElementById('saveModalMessage');
const saveModalCode = document.getElementById('saveModalCode');
const saveModalClose = document.getElementById('saveModalClose');
const saveModalCopy = document.getElementById('saveModalCopy');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const resetRotation = document.getElementById('resetRotation');
const autoRotate = document.getElementById('autoRotate');
const autoRotateSpeed = document.getElementById('autoRotateSpeed');
const autoRotateSpeedValue = document.getElementById('autoRotateSpeedValue');

function syncControlPair(rangeEl, numberEl, value) {
  const numeric = Number(value);
  rangeEl.value = numeric;
  numberEl.value = numeric;
}

function clampControlValue(el, rawValue) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(el.value) || 0;
  const min = el.min === '' ? null : Number(el.min);
  const max = el.max === '' ? null : Number(el.max);
  if (min !== null && Number.isFinite(min)) value = Math.max(min, value);
  if (max !== null && Number.isFinite(max)) value = Math.min(max, value);
  const step = el.step === '' || el.step === 'any' ? null : Number(el.step);
  if (step && Number.isFinite(step) && step > 0) {
    const base = min !== null && Number.isFinite(min) ? min : 0;
    value = Math.round((value - base) / step) * step + base;
    value = Math.round(value * 1000) / 1000;
  }
  return value;
}

function syncControlBounds(rangeEl, numberEl) {
  numberEl.min = rangeEl.min;
  numberEl.max = rangeEl.max;
  if (rangeEl.step) numberEl.step = rangeEl.step;
}

const ROTATION_HANDLE_OFFSET = 28;
const MAX_HISTORY = 50;

let layers = [];
let selectedLayerId = null;
let nextLayerId = 1;

let history = [];
let historyIndex = -1;
let isRestoringHistory = false;
let activeDragModeForHistory = null;

let dragMode = null;
let dragStart = null;
let dragLayerSnapshot = null;
let activeHandle = null;
/** @type {null | { layerId: string, startDistance: number, startWidth: number, startHeight: number, startFontSize: number }} */
let pinchState = null;

function cloneLayers(source) {
  return source.map((layer) => {
    if (layer.type === 'image') {
      return { ...layer, image: layer.image };
    }
    return { ...layer };
  });
}

function getHistorySignature() {
  return JSON.stringify({
    selectedLayerId,
    layers: layers.map((layer) => {
      if (layer.type === 'image') {
        const { image, ...rest } = layer;
        return { ...rest, hasImage: Boolean(image) };
      }
      return layer;
    }),
  });
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
}

function commitHistory() {
  if (isRestoringHistory) return;

  const signature = getHistorySignature();
  if (history[historyIndex]?.signature === signature) {
    updateHistoryButtons();
    return;
  }

  history = history.slice(0, historyIndex + 1);
  history.push({
    layers: cloneLayers(layers),
    selectedLayerId,
    signature,
  });

  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function restoreHistory(entry) {
  isRestoringHistory = true;
  layers = cloneLayers(entry.layers);
  selectedLayerId = entry.selectedLayerId;

  if (selectedLayerId && !layers.some((layer) => layer.id === selectedLayerId)) {
    selectedLayerId = layers.length ? layers[layers.length - 1].id : null;
  }

  updateLayerList();
  updateLayerProps();
  renderCanvas();
  updateHistoryButtons();
  isRestoringHistory = false;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  restoreHistory(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  restoreHistory(history[historyIndex]);
}

function createId() {
  return `layer-${nextLayerId++}`;
}

function getSelectedLayer() {
  return layers.find((layer) => layer.id === selectedLayerId) ?? null;
}

function getTextStrokeWidth(layer) {
  return Math.max(0, Number(layer.strokeWidth) || 0);
}

function measureTextLayer(layer) {
  ctx.font = `bold ${layer.fontSize}px ${cssFontFamily(layer.font)}`;
  const metrics = ctx.measureText(layer.text);
  const strokePad = getTextStrokeWidth(layer);
  return {
    width: metrics.width + strokePad,
    height: layer.fontSize * 1.2 + strokePad,
  };
}

function getLayerSize(layer) {
  if (layer.type === 'image') {
    return { width: layer.width, height: layer.height };
  }
  return measureTextLayer(layer);
}

function getLayerRotationRad(layer) {
  return ((layer.rotation || 0) * Math.PI) / 180;
}

function worldToLocal(point, layer) {
  const dx = point.x - layer.x;
  const dy = point.y - layer.y;
  const rad = -getLayerRotationRad(layer);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function localToWorld(local, layer) {
  const rad = getLayerRotationRad(layer);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: layer.x + local.x * cos - local.y * sin,
    y: layer.y + local.x * sin + local.y * cos,
  };
}

function getHandlePositionsLocal(layer) {
  const { width, height } = getLayerSize(layer);
  const hw = width / 2;
  const hh = height / 2;
  return {
    nw: { x: -hw, y: -hh },
    ne: { x: hw, y: -hh },
    sw: { x: -hw, y: hh },
    se: { x: hw, y: hh },
  };
}

function getRotationHandleWorld(layer) {
  const { height } = getLayerSize(layer);
  return localToWorld({ x: 0, y: -height / 2 - ROTATION_HANDLE_OFFSET }, layer);
}

function hitTestHandle(point, layer) {
  const local = worldToLocal(point, layer);
  const handles = getHandlePositionsLocal(layer);
  for (const [name, handle] of Object.entries(handles)) {
    if (
      local.x >= handle.x - HANDLE_SIZE &&
      local.x <= handle.x + HANDLE_SIZE &&
      local.y >= handle.y - HANDLE_SIZE &&
      local.y <= handle.y + HANDLE_SIZE
    ) {
      return name;
    }
  }
  return null;
}

function hitTestRotationHandle(point, layer) {
  const handle = getRotationHandleWorld(layer);
  const dx = point.x - handle.x;
  const dy = point.y - handle.y;
  return dx * dx + dy * dy <= (HANDLE_SIZE + 4) ** 2;
}

function hitTestLayer(point) {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    const local = worldToLocal(point, layer);
    const { width, height } = getLayerSize(layer);
    if (
      local.x >= -width / 2 &&
      local.x <= width / 2 &&
      local.y >= -height / 2 &&
      local.y <= height / 2
    ) {
      return layer;
    }
  }
  return null;
}

function drawLayerContent(layer, targetCtx = ctx) {
  targetCtx.save();
  targetCtx.translate(layer.x, layer.y);
  targetCtx.rotate(getLayerRotationRad(layer));

  if (layer.type === 'image') {
    const scaleX = layer.flipX ? -1 : 1;
    const scaleY = layer.flipY ? -1 : 1;
    targetCtx.scale(scaleX, scaleY);
    targetCtx.drawImage(
      layer.image,
      -layer.width / 2,
      -layer.height / 2,
      layer.width,
      layer.height
    );
  } else {
    targetCtx.font = `bold ${layer.fontSize}px ${cssFontFamily(layer.font)}`;
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    const strokeWidth = getTextStrokeWidth(layer);
    if (strokeWidth > 0) {
      targetCtx.lineWidth = strokeWidth;
      targetCtx.strokeStyle = layer.strokeColor || '#ffffff';
      targetCtx.lineJoin = 'round';
      targetCtx.miterLimit = 2;
      targetCtx.strokeText(layer.text, 0, 0);
    }
    targetCtx.fillStyle = layer.color;
    targetCtx.fillText(layer.text, 0, 0);
  }

  targetCtx.restore();
}

function drawSelection(layer) {
  const { width, height } = getLayerSize(layer);
  const hw = width / 2;
  const hh = height / 2;

  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(getLayerRotationRad(layer));

  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(-hw, -hh, width, height);
  ctx.setLineDash([]);

  // Forgató vonal + fogantyú
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, -hh - ROTATION_HANDLE_OFFSET);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, -hh - ROTATION_HANDLE_OFFSET, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();

  const handles = getHandlePositionsLocal(layer);
  ctx.fillStyle = '#ffffff';
  Object.values(handles).forEach((handle) => {
    ctx.beginPath();
    ctx.rect(
      handle.x - HANDLE_SIZE / 2,
      handle.y - HANDLE_SIZE / 2,
      HANDLE_SIZE,
      HANDLE_SIZE
    );
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

function renderCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layers.forEach((layer) => drawLayerContent(layer));

  // 3D textúra: felül/alul 1 cm fehér sáv, a minta csak a középső sávban
  composeMugTexture();
  scheduleTextureUpdate();

  const selected = getSelectedLayer();
  if (selected) drawSelection(selected);

  updateToolsLivePreview();
}

function updateToolsLivePreview() {
  const previewRoot = document.getElementById('toolsLivePreview');
  const previewCanvas = document.getElementById('toolsPreviewCanvas');
  if (!previewCanvas || previewRoot?.classList.contains('is-collapsed')) return;

  const previewCtx = previewCanvas.getContext('2d');
  const targetW = 420;
  const targetH = Math.round(targetW * (canvas.height / canvas.width));
  if (previewCanvas.width !== targetW || previewCanvas.height !== targetH) {
    previewCanvas.width = targetW;
    previewCanvas.height = targetH;
  }

  previewCtx.fillStyle = '#ffffff';
  previewCtx.fillRect(0, 0, targetW, targetH);
  previewCtx.drawImage(canvas, 0, 0, targetW, targetH);
}

/** A teljes vászon a design sávba kerül; a peremek fehérek. */
function composeMugTexture() {
  const { bottomCm, designHeightCm } = getMugDesignLayout();
  const tw = textureCanvas.width;
  const th = textureCanvas.height;
  const pad = TEXTURE_PAD_PX;
  const topMarginPx = th * ((MUG_3DL_HEIGHT_CM - bottomCm - designHeightCm) / MUG_3DL_HEIGHT_CM);
  const designPx = Math.max(1, th * (designHeightCm / MUG_3DL_HEIGHT_CM));

  textureCtx.fillStyle = '#ffffff';
  textureCtx.fillRect(0, 0, tw, th);
  textureCtx.drawImage(
    canvas,
    0,
    0,
    canvas.width,
    canvas.height,
    pad,
    topMarginPx,
    tw - 2 * pad,
    designPx
  );
}

function moveLayer(layerId, direction) {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return;

  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= layers.length) return;

  [layers[index], layers[newIndex]] = [layers[newIndex], layers[index]];
  updateLayerList();
  renderCanvas();
  commitHistory();
}

/** placeAboveInUI: true = a célréteg fölé kerül a listában (előrébb a vásznon). */
function reorderLayerByDrop(draggedId, targetId, placeAboveInUI) {
  if (draggedId === targetId) return;

  const fromIndex = layers.findIndex((layer) => layer.id === draggedId);
  if (fromIndex < 0) return;

  const [item] = layers.splice(fromIndex, 1);
  let toIndex = layers.findIndex((layer) => layer.id === targetId);
  if (toIndex < 0) {
    layers.splice(fromIndex, 0, item);
    return;
  }

  if (placeAboveInUI) {
    layers.splice(toIndex + 1, 0, item);
  } else {
    layers.splice(toIndex, 0, item);
  }

  selectedLayerId = draggedId;
  updateLayerList();
  updateLayerProps();
  renderCanvas();
  commitHistory();
}

function clearLayerDropIndicators() {
  layerList.querySelectorAll('.layer-item').forEach((item) => {
    item.classList.remove('drag-over-above', 'drag-over-below', 'dragging');
  });
}

function updateLayerList() {
  layerList.innerHTML = '';

  if (layers.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'layer-empty';
    emptyItem.textContent = 'Még nincs réteg';
    layerList.appendChild(emptyItem);
    layerProps.classList.add('hidden');
    return;
  }

  // A lista teteje = legfelső réteg (utolsó a tömbben)
  [...layers].reverse().forEach((layer, reversedIndex) => {
    const index = layers.length - 1 - reversedIndex;
    const item = document.createElement('li');
    item.className = 'layer-item';
    item.draggable = true;
    item.dataset.layerId = layer.id;
    if (layer.id === selectedLayerId) item.classList.add('selected');

    const grip = document.createElement('span');
    grip.className = 'layer-grip';
    grip.title = 'Húzd az átrendezéshez';
    grip.textContent = '⠿';

    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.textContent = layer.type === 'image' ? '🖼️' : '🔤';

    const label = document.createElement('span');
    label.className = 'layer-label';
    label.textContent = layer.name;

    const orderBtns = document.createElement('div');
    orderBtns.className = 'layer-order-btns';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'layer-order-btn';
    upBtn.title = 'Réteg feljebb';
    upBtn.textContent = '▲';
    upBtn.disabled = index >= layers.length - 1;
    upBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      moveLayer(layer.id, 1);
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'layer-order-btn';
    downBtn.title = 'Réteg lejjebb';
    downBtn.textContent = '▼';
    downBtn.disabled = index <= 0;
    downBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      moveLayer(layer.id, -1);
    });

    orderBtns.appendChild(upBtn);
    orderBtns.appendChild(downBtn);

    item.appendChild(grip);
    item.appendChild(icon);
    item.appendChild(label);
    item.appendChild(orderBtns);

    item.addEventListener('click', () => {
      selectedLayerId = layer.id;
      updateLayerList();
      updateLayerProps();
      renderCanvas();
    });

    item.addEventListener('dragstart', (event) => {
      dragLayerId = layer.id;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', layer.id);
      selectedLayerId = layer.id;
    });

    item.addEventListener('dragend', () => {
      dragLayerId = null;
      clearLayerDropIndicators();
    });

    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!dragLayerId || dragLayerId === layer.id) return;

      const rect = item.getBoundingClientRect();
      const placeAbove = event.clientY < rect.top + rect.height / 2;
      item.classList.toggle('drag-over-above', placeAbove);
      item.classList.toggle('drag-over-below', !placeAbove);

      layerList.querySelectorAll('.layer-item').forEach((other) => {
        if (other !== item) {
          other.classList.remove('drag-over-above', 'drag-over-below');
        }
      });
    });

    item.addEventListener('dragleave', (event) => {
      if (!item.contains(event.relatedTarget)) {
        item.classList.remove('drag-over-above', 'drag-over-below');
      }
    });

    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedId = dragLayerId || event.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === layer.id) {
        clearLayerDropIndicators();
        return;
      }

      const rect = item.getBoundingClientRect();
      const placeAbove = event.clientY < rect.top + rect.height / 2;
      reorderLayerByDrop(draggedId, layer.id, placeAbove);
      dragLayerId = null;
    });

    layerList.appendChild(item);
  });
}

/** Szélesség/magasság csúszka: bal és felső él rögzítve (jobbra / lefelé nő). */
function applySizeDeltaKeepingAnchor(layer, oldWidth, oldHeight, newWidth, newHeight) {
  const dw = newWidth - oldWidth;
  const dh = newHeight - oldHeight;
  const rad = getLayerRotationRad(layer);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Lokális +X (jobbra) és +Y (lefelé) irány a világkoordinátákban
  layer.x += (dw / 2) * cos + (dh / 2) * -sin;
  layer.y += (dw / 2) * sin + (dh / 2) * cos;
}

function updateLayerProps() {
  const selected = getSelectedLayer();
  if (!selected) {
    layerProps.classList.add('hidden');
    return;
  }

  layerProps.classList.remove('hidden');
  selectedLayerName.textContent = selected.name;

  syncControlPair(layerRotation, layerRotationValue, Math.round(selected.rotation || 0));

  if (selected.type === 'image') {
    imageSizeControls.classList.remove('hidden');
    textSizeControls.classList.add('hidden');

    layerWidth.min = 20;
    layerWidth.max = canvas.width;
    layerHeight.min = 20;
    layerHeight.max = canvas.height;
    syncControlBounds(layerWidth, layerWidthValue);
    syncControlBounds(layerHeight, layerHeightValue);
    syncControlPair(layerWidth, layerWidthValue, Math.round(selected.width));
    syncControlPair(layerHeight, layerHeightValue, Math.round(selected.height));
  } else {
    imageSizeControls.classList.add('hidden');
    textSizeControls.classList.remove('hidden');
    layerTextContent.value = selected.text || '';
    syncControlPair(layerFontSize, layerFontSizeValue, selected.fontSize);
    setFontPickerValue(layerFont, layerFontTrigger, selected.font || 'Roboto');
    ensureFontLoaded(selected.font || 'Roboto');
    layerTextColor.value = selected.color;
    layerStrokeColor.value = selected.strokeColor || '#ffffff';
    syncControlPair(layerStrokeWidth, layerStrokeWidthValue, getTextStrokeWidth(selected));
  }
}

function addImageLayer(image, fileName) {
  const scale = Math.min(
    (canvas.width * 0.5) / image.width,
    (canvas.height * 0.5) / image.height,
    1
  );
  const width = image.width * scale;
  const height = image.height * scale;

  const layer = {
    id: createId(),
    type: 'image',
    name: fileName.replace(/\.[^.]+$/, '') || 'Kép',
    x: canvas.width / 2,
    y: canvas.height / 2,
    width,
    height,
    image,
    aspectRatio: width / height,
    rotation: 0,
    flipX: false,
    flipY: false,
  };

  layers.push(layer);
  selectedLayerId = layer.id;
  updateLayerList();
  updateLayerProps();
  renderCanvas();
  commitHistory();
}

async function addTextLayer(text) {
  const fontSize = Number(textSize.value);
  const font = textFont.value || 'Roboto';
  await ensureFontLoaded(font);

  const layer = {
    id: createId(),
    type: 'text',
    name: textLayerDisplayName(text),
    x: canvas.width / 2,
    y: canvas.height / 2,
    text,
    font,
    color: textColor.value,
    strokeColor: textStrokeColor.value,
    strokeWidth: Math.max(0, Number(textStrokeWidth.value) || 0),
    fontSize,
    rotation: 0,
  };

  layers.push(layer);
  selectedLayerId = layer.id;
  updateLayerList();
  updateLayerProps();
  renderCanvas();
  commitHistory();
}

function deleteSelectedLayer() {
  if (!selectedLayerId) return;
  layers = layers.filter((layer) => layer.id !== selectedLayerId);
  selectedLayerId = layers.length ? layers[layers.length - 1].id : null;
  updateLayerList();
  updateLayerProps();
  renderCanvas();
  commitHistory();
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function beginPinch(touches, selected) {
  const size = getLayerSize(selected);
  pinchState = {
    layerId: selected.id,
    startDistance: Math.max(1, getTouchDistance(touches)),
    startWidth: size.width,
    startHeight: size.height,
    startFontSize: selected.fontSize || 32,
  };
  dragMode = null;
  dragStart = null;
  dragLayerSnapshot = null;
  activeHandle = null;
  activeDragModeForHistory = 'resize';
}

function applyPinchScale(scale) {
  const selected = getSelectedLayer();
  if (!selected || !pinchState || selected.id !== pinchState.layerId) return;

  if (selected.type === 'image') {
    const newWidth = Math.max(20, Math.min(canvas.width * 2, pinchState.startWidth * scale));
    const newHeight = Math.max(20, Math.min(canvas.height * 2, pinchState.startHeight * scale));
    selected.width = newWidth;
    selected.height = newHeight;
    selected.aspectRatio = newWidth / newHeight;
    syncControlPair(layerWidth, layerWidthValue, Math.round(selected.width));
    syncControlPair(layerHeight, layerHeightValue, Math.round(selected.height));
  } else {
    selected.fontSize = Math.max(12, Math.min(300, Math.round(pinchState.startFontSize * scale)));
    syncControlPair(layerFontSize, layerFontSizeValue, selected.fontSize);
  }

  renderCanvas();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const touch = event.touches?.[0] || event.changedTouches?.[0];
  const clientX = touch ? touch.clientX : event.clientX;
  const clientY = touch ? touch.clientY : event.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function startInteraction(event) {
  event.preventDefault();

  if (event.touches && event.touches.length >= 2) {
    const selected = getSelectedLayer();
    if (!selected) return;
    beginPinch(event.touches, selected);
    return;
  }

  const point = getCanvasPoint(event);
  const selected = getSelectedLayer();
  activeDragModeForHistory = null;
  pinchState = null;

  if (selected) {
    if (hitTestRotationHandle(point, selected)) {
      dragMode = 'rotate';
      activeDragModeForHistory = 'rotate';
      dragStart = point;
      dragLayerSnapshot = { rotation: selected.rotation || 0 };
      return;
    }

    activeHandle = hitTestHandle(point, selected);
    if (activeHandle) {
      const size = getLayerSize(selected);
      const fixedHandle = { se: 'nw', sw: 'ne', ne: 'sw', nw: 'se' }[activeHandle];
      const hw = size.width / 2;
      const hh = size.height / 2;
      const fixedLocal = {
        nw: { x: -hw, y: -hh },
        ne: { x: hw, y: -hh },
        sw: { x: -hw, y: hh },
        se: { x: hw, y: hh },
      }[fixedHandle];

      dragMode = 'resize';
      activeDragModeForHistory = 'resize';
      dragStart = point;
      dragLayerSnapshot = {
        width: selected.width,
        height: selected.height,
        fontSize: selected.fontSize,
        size,
        aspectRatio: selected.aspectRatio,
        fixedWorld: localToWorld(fixedLocal, selected),
      };
      return;
    }
  }

  const clickedLayer = hitTestLayer(point);
  if (clickedLayer) {
    selectedLayerId = clickedLayer.id;
    dragMode = 'move';
    activeDragModeForHistory = 'move';
    dragStart = point;
    dragLayerSnapshot = { x: clickedLayer.x, y: clickedLayer.y };
    updateLayerList();
    updateLayerProps();
    renderCanvas();
    return;
  }

  selectedLayerId = null;
  dragMode = null;
  updateLayerList();
  updateLayerProps();
  renderCanvas();
}

function moveInteraction(event) {
  if (event.touches && event.touches.length >= 2) {
    event.preventDefault();
    const selected = getSelectedLayer();
    if (!selected) return;
    if (!pinchState || pinchState.layerId !== selected.id) {
      beginPinch(event.touches, selected);
    }
    const scale = getTouchDistance(event.touches) / pinchState.startDistance;
    applyPinchScale(scale);
    return;
  }

  if (pinchState) return;
  if (!dragMode || !dragStart || !dragLayerSnapshot) return;
  event.preventDefault();

  const point = getCanvasPoint(event);
  const selected = getSelectedLayer();
  if (!selected) return;

  if (dragMode === 'move') {
    selected.x = dragLayerSnapshot.x + (point.x - dragStart.x);
    selected.y = dragLayerSnapshot.y + (point.y - dragStart.y);
    renderCanvas();
    return;
  }

  if (dragMode === 'rotate') {
    const angle = (Math.atan2(point.y - selected.y, point.x - selected.x) * 180) / Math.PI;
    // A forgató fogantyú felül van (-90°), ezért +90 korrekció
    let rotation = angle + 90;
    if (rotation > 180) rotation -= 360;
    if (rotation < -180) rotation += 360;

    if (event.shiftKey || shiftPressed) {
      rotation = Math.round(rotation / 5) * 5;
    } else {
      rotation = Math.round(rotation);
    }

    selected.rotation = rotation;
    syncControlPair(layerRotation, layerRotationValue, selected.rotation);
    renderCanvas();
    return;
  }

  if (dragMode === 'resize') {
    const { fixedWorld, aspectRatio, fontSize, size } = dragLayerSnapshot;
    const rad = getLayerRotationRad(selected);
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    const dx = point.x - fixedWorld.x;
    const dy = point.y - fixedWorld.y;
    // Egér pozíció a rögzített sarokhoz képest, réteg-lokálisban
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    let newWidth;
    let newHeight;
    if (activeHandle === 'se') {
      newWidth = localX;
      newHeight = localY;
    } else if (activeHandle === 'sw') {
      newWidth = -localX;
      newHeight = localY;
    } else if (activeHandle === 'ne') {
      newWidth = localX;
      newHeight = -localY;
    } else {
      newWidth = -localX;
      newHeight = -localY;
    }

    newWidth = Math.max(20, newWidth);
    newHeight = Math.max(20, newHeight);

    if (selected.type === 'image') {
      if (keepAspect.checked) {
        const ar = aspectRatio || selected.aspectRatio || newWidth / newHeight;
        const byWidth = { width: newWidth, height: newWidth / ar };
        const byHeight = { width: newHeight * ar, height: newHeight };
        // A kurzorhoz közelebbi méretet választjuk
        const errW = Math.abs(byWidth.width - newWidth) + Math.abs(byWidth.height - newHeight);
        const errH = Math.abs(byHeight.width - newWidth) + Math.abs(byHeight.height - newHeight);
        if (errW <= errH) {
          newWidth = byWidth.width;
          newHeight = byWidth.height;
        } else {
          newWidth = byHeight.width;
          newHeight = byHeight.height;
        }
      }

      selected.width = newWidth;
      selected.height = newHeight;
      selected.aspectRatio = selected.width / selected.height;

      syncControlPair(layerWidth, layerWidthValue, Math.round(selected.width));
      syncControlPair(layerHeight, layerHeightValue, Math.round(selected.height));
    } else {
      const scale = Math.max(newWidth / size.width, newHeight / size.height);
      selected.fontSize = Math.max(12, Math.min(300, Math.round(fontSize * scale)));
      const measured = measureTextLayer(selected);
      newWidth = measured.width;
      newHeight = measured.height;
      syncControlPair(layerFontSize, layerFontSizeValue, selected.fontSize);
    }

    // Új középpont: a rögzített saroktól a méret felével
    const fromFixed = {
      se: { x: newWidth / 2, y: newHeight / 2 },
      sw: { x: -newWidth / 2, y: newHeight / 2 },
      ne: { x: newWidth / 2, y: -newHeight / 2 },
      nw: { x: -newWidth / 2, y: -newHeight / 2 },
    }[activeHandle];

    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    selected.x = fixedWorld.x + fromFixed.x * cosR - fromFixed.y * sinR;
    selected.y = fixedWorld.y + fromFixed.x * sinR + fromFixed.y * cosR;

    renderCanvas();
  }
}

function endInteraction(event) {
  if (pinchState) {
    const stillPinching = event?.touches && event.touches.length >= 2;
    if (!stillPinching) {
      commitHistory();
      pinchState = null;
      dragMode = null;
      dragStart = null;
      dragLayerSnapshot = null;
      activeHandle = null;
      activeDragModeForHistory = null;
    }
    return;
  }

  if (activeDragModeForHistory === 'move') {
    const selected = getSelectedLayer();
    if (
      selected &&
      dragLayerSnapshot &&
      (selected.x !== dragLayerSnapshot.x || selected.y !== dragLayerSnapshot.y)
    ) {
      commitHistory();
    }
  } else if (
    activeDragModeForHistory === 'resize' ||
    activeDragModeForHistory === 'rotate'
  ) {
    commitHistory();
  }

  dragMode = null;
  dragStart = null;
  dragLayerSnapshot = null;
  activeHandle = null;
  activeDragModeForHistory = null;
}

canvas.addEventListener('mousedown', startInteraction);
canvas.addEventListener('mousemove', moveInteraction);
canvas.addEventListener('mouseup', endInteraction);
canvas.addEventListener('mouseleave', endInteraction);
canvas.addEventListener('touchstart', startInteraction, { passive: false });
canvas.addEventListener('touchmove', moveInteraction, { passive: false });
canvas.addEventListener('touchend', endInteraction);
canvas.addEventListener('touchcancel', endInteraction);

imageUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const img = new Image();
    img.onload = () => addImageLayer(img, file.name);
    img.src = loadEvent.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
});

addTextBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) return;
  addTextBtn.disabled = true;
  try {
    await addTextLayer(text);
    textInput.value = '';
  } finally {
    addTextBtn.disabled = false;
  }
});

function applyLayerWidth(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'image') return;

  const oldWidth = selected.width;
  const oldHeight = selected.height;
  const newWidth = clampControlValue(layerWidth, rawValue);
  let newHeight = oldHeight;

  if (keepAspect.checked) {
    newHeight = newWidth / selected.aspectRatio;
    syncControlPair(layerHeight, layerHeightValue, Math.round(newHeight));
  }

  applySizeDeltaKeepingAnchor(selected, oldWidth, oldHeight, newWidth, newHeight);
  selected.width = newWidth;
  selected.height = newHeight;
  selected.aspectRatio = selected.width / selected.height;
  syncControlPair(layerWidth, layerWidthValue, Math.round(selected.width));
  renderCanvas();
  if (commit) commitHistory();
}

function applyLayerHeight(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'image') return;

  const oldWidth = selected.width;
  const oldHeight = selected.height;
  let newWidth = oldWidth;
  const newHeight = clampControlValue(layerHeight, rawValue);

  if (keepAspect.checked) {
    newWidth = newHeight * selected.aspectRatio;
    syncControlPair(layerWidth, layerWidthValue, Math.round(newWidth));
  }

  applySizeDeltaKeepingAnchor(selected, oldWidth, oldHeight, newWidth, newHeight);
  selected.width = newWidth;
  selected.height = newHeight;
  selected.aspectRatio = selected.width / selected.height;
  syncControlPair(layerHeight, layerHeightValue, Math.round(selected.height));
  renderCanvas();
  if (commit) commitHistory();
}

function applyLayerFontSize(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;

  selected.fontSize = clampControlValue(layerFontSize, rawValue);
  syncControlPair(layerFontSize, layerFontSizeValue, selected.fontSize);
  renderCanvas();
  if (commit) commitHistory();
}

function textLayerDisplayName(text) {
  const value = text.trim();
  if (!value) return 'Szöveg';
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function applyLayerTextContent(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;

  const next = String(rawValue ?? '');
  selected.text = next;
  selected.name = textLayerDisplayName(next);
  selectedLayerName.textContent = selected.name;
  updateLayerList();
  renderCanvas();
  if (commit) commitHistory();
}

layerTextContent.addEventListener('input', () => {
  applyLayerTextContent(layerTextContent.value);
});
layerTextContent.addEventListener('change', () => {
  applyLayerTextContent(layerTextContent.value, true);
});

function applyLayerStrokeWidth(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;

  selected.strokeWidth = clampControlValue(layerStrokeWidth, rawValue);
  syncControlPair(layerStrokeWidth, layerStrokeWidthValue, selected.strokeWidth);
  renderCanvas();
  if (commit) commitHistory();
}

function applyLayerRotation(rawValue, commit = false) {
  const selected = getSelectedLayer();
  if (!selected) return;

  let rotation = clampControlValue(layerRotation, rawValue);
  if (shiftPressed) {
    rotation = Math.round(rotation / 5) * 5;
  }

  selected.rotation = rotation;
  syncControlPair(layerRotation, layerRotationValue, selected.rotation);
  renderCanvas();
  if (commit) commitHistory();
}

layerWidth.addEventListener('input', () => applyLayerWidth(layerWidth.value));
layerWidth.addEventListener('change', () => applyLayerWidth(layerWidth.value, true));
layerWidthValue.addEventListener('change', () => applyLayerWidth(layerWidthValue.value, true));

layerHeight.addEventListener('input', () => applyLayerHeight(layerHeight.value));
layerHeight.addEventListener('change', () => applyLayerHeight(layerHeight.value, true));
layerHeightValue.addEventListener('change', () => applyLayerHeight(layerHeightValue.value, true));

layerFontSize.addEventListener('input', () => applyLayerFontSize(layerFontSize.value));
layerFontSize.addEventListener('change', () => applyLayerFontSize(layerFontSize.value, true));
layerFontSizeValue.addEventListener('change', () => applyLayerFontSize(layerFontSizeValue.value, true));

async function applySelectedLayerFont(family) {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;
  selected.font = family;
  await ensureFontLoaded(family);
  renderCanvas();
  commitHistory();
}

layerTextColor.addEventListener('input', () => {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;

  selected.color = layerTextColor.value;
  renderCanvas();
});
layerTextColor.addEventListener('change', commitHistory);

layerStrokeColor.addEventListener('input', () => {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'text') return;

  selected.strokeColor = layerStrokeColor.value;
  renderCanvas();
});
layerStrokeColor.addEventListener('change', commitHistory);

layerStrokeWidth.addEventListener('input', () => applyLayerStrokeWidth(layerStrokeWidth.value));
layerStrokeWidth.addEventListener('change', () => applyLayerStrokeWidth(layerStrokeWidth.value, true));
layerStrokeWidthValue.addEventListener('change', () => applyLayerStrokeWidth(layerStrokeWidthValue.value, true));

layerRotation.addEventListener('input', () => applyLayerRotation(layerRotation.value));
layerRotation.addEventListener('change', () => applyLayerRotation(layerRotation.value, true));
layerRotationValue.addEventListener('change', () => applyLayerRotation(layerRotationValue.value, true));

flipHorizontalBtn.addEventListener('click', () => {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'image') return;
  selected.flipX = !selected.flipX;
  renderCanvas();
  commitHistory();
});

flipVerticalBtn.addEventListener('click', () => {
  const selected = getSelectedLayer();
  if (!selected || selected.type !== 'image') return;
  selected.flipY = !selected.flipY;
  renderCanvas();
  commitHistory();
});

deleteLayerBtn.addEventListener('click', deleteSelectedLayer);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

function createExportBlob() {
  return new Promise((resolve, reject) => {
    if (!layers.length) {
      reject(new Error('Nincs mit menteni — adj hozzá legalább egy réteget.'));
      return;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    layers.forEach((layer) => drawLayerContent(layer, exportCtx));

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Nem sikerült előállítani a képet.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function closeSaveModal() {
  saveModal.classList.add('hidden');
}

function openSaveModal({ title, message, code = '', isError = false }) {
  saveModalTitle.textContent = title;
  saveModalMessage.textContent = message;
  saveModalCard.classList.toggle('is-error', isError);
  saveModalCard.classList.toggle('is-success', !isError);

  if (code) {
    saveModalCode.textContent = code;
    saveModalCode.classList.remove('hidden');
    saveModalCopy.classList.remove('hidden');
    saveModalCopy.textContent = 'Kód másolása';
  } else {
    saveModalCode.textContent = '';
    saveModalCode.classList.add('hidden');
    saveModalCopy.classList.add('hidden');
  }

  saveModal.classList.remove('hidden');
  saveModalClose.focus();
}

async function copyDesignCode(code, button) {
  if (!code) return;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = 'Kimásolva!';
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  } catch {
    designCodeHint.textContent = 'A másolás nem sikerült — jelöld ki és másold kézzel a kódot.';
  }
}

function showDesignSaveError(message) {
  designSaveError.textContent = message;
  designSaveError.classList.remove('hidden');
  designCodeBox.classList.add('hidden');
  openSaveModal({
    title: 'Mentés sikertelen',
    message,
    isError: true,
  });
}

function showDesignCode(code) {
  designSaveError.classList.add('hidden');
  designCodeValue.textContent = code;
  designCodeHint.textContent =
    'Írd fel / másold ki, és a rendelésnél add meg ezt a kódot.';
  designCodeBox.classList.remove('hidden');
  openSaveModal({
    title: 'Sikeres mentés',
    message: 'A design elmentve. Megrendeléskor add meg ezt a kódot:',
    code,
    isError: false,
  });
}

let saveTokenState = {
  token: null,
  fetchedAt: 0,
  minWaitSeconds: 4,
  inflight: null,
};

async function fetchSaveToken(force = false) {
  const ageMs = Date.now() - saveTokenState.fetchedAt;
  if (!force && saveTokenState.token && ageMs < 25 * 60 * 1000) {
    return saveTokenState.token;
  }
  if (saveTokenState.inflight) {
    return saveTokenState.inflight;
  }

  saveTokenState.inflight = (async () => {
    const response = await fetch('get-save-token.php', {
      method: 'GET',
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok || !data?.ok || !data?.token) {
      throw new Error(data?.error || 'Nem sikerült mentési tokent kérni.');
    }
    saveTokenState = {
      token: data.token,
      fetchedAt: Date.now(),
      minWaitSeconds: Number(data.minWaitSeconds) || 4,
      inflight: null,
    };
    return saveTokenState.token;
  })();

  try {
    return await saveTokenState.inflight;
  } finally {
    saveTokenState.inflight = null;
  }
}

async function waitForTokenMinAge() {
  const elapsed = (Date.now() - saveTokenState.fetchedAt) / 1000;
  const remain = saveTokenState.minWaitSeconds - elapsed;
  if (remain > 0) {
    await new Promise((resolve) => setTimeout(resolve, remain * 1000 + 50));
  }
}

async function saveDesignToServer() {
  designSaveError.classList.add('hidden');
  saveDesignBtn.disabled = true;
  const originalLabel = saveDesignBtn.innerHTML;
  saveDesignBtn.innerHTML = '<span class="btn-icon">⏳</span> Mentés folyamatban…';

  try {
    const honeypot = document.getElementById('companyUrl')?.value?.trim() || '';
    const blob = await createExportBlob();
    await fetchSaveToken();
    await waitForTokenMinAge();

    const formData = new FormData();
    formData.append('design', blob, 'design.png');
    formData.append('save_token', saveTokenState.token || '');
    formData.append('company_url', honeypot);

    const response = await fetch('save-design.php', {
      method: 'POST',
      body: formData,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new Error('A szerver nem adott érvényes választ. Futtatod a PHP-t?');
    }

    // Használt token — következő mentéshez új kell
    saveTokenState.token = null;
    saveTokenState.fetchedAt = 0;

    if (!response.ok || !data?.ok || !data?.code) {
      throw new Error(data?.error || 'A mentés sikertelen.');
    }

    showDesignCode(data.code);
    // Háttérben előkészítjük a következő tokent
    fetchSaveToken(true).catch(() => {});
  } catch (error) {
    saveTokenState.token = null;
    saveTokenState.fetchedAt = 0;
    showDesignSaveError(error.message || 'Ismeretlen hiba a mentés során.');
  } finally {
    saveDesignBtn.disabled = false;
    saveDesignBtn.innerHTML = originalLabel;
  }
}

saveDesignBtn.addEventListener('click', () => {
  saveDesignToServer();
});

// Token előtöltése, hogy mentéskor ne kelljen sokat várni a min. korra
setTimeout(() => {
  fetchSaveToken(true).catch(() => {});
}, 1200);

saveModalClose.addEventListener('click', closeSaveModal);
saveModalCopy.addEventListener('click', () => {
  copyDesignCode(saveModalCode.textContent.trim(), saveModalCopy);
});
saveModal.addEventListener('click', (event) => {
  if (event.target === saveModal) closeSaveModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !saveModal.classList.contains('hidden')) {
    closeSaveModal();
  }
});

copyDesignCodeBtn.addEventListener('click', () => {
  copyDesignCode(designCodeValue.textContent.trim(), copyDesignCodeBtn);
});

/**
 * Design-mesh UV: a Lathe u-ját a paddinghez igazítjuk, a v-t a cm-helyes sávra.
 */
function remapDesignUVs(geometry) {
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const { bottomCm, designHeightCm } = getMugDesignLayout();
  const designBottom = bottomCm * CM_TO_UNITS;
  const designTop = (bottomCm + designHeightCm) * CM_TO_UNITS;
  const pad = TEXTURE_PAD_PX;
  const tw = textureCanvas.width;
  const th = textureCanvas.height;
  const u0 = pad / tw;
  const u1 = 1 - pad / tw;
  const vDesign0 = bottomCm / MUG_3DL_HEIGHT_CM;
  const vDesign1 = (bottomCm + designHeightCm) / MUG_3DL_HEIGHT_CM;

  for (let i = 0; i < positions.count; i += 1) {
    const y = positions.getY(i);
    const baseU = uvs.getX(i);
    const u = u0 + baseU * (u1 - u0);

    let v;
    if (y <= designBottom) {
      v = Math.max(0, vDesign0 * 0.5);
    } else if (y >= designTop) {
      v = Math.min(1, vDesign1 + (1 - vDesign1) * 0.5);
    } else {
      const t = (y - designBottom) / (designTop - designBottom);
      v = vDesign0 + t * (vDesign1 - vDesign0);
    }
    uvs.setXY(i, u, v);
  }

  uvs.needsUpdate = true;
}

function buildMugOuterProfile(height, rTop, rBottom) {
  const points = [];
  const steps = 32;

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const y = t * height;
    // Szinte hengeres 330 ml-es bögre: csak enyhe alsó–felső különbség
    const ease = t * t * (3 - 2 * t);
    const r = rBottom + (rTop - rBottom) * ease;
    points.push(new THREE.Vector2(r, y));
  }

  // Vékony, lapos perem — mint egy átlagos kerámia bögrén
  points.push(new THREE.Vector2(rTop + 0.0008, height));
  points.push(new THREE.Vector2(rTop - 0.0005, height));

  return points;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1f28);
scene.fog = new THREE.Fog(0x1a1f28, 0.65, 1.6);

const camera = new THREE.PerspectiveCamera(
  36,
  previewContainer.clientWidth / previewContainer.clientHeight,
  0.01,
  100
);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(previewContainer.clientWidth, previewContainer.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
previewContainer.appendChild(renderer.domElement);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTexture;
pmremGenerator.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = 0.26;
controls.maxDistance = 0.95;
controls.target.set(0, MUG_3DL_HEIGHT_CM * CM_TO_UNITS * 0.45, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

const hemiLight = new THREE.HemisphereLight(0xfff8f0, 0x2a3038, 0.45);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfff5eb, 1.25);
keyLight.position.set(2.2, 4.5, 3.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 14;
keyLight.shadow.camera.left = -0.35;
keyLight.shadow.camera.right = 0.35;
keyLight.shadow.camera.top = 0.35;
keyLight.shadow.camera.bottom = -0.35;
keyLight.shadow.bias = -0.0002;
keyLight.shadow.normalBias = 0.015;
keyLight.shadow.radius = 4;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xe8eef8, 0.4);
fillLight.position.set(-3, 2, 1.5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
rimLight.position.set(-1, 2.5, -3.5);
scene.add(rimLight);

function createCeramicMaterial(options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: MUG_WHITE,
    roughness: 0.14,
    metalness: 0,
    clearcoat: 0.95,
    clearcoatRoughness: 0.06,
    reflectivity: 0.5,
    ior: 1.5,
    envMapIntensity: 1.05,
    ...options,
  });
}

const mugGroup = new THREE.Group();
scene.add(mugGroup);

const mugHeight = MUG_3DL_HEIGHT_CM * CM_TO_UNITS;
const mugTopRadius = MUG_TOP_RADIUS_CM * CM_TO_UNITS;
const mugBottomRadius = MUG_BOTTOM_RADIUS_CM * CM_TO_UNITS;
const wallThickness = 0.0035;

const canvasTexture = new THREE.CanvasTexture(textureCanvas);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
canvasTexture.wrapS = THREE.ClampToEdgeWrapping;
canvasTexture.wrapT = THREE.ClampToEdgeWrapping;
canvasTexture.magFilter = THREE.LinearFilter;
canvasTexture.minFilter = THREE.LinearFilter;
canvasTexture.generateMipmaps = false;
canvasTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

const outerProfile = buildMugOuterProfile(mugHeight, mugTopRadius, mugBottomRadius);
const designLayout = getMugDesignLayout();
// A fül a +X-nél van (phi = π/2). A minta a füllel szemben, cm-helyes íven.
const handlePhi = Math.PI / 2;
const designPhiStart = handlePhi + designLayout.sideGap;
const designPhiLength = designLayout.designArc;

// Teljes fehér bögretest — a fül körül nincs textúra-él
const bodyGeometry = new THREE.LatheGeometry(outerProfile, 160);
bodyGeometry.computeVertexNormals();
const bodyMaterial = createCeramicMaterial();
const mugBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
mugBody.castShadow = true;
mugBody.receiveShadow = true;
mugGroup.add(mugBody);

// Minta csak a helyes íven — így nincs fül melletti csík
const designGeometry = new THREE.LatheGeometry(
  outerProfile,
  128,
  designPhiStart,
  designPhiLength
);
remapDesignUVs(designGeometry);
designGeometry.computeVertexNormals();

const designMaterial = createCeramicMaterial({
  map: canvasTexture,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});
const mugDesign = new THREE.Mesh(designGeometry, designMaterial);
mugDesign.scale.setScalar(1.001);
mugDesign.castShadow = true;
mugDesign.receiveShadow = true;
mugGroup.add(mugDesign);

const innerProfile = [];
const innerSteps = 24;
for (let i = 0; i <= innerSteps; i += 1) {
  const t = i / innerSteps;
  const y = mugHeight - 0.001 - t * (mugHeight - 0.008);
  const ease = (1 - t) * (1 - t) * (3 - 2 * (1 - t));
  const r = mugBottomRadius + (mugTopRadius - mugBottomRadius) * ease - wallThickness;
  innerProfile.push(new THREE.Vector2(Math.max(r, 0.012), y));
}
innerProfile.push(new THREE.Vector2(0.002, 0.008));

const innerGeometry = new THREE.LatheGeometry(innerProfile, 96);
const innerMaterial = createCeramicMaterial({
  roughness: 0.28,
  clearcoat: 0.45,
  envMapIntensity: 0.65,
  side: THREE.DoubleSide,
});
const mugInner = new THREE.Mesh(innerGeometry, innerMaterial);
mugGroup.add(mugInner);

const bottomGeometry = new THREE.CircleGeometry(mugBottomRadius * 0.985, 64);
const bottomMaterial = createCeramicMaterial({ roughness: 0.35, clearcoat: 0.35 });
const mugBottom = new THREE.Mesh(bottomGeometry, bottomMaterial);
mugBottom.rotation.x = -Math.PI / 2;
mugBottom.position.y = 0.0008;
mugBottom.receiveShadow = true;
mugGroup.add(mugBottom);

// Klasszikus C-fül — átlagos 330 ml-es bögre arányokkal
const handleTopY = mugHeight * 0.72;
const handleBottomY = mugHeight * 0.28;
const handleReach = 3.0 * CM_TO_UNITS;
const handleThickness = 0.006;

const handleCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(mugTopRadius - 0.001, handleTopY, 0),
    new THREE.Vector3(mugTopRadius + handleReach * 0.28, handleTopY + 0.005, 0),
    new THREE.Vector3(mugTopRadius + handleReach, (handleTopY + handleBottomY) * 0.5 + 0.002, 0),
    new THREE.Vector3(mugTopRadius + handleReach * 0.28, handleBottomY - 0.003, 0),
    new THREE.Vector3(mugTopRadius - 0.001, handleBottomY, 0),
  ],
  false,
  'catmullrom',
  0.45
);

const handleGeometry = new THREE.TubeGeometry(handleCurve, 80, handleThickness, 24, false);
const handleMaterial = createCeramicMaterial({ roughness: 0.16, clearcoat: 0.9 });
const handle = new THREE.Mesh(handleGeometry, handleMaterial);
handle.castShadow = true;
handle.receiveShadow = true;
mugGroup.add(handle);

const attachmentMaterial = createCeramicMaterial({ roughness: 0.16 });
[
  { y: handleTopY },
  { y: handleBottomY },
].forEach(({ y }) => {
  const attachment = new THREE.Mesh(
    new THREE.SphereGeometry(0.0065, 20, 16),
    attachmentMaterial
  );
  attachment.position.set(mugTopRadius - 0.002, y, 0);
  attachment.scale.set(0.55, 1.1, 0.95);
  attachment.castShadow = true;
  mugGroup.add(attachment);
});

// Fotóhoz hasonló tájolás: fül bal oldalon
mugGroup.rotation.y = Math.PI;

const floorGeometry = new THREE.CircleGeometry(mugTopRadius * 2.6, 64);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x151920,
  roughness: 0.92,
  metalness: 0,
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;
scene.add(floor);

function updateCameraPosition() {
  // Enyhén felülről, ahogy a referenciafotón
  camera.position.set(-0.06, mugHeight * 0.64, 0.33);
  controls.target.set(0, mugHeight * 0.4, 0);
  controls.update();
}

updateCameraPosition();

function updateMugTexture() {
  canvasTexture.needsUpdate = true;
}

let textureUpdateScheduled = false;
function scheduleTextureUpdate() {
  if (textureUpdateScheduled) return;
  textureUpdateScheduled = true;
  requestAnimationFrame(() => {
    updateMugTexture();
    textureUpdateScheduled = false;
  });
}

resetRotation.addEventListener('click', () => {
  controls.reset();
  updateCameraPosition();
});

function applyAutoRotateSpeed(rawValue = autoRotateSpeed.value, commit = false) {
  const speed = clampControlValue(autoRotateSpeed, rawValue);
  syncControlPair(autoRotateSpeed, autoRotateSpeedValue, speed);
  controls.autoRotateSpeed = -speed;
}

autoRotate.addEventListener('change', () => {
  controls.autoRotate = autoRotate.checked;
  applyAutoRotateSpeed();
});

autoRotateSpeed.addEventListener('input', () => applyAutoRotateSpeed(autoRotateSpeed.value));
autoRotateSpeed.addEventListener('change', () => applyAutoRotateSpeed(autoRotateSpeed.value, true));
autoRotateSpeedValue.addEventListener('change', () => applyAutoRotateSpeed(autoRotateSpeedValue.value, true));
applyAutoRotateSpeed();

function onResize() {
  const width = previewContainer.clientWidth;
  const height = previewContainer.clientHeight;
  if (width < 2 || height < 2) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', onResize);

function setupMobileTabs() {
  const tabs = document.querySelectorAll('.mobile-tab');
  const panels = document.querySelectorAll('.panel-section');
  if (!tabs.length) return;

  const panelScroll = { tools: 0, canvas: 0, preview: 0 };
  let currentPanel =
    document.querySelector('.mobile-tab.active')?.dataset.panel || 'preview';

  function activatePanel(target, { restoreScroll = true } = {}) {
    if (!target) return;

    panelScroll[currentPanel] = window.scrollY || window.pageYOffset || 0;

    tabs.forEach((item) => item.classList.toggle('active', item.dataset.panel === target));
    panels.forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.panel === target);
    });

    currentPanel = target;

    const finish = () => {
      if (restoreScroll) {
        window.scrollTo(0, panelScroll[target] || 0);
      }
      if (target === 'preview') {
        onResize();
        renderer.render(scene, camera);
      }
      if (target === 'tools') {
        updateToolsLivePreview();
      }
    };

    // A display:none → block után kell a layoutnak leülnie a scroll helyreállításához
    requestAnimationFrame(() => requestAnimationFrame(finish));
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activatePanel(tab.dataset.panel);
    });
  });

  const previewRoot = document.getElementById('toolsLivePreview');
  const previewToggle = document.getElementById('toolsLivePreviewToggle');
  const previewCanvas = document.getElementById('toolsPreviewCanvas');
  const previewToCanvas = document.getElementById('toolsPreviewToCanvas');
  const openCanvas = () => activatePanel('canvas');
  const PREVIEW_STORAGE_KEY = 'mugToolsLivePreview';

  function setToolsLivePreviewEnabled(enabled) {
    previewToggle.checked = enabled;
    previewRoot?.classList.toggle('is-collapsed', !enabled);
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (enabled) updateToolsLivePreview();
  }

  const savedPreview = (() => {
    try {
      return localStorage.getItem(PREVIEW_STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  setToolsLivePreviewEnabled(savedPreview !== '0');

  previewToggle?.addEventListener('change', () => {
    setToolsLivePreviewEnabled(previewToggle.checked);
  });

  previewCanvas?.addEventListener('click', openCanvas);
  previewToCanvas?.addEventListener('click', openCanvas);
}

setupMobileTabs();

setupFontPicker({
  triggerBtn: textFontTrigger,
  listEl: textFontList,
  hiddenInput: textFont,
  onSelect: () => {},
});

setupFontPicker({
  triggerBtn: layerFontTrigger,
  listEl: layerFontList,
  hiddenInput: layerFont,
  onSelect: (family) => {
    applySelectedLayerFont(family);
  },
});

loadGoogleFontsCatalog().then(() => {
  // A lista frissül a következő keresésnél; a jelenlegi értékek megmaradnak.
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

renderCanvas();
updateLayerList();
commitHistory();
animate();
