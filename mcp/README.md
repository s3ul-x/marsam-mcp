# @marsam/mcp

The Model Context Protocol server for the Marsam painting studio. It runs the
studio's painting model headlessly on Node with `@napi-rs/canvas` and exposes
31 tools for canvas setup, pages, layers, brush/shape/text drawing, image
placement, undo/redo, preview, export and `.marsam` projects.

```powershell
npm install
npm run build
npm run smoke     # end-to-end test over stdio

node dist/server.js
```

Setup, client configuration and the full tool reference live in
[../MCP.md](../MCP.md). The server speaks stdio only; keep stdout clean and
expect diagnostics on stderr.
