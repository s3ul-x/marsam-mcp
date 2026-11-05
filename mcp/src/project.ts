/**
 * The `.marsam` project format, mirrored from the web app
 * (`apps/web/lib/paint/project.ts`). Files produced here open in the studio
 * UI and vice versa, so artwork can flow between MCP clients and the app.
 *
 * Keep the validation rules in sync with the web app when the format changes.
 */

export const PROJECT_APP_ID = "marsam";
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = "marsam";
export const MAX_PROJECT_LAYERS = 40;
export const MAX_PROJECT_PAGES = 24;
export const MAX_PROJECT_BYTES = 400 * 1024 * 1024;

export const MIN_DOC_SIZE = 64;
export const MAX_DOC_SIZE = 6000;
export const MAX_DOC_PIXELS = 40_000_000;

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "source-over", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
  { value: "hard-light", label: "Hard Light" },
  { value: "soft-light", label: "Soft Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

export function isBlendMode(value: unknown): value is BlendMode {
  return BLEND_MODES.some((mode) => mode.value === value);
}

export type DocSettings = {
  width: number;
  height: number;
  background: string;
  transparent: boolean;
};

export type ProjectLayerData = {
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  image: string | null;
};

export type ProjectPageData = {
  name: string;
  doc: DocSettings;
  activeIndex: number;
  layers: ProjectLayerData[];
};

export type ParsedProject = {
  name: string;
  activePage: number;
  pages: ProjectPageData[];
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function parseDoc(docRaw: Record<string, unknown>): DocSettings {
  const width = Math.round(clampNumber(docRaw.width, MIN_DOC_SIZE, MAX_DOC_SIZE, 0));
  const height = Math.round(clampNumber(docRaw.height, MIN_DOC_SIZE, MAX_DOC_SIZE, 0));
  if (width < MIN_DOC_SIZE || height < MIN_DOC_SIZE) {
    throw new Error("The project's canvas size is not supported");
  }
  if (width * height > MAX_DOC_PIXELS) {
    throw new Error("The project's canvas size is too large to open");
  }
  return {
    width,
    height,
    background: normalizeDocColor(docRaw.background),
    transparent: docRaw.transparent === true,
  };
}

function parseLayers(layersRaw: unknown[]): ProjectLayerData[] {
  if (layersRaw.length === 0) {
    throw new Error("This project has no layers");
  }
  if (layersRaw.length > MAX_PROJECT_LAYERS) {
    throw new Error(`This project has more than ${MAX_PROJECT_LAYERS} layers`);
  }

  return layersRaw.map((item, index) => {
    const layer = (item ?? {}) as Record<string, unknown>;
    const image = typeof layer.image === "string" ? layer.image : null;
    if (image && !image.startsWith("data:image/")) {
      throw new Error("A layer image in this project could not be read");
    }
    const blend = isBlendMode(layer.blend) ? layer.blend : "source-over";
    return {
      name:
        typeof layer.name === "string" && layer.name.trim()
          ? layer.name.trim().slice(0, 60)
          : `Layer ${index + 1}`,
      visible: layer.visible !== false,
      opacity: clampNumber(layer.opacity, 0, 1, 1),
      blend,
      image,
    };
  });
}

/** Validates an untrusted project file. Errors are safe to show to the user. */
export function parseProjectFile(text: string): ParsedProject {
  if (text.length > MAX_PROJECT_BYTES) {
    throw new Error("This project file is too large to open");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not a Marsam project");
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("That file is not a Marsam project");
  }

  const data = raw as Record<string, unknown>;
  if (data.app !== PROJECT_APP_ID) {
    throw new Error("That file is not a Marsam project");
  }

  const version = Number(data.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error("That project file is damaged");
  }
  if (version > PROJECT_VERSION) {
    throw new Error("This project was saved by a newer version of Marsam");
  }

  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim().slice(0, 60)
      : "Untitled";

  // Version 1 files hold one canvas; read them as a one-page project.
  if (version === 1) {
    const doc = parseDoc((data.doc ?? {}) as Record<string, unknown>);
    const layers = parseLayers(Array.isArray(data.layers) ? data.layers : []);
    return {
      name,
      activePage: 0,
      pages: [
        {
          name: "Page 1",
          doc,
          activeIndex: Math.round(
            clampNumber(data.activeIndex, 0, layers.length - 1, 0),
          ),
          layers,
        },
      ],
    };
  }

  const pagesRaw = Array.isArray(data.pages) ? data.pages : [];
  if (pagesRaw.length === 0) {
    throw new Error("This project has no pages");
  }
  if (pagesRaw.length > MAX_PROJECT_PAGES) {
    throw new Error(`This project has more than ${MAX_PROJECT_PAGES} pages`);
  }

  const pages = pagesRaw.map((item, index) => {
    const page = (item ?? {}) as Record<string, unknown>;
    const layers = parseLayers(Array.isArray(page.layers) ? page.layers : []);
    return {
      name:
        typeof page.name === "string" && page.name.trim()
          ? page.name.trim().slice(0, 60)
          : `Page ${index + 1}`,
      doc: parseDoc(
        (page.doc ?? data.doc ?? {}) as Record<string, unknown>,
      ),
      activeIndex: Math.round(
        clampNumber(page.activeIndex, 0, layers.length - 1, 0),
      ),
      layers,
    };
  });

  return {
    name,
    activePage: Math.round(clampNumber(data.activePage, 0, pages.length - 1, 0)),
    pages,
  };
}

function normalizeDocColor(value: unknown) {
  const text = String(value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`.toLowerCase();
  return "#0f0f0f";
}
