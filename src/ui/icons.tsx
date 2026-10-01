import {
  AppWindow, Blend, Box, Frame, Image, ImagePlus, LayoutGrid, Monitor, PaintBucket, Ratio, Rows3,
  Scaling, ScrollText, Spline, SquareDashed, SquareRoundCorner, TextCursorInput, Type, CaseSensitive,
  MousePointerClick, Signpost, Presentation, type LucideIcon,
} from 'lucide-react';
import type { ClassName } from '../model/types';

export const CLASS_ICONS: Record<ClassName, LucideIcon> = {
  ScreenGui: Monitor,
  BillboardGui: Signpost,
  SurfaceGui: Presentation,
  Frame: Frame,
  ScrollingFrame: ScrollText,
  CanvasGroup: SquareDashed,
  TextLabel: Type,
  TextButton: MousePointerClick,
  TextBox: TextCursorInput,
  ImageLabel: Image,
  ImageButton: ImagePlus,
  ViewportFrame: Box,
  UICorner: SquareRoundCorner,
  UIStroke: Spline,
  UIGradient: Blend,
  UIPadding: AppWindow,
  UIListLayout: Rows3,
  UIGridLayout: LayoutGrid,
  UIAspectRatioConstraint: Ratio,
  UISizeConstraint: Scaling,
  UITextSizeConstraint: CaseSensitive,
};

export const CLASS_COLORS: Partial<Record<ClassName, string>> = {
  ScreenGui: '#a78bfa',
  BillboardGui: '#a78bfa',
  SurfaceGui: '#a78bfa',
  UICorner: '#f59e0b',
  UIStroke: '#f59e0b',
  UIGradient: '#f59e0b',
  UIPadding: '#34d399',
  UIListLayout: '#34d399',
  UIGridLayout: '#34d399',
  UIAspectRatioConstraint: '#f472b6',
  UISizeConstraint: '#f472b6',
  UITextSizeConstraint: '#f472b6',
};

export function ClassIcon({ cls, size = 14 }: { cls: ClassName; size?: number }) {
  const I = CLASS_ICONS[cls] ?? PaintBucket;
  return <I size={size} strokeWidth={1.75} style={{ color: CLASS_COLORS[cls], flexShrink: 0 }} />;
}
