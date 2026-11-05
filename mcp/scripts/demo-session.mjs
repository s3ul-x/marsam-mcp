/**
 * Live demo session: paints a small poster through the real stdio MCP server.
 * Run with: node scripts/demo-session.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "..", "output");
await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "server.js")],
  cwd: root,
  stderr: "inherit",
  env: { ...process.env, MARSAM_MCP_OUTPUT_DIR: outDir },
  maxBufferSize: 64 * 1024 * 1024,
});

const client = new Client({ name: "marsam-demo", version: "0.1.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    throw new Error(`${name}: ${text}`);
  }
  const item = (result.content ?? []).find((entry) => entry.type === "text");
  return item ? JSON.parse(item.text) : null;
}

const log = (label, value) => console.log(`${label}:`, value);

await call("studio_new_canvas", {
  width: 1920,
  height: 1080,
  background: "#0f0f0f",
  name: "Harbor at Dusk",
});
log("canvas", "1920x1080");

// Sky
await call("layer_add", { name: "Sky" });
await call("layer_fill", { color: "#131a2e" });

// Warm glow around the sun
await call("layer_add", { name: "Glow" });
for (const [x, y, size, opacity] of [
  [1400, 300, 400, 0.28],
  [1210, 300, 400, 0.2],
  [1590, 300, 400, 0.2],
  [1400, 120, 400, 0.16],
  [1400, 460, 380, 0.24],
  [1240, 400, 320, 0.18],
  [1580, 400, 320, 0.18],
]) {
  await call("brush_stroke", {
    points: [{ x, y }],
    color: "#e8a33d",
    size,
    hardness: 0.01,
    flow: 0.5,
    opacity,
    spacing: 0.5,
  });
}
await call("layer_update", { layer: "Glow", blend: "screen" });

// Sun
await call("layer_add", { name: "Sun" });
await call("shape_draw", {
  shape: "ellipse",
  x1: 1300,
  y1: 200,
  x2: 1500,
  y2: 400,
  fill: "#f0d264",
  stroke: "#f8e6a0",
  lineWidth: 3,
});

// Distant ridge
await call("layer_add", { name: "Ridge" });
await call("brush_stroke", {
  points: [
    { x: -40, y: 600 },
    { x: 180, y: 505 },
    { x: 320, y: 548 },
    { x: 470, y: 462 },
    { x: 620, y: 530 },
    { x: 760, y: 496 },
    { x: 900, y: 560 },
    { x: 1080, y: 500 },
    { x: 1230, y: 548 },
    { x: 1400, y: 496 },
    { x: 1560, y: 540 },
    { x: 1720, y: 502 },
    { x: 1960, y: 552 },
  ],
  color: "#080d1a",
  size: 96,
  hardness: 1,
  flow: 1,
  opacity: 1,
  spacing: 0.05,
  smoothing: 0.45,
});

// Water
await call("layer_add", { name: "Water" });
await call("shape_draw", {
  shape: "rect",
  x1: 0,
  y1: 632,
  x2: 1920,
  y2: 1080,
  fill: "#0a1020",
});
await call("layer_update", { layer: "Water", opacity: 0.94 });

// Sun reflection
await call("layer_add", { name: "Reflection" });
const streaks = [
  [1330, 690, 1470, 690, 10, 0.75, "#f0d264"],
  [1300, 726, 1500, 726, 8, 0.6, "#e8a33d"],
  [1352, 764, 1448, 764, 6, 0.45, "#e8a33d"],
  [1284, 806, 1516, 806, 5, 0.3, "#e8a33d"],
  [1370, 852, 1430, 852, 4, 0.22, "#f0d264"],
  [1250, 900, 1550, 900, 3, 0.14, "#e8a33d"],
];
for (const [x1, y1, x2, y2, lineWidth, opacity, stroke] of streaks) {
  await call("shape_draw", {
    shape: "line",
    x1,
    y1,
    x2,
    y2,
    stroke,
    lineWidth,
    opacity,
  });
}

// Title block
await call("layer_add", { name: "Title" });
await call("text_draw", {
  text: "HARBOR AT DUSK",
  x: 120,
  y: 108,
  fontSize: 58,
  weight: 600,
  color: "#f6f3ec",
});
await call("text_draw", {
  text: "painted entirely through the Marsam MCP server",
  x: 122,
  y: 186,
  fontSize: 24,
  color: "#9aa0ad",
});
await call("shape_draw", {
  shape: "line",
  x1: 122,
  y1: 238,
  x2: 640,
  y2: 238,
  stroke: "#e8a33d",
  lineWidth: 3,
  opacity: 0.9,
});

// Stamp of provenance in the corner
await call("text_draw", {
  text: "25 tools · 9 layers · stdio",
  x: 1800,
  y: 1010,
  fontSize: 20,
  align: "right",
  color: "#6f7482",
});

const info = await call("studio_info");
log("layers", info.layers.map((layer) => `${layer.name}(${layer.blend})`).join(", "));
log("history", info.history);

const preview = await client.callTool({
  name: "studio_preview",
  arguments: { maxWidth: 1400 },
});
const image = (preview.content ?? []).find((entry) => entry.type === "image");
if (!image) throw new Error("no preview image");
const previewPath = join(outDir, "harbor-preview.png");
const { writeFile } = await import("node:fs/promises");
await writeFile(previewPath, Buffer.from(image.data, "base64"));
log("preview", `${previewPath} (${Math.round(image.data.length * 0.75 / 1024)} KB)`);

const exported = await call("studio_export", {
  format: "png",
  path: "harbor-dusk.png",
  width: 1920,
});
log("export", exported);

const project = await call("project_save", { path: "harbor-dusk.marsam" });
log("project", project);

await client.close();
