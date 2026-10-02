import type { ClassName, GuiObjectClass, ModifierClass, RootClass } from './types';

/** Enum name -> { itemName: tokenValue } (token values match Roblox's XML format) */
export const ENUMS: Record<string, Record<string, number>> = {
  TextXAlignment: { Left: 0, Right: 1, Center: 2 },
  TextYAlignment: { Top: 0, Center: 1, Bottom: 2 },
  FillDirection: { Horizontal: 0, Vertical: 1 },
  HorizontalAlignment: { Center: 0, Left: 1, Right: 2 },
  VerticalAlignment: { Center: 0, Top: 1, Bottom: 2 },
  SortOrder: { Name: 0, Custom: 1, LayoutOrder: 2 },
  ScaleType: { Stretch: 0, Slice: 1, Tile: 2, Fit: 3, Crop: 4 },
  ApplyStrokeMode: { Contextual: 0, Border: 1 },
  LineJoinMode: { Round: 0, Bevel: 1, Miter: 2 },
  DominantAxis: { Width: 0, Height: 1 },
  AspectType: { FitWithinMaxSize: 0, ScaleWithParentSize: 1 },
  ZIndexBehavior: { Global: 0, Sibling: 1 },
  ScrollingDirection: { X: 1, Y: 2, XY: 4 },
  AutomaticSize: { None: 0, X: 1, Y: 2, XY: 3 },
  StartCorner: { TopLeft: 0, TopRight: 1, BottomLeft: 2, BottomRight: 3 },
  NormalId: { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 },
  SurfaceGuiSizingMode: { FixedSize: 0, PixelsPerStud: 1 },
  SizeConstraint: { RelativeXY: 0, RelativeXX: 1, RelativeYY: 2 },
  BorderMode: { Outline: 0, Middle: 1, Inset: 2 },
  TextTruncate: { None: 0, AtEnd: 1, SplitWord: 2 },
  TextDirection: { Auto: 0, LeftToRight: 1, RightToLeft: 2 },
  ResamplerMode: { Default: 0, Pixelated: 1 },
  ScrollBarInset: { None: 0, ScrollBar: 1, Always: 2 },
  VerticalScrollBarPosition: { Right: 0, Left: 1 },
  ElasticBehavior: { WhenScrollable: 0, Always: 1, Never: 2 },
  ScreenInsets: { None: 0, DeviceSafeInsets: 1, CoreUISafeInsets: 2, TopbarSafeInsets: 3 },
  SafeAreaCompatibility: { None: 0, FullscreenExtension: 1 },
  SelectionBehavior: { Escape: 0, Stop: 1 },
  UIDragDetectorDragStyle: { TranslatePlane: 0, TranslateLine: 1, Rotate: 2, Scriptable: 3 },
  UIDragDetectorResponseStyle: { Offset: 0, Scale: 1, CustomOffset: 2, CustomScale: 3 },
  UIDragDetectorBoundingBehavior: { Automatic: 0, EntireObject: 1, HitPoint: 2 },
  UIDragDetectorDragRelativity: { Absolute: 0, Relative: 1 },
  UIDragDetectorDragSpace: { Parent: 0, LayerCollector: 1, Reference: 2 },
  ApplyShadowMode: { Shape: 0, Text: 1 },
  BorderStrokePosition: { Outer: 0, Center: 1, Inner: 2 },
  StrokeSizingMode: { FixedSize: 0, ScaledSize: 1 },
  GradientType: { Linear: 0, Radial: 1, Conical: 2, Elliptical: 3 },
  GradientTileMode: { Clamp: 0, Repeat: 1, Mirror: 2 },
  UIFlexAlignment: { None: 0, Fill: 1, SpaceAround: 2, SpaceBetween: 3, SpaceEvenly: 4 },
  UIFlexMode: { None: 0, Grow: 1, Shrink: 2, Fill: 3, Custom: 4 },
  ItemLineAlignment: { Automatic: 0, Start: 1, Center: 2, End: 3, Stretch: 4 },
  TableMajorAxis: { RowMajor: 0, ColumnMajor: 1 },
  EasingStyle: { Linear: 0, Sine: 1, Back: 2, Quad: 3, Quart: 4, Quint: 5, Bounce: 6, Elastic: 7, Exponential: 8, Circular: 9, Cubic: 10 },
  EasingDirection: { In: 0, Out: 1, InOut: 2 },
};

export type PropType =
  | 'UDim2' | 'UDim' | 'Vector2' | 'Vector3' | 'float' | 'int' | 'bool' | 'Color3'
  | 'string' | 'enum' | 'Content' | 'Font' | 'ColorSequence' | 'NumberSequence' | 'Rect';

export interface PropDef {
  name: string;
  type: PropType;
  default: any;
  enumType?: string;
  /** Always emit when exporting (Instance.new defaults differ from Studio insert defaults) */
  always?: boolean;
  min?: number;
  max?: number;
  step?: number;
  multiline?: boolean;
  /** Only written when set (e.g. UICorner's per-corner radii, which override CornerRadius) */
  optional?: boolean;
  animatable?: boolean;
}

const u2 = (xs: number, xo: number, ys: number, yo: number) => ({ x: { s: xs, o: xo }, y: { s: ys, o: yo } });

const P = (name: string, type: PropType, def: any, extra: Partial<PropDef> = {}): PropDef => ({ name, type, default: def, ...extra });

const GUI_OBJECT: PropDef[] = [
  P('AnchorPoint', 'Vector2', { x: 0, y: 0 }, { step: 0.5 }),
  P('Position', 'UDim2', u2(0, 0, 0, 0), { animatable: true }),
  P('Size', 'UDim2', u2(0, 0, 0, 0), { always: true, animatable: true }),
  P('AutomaticSize', 'enum', 'None', { enumType: 'AutomaticSize' }),
  P('SizeConstraint', 'enum', 'RelativeXY', { enumType: 'SizeConstraint' }),
  P('Rotation', 'float', 0, { animatable: true }),
  P('ZIndex', 'int', 1),
  P('LayoutOrder', 'int', 0),
  P('Visible', 'bool', true),
  P('ClipsDescendants', 'bool', false),
  P('BackgroundColor3', 'Color3', '#a3a2a5', { always: true, animatable: true }),
  P('BackgroundTransparency', 'float', 0, { always: true, min: 0, max: 1, step: 0.05, animatable: true }),
  P('BorderSizePixel', 'int', 1, { always: true, min: 0 }),
  P('BorderColor3', 'Color3', '#1b2a35'),
  P('BorderMode', 'enum', 'Outline', { enumType: 'BorderMode' }),
  P('Interactable', 'bool', true),
  // gamepad / keyboard navigation
  P('Selectable', 'bool', false),
  P('SelectionOrder', 'int', 0),
  P('SelectionGroup', 'bool', false),
  P('SelectionBehaviorUp', 'enum', 'Escape', { enumType: 'SelectionBehavior' }),
  P('SelectionBehaviorDown', 'enum', 'Escape', { enumType: 'SelectionBehavior' }),
  P('SelectionBehaviorLeft', 'enum', 'Escape', { enumType: 'SelectionBehavior' }),
  P('SelectionBehaviorRight', 'enum', 'Escape', { enumType: 'SelectionBehavior' }),
];

const TEXT: PropDef[] = [
  P('Text', 'string', 'Label', { always: true, multiline: true }),
  P('FontFace', 'Font', { family: 'LegacyArial', weight: 400, style: 'Normal' }, { always: true }),
  P('TextSize', 'float', 14, { always: true, min: 1, max: 100 }),
  P('TextColor3', 'Color3', '#1b2a35', { always: true, animatable: true }),
  P('TextTransparency', 'float', 0, { min: 0, max: 1, step: 0.05, animatable: true }),
  P('TextScaled', 'bool', false),
  P('TextWrapped', 'bool', false),
  P('RichText', 'bool', false),
  P('TextXAlignment', 'enum', 'Center', { enumType: 'TextXAlignment' }),
  P('TextYAlignment', 'enum', 'Center', { enumType: 'TextYAlignment' }),
  P('LineHeight', 'float', 1, { min: 0.5, max: 3, step: 0.1 }),
  P('TextStrokeColor3', 'Color3', '#000000'),
  P('TextStrokeTransparency', 'float', 1, { min: 0, max: 1, step: 0.05, animatable: true }),
  P('TextTruncate', 'enum', 'None', { enumType: 'TextTruncate' }),
  P('MaxVisibleGraphemes', 'int', -1, { min: -1 }),
  P('TextDirection', 'enum', 'Auto', { enumType: 'TextDirection' }),
];

const IMAGE: PropDef[] = [
  P('Image', 'Content', ''),
  P('ImageColor3', 'Color3', '#ffffff', { animatable: true }),
  P('ImageTransparency', 'float', 0, { min: 0, max: 1, step: 0.05, animatable: true }),
  P('ScaleType', 'enum', 'Stretch', { enumType: 'ScaleType' }),
  P('SliceCenter', 'Rect', { x0: 0, y0: 0, x1: 0, y1: 0 }),
  P('SliceScale', 'float', 1, { min: 0.01, step: 0.1 }),
  P('TileSize', 'UDim2', u2(1, 0, 1, 0)),
];

const BUTTON: PropDef[] = [
  P('AutoButtonColor', 'bool', true),
  P('Modal', 'bool', false),
  P('Selected', 'bool', false),
];
/** Buttons and text boxes can be picked with a gamepad by default */
const selectableByDefault = (defs: PropDef[]) => defs.map((p) => (p.name === 'Selectable' ? { ...p, default: true } : p));
const SPRITE: PropDef[] = [
  P('ImageRectOffset', 'Vector2', { x: 0, y: 0 }),
  P('ImageRectSize', 'Vector2', { x: 0, y: 0 }),
  P('ResampleMode', 'enum', 'Default', { enumType: 'ResamplerMode' }),
];

export const CLASS_PROPS: Record<ClassName, PropDef[]> = {
  ScreenGui: [
    P('Enabled', 'bool', true),
    P('IgnoreGuiInset', 'bool', false),
    P('ScreenInsets', 'enum', 'CoreUISafeInsets', { enumType: 'ScreenInsets' }),
    P('ClipToDeviceSafeArea', 'bool', true),
    P('SafeAreaCompatibility', 'enum', 'FullscreenExtension', { enumType: 'SafeAreaCompatibility' }),
    P('ResetOnSpawn', 'bool', true),
    P('ZIndexBehavior', 'enum', 'Sibling', { enumType: 'ZIndexBehavior', always: true }),
    P('DisplayOrder', 'int', 0),
  ],
  Frame: [...GUI_OBJECT],
  ScrollingFrame: [
    ...GUI_OBJECT,
    P('CanvasSize', 'UDim2', u2(0, 0, 2, 0)),
    P('CanvasPosition', 'Vector2', { x: 0, y: 0 }),
    P('AutomaticCanvasSize', 'enum', 'None', { enumType: 'AutomaticSize' }),
    P('ScrollingDirection', 'enum', 'XY', { enumType: 'ScrollingDirection' }),
    P('ScrollBarThickness', 'int', 12, { min: 0 }),
    P('ScrollBarImageColor3', 'Color3', '#000000'),
    P('ScrollBarImageTransparency', 'float', 0, { min: 0, max: 1, step: 0.05 }),
    P('ScrollingEnabled', 'bool', true),
    P('VerticalScrollBarPosition', 'enum', 'Right', { enumType: 'VerticalScrollBarPosition' }),
    P('VerticalScrollBarInset', 'enum', 'None', { enumType: 'ScrollBarInset' }),
    P('HorizontalScrollBarInset', 'enum', 'None', { enumType: 'ScrollBarInset' }),
    P('ElasticBehavior', 'enum', 'WhenScrollable', { enumType: 'ElasticBehavior' }),
    P('TopImage', 'Content', 'rbxasset://textures/ui/Scroll/scroll-top.png'),
    P('MidImage', 'Content', 'rbxasset://textures/ui/Scroll/scroll-middle.png'),
    P('BottomImage', 'Content', 'rbxasset://textures/ui/Scroll/scroll-bottom.png'),
  ],
  CanvasGroup: [
    ...GUI_OBJECT,
    P('GroupTransparency', 'float', 0, { min: 0, max: 1, step: 0.05, animatable: true }),
    P('GroupColor3', 'Color3', '#ffffff', { animatable: true }),
  ],
  TextLabel: [...GUI_OBJECT, ...TEXT],
  TextButton: [...selectableByDefault(GUI_OBJECT), ...TEXT.map((p) => (p.name === 'Text' ? { ...p, default: 'Button' } : p)), ...BUTTON],
  TextBox: [
    ...selectableByDefault(GUI_OBJECT),
    ...TEXT.map((p) => (p.name === 'Text' ? { ...p, default: '' } : p)),
    P('PlaceholderText', 'string', ''),
    P('PlaceholderColor3', 'Color3', '#b2b2b2'),
    P('ClearTextOnFocus', 'bool', true),
    P('MultiLine', 'bool', false),
    P('TextEditable', 'bool', true),
  ],
  ImageLabel: [...GUI_OBJECT, ...IMAGE, ...SPRITE],
  ImageButton: [
    ...selectableByDefault(GUI_OBJECT), ...IMAGE, ...SPRITE,
    P('HoverImage', 'Content', ''),
    P('PressedImage', 'Content', ''),
    ...BUTTON,
  ],
  // video in UI (Roblox video assets can't be played here: shown as a placeholder)
  VideoFrame: [
    ...GUI_OBJECT,
    P('Video', 'Content', ''),
    P('Looped', 'bool', false),
    P('Playing', 'bool', false),
    P('Volume', 'float', 1, { min: 0, max: 10, step: 0.1 }),
  ],
  ViewportFrame: [
    ...GUI_OBJECT,
    P('Ambient', 'Color3', '#c8c8c8'),
    P('LightColor', 'Color3', '#8c8c8c'),
    P('ImageColor3', 'Color3', '#ffffff'),
    P('ImageTransparency', 'float', 0, { min: 0, max: 1, step: 0.05 }),
  ],
  BillboardGui: [
    P('Enabled', 'bool', true),
    P('Size', 'UDim2', u2(0, 0, 0, 0), { always: true }),
    P('StudsOffset', 'Vector3', { x: 0, y: 0, z: 0 }, { step: 0.5 }),
    P('StudsOffsetWorldSpace', 'Vector3', { x: 0, y: 0, z: 0 }, { step: 0.5 }),
    P('SizeOffset', 'Vector2', { x: 0, y: 0 }, { step: 0.1 }),
    P('AlwaysOnTop', 'bool', false),
    P('MaxDistance', 'float', Infinity, { min: 0 }),
    P('LightInfluence', 'float', 1, { min: 0, max: 1, step: 0.1 }),
    P('Brightness', 'float', 1, { min: 0, step: 0.1 }),
    P('Active', 'bool', false),
    P('ClipsDescendants', 'bool', false),
    P('ResetOnSpawn', 'bool', true),
    P('ZIndexBehavior', 'enum', 'Sibling', { enumType: 'ZIndexBehavior', always: true }),
  ],
  SurfaceGui: [
    P('Enabled', 'bool', true),
    P('Face', 'enum', 'Front', { enumType: 'NormalId', always: true }),
    P('SizingMode', 'enum', 'FixedSize', { enumType: 'SurfaceGuiSizingMode', always: true }),
    P('CanvasSize', 'Vector2', { x: 800, y: 600 }, { always: true }),
    P('PixelsPerStud', 'float', 50, { min: 1 }),
    P('AlwaysOnTop', 'bool', false),
    P('LightInfluence', 'float', 1, { min: 0, max: 1, step: 0.1 }),
    P('Brightness', 'float', 1, { min: 0, step: 0.1 }),
    P('ZOffset', 'float', 0, { step: 0.1 }),
    P('Active', 'bool', true),
    P('ResetOnSpawn', 'bool', true),
    P('ZIndexBehavior', 'enum', 'Sibling', { enumType: 'ZIndexBehavior', always: true }),
  ],
  UICorner: [
    P('CornerRadius', 'UDim', { s: 0, o: 8 }, { always: true }),
    P('TopLeftRadius', 'UDim', { s: 0, o: 8 }, { always: true, optional: true }),
    P('TopRightRadius', 'UDim', { s: 0, o: 8 }, { always: true, optional: true }),
    P('BottomRightRadius', 'UDim', { s: 0, o: 8 }, { always: true, optional: true }),
    P('BottomLeftRadius', 'UDim', { s: 0, o: 8 }, { always: true, optional: true }),
  ],
  UIStroke: [
    P('Color', 'Color3', '#000000', { always: true }),
    P('Thickness', 'float', 1, { always: true, min: 0, step: 0.5 }),
    P('Transparency', 'float', 0, { min: 0, max: 1, step: 0.05 }),
    P('ApplyStrokeMode', 'enum', 'Contextual', { enumType: 'ApplyStrokeMode' }),
    P('LineJoinMode', 'enum', 'Round', { enumType: 'LineJoinMode' }),
    P('BorderStrokePosition', 'enum', 'Outer', { enumType: 'BorderStrokePosition' }),
    P('BorderOffset', 'UDim', { s: 0, o: 0 }),
    P('StrokeSizingMode', 'enum', 'FixedSize', { enumType: 'StrokeSizingMode' }),
    P('ZIndex', 'int', 1),
    P('Enabled', 'bool', true),
  ],
  UIGradient: [
    P('Color', 'ColorSequence', [{ t: 0, c: '#ffffff' }, { t: 1, c: '#ffffff' }]),
    P('Transparency', 'NumberSequence', [{ t: 0, v: 0 }, { t: 1, v: 0 }]),
    P('Rotation', 'float', 0),
    P('Offset', 'Vector2', { x: 0, y: 0 }, { step: 0.05 }),
    P('Type', 'enum', 'Linear', { enumType: 'GradientType' }),
    P('Scale', 'float', 1, { min: 0.01, step: 0.05 }),
    P('TileMode', 'enum', 'Clamp', { enumType: 'GradientTileMode' }),
    P('Enabled', 'bool', true),
  ],
  UIPadding: [
    P('PaddingTop', 'UDim', { s: 0, o: 0 }),
    P('PaddingBottom', 'UDim', { s: 0, o: 0 }),
    P('PaddingLeft', 'UDim', { s: 0, o: 0 }),
    P('PaddingRight', 'UDim', { s: 0, o: 0 }),
  ],
  UIListLayout: [
    P('FillDirection', 'enum', 'Vertical', { enumType: 'FillDirection', always: true }),
    P('Padding', 'UDim', { s: 0, o: 0 }),
    P('HorizontalAlignment', 'enum', 'Left', { enumType: 'HorizontalAlignment' }),
    P('VerticalAlignment', 'enum', 'Top', { enumType: 'VerticalAlignment' }),
    P('SortOrder', 'enum', 'LayoutOrder', { enumType: 'SortOrder', always: true }),
    P('HorizontalFlex', 'enum', 'None', { enumType: 'UIFlexAlignment' }),
    P('VerticalFlex', 'enum', 'None', { enumType: 'UIFlexAlignment' }),
    P('ItemLineAlignment', 'enum', 'Automatic', { enumType: 'ItemLineAlignment' }),
    P('Wraps', 'bool', false),
  ],
  UIGridLayout: [
    P('CellSize', 'UDim2', u2(0, 100, 0, 100), { always: true }),
    P('CellPadding', 'UDim2', u2(0, 5, 0, 5), { always: true }),
    P('FillDirection', 'enum', 'Horizontal', { enumType: 'FillDirection' }),
    P('FillDirectionMaxCells', 'int', 0, { min: 0 }),
    P('HorizontalAlignment', 'enum', 'Left', { enumType: 'HorizontalAlignment' }),
    P('VerticalAlignment', 'enum', 'Top', { enumType: 'VerticalAlignment' }),
    P('SortOrder', 'enum', 'LayoutOrder', { enumType: 'SortOrder', always: true }),
    P('StartCorner', 'enum', 'TopLeft', { enumType: 'StartCorner' }),
  ],
  UIAspectRatioConstraint: [
    P('AspectRatio', 'float', 1, { min: 0.01, step: 0.1 }),
    P('AspectType', 'enum', 'FitWithinMaxSize', { enumType: 'AspectType' }),
    P('DominantAxis', 'enum', 'Width', { enumType: 'DominantAxis' }),
  ],
  UISizeConstraint: [
    P('MinSize', 'Vector2', { x: 0, y: 0 }),
    P('MaxSize', 'Vector2', { x: Infinity, y: Infinity }),
  ],
  UITextSizeConstraint: [
    P('MinTextSize', 'int', 1, { min: 1, max: 100 }),
    P('MaxTextSize', 'int', 100, { min: 1, max: 100 }),
  ],
  UIScale: [
    P('Scale', 'float', 1, { min: 0, step: 0.05 }),
  ],
  UIShadow: [
    P('Enabled', 'bool', true),
    P('Color', 'Color3', '#000000'),
    P('Transparency', 'float', 0, { min: 0, max: 1, step: 0.05 }),
    P('BlurRadius', 'UDim', { s: 0, o: 0 }),
    P('Offset', 'UDim2', { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } }),
    P('Spread', 'UDim2', { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } }),
    P('Mode', 'enum', 'Shape', { enumType: 'ApplyShadowMode' }),
    P('Inset', 'bool', false),
    P('ShowBehindParent', 'bool', true),
    P('ZIndex', 'int', -1),
  ],
  // How an item in a UIListLayout grows / shrinks to fill its line
  UIFlexItem: [
    P('FlexMode', 'enum', 'None', { enumType: 'UIFlexMode' }),
    P('GrowRatio', 'float', 0, { min: 0, step: 0.5 }),
    P('ShrinkRatio', 'float', 0, { min: 0, step: 0.5 }),
    P('ItemLineAlignment', 'enum', 'Automatic', { enumType: 'ItemLineAlignment' }),
  ],
  // One child at a time, like pages (Next / Previous / JumpTo from events or scripts)
  UIPageLayout: [
    P('FillDirection', 'enum', 'Horizontal', { enumType: 'FillDirection', always: true }),
    P('HorizontalAlignment', 'enum', 'Center', { enumType: 'HorizontalAlignment', always: true }),
    P('VerticalAlignment', 'enum', 'Center', { enumType: 'VerticalAlignment', always: true }),
    P('SortOrder', 'enum', 'LayoutOrder', { enumType: 'SortOrder', always: true }),
    P('Padding', 'UDim', { s: 0, o: 0 }),
    P('Animated', 'bool', true),
    P('Circular', 'bool', false),
    P('TweenTime', 'float', 1, { min: 0, step: 0.1 }),
    P('EasingStyle', 'enum', 'Back', { enumType: 'EasingStyle' }),
    P('EasingDirection', 'enum', 'Out', { enumType: 'EasingDirection' }),
    P('ScrollWheelInputEnabled', 'bool', true),
    P('TouchInputEnabled', 'bool', true),
    P('GamepadInputEnabled', 'bool', true),
  ],
  // Children are rows (or columns) and their children are the cells
  UITableLayout: [
    P('MajorAxis', 'enum', 'RowMajor', { enumType: 'TableMajorAxis' }),
    P('Padding', 'UDim2', { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } }),
    P('FillEmptySpaceColumns', 'bool', false),
    P('FillEmptySpaceRows', 'bool', false),
    P('HorizontalAlignment', 'enum', 'Left', { enumType: 'HorizontalAlignment', always: true }),
    P('VerticalAlignment', 'enum', 'Top', { enumType: 'VerticalAlignment', always: true }),
    P('SortOrder', 'enum', 'LayoutOrder', { enumType: 'SortOrder', always: true }),
  ],
  // A line / curve in its parent's space (points are on the node, set with SetControlPoints)
  Path2D: [
    P('Color3', 'Color3', '#000000', { always: true }),
    P('Thickness', 'float', 1, { always: true, min: 0, step: 0.5 }),
    P('Transparency', 'float', 0, { min: 0, max: 1, step: 0.05 }),
    P('Closed', 'bool', false),
    P('ZIndex', 'int', 1),
    P('Visible', 'bool', true),
  ],
  // Makes its parent draggable in game, no script needed
  UIDragDetector: [
    P('Enabled', 'bool', true),
    P('DragStyle', 'enum', 'TranslatePlane', { enumType: 'UIDragDetectorDragStyle' }),
    P('DragAxis', 'Vector2', { x: 1, y: 0 }, { step: 0.1 }),
    P('ResponseStyle', 'enum', 'Offset', { enumType: 'UIDragDetectorResponseStyle' }),
    P('BoundingBehavior', 'enum', 'Automatic', { enumType: 'UIDragDetectorBoundingBehavior' }),
    P('DragRelativity', 'enum', 'Absolute', { enumType: 'UIDragDetectorDragRelativity' }),
    P('DragSpace', 'enum', 'Parent', { enumType: 'UIDragDetectorDragSpace' }),
    P('MinDragTranslation', 'UDim2', { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } }),
    P('MaxDragTranslation', 'UDim2', { x: { s: 0, o: 0 }, y: { s: 0, o: 0 } }),
    P('MinDragAngle', 'float', 0, { step: 5 }),
    P('MaxDragAngle', 'float', 0, { step: 5 }),
  ],
};

export const GUI_OBJECT_CLASSES: GuiObjectClass[] = [
  'Frame', 'ScrollingFrame', 'CanvasGroup', 'TextLabel', 'TextButton', 'TextBox', 'ImageLabel', 'ImageButton', 'ViewportFrame', 'VideoFrame',
];
export const MODIFIER_CLASSES: ModifierClass[] = [
  'UICorner', 'UIStroke', 'UIGradient', 'UIPadding', 'UIListLayout', 'UIGridLayout',
  'UIAspectRatioConstraint', 'UISizeConstraint', 'UITextSizeConstraint', 'UIScale', 'UIDragDetector',
  'UIShadow', 'UIFlexItem', 'UIPageLayout', 'UITableLayout',
];

/** Only one of these lays out a frame's children */
export const LAYOUT_CLASSES: ModifierClass[] = ['UIListLayout', 'UIGridLayout', 'UIPageLayout', 'UITableLayout'];
export const TEXT_CLASSES: ClassName[] = ['TextLabel', 'TextButton', 'TextBox'];
export const IMAGE_CLASSES: ClassName[] = ['ImageLabel', 'ImageButton'];
/** Elements a gamepad can move between by default */
export const SELECTABLE_BY_DEFAULT: ClassName[] = ['TextButton', 'ImageButton', 'TextBox'];
export const CONTAINER_CLASSES: ClassName[] = ['Frame', 'ScrollingFrame', 'CanvasGroup'];
export const ROOT_CLASSES: RootClass[] = ['ScreenGui', 'BillboardGui', 'SurfaceGui'];
export const isRoot = (c?: ClassName) => !!c && (ROOT_CLASSES as string[]).includes(c);
/** BillboardGui / SurfaceGui: rendered on their own artboard instead of the device screen */
export const isWorldGui = (c: ClassName) => c === 'BillboardGui' || c === 'SurfaceGui';

export const isGuiObject = (c: ClassName) => (GUI_OBJECT_CLASSES as string[]).includes(c);
export const isModifier = (c: ClassName) => (MODIFIER_CLASSES as string[]).includes(c);
export const isText = (c: ClassName) => TEXT_CLASSES.includes(c);
export const isImage = (c: ClassName) => IMAGE_CLASSES.includes(c);

export function propDef(className: ClassName, name: string): PropDef | undefined {
  return CLASS_PROPS[className]?.find((p) => p.name === name);
}

export function hasProp(className: ClassName, name: string) {
  return !!propDef(className, name);
}

/** Whether a modifier can be parented to a given class */
export function modifierAllowed(mod: ModifierClass, parent: ClassName) {
  if (mod === 'UITextSizeConstraint') return isText(parent);
  if (isRoot(parent)) return LAYOUT_CLASSES.includes(mod) || mod === 'UIPadding';
  return isGuiObject(parent);
}

/** Only one of each of these modifiers is honoured by Roblox */
export const SINGLETON_MODIFIERS: ModifierClass[] = MODIFIER_CLASSES.filter((c) => c !== 'UIStroke' && c !== 'UIShadow');

/** Values applied when inserting a new instance in the editor (Studio-like defaults) */
export function insertDefaults(c: ClassName): Record<string, any> {
  const white = '#ffffff';
  const font = { family: 'BuilderSans', weight: 500, style: 'Normal' };
  switch (c) {
    case 'ScreenGui':
      return { ZIndexBehavior: 'Sibling', ResetOnSpawn: false, IgnoreGuiInset: false };
    case 'BillboardGui':
      return { Size: u2(4, 0, 1, 0), StudsOffset: { x: 0, y: 3, z: 0 }, LightInfluence: 0, ResetOnSpawn: false, Active: true, MaxDistance: 100 };
    case 'SurfaceGui':
      return { CanvasSize: { x: 800, y: 600 }, LightInfluence: 0, ResetOnSpawn: false };
    case 'Frame':
    case 'CanvasGroup':
      return { Size: u2(0, 100, 0, 100), BackgroundColor3: white, BorderSizePixel: 0 };
    case 'ScrollingFrame':
      return { Size: u2(0, 200, 0, 200), BackgroundColor3: white, BorderSizePixel: 0, ScrollBarThickness: 6, ScrollBarImageColor3: '#000000', ScrollBarImageTransparency: 0.5 };
    case 'TextLabel':
      return { Size: u2(0, 200, 0, 50), BackgroundColor3: white, BackgroundTransparency: 1, BorderSizePixel: 0, Text: 'Label', TextSize: 24, TextColor3: '#000000', FontFace: font };
    case 'TextButton':
      return { Size: u2(0, 200, 0, 50), BackgroundColor3: white, BorderSizePixel: 0, Text: 'Button', TextSize: 20, TextColor3: '#000000', FontFace: font };
    case 'TextBox':
      return { Size: u2(0, 200, 0, 50), BackgroundColor3: white, BorderSizePixel: 0, Text: '', PlaceholderText: 'Type here...', TextSize: 20, TextColor3: '#000000', FontFace: font, ClearTextOnFocus: false };
    case 'ImageLabel':
    case 'ImageButton':
      return { Size: u2(0, 100, 0, 100), BackgroundColor3: white, BackgroundTransparency: 1, BorderSizePixel: 0 };
    case 'VideoFrame':
      return { Size: u2(0, 320, 0, 180), BackgroundColor3: '#000000', BorderSizePixel: 0 };
    case 'ViewportFrame':
      return { Size: u2(0, 200, 0, 200), BackgroundColor3: '#1e1e1e', BorderSizePixel: 0 };
    case 'UICorner':
      return { CornerRadius: { s: 0, o: 8 } };
    case 'UIStroke':
      return { Color: '#000000', Thickness: 2 };
    case 'UIGradient':
      return { Color: [{ t: 0, c: '#ffffff' }, { t: 1, c: '#7a7a7a' }], Rotation: 90 };
    case 'UIPadding':
      return { PaddingTop: { s: 0, o: 8 }, PaddingBottom: { s: 0, o: 8 }, PaddingLeft: { s: 0, o: 8 }, PaddingRight: { s: 0, o: 8 } };
    case 'UIListLayout':
      return { Padding: { s: 0, o: 8 } };
    case 'Path2D':
      return { Color3: '#ffffff', Thickness: 4 };
    case 'UIShadow':
      return { BlurRadius: { s: 0, o: 16 }, Offset: { x: { s: 0, o: 0 }, y: { s: 0, o: 6 } }, Transparency: 0.55 };
    case 'UIFlexItem':
      return { FlexMode: 'Fill' };
    case 'UITableLayout':
      return { Padding: { x: { s: 0, o: 6 }, y: { s: 0, o: 6 } } };
    default:
      return {};
  }
}

export function defaultProps(c: ClassName): Record<string, any> {
  const out: Record<string, any> = {};
  for (const p of CLASS_PROPS[c]) if (!p.optional) out[p.name] = structuredClone(p.default);
  return { ...out, ...structuredClone(insertDefaults(c)) };
}

export const DEVICES = [
  { name: 'Desktop 1080p', w: 1920, h: 1080 },
  { name: 'Laptop', w: 1366, h: 768 },
  { name: 'Tablet', w: 1024, h: 768 },
  { name: 'iPad Pro', w: 1366, h: 1024 },
  { name: 'Phone (landscape)', w: 844, h: 390, safe: { l: 47, t: 0, r: 47, b: 21 } },
  { name: 'Small phone', w: 667, h: 375 },
  { name: 'Phone (portrait)', w: 390, h: 844, safe: { l: 0, t: 47, r: 0, b: 34 } },
  { name: 'Console (TV)', w: 1920, h: 1080 },
];

/** Height of the Roblox top bar inset (in pixels) */
export const TOPBAR_INSET = 58;

export const ANIMATABLE_PROPS = [
  'Position', 'Size', 'Rotation', 'BackgroundColor3', 'BackgroundTransparency',
  'TextColor3', 'TextTransparency', 'TextStrokeTransparency', 'ImageColor3', 'ImageTransparency',
  'GroupTransparency', 'GroupColor3',
  // typewriter text
  'MaxVisibleGraphemes',
  // UIScale
  'Scale',
];

/** UICorner's per-corner radii (optional: they override CornerRadius when set) */
export const CORNER_PROPS = ['TopLeftRadius', 'TopRightRadius', 'BottomRightRadius', 'BottomLeftRadius'] as const;
