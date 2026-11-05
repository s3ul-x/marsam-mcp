import { BLEND_MODES, MAX_DOC_PIXELS, MAX_DOC_SIZE, MIN_DOC_SIZE, type BlendMode, type DocSettings } from "./studio";
import { normalizeHex } from "./color";

export const PROJECT_APP_ID = "marsam";
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = "marsam";
export const MAX_PROJECT_LAYERS = 40;
export const MAX_PROJECT_PAGES = 24;
export const MAX_PROJECT_BYTES = 400 * 1024 * 1024;

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
    background: normalizeHex(String(docRaw.background ?? "")) ?? "#0f0f0f",
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
    const blend = BLEND_MODES.some((mode) => mode.value === layer.blend)
      ? (layer.blend as BlendMode)
      : "source-over";
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

function parsePage(
  item: unknown,
  index: number,
  fallbackDoc?: Record<string, unknown>,
): ProjectPageData {
  const page = (item ?? {}) as Record<string, unknown>;
  const docRaw = (page.doc ?? fallbackDoc ?? {}) as Record<string, unknown>;
  const doc = parseDoc(docRaw);
  const layersRaw = Array.isArray(page.layers) ? page.layers : [];
  const layers = parseLayers(layersRaw);
  return {
    name:
      typeof page.name === "string" && page.name.trim()
        ? page.name.trim().slice(0, 60)
        : `Page ${index + 1}`,
    doc,
    activeIndex: Math.round(clampNumber(page.activeIndex, 0, layers.length - 1, 0)),
    layers,
  };
}

/**
 * Validates an untrusted project file. Throws an English error message that is
 * safe to show to the user.
 *
 * Version 1 files (a single `doc` + `layers` pair) are read as a one-page
 * project, so older artwork keeps opening.
 */
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

  if (version === 1) {
    const docRaw = (data.doc ?? {}) as Record<string, unknown>;
    const doc = parseDoc(docRaw);
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

  const pages = pagesRaw.map((item, index) =>
    parsePage(item, index, data.doc as Record<string, unknown> | undefined),
  );

  return {
    name,
    activePage: Math.round(clampNumber(data.activePage, 0, pages.length - 1, 0)),
    pages,
  };
}

export async function readLayerImage(source: string): Promise<CanvasImageSource> {
  const response = await fetch(source);
  const blob = await response.blob();
  return createImageBitmap(blob);
}
