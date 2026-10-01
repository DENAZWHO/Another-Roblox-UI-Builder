import type { EffectKind } from './types';

export interface EffectInfo {
  label: string;
  description: string;
  amount: { label: string; default: number; step: number; min?: number; max?: number; suffix?: string };
  speed?: { label: string; default: number; step: number; min?: number; suffix?: string };
  invert?: boolean;
  /** Needs the mouse, so it does nothing on SurfaceGui / BillboardGui elements */
  mouse?: boolean;
  /** Property the effect overrides every frame (tweens on it will be fought) */
  overrides?: 'Rotation' | 'Position' | 'UIScale';
}

export const EFFECTS: Record<EffectKind, EffectInfo> = {
  lookAtMouse: {
    label: 'Look at mouse',
    description: 'Rotates to point at the cursor. Offset 0 = the right side faces the mouse, 90 = the bottom, -90 = the top.',
    amount: { label: 'Angle offset', default: 0, step: 15, suffix: '°' },
    speed: { label: 'Speed', default: 12, step: 1, min: 0.5 },
    mouse: true,
    overrides: 'Rotation',
  },
  tiltToMouse: {
    label: 'Tilt toward mouse',
    description: 'Leans left/right depending on which side of it the cursor is.',
    amount: { label: 'Max angle', default: 10, step: 1, suffix: '°' },
    speed: { label: 'Speed', default: 8, step: 1, min: 0.5 },
    invert: true,
    mouse: true,
    overrides: 'Rotation',
  },
  followMouse: {
    label: 'Follow mouse',
    description: 'Shifts toward the cursor (parallax, googly eyes). Invert to move away.',
    amount: { label: 'Max distance', default: 12, step: 1, min: 0, suffix: 'px' },
    speed: { label: 'Speed', default: 10, step: 1, min: 0.5 },
    invert: true,
    mouse: true,
    overrides: 'Position',
  },
  hoverScale: {
    label: 'Grow on hover',
    description: 'Scales up while the mouse is over it (adds a UIScale).',
    amount: { label: 'Scale', default: 1.08, step: 0.01, min: 0.1 },
    speed: { label: 'Duration', default: 0.15, step: 0.05, min: 0.01, suffix: 's' },
    overrides: 'UIScale',
  },
  pressScale: {
    label: 'Shrink on press',
    description: 'Squishes while held down (adds a UIScale).',
    amount: { label: 'Scale', default: 0.92, step: 0.01, min: 0.1 },
    speed: { label: 'Duration', default: 0.1, step: 0.05, min: 0.01, suffix: 's' },
    overrides: 'UIScale',
  },
  float: {
    label: 'Float',
    description: 'Bobs up and down forever.',
    amount: { label: 'Height', default: 6, step: 1, suffix: 'px' },
    speed: { label: 'Period', default: 2, step: 0.1, min: 0.05, suffix: 's' },
    overrides: 'Position',
  },
  spin: {
    label: 'Spin',
    description: 'Rotates forever.',
    amount: { label: 'Speed', default: 90, step: 10, suffix: '°/s' },
    overrides: 'Rotation',
  },
  pulse: {
    label: 'Pulse',
    description: 'Gently grows and shrinks forever (adds a UIScale).',
    amount: { label: 'Amount', default: 0.05, step: 0.01, min: 0 },
    speed: { label: 'Period', default: 1.2, step: 0.1, min: 0.05, suffix: 's' },
    overrides: 'UIScale',
  },
};

export const EFFECT_KINDS = Object.keys(EFFECTS) as EffectKind[];
