# Another Roblox UI Builder

A Figma-style visual editor for Roblox UI. Design ScreenGuis on a canvas, animate them on a timeline, and send the result to Roblox Studio as a live sync, a Luau script, or an `.rbxmx` model file.

```
npm install
npm run dev        # http://localhost:5173
```

## Features

- **Canvas**: pan with Space-drag or the wheel, zoom with Ctrl+wheel. Draw elements with tools, move, resize (Shift keeps proportions, Alt resizes from the centre) and rotate from just outside a corner. Snapping guides use siblings and the parent; hold Ctrl to turn snapping off.
- **Roblox layout engine**: UDim2 Position/Size, AnchorPoint, Rotation, ZIndex, ClipsDescendants, UIPadding, UIListLayout, UIGridLayout, UIAspectRatioConstraint, UISizeConstraint, and ScrollingFrame canvases (including AutomaticCanvasSize).
- **Scale / Offset units**: canvas edits write Scale (responsive) or Offset (pixels), and mixed values like `{1, -20}` are kept. "→ Scale" and "→ Offset" convert an element without moving it. You can switch device presets to test responsiveness.
- **Elements**: Frame, ScrollingFrame, CanvasGroup, TextLabel, TextButton, TextBox, ImageLabel, ImageButton and ViewportFrame.
- **Modifiers**: UICorner, UIStroke, UIGradient, UIPadding, list and grid layouts, and constraints. They show up as children in the Layers panel and as cards in the Design panel.
- **Text**: Roblox font families (FontFace plus weight and style), TextScaled, wrapping, alignment, RichText tags, and strokes.
- **Images**: `rbxassetid://` previews load through the dev-server proxy. You can also attach a local preview image, which is not exported. Supports Stretch, Fit, Crop, Tile and Slice, plus tint.
- **Layers**: Figma-style tree with drag-and-drop reparenting that keeps each element's on-screen position. Also rename, hide, lock and filter.
- **Components**: buttons, cards, progress bars, toggles, currency pill, shop grid, notifications and inputs.
- **Animate mode**: move the playhead, then drag or edit an element to record a TweenService tween. Tween bars can be moved and trimmed, and each tween has its own EasingStyle and EasingDirection with a curve preview. You can have several animation clips.
- **Preview**: plays the UI with live buttons, text boxes, scrolling and animations on any device preset.
- **Undo/redo** for every edit, **autosave** to localStorage, and saving/opening `.uibuilder.json` project files.

## Getting UI into Roblox Studio

### 1. Live sync plugin (recommended)

The dev server exposes a small bridge at `/api/studio/*`. A Studio plugin polls it and rebuilds your ScreenGuis in `StarterGui`.

```
npm run install-plugin     # copies studio-plugin/UIBuilderSync.lua into Studio's Plugins folder
```

Restart Studio, then click **Plugins → UI Builder → Live Sync**. When Studio asks for HTTP access to `localhost`, allow it. In the web app, click **Studio → Send now** or turn on **Live sync** to push every change.

Synced ScreenGuis get a `UIBuilderId` attribute, and each sync replaces them (you can undo it in Studio). Sync is **two-way for properties**: if you change a property of a synced GUI in Studio (a color, a gradient keypoint, a size, some text), the plugin sends it back to the editor, so the next sync keeps it. Adding or deleting instances in Studio isn't sent back. Studio edits are only tracked for GUIs synced since Studio was last opened; sync once after restarting Studio. Animations arrive as a `UIAnimations` LocalScript inside the ScreenGui. If you run the app on a different port, change `BASE_URL` at the top of the plugin.

### 2. Model file

Go to **Export → Model file (.rbxmx)**. In Studio, right-click **StarterGui → Insert from File…**. You can also include an animation LocalScript in the file.

### 3. Luau script

Go to **Export → Luau script**. You can export a LocalScript that builds the UI with `Instance.new`, or a ModuleScript with `create()` that returns every instance plus `ui.animations`.

You can also **Import .rbxmx** from the menu to edit an existing UI you've saved from Studio (right-click → Save to File… as `.rbxmx`).

## Keyboard shortcuts

Press `?` in the app to see the full list. The main ones:

- **Tools**: V (move), H (hand), F (Frame), T (TextLabel), B (TextButton), I (ImageLabel)
- **Edit**: Ctrl+C/X/V/D (copy, cut, paste, duplicate), Ctrl+G to group, Delete, arrow keys to nudge
- **Select**: Enter selects children, Shift+Enter selects the parent
- **View**: Shift+1 zooms to fit
- **Modes**: Alt+A switches between Design and Animate, K plays or pauses

## Notes

- **Fonts**: while `npm run dev` is running, the editor uses Roblox Studio's own font files from `%LOCALAPPDATA%\Roblox\Versions\<newest>\content\fonts` (or `/Applications/RobloxStudio.app/...` on macOS). Faces that only exist in the cloud are downloaded from Roblox once and cached in `node_modules/.cache/rbx-fonts`. Weights snap to the nearest real face with no faux bold, like Roblox. If Studio isn't installed, or you use a static build, Google Fonts look-alikes are used instead. Set `ROBLOX_FONTS_DIR` if auto-detection fails.
- Asset previews and the Studio bridge need the dev server (`npm run dev`). A static `npm run build` still works for design and export.
