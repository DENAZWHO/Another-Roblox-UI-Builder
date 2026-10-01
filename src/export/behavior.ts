// Luau for everything that happens at runtime: animation clips + their triggers,
// effects, avatar images and player-name bindings. Shared by the Luau export,
// the .rbxmx animation script and Studio sync. Mirrors model/runtime.ts.
import { clipLength } from '../model/animation';
import { identifier, pathTo } from '../model/doc';
import { CLASS_PROPS, isGuiObject, isWorldGui } from '../model/schema';
import { clipTrigger, defaultFrom, MOUSE_RANGE, TOAST_GAP } from '../model/runtime';
import { designSize, pixelScaleOn } from '../model/pixelScale';
import type { AnimClip, Doc, Effect, GuiNode, Tween } from '../model/types';
import { luaValue, num } from './luau';

const BUTTONS = ['TextButton', 'ImageButton'];
const isPressInput = 'input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch';

export function adorneeExpr(path: string): string | null {
  const parts = path.split(/[./]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  const head = /^workspace$/i.test(first) ? 'workspace' : `game:GetService(${JSON.stringify(first)})`;
  return head + rest.map((p) => `:WaitForChild(${JSON.stringify(p)})`).join('');
}

export const clipFnName = (clip: AnimClip) => 'play' + identifier(clip.name).replace(/^_/, '');

function propDefFor(doc: Doc, tw: Tween) {
  return CLASS_PROPS[doc.nodes[tw.nodeId].className].find((p) => p.name === tw.prop)!;
}

export interface BehaviorResult {
  lines: string[];
  services: Set<string>;
  /** clip id -> Luau function name, for clips that were emitted */
  clipFns: Map<string, string>;
}

/**
 * @param inScope nodes this script can reference
 * @param ref Luau expression for a node
 */
export function behaviorLines(doc: Doc, inScope: (id: string) => boolean, ref: (id: string) => string, I: string): BehaviorResult {
  const lines: string[] = [];
  const services = new Set<string>();
  const clipFns = new Map<string, string>();
  const nodes = Object.values(doc.nodes).filter((n) => inScope(n.id));

  // --- player data -------------------------------------------------------
  const avatars = nodes.filter((n) => n.avatar && (n.className === 'ImageLabel' || n.className === 'ImageButton'));
  const binds = nodes.filter((n) => n.bind && 'Text' in n.props);
  if (avatars.length || binds.length) {
    services.add('Players');
    lines.push(`${I}-- Local player's avatar and name`);
    for (const n of binds) {
      const v = n.bind === 'UserId' ? 'tostring(Players.LocalPlayer.UserId)' : `Players.LocalPlayer.${n.bind}`;
      lines.push(`${I}${ref(n.id)}.Text = ${v}`);
    }
    for (const n of avatars) {
      const a = n.avatar!;
      lines.push(
        `${I}task.spawn(function()`,
        `${I}\tlocal ok, image = pcall(function()`,
        `${I}\t\treturn Players:GetUserThumbnailAsync(Players.LocalPlayer.UserId, Enum.ThumbnailType.${a.kind}, Enum.ThumbnailSize.Size${a.size}x${a.size})`,
        `${I}\tend)`,
        `${I}\tif ok then`,
        `${I}\t\t${ref(n.id)}.Image = image`,
        `${I}\tend`,
        `${I}end)`,
      );
    }
    lines.push('');
  }

  // --- animation clips ---------------------------------------------------
  const clips = doc.clips
    .map((c) => ({ ...c, tweens: c.tweens.filter((t) => doc.nodes[t.nodeId] && inScope(t.nodeId)) }))
    .filter((c) => c.tweens.length);
  if (clips.length) {
    services.add('TweenService');
    lines.push(`${I}-- Animations (each call restarts the clip; older delayed tweens are cancelled)`, `${I}local animTokens = {}`, '');
  }
  const used = new Set<string>();
  for (const clip of clips) {
    let fn = clipFnName(clip);
    for (let i = 2; used.has(fn); i++) fn = clipFnName(clip) + i;
    used.add(fn);
    clipFns.set(clip.id, fn);
    const key = JSON.stringify(fn);
    const body: string[] = [];
    const B = I + (clip.loop ? '\t\t' : '\t');
    if ((clip.from ?? defaultFrom(clip)) === 'design') {
      const seen = new Set<string>();
      for (const t of clip.tweens) {
        const k = t.nodeId + '.' + t.prop;
        if (seen.has(k)) continue;
        seen.add(k);
        body.push(`${B}${ref(t.nodeId)}.${t.prop} = ${luaValue(propDefFor(doc, t), doc.nodes[t.nodeId].props[t.prop])}`);
      }
    }
    const groups = new Map<string, Tween[]>();
    for (const t of [...clip.tweens].sort((a, b) => a.start - b.start)) {
      const k = [t.nodeId, t.start, t.duration, t.style, t.direction].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(t);
    }
    const byStart = new Map<number, string[]>();
    for (const list of groups.values()) {
      const t = list[0];
      const props = list.map((x) => `${x.prop} = ${luaValue(propDefFor(doc, x), x.to)}`).join(', ');
      const call = `TweenService:Create(${ref(t.nodeId)}, TweenInfo.new(${num(t.duration)}, Enum.EasingStyle.${t.style}, Enum.EasingDirection.${t.direction}), { ${props} }):Play()`;
      const s = +t.start.toFixed(3);
      if (!byStart.has(s)) byStart.set(s, []);
      byStart.get(s)!.push(call);
    }
    for (const [start, calls] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
      if (start <= 0) calls.forEach((c) => body.push(B + c));
      else {
        body.push(`${B}task.delay(${num(start)}, function()`, `${B}\tif animTokens[${key}] ~= token then return end`);
        calls.forEach((c) => body.push(`${B}\t${c}`));
        body.push(`${B}end)`);
      }
    }
    lines.push(`${I}local function ${fn}()`, `${I}\tlocal token = {}`, `${I}\tanimTokens[${key}] = token`);
    if (clip.loop) {
      const period = Math.max(0.05, clipLength(clip) + (clip.loopDelay ?? 0));
      lines.push(`${I}\tlocal function run()`, ...body, `${I}\tend`, `${I}\trun()`);
      lines.push(
        `${I}\ttask.spawn(function()`,
        `${I}\t\twhile true do`,
        `${I}\t\t\ttask.wait(${num(period)})`,
        `${I}\t\t\tif animTokens[${key}] ~= token then return end`,
        `${I}\t\t\trun()`,
        `${I}\t\tend`,
        `${I}\tend)`,
      );
    } else lines.push(...body);
    lines.push(`${I}end`, '');
  }

  // --- triggers ------------------------------------------------------------
  const wiring: string[] = [];
  const onLoad: string[] = [];
  for (const clip of doc.clips) {
    const fn = clipFns.get(clip.id);
    if (!fn) continue;
    const trig = clipTrigger(clip);
    if (trig === 'load') {
      onLoad.push(`${I}${fn}()`);
      continue;
    }
    if (trig === 'manual') continue;
    const target = clip.triggerNodeId ? doc.nodes[clip.triggerNodeId] : undefined;
    if (!target || !inScope(target.id)) {
      wiring.push(`${I}-- "${clip.name}": no trigger element set`);
      continue;
    }
    const el = ref(target.id);
    const btn = BUTTONS.includes(target.className);
    if (trig === 'click') wiring.push(btn ? `${I}${el}.Activated:Connect(${fn})` : `${I}${el}.InputBegan:Connect(function(input)\n${I}\tif ${isPressInput} then ${fn}() end\n${I}end)`);
    if (trig === 'hoverEnter') wiring.push(`${I}${el}.MouseEnter:Connect(${fn})`);
    if (trig === 'hoverLeave') wiring.push(`${I}${el}.MouseLeave:Connect(${fn})`);
    if (trig === 'pressDown') wiring.push(btn ? `${I}${el}.MouseButton1Down:Connect(${fn})` : `${I}${el}.InputBegan:Connect(function(input)\n${I}\tif ${isPressInput} then ${fn}() end\n${I}end)`);
    if (trig === 'pressUp') wiring.push(btn ? `${I}${el}.MouseButton1Up:Connect(${fn})` : `${I}${el}.InputEnded:Connect(function(input)\n${I}\tif ${isPressInput} then ${fn}() end\n${I}end)`);
  }
  if (wiring.length) lines.push(`${I}-- Animation triggers`, ...wiring, '');

  // --- effects -------------------------------------------------------------
  const fxNodes = nodes.filter((n) => n.effects?.length);
  if (fxNodes.length) {
    services.add('RunService');
    const needsMouse = fxNodes.some((n) => n.effects!.some((e) => ['lookAtMouse', 'tiltToMouse', 'followMouse'].includes(e.kind)));
    lines.push(`${I}-- Effects`);
    if (needsMouse) {
      services.add('UserInputService');
      services.add('GuiService');
      lines.push(
        `${I}local function mouseIn(gui: GuiObject): Vector2`,
        `${I}\tlocal m = UserInputService:GetMouseLocation()`,
        `${I}\tlocal screen = gui:FindFirstAncestorWhichIsA("ScreenGui")`,
        `${I}\tif screen and not screen.IgnoreGuiInset then`,
        `${I}\t\tm -= (GuiService:GetGuiInset())`,
        `${I}\tend`,
        `${I}\treturn m`,
        `${I}end`,
        '',
      );
    }
    for (const n of fxNodes) lines.push(...effectBlock(n, ref(n.id), I), '');
  }

  // --- toasts --------------------------------------------------------------
  const toastNodes = nodes.filter((n) => n.toast && n.parentId && isGuiObject(n.className));
  if (toastNodes.length) {
    services.add('TweenService');
    services.add('ReplicatedStorage');
    lines.push(...toasterLines(I));
    for (const n of toastNodes) {
      const cfg = n.toast!;
      const fn = 'show' + identifier(n.name).replace(/^_/, '');
      const rootId = pathTo(doc.nodes, n.id)[0];
      const event = JSON.stringify('Show' + identifier(n.name).replace(/^_/, ''));
      lines.push(
        `${I}-- "${n.name}" is a toast template. Other LocalScripts: ${doc.nodes[rootId].name}:WaitForChild(${event}):Fire("Title", "Message", seconds?)`,
        `${I}local ${fn} = makeToaster(${ref(n.id)}, ${num(cfg.duration)}, ${JSON.stringify(cfg.enter)})`,
        `${I}do`,
        `${I}	local event = Instance.new("BindableEvent")`,
        `${I}	event.Name = ${event}`,
        `${I}	event.Event:Connect(${fn})`,
        `${I}	event.Parent = ${ref(rootId)}`,
        `${I}	-- Server -> client: put a RemoteEvent named "UIBuilderToast" in ReplicatedStorage and call remote:FireClient(player, "Title", "Message")`,
        `${I}	task.spawn(function()`,
        `${I}		local remote = ReplicatedStorage:WaitForChild("UIBuilderToast", 10)`,
        `${I}		if remote and remote:IsA("RemoteEvent") then`,
        `${I}			remote.OnClientEvent:Connect(${fn})`,
        `${I}		end`,
        `${I}	end)`,
        `${I}end`,
      );
      const trig = cfg.triggerNodeId ? doc.nodes[cfg.triggerNodeId] : undefined;
      if (trig && inScope(trig.id)) {
        const el = ref(trig.id);
        lines.push(
          BUTTONS.includes(trig.className)
            ? `${I}${el}.Activated:Connect(function() ${fn}() end)`
            : `${I}${el}.InputBegan:Connect(function(input)\n${I}\tif ${isPressInput} then ${fn}() end\n${I}end)`,
        );
      }
      lines.push('');
    }
  }

  if (onLoad.length) lines.push(`${I}-- Play on load`, ...onLoad, '');
  return { lines, services, clipFns };
}

function effectBlock(n: GuiNode, el: string, I: string): string[] {
  const fx = n.effects!;
  const has = (k: Effect['kind']) => fx.some((e) => e.kind === k);
  const get = (k: Effect['kind']) => fx.find((e) => e.kind === k)!;
  const usesScale = has('hoverScale') || has('pressScale') || has('pulse');
  const usesPos = has('followMouse') || has('float');
  const usesRot = has('lookAtMouse') || has('tiltToMouse') || has('spin');
  const usesMouse = has('lookAtMouse') || has('tiltToMouse') || has('followMouse');
  const J = I + '\t';
  const K = J + '\t';
  const out = [`${I}do -- ${n.name}: ${fx.map((e) => e.kind).join(', ')}`, `${J}local el = ${el}`];
  if (usesPos) out.push(`${J}local basePosition = el.Position`, `${J}local offset = Vector2.zero`);
  if (usesRot) out.push(`${J}local baseRotation = el.Rotation`);
  if (has('lookAtMouse')) out.push(`${J}local look = baseRotation`);
  if (has('tiltToMouse')) out.push(`${J}local tilt = 0`);
  if (has('followMouse')) out.push(`${J}local follow = Vector2.zero`);
  if (usesScale) {
    out.push(`${J}local uiScale = el:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")`, `${J}uiScale.Parent = el`, `${J}local scale = 1`);
  }
  if (has('hoverScale') || has('pressScale')) {
    out.push(
      `${J}local hovered, pressed = false, false`,
      `${J}el.MouseEnter:Connect(function() hovered = true end)`,
      `${J}el.MouseLeave:Connect(function() hovered = false; pressed = false end)`,
      `${J}el.InputBegan:Connect(function(input)`,
      `${K}if ${isPressInput} then pressed = true end`,
      `${J}end)`,
      `${J}el.InputEnded:Connect(function(input)`,
      `${K}if ${isPressInput} then pressed = false end`,
      `${J}end)`,
    );
  }
  const usesTime = has('float') || has('spin') || has('pulse');
  if (usesTime) out.push(`${J}local startTime = os.clock()`);
  out.push(`${J}RunService.RenderStepped:Connect(function(dt)`);
  if (usesTime) out.push(`${K}local t = os.clock() - startTime`);
  if (usesMouse) {
    out.push(`${K}local m = mouseIn(el)`);
    out.push(`${K}local c = el.AbsolutePosition + el.AbsoluteSize / 2${usesPos ? ' - offset' : ''}`);
  }
  if (usesRot) out.push(`${K}local rotation = baseRotation`);
  if (usesPos) out.push(`${K}local off = Vector2.zero`);
  const smooth = (e: Effect) => `(1 - math.exp(-${num(Math.max(0.1, e.speed))} * dt))`;
  for (const e of fx) {
    switch (e.kind) {
      case 'lookAtMouse':
        out.push(
          `${K}local target = math.deg(math.atan2(m.Y - c.Y, m.X - c.X)) + ${num(e.amount)}`,
          `${K}look += ((target - look + 180) % 360 - 180) * ${smooth(e)}`,
          `${K}rotation = look`,
        );
        break;
      case 'tiltToMouse':
        out.push(`${K}tilt += (math.clamp((m.X - c.X) / ${MOUSE_RANGE}, -1, 1) * ${num(e.amount * (e.invert ? -1 : 1))} - tilt) * ${smooth(e)}`, `${K}rotation += tilt`);
        break;
      case 'followMouse':
        out.push(
          `${K}local d = m - c`,
          `${K}local goal = if d.Magnitude > 0.001 then d.Unit * ${num(e.amount * (e.invert ? -1 : 1))} * math.min(1, d.Magnitude / ${MOUSE_RANGE}) else Vector2.zero`,
          `${K}follow += (goal - follow) * ${smooth(e)}`,
          `${K}off += follow`,
        );
        break;
      case 'float':
        out.push(`${K}off += Vector2.new(0, math.sin(t * math.pi * 2 / ${num(Math.max(0.05, e.speed))}) * ${num(e.amount)})`);
        break;
      case 'spin':
        out.push(`${K}rotation += t * ${num(e.amount)}`);
        break;
      default:
        break;
    }
  }
  if (usesRot) out.push(`${K}el.Rotation = rotation`);
  if (usesPos) out.push(`${K}offset = off`, `${K}el.Position = basePosition + UDim2.fromOffset(off.X, off.Y)`);
  if (usesScale) {
    const hs = has('hoverScale') ? get('hoverScale') : null;
    const ps = has('pressScale') ? get('pressScale') : null;
    const pulse = has('pulse') ? get('pulse') : null;
    const goal = [hs ? `(if hovered then ${num(hs.amount)} else 1)` : '', ps ? `(if pressed then ${num(ps.amount)} else 1)` : ''].filter(Boolean).join(' * ') || '1';
    const speed = 4 / Math.max(0.01, hs?.speed ?? ps?.speed ?? 0.33);
    out.push(`${K}scale += (${goal} - scale) * (1 - math.exp(-${num(speed)} * dt))`);
    out.push(`${K}uiScale.Scale = scale${pulse ? ` * (1 + ${num(pulse.amount)} * math.sin(t * math.pi * 2 / ${num(Math.max(0.05, pulse.speed))}))` : ''}`);
  }
  out.push(`${J}end)`, `${I}end`);
  return out;
}

/** Whole LocalScript placed inside a root GUI (used by .rbxmx export and Studio sync). Null when there's nothing to run. */
export function rootScript(doc: Doc, rootId: string): string | null {
  const root = doc.nodes[rootId];
  const within = (id: string) => {
    for (let cur: string | null = id; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === rootId) return true;
    return false;
  };
  const refs = new Map<string, string>();
  const path = (id: string) => {
    const parts: string[] = [];
    for (let cur: string | null = id; cur && cur !== rootId; cur = doc.nodes[cur].parentId) parts.unshift(doc.nodes[cur].name);
    return 'ui' + parts.map((p) => `:WaitForChild(${JSON.stringify(p)})`).join('');
  };
  const ref = (id: string) => {
    if (id === rootId) return 'ui';
    if (!refs.has(id)) refs.set(id, `el${refs.size + 1}`);
    return refs.get(id)!;
  };
  const b = behaviorLines(doc, within, ref, '');
  const adornee = isWorldGui(root.className) && root.adornee ? adorneeExpr(root.adornee) : null;
  const scaler = root.className === 'ScreenGui' && pixelScaleOn(doc) ? pixelScalerLines('ui', designSize(doc), '') : [];
  if (!b.lines.length && !adornee && !scaler.length) return null;
  const head = ['-- Generated by Roblox UI Builder. Edits here are overwritten when you sync or export again.'];
  for (const s of b.services) head.push(`local ${s} = game:GetService("${s}")`);
  head.push('local ui = script.Parent', '');
  if (adornee) head.push(`ui.Adornee = ${adornee}`, '');
  for (const [id, v] of refs) head.push(`local ${v} = ${path(id)} -- ${doc.nodes[id].name}`);
  if (refs.size) head.push('');
  return [...head, ...scaler, ...b.lines].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Luau that scales pixel-based details (stroke thickness, text size, corner radius, padding, layout
 * spacing, scrollbar) with the screen, relative to the design resolution. Mirrors model/pixelScale.ts.
 * Design values come from "UIB_<Property>" attributes when present (written by the Studio plugin,
 * which scales live in edit mode), otherwise from the properties as authored.
 */
export function pixelScalerLines(rootRef: string, design: { w: number; h: number }, I: string): string[] {
  const J = I + '\t';
  const K = J + '\t';
  return [
    `${I}-- Scale strokes, text, corners and padding with the screen (designed at ${design.w}x${design.h})`,
    `${I}do`,
    `${J}local DESIGN = Vector2.new(${design.w}, ${design.h})`,
    `${J}local PROPS = {`,
    `${K}UIStroke = { "Thickness" },`,
    `${K}UITextSizeConstraint = { "MaxTextSize", "MinTextSize" },`,
    `${K}UICorner = { "CornerRadius" },`,
    `${K}UIPadding = { "PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight" },`,
    `${K}UIListLayout = { "Padding" },`,
    `${K}UIGridLayout = { "CellSize", "CellPadding" },`,
    `${K}TextLabel = { "TextSize" }, TextButton = { "TextSize" }, TextBox = { "TextSize" },`,
    `${K}ScrollingFrame = { "ScrollBarThickness" },`,
    `${J}}`,
    `${J}local INTEGER = { MaxTextSize = 1, MinTextSize = 1, ScrollBarThickness = 0 }`,
    `${J}local base = setmetatable({}, { __mode = "k" })`,
    `${J}local factor = 1`,
    `${J}local function scaled(value, f)`,
    `${K}local kind = typeof(value)`,
    `${K}if kind == "number" then return value * f end`,
    `${K}if kind == "UDim" then return UDim.new(value.Scale, value.Offset * f) end`,
    `${K}if kind == "UDim2" then return UDim2.new(value.X.Scale, value.X.Offset * f, value.Y.Scale, value.Y.Offset * f) end`,
    `${K}return value`,
    `${J}end`,
    `${J}local function apply(inst)`,
    `${K}for prop, value in base[inst] do`,
    `${K}\tlocal v = scaled(value, factor)`,
    `${K}\tif INTEGER[prop] then v = math.max(INTEGER[prop], math.round(v)) end`,
    `${K}\tif prop == "TextSize" then v = math.clamp(v, 1, 100) end`,
    `${K}\t(inst :: any)[prop] = v`,
    `${K}end`,
    `${J}end`,
    `${J}local capture`,
    `${J}function capture(inst: Instance)`,
    `${K}-- Roblox caps TextScaled at 100px; give it a cap that scales with the screen too`,
    `${K}if (inst:IsA("TextLabel") or inst:IsA("TextButton") or inst:IsA("TextBox")) and inst.TextScaled and not inst:FindFirstChildOfClass("UITextSizeConstraint") then`,
    `${K}\tlocal cap = Instance.new("UITextSizeConstraint")`,
    `${K}\tcap.Name = "UIBuilderTextCap"`,
    `${K}\tcap:SetAttribute("UIB_MaxTextSize", 100)`,
    `${K}\tcap:SetAttribute("UIB_MinTextSize", 1)`,
    `${K}\tcap.Parent = inst`,
    `${K}\tcapture(cap)`,
    `${K}end`,
    `${K}local props = PROPS[inst.ClassName]`,
    `${K}if not props or base[inst] then return end`,
    `${K}local values = {}`,
    `${K}for _, prop in props do`,
    `${K}\tvalues[prop] = inst:GetAttribute("UIB_" .. prop) or (inst :: any)[prop]`,
    `${K}end`,
    `${K}base[inst] = values`,
    `${K}apply(inst)`,
    `${J}end`,
    `${J}local function update()`,
    `${K}local viewport = workspace.CurrentCamera.ViewportSize`,
    `${K}factor = math.min(viewport.X / DESIGN.X, viewport.Y / DESIGN.Y)`,
    `${K}for inst in base do apply(inst) end`,
    `${J}end`,
    `${J}update()`,
    `${J}for _, d in ${rootRef}:GetDescendants() do capture(d) end`,
    `${J}${rootRef}.DescendantAdded:Connect(capture)`,
    `${J}workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(update)`,
    `${I}end`,
    '',
  ];
}

/** Luau toaster: clones a hidden template, fills Title/Message, slides/fades/pops it in, stacks older toasts, removes it after a while. Mirrors UIRuntime.showToast. */
function toasterLines(I: string): string[] {
  const J = I + '\t';
  const K = J + '\t';
  const L = K + '\t';
  return [
    `${I}-- Toasts`,
    `${I}local function makeToaster(template: GuiObject, duration: number, enter: string)`,
    `${J}template.Visible = false`,
    `${J}local SLIDE = { slideRight = Vector2.new(1, 0), slideLeft = Vector2.new(-1, 0), slideDown = Vector2.new(0, -1), slideUp = Vector2.new(0, 1) }`,
    `${J}local GAP = ${TOAST_GAP}`,
    `${J}local base = template.Position`,
    `${J}local fromBottom = template.AnchorPoint.Y >= 0.5`,
    `${J}local isGroup = template:IsA("CanvasGroup")`,
    `${J}local restTransparency = if isGroup then (template :: any).GroupTransparency else 0`,
    `${J}local active = {}`,
    `${J}local function restack(skip)`,
    `${K}local offset = 0`,
    `${K}for i = #active, 1, -1 do`,
    `${L}local item = active[i]`,
    `${L}if item.toast ~= skip and not item.leaving then`,
    `${L}\tlocal y = if fromBottom then -offset else offset`,
    `${L}\tTweenService:Create(item.toast, TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = base + UDim2.fromOffset(0, y) }):Play()`,
    `${L}end`,
    `${L}offset += item.toast.AbsoluteSize.Y + GAP`,
    `${K}end`,
    `${J}end`,
    `${J}local function setText(root: Instance, name: string, text: string?)`,
    `${K}if text == nil then return end`,
    `${K}local label = root:FindFirstChild(name, true)`,
    `${K}if label and (label:IsA("TextLabel") or label:IsA("TextButton") or label:IsA("TextBox")) then`,
    `${L}label.Text = text`,
    `${K}end`,
    `${J}end`,
    `${J}return function(title: string?, message: string?, seconds: number?)`,
    `${K}local toast = template:Clone()`,
    `${K}setText(toast, "Title", title)`,
    `${K}setText(toast, "Message", message)`,
    `${K}local size = template.AbsoluteSize`,
    `${K}local dir = SLIDE[enter]`,
    `${K}local away = if dir then UDim2.fromOffset(dir.X * (size.X + 40), dir.Y * (size.Y + 40)) else UDim2.new()`,
    `${K}toast.Position = base + away`,
    `${K}if isGroup then (toast :: any).GroupTransparency = 1 end`,
    `${K}local scale: UIScale? = nil`,
    `${K}if enter == "pop" then`,
    `${L}scale = Instance.new("UIScale")`,
    `${L}scale.Scale = 0.6`,
    `${L}scale.Parent = toast`,
    `${K}end`,
    `${K}toast.Visible = true`,
    `${K}toast.Parent = template.Parent`,
    `${K}local item = { toast = toast, leaving = false }`,
    `${K}table.insert(active, item)`,
    `${K}local inInfo = TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out)`,
    `${K}TweenService:Create(toast, inInfo, { Position = base }):Play()`,
    `${K}if isGroup then TweenService:Create(toast, TweenInfo.new(0.25), { GroupTransparency = restTransparency }):Play() end`,
    `${K}if scale then TweenService:Create(scale, inInfo, { Scale = 1 }):Play() end`,
    `${K}restack(toast)`,
    `${K}task.delay(seconds or duration, function()`,
    `${L}item.leaving = true`,
    `${L}local outInfo = TweenInfo.new(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.In)`,
    `${L}if dir then TweenService:Create(toast, outInfo, { Position = toast.Position + away }):Play() end`,
    `${L}if isGroup then TweenService:Create(toast, outInfo, { GroupTransparency = 1 }):Play() end`,
    `${L}if scale then TweenService:Create(scale, outInfo, { Scale = 0.6 }):Play() end`,
    `${L}task.wait(0.26)`,
    `${L}local index = table.find(active, item)`,
    `${L}if index then table.remove(active, index) end`,
    `${L}toast:Destroy()`,
    `${L}restack()`,
    `${K}end)`,
    `${J}end`,
    `${I}end`,
    '',
  ];
}
