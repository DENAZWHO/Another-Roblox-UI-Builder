import { createNode, uid, type Fragment } from './doc';
import type { ClassName, Doc, Effect, GuiNode, RootClass, Tween } from './types';

interface Spec {
  c: ClassName;
  n?: string;
  p?: Record<string, any>;
  k?: Spec[];
  /** extra node fields (avatar, bind, effects…) */
  x?: Partial<GuiNode>;
}

const fx = (kind: Effect['kind'], amount: number, speed: number): Effect => ({ id: uid(), kind, amount, speed });

export const U = (xs: number, xo: number, ys: number, yo: number) => ({ x: { s: xs, o: xo }, y: { s: ys, o: yo } });
const D = (s: number, o: number) => ({ s, o });
const font = (family: string, weight = 400) => ({ family, weight, style: 'Normal' as const });

export function buildFragment(specs: Spec[]): Fragment {
  const nodes: GuiNode[] = [];
  const build = (s: Spec, parentId: string | null): string => {
    const n = createNode(s.c, s.p ?? {}, s.n);
    Object.assign(n, structuredClone(s.x ?? {}));
    n.parentId = parentId;
    nodes.push(n);
    n.children = (s.k ?? []).map((k) => build(k, n.id));
    return n.id;
  };
  const rootIds = specs.map((s) => build(s, null));
  return { nodes, rootIds };
}

const corner = (o: number, s = 0): Spec => ({ c: 'UICorner', p: { CornerRadius: D(s, o) } });
const stroke = (color: string, thickness: number, mode: 'Border' | 'Contextual' = 'Border', transparency = 0): Spec => ({
  c: 'UIStroke', p: { Color: color, Thickness: thickness, ApplyStrokeMode: mode, Transparency: transparency },
});
const gradient = (a: string, b: string, rotation = 90): Spec => ({ c: 'UIGradient', p: { Color: [{ t: 0, c: a }, { t: 1, c: b }], Rotation: rotation } });
const padding = (o: number): Spec => ({ c: 'UIPadding', p: { PaddingTop: D(0, o), PaddingBottom: D(0, o), PaddingLeft: D(0, o), PaddingRight: D(0, o) } });

function button(name: string, text: string, color: string, dark: string, extra: Record<string, any> = {}): Spec {
  return {
    c: 'TextButton', n: name,
    p: {
      Size: U(1, 0, 0.26, 0), BackgroundColor3: color, Text: text, TextColor3: '#ffffff', TextScaled: true,
      FontFace: font('FredokaOne'), ...extra,
    },
    k: [corner(14), stroke(dark, 3), gradient('#ffffff', '#c9c9c9'), { c: 'UIPadding', p: { PaddingTop: D(0.18, 0), PaddingBottom: D(0.18, 0) } }],
  };
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  build: () => Fragment;
}

const avatarSpec = (size: number, name = 'PlayerAvatar'): Spec => ({
  c: 'ImageLabel', n: name,
  p: { Size: U(0, size, 0, size), BackgroundColor3: '#2b2f45', ScaleType: 'Crop' },
  x: { avatar: { kind: 'HeadShot', size: 420 } },
  k: [corner(0, 0.5), stroke('#ffffff', 3)],
});

export const PRESETS: Preset[] = [
  {
    id: 'avatar', name: 'Player Avatar', description: "Local player's headshot (set at runtime)",
    build: () => buildFragment([avatarSpec(100)]),
  },
  {
    id: 'playercard', name: 'Player Card', description: 'Avatar + display name + username',
    build: () => buildFragment([{
      c: 'Frame', n: 'PlayerCard', p: { Size: U(0, 320, 0, 96), BackgroundColor3: '#1f2233' },
      k: [
        corner(14), stroke('#3a3f5c', 2), padding(12),
        { c: 'UIListLayout', p: { FillDirection: 'Horizontal', VerticalAlignment: 'Center', Padding: D(0, 12) } },
        { ...avatarSpec(72, 'Avatar'), p: { ...avatarSpec(72).p, LayoutOrder: 1 } },
        {
          c: 'Frame', n: 'Info', p: { Size: U(1, -84, 1, 0), BackgroundTransparency: 1, LayoutOrder: 2 },
          k: [
            { c: 'UIListLayout', p: { VerticalAlignment: 'Center', Padding: D(0, 2) } },
            { c: 'TextLabel', n: 'DisplayName', p: { Size: U(1, 0, 0, 30), BackgroundTransparency: 1, Text: 'DisplayName', TextColor3: '#ffffff', TextSize: 24, FontFace: font('BuilderSans', 700), TextXAlignment: 'Left', LayoutOrder: 1 }, x: { bind: 'DisplayName' } },
            { c: 'TextLabel', n: 'Username', p: { Size: U(1, 0, 0, 20), BackgroundTransparency: 1, Text: 'Username', TextColor3: '#9aa0c3', TextSize: 16, FontFace: font('BuilderSans', 500), TextXAlignment: 'Left', LayoutOrder: 2 }, x: { bind: 'Name' } },
          ],
        },
      ],
    }]),
  },
  {
    id: 'button', name: 'Primary Button', description: 'Rounded button with stroke & gradient',
    build: () => buildFragment([{
      ...button('PrimaryButton', 'PLAY', '#3ecf5a', '#1e7a31'),
      p: { ...button('', 'PLAY', '#3ecf5a', '#1e7a31').p, Size: U(0, 220, 0, 64) },
    }]),
  },
  {
    id: 'card', name: 'Card', description: 'Panel with title, body and padding',
    build: () => buildFragment([{
      c: 'Frame', n: 'Card', p: { Size: U(0, 320, 0, 200), BackgroundColor3: '#1f2233' },
      k: [
        corner(16), stroke('#3a3f5c', 2), padding(18),
        { c: 'UIListLayout', p: { Padding: D(0, 8) } },
        { c: 'TextLabel', n: 'Title', p: { Size: U(1, 0, 0, 32), BackgroundTransparency: 1, Text: 'Card title', TextColor3: '#ffffff', TextSize: 26, FontFace: font('BuilderSans', 700), TextXAlignment: 'Left', LayoutOrder: 1 } },
        { c: 'TextLabel', n: 'Body', p: { Size: U(1, 0, 1, -40), BackgroundTransparency: 1, Text: 'Describe something here. Cards group related content together.', TextColor3: '#a9aec9', TextSize: 18, FontFace: font('BuilderSans', 400), TextXAlignment: 'Left', TextYAlignment: 'Top', TextWrapped: true, LayoutOrder: 2 } },
      ],
    }]),
  },
  {
    id: 'progress', name: 'Progress Bar', description: 'Track with fill (animate its Size)',
    build: () => buildFragment([{
      c: 'Frame', n: 'ProgressBar', p: { Size: U(0, 300, 0, 28), BackgroundColor3: '#14161f' },
      k: [
        corner(0, 0.5), stroke('#000000', 2),
        { c: 'Frame', n: 'Fill', p: { Size: U(0.65, 0, 1, 0), BackgroundColor3: '#4fb3ff' }, k: [corner(0, 0.5), gradient('#ffffff', '#b8b8b8')] },
        { c: 'TextLabel', n: 'Label', p: { Size: U(1, 0, 1, 0), BackgroundTransparency: 1, Text: '65%', TextColor3: '#ffffff', TextSize: 16, FontFace: font('BuilderSans', 700), ZIndex: 2 }, k: [stroke('#000000', 1.5, 'Contextual')] },
      ],
    }]),
  },
  {
    id: 'toggle', name: 'Toggle', description: 'On/off switch',
    build: () => buildFragment([{
      c: 'TextButton', n: 'Toggle', p: { Size: U(0, 64, 0, 34), BackgroundColor3: '#34c759', Text: '', AutoButtonColor: false },
      k: [corner(0, 0.5), { c: 'Frame', n: 'Knob', p: { AnchorPoint: { x: 1, y: 0.5 }, Position: U(1, -4, 0.5, 0), Size: U(0, 26, 0, 26), BackgroundColor3: '#ffffff' }, k: [corner(0, 0.5)] }],
    }]),
  },
  {
    id: 'currency', name: 'Currency Pill', description: 'Icon + amount in a horizontal list',
    build: () => buildFragment([{
      c: 'Frame', n: 'Coins', p: { Size: U(0, 170, 0, 50), BackgroundColor3: '#000000', BackgroundTransparency: 0.45 },
      k: [
        corner(0, 0.5), { c: 'UIPadding', p: { PaddingLeft: D(0, 8), PaddingRight: D(0, 14) } },
        { c: 'UIListLayout', p: { FillDirection: 'Horizontal', VerticalAlignment: 'Center', Padding: D(0, 8) } },
        { c: 'Frame', n: 'Icon', p: { Size: U(0, 36, 0, 36), BackgroundColor3: '#ffd23f' }, k: [corner(0, 0.5), stroke('#b8860b', 3)] },
        { c: 'TextLabel', n: 'Amount', p: { Size: U(1, -44, 1, 0), BackgroundTransparency: 1, Text: '1,250', TextColor3: '#ffffff', TextScaled: true, FontFace: font('FredokaOne'), TextXAlignment: 'Left' } },
      ],
    }]),
  },
  {
    id: 'close', name: 'Close Button', description: 'Circular X button',
    build: () => buildFragment([{
      c: 'TextButton', n: 'Close', p: { Size: U(0, 44, 0, 44), BackgroundColor3: '#ff4d4f', Text: 'X', TextColor3: '#ffffff', TextSize: 24, FontFace: font('FredokaOne') },
      k: [corner(0, 0.5), stroke('#8c1c1e', 3)],
    }]),
  },
  {
    id: 'shop', name: 'Shop Grid', description: 'ScrollingFrame + UIGridLayout',
    build: () => buildFragment([{
      c: 'ScrollingFrame', n: 'ShopGrid',
      p: { Size: U(0, 440, 0, 320), BackgroundColor3: '#1b1d29', CanvasSize: U(0, 0, 0, 0), AutomaticCanvasSize: 'Y', ScrollingDirection: 'Y', ScrollBarThickness: 6, ScrollBarImageColor3: '#ffffff', ScrollBarImageTransparency: 0.6 },
      k: [
        corner(12), padding(14),
        { c: 'UIGridLayout', p: { CellSize: U(0, 128, 0, 150), CellPadding: U(0, 12, 0, 12) } },
        ...['Sword', 'Shield', 'Potion', 'Bow', 'Helmet', 'Boots'].map((item, i): Spec => ({
          c: 'ImageButton', n: item, p: { BackgroundColor3: ['#2c3050', '#2f4b3a', '#4b2f45'][i % 3], LayoutOrder: i },
          k: [
            corner(10), stroke('#ffffff', 1.5, 'Border', 0.85),
            { c: 'TextLabel', n: 'Name', p: { AnchorPoint: { x: 0.5, y: 1 }, Position: U(0.5, 0, 1, -8), Size: U(1, -16, 0, 22), BackgroundTransparency: 1, Text: item, TextColor3: '#ffffff', TextScaled: true, FontFace: font('BuilderSans', 700) } },
          ],
        })),
      ],
    }]),
  },
  {
    id: 'toast', name: 'Toast notification', description: 'Slides in, waits, slides out — call it from scripts',
    build: () => buildFragment([{
      c: 'CanvasGroup', n: 'Toast', p: { AnchorPoint: { x: 1, y: 0 }, Size: U(0, 340, 0, 72), BackgroundColor3: '#232634', ZIndex: 10 },
      x: { toast: { duration: 3, enter: 'slideRight' } },
      k: [
        corner(10), stroke('#000000', 1, 'Border', 0.6),
        { c: 'Frame', n: 'Accent', p: { Size: U(0, 6, 1, 0), BackgroundColor3: '#ffb020' }, k: [corner(3)] },
        { c: 'TextLabel', n: 'Title', p: { Position: U(0, 20, 0, 10), Size: U(1, -30, 0, 24), BackgroundTransparency: 1, Text: 'Quest complete!', TextColor3: '#ffffff', TextSize: 20, FontFace: font('BuilderSans', 700), TextXAlignment: 'Left' } },
        { c: 'TextLabel', n: 'Message', p: { Position: U(0, 20, 0, 36), Size: U(1, -30, 0, 22), BackgroundTransparency: 1, Text: 'You earned 50 coins', TextColor3: '#a9aec9', TextSize: 16, FontFace: font('BuilderSans', 400), TextXAlignment: 'Left' } },
      ],
    }]),
  },
  {
    id: 'input', name: 'Text Input', description: 'TextBox with placeholder',
    build: () => buildFragment([{
      c: 'TextBox', n: 'Input', p: { Size: U(0, 280, 0, 44), BackgroundColor3: '#14161f', Text: '', PlaceholderText: 'Enter code...', PlaceholderColor3: '#6b7090', TextColor3: '#ffffff', TextSize: 18, TextXAlignment: 'Left', FontFace: font('BuilderSans', 500) },
      k: [corner(8), stroke('#3a3f5c', 1.5, 'Border'), { c: 'UIPadding', p: { PaddingLeft: D(0, 12), PaddingRight: D(0, 12) } }],
    }]),
  },
];

/** Content a new root GUI starts with */
export function rootStarter(cls: RootClass): Spec {
  if (cls === 'BillboardGui') {
    return {
      c: 'BillboardGui', n: 'Nametag',
      k: [{
        c: 'TextLabel', n: 'Label',
        p: { Size: U(1, 0, 1, 0), BackgroundTransparency: 1, Text: 'Nametag', TextScaled: true, TextColor3: '#ffffff', FontFace: font('BuilderSans', 700) },
        k: [stroke('#000000', 2, 'Contextual')],
      }],
    };
  }
  if (cls === 'SurfaceGui') {
    return {
      c: 'SurfaceGui', n: 'Sign',
      k: [{
        c: 'Frame', n: 'Panel', p: { Size: U(1, 0, 1, 0), BackgroundColor3: '#1f2233' },
        k: [
          gradient('#ffffff', '#b9bdd6', 90),
          { c: 'TextLabel', n: 'Title', p: { AnchorPoint: { x: 0.5, y: 0.5 }, Position: U(0.5, 0, 0.4, 0), Size: U(0.8, 0, 0.25, 0), BackgroundTransparency: 1, Text: 'WELCOME!', TextScaled: true, TextColor3: '#ffffff', FontFace: font('LuckiestGuy') }, k: [stroke('#1a1030', 4, 'Contextual')] },
          { ...button('Enter', 'ENTER', '#3ecf5a', '#1e7a31'), p: { ...button('', 'ENTER', '#3ecf5a', '#1e7a31').p, AnchorPoint: { x: 0.5, y: 0 }, Position: U(0.5, 0, 0.62, 0), Size: U(0.4, 0, 0.18, 0) } },
        ],
      }],
    };
  }
  return { c: 'ScreenGui', n: 'ScreenGui' };
}

/** The document shown on first launch: a small main menu with an idle animation */
export function demoDoc(): Doc {
  const frag = buildFragment([{
    c: 'ScreenGui', n: 'MainMenu', p: { IgnoreGuiInset: true, ResetOnSpawn: false },
    k: [
      { c: 'Frame', n: 'Background', p: { Size: U(1, 0, 1, 0), BackgroundColor3: '#ffffff' }, k: [gradient('#2a2f6e', '#0b0c1a', 90)] },
      {
        c: 'TextLabel', n: 'Title',
        p: { AnchorPoint: { x: 0.5, y: 0 }, Position: U(0.5, 0, 0.12, 0), Size: U(0.6, 0, 0.17, 0), BackgroundTransparency: 1, Text: 'BLOCK QUEST', TextScaled: true, TextColor3: '#ffffff', FontFace: font('LuckiestGuy') },
        k: [stroke('#1a1030', 5, 'Contextual'), gradient('#fff176', '#ff8a3d', 90)],
      },
      {
        c: 'TextLabel', n: 'Subtitle',
        p: { AnchorPoint: { x: 0.5, y: 0 }, Position: U(0.5, 0, 0.29, 0), Size: U(0.4, 0, 0.045, 0), BackgroundTransparency: 1, Text: 'An adventure built with UI Builder', TextScaled: true, TextColor3: '#c9cdf5', FontFace: font('BuilderSans', 600) },
      },
      {
        c: 'Frame', n: 'Buttons',
        p: { AnchorPoint: { x: 0.5, y: 0 }, Position: U(0.5, 0, 0.41, 0), Size: U(0.22, 0, 0.42, 0), BackgroundTransparency: 1 },
        k: [
          { c: 'UIListLayout', p: { Padding: D(0.05, 0), HorizontalAlignment: 'Center' } },
          ...[button('Play', 'PLAY', '#3ecf5a', '#1e7a31', { LayoutOrder: 1 }), button('Shop', 'SHOP', '#ffb020', '#9a5e00', { LayoutOrder: 2 }), button('Settings', 'SETTINGS', '#4f7cff', '#23409a', { LayoutOrder: 3 })]
            .map((b): Spec => ({ ...b, x: { effects: [fx('hoverScale', 1.06, 0.15), fx('pressScale', 0.94, 0.1)] } })),
        ],
      },
      {
        c: 'Frame', n: 'Coins', p: { AnchorPoint: { x: 1, y: 0 }, Position: U(1, -24, 0, 24), Size: U(0, 190, 0, 56), BackgroundColor3: '#000000', BackgroundTransparency: 0.45 },
        k: [
          corner(0, 0.5), { c: 'UIPadding', p: { PaddingLeft: D(0, 10), PaddingRight: D(0, 16) } },
          { c: 'UIListLayout', p: { FillDirection: 'Horizontal', VerticalAlignment: 'Center', Padding: D(0, 10) } },
          { c: 'Frame', n: 'Icon', p: { Size: U(0, 38, 0, 38), BackgroundColor3: '#ffd23f', LayoutOrder: 1 }, k: [corner(0, 0.5), stroke('#b8860b', 3)], x: { effects: [fx('pulse', 0.08, 1.2)] } },
          { c: 'TextLabel', n: 'Amount', p: { Size: U(1, -48, 0.7, 0), BackgroundTransparency: 1, Text: '1,250', TextColor3: '#ffffff', TextScaled: true, FontFace: font('FredokaOne'), TextXAlignment: 'Left', LayoutOrder: 2 } },
        ],
      },
      {
        c: 'TextLabel', n: 'Version', p: { AnchorPoint: { x: 0, y: 1 }, Position: U(0, 20, 1, -16), Size: U(0, 200, 0, 20), BackgroundTransparency: 1, Text: 'v0.1.0', TextColor3: '#7c80a8', TextSize: 16, TextXAlignment: 'Left', FontFace: font('BuilderSans', 500) },
      },
    ],
  }]);
  const nodes: Record<string, GuiNode> = {};
  for (const n of frag.nodes) nodes[n.id] = n;
  const byName = (name: string) => frag.nodes.find((n) => n.name === name)!.id;
  const tw = (nodeId: string, prop: string, to: any, start: number, duration: number, style: Tween['style'] = 'Sine', direction: Tween['direction'] = 'InOut'): Tween =>
    ({ id: uid(), nodeId, prop, to, start, duration, style, direction });
  const title = byName('Title');
  const play = byName('Play');
  const coins = byName('Coins');
  return {
    nodes,
    rootIds: frag.rootIds,
    device: { name: 'Desktop 1080p', w: 1920, h: 1080 },
    designSize: { w: 1920, h: 1080 },
    showTopbar: true,
    clips: [
      {
        id: uid(), name: 'Intro', trigger: 'load',
        tweens: [
          tw(title, 'Rotation', -4, 0, 0.4),
          tw(title, 'Rotation', 4, 0.4, 0.6),
          tw(title, 'Rotation', 0, 1.0, 0.4),
          tw(play, 'Size', U(1.1, 0, 0.29, 0), 0.2, 0.35, 'Back', 'Out'),
          tw(play, 'Size', U(1, 0, 0.26, 0), 0.55, 0.35, 'Quad', 'Out'),
          tw(coins, 'BackgroundTransparency', 0.1, 0.3, 0.3, 'Quad', 'Out'),
          tw(coins, 'BackgroundTransparency', 0.45, 0.8, 0.5, 'Quad', 'Out'),
        ],
      },
    ],
  };
}
