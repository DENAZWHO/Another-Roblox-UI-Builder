// Every keyboard shortcut and mouse gesture in the editor, shown in the shortcuts sheet (press ? or Ctrl+/).
// Keep in sync with the handlers in App.tsx (keys), Canvas.tsx (canvas gestures), fields.tsx and Timeline.tsx.

/** One way to trigger an action: a list of keys pressed together, e.g. ['Mod', 'Shift', 'Z'] */
export type Combo = string[];

export interface Shortcut {
  label: string;
  /** Alternatives, any of which works */
  combos: Combo[];
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Display text for a key token. 'Mod' is Ctrl on Windows/Linux and ⌘ on Mac. */
export function keyLabel(k: string): string {
  if (isMac) {
    const mac: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Backspace: '⌫', Delete: '⌦', Esc: 'Esc' };
    if (mac[k]) return mac[k];
  }
  return k === 'Mod' ? 'Ctrl' : k;
}

const one = (...keys: string[]): Combo[] => [keys];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      { label: 'Move / select', combos: one('V') },
      { label: 'Hand (pan)', combos: [['H'], ['Space', 'Drag']] },
      { label: 'Pick colour from the screen', combos: one('C'), note: 'applies to the selection (fill, or text / image colour when it has no fill). Firefox / Safari: picks from a snapshot of the page, Esc or right-click cancels' },
      { label: 'Frame', combos: [['F'], ['R']] },
      { label: 'ScrollingFrame', combos: one('S') },
      { label: 'CanvasGroup', combos: one('G') },
      { label: 'TextLabel', combos: one('T') },
      { label: 'TextButton', combos: one('B') },
      { label: 'TextBox', combos: one('X') },
      { label: 'ImageLabel', combos: one('I') },
      { label: 'ImageButton', combos: one('U') },
      { label: 'Back to Move tool', combos: one('Esc'), note: 'while a drawing tool is active' },
      { label: 'Keep drawing with the same tool', combos: one('Shift', 'Draw') },
    ],
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', combos: one('Mod', 'Z') },
      { label: 'Redo', combos: [['Mod', 'Shift', 'Z'], ['Mod', 'Y']] },
      { label: 'Copy', combos: one('Mod', 'C') },
      { label: 'Cut', combos: one('Mod', 'X') },
      { label: 'Paste', combos: one('Mod', 'V'), note: 'into the selected frame, or next to the original' },
      { label: 'Paste an image as a reference', combos: one('Mod', 'V'), note: 'with a picture on the clipboard (e.g. a screenshot)' },
      { label: 'Duplicate', combos: one('Mod', 'D') },
      { label: 'Delete', combos: [['Delete'], ['Backspace']] },
      { label: 'Group into a Frame', combos: one('Mod', 'G') },
      { label: 'Save selection as a prefab', combos: one('Mod', 'Alt', 'K') },
      { label: 'Move into a frame', combos: one('Drag', 'onto the frame'), note: 'drag out of it to move it back out' },
      { label: 'Ungroup', combos: one('Mod', 'Shift', 'G') },
      { label: 'Hide / show', combos: one('Mod', 'Shift', 'H') },
      { label: 'Lock / unlock', combos: one('Mod', 'Shift', 'L') },
      { label: 'Edit text on the canvas', combos: one('Double-click'), note: 'on a text element' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { label: 'Select (at the current depth)', combos: one('Click') },
      { label: 'Add / remove from selection', combos: one('Shift', 'Click') },
      { label: 'Select the deepest element', combos: one('Mod', 'Click') },
      { label: 'Drill into a frame', combos: one('Double-click') },
      { label: 'Select area', combos: one('Drag', 'on empty space') },
      { label: 'Select all siblings', combos: one('Mod', 'A') },
      { label: 'Select children', combos: one('Enter') },
      { label: 'Select parent', combos: one('Shift', 'Enter') },
      { label: 'Select parent / clear selection', combos: one('Esc') },
      { label: 'Context menu', combos: one('Right-click') },
    ],
  },
  {
    title: 'Move & resize',
    items: [
      { label: 'Nudge 1px', combos: one('Arrows') },
      { label: 'Nudge 10px', combos: one('Shift', 'Arrows') },
      { label: 'Lock to one axis while moving', combos: one('Shift', 'Drag') },
      { label: 'Keep proportions while resizing', combos: one('Shift', 'Drag handle') },
      { label: 'Resize from the centre', combos: one('Alt', 'Drag handle') },
      { label: 'Turn off snapping', combos: one('Mod', 'Drag') },
      { label: 'Rotate', combos: one('Drag', 'just outside a corner') },
      { label: 'Rotate in 15° steps', combos: one('Shift', 'Rotate') },
      { label: 'Round corners', combos: one('Drag', 'a corner dot') },
      { label: 'Round corners in 4px steps', combos: one('Shift', 'Drag corner dot') },
      { label: 'Move a Billboard/SurfaceGui artboard', combos: one('Drag', 'its label') },
      { label: 'Reorder inside a stack (UIListLayout / UIGridLayout)', combos: [['Drag'], ['Arrows']], note: 'drag outside the frame to take it out' },
    ],
  },
  {
    title: 'Arrange',
    items: [
      { label: 'Bring forward', combos: one(']') },
      { label: 'Send backward', combos: one('[') },
      { label: 'Bring to front', combos: one('Mod', ']') },
      { label: 'Send to back', combos: one('Mod', '[') },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Pan', combos: [['Wheel'], ['Space', 'Drag'], ['Middle-drag']] },
      { label: 'Pan sideways', combos: one('Shift', 'Wheel') },
      { label: 'Zoom', combos: [['Mod', 'Wheel'], ['Pinch']] },
      { label: 'Zoom in', combos: one('Mod', '+') },
      { label: 'Zoom out', combos: one('Mod', '-') },
      { label: 'Zoom to 100%', combos: [['Mod', '0'], ['Shift', '0']] },
      { label: 'Zoom to fit everything', combos: one('Shift', '1') },
      { label: 'Zoom to selection', combos: one('Shift', '2') },
      { label: 'Show / hide reference images', combos: one('Shift', 'R') },
      { label: 'Add a reference image', combos: one('Drop', 'an image file on the canvas') },
    ],
  },
  {
    title: 'Animate',
    items: [
      { label: 'Switch Design / Animate mode', combos: one('Alt', 'A') },
      { label: 'Play / pause', combos: one('K'), note: 'in Animate mode' },
      { label: 'Scrub the timeline', combos: one('Drag', 'on the ruler') },
      { label: 'Move / trim without snapping', combos: one('Alt', 'Drag'), note: 'on the ruler or a tween bar' },
    ],
  },
  {
    title: 'File & app',
    items: [
      { label: 'Save project', combos: one('Mod', 'S') },
      { label: 'Open project', combos: one('Mod', 'O') },
      { label: 'Export', combos: one('Mod', 'E') },
      { label: 'Preview (play mode)', combos: one('Mod', 'P') },
      { label: 'Close dialog / preview', combos: one('Esc') },
      { label: 'Keyboard shortcuts', combos: [['?'], ['Mod', '/']] },
    ],
  },
  {
    title: 'Fields & panels',
    items: [
      { label: 'Change a number by dragging', combos: one('Drag', 'a field label') },
      { label: '…10× faster / 10× finer', combos: [['Shift', 'Drag'], ['Alt', 'Drag']] },
      { label: 'Step a number', combos: [['↑'], ['↓']], note: 'hold Shift for ×10' },
      { label: 'Type maths in a number field', combos: one('100/2'), note: 'e.g. 1920*0.25' },
      { label: 'Confirm / cancel a field', combos: [['Enter'], ['Esc']] },
      { label: 'Finish on-canvas text editing', combos: one('Enter'), note: 'Shift+Enter adds a new line, Esc cancels' },
      { label: 'Rename a layer', combos: one('Double-click', 'a layer') },
      { label: 'Reparent / reorder layers', combos: one('Drag', 'a layer') },
      { label: 'Multi-select layers', combos: [['Shift', 'Click'], ['Mod', 'Click']] },
    ],
  },
];

/** Words that are mouse actions rather than keys (shown in a different style) */
export const MOUSE_WORDS = new Set(['Click', 'Double-click', 'Right-click', 'Drag', 'Middle-drag', 'Wheel', 'Pinch', 'Draw', 'Rotate', 'Drag handle', 'Drag corner dot']);
