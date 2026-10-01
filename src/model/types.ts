export interface UDim { s: number; o: number }
export interface UDim2 { x: UDim; y: UDim }
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** Hex string "#rrggbb" */
export type Color = string;
export interface ColorKey { t: number; c: Color }
export interface NumberKey { t: number; v: number }
export interface FontValue { family: string; weight: number; style: 'Normal' | 'Italic' }
export interface RectValue { x0: number; y0: number; x1: number; y1: number }

export type GuiObjectClass =
  | 'Frame'
  | 'ScrollingFrame'
  | 'CanvasGroup'
  | 'TextLabel'
  | 'TextButton'
  | 'TextBox'
  | 'ImageLabel'
  | 'ImageButton'
  | 'ViewportFrame';

export type ModifierClass =
  | 'UICorner'
  | 'UIStroke'
  | 'UIGradient'
  | 'UIPadding'
  | 'UIListLayout'
  | 'UIGridLayout'
  | 'UIAspectRatioConstraint'
  | 'UISizeConstraint'
  | 'UITextSizeConstraint';

/** Top-level containers: the screen, or GUIs that live in the 3D world */
export type RootClass = 'ScreenGui' | 'BillboardGui' | 'SurfaceGui';

export type ClassName = RootClass | GuiObjectClass | ModifierClass;

// ---------------------------------------------------------------------------
// Behaviours (exported as Luau, simulated in Preview)

export type EffectKind = 'lookAtMouse' | 'tiltToMouse' | 'followMouse' | 'hoverScale' | 'pressScale' | 'float' | 'spin' | 'pulse';

export interface Effect {
  id: string;
  kind: EffectKind;
  /** lookAtMouse: angle offset (deg) · tiltToMouse: max angle · followMouse: max distance (px) · hover/press: scale · float: amplitude (px) · spin: deg/s · pulse: amount */
  amount: number;
  /** smoothing speed for mouse effects, duration (s) for hover/press, period (s) for float/pulse */
  speed: number;
  invert?: boolean;
}

export type AvatarKind = 'HeadShot' | 'AvatarBust' | 'AvatarThumbnail';
export interface AvatarConfig {
  kind: AvatarKind;
  size: 48 | 60 | 100 | 150 | 180 | 352 | 420;
}

/** Colour stops along a text's characters (at = 0..1 along the visible characters) */
export interface ColorStop { at: number; color: Color }
export interface TextColors {
  /** segments: hard colour changes · gradient: colours blend letter by letter */
  mode: 'segments' | 'gradient';
  stops: ColorStop[];
}

/** How a toast comes in (and goes out the same way) */
export type ToastEnter = 'slideRight' | 'slideLeft' | 'slideDown' | 'slideUp' | 'fade' | 'pop';

/** Marks an element as a toast template: hidden in game, cloned and animated each time a toast is shown */
export interface ToastConfig {
  /** seconds on screen */
  duration: number;
  enter: ToastEnter;
  /** element whose click shows this toast */
  triggerNodeId?: string;
}

/** Text filled in at runtime from the local player */
export type TextBinding = 'DisplayName' | 'Name' | 'UserId';

export interface GuiNode {
  id: string;
  className: ClassName;
  name: string;
  parentId: string | null;
  children: string[];
  /** Roblox properties keyed by their Roblox name */
  props: Record<string, any>;
  /** Editor-only state (not exported) */
  locked?: boolean;
  preview?: { src: string; w: number; h: number };
  /** Root artboard position on the canvas (BillboardGui / SurfaceGui) */
  artboard?: Vec2;
  /** BillboardGui preview: pixels per stud used to size the artboard */
  previewPPS?: number;
  /** SurfaceGui (PixelsPerStud mode) preview: face size in studs */
  previewStuds?: Vec2;

  /** Exported behaviour */
  effects?: Effect[];
  avatar?: AvatarConfig;
  bind?: TextBinding;
  /** Toast template (hidden in game; shown with ScreenGui.Show<Name>:Fire(title, message)) */
  toast?: ToastConfig;
  /** Multi-colour text (baked into RichText <font color> tags on export) */
  textColors?: TextColors;
  /** BillboardGui / SurfaceGui: path of the part to attach to, e.g. "Workspace.Shop.Sign" */
  adornee?: string;
}

export type EasingStyle =
  | 'Linear' | 'Sine' | 'Quad' | 'Cubic' | 'Quart' | 'Quint'
  | 'Exponential' | 'Circular' | 'Back' | 'Bounce' | 'Elastic';
export type EasingDirection = 'In' | 'Out' | 'InOut';

export interface Tween {
  id: string;
  nodeId: string;
  prop: string;
  to: any;
  start: number;
  duration: number;
  style: EasingStyle;
  direction: EasingDirection;
}

export type TriggerKind = 'load' | 'manual' | 'click' | 'hoverEnter' | 'hoverLeave' | 'pressDown' | 'pressUp';

export interface AnimClip {
  id: string;
  name: string;
  tweens: Tween[];
  /** What starts the animation (default: load) */
  trigger?: TriggerKind;
  /** Element whose events start it (click / hover / press triggers) */
  triggerNodeId?: string;
  loop?: boolean;
  /** Pause between loop repeats, in seconds */
  loopDelay?: number;
  /** 'design' resets animated properties first; 'current' tweens from wherever they are (good for hover) */
  from?: 'design' | 'current';
}

export interface Device { name: string; w: number; h: number }

export interface PreviewUser { id: number; name: string; displayName: string }

export interface Doc {
  nodes: Record<string, GuiNode>;
  rootIds: string[];
  device: Device;
  showTopbar: boolean;
  clips: AnimClip[];
  /** Player shown for avatar images / name bindings in the editor */
  previewUser?: PreviewUser;
  /** Resolution the pixel values (strokes, text size, corners…) were designed at */
  designSize?: { w: number; h: number };
  /** Scale pixel values with the screen size (default on) */
  scalePixels?: boolean;
  /** Generated scripts connect every button's MouseButton1Click to a print (default on) */
  clickPrints?: boolean;
  /** Reference images (editor only: never exported or synced) */
  references?: RefImage[];
}

/** A picture to design against, e.g. a mockup or a screenshot of the game, placed on the canvas */
export interface RefImage {
  id: string;
  name: string;
  /** Pixel data lives in IndexedDB (model/refImages.ts) */
  imageId: string;
  /** Canvas rect (the screen artboard is at 0,0) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Original image size */
  natW: number;
  natH: number;
  opacity: number;
  /** Behind the UI (a background to build on) or over it (to trace / compare) */
  placement: 'behind' | 'over';
  hidden?: boolean;
  locked?: boolean;
}
