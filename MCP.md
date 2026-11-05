# Marsam MCP

This copy of Marsam ships a **Model Context Protocol** server that exposes the
painting studio to AI clients. An agent can create a canvas, paint with the same
brush engine as the web app, compose layers, place images, preview the result
and export images or `.marsam` project files — without opening a browser.

The original studio (`apps/web`) is untouched; this folder is the MCP edition.

```
apps/mcp/
├─ app/ components/ lib/     the web studio (same UI as the original)
├─ run.bat                   start the web studio
├─ run-mcp.bat               start the MCP server over stdio
└─ mcp/                      the MCP server package
   ├─ src/engine.ts          headless document engine (@napi-rs/canvas)
   ├─ src/brush.ts           brush stamps, presets and falloff
   ├─ src/project.ts         .marsam format validation
   ├─ src/server.ts          MCP tools
   ├─ scripts/smoke.mjs      end-to-end test over stdio
   └─ dist/                  compiled server (npm run build)
```

## Setup

```powershell
cd marsam-mcp
npm install                 # the web studio
npm run mcp:install         # the MCP server package
npm run mcp:build           # compile mcp/src to mcp/dist
```

## Connect a client

Add the server to any MCP client (Claude Desktop, Cursor, VS Code, a custom SDK
client…). Prefer running `node` directly:

```json
{
  "mcpServers": {
    "marsam": {
      "command": "node",
      "args": [
        "C:\\path\\to\\marsam-mcp\\mcp\\dist\\server.js"
      ],
      "env": {
        "MARSAM_MCP_OUTPUT_DIR": "C:\\path\\to\\marsam-mcp\\output"
      }
    }
  }
}
```

`run-mcp.bat` is an alternative command: it installs dependencies and builds
the server on first launch, then runs it. Do not double-click it — a stdio MCP
server waits for JSON-RPC on stdin.

Environment variables:

| Variable | Meaning |
| --- | --- |
| `MARSAM_MCP_OUTPUT_DIR` | Base directory for relative output paths. Defaults to the server's working directory. |

## Tools

### Canvas

| Tool | What it does |
| --- | --- |
| `studio_new_canvas` | New project with one page (width, height, background, transparency, project name). |
| `studio_info` | Pages, active page, canvas settings, every layer with id/name/visibility/opacity/blend, active layer, undo state, last brush. |
| `studio_preview` | Renders a page to PNG **image content** (default max width 1400 px, optional `page`). |
| `studio_resize_canvas` | Resize the active page with center/start anchoring, keeping or clearing content. |
| `studio_set_background` | Background color and/or transparency of the active page. |
| `studio_rename` | Project name used for default file names. |

### Pages

A project holds up to 24 pages. Each page has its own canvas size, background,
layers and undo history. Page changes are not undoable.

| Tool | What it does |
| --- | --- |
| `page_list` | Every page with index, name, size, layer count and the active flag. |
| `page_add` | Append a blank page and activate it (name, size, background optional). |
| `page_select` | Activate a page by 0-based index. Every later call targets it. |
| `page_duplicate` | Copy a page with all layers and pixels, insert after it, activate the copy. |
| `page_delete` | Delete a page (the last one is protected). |
| `page_rename` | Rename a page. |

### Layers (ordered bottom → top)

| Tool | What it does |
| --- | --- |
| `layer_add` | Transparent layer above the active one. |
| `layer_update` | Name, visibility, opacity, blend mode. |
| `layer_delete` | Delete a layer (the last one is protected). |
| `layer_merge_down` | Merge into the layer below, honoring opacity and blend. |
| `layer_move` | Move one step `up` or `down`. |
| `layer_select` | Change the active layer. |
| `layer_fill` | Solid fill across the layer. |
| `layer_clear` | Make the layer transparent. |

### Drawing

| Tool | What it does |
| --- | --- |
| `brush_stroke` | Stamp a stroke through points with size, hardness, flow, opacity, spacing, smoothing, pressure, symmetry, presets and `erase` mode. |
| `shape_draw` | Line, rectangle or ellipse with fill and/or stroke. |
| `text_draw` | Multi-line text with family, size, weight, italic, align, baseline, line height and max width. |
| `image_place` | Place a local file, data URL or http(s) image as a new layer, with contain/cover/stretch, rotation and opacity. |
| `studio_undo` / `studio_redo` | 25-step per-page history (one call = one step). |

### Files and fonts

| Tool | What it does |
| --- | --- |
| `studio_export` | PNG, JPEG or WebP at a scale or exact width; choose `page` or `allPages`. |
| `project_save` | Write the full project — every page — as a `.marsam` file. |
| `project_open` | Reopen a `.marsam` project (all pages, canvases, layers, blend modes, active page). Version 1 files open as one page. |
| `font_register` | Load a `.ttf`/`.otf` file for `text_draw`. |
| `font_list` | List available font families. |

Every mutating tool returns the affected layer or the new document info, and
every tool error comes back as an MCP tool error with a readable message.

## Example session

1. `studio_new_canvas` `{ "width": 1920, "height": 1080, "background": "#0f0f0f", "name": "Harbor at dusk" }`
2. `layer_add` `{ "name": "Sky" }` then `layer_fill` `{ "color": "#1f2a44" }`
3. `brush_stroke` with a warm color for the horizon glow
4. `shape_draw` for the sun, `text_draw` for a caption
5. `studio_preview` to check the composition visually
6. `studio_export` `{ "format": "png", "path": "harbor.png", "width": 2400 }`
7. `page_add` `{ "name": "Detail", "width": 1920, "height": 1080 }` for a second screen
8. `project_save` `{ "path": "harbor.marsam" }` — both pages in one file

## Sharing work with the studio UI

`.marsam` is the same JSON format the web app reads and writes, so:

- paint with MCP → `project_save` → open the file in the studio (`Ctrl+O`) to
  keep working by hand;
- draw in the studio → `Ctrl+Shift+S` → `project_open` in MCP to keep working
  with an agent.

Layer pixels are embedded as PNG data URLs, so project files are
self-contained. Pages travel with the file: the studio shows them in the page
strip under the canvas, and a project saved there reopens in MCP with the same
pages and active index. `.marsam` version 1 files (one canvas) still open in
both directions and are saved back as version 2.

## Test

```powershell
cd mcp
npm run build
npm run smoke
```

The smoke test launches the real stdio server, lists tools, paints a stroke,
draws a shape and text, checks preview image content, exports PNG/JPEG, saves
and reopens a v2 project, adds/duplicates/renames/deletes pages, exports every
page, reopens a version 1 file as one page, and exercises undo/redo and layer
operations.

## Watch it paint (live demo)

```powershell
cd mcp
npm run build
node scripts/live-demo.mjs      # open the printed URL (default 4310)
```

The script starts a real stdio MCP session, paints an artwork one tool call at
a time, and streams each rendered frame to a small viewer over SSE. Every frame
on screen is the result of an actual `studio_preview` call, and the sidebar logs
the tool call that produced it. Reload the page to replay from an empty canvas.

`node scripts/demo-session.mjs` is the same painting without the viewer: it
writes a PNG and a `.marsam` into `output/` and exits.

## Limits and scope

- Canvas `64–6000` px per side and 40 million pixels per page; 24 pages; 40
  layers per page; 25 undo steps per page; exports up to `16000` px per side;
  project files up to 400 MB.
- One project per server process. Use `project_save` / `project_open` to keep
  work between sessions — there is no autosave.
- Page structure (add, duplicate, delete, rename) is not undoable. Drawing,
  layers and canvas changes are undoable per page.
- The server is **stdio only** and does not drive an open browser tab. It edits
  its own headless document; the web studio stays a separate client that shares
  files with it.
- Layer text, shapes and brush strokes are rasterized on a layer, exactly like
  the web app: there is no editable text or vector object model.
- Network access is only used by `image_place` when the source is an http(s)
  URL.
