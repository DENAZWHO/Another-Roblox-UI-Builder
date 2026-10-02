--[[
	UI Builder Sync — Roblox Studio plugin

	Pulls the UI you design in the Roblox UI Builder web app (running with `npm run dev`)
	straight into StarterGui.

	Install: copy this file to your local plugins folder
	  Windows: %LOCALAPPDATA%\Roblox\Plugins\UIBuilderSync.lua
	  macOS:   ~/Documents/Roblox/Plugins/UIBuilderSync.lua
	(or run `npm run install-plugin` in the project), then restart Studio.

	Use: Plugins tab → "UI Builder" → "Live Sync". The first request asks you to allow
	HTTP access to localhost — accept it. GUIs created by the sync are tagged with a
	"UIBuilderId" attribute and are replaced on every sync. Property edits you make to them in
	Studio are sent back to the web app (two-way sync), so they survive the next sync.
]]

local HttpService = game:GetService("HttpService")
local StarterGui = game:GetService("StarterGui")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")

if not RunService:IsEdit() then
	return
end

-- Change this if you run the web app on another port
local BASE_URL = "http://localhost:5173"
local POLL_INTERVAL = 0.5
local ATTRIBUTE = "UIBuilderId"

local toolbar = plugin:CreateToolbar("UI Builder")
local liveButton = toolbar:CreateButton("Live Sync", "Continuously pull UI from the UI Builder web app", "")
local pullButton = toolbar:CreateButton("Pull Once", "Pull the current UI from the UI Builder web app once", "")
liveButton.ClickableWhenViewportHidden = true
pullButton.ClickableWhenViewportHidden = true

local version = 0
local live = false
local lastError: string? = nil

-- ---------------------------------------------------------------------------
-- Decoding the wire format produced by src/sync.ts

local function num(v)
	if v == "inf" then
		return math.huge
	elseif v == "-inf" then
		return -math.huge
	end
	return v
end

local function withEnds(list, make)
	-- Roblox sequences must start at t=0 and end at t=1
	table.sort(list, function(a, b)
		return a[1] < b[1]
	end)
	local first, last = list[1], list[#list]
	if first[1] > 0 then
		local copy = table.clone(first)
		copy[1] = 0
		table.insert(list, 1, copy)
	end
	if last[1] < 1 then
		local copy = table.clone(last)
		copy[1] = 1
		table.insert(list, copy)
	end
	local out = {}
	for _, k in list do
		table.insert(out, make(k))
	end
	return out
end

local decoders = {
	UDim2 = function(v)
		return UDim2.new(v[1], v[2], v[3], v[4])
	end,
	UDim = function(v)
		return UDim.new(v[1], v[2])
	end,
	Vector2 = function(v)
		return Vector2.new(num(v[1]), num(v[2]))
	end,
	Vector3 = function(v)
		return Vector3.new(num(v[1]), num(v[2]), num(v[3]))
	end,
	Color3 = function(v)
		return Color3.fromRGB(v[1], v[2], v[3])
	end,
	enum = function(v)
		return (Enum :: any)[v[1]][v[2]]
	end,
	Font = function(v)
		return Font.new(v[1], (Enum.FontWeight :: any)[v[2]], (Enum.FontStyle :: any)[v[3]])
	end,
	ColorSequence = function(v)
		return ColorSequence.new(withEnds(v, function(k)
			return ColorSequenceKeypoint.new(k[1], Color3.fromRGB(k[2], k[3], k[4]))
		end))
	end,
	NumberSequence = function(v)
		return NumberSequence.new(withEnds(v, function(k)
			return NumberSequenceKeypoint.new(k[1], k[2])
		end))
	end,
	Rect = function(v)
		return Rect.new(v[1], v[2], v[3], v[4])
	end,
	number = num,
}

-- instance -> { id = editor node id, root = root id, types = { [prop] = wireType } }
local synced = setmetatable({}, { __mode = "k" })

local function build(node, rootId: string): Instance?
	local ok, inst = pcall(Instance.new, node.c)
	if not ok then
		warn(("[UI Builder] Cannot create %s: %s"):format(tostring(node.c), tostring(inst)))
		return nil
	end
	inst.Name = node.n
	if node.i then
		inst:SetAttribute("UIBuilderNode", node.i)
		local types = {}
		for prop, pair in node.p do
			types[prop] = pair[1]
		end
		synced[inst] = { id = node.i, root = rootId, types = types }
	end
	for prop, pair in node.p do
		local decode = decoders[pair[1]]
		local okValue, value = pcall(function()
			if decode then
				return decode(pair[2])
			end
			return pair[2]
		end)
		if okValue then
			local okSet, err = pcall(function()
				(inst :: any)[prop] = value
			end)
			if not okSet then
				warn(("[UI Builder] %s.%s: %s"):format(node.n, prop, tostring(err)))
			end
		end
	end
	for _, child in node.k do
		local c = build(child, rootId)
		if c then
			c.Parent = inst
		end
	end
	-- Path2D control points (not a property: set with SetControlPoints)
	if node.cp and inst:IsA("Path2D") then
		pcall(function()
			local u = function(a)
				return UDim2.new(a[1], a[2], a[3], a[4])
			end
			local points = {}
			for _, cp in node.cp do
				table.insert(points, Path2DControlPoint.new(u(cp[1]), u(cp[2]), u(cp[3])))
			end
			(inst :: any):SetControlPoints(points)
		end)
	end
	return inst
end

-- ---------------------------------------------------------------------------
-- Pixel scaling: strokes, text size, corners and padding are pixels in Roblox, so they're scaled by
-- min(viewport / design resolution) to keep the UI looking like the design on any screen. Design
-- values are kept in "UIB_<Property>" attributes; the generated LocalScript does the same at runtime.

local SCALE_PROPS = {
	UIStroke = { "Thickness" },
	UITextSizeConstraint = { "MaxTextSize", "MinTextSize" },
	UICorner = { "CornerRadius", "TopLeftRadius", "TopRightRadius", "BottomRightRadius", "BottomLeftRadius" },
	UIShadow = { "BlurRadius", "Offset", "Spread" },
	Path2D = { "Thickness" },
	UIPageLayout = { "Padding" },
	UITableLayout = { "Padding" },
	UIPadding = { "PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight" },
	UIListLayout = { "Padding" },
	UIGridLayout = { "CellSize", "CellPadding" },
	TextLabel = { "TextSize" },
	TextButton = { "TextSize" },
	TextBox = { "TextSize" },
	ScrollingFrame = { "ScrollBarThickness" },
}
local INTEGER = { MaxTextSize = 1, MinTextSize = 1, ScrollBarThickness = 0 }

local function scaleValue(value, f: number)
	local kind = typeof(value)
	if kind == "number" then
		return value * f
	elseif kind == "UDim" then
		return UDim.new(value.Scale, value.Offset * f)
	elseif kind == "UDim2" then
		return UDim2.new(value.X.Scale, value.X.Offset * f, value.Y.Scale, value.Y.Offset * f)
	end
	return value
end

local function storeDesignValues(root: Instance)
	for _, d in root:GetDescendants() do
		local props = SCALE_PROPS[d.ClassName]
		if props then
			for _, prop in props do
				-- (pcall: older Studio builds may not have every property, e.g. per-corner radii)
				local ok, value = pcall(function()
					return (d :: any)[prop]
				end)
				if ok then
					d:SetAttribute("UIB_" .. prop, value)
				end
			end
		end
	end
end

local function applyScale(root: Instance)
	local design = root:GetAttribute("UIBuilderDesign")
	local camera = workspace.CurrentCamera
	if typeof(design) ~= "Vector2" or not camera then
		return
	end
	local viewport = camera.ViewportSize
	if viewport.X <= 0 or viewport.Y <= 0 then
		return
	end
	local f = math.min(viewport.X / design.X, viewport.Y / design.Y)
	-- Roblox caps TextScaled at 100px; give such text a cap that scales with the screen as well
	for _, d in root:GetDescendants() do
		if (d:IsA("TextLabel") or d:IsA("TextButton") or d:IsA("TextBox")) and d.TextScaled and not d:FindFirstChildOfClass("UITextSizeConstraint") then
			local cap = Instance.new("UITextSizeConstraint")
			cap.Name = "UIBuilderTextCap"
			cap:SetAttribute("UIB_MaxTextSize", 100)
			cap:SetAttribute("UIB_MinTextSize", 1)
			cap.Parent = d
		end
	end
	for _, d in root:GetDescendants() do
		local props = SCALE_PROPS[d.ClassName]
		if props then
			for _, prop in props do
				local value = d:GetAttribute("UIB_" .. prop)
				if value ~= nil then
					local v = scaleValue(value, f)
					if INTEGER[prop] then
						v = math.max(INTEGER[prop], math.round(v))
					end
					if prop == "TextSize" then
						v = math.clamp(v, 1, 100)
					end
					pcall(function()
						(d :: any)[prop] = v
					end)
				end
			end
		end
	end
end

local function applyScaleToAll()
	for _, gui in StarterGui:GetChildren() do
		if gui:GetAttribute("UIBuilderDesign") then
			applyScale(gui)
		end
	end
end

-- keep synced ScreenGuis matching Studio's viewport as it's resized
local cameraConnection: RBXScriptConnection? = nil
local pending = false
local function watchCamera()
	if cameraConnection then
		cameraConnection:Disconnect()
	end
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	cameraConnection = camera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
		if pending then
			return
		end
		pending = true
		task.delay(0.15, function()
			pending = false
			applyScaleToAll()
		end)
	end)
end
workspace:GetPropertyChangedSignal("CurrentCamera"):Connect(watchCamera)
watchCamera()
task.defer(applyScaleToAll)

local function resolvePath(path: string?): Instance?
	if not path or path == "" then
		return nil
	end
	local current: Instance? = nil
	for segment in string.gmatch(path, "[^%./]+") do
		if current == nil then
			current = if string.lower(segment) == "workspace" then workspace else game:FindFirstChild(segment)
		else
			current = current:FindFirstChild(segment)
		end
		if current == nil then
			return nil
		end
	end
	return current
end

-- ---------------------------------------------------------------------------
-- Studio -> web app: send property edits made to synced GUIs back to the editor

local function numOut(v: number)
	if v == math.huge then
		return "inf"
	elseif v == -math.huge then
		return "-inf"
	end
	return v
end

local function c255(c: Color3)
	return { math.round(c.R * 255), math.round(c.G * 255), math.round(c.B * 255) }
end

local encoders = {
	UDim2 = function(v)
		return { v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset }
	end,
	UDim = function(v)
		return { v.Scale, v.Offset }
	end,
	Vector2 = function(v)
		return { numOut(v.X), numOut(v.Y) }
	end,
	Vector3 = function(v)
		return { v.X, v.Y, v.Z }
	end,
	Color3 = c255,
	enum = function(v)
		return { (tostring(v.EnumType):gsub("^Enum%.", "")), v.Name }
	end,
	Font = function(v)
		return { v.Family, v.Weight.Name, v.Style.Name }
	end,
	ColorSequence = function(v)
		local out = {}
		for _, k in v.Keypoints do
			local c = c255(k.Value)
			table.insert(out, { k.Time, c[1], c[2], c[3] })
		end
		return out
	end,
	NumberSequence = function(v)
		local out = {}
		for _, k in v.Keypoints do
			table.insert(out, { k.Time, k.Value })
		end
		return out
	end,
	Rect = function(v)
		return { v.Min.X, v.Min.Y, v.Max.X, v.Max.Y }
	end,
	number = numOut,
}

local function currentFactor(inst: Instance): number?
	local node: Instance? = inst
	while node and node ~= game do
		local design = node:GetAttribute("UIBuilderDesign")
		if typeof(design) == "Vector2" then
			local camera = workspace.CurrentCamera
			if not camera then
				return nil
			end
			local vp = camera.ViewportSize
			return math.min(vp.X / design.X, vp.Y / design.Y)
		end
		node = node.Parent
	end
	return nil
end

local function sameValue(a, b): boolean
	if typeof(a) == "number" and typeof(b) == "number" then
		return math.abs(a - b) < 1e-3
	end
	return a == b
end

local function unscale(value, f: number)
	local kind = typeof(value)
	if kind == "number" then
		return value / f
	elseif kind == "UDim" then
		return UDim.new(value.Scale, value.Offset / f)
	elseif kind == "UDim2" then
		return UDim2.new(value.X.Scale, value.X.Offset / f, value.Y.Scale, value.Y.Offset / f)
	end
	return value
end

local pendingEdits = {} -- rootId -> { [instance] = { [prop] = true } }
local flushQueued = false

local function flushEdits()
	flushQueued = false
	for rootId, byInst in pendingEdits do
		local edits = {}
		for inst, props in byInst do
			local meta = synced[inst]
			if meta and inst.Parent then
				local p = {}
				for prop in props do
					if prop == "Name" then
						continue
					end
					local wireType = meta.types[prop]
					local ok, value = pcall(function()
						return (inst :: any)[prop]
					end)
					if ok and wireType then
						-- pixel-scaled properties are sent in design units
						local design = inst:GetAttribute("UIB_" .. prop)
						if design ~= nil then
							value = design
						end
						local enc = encoders[wireType]
						p[prop] = { wireType, if enc then enc(value) else value }
					end
				end
				table.insert(edits, { i = meta.id, n = if props.Name then inst.Name else nil, p = p })
			end
		end
		if #edits > 0 then
			local body = HttpService:JSONEncode({ root = rootId, edits = edits })
			task.spawn(function()
				pcall(function()
					HttpService:RequestAsync({
						Url = BASE_URL .. "/api/studio/edits",
						Method = "POST",
						Headers = { ["Content-Type"] = "application/json" },
						Body = body,
					})
				end)
			end)
			print(("[UI Builder] Sent %d Studio edit(s) back to the editor"):format(#edits))
		end
	end
	table.clear(pendingEdits)
end

local function onPropertyChanged(inst: Instance, prop: string)
	local meta = synced[inst]
	if not meta or (prop ~= "Name" and not meta.types[prop]) then
		return
	end
	local value = (inst :: any)[prop]
	local design = if prop == "Name" then nil else inst:GetAttribute("UIB_" .. prop)
	if design ~= nil then
		local f = currentFactor(inst)
		if f then
			-- the plugin's own pixel scaling? then it's not a user edit
			local expected = scaleValue(design, f)
			if INTEGER[prop] then
				expected = math.max(INTEGER[prop], math.round(expected))
			end
			if prop == "TextSize" then
				expected = math.clamp(expected, 1, 100)
			end
			if sameValue(value, expected) then
				return
			end
			-- a real edit: remember it in design units so scaling keeps it
			inst:SetAttribute("UIB_" .. prop, unscale(value, f))
		end
	end
	pendingEdits[meta.root] = pendingEdits[meta.root] or {}
	pendingEdits[meta.root][inst] = pendingEdits[meta.root][inst] or {}
	pendingEdits[meta.root][inst][prop] = true
	if not flushQueued then
		flushQueued = true
		task.delay(0.4, flushEdits)
	end
end

local function watch(gui: Instance)
	local function hook(inst: Instance)
		if synced[inst] then
			inst.Changed:Connect(function(prop)
				onPropertyChanged(inst, prop)
			end)
		end
	end
	-- connect after the build has settled so the build itself isn't reported as edits
	task.delay(0.5, function()
		if not gui.Parent then
			return
		end
		hook(gui)
		for _, d in gui:GetDescendants() do
			hook(d)
		end
	end)
end

local function apply(payload, selectResult: boolean)
	local recording = ChangeHistoryService:TryBeginRecording("UI Builder Sync")
	local created = {}
	for _, root in payload.roots do
		for _, existing in StarterGui:GetChildren() do
			if existing:GetAttribute(ATTRIBUTE) == root.id then
				existing:Destroy()
			end
		end
		local gui = build(root.tree, root.id)
		if gui then
			gui:SetAttribute(ATTRIBUTE, root.id)
			if root.design then
				gui:SetAttribute("UIBuilderDesign", Vector2.new(root.design[1], root.design[2]))
				storeDesignValues(gui)
				applyScale(gui)
			end
			local source = root.script or root.animation
			if source then
				local script = Instance.new("LocalScript")
				script.Name = "UIBehavior"
				script.Source = source
				script.Parent = gui
			end
			if root.adornee and gui:IsA("LayerCollector") and not gui:IsA("ScreenGui") then
				local part = resolvePath(root.adornee)
				if part then
					(gui :: any).Adornee = part
				else
					warn("[UI Builder] Adornee not found: " .. tostring(root.adornee))
				end
			end
			gui.Parent = StarterGui
			watch(gui)
			table.insert(created, gui)
		end
	end
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	if selectResult then
		Selection:Set(created)
	end
end

-- ---------------------------------------------------------------------------
-- HTTP

local function request(method: string, path: string)
	local ok, res = pcall(function()
		return HttpService:RequestAsync({ Url = BASE_URL .. path, Method = method })
	end)
	if not ok then
		return nil, tostring(res)
	end
	return res, nil
end

local function pull(force: boolean): boolean
	local res, err = request("GET", "/api/studio/pull?since=" .. (if force then 0 else version))
	if not res then
		if err ~= lastError then
			warn("[UI Builder] Cannot reach " .. BASE_URL .. " — is `npm run dev` running? (" .. tostring(err) .. ")")
			lastError = err
		end
		return false
	end
	if lastError then
		print("[UI Builder] Connected to " .. BASE_URL)
		lastError = nil
	end
	if res.StatusCode == 204 then
		if force then
			print("[UI Builder] Nothing to pull yet — press “Send to Studio” in the web app.")
		end
		return true
	end
	if res.StatusCode ~= 200 then
		warn("[UI Builder] HTTP " .. res.StatusCode)
		return false
	end
	local okDecode, data = pcall(HttpService.JSONDecode, HttpService, res.Body)
	if not okDecode then
		warn("[UI Builder] Bad payload: " .. tostring(data))
		return false
	end
	version = data.version
	apply(data.data, force)
	request("POST", "/api/studio/ack?version=" .. version)
	print(("[UI Builder] Synced v%d into StarterGui"):format(version))
	return true
end

local function setLive(on: boolean)
	live = on
	liveButton:SetActive(on)
	if not on then
		print("[UI Builder] Live sync off")
		return
	end
	print("[UI Builder] Live sync on — polling " .. BASE_URL)
	task.spawn(function()
		while live do
			pull(false)
			task.wait(POLL_INTERVAL)
		end
	end)
end

liveButton.Click:Connect(function()
	setLive(not live)
end)

pullButton.Click:Connect(function()
	pullButton:SetActive(false)
	task.spawn(pull, true)
end)

plugin.Unloading:Connect(function()
	live = false
end)
