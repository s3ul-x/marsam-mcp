/**
 * End-to-end smoke test for the Marsam MCP server.
 *
 * It launches the real server over stdio, walks through a small painting
 * session, and asserts the important contracts: tools are listed, strokes and
 * shapes change pixels, previews return PNG image content, exports and
 * projects land on disk, and undo/redo work.
 *
 * Run: npm run build && npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = process.env.MARSAM_SMOKE_DIR
  ? resolve(process.env.MARSAM_SMOKE_DIR)
  : join(root, ".smoke-out");

await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "server.js")],
  cwd: root,
  stderr: "inherit",
  env: {
    ...process.env,
    MARSAM_MCP_OUTPUT_DIR: outDir,
  },
  maxBufferSize: 64 * 1024 * 1024,
});

const client = new Client({ name: "marsam-smoke", version: "0.1.0" });
await client.connect(transport);

let checks = 0;
function ok(condition, label, detail) {
  checks += 1;
  if (!condition) {
    throw new Error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`ok ${checks} - ${label}`);
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    throw new Error(`${name} returned an error: ${text}`);
  }
  return result;
}

function payload(result) {
  const item = (result.content ?? []).find((entry) => entry.type === "text");
  return item ? JSON.parse(item.text) : null;
}

const toolList = await client.listTools();
const toolNames = toolList.tools.map((tool) => tool.name).sort();
ok(toolNames.length >= 20, `server lists ${toolNames.length} tools`);
ok(toolNames.includes("brush_stroke"), "brush_stroke is exposed");
ok(toolNames.includes("studio_preview"), "studio_preview is exposed");
ok(toolNames.includes("project_save"), "project_save is exposed");
ok(toolNames.includes("page_add"), "page_add is exposed");

const pagesAtStart = payload(await call("page_list"));
ok(
  pagesAtStart.pages.length === 1 && pagesAtStart.pages[0].active,
  "a new project has one active page",
);

const created = payload(
  await call("studio_new_canvas", {
    width: 900,
    height: 600,
    background: "#121218",
    name: "MCP Smoke",
  }),
);
ok(created.canvas.width === 900 && created.canvas.height === 600, "new canvas uses the requested size");
ok(created.layers.length === 1, "new canvas starts with one layer");

await call("layer_add", { name: "Ink" });
const painted = payload(
  await call("brush_stroke", {
    points: [
      { x: 120, y: 150, pressure: 0.6 },
      { x: 260, y: 300, pressure: 0.9 },
      { x: 430, y: 210, pressure: 1 },
      { x: 560, y: 330, pressure: 0.7 },
    ],
    color: "#e2b264",
    size: 30,
    hardness: 0.75,
    flow: 0.9,
    smoothing: 0.2,
  }),
);
ok(painted.layerName === "Ink", "brush stroke targets the active layer");
ok(painted.history === 2, "one stroke adds a single history entry");

await call("shape_draw", {
  shape: "ellipse",
  x1: 620,
  y1: 120,
  x2: 820,
  y2: 300,
  fill: "#1f5f7a",
  stroke: "#8aa14a",
  lineWidth: 6,
});
await call("text_draw", {
  text: "Marsam MCP",
  x: 120,
  y: 430,
  fontSize: 58,
  fontFamily: "Arial",
  color: "#f6f3ec",
});

const preview = await call("studio_preview", { maxWidth: 640 });
const image = (preview.content ?? []).find((entry) => entry.type === "image");
ok(Boolean(image), "preview returns MCP image content");
ok(image?.mimeType === "image/png", "preview is a PNG");
const previewBytes = Buffer.from(image.data, "base64");
ok(
  previewBytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
  "preview bytes have a PNG signature",
);
const previewInfo = payload(preview);
ok(previewInfo.preview.width === 640, "preview respects maxWidth");
ok(previewInfo.layers.length === 2, "preview reports both layers");

const info = payload(await call("studio_info"));
ok(info.layers.some((layer) => layer.active && layer.name === "Ink"), "info marks the active layer");
ok(info.history === 4, "history counts the drawing operations");

await call("layer_update", { layer: "Ink", opacity: 0.8, blend: "screen" });
const updated = payload(await call("studio_info"));
const ink = updated.layers.find((layer) => layer.name === "Ink");
ok(ink?.opacity === 0.8 && ink.blend === "screen", "layer opacity and blend updates apply");

const pngPath = join(outDir, "smoke.png");
const exported = payload(
  await call("studio_export", { format: "png", path: pngPath, width: 1800 }),
);
ok(exported.width === 1800 && exported.height === 1200, "export scales to the requested width");
ok((await stat(exported.path)).size === exported.bytes, "export file exists on disk");
ok(
  exported.path === resolve(pngPath),
  "export resolves the output path",
);

const jpeg = payload(
  await call("studio_export", { format: "jpeg", path: "smoke.jpg", quality: 0.6 }),
);
ok(jpeg.format === "jpeg" && jpeg.bytes > 0, "JPEG export works");

const projectPath = join(outDir, "smoke.marsam");
const saved = payload(await call("project_save", { path: projectPath }));
ok(
  saved.layers === 2 && saved.pages === 1 && saved.bytes > 0,
  "project save reports layers, pages and size",
);
const projectText = await readFile(projectPath, "utf8");
const projectJson = JSON.parse(projectText);
ok(projectJson.app === "marsam" && projectJson.version === 2, "project uses the v2 Marsam format");
ok(projectJson.pages.length === 1, "project stores the page list");
ok(projectJson.pages[0].layers.length === 2, "project stores every layer of the page");
ok(typeof projectJson.pages[0].layers[0].image === "string", "project embeds layer pixels");

const undone = payload(await call("studio_undo"));
ok(undone.changed === true, "undo reports a change");
const redone = payload(await call("studio_redo"));
ok(redone.changed === true, "redo reports a change");

const opened = payload(await call("project_open", { path: projectPath }));
ok(opened.project === "MCP Smoke", "project reopens with its name");
ok(opened.width === 900 && opened.height === 600, "project reopens its canvas size");
ok(opened.layers === 2, "project reopens every layer");

const reopenedInfo = payload(await call("studio_info"));
ok(reopenedInfo.layers[1].blend === "screen", "project preserves blend modes");
ok(reopenedInfo.layers[1].opacity === 0.8, "project preserves opacity");

const addedPage = payload(
  await call("page_add", {
    name: "Poster",
    width: 600,
    height: 400,
    background: "#f3f0e8",
  }),
);
ok(
  addedPage.pages.length === 2 && addedPage.page.name === "Poster",
  "page_add appends and activates a page",
);
ok(
  addedPage.page.width === 600 && addedPage.page.height === 400,
  "page_add uses the requested size",
);

const freshPageUndo = payload(await call("studio_undo"));
ok(
  freshPageUndo.changed === false,
  "a new page starts with its own empty history",
);

await call("text_draw", {
  text: "Page two",
  x: 40,
  y: 200,
  fontSize: 48,
  fontFamily: "Arial",
  color: "#17160f",
});

const pageUndo = payload(await call("studio_undo"));
ok(pageUndo.changed === true, "undo is scoped to the active page");

const pageRedo = payload(await call("studio_redo"));
ok(pageRedo.changed === true, "redo restores the page content");

const pagePreview = await call("studio_preview", { maxWidth: 600, page: 0 });
const pagePreviewInfo = payload(pagePreview);
ok(pagePreviewInfo.preview.width === 600, "preview targets another page by index");
ok(pagePreviewInfo.preview.page === 0, "preview reports the page it rendered");
ok(pagePreviewInfo.pages.length === 2, "preview reports every page");

const duplicated = payload(await call("page_duplicate"));
ok(duplicated.pages.length === 3, "page_duplicate inserts a copy");

const renamedPage = payload(
  await call("page_rename", { index: 2, name: "Poster copy" }),
);
ok(renamedPage.name === "Poster copy", "page_rename renames the page");

const selected = payload(await call("page_select", { index: 0 }));
ok(
  selected.pageIndex === 0 && selected.canvas.width === 900,
  "page_select switches the active page",
);

const pageExport = payload(
  await call("studio_export", {
    format: "png",
    path: "poster.png",
    page: 2,
    width: 300,
  }),
);
ok(
  pageExport.width === 300 && pageExport.pageIndex === 2,
  "studio_export exports a chosen page",
);
ok(pageExport.pageName === "Poster copy", "export reports the page name");

const allExport = payload(
  await call("studio_export", {
    format: "png",
    path: "spread.png",
    allPages: true,
    width: 200,
  }),
);
ok(
  Array.isArray(allExport) && allExport.length === 3,
  "studio_export allPages writes every page",
);

const pagesPath = join(outDir, "pages.marsam");
const savedPages = payload(await call("project_save", { path: pagesPath }));
ok(savedPages.pages === 3, "project save reports the page count");
const pagesJson = JSON.parse(await readFile(pagesPath, "utf8"));
ok(
  pagesJson.version === 2 && pagesJson.pages.length === 3,
  "v2 project stores every page",
);
ok(
  pagesJson.pages[2].name === "Poster copy" &&
    pagesJson.pages[2].doc.width === 600,
  "v2 pages keep their own canvas and name",
);
const reopenedPages = payload(await call("project_open", { path: pagesPath }));
ok(
  reopenedPages.pages.length === 3 && reopenedPages.pageIndex === 0,
  "project reopens every page and the active index",
);

const deletedPage = payload(await call("page_delete", { index: 2 }));
ok(deletedPage.pages.length === 2, "page_delete removes the page");
await call("page_select", { index: 0 });

const fonts = payload(await call("font_list"));
ok(Array.isArray(fonts.families) && fonts.families.length > 0, "font list is available");

const cleared = payload(await call("layer_clear", { layer: 1 }));
ok(cleared.id, "layer clear returns the layer");

const merged = payload(await call("layer_merge_down", { layer: 1 }));
ok(merged.active === true, "merge down activates the merged layer");

const resized = payload(
  await call("studio_resize_canvas", { width: 1000, height: 700, keepContent: true }),
);
ok(
  resized.canvas.width === 1000 && resized.canvas.height === 700,
  "canvas resize applies while keeping content",
);

const background = payload(
  await call("studio_set_background", { color: "#1a1a22", transparent: false }),
);
ok(background.canvas.background === "#1a1a22", "background color updates");

const placedSmall = payload(
  await call("image_place", {
    source: exported.path,
    x: 40,
    y: 40,
    width: 240,
    height: 160,
    rotation: 12,
  }),
);
ok(
  placedSmall.placedWidth === 240 && placedSmall.placedHeight === 160,
  "image placement uses the requested size",
);
ok(typeof placedSmall.name === "string" && placedSmall.name.length > 0, "image placement names the new layer");

const renamed = payload(await call("studio_rename", { name: "MCP Roundtrip" }));
ok(renamed.project === "MCP Roundtrip", "project rename works");

const font = payload(
  await call("font_register", {
    path: "C:/Windows/Fonts/arial.ttf",
    family: "Smoke Sans",
  }),
);
ok(font.families.includes("Smoke Sans"), "registered font alias is listed");
const fontDraw = payload(
  await call("text_draw", {
    text: "Registered font",
    x: 60,
    y: 60,
    fontFamily: "Smoke Sans",
    fontSize: 36,
    color: "#ffffff",
  }),
);
ok(Boolean(fontDraw.layerId), "text draws with a registered font");

const moved = payload(
  await call("layer_move", { layer: placedSmall.id, direction: "down" }),
);
ok(moved.index === placedSmall.index - 1, "layer move changes the stacking index");

const invalid = await client.callTool({
  name: "brush_stroke",
  arguments: { points: [{ x: 10, y: 10 }], color: "not-a-color" },
});
ok(invalid.isError === true, "invalid input is reported as a tool error");

await call("studio_new_canvas", { width: 240, height: 240, background: "#000000" });
await call("brush_stroke", {
  points: [{ x: 120, y: 120 }],
  color: "#ff0000",
  size: 120,
  hardness: 1,
  flow: 1,
  opacity: 1,
  spacing: 0.1,
});
const colorPreview = await call("studio_preview", { maxWidth: 240 });
const colorImage = (colorPreview.content ?? []).find(
  (entry) => entry.type === "image",
);
const colorBitmap = await loadImage(Buffer.from(colorImage.data, "base64"));
const colorCanvas = createCanvas(colorBitmap.width, colorBitmap.height);
const colorCtx = colorCanvas.getContext("2d");
colorCtx.drawImage(colorBitmap, 0, 0);
const [red, green, blue] = colorCtx.getImageData(
  Math.floor(colorBitmap.width / 2),
  Math.floor(colorBitmap.height / 2),
  1,
  1,
).data;
ok(
  red > 200 && green < 60 && blue < 60,
  "brush color is applied to the stroke",
  `center pixel was rgb(${red}, ${green}, ${blue})`,
);

const legacyPath = join(outDir, "legacy.marsam");
await writeFile(
  legacyPath,
  JSON.stringify({
    app: "marsam",
    version: 1,
    name: "Legacy",
    doc: { width: 320, height: 200, background: "#101010", transparent: false },
    activeIndex: 0,
    layers: [
      {
        name: "Layer 1",
        visible: true,
        opacity: 1,
        blend: "source-over",
        image: null,
      },
    ],
  }),
  "utf8",
);
const legacy = payload(await call("project_open", { path: legacyPath }));
ok(
  legacy.pages.length === 1 && legacy.width === 320 && legacy.height === 200,
  "version 1 projects open as a single page",
);

await client.close();

console.log(`\nAll ${checks} checks passed.`);
console.log(`Artifacts: ${outDir}`);
