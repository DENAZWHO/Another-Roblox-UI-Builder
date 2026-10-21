#!/usr/bin/env node
/**
 * MCP server for the Roblox UI Builder dev bridge.
 *
 * Reads the live document the editor pushes (every node's class, name, properties, and the
 * computed absolute rect the editor shows) and writes property edits back through the same
 * channel the Studio plugin uses — so an agent can inspect and adjust the UI directly instead
 * of trading screenshots.
 *
 * Run it alongside `npm run dev` (the UI Builder). It talks to the dev server over HTTP;
 * set UIB_URL if that isn't http://localhost:5173. Keep Live Sync on in the editor so the
 * document it reads stays current.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const BASE = (process.env.UIB_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const API = `${BASE}/api/studio`;
const CHARACTER_LIMIT = 25_000;

// ---------------------------------------------------------------------------
// Dev-server bridge client

async function fetchDoc() {
  let res;
  try {
    res = await fetch(`${API}/doc`, { headers: { "X-UI-Builder": "1" } });
  } catch {
    throw new Error(`Can't reach the UI Builder at ${BASE}. Start it with \`npm run dev\`, or set UIB_URL if it runs on another port.`);
  }
  if (res.status === 204) {
    throw new Error('The editor has not pushed a document yet. In the UI Builder, turn on Live Sync (or press "Send to Studio") once, then try again.');
  }
  if (!res.ok) throw new Error(`The UI Builder bridge returned HTTP ${res.status}.`);
  return res.json(); // { version, data: { format, roots, layout } }
}

async function postEdit(edit) {
  let res;
  try {
    res = await fetch(`${API}/edits`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-UI-Builder": "1" },
      body: JSON.stringify({ ...edit, source: "mcp" }),
    });
  } catch {
    throw new Error(`Can't reach the UI Builder at ${BASE}. Start it with \`npm run dev\`.`);
  }
  if (!res.ok) throw new Error(`The UI Builder bridge returned HTTP ${res.status} when applying the edit.`);
  return res.json();
}

/**
 * Force the Studio plugin's payload to the current document, so Studio reflects MCP edits without
 * the user pressing "Send to Studio". The plugin still has to be pulling (Live Sync on in Studio).
 * Best-effort — never fails a tool.
 */
async function syncStudio() {
  try {
    const { data } = await fetchDoc();
    await fetch(`${API}/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-UI-Builder": "1" },
      body: JSON.stringify(data),
    });
  } catch {
    /* dev server offline — ignore */
  }
}

// ---------------------------------------------------------------------------
// Document index

/** Flatten every root's tree into id -> { node, rootId, parentId, depth }, in DFS order. */
function indexDoc(data) {
  const index = new Map();
  const walk = (node, rootId, parentId, depth) => {
    index.set(node.i, { node, rootId, parentId, depth });
    for (const child of node.k ?? []) walk(child, rootId, node.i, depth + 1);
  };
  for (const root of data.roots ?? []) walk(root.tree, root.id, null, 0);
  return { index, layout: data.layout ?? {} };
}

function rectOf(layout, id) {
  const r = layout[id];
  return r ? { x: r[0], y: r[1], w: r[2], h: r[3] } : null;
}

function requireNode(index, id) {
  const hit = index.get(id);
  if (!hit) throw new Error(`No node with id "${id}". Use uib_find_nodes or uib_get_document to list ids.`);
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the live doc until predicate({ index, layout }) holds. Edits/ops apply in the editor within ~1s. */
async function waitForDoc(predicate, { timeout = 4000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  let data = null;
  for (;;) {
    try {
      ({ data } = await fetchDoc());
      if (predicate(indexDoc(data))) return data;
    } catch {
      /* transient — the dev server may be momentarily busy */
    }
    if (Date.now() >= deadline) return data;
    await sleep(interval);
  }
}

/** Poll until the mirror reports a newer document version (i.e. a change landed), then return it. */
async function waitForVersion(before, { timeout = 4000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let r = null;
    try {
      r = await fetchDoc();
    } catch {
      /* transient */
    }
    if (r && r.version > before) return r.data;
    if (Date.now() >= deadline) return r ? r.data : null;
    await sleep(interval);
  }
}

/** A fresh id in the app's format (base36, 8 chars) not already used. */
function genId(index) {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 10);
  } while (id.length < 6 || index.has(id));
  return id;
}

// ---------------------------------------------------------------------------
// Wire format <-> readable values

const clamp255 = (n) => Math.round(Math.max(0, Math.min(255, n)));
const hex2 = (n) => clamp255(n).toString(16).padStart(2, "0");
const rgbHex = (v) => `#${hex2(v[0])}${hex2(v[1])}${hex2(v[2])}`;
const hexRgb = (h) => {
  const n = parseInt(String(h).replace(/^#/, ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const num = (v, d = 0) => (v === undefined || v === null || Number.isNaN(Number(v)) ? d : Number(v));

function readable([type, v]) {
  switch (type) {
    case "UDim2": return { scale: { x: v[0], y: v[2] }, offset: { x: v[1], y: v[3] } };
    case "UDim": return { scale: v[0], offset: v[1] };
    case "Vector2": return { x: v[0], y: v[1] };
    case "Vector3": return { x: v[0], y: v[1], z: v[2] };
    case "Color3": return rgbHex(v);
    case "enum": return v[1];
    case "Font": return { family: v[0], weight: v[1], style: v[2] };
    case "Rect": return { min: { x: v[0], y: v[1] }, max: { x: v[2], y: v[3] } };
    default: return v; // string, bool, number, sequences
  }
}

function propsReadable(node) {
  const out = {};
  for (const [k, pair] of Object.entries(node.p ?? {})) out[k] = readable(pair);
  return out;
}

const isArr = Array.isArray;

/** Encode a friendly value to the wire format, using the prop's CURRENT type on the node. */
function encodeProp(node, prop, value) {
  const cur = node.p?.[prop];
  if (!cur) {
    throw new Error(`"${prop}" is not currently set on ${node.n} (${node.c}), so its type can't be inferred. Change it once in the editor, or set a property the node already has — uib_get_node lists them.`);
  }
  const type = cur[0];
  switch (type) {
    case "string": return ["string", String(value)];
    case "bool": return ["bool", !!value];
    case "number": return ["number", Number(value)];
    case "enum": return ["enum", [cur[1][0], String(value)]]; // keep enumType, replace the value name
    case "UDim2":
      if (isArr(value)) return ["UDim2", value.map(Number)];
      return ["UDim2", [
        num(value.x?.scale ?? value.scale?.x), num(value.x?.offset ?? value.offset?.x),
        num(value.y?.scale ?? value.scale?.y), num(value.y?.offset ?? value.offset?.y),
      ]];
    case "UDim":
      if (isArr(value)) return ["UDim", value.map(Number)];
      return ["UDim", [num(value.scale ?? value.s), num(value.offset ?? value.o)]];
    case "Vector2":
      if (isArr(value)) return ["Vector2", value.map(Number)];
      return ["Vector2", [num(value.x), num(value.y)]];
    case "Vector3":
      if (isArr(value)) return ["Vector3", value.map(Number)];
      return ["Vector3", [num(value.x), num(value.y), num(value.z)]];
    case "Color3":
      if (typeof value === "string") return ["Color3", hexRgb(value)];
      if (isArr(value)) return ["Color3", value.map(Number)];
      return ["Color3", [num(value.r), num(value.g), num(value.b)]];
    case "Rect":
      if (isArr(value)) return ["Rect", value.map(Number)];
      return ["Rect", [num(value.min?.x), num(value.min?.y), num(value.max?.x), num(value.max?.y)]];
    default:
      throw new Error(`Editing ${type} properties ("${prop}") isn't supported yet — change it in the editor directly.`);
  }
}

// ---------------------------------------------------------------------------
// Output helpers

const FORMAT = z.enum(["markdown", "json"]).default("markdown");

function text(s) {
  return { content: [{ type: "text", text: s }] };
}
function json(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

// ---------------------------------------------------------------------------
// Server

function createServer() {
  const server = new McpServer({ name: "uib-mcp-server", version: "1.0.0" });

  server.registerTool(
    "uib_get_document",
    {
      title: "Get UI document",
      description:
        "Return the whole UI tree the editor is showing: every node's name, class, id, and its computed absolute rect (w×h @ x,y in screen pixels). Use this first to orient, then uib_get_node for one node's full properties. Needs Live Sync on in the editor.",
      inputSchema: z.object({ response_format: FORMAT }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ response_format }) => {
      const { data } = await fetchDoc();
      const { index, layout } = indexDoc(data);
      if (response_format === "json") {
        const nodes = [];
        for (const [id, { node, rootId, parentId, depth }] of index) {
          nodes.push({ id, name: node.n, class: node.c, rootId, parentId, depth, rect: rectOf(layout, id) });
        }
        return json({ version: undefined, count: nodes.length, nodes });
      }
      const lines = [];
      for (const [id, { node, depth }] of index) {
        const r = rectOf(layout, id);
        lines.push(`${"  ".repeat(depth)}• ${node.n} [${node.c}] #${id}${r ? ` — ${r.w}×${r.h} @ (${r.x},${r.y})` : ""}`);
      }
      let out = lines.join("\n");
      if (out.length > CHARACTER_LIMIT) {
        out = out.slice(0, CHARACTER_LIMIT) + "\n… (truncated — use uib_find_nodes to narrow down)";
      }
      return text(out || "The document is empty.");
    }
  );

  server.registerTool(
    "uib_find_nodes",
    {
      title: "Find nodes",
      description:
        "Find nodes by a case-insensitive substring of their name (and optionally an exact class). Returns id, name, class, and rect for each match. Use when you know roughly what an element is called.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Substring to match against node names (and class names)."),
        className: z.string().optional().describe("Optional exact class filter, e.g. 'TextLabel'."),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, className, response_format }) => {
      const { data } = await fetchDoc();
      const { index, layout } = indexDoc(data);
      const q = query.toLowerCase();
      const hits = [];
      for (const [id, { node }] of index) {
        if (className && node.c !== className) continue;
        if (!node.n.toLowerCase().includes(q) && !node.c.toLowerCase().includes(q)) continue;
        hits.push({ id, name: node.n, class: node.c, rect: rectOf(layout, id) });
      }
      if (response_format === "json") return json({ count: hits.length, nodes: hits });
      if (!hits.length) return text(`No nodes match "${query}".`);
      return text(hits.map((h) => `• ${h.name} [${h.class}] #${h.id}${h.rect ? ` — ${h.rect.w}×${h.rect.h} @ (${h.rect.x},${h.rect.y})` : ""}`).join("\n"));
    }
  );

  server.registerTool(
    "uib_get_node",
    {
      title: "Get node",
      description:
        "Return one node's full properties (as readable values), its computed rect, parent id, and children (id + name). This is the detail view — Size/Position/AnchorPoint/AutomaticSize/BackgroundColor3 etc. all appear here with their current values.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Node id, from uib_get_document or uib_find_nodes."),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, response_format }) => {
      const { data } = await fetchDoc();
      const { index, layout } = indexDoc(data);
      const { node, rootId, parentId } = requireNode(index, id);
      const info = {
        id,
        name: node.n,
        class: node.c,
        rootId,
        parentId,
        rect: rectOf(layout, id),
        properties: propsReadable(node),
        children: (node.k ?? []).map((c) => ({ id: c.i, name: c.n, class: c.c })),
      };
      if (response_format === "json") return json(info);
      const lines = [
        `# ${info.name} [${info.class}] #${id}`,
        info.rect ? `rect: ${info.rect.w}×${info.rect.h} @ (${info.rect.x},${info.rect.y})` : "rect: (not laid out)",
        `parent: ${parentId ?? "(root)"}   root: ${rootId}`,
        "",
        "## Properties",
        ...Object.entries(info.properties).map(([k, v]) => `- ${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`),
      ];
      if (info.children.length) {
        lines.push("", "## Children", ...info.children.map((c) => `- ${c.name} [${c.class}] #${c.id}`));
      }
      return text(lines.join("\n"));
    }
  );

  server.registerTool(
    "uib_get_layout",
    {
      title: "Get layout rects",
      description:
        "Return computed absolute rects (w, h, x, y in screen pixels) for a node and all its descendants — the exact geometry the editor renders. Use this to debug sizing/position mismatches. Omit id for every node.",
      inputSchema: z.object({
        id: z.string().optional().describe("Root of the subtree to report. Omit for the whole document."),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, response_format }) => {
      const { data } = await fetchDoc();
      const { index, layout } = indexDoc(data);
      let ids;
      if (id) {
        requireNode(index, id);
        ids = [];
        const collect = (nid) => {
          ids.push(nid);
          const hit = index.get(nid);
          for (const c of hit?.node.k ?? []) collect(c.i);
        };
        collect(id);
      } else {
        ids = [...index.keys()];
      }
      const rows = ids.map((nid) => ({ id: nid, name: index.get(nid).node.n, class: index.get(nid).node.c, rect: rectOf(layout, nid) }));
      if (response_format === "json") return json({ count: rows.length, rects: rows });
      return text(rows.map((r) => `${r.rect ? `${String(r.rect.w).padStart(4)}×${String(r.rect.h).padStart(4)} @ (${r.rect.x},${r.rect.y})` : "   (no rect)   "}  ${r.name} [${r.class}] #${r.id}`).join("\n"));
    }
  );

  server.registerTool(
    "uib_set_properties",
    {
      title: "Set node properties",
      description:
        `Change one node's properties in the editor, live. Give the node id and a map of property -> value.
Values are friendly: numbers/booleans/strings as-is; enums as the value name ("None", "X", "Center"); Color3 as "#RRGGBB"; UDim2 as {x:{scale,offset},y:{scale,offset}}; UDim as {scale,offset}; Vector2 as {x,y}. Use "Name" to rename the node.
The property must already exist on the node (uib_get_node lists them) so its type is known. Edits apply in the editor within ~1s; with Live Sync on they show up in your next read.`,
      inputSchema: z.object({
        id: z.string().min(1).describe("Node id to edit."),
        props: z.record(z.string(), z.any()).describe('Property -> value map, e.g. {"AutomaticSize":"None","Size":{"x":{"scale":0,"offset":120},"y":{"scale":0,"offset":48}}}.'),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, props, response_format }) => {
      const doc0 = await fetchDoc();
      const { index } = indexDoc(doc0.data);
      const { node, rootId } = requireNode(index, id);

      const edit = { i: id, p: {} };
      const applied = {};
      for (const [prop, value] of Object.entries(props)) {
        if (prop === "Name") {
          edit.n = String(value);
          applied.Name = String(value);
          continue;
        }
        edit.p[prop] = encodeProp(node, prop, value); // throws an actionable error on an unknown prop/type
        applied[prop] = value;
      }

      await postEdit({ root: rootId, edits: [edit] });
      const after = await waitForVersion(doc0.version);
      await syncStudio();
      const nowNode = after ? indexDoc(after).index.get(id)?.node : null;
      const confirmed = !!nowNode;
      const current = nowNode
        ? Object.fromEntries(Object.keys(applied).filter((k) => k !== "Name").map((k) => [k, nowNode.p?.[k] ? readable(nowNode.p[k]) : undefined]))
        : {};

      const payload = { ok: true, id, applied, confirmed, current };
      if (response_format === "json") return json(payload);
      const lines = [`${confirmed ? "Applied" : "Queued"} on ${node.n} [${node.c}] #${id}:`];
      for (const [k, v] of Object.entries(applied)) lines.push(`- ${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`);
      if (!confirmed) lines.push("", "(Couldn't confirm from the live mirror — is the dev server running the updated code?)");
      return text(lines.join("\n"));
    }
  );

  server.registerTool(
    "uib_add_node",
    {
      title: "Add node",
      description:
        "Create a new node under a parent and optionally set properties on it in one call; returns the new id. Use this to add layout objects — e.g. add a UIListLayout to a frame so its children flow, or a UIPadding. The node starts with Roblox defaults for its class, then any `props` are applied (same value shapes as uib_set_properties).",
      inputSchema: z.object({
        parent: z.string().min(1).describe("Parent node id the new node is created under."),
        className: z.string().min(1).describe("Roblox class, e.g. 'UIListLayout', 'Frame', 'TextLabel', 'UIPadding', 'UICorner'."),
        name: z.string().optional().describe("Name for the node (defaults to the class name)."),
        index: z.number().int().optional().describe("Position among the parent's children (0 = first). Defaults to last."),
        props: z.record(z.string(), z.any()).optional().describe("Optional properties to set after creation, same shapes as uib_set_properties."),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ parent, className, name, index, props, response_format }) => {
      const { index: idx0 } = indexDoc((await fetchDoc()).data);
      if (!idx0.has(parent)) throw new Error(`No parent node with id "${parent}". Use uib_get_document to list ids.`);
      const id = genId(idx0);
      await postEdit({ ops: [{ op: "create", id, parent, className, ...(name ? { name } : {}), ...(index !== undefined ? { index } : {}) }] });

      const data = await waitForDoc(({ index: ix }) => ix.has(id));
      if (!indexDoc(data).index.has(id)) {
        throw new Error(`The node wasn't created. Check that "${className}" is a valid Roblox UI class, and that the editor is running the updated dev server (reload it).`);
      }

      const applied = {};
      if (props && Object.keys(props).length) {
        const { node, rootId } = indexDoc(data).index.get(id);
        const p = {};
        let rename;
        for (const [prop, value] of Object.entries(props)) {
          if (prop === "Name") { rename = String(value); applied.Name = rename; continue; }
          p[prop] = encodeProp(node, prop, value);
          applied[prop] = value;
        }
        if (Object.keys(p).length || rename !== undefined) {
          const before = (await fetchDoc()).version;
          await postEdit({ root: rootId, edits: [{ i: id, ...(rename !== undefined ? { n: rename } : {}), p }] });
          await waitForVersion(before);
        }
      }

      await syncStudio();
      const out = { ok: true, id, parent, className, name: name ?? className, applied };
      if (response_format === "json") return json(out);
      return text(`Created ${out.name} [${className}] #${id} under #${parent}.` + (Object.keys(applied).length ? `\nSet: ${Object.entries(applied).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ")}` : ""));
    }
  );

  server.registerTool(
    "uib_delete_node",
    {
      title: "Delete node",
      description: "Delete a node and all its descendants. Can't delete a root ScreenGui. Use to remove a layout object (e.g. a UIGridLayout) before adding a different one.",
      inputSchema: z.object({ id: z.string().min(1).describe("Node id to delete."), response_format: FORMAT }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, response_format }) => {
      const hit = indexDoc((await fetchDoc()).data).index.get(id);
      if (!hit) throw new Error(`No node with id "${id}".`);
      const label = `${hit.node.n} [${hit.node.c}]`;
      await postEdit({ ops: [{ op: "delete", id }] });
      const data = await waitForDoc(({ index: ix }) => !ix.has(id));
      if (indexDoc(data).index.has(id)) throw new Error(`Couldn't delete #${id} — a root ScreenGui can't be deleted.`);
      await syncStudio();
      const out = { ok: true, deleted: id };
      if (response_format === "json") return json(out);
      return text(`Deleted ${label} #${id} and its descendants.`);
    }
  );

  server.registerTool(
    "uib_move_node",
    {
      title: "Move / reorder node",
      description: "Re-parent a node and/or change its position among siblings. Give a new parent, a new index, or both. Can't move a node into its own descendant. Use to set child order in a layout (index 0 = first).",
      inputSchema: z.object({
        id: z.string().min(1).describe("Node id to move."),
        parent: z.string().optional().describe("New parent id. Omit to keep the current parent (reorder only)."),
        index: z.number().int().optional().describe("New position among the target parent's children (0 = first)."),
        response_format: FORMAT,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, parent, index, response_format }) => {
      const { index: idx0 } = indexDoc((await fetchDoc()).data);
      const hit = idx0.get(id);
      if (!hit) throw new Error(`No node with id "${id}".`);
      if (parent && !idx0.has(parent)) throw new Error(`No parent node with id "${parent}".`);
      const target = parent ?? hit.parentId;
      await postEdit({ ops: [{ op: "move", id, ...(parent ? { parent } : {}), ...(index !== undefined ? { index } : {}) }] });
      const data = await waitForDoc(({ index: ix }) => ix.get(id)?.parentId === target);
      const now = indexDoc(data).index.get(id);
      await syncStudio();
      const out = { ok: true, id, parent: now?.parentId ?? null };
      if (response_format === "json") return json(out);
      return text(`Moved ${hit.node.n} #${id} → parent #${now?.parentId ?? "?"}${index !== undefined ? ` at index ${index}` : ""}.`);
    }
  );

  return server;
}

serveStdio(createServer);
console.error(`uib-mcp-server running on stdio → ${BASE}`); // stderr only; stdout carries the protocol
