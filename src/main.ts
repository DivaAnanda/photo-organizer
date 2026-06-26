import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface PhotoGroup {
  basename: string;
  files: string[];
  preview: string;
}

interface SlotBinding {
  key: number;
  folder: string | null;
  label: string;
}

interface Settings {
  version: number;
  slots: SlotBinding[];
  lastSourceFolder: string | null;
}

interface ImageMetadata {
  fileName: string;
  camera: string | null;
  lens: string | null;
  iso: string | null;
  shutterSpeed: string | null;
  aperture: string | null;
  focalLength: string | null;
  exposureBias: string | null;
  dateTaken: string | null;
  dimensions: string | null;
  fileSize: string | null;
}

type Mode = "copy" | "move";

const PREVIEW_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "gif",
  "tif",
  "tiff",
]);

const state = {
  sourceFolder: null as string | null,
  groups: [] as PhotoGroup[],
  index: 0,
  mode: "copy" as Mode,
  settings: null as Settings | null,
  done: new Set<number>(),
  history: [] as number[],
  metadataVisible: false,
};

const zoomState = {
  scale: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginPanX: 0,
  dragOriginPanY: 0,
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.15;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unexpected error";
}

let toastTimer: number | undefined;
function toast(msg: string, kind: "info" | "error" = "info"): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden", "info", "error");
  el.classList.add(kind);
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 2500);
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i + 1).toLowerCase();
}

function fileName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

function resetZoom(): void {
  zoomState.scale = 1;
  zoomState.panX = 0;
  zoomState.panY = 0;
  zoomState.dragging = false;
  applyZoom();
}

function applyZoom(): void {
  const img = $("viewer-img") as HTMLImageElement;
  img.style.transform = `translate(${zoomState.panX}px, ${zoomState.panY}px) scale(${zoomState.scale})`;
  img.style.cursor = zoomState.scale > 1
    ? zoomState.dragging
      ? "grabbing"
      : "grab"
    : "zoom-in";
}

function zoomAt(clientX: number, clientY: number, factor: number): void {
  const img = $("viewer-img") as HTMLImageElement;
  if (img.classList.contains("hidden")) return;
  const rect = img.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const offsetX = clientX - cx;
  const offsetY = clientY - cy;

  const newScale = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, zoomState.scale * factor),
  );
  const ratio = newScale / zoomState.scale;
  zoomState.panX = (zoomState.panX - offsetX) * ratio + offsetX;
  zoomState.panY = (zoomState.panY - offsetY) * ratio + offsetY;
  zoomState.scale = newScale;
  if (zoomState.scale === 1) {
    zoomState.panX = 0;
    zoomState.panY = 0;
  }
  applyZoom();
}

function setupZoomHandlers(): void {
  const viewer = $("viewer");
  const img = $("viewer-img") as HTMLImageElement;

  viewer.addEventListener("wheel", (e: WheelEvent) => {
    if (img.classList.contains("hidden")) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  img.addEventListener("dblclick", (e: MouseEvent) => {
    if (zoomState.scale > 1) {
      resetZoom();
    } else {
      zoomAt(e.clientX, e.clientY, 4);
    }
  });

  img.addEventListener("mousedown", (e: MouseEvent) => {
    if (zoomState.scale <= 1) return;
    e.preventDefault();
    zoomState.dragging = true;
    zoomState.dragStartX = e.clientX;
    zoomState.dragStartY = e.clientY;
    zoomState.dragOriginPanX = zoomState.panX;
    zoomState.dragOriginPanY = zoomState.panY;
    applyZoom();
  });

  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (!zoomState.dragging) return;
    zoomState.panX = zoomState.dragOriginPanX + (e.clientX - zoomState.dragStartX);
    zoomState.panY = zoomState.dragOriginPanY + (e.clientY - zoomState.dragStartY);
    applyZoom();
  });

  window.addEventListener("mouseup", () => {
    if (zoomState.dragging) {
      zoomState.dragging = false;
      applyZoom();
    }
  });
}

function renderViewer(): void {
  const empty = $("viewer-empty");
  const img = $("viewer-img") as HTMLImageElement;
  const rawBox = $("viewer-raw");
  const rawName = $("viewer-raw-name");
  const meta = $("viewer-meta");

  if (state.groups.length === 0) {
    empty.classList.remove("hidden");
    img.classList.add("hidden");
    rawBox.classList.add("hidden");
    meta.textContent = "";
    return;
  }

  if (state.index >= state.groups.length) {
    empty.classList.remove("hidden");
    empty.innerHTML =
      '<p>Done — all photos processed.</p><p class="hint">Open another folder or undo the last action (Ctrl+Z).</p>';
    img.classList.add("hidden");
    rawBox.classList.add("hidden");
    meta.textContent = "";
    return;
  }

  empty.classList.add("hidden");
  resetZoom();
  const group = state.groups[state.index];
  const previewExt = extOf(group.preview);
  if (PREVIEW_EXTS.has(previewExt)) {
    img.src = convertFileSrc(group.preview);
    img.classList.remove("hidden");
    rawBox.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    rawBox.classList.remove("hidden");
    rawName.textContent = fileName(group.preview);
  }
  meta.textContent = group.files.map(fileName).join("  +  ");
  void loadMetadata();
}

async function loadMetadata(): Promise<void> {
  if (!state.metadataVisible) return;
  if (state.groups.length === 0 || state.index >= state.groups.length) {
    renderMetadata(null);
    return;
  }
  const group = state.groups[state.index];
  try {
    const meta = await invoke<ImageMetadata>("read_metadata", {
      path: group.preview,
    });
    renderMetadata(meta);
  } catch (err: unknown) {
    renderMetadata(null);
    toast(`Metadata read failed: ${getErrorMessage(err)}`, "error");
  }
}

function renderMetadata(meta: ImageMetadata | null): void {
  const list = $("metadata-list");
  list.innerHTML = "";
  if (!meta) {
    const empty = document.createElement("div");
    empty.className = "metadata-empty";
    empty.textContent = "No data";
    list.appendChild(empty);
    return;
  }

  const rows: Array<[string, string | null]> = [
    ["File", meta.fileName],
    ["Camera", meta.camera],
    ["Lens", meta.lens],
    ["ISO", meta.iso],
    ["Shutter", meta.shutterSpeed],
    ["Aperture", meta.aperture],
    ["Focal length", meta.focalLength],
    ["Exposure", meta.exposureBias],
    ["Dimensions", meta.dimensions],
    ["Size", meta.fileSize],
    ["Taken", meta.dateTaken],
  ];

  let any = false;
  for (const [label, value] of rows) {
    if (!value) continue;
    any = true;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  if (!any) {
    const empty = document.createElement("div");
    empty.className = "metadata-empty";
    empty.textContent = "No EXIF data in this file";
    list.appendChild(empty);
  }
}

function toggleMetadata(): void {
  state.metadataVisible = !state.metadataVisible;
  $("metadata-panel").classList.toggle("hidden", !state.metadataVisible);
  void loadMetadata();
}

function renderCounter(): void {
  $("counter").textContent = `${Math.min(
    state.index + 1,
    state.groups.length,
  )} / ${state.groups.length}`;
}

function renderFilmstrip(): void {
  const container = $("filmstrip");
  container.innerHTML = "";
  state.groups.forEach((group, i) => {
    const item = document.createElement("button");
    item.className = "film-item";
    item.dataset.index = String(i);
    if (i === state.index) item.classList.add("current");
    if (state.done.has(i)) item.classList.add("done");

    const ext = extOf(group.preview);
    if (PREVIEW_EXTS.has(ext)) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.src = convertFileSrc(group.preview);
      img.alt = group.basename;
      item.appendChild(img);
    } else {
      const raw = document.createElement("div");
      raw.className = "film-raw";
      raw.textContent = "RAW";
      item.appendChild(raw);
    }

    const label = document.createElement("span");
    label.className = "film-index";
    label.textContent = String(i + 1);
    item.appendChild(label);

    item.addEventListener("click", () => {
      state.index = i;
      renderCounter();
      renderViewer();
      updateFilmstripSelection();
    });
    container.appendChild(item);
  });
  scrollCurrentIntoView();
}

function updateFilmstripSelection(): void {
  const items = document.querySelectorAll<HTMLElement>(".film-item");
  items.forEach((el, i) => {
    el.classList.toggle("current", i === state.index);
    el.classList.toggle("done", state.done.has(i));
  });
  scrollCurrentIntoView();
}

function scrollCurrentIntoView(): void {
  const current = document.querySelector<HTMLElement>(".film-item.current");
  if (current) {
    current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }
}

function renderSlots(): void {
  const container = $("slots");
  container.innerHTML = "";
  const slots = state.settings?.slots ?? [];
  for (const slot of slots) {
    const btn = document.createElement("button");
    btn.className = "slot";
    btn.dataset.key = String(slot.key);
    btn.innerHTML = `
      <span class="slot-key">${slot.key}</span>
      <span class="slot-label">${slot.label}</span>
      <span class="slot-folder">${slot.folder ?? "click to bind…"}</span>
    `;
    if (!slot.folder) btn.classList.add("unbound");
    btn.addEventListener("click", () => bindSlot(slot.key));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      renameSlot(slot.key);
    });
    container.appendChild(btn);
  }
}

function renderSource(): void {
  $("source-label").textContent = state.sourceFolder ?? "No folder loaded";
}

function applyModeClass(): void {
  const app = $("app");
  app.classList.remove("mode-copy", "mode-move");
  app.classList.add(`mode-${state.mode}`);
}

async function bindSlot(key: number): Promise<void> {
  try {
    const folder = await open({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    updateSlot(key, { folder });
    await persistSettings();
    renderSlots();
  } catch (err: unknown) {
    toast(`Failed to bind folder: ${getErrorMessage(err)}`, "error");
  }
}

function renameSlot(key: number): void {
  const slot = state.settings?.slots.find((s) => s.key === key);
  if (!slot) return;
  const next = window.prompt(`Label for slot ${key}:`, slot.label);
  if (next === null) return;
  const trimmed = next.trim() || `Slot ${key}`;
  updateSlot(key, { label: trimmed });
  void persistSettings();
  renderSlots();
}

function updateSlot(key: number, patch: Partial<SlotBinding>): void {
  if (!state.settings) return;
  state.settings = {
    ...state.settings,
    slots: state.settings.slots.map((s) =>
      s.key === key ? { ...s, ...patch } : s,
    ),
  };
}

async function persistSettings(): Promise<void> {
  if (!state.settings) return;
  try {
    await invoke("save_settings", { settings: state.settings });
  } catch (err: unknown) {
    toast(`Save failed: ${getErrorMessage(err)}`, "error");
  }
}

async function pickSource(): Promise<void> {
  try {
    const folder = await open({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    await loadSource(folder);
  } catch (err: unknown) {
    toast(`Failed to open folder: ${getErrorMessage(err)}`, "error");
  }
}

async function loadSource(folder: string): Promise<void> {
  state.sourceFolder = folder;
  if (state.settings) {
    state.settings = { ...state.settings, lastSourceFolder: folder };
    await persistSettings();
  }
  try {
    const groups = await invoke<PhotoGroup[]>("scan_folder", { path: folder });
    state.groups = groups;
    state.index = 0;
    state.done.clear();
    state.history = [];
    resetZoom();
    renderSource();
    renderCounter();
    renderViewer();
    renderFilmstrip();
    if (groups.length === 0) {
      toast("No images found in folder", "info");
    }
  } catch (err: unknown) {
    toast(`Scan failed: ${getErrorMessage(err)}`, "error");
  }
}

async function applyKey(key: number): Promise<void> {
  if (state.groups.length === 0 || state.index >= state.groups.length) return;
  const slot = state.settings?.slots.find((s) => s.key === key);
  if (!slot || !slot.folder) {
    toast(`Slot ${key} is not bound to a folder`, "error");
    return;
  }
  const group = state.groups[state.index];
  try {
    await invoke("apply_action", {
      group,
      destFolder: slot.folder,
      op: state.mode,
    });
    state.done.add(state.index);
    state.history.push(state.index);
    state.index += 1;
    renderCounter();
    renderViewer();
    updateFilmstripSelection();
  } catch (err: unknown) {
    toast(getErrorMessage(err), "error");
  }
}

async function undo(): Promise<void> {
  try {
    const result = await invoke<{ moved: [string, string][] } | null>(
      "undo_last",
    );
    if (!result) {
      toast("Nothing to undo", "info");
      return;
    }
    const undone = state.history.pop();
    if (undone !== undefined) {
      state.done.delete(undone);
      state.index = undone;
    }
    renderCounter();
    renderViewer();
    updateFilmstripSelection();
    toast("Undone", "info");
  } catch (err: unknown) {
    toast(`Undo failed: ${getErrorMessage(err)}`, "error");
  }
}

function navigate(delta: number): void {
  if (state.groups.length === 0) return;
  const next = state.index + delta;
  if (next < 0 || next > state.groups.length) return;
  state.index = next;
  renderCounter();
  renderViewer();
  updateFilmstripSelection();
}

function bindKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.target instanceof HTMLTextAreaElement) return;

    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      void applyKey(parseInt(e.key, 10));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void undo();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigate(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigate(-1);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      navigate(1);
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      const img = $("viewer-img").getBoundingClientRect();
      zoomAt(img.left + img.width / 2, img.top + img.height / 2, ZOOM_STEP);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      const img = $("viewer-img").getBoundingClientRect();
      zoomAt(img.left + img.width / 2, img.top + img.height / 2, 1 / ZOOM_STEP);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      resetZoom();
      return;
    }
    if (e.key.toLowerCase() === "i") {
      e.preventDefault();
      toggleMetadata();
    }
  });
}

function bindControls(): void {
  $("pick-source").addEventListener("click", () => void pickSource());
  $("info-toggle").addEventListener("click", () => toggleMetadata());
  $("metadata-close").addEventListener("click", () => toggleMetadata());
  const modeSelect = $("mode-select") as HTMLSelectElement;
  modeSelect.value = state.mode;
  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value as Mode;
    applyModeClass();
    if (state.mode === "move") {
      toast("Move mode active — files will be moved, not copied", "info");
    }
  });
}

async function init(): Promise<void> {
  bindControls();
  bindKeyboard();
  setupZoomHandlers();
  applyModeClass();
  try {
    state.settings = await invoke<Settings>("load_settings");
  } catch (err: unknown) {
    state.settings = {
      version: 1,
      slots: Array.from({ length: 9 }, (_, i) => ({
        key: i + 1,
        folder: null,
        label: `Slot ${i + 1}`,
      })),
      lastSourceFolder: null,
    };
    toast(`Settings load failed: ${getErrorMessage(err)}`, "error");
  }
  renderSlots();
  renderSource();
  renderCounter();
  renderViewer();
  renderFilmstrip();
}

window.addEventListener("DOMContentLoaded", () => {
  void init();
});
