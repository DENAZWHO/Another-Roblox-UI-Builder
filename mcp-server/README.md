# UI Builder MCP server

Gives an AI agent direct, live access to the UI you're building, instead of trading screenshots.
It reads the document the editor pushes — every node's class, name, properties, and the **computed
absolute rect** the editor renders (`w×h @ x,y`) — and writes property edits back through the same
channel the Studio plugin uses, so changes show up in the editor within ~1 second.

It's a thin client over the dev server's existing `/api/studio` bridge; no new ports, no API keys.

## Requirements

- The UI Builder running (`npm run dev` in the repo root).
- **Live Sync on** in the editor (or press "Send to Studio" once). The MCP reads the last pushed
  document, so with Live Sync off it'll see a stale tree or none at all.
- Node 20+.

## Install & run

```bash
cd mcp-server
npm install
node index.mjs        # or: npm start
```

It speaks MCP over stdio and talks to the dev server at `http://localhost:5173`. If yours runs on
another port, set `UIB_URL`:

```bash
UIB_URL=http://localhost:3000 node index.mjs
```

## Connect it to Claude

The agent doesn't launch this itself — you register it as a **local MCP server in the Claude desktop
app**, which then makes its tools available to your session (including a cloud session linked to this
computer).

In the desktop app's MCP/connectors settings, add a server with:

```json
{
  "mcpServers": {
    "uib": {
      "command": "node",
      "args": ["C:\\Users\\denaz\\OneDrive\\Documents\\GitHub\\Another-Roblox-UI-Builder\\mcp-server\\index.mjs"],
      "env": { "UIB_URL": "http://localhost:5173" }
    }
  }
}
```

(Use the absolute path to `index.mjs` on your machine. `npm install` in `mcp-server/` first so the
dependencies are present.) Once it's connected, the agent sees tools named `uib_*`.

## Tools

| Tool | What it does |
|---|---|
| `uib_get_document` | The whole tree: name, class, id, and rect per node. Start here. |
| `uib_find_nodes` | Find nodes by a name substring (and optional class). |
| `uib_get_node` | One node's full properties, rect, parent, and children. |
| `uib_get_layout` | Computed rects for a node and its descendants — for debugging sizing/position. |
| `uib_set_properties` | Change a node's properties live (Size, Position, AnchorPoint, AutomaticSize, colors, Name…). |
| `uib_add_node` | Create a node under a parent (and set props in the same call); returns its id. |
| `uib_delete_node` | Delete a node and its descendants (not a root ScreenGui). |
| `uib_move_node` | Re-parent and/or reorder a node among its siblings. |

Reads are fresh after writes: the editor mirrors its document on every change (including edits the
agent makes), so `uib_set_properties` / `uib_add_node` etc. confirm themselves and a follow-up read
reflects the change within ~1s.

### Structural edits

`uib_add_node` / `uib_delete_node` / `uib_move_node` let the agent change the tree, not just values —
e.g. swap a frame's `UIGridLayout` for a `UIListLayout`:

1. `uib_delete_node` the `UIGridLayout`.
2. `uib_add_node` a `UIListLayout` under the frame, with `props` like
   `{ "FillDirection": "Horizontal", "HorizontalAlignment": "Center", "Padding": { "scale": 0, "offset": 12 } }`.
3. `uib_move_node` to set child order.

MCP edits apply in the **editor** (the web app). They reach Studio when you sync as usual.

### Value shapes for `uib_set_properties`

Friendly values, encoded using each property's existing type on the node (so the property must
already exist on it — `uib_get_node` lists what's there):

- number / bool / string — as-is
- enum — the value name: `"None"`, `"X"`, `"Center"`
- `Color3` — `"#RRGGBB"`
- `UDim2` — `{ "x": { "scale": 0, "offset": 120 }, "y": { "scale": 0, "offset": 48 } }`
- `UDim` — `{ "scale": 0, "offset": 8 }`
- `Vector2` — `{ "x": 0.5, "y": 0.5 }`
- `Name` — rename the node

## How it fits the repo

- `vite.config.ts` — adds `GET /api/studio/doc`, returning the latest pushed document.
- `src/sync.ts` — `buildWire` now includes a `layout` map (`id → [x, y, w, h]`) of computed rects,
  so the geometry the editor shows travels with the tree.
- `mcp-server/` — this server. Standalone; nothing else imports it.
