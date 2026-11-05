/**
 * Live MCP viewer.
 *
 * Runs a real stdio MCP session against the Marsam server and broadcasts a
 * rendered frame plus the tool call that produced it, over Server-Sent Events.
 * Open http://localhost:4173 and the painting starts as soon as the page loads.
 *
 * Run: node scripts/live-demo.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "..", "output");
const PORT = Number(process.env.LIVE_PORT ?? 4280);
const FRAME_MS = Number(process.env.LIVE_FRAME_MS ?? 420);

await mkdir(outDir, { recursive: true });

// ------------------------------------------------------------------ transport

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "server.js")],
  cwd: root,
  stderr: "inherit",
  env: { ...process.env, MARSAM_MCP_OUTPUT_DIR: outDir },
  maxBufferSize: 64 * 1024 * 1024,
});
const client = new Client({ name: "marsam-live", version: "0.1.0" });
await client.connect(transport);

async function tool(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = (result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    throw new Error(`${name}: ${text}`);
  }
  const item = (result.content ?? []).find((entry) => entry.type === "text");
  return { raw: result, data: item ? JSON.parse(item.text) : null };
}

// -------------------------------------------------------------------- viewer

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Marsam MCP — live</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; overflow: hidden;
    background: #0b0b0c; color: #e7e7ea;
    font: 13px/1.45 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  }
  #stage {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 28px; position: relative;
    background: radial-gradient(1200px 600px at 50% 40%, #14151a 0%, #0b0b0c 70%);
  }
  #frame {
    max-width: 100%; max-height: 100%; display: block;
    border: 1px solid #26272e; border-radius: 6px;
    box-shadow: 0 24px 70px rgba(0,0,0,.55);
    transition: opacity .25s ease;
  }
  #badge {
    position: absolute; top: 14px; left: 20px; display: flex; align-items: center;
    gap: 8px; font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
    color: #8a8f9c;
  }
  #dot { width: 7px; height: 7px; border-radius: 50%; background: #d95b43; }
  #dot.live { background: #57c98d; box-shadow: 0 0 0 0 rgba(87,201,141,.6); animation: pulse 1.8s infinite; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(87,201,141,.55); }
    70% { box-shadow: 0 0 0 9px rgba(87,201,141,0); }
    100% { box-shadow: 0 0 0 0 rgba(87,201,141,0); }
  }
  aside {
    width: 330px; border-left: 1px solid #22232a; display: flex; flex-direction: column;
    background: #0e0e11;
  }
  aside header {
    padding: 16px 16px 12px; border-bottom: 1px solid #1d1e24;
  }
  aside h1 { margin: 0 0 2px; font-size: 13px; letter-spacing: .04em; }
  aside p { margin: 0; font-size: 11px; color: #7c818e; }
  #log { flex: 1; overflow: auto; padding: 10px 0; }
  .row {
    display: grid; grid-template-columns: 22px 1fr; gap: 8px;
    padding: 5px 14px; animation: in .2s ease;
  }
  @keyframes in { from { opacity: 0; transform: translateY(3px); } }
  .n { color: #4d5261; font-variant-numeric: tabular-nums; font-size: 10px; padding-top: 2px; }
  .name { color: #e2b264; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
  .args { color: #8a8f9c; font-size: 10.5px; word-break: break-word; }
  .row.done .name { color: #57c98d; }
  footer {
    padding: 10px 16px; border-top: 1px solid #1d1e24; font-size: 11px; color: #6f7482;
    display: flex; justify-content: space-between;
  }
</style>
</head>
<body>
  <div id="stage">
    <div id="badge"><span id="dot"></span><span id="state">connecting…</span></div>
    <img id="frame" alt="live canvas" style="opacity:0">
  </div>
  <aside>
    <header>
      <h1>Marsam MCP — live session</h1>
      <p>Every frame is a real tool call over stdio.</p>
    </header>
    <div id="log"></div>
    <footer><span id="count">0 calls</span><span id="layers"></span></footer>
  </aside>
<script>
  const img = document.getElementById('frame');
  const log = document.getElementById('log');
  const state = document.getElementById('state');
  const dot = document.getElementById('dot');
  const count = document.getElementById('count');
  const layers = document.getElementById('layers');
  let n = 0;

  function row(index, tool, args, done) {
    const el = document.createElement('div');
    el.className = 'row' + (done ? ' done' : '');
    el.innerHTML = '<div class="n">' + index + '</div><div><div class="name">' + tool +
      '</div><div class="args">' + (args || '') + '</div></div>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  const es = new EventSource('/stream');
  es.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'frame') {
      img.src = 'data:image/png;base64,' + msg.image;
      img.style.opacity = '1';
      n += 1;
      count.textContent = n + ' calls';
      if (msg.layers) layers.textContent = msg.layers + ' layers';
      row(n, msg.tool, msg.args, false);
      dot.classList.add('live');
    }
    if (msg.type === 'status') state.textContent = msg.text;
    if (msg.type === 'done') {
      state.textContent = msg.text;
      dot.classList.remove('live');
      img.src = 'data:image/png;base64,' + msg.image;
    }
  };
  es.onerror = () => { state.textContent = 'disconnected'; dot.classList.remove('live'); };
</script>
</body>
</html>`;

const clients = new Set();
let last = null;

function broadcast(payload) {
  for (const res of clients) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer((req, res) => {
  if (req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    clients.add(res);
    if (last) res.write(`data: ${JSON.stringify(last)}\n\n`);
    req.on("close", () => clients.delete(res));
    if (!started || finished) {
      started = true;
      finished = false;
      paint()
        .then(() => {
          finished = true;
        })
        .catch((error) => {
          console.error(error);
          finished = true;
          broadcast({ type: "status", text: "error: " + error.message });
        });
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

let started = false;
let finished = false;

// ------------------------------------------------------------------ painting

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function frame(toolName, args, options = {}) {
  const preview = await client.callTool({
    name: "studio_preview",
    arguments: { maxWidth: options.maxWidth ?? 1200 },
  });
  const image = (preview.content ?? []).find((entry) => entry.type === "image");
  if (!image) throw new Error("preview returned no image");
  const info = (preview.content ?? []).find((entry) => entry.type === "text");
  const meta = info ? JSON.parse(info.text) : null;
  last = {
    type: "frame",
    image: image.data,
    tool: toolName,
    args,
    layers: meta?.layers?.length ?? null,
  };
  broadcast(last);
  await sleep(options.delay ?? FRAME_MS);
}

function shortArgs(value) {
  if (value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 130 ? `${text.slice(0, 127)}…` : text;
}

/** Calls a tool, redraws, and logs it. */
async function step(toolName, args, note, options) {
  const { data } = await tool(toolName, args);
  await frame(toolName, note ?? shortArgs(args), options);
  return data;
}

function ridgePoints(yBase, amplitude, phase, cramped) {
  const points = [];
  for (let x = -60; x <= 1980; x += 40) {
    const y =
      yBase +
      Math.sin(x / (260 + cramped) + phase) * amplitude +
      Math.sin(x / 97 + phase * 2.1) * amplitude * 0.34 +
      Math.sin(x / 41 + phase * 3.7) * amplitude * 0.12;
    points.push({ x, y: Math.round(y * 10) / 10 });
  }
  return points;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function paint() {
  broadcast({ type: "status", text: "painting…" });

  await step(
    "studio_new_canvas",
    { width: 1920, height: 1080, background: "#070910", name: "Aurora over the Fjord" },
    "1920×1080 · #070910",
  );

  await step("layer_add", { name: "Sky" }, "name: Sky");
  await step("layer_fill", { layer: "Sky", color: "#0b1226" }, "#0b1226");

  // ---- aurora ribbons
  await step("layer_add", { name: "Aurora" }, "name: Aurora");
  const ribbons = [
    { color: "#2fae9b", y: 300, amp: 90, size: 260, opacity: 0.45 },
    { color: "#3f6fbf", y: 380, amp: 70, size: 300, opacity: 0.4 },
    { color: "#7a4fb0", y: 250, amp: 120, size: 220, opacity: 0.28 },
    { color: "#57c98d", y: 430, amp: 55, size: 200, opacity: 0.22 },
  ];
  for (const ribbon of ribbons) {
    const points = ridgePoints(ribbon.y, ribbon.amp, 0.8, 900).filter((_, i) => i % 4 === 0);
    await step(
      "brush_stroke",
      {
        points,
        layer: "Aurora",
        color: ribbon.color,
        size: ribbon.size,
        hardness: 0.02,
        flow: 0.35,
        opacity: ribbon.opacity,
        spacing: 0.06,
        smoothing: 0.6,
      },
      `${ribbon.color} · ${ribbon.size}px soft`,
    );
  }
  // brighter, narrower curtains on top of the haze
  for (const [index, color] of ["#8ff0c8", "#a8c8ff", "#c8a8ff"].entries()) {
    const points = ridgePoints(250 + index * 55, 110 - index * 20, 1.9 + index, 620).filter(
      (_, i) => i % 5 === 0,
    );
    await step(
      "brush_stroke",
      {
        points,
        layer: "Aurora",
        color,
        size: 54,
        hardness: 0.25,
        flow: 0.55,
        opacity: 0.5,
        spacing: 0.08,
        smoothing: 0.7,
      },
      `${color} · 54px curtain`,
    );
  }
  await step("layer_update", { layer: "Aurora", blend: "screen" }, "Aurora → Screen");

  // ---- stars (one dab per call: a stroke joins its points)
  await step("layer_add", { name: "Stars" }, "name: Stars");
  const starSeed = [
    [140, 120], [310, 78], [470, 190], [620, 96], [760, 160], [900, 70],
    [1040, 150], [1180, 96], [1330, 180], [1470, 64], [1610, 130], [1740, 88],
    [1850, 170], [220, 300], [380, 360], [540, 280], [700, 420], [860, 330],
  ];
  for (const [x, y] of starSeed) {
    await step(
      "brush_stroke",
      {
        points: [{ x, y }],
        layer: "Stars",
        color: "#eef1f6",
        size: 3.5,
        hardness: 1,
        flow: 1,
        opacity: 0.8,
        spacing: 0.4,
      },
      `star · ${x},${y}`,
      { delay: 130 },
    );
  }

  // ---- moon
  await step("layer_add", { name: "Moon" }, "name: Moon");
  await step(
    "brush_stroke",
    {
      points: [{ x: 1580, y: 230 }],
      layer: "Moon",
      color: "#cfd8ff",
      size: 400,
      hardness: 0.01,
      flow: 0.4,
      opacity: 0.3,
      spacing: 0.5,
    },
    "moon halo · 400px",
  );
  await step("layer_update", { layer: "Moon", blend: "screen" }, "Moon → Screen");
  await step(
    "shape_draw",
    {
      shape: "ellipse",
      x1: 1512,
      y1: 162,
      x2: 1668,
      y2: 318,
      fill: "#eef1e4",
      stroke: "#ffffff",
      lineWidth: 2,
    },
    "ellipse · #eef1e4",
  );

  // ---- ridges
  const ridges = [
    { name: "RidgeFar", y: 520, amp: 34, phase: 0.4, color: "#182238", size: 96 },
    { name: "RidgeMid", y: 610, amp: 48, phase: 2.1, color: "#0d1526", size: 120 },
    { name: "RidgeNear", y: 740, amp: 62, phase: 4.3, color: "#05080f", size: 150 },
  ];
  for (const ridge of ridges) {
    await step("layer_add", { name: ridge.name }, `name: ${ridge.name}`);
    const points = ridgePoints(ridge.y, ridge.amp, ridge.phase, 0);
    const groups = chunk(points, 14);
    let drawn = [];
    for (let i = 0; i < groups.length; i += 1) {
      drawn = drawn.concat(groups[i]);
      if (i < groups.length - 1) drawn.push(groups[i + 1][0]);
      await step(
        "brush_stroke",
        {
          points: drawn.slice(-16),
          layer: ridge.name,
          color: ridge.color,
          size: ridge.size,
          hardness: 1,
          flow: 1,
          opacity: 1,
          spacing: 0.05,
          smoothing: 0.35,
        },
        `${ridge.color} · ${ridge.size}px · ${Math.round(((i + 1) / groups.length) * 100)}%`,
      );
    }
  }

  // ---- water
  await step("layer_add", { name: "Fjord" }, "name: Fjord");
  await step(
    "shape_draw",
    { shape: "rect", x1: 0, y1: 782, x2: 1920, y2: 1080, fill: "#060a16" },
    "rect · #060a16",
  );
  await step("layer_update", { layer: "Fjord", opacity: 0.9 }, "opacity 90%");

  await step("layer_add", { name: "Glitter" }, "name: Glitter");
  const glints = [
    [1480, 820, 1660, 820, 9, 0.55],
    [1450, 862, 1700, 862, 7, 0.45],
    [1500, 902, 1640, 902, 6, 0.35],
    [1420, 944, 1730, 944, 5, 0.25],
    [1490, 986, 1650, 986, 4, 0.18],
    [1380, 1026, 1760, 1026, 3, 0.12],
  ];
  for (const [x1, y1, x2, y2, lineWidth, opacity] of glints) {
    await step(
      "shape_draw",
      { shape: "line", x1, y1, x2, y2, stroke: "#cfd8ff", lineWidth, opacity },
      `line · ${lineWidth}px · ${Math.round(opacity * 100)}%`,
    );
  }

  // ---- caption
  await step("layer_add", { name: "Caption" }, "name: Caption");
  await step(
    "text_draw",
    {
      text: "AURORA OVER THE FJORD",
      x: 120,
      y: 104,
      fontSize: 46,
      weight: 600,
      color: "#f2f4f8",
      layer: "Caption",
    },
    "46px · 600",
  );
  await step(
    "shape_draw",
    {
      shape: "line",
      x1: 122,
      y1: 178,
      x2: 520,
      y2: 178,
      stroke: "#2fae9b",
      lineWidth: 3,
      opacity: 0.9,
      layer: "Caption",
    },
    "rule · #2fae9b",
  );
  await step(
    "text_draw",
    {
      text: "painted live through the Marsam MCP server",
      x: 122,
      y: 200,
      fontSize: 21,
      color: "#9aa0ad",
      layer: "Caption",
    },
    "21px caption",
  );

  const info = (await tool("studio_info")).data;
  const exported = (await tool("studio_export", {
    format: "png",
    path: "aurora-live.png",
    width: 1920,
  })).data;
  const project = (await tool("project_save", { path: "aurora-live.marsam" })).data;

  const final = await client.callTool({
    name: "studio_preview",
    arguments: { maxWidth: 1600 },
  });
  const image = (final.content ?? []).find((entry) => entry.type === "image");
  broadcast({
    type: "done",
    text: `done · ${info.history} calls · ${exported.bytes} B`,
    image: image.data,
  });
  console.log("exported:", exported.path, exported.bytes);
  console.log("project :", project.path, project.bytes);
  broadcast({ type: "status", text: "finished" });
}

let bound = false;
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && !bound) {
    // The preferred port is busy; let the OS pick a free one.
    server.listen(0, () => {
      bound = true;
      console.log(`Live viewer: http://localhost:${server.address().port}`);
    });
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, () => {
  bound = true;
  console.log(`Live viewer: http://localhost:${PORT}`);
});
