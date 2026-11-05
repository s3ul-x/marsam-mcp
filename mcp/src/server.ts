#!/usr/bin/env node
/**
 * Marsam MCP server (stdio).
 *
 * Exposes the headless painting engine as MCP tools so any MCP client can
 * create a canvas, paint, compose layers, preview the result and export it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { BRUSH_PRESETS } from "./brush.js";
import {
  BLEND_MODES,
  MAX_DOC_PIXELS,
  MAX_DOC_SIZE,
  MIN_DOC_SIZE,
  Studio,
} from "./engine.js";

const studio = new Studio();

const layerRef = z
  .union([z.string(), z.number().int()])
  .optional()
  .describe(
    "Target layer: its id (layer-2), its name, or its 0-based index counted from the bottom. Defaults to the active layer.",
  );

const blend = z
  .enum(BLEND_MODES.map((mode) => mode.value) as [string, ...string[]])
  .describe("Layer blend mode (Normal is source-over).");

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const server = new McpServer(
  { name: "marsam", version: "0.1.0" },
  {
    instructions: [
      "Marsam is a layered painting studio that runs headlessly on this machine.",
      "Typical flow: studio_new_canvas (optional) → paint with brush_stroke / shape_draw / text_draw / image_place → studio_preview to see a PNG of the result → studio_export to write an image file, or project_save for an editable .marsam project that opens in the Marsam web UI.",
      "Coordinates are canvas pixels with the origin at the top-left corner: x grows to the right, y grows down. Layers are listed and indexed from the bottom of the stack upward; drawing goes to the active layer unless a layer is passed explicitly.",
      "A document starts with a single transparent layer over the canvas background color. Use layer_add for more layers, layer_update for opacity/visibility/blend, and layer_fill for a solid coat.",
      "All image-producing tools return PNG content that the client can display. Files are written where the path points; relative paths resolve to the server's output directory (MARSAM_MCP_OUTPUT_DIR, else its working directory).",
      "A project can hold up to 24 pages. Each page has its own canvas, layers and undo history: use page_add / page_select / page_duplicate / page_delete / page_rename, and pass page or allPages to studio_preview, studio_export and project_save.",
      `Limits: canvas ${MIN_DOC_SIZE}-${MAX_DOC_SIZE} px per side and ${MAX_DOC_PIXELS.toLocaleString("en-US")} pixels total, 24 pages, 40 layers per page, 25 undo steps per page, export up to 16000 px per side.`,
    ].join("\n"),
  },
);

// ---------------------------------------------------------------- document

server.registerTool(
  "studio_new_canvas",
  {
    title: "New canvas",
    description:
      "Start a fresh document, replacing the current one and clearing undo history. Defaults to 1920×1080 with a #0f0f0f background and one empty layer. Returns the new document info.",
    annotations: { title: "New canvas", destructiveHint: true },
    inputSchema: {
      width: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE).default(1920),
      height: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE).default(1080),
      background: z
        .string()
        .default("#0f0f0f")
        .describe("Canvas background color as #rrggbb."),
      transparent: z
        .boolean()
        .default(false)
        .describe("Keep the background transparent in PNG and WebP exports."),
      name: z
        .string()
        .max(60)
        .optional()
        .describe("Project name used for default file names. Defaults to Untitled."),
    },
  },
  async ({ width, height, background, transparent, name }) =>
    textResult(
      studio.newDocument({ width, height, background, transparent, name }),
    ),
);

server.registerTool(
  "studio_info",
  {
    title: "Document info",
    description:
      "Describe the current document: project name, every page with index/name/size/layer count, the active page, its canvas size, background and transparency, every layer with id/name/visibility/opacity/blend, the active layer, undo/redo state, last brush settings and color. Call this before editing when you are unsure of the page or layer ids.",
    annotations: { title: "Document info", readOnlyHint: true },
    inputSchema: {},
  },
  async () => textResult(studio.info()),
);

// ------------------------------------------------------------------- pages

server.registerTool(
  "page_list",
  {
    title: "List pages",
    description:
      "List every page in the project with its 0-based index, name, canvas size, layer count and whether it is active.",
    annotations: { title: "List pages", readOnlyHint: true },
    inputSchema: {},
  },
  async () => textResult({ pageIndex: studio.activePageIndex, pages: studio.pageSummaries() }),
);

server.registerTool(
  "page_add",
  {
    title: "Add page",
    description:
      "Append a new blank page and make it active. Size and background default to the current page. Page changes are not undoable; each page keeps its own undo history.",
    annotations: { title: "Add page" },
    inputSchema: {
      name: z.string().max(40).optional().describe("Page name. Defaults to 'Page N'."),
      width: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE).optional(),
      height: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE).optional(),
      background: z
        .string()
        .optional()
        .describe("Background color as #rrggbb. Defaults to the current page background."),
    },
  },
  async ({ name, width, height, background }) =>
    textResult(studio.addPage({ name, width, height, background })),
);

server.registerTool(
  "page_select",
  {
    title: "Select page",
    description:
      "Make a page active by its 0-based index. Every later drawing, layer and export call targets that page. Returns the document info.",
    annotations: { title: "Select page" },
    inputSchema: {
      index: z.number().int().min(0).describe("0-based page index."),
    },
  },
  async ({ index }) => textResult(studio.selectPage(index)),
);

server.registerTool(
  "page_duplicate",
  {
    title: "Duplicate page",
    description:
      "Copy a page with all of its layers and pixels, insert the copy right after it and make it active. Not undoable.",
    annotations: { title: "Duplicate page" },
    inputSchema: {
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based page index to copy. Defaults to the active page."),
    },
  },
  async ({ index }) => textResult(studio.duplicatePage(index)),
);

server.registerTool(
  "page_delete",
  {
    title: "Delete page",
    description:
      "Delete a page by its 0-based index. The last remaining page cannot be deleted. Not undoable.",
    annotations: { title: "Delete page", destructiveHint: true },
    inputSchema: {
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based page index to delete. Defaults to the active page."),
    },
  },
  async ({ index }) => textResult(studio.deletePage(index)),
);

server.registerTool(
  "page_rename",
  {
    title: "Rename page",
    description: "Rename one page. Returns the updated page summary.",
    annotations: { title: "Rename page" },
    inputSchema: {
      index: z.number().int().min(0).describe("0-based page index."),
      name: z.string().min(1).max(40).describe("New page name."),
    },
  },
  async ({ index, name }) => textResult(studio.renamePage(index, name)),
);

server.registerTool(
  "studio_preview",
  {
    title: "Preview canvas",
    description:
      "Render the current document to a PNG image and return it as MCP image content, together with a short text summary. Use this to visually check the artwork after drawing. Width is capped by maxWidth (default 1400 px) to keep the payload small; the document itself is not resized.",
    annotations: { title: "Preview canvas", readOnlyHint: true },
    inputSchema: {
      maxWidth: z
        .number()
        .int()
        .min(64)
        .max(4000)
        .default(1400)
        .describe("Maximum width in pixels of the returned preview."),
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based page index to preview. Defaults to the active page."),
    },
  },
  async ({ maxWidth, page }) => {
    const preview = await studio.preview({ maxWidth, page });
    const info = studio.info();
    return {
      content: [
        {
          type: "image" as const,
          data: preview.data.toString("base64"),
          mimeType: "image/png" as const,
        },
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              preview: {
                width: preview.width,
                height: preview.height,
                page: preview.pageIndex,
                name: preview.pageName,
              },
              project: info.project,
              pageIndex: info.pageIndex,
              pages: info.pages,
              canvas: info.canvas,
              layers: info.layers,
              activeLayerId: info.activeLayerId,
              saved: info.saved,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "studio_resize_canvas",
  {
    title: "Resize canvas",
    description:
      "Change the canvas size. With keepContent (default true) the artwork keeps its pixel size and is re-anchored at the center (default) or the top-left corner; set keepContent false to crop everything away. Undoable.",
    annotations: { title: "Resize canvas" },
    inputSchema: {
      width: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE),
      height: z.number().int().min(MIN_DOC_SIZE).max(MAX_DOC_SIZE),
      anchor: z.enum(["center", "start"]).default("center"),
      keepContent: z.boolean().default(true),
    },
  },
  async ({ width, height, anchor, keepContent }) =>
    textResult(studio.resizeCanvas({ width, height, anchor, keepContent })),
);

server.registerTool(
  "studio_set_background",
  {
    title: "Set background",
    description:
      "Set the canvas background color and/or toggle background transparency. The background is not a layer, so it is never painted over by the eraser and can be changed at any time. Undoable.",
    annotations: { title: "Set background" },
    inputSchema: {
      color: z
        .string()
        .optional()
        .describe("Background color as #rrggbb or #rgb."),
      transparent: z
        .boolean()
        .optional()
        .describe("Whether PNG and WebP exports keep a transparent background."),
    },
  },
  async ({ color, transparent }) => {
    if (color === undefined && transparent === undefined) {
      throw new Error("Pass a color, a transparent flag, or both");
    }
    return textResult(studio.setBackground({ color, transparent }));
  },
);

server.registerTool(
  "studio_rename",
  {
    title: "Rename project",
    description:
      "Rename the project. The name is used in studio_info and in default file names for studio_export and project_save.",
    annotations: { title: "Rename project" },
    inputSchema: { name: z.string().min(1).max(60) },
  },
  async ({ name }) => textResult(studio.rename(name)),
);

// ------------------------------------------------------------------ layers

server.registerTool(
  "layer_add",
  {
    title: "Add layer",
    description:
      "Add a transparent layer directly above the active layer and make it active. Returns the new layer. Undoable.",
    annotations: { title: "Add layer" },
    inputSchema: {
      name: z
        .string()
        .max(60)
        .optional()
        .describe("Layer name. Defaults to a numbered Layer N."),
    },
  },
  async ({ name }) => textResult(studio.addLayer({ name })),
);

server.registerTool(
  "layer_update",
  {
    title: "Update layer",
    description:
      "Change a layer's name, visibility, opacity (0-1) or blend mode. Only the fields you pass are changed. Undoable.",
    annotations: { title: "Update layer" },
    inputSchema: {
      layer: layerRef,
      name: z.string().max(60).optional(),
      visible: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      blend: blend.optional(),
    },
  },
  async ({ layer, name, visible, opacity, blend: mode }) =>
    textResult(
      studio.updateLayer(layer, {
        name,
        visible,
        opacity,
        blend: mode as (typeof BLEND_MODES)[number]["value"] | undefined,
      }),
    ),
);

server.registerTool(
  "layer_delete",
  {
    title: "Delete layer",
    description:
      "Delete a layer and activate its neighbor. The last remaining layer cannot be deleted. Undoable.",
    annotations: { title: "Delete layer", destructiveHint: true },
    inputSchema: { layer: layerRef },
  },
  async ({ layer }) => textResult(studio.deleteLayer(layer)),
);

server.registerTool(
  "layer_merge_down",
  {
    title: "Merge layer down",
    description:
      "Merge the target layer into the layer directly below it, respecting both layers' opacity and blend modes, and activate the merged result. Undoable.",
    annotations: { title: "Merge layer down" },
    inputSchema: { layer: layerRef },
  },
  async ({ layer }) => textResult(studio.mergeDown(layer)),
);

server.registerTool(
  "layer_move",
  {
    title: "Reorder layer",
    description:
      "Move a layer one step up or down in the stack (up means toward the top of the artwork). Undoable.",
    annotations: { title: "Reorder layer" },
    inputSchema: {
      layer: layerRef,
      direction: z.enum(["up", "down"]),
    },
  },
  async ({ layer, direction }) =>
    textResult(studio.moveLayer(layer, direction)),
);

server.registerTool(
  "layer_select",
  {
    title: "Select layer",
    description:
      "Make a layer active. Later drawing calls target it unless they pass a layer explicitly.",
    annotations: { title: "Select layer", readOnlyHint: true },
    inputSchema: { layer: z.union([z.string(), z.number().int()]) },
  },
  async ({ layer }) => textResult(studio.selectLayer(layer)),
);

server.registerTool(
  "layer_fill",
  {
    title: "Fill layer",
    description:
      "Replace the layer's pixels with a solid color across the whole canvas. Use the background for a color that should not be erasable. Undoable.",
    annotations: { title: "Fill layer" },
    inputSchema: {
      layer: layerRef,
      color: z
        .string()
        .optional()
        .describe("Fill color as #rrggbb. Defaults to the current color."),
    },
  },
  async ({ layer, color }) => textResult(studio.fillLayer(layer, color)),
);

server.registerTool(
  "layer_clear",
  {
    title: "Clear layer",
    description: "Erase every pixel on the layer, leaving it transparent. Undoable.",
    annotations: { title: "Clear layer", destructiveHint: true },
    inputSchema: { layer: layerRef },
  },
  async ({ layer }) => textResult(studio.clearLayer(layer)),
);

// ----------------------------------------------------------------- drawing

server.registerTool(
  "brush_stroke",
  {
    title: "Brush stroke",
    description:
      "Paint a smooth brush stroke through a list of points with the same stamp engine as the web studio: size, hardness, flow, opacity, spacing, pressure and symmetry are supported. A single point makes a dot. Use mode 'erase' to erase instead of paint. One call is one undo step. Example points: [{x:200,y:300},{x:420,y:360},{x:640,y:300}].",
    annotations: { title: "Brush stroke" },
    inputSchema: {
      points: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            pressure: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("Pen pressure for this point; defaults to 1."),
          }),
        )
        .min(1)
        .describe("Stroke path in canvas pixels."),
      layer: layerRef,
      color: z.string().optional().describe("Stroke color as #rrggbb."),
      size: z.number().min(1).max(400).optional().describe("Brush diameter in px."),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Overall stroke opacity (applied once per stroke)."),
      flow: z
        .number()
        .min(0.01)
        .max(1)
        .optional()
        .describe("Paint deposited by each dab."),
      hardness: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("0 is a soft airbrush edge, 1 is a crisp edge."),
      spacing: z
        .number()
        .min(0.01)
        .max(2)
        .optional()
        .describe("Distance between dabs as a fraction of the brush size."),
      smoothing: z
        .number()
        .min(0)
        .max(0.95)
        .optional()
        .describe("Path smoothing; 0 follows the points exactly."),
      pressureSize: z.boolean().optional(),
      pressureOpacity: z.boolean().optional(),
      symmetry: z.enum(["none", "vertical", "horizontal", "quad"]).optional(),
      preset: z
        .enum(BRUSH_PRESETS.map((preset) => preset.id) as [string, ...string[]])
        .optional()
        .describe("Start from a named preset before applying the other fields."),
      mode: z.enum(["paint", "erase"]).default("paint"),
    },
  },
  async ({ points, layer, mode, preset, color, ...rest }) =>
    textResult(
      studio.drawStroke({
        points,
        layerId: layer,
        mode,
        preset,
        color,
        ...rest,
      }),
    ),
);

server.registerTool(
  "shape_draw",
  {
    title: "Draw shape",
    description:
      "Draw a line, rectangle or ellipse defined by two corner points. Fill and stroke can be combined; lines only use stroke. Coordinates are canvas pixels, and the shape is rasterized into the target layer in one undo step.",
    annotations: { title: "Draw shape" },
    inputSchema: {
      shape: z.enum(["line", "rect", "ellipse"]),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      stroke: z.string().optional().describe("Outline color as #rrggbb."),
      fill: z
        .string()
        .optional()
        .describe("Interior color as #rrggbb (rect and ellipse only)."),
      lineWidth: z.number().min(0.1).max(400).default(4),
      opacity: z.number().min(0).max(1).default(1),
      layer: layerRef,
    },
  },
  async ({ shape, x1, y1, x2, y2, stroke, fill, lineWidth, opacity, layer }) =>
    textResult(
      studio.drawShape({
        shape,
        x1,
        y1,
        x2,
        y2,
        stroke,
        fill,
        lineWidth,
        opacity,
        layerId: layer,
      }),
    ),
);

server.registerTool(
  "text_draw",
  {
    title: "Draw text",
    description:
      "Write text on a layer. Supports multiple lines (\\n), font size, family, weight, italic, alignment, baseline, line height and a max width. x/y are in canvas pixels and refer to the baseline/align point you choose. One call is one undo step. Register custom .ttf/.otf files first with font_register if the family is not installed.",
    annotations: { title: "Draw text" },
    inputSchema: {
      text: z.string().min(1),
      x: z.number(),
      y: z.number(),
      fontSize: z.number().min(1).max(2000).default(48),
      fontFamily: z
        .string()
        .optional()
        .describe("Font family name, e.g. Arial, Georgia or a font registered with font_register."),
      weight: z
        .union([z.number(), z.string()])
        .optional()
        .describe("Font weight such as 400 or bold."),
      italic: z.boolean().default(false),
      color: z.string().optional().describe("Text color as #rrggbb."),
      align: z.enum(["left", "center", "right"]).default("left"),
      baseline: z
        .enum(["top", "middle", "bottom", "alphabetic"])
        .default("top"),
      lineHeight: z.number().min(0.6).max(4).default(1.25),
      maxWidth: z
        .number()
        .min(1)
        .optional()
        .describe("Optional maximum line width; the text is squeezed to fit."),
      opacity: z.number().min(0).max(1).default(1),
      layer: layerRef,
    },
  },
  async ({ layer, ...rest }) =>
    textResult(
      studio.drawText({
        ...rest,
        layerId: layer,
      }),
    ),
);

server.registerTool(
  "image_place",
  {
    title: "Place image",
    description:
      "Place a raster image (PNG, JPEG, WebP, GIF, SVG, AVIF) as a new layer above the active layer. The source can be a local file path, a data URL, or an http(s) URL. Without width/height the image is fitted inside the canvas (contain) at its natural size or smaller; x/y default to centering. Supports rotation in degrees and opacity.",
    annotations: { title: "Place image" },
    inputSchema: {
      source: z
        .string()
        .describe("Local path, data URL, or http(s) URL of the image."),
      name: z.string().max(60).optional().describe("Layer name."),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(1).optional(),
      height: z.number().min(1).optional(),
      fit: z
        .enum(["contain", "cover", "stretch"])
        .default("contain")
        .describe("How to fit when width and height are omitted."),
      rotation: z.number().default(0).describe("Rotation in degrees."),
      opacity: z.number().min(0).max(1).default(1),
    },
  },
  async (args) => textResult(await studio.placeImage(args)),
);

// ------------------------------------------------------------------ history

server.registerTool(
  "studio_undo",
  {
    title: "Undo",
    description:
      "Undo the last drawing or structural change and return the resulting document info. Up to 25 steps are kept.",
    annotations: { title: "Undo" },
    inputSchema: {},
  },
  async () => {
    const changed = studio.undo();
    return textResult({ changed, ...studio.info() });
  },
);

server.registerTool(
  "studio_redo",
  {
    title: "Redo",
    description: "Redo the last undone change and return the document info.",
    annotations: { title: "Redo" },
    inputSchema: {},
  },
  async () => {
    const changed = studio.redo();
    return textResult({ changed, ...studio.info() });
  },
);

// -------------------------------------------------------------- files & fonts

server.registerTool(
  "studio_export",
  {
    title: "Export image",
    description:
      "Render one page and write a PNG, JPEG or WebP file. scale multiplies the canvas size (0.1-8) or use width to pick an exact pixel width; the height keeps the aspect ratio. PNG and WebP keep transparency when the page is transparent, unless transparent is false. Set page to export a specific 0-based page or allPages to write every page. Returns the absolute path, pixel size and byte size.",
    annotations: { title: "Export image" },
    inputSchema: {
      format: z.enum(["png", "jpeg", "webp"]).default("png"),
      path: z
        .string()
        .optional()
        .describe("Output file path. Relative paths resolve to the output directory."),
      scale: z.number().min(0.1).max(8).default(1),
      width: z
        .number()
        .int()
        .min(1)
        .max(16000)
        .optional()
        .describe("Exact output width; overrides scale."),
      quality: z
        .number()
        .min(0.05)
        .max(1)
        .default(0.92)
        .describe("Lossy quality for JPEG/WebP (0.05-1)."),
      transparent: z
        .boolean()
        .optional()
        .describe("Force or suppress a transparent background for PNG/WebP."),
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("0-based page index to export. Defaults to the active page."),
      allPages: z
        .boolean()
        .default(false)
        .describe("Export every page. File names gain a -01, -02 suffix when path is set."),
    },
  },
  async ({ allPages, ...args }) =>
    textResult(
      allPages
        ? await studio.exportAllPages(args)
        : await studio.exportImage(args),
    ),
);

server.registerTool(
  "project_save",
  {
    title: "Save project",
    description:
      "Write the whole project as a .marsam project file: every page with its canvas settings, layer order, names, visibility, opacity, blend modes and pixels. The file opens in the Marsam web studio. Returns the absolute path and byte size.",
    annotations: { title: "Save project" },
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe(
          "Output .marsam path. Defaults to <project name>.marsam in the output directory.",
        ),
    },
  },
  async ({ path }) => textResult(await studio.saveProject(path)),
);

server.registerTool(
  "project_open",
  {
    title: "Open project",
    description:
      "Open a .marsam project file and replace the current document, including every page, canvas size, background, layers and the active page. Version 1 files open as a single page. History is cleared. Returns a summary of what was loaded.",
    annotations: { title: "Open project", destructiveHint: true },
    inputSchema: { path: z.string().describe("Path to a .marsam file.") },
  },
  async ({ path }) => textResult(await studio.openProject(path)),
);

server.registerTool(
  "font_register",
  {
    title: "Register font",
    description:
      "Load a .ttf or .otf font file into the headless renderer so text_draw can use its family name. Optionally set an alias family. Returns the available font families.",
    annotations: { title: "Register font" },
    inputSchema: {
      path: z.string().describe("Path to a .ttf, .otf or .ttc font file."),
      family: z
        .string()
        .optional()
        .describe("Alias to use as fontFamily in text_draw."),
    },
  },
  async ({ path, family }) => textResult(studio.registerFont(path, family)),
);

server.registerTool(
  "font_list",
  {
    title: "List fonts",
    description:
      "List the font families available to text_draw, including fonts added with font_register.",
    annotations: { title: "List fonts", readOnlyHint: true },
    inputSchema: {},
  },
  async () => textResult({ families: studio.fontFamilies() }),
);

// ------------------------------------------------------------------- startup

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Marsam MCP server ready on stdio");
}

process.on("uncaughtException", (error) => {
  console.error("Marsam MCP uncaught exception:", error);
});
process.on("unhandledRejection", (error) => {
  console.error("Marsam MCP unhandled rejection:", error);
});

main().catch((error) => {
  console.error("Marsam MCP failed to start:", error);
  process.exit(1);
});
