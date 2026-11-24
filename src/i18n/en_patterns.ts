// Dynamic regex pattern translators for template strings in Blender Meow
export type PatternRule = [RegExp, (m: string, ...groups: string[]) => string];

let innerTr: (s: string) => string = (s) => s;

export function registerInnerTranslator(fn: (s: string) => string) {
  innerTr = fn;
}

export const EN_PATTERNS: PatternRule[] = [
  // App / Document / Project & auto-generated Layer names
  [
    /^(立方体 \/ 长方体|直角三棱柱|拱形 \/ 拱券|圆柱体|曲面柱 \/ 平放拱 \(控制面\)|多棱柱|楔形 \/ 坡屋顶|四棱锥|圆锥体|穹顶 \/ 球体|TheoTown 绿地底座) (\d+)$/,
    (_, shape, n) => `${innerTr(shape)} ${n}`,
  ],
  [/^等距建筑 (\d+)$/, (_, n) => `Iso Building ${n}`],
  [/^TheoTown (\d+)×(\d+) (?:绿地)?底座$/, (_, u, v) => `TheoTown ${u}×${v} Base`],
  [/^TheoTown (\d+)×(\d+) 底板模板$/, (_, a, b) => `TheoTown ${a}×${b} Base Template`],
  [/^新建 (.+)$/, (_, label) => `Create ${innerTr(label)}`],
  [/^导入参考图 (.+)$/, (_, name) => `Import Ref ${name}`],
  [/^导入 PSD (.+)$/, (_, name) => `Import PSD ${name}`],
  [/^图层 (\d+)$/, (_, id) => `Layer ${id}`],
  [/^(.+) 副本$/, (_, name) => `${innerTr(name)} Copy`],
  [/^控制面 #(\d+)$/, (_, n) => `Section #${n}`],
  [/^边\s*#(\d+)$/, (_, n) => `Edge #${n}`],
  [/^侧面 #(\d+)$/, (_, n) => `Side #${n}`],
  [/^顶面 \((\d+)边形\)$/, (_, n) => `Top (${n}-gon)`],
  [/^(.+) 贴图$/, (_, face) => `${innerTr(face)} Texture`],
  [/^(.+)整面贴图$/, (_, face) => `${innerTr(face)} Full Face`],

  // AI Studio Ops history
  [/^AI 调整画布为 (\d+)×(\d+)$/, (_, w, h) => `AI Resize Canvas to ${w}×${h}`],
  [/^旋转视角至 (\d+)°$/, (_, deg) => `Rotate View to ${deg}°`],
  [/^修改图层属性「(.+)」$/, (_, name) => `Update Layer "${name}"`],
  [/^叠放「(.+)」到下方顶面$/, (_, name) => `Stack "${name}" on Below`],
  [/^AI 更新 3D 图层「(.+)」$/, (_, name) => `AI Update 3D Layer "${name}"`],
  [/^AI 应用拱形预设「(.+)」$/, (_, preset) => `AI Apply Arch Preset "${preset}"`],
  [/^AI 更新曲面控制面「(.+)」$/, (_, name) => `AI Update Loft Section "${innerTr(name)}"`],
  [/^AI 柱体截面编辑 \((.+)\)$/, (_, act) => `AI Column Section Edit (${act})`],
  [/^AI 设置平面「(.+)」纹理$/, (_, face) => `AI Set Texture on "${innerTr(face)}"`],
  [/^AI 拼贴组合「(.+)」$/, (_, face) => `AI Compose Decals on "${innerTr(face)}"`],
  [/^AI 像素精修「(.+)」$/, (_, face) => `AI Paint Pixels on "${innerTr(face)}"`],

  // PSD 4-view layer names
  [/^视角 (\d+)°$/, (_, deg) => `View ${deg}°`],
  [/^视角 (\d+)° 底座$/, (_, deg) => `View ${deg}° Base`],
  [/^视角 (\d+)° 主体$/, (_, deg) => `View ${deg}° Body`],
  [/^视角 (\d+)° 前景$/, (_, deg) => `View ${deg}° Overlay`],

  // Ruler readouts & canvas labels
  [/^竖直高度: (\d+) px = ([\d.]+) m$/, (_, px, m) => `Vertical: ${px} px = ${m} m`],
  [
    /^平面距离: ([\d.]+) m \(ΔU ([\d.]+)格 · ΔV ([\d.]+)格\)$/,
    (_, m, du, dv) => `Flat Dist: ${m} m (ΔU ${du}c · ΔV ${dv}c)`,
  ],
  [
    /^混合总长: ([\d.]+) m = √\(([\d.]+)² \+ ([\d.]+)²\) · 坡角 ([\d.]+)°$/,
    (_, tot, f, v, deg) => `3D Total: ${tot} m = √(${f}² + ${v}²) · Slope ${deg}°`,
  ],
  [/^竖直: (\d+)px = ([\d.]+)m$/, (_, px, m) => `Vert: ${px}px = ${m}m`],
  [/^平面: ([\d.]+)m \(U:([\d.]+)格 V:([\d.]+)格\)$/, (_, m, u, v) => `Flat: ${m}m (U:${u}c V:${v}c)`],
  [/^平: ([\d.]+)m$/, (_, m) => `Flat: ${m}m`],
  [/^竖: ([\d.]+)m$/, (_, m) => `Vert: ${m}m`],
  [/^平 ([\d.]+)m$/, (_, m) => `Flat ${m}m`],
  [/^竖 ([\d.]+)m$/, (_, m) => `Vert ${m}m`],
  [/^混合: ([\d.]+)m \(([\d.]+)°\)$/, (_, m, deg) => `3D: ${m}m (${deg}°)`],

  // Tools HUD & stage overlays
  [/^无法加载贴图模板: (.+)$/, (_, url) => `Failed to load template: ${url}`],
  [/^编辑 (.+)$/, (_, name) => `Edit ${innerTr(name)}`],
  [
    /^([\d.]+)×([\d.]+)格 \(([\d.]+)×([\d.]+)m\) · H (\d+)px \(([\d.]+)m\)$/,
    (_, su, sv, mu, mv, h, hm) => `${su}×${sv}c (${mu}×${mv}m) · H ${h}px (${hm}m)`,
  ],
  [/^底座 ([\d.]+)×([\d.]+)格 \(([\d.]+)×([\d.]+)m\)$/, (_, su, sv, mu, mv) => `Base ${su}×${sv}c (${mu}×${mv}m)`],
  [/^✨ 已生成「(.+)」\(([\d.]+)×([\d.]+)格 · H (\d+)px\)$/, (_, name, su, sv, h) => `✨ Created "${innerTr(name)}" (${su}×${sv}c · H ${h}px)`],
  [/^([\d.]+)×([\d.]+) 格 · ([\d.]+)×([\d.]+) m$/, (_, su, sv, mu, mv) => `${su}×${sv} cells · ${mu}×${mv} m`],
  [
    /^场地边框 ([\d.]+)×([\d.]+)格 \(([\d.]+)×([\d.]+)m\) · 起点 \(([\d.-]+), ([\d.-]+)\)$/,
    (_, su, sv, mu, mv, u, v) => `Plot Frame ${su}×${sv}c (${mu}×${mv}m) · Origin (${u}, ${v})`,
  ],
  [/^(.+) \(背面\)$/, (_, face) => `${innerTr(face)} (Back)`],

  // Main topbar, status & toasts
  [/^撤销: (.+)$/, (_, l) => `Undo: ${innerTr(l)}`],
  [/^重做: (.+)$/, (_, l) => `Redo: ${innerTr(l)}`],
  [/^双指撤销: (.+)$/, (_, l) => `2-Finger Undo: ${innerTr(l)}`],
  [/^三指重做: (.+)$/, (_, l) => `3-Finger Redo: ${innerTr(l)}`],
  [/^已撤回: (.+)$/, (_, l) => `Undone: ${innerTr(l)}`],
  [/^已恢复: (.+)$/, (_, l) => `Redone: ${innerTr(l)}`],
  [/^已重做: (.+)$/, (_, l) => `Redone: ${innerTr(l)}`],
  [/^⟲ 已切换至 (\d+)° 等距视角$/, (_, deg) => `⟲ Switched to ${deg}° Isometric View`],
  [/^⟳ 已切换至 (\d+)° 等距视角$/, (_, deg) => `⟳ Switched to ${deg}° Isometric View`],
  [/^🧲 已开启网格对齐 \(([\d.]+) 格\)$/, (_, step) => `🧲 Grid Snap ON (${step} cell)`],
  [/^拖拽生成：(.+)（双击填参数生成）$/, (_, shape) => `Drag to draw: ${innerTr(shape)} (double-click for params)`],
  [
    /^已选预设「(.+)」，在画布上拖拽放置或点右侧填参数$/,
    (_, shape) => `Selected "${innerTr(shape)}" — drag on canvas or enter params`,
  ],
  [/^已叠放至 Z = (\d+)px$/, (_, z) => `Stacked at Z = ${z}px`],
  [/^🧱 已叠放至 Z = (\d+)px \(([\d.]+)m\)$/, (_, z, m) => `🧱 Stacked at Z = ${z}px (${m}m)`],
  [/^当前预设: (.+)$/, (_, shape) => `Preset: ${innerTr(shape)}`],
  [/^起点 \(([\d.-]+), ([\d.-]+)\) · ([\d.]+)×([\d.]+)格$/, (_, u, v, su, sv) => `Origin (${u}, ${v}) · ${su}×${sv}c`],
  [/^场地边框已复位为 ([\d.]+)×([\d.]+) 格$/, (_, u, v) => `Plot frame reset to ${u}×${v} cells`],
  [/^已复位为默认 ([\d.]+)×([\d.]+) 格$/, (_, u, v) => `Reset to default ${u}×${v} cells`],
  [/^↺ 复位默认 \(0, 0, ([\d.]+)×([\d.]+)\)$/, (_, u, v) => `↺ Reset Default (0, 0, ${u}×${v})`],
  [/^场地边框设为 (\d+)×(\d+)$/, (_, a, b) => `Set Plot Frame ${a}×${b}`],
  [/^场地边框已设为 (\d+)×(\d+) 格$/, (_, a, b) => `Plot frame set to ${a}×${b} cells`],
  [/^视角 (\d+)° · 32×16=9\.6m · 竖3px=1\.6m$/, (_, deg) => `View ${deg}° · 32×16=9.6m · Vert 3px=1.6m`],
  [
    /^像素 \((\d+), (\d+)\) · 网格 \(U:([\d.-]+), V:([\d.-]+)\) · 视角 (\d+)°$/,
    (_, x, y, u, v, deg) => `Px (${x}, ${y}) · Grid (U:${u}, V:${v}) · View ${deg}°`,
  ],
  [/^(\d+)×(\d+) · ([\d.]+)×([\d.]+)格$/, (_, w, h, u, v) => `${w}×${h} · ${u}×${v}c`],
  [/^微调 (.+) 位置$/, (_, name) => `Nudge ${innerTr(name)} Position`],
  [/^微调 (.+) 高度位置 \(Z\)$/, (_, name) => `Nudge ${innerTr(name)} Elevation (Z)`],

  // Platform save / handoff messages
  [/^已保存至 (.+)$/, (_, p) => `Saved to ${p}`],
  [/^已下载 (.+)$/, (_, f) => `Downloaded ${f}`],
  [/^保存 \/ 分享 (.+)$/, (_, f) => `Save / Share ${f}`],
  [/^已导出 (.+)$/, (_, f) => `Exported ${f}`],
  [/^🐱 已发送到 Pixel Meow（(.+)）$/, (_, mode) => `🐱 Sent to Pixel Meow (${innerTr(mode)})`],
  [/^未检测到支持直连的新版 Pixel Meow，已(.+)并拉起系统分享$/, (_, fb) => `Pixel Meow app not detected; ${innerTr(fb)} & opened system share`],
  [/^Pixel Meow 网页地址无效（(.+)），已(.+)$/, (_, url, fb) => `Invalid Pixel Meow URL (${url}); ${innerTr(fb)}`],
  [
    /^未能自动连接到 Pixel Meow 网页（(.+)），已(.+)，可在 Pixel Meow 中手动打开该文件$/,
    (_, url, fb) => `Could not auto-connect to Pixel Meow (${url}); ${innerTr(fb)} — open it manually in Pixel Meow`,
  ],

  // Shortcuts UI
  [/^已绑定 (.+)，并自动解除原冲突项 (.+)$/, (_, k, n) => `Bound ${k} (unbound conflicting: ${innerTr(n)})`],
  [/^已绑定 (.+)$/, (_, k) => `Bound ${k}`],
  [/^点击设置「(.+)」(主键位|备用键位)$/, (_, act, slot) => `Click to bind "${innerTr(act)}" (${innerTr(slot)})`],
  [/^已恢复「(.+)」默认键位$/, (_, act) => `Reset "${innerTr(act)}" to default key`],
  [/^已切换预设：(.+)$/, (_, p) => `Switched preset: ${innerTr(p)}`],
  [/^已重置为 (.+)$/, (_, p) => `Reset to ${innerTr(p)}`],
  [/^已导出快捷键配置 (.+)$/, (_, f) => `Exported shortcut config ${f}`],
  [/^已成功导入 (\d+) 项快捷键配置$/, (_, n) => `Imported ${n} shortcut bindings`],
  [/^导入失败：(.+)$/, (_, msg) => `Import failed: ${innerTr(msg)}`],

  // Arch Editor
  [/^当前编辑：🟢 外圈 · 内圈\((.+)\)$/, (_, mode) => `Editing: 🟢 Outer · Inner (${innerTr(mode)})`],
  [/^✨ 已拟合 (\d+) 个(内圈|外圈)控制点$/, (_, n, which) => `✨ Fitted ${n} ${innerTr(which).toLowerCase()} nodes`],
  [
    /^从左向右一笔画出(🔵 内圈|🟢 外圈)弧线，松手自动拟合控制点$/,
    (_, which) => `Draw ${innerTr(which)} arch left-to-right to auto-fit nodes`,
  ],
  [
    /^(内圈点|外圈点|内圈|外圈|节点) #(\d+)\/(\d+)(\(脚\))?:$/,
    (_, which, i, n, end) => {
      const w = which.startsWith('内圈') ? 'Inner' : which.startsWith('外圈') ? 'Outer' : 'Node';
      return `${w} #${i}/${n}${end ? ' (Pier)' : ''}:`;
    },
  ],
  [
    /^(内圈点|外圈点|内圈|外圈|节点)#(\d+)(\(脚\))? \(([\d.-]+), ([\d.-]+)\)$/,
    (_, which, i, end, s, h) => {
      const w = which.startsWith('内圈') ? 'Inner' : which.startsWith('外圈') ? 'Outer' : 'Node';
      return `${w} #${i}${end ? '(Pier)' : ''} (${s}, ${h})`;
    },
  ],
  [/^套用拱形内圈预设：(.+)$/, (_, p) => `Apply Arch Inner Preset: ${innerTr(p)}`],
  [/^套用拱形预设：(.+)$/, (_, p) => `Apply Arch Preset: ${innerTr(p)}`],
  [/^切换内圈模式：(.+)$/, (_, m) => `Inner Mode: ${innerTr(m)}`],
  [
    /^跨度 ([\d.]+)格 \(([\d.]+)m\) · 拱高 (\d+)px \(([\d.]+)m\) · 外圈点 (\d+) 个(?: · 内圈点 (\d+) 个)?$/,
    (_, sc, sm, h, hm, on, inn) =>
      `Span ${sc}c (${sm}m) · Height ${h}px (${hm}m) · Outer ${on} pts${inn ? ` · Inner ${inn} pts` : ''}`,
  ],

  // Changelog
  [/^🎉 已从 v(.+) 升级至 Blender Meow v(.+)！以下是本次更新内容：$/, (_, prev, cur) => `🎉 Upgraded from v${prev} to Blender Meow v${cur}! Here’s what’s new:`],
  [/^🎉 欢迎使用 Blender Meow v(.+)！以下是本次版本更新说明：$/, (_, cur) => `🎉 Welcome to Blender Meow v${cur}! Release highlights:`],
  [/^当前版本：Blender Meow v(.+)$/, (_, cur) => `Current Version: Blender Meow v${cur}`],
  [/^📜 Blender Meow v(.+) 更新日志$/, (_, cur) => `📜 Blender Meow v${cur} Changelog`],
  [/^📜 版本更新日志 \(v(.+)\)$/, (_, cur) => `📜 Release Changelog (v${cur})`],
  [/^v([\d.]+) · (.+)$/, (_, v, title) => `v${v} · ${innerTr(title)}`],

  // Color Picker
  [/^已复制 (.+): (.+)$/, (_, lbl, txt) => `Copied ${innerTr(lbl)}: ${txt}`],
  [/^从「(.+)」中删除 (.+) \?$/, (_, p, c) => `Delete ${c} from "${innerTr(p)}"?`],
  [/^确定删除「(.+)」[?？]$/, (_, p) => `Delete "${innerTr(p)}"?`],
  [/^已导入 (\d+) 种颜色$/, (_, n) => `Imported ${n} colors`],
  [/^提取到 (\d+) 种颜色$/, (_, n) => `Extracted ${n} colors`],

  // Column Section Editor
  [/^吸附角度: ([\d.-]+)°$/, (_, deg) => `Snap Angle: ${deg}°`],
  [/^中心偏移 \(([\d.-]+), ([\d.-]+)\) · 半径 (\d+)%$/, (_, u, v, r) => `Center (${u}, ${v}) · Radius ${r}%`],
  [/^中心偏移 \(([\d.-]+), ([\d.-]+)\)$/, (_, u, v) => `Center Offset (${u}, ${v})`],
  [
    /^(.+?) (🔒\s*)?· 偏移 ([+-]?[\d.]+) · ([\d.-]+)°$/,
    (_, edge, lock, off, deg) => `${innerTr(edge)} ${lock ? '🔒 ' : ''}· Offset ${off} · ${deg}°`,
  ],
  [/^🔒 (.+)$/, (full, rest) => {
    const trRest = innerTr(rest);
    return trRest !== rest ? `🔒 ${trRest}` : full;
  }],
  [
    /^(✨\[过渡面\] )?当前控制面：(.+?) · (\d+)px \((\d+)%\) · (\d+)条控制边 \(锁定 (\d+) 条\)$/,
    (_, trTag, name, z, pct, edges, locks) =>
      `${trTag ? '✨[Auto] ' : ''}Section: ${innerTr(name)} · ${z}px (${pct}%) · ${edges} edges (${locks} locked)`,
  ],
  [
    /^(✨\[过渡面\] )?当前控制面：(.+?) · (\d+)px \((\d+)%\) · 圆柱控制环$/,
    (_, trTag, name, z, pct) => `${trTag ? '✨[Auto] ' : ''}Section: ${innerTr(name)} · ${z}px (${pct}%) · Cylinder Ring`,
  ],
  [
    /^(\d+)% · (\d+)px( · 自动过渡)?( · 🔒\d+)?$/,
    (_, pct, z, auto, locks) => `${pct}% · ${z}px${auto ? ' · Auto' : ''}${locks ?? ''}`,
  ],

  // Dialogs
  [/^已打开「(.+)」$/, (_, name) => `Opened "${name}"`],
  [/^Blender Meow v(.+) · 等距像素建模工坊$/, (_, ver) => `Blender Meow v${ver} · Isometric Pixel 3D Studio`],
  [/^已导入 (\d+) 个 PSD 参考图层$/, (_, n) => `Imported ${n} PSD reference layers`],
  [/^已载入工程「(.+)」$/, (_, name) => `Loaded project "${name}"`],
  [/^保存工程失败: (.+)$/, (_, msg) => `Save project failed: ${innerTr(msg)}`],
  [/^导入到 Pixel Meow 失败: (.+)$/, (_, msg) => `Send to Pixel Meow failed: ${innerTr(msg)}`],
  [
    /^当前：分段像素色阶（(\d+) 档），拖动下方滑条可在 3 ~ 64 档之间微调$/,
    (_, n) => `Current: Quantized Cel Shading (${n} steps); drag slider to fine-tune between 3 and 64`,
  ],
  [/^当前：(.+)$/, (_, name) => `Current: ${innerTr(name)}`],
  [/^已绑定保存目录: (.+)$/, (_, name) => `Bound save folder: ${name}`],
  [/^已设置保存目录: (.+)$/, (_, name) => `Save folder set: ${name}`],
  [/^📁 选择电脑保存目录（默认工作区: (.+)）$/, (_, dir) => `📁 Choose Desktop Save Folder (Default: ${innerTr(dir)})`],

  // Face Composer
  [/^(.+?) \[已裁切\] · \(([\d.-]+), ([\d.-]+)\) (\d+)×(\d+)$/, (_, n, x, y, w, h) => `${innerTr(n)} [Cropped] · (${x}, ${y}) ${w}×${h}`],
  [/^✂️ 裁切贴片 · (.+)$/, (_, n) => `✂️ Crop Decal · ${innerTr(n)}`],
  [/^叠加贴片列表（(\d+) · 顶部遮挡底部）$/, (_, n) => `Decal Stack (${n} · top covers bottom)`],
  [/^贴入 (.+)$/, (_, n) => `Place ${innerTr(n)}`],
  [/^✂️ 裁切「(.+)」后贴入平面$/, (_, n) => `✂️ Crop "${innerTr(n)}" & Place on Face`],
  [/^点击将「(.+)」\((\d+)×(\d+)\) 贴入当前平面$/, (_, n, w, h) => `Click to place "${innerTr(n)}" (${w}×${h}) onto active face`],
  [/^🧩 自定义平面拼贴窗口 · (.+)$/, (_, face) => `🧩 Custom Decal Composer · ${innerTr(face)}`],

  // Inspector & Layer panel
  [/^切换为 (.+)$/, (_, shape) => `Switch to ${innerTr(shape)}`],
  [/^高度设为 (\d+)px$/, (_, px) => `Set Height to ${px}px`],
  [/^当前选中参考图层「(.+)」（以下为新图形默认参数）$/, (_, n) => `Reference layer "${n}" selected (editing preset for new shapes)`],
  [/^选中: (.+)$/, (_, n) => `Selected: ${innerTr(n)}`],
  [/^✨ 已按参数生成「(.+)」$/, (_, n) => `✨ Created "${innerTr(n)}"`],
  [/^🖼️ 已导入参考图「(.+)」$/, (_, n) => `🖼️ Imported ref image "${n}"`],
  [/^🧩 已垫底导入 (.+)$/, (_, n) => `🧩 Imported underlay ${innerTr(n)}`],
  [/^(#[0-9A-F]{8}) \((\d+)%\) · 1:1 正右投射$/, (_, hex, pct) => `${hex} (${pct}%) · 1:1 Direct Right`],
  [/^地面阴影 \(自动\)$/, () => 'Ground Shadow (Auto)'],
  [/^(#[0-9A-F]{8}) \((\d+)%\) · 实验性体块投影$/, (_, hex, pct) => `${hex} (${pct}%) · Exp Inter-Block`],
  [/^结构阴影 \(体块间 · 实验\)$/, () => 'Cast Shadow (Inter-Block · Exp)'],
  [/^重置阴影颜色为 (#[0-9A-F]{8})$/, (_, hex) => `Reset Shadow Color to ${hex}`],
  [/^重置阴影颜色为 TheoTown 推荐默认值 \((#[0-9A-F]{8})\)$/, (_, hex) => `Reset shadow color to TheoTown default (${hex})`],
  [/^↺ 重置阴影色 \((#[0-9A-F]{8})\)$/, (_, hex) => `↺ Reset Color (${hex})`],
  [
    /^([\d.]+)×([\d.]+)格 \(([\d.]+)m\) · H (\d+)px \(([\d.]+)m\)$/,
    (_, su, sv, m, h, hm) => `${su}×${sv}c (${m}m) · H ${h}px (${hm}m)`,
  ],
  [/^(\d+)×(\d+) 参考图$/, (_, w, h) => `${w}×${h} Ref Image`],

  // Loft Editor
  [/^➕ 已新增「(.+)」$/, (_, n) => `➕ Added "${innerTr(n)}"`],
  [/^✨ 已拟合 (\d+) 个(内圈|外圈)闭合曲线节点$/, (_, n, w) => `✨ Fitted ${n} closed ${innerTr(w).toLowerCase()} nodes`],
  [/^切换控制面内圈为 (.+)$/, (_, m) => `Set Section Inner Mode: ${innerTr(m)}`],
  [/^📋 已将「(.+)」的内圈设置同步到全部 (\d+) 个控制面$/, (_, n, cnt) => `📋 Synced "${innerTr(n)}" inner settings to all ${cnt} sections`],
  [/^套用内圈截面预设：(.+)$/, (_, p) => `Apply Inner Preset: ${innerTr(p)}`],
  [/^套用截面预设：(.+)$/, (_, p) => `Apply Section Preset: ${innerTr(p)}`],
  [/^套用 (\d+) 条直边的正多边形闭合曲线$/, (_, n) => `Apply regular ${n}-gon closed contour`],
  [
    /^(✨\[过渡面\] )?当前控制面：(.+?) · 高度 (\d+)px \(([\d.]+)m, (\d+)%\) · 外圈 (\d+)点(?: · 自由内圈 (\d+)点|( · 双击蓝虚线可解锁自由内圈 \/ 拖◆调壁厚))?$/,
    (_, trTag, name, z, m, pct, on, inn, unlockHint) =>
      `${trTag ? '✨[Auto] ' : ''}Section: ${innerTr(name)} · H ${z}px (${m}m, ${pct}%) · Outer ${on} pts${
        inn ? ` · Inner ${inn} pts` : unlockHint ? ' · Dbl-click blue line to unlock inner / drag ◆ for thickness' : ''
      }`,
  ],
  [/^内圈(\d+)点$/, (_, n) => `In ${n}pts`],
  [/^(平行|等比)(\d+)%$/, (_, mode, pct) => `${innerTr(mode)} ${pct}%`],
  [/^(\d+)点$/, (_, n) => `${n}pts`],

  // Material Panel
  [/^打开 Pixel Meow 选色器设置(.+)$/, (_, lbl) => `Open Pixel Meow Color Picker for ${innerTr(lbl)}`],
  [/^选择(.+)$/, (_, lbl) => `Pick ${innerTr(lbl)}`],
  [/^材质与纹理 · (.+)$/, (_, name) => `Material · ${innerTr(name)}`],
  [/^当前为参考图层「(.+)」（以下调整后续新图形材质预设）$/, (_, n) => `Reference layer "${n}" active (editing preset for new shapes)`],
  [/^已应用到 (\d+) 个平面$/, (_, n) => `Applied to ${n} faces`],
  [/^切换贴图模式: (.+)$/, (_, m) => `Texture Mode: ${m}`],
  [/^将该面当前贴图效果合成为 (\d+)×(\d+) px 独立像素画布进行整面绘制\/精修$/, (_, w, h) => `Flatten current face texture into a ${w}×${h} px pixel canvas for 1px detailing`],
  [/^🖌️ 用像素画布编辑整个平面 \((\d+)×(\d+) px\)$/, (_, w, h) => `🖌️ Edit Whole Face in Pixel Canvas (${w}×${h} px)`],
  [/^✂️ 裁切纹理「(.+)」→ (.+)$/, (_, asset, face) => `✂️ Crop "${innerTr(asset)}" → ${innerTr(face)}`],
  [/^裁切 (.+) 纹理$/, (_, face) => `Crop ${innerTr(face)} Texture`],
  [/^✂️ 调整裁切 \((\d+)×(\d+)\)$/, (_, w, h) => `✂️ Edit Crop (${w}×${h})`],
  [/^还原 (.+) 整图$/, (_, face) => `Reset ${innerTr(face)} Full Image`],
  [/^(.+) · 裁切 (\d+)×(\d+)$/, (_, n, w, h) => `${innerTr(n)} · Crop ${w}×${h}`],
  [/^拉伸填满整个「(.+)」\((\d+)×(\d+) px\)$/, (_, f, w, h) => `Stretch to fill "${innerTr(f)}" (${w}×${h} px)`],
  [/^保持原像素比例重复覆盖「(.+)」\((\d+)×(\d+) px\)，无拉伸失真$/, (_, f, w, h) => `Tile seamlessly across "${innerTr(f)}" (${w}×${h} px) without stretching`],
  [/^↻ 旋转 \((\d+)°\)$/, (_, deg) => `↻ Rotate (${deg}°)`],
  [/^点击素材将其贴入「(.+)」自定义平面$/, (_, f) => `Click a texture to place on "${innerTr(f)}" custom composer`],
  [/^点击素材应用到「(.+)」（支持 ▭⇄▱ 无损斜切与裁切）$/, (_, f) => `Click a texture to apply to "${innerTr(f)}" (lossless ▭⇄▱ shear & crop)`],
  [/^向 (.+) 贴入 (.+)$/, (_, f, a) => `Place ${innerTr(a)} on ${innerTr(f)}`],
  [/^为 (.+) 应用 (.+)$/, (_, f, a) => `Apply ${innerTr(a)} to ${innerTr(f)}`],

  // Pixel Canvas Editor
  [/^撤回(\s*\(.+\))?$/, (_, hint) => `Undo${hint ?? ''}`],
  [/^使用最近颜色 (#[0-9A-F]{6})$/, (_, hex) => `Use recent color ${hex}`],
  [/^调整尺寸 (\d+)×(\d+)→(\d+)×(\d+)$/, (_, w1, h1, w2, h2) => `Resize ${w1}×${h1} → ${w2}×${h2}`],
  [/^宽 (\d+) × 高 (\d+) px$/, (_, w, h) => `W ${w} × H ${h} px`],

  // Texture Library UI
  [/^整张原图：(\d+)×(\d+) px（未裁剪）$/, (_, w, h) => `Full source: ${w}×${h} px (uncropped)`],
  [
    /^裁切区域：起点 \((\d+), (\d+)\) · 尺寸 (\d+)×(\d+) px（原图 (\d+)×(\d+)）$/,
    (_, x, y, w, h, sw, sh) => `Crop: (${x}, ${y}) · ${w}×${h} px (source ${sw}×${sh})`,
  ],
  [/^保持中心点，按所选平面比例 \((\d+):(\d+)\) 最大裁切$/, (_, w, h) => `Max centered crop matching face ratio (${w}:${h})`],
  [/^📐 适配平面比例 \((\d+):(\d+)\)$/, (_, w, h) => `📐 Fit Face Ratio (${w}:${h})`],
  [/^直接裁出 (\d+)×(\d+) px（不超过原图范围）$/, (_, w, h) => `Crop exact ${w}×${h} px (clamped to source)`],
  [/^🎯 1:1 匹配面尺寸 \((\d+)×(\d+)\)$/, (_, w, h) => `🎯 1:1 Face Size (${w}×${h})`],
  [/^当前所在分组：(.+) · 请选择要移入的目标分组：$/, (_, g) => `Current group: ${innerTr(g)} · Choose destination group:`],
  [/^已将「(.+)」移至「(.+)」$/, (_, a, g) => `Moved "${innerTr(a)}" to "${innerTr(g)}"`],
  [/^已新建分组「(.+)」并移入「(.+)」$/, (_, g, a) => `Created group "${innerTr(g)}" and moved "${innerTr(a)}"`],
  [/^📁 移动「(.+)」到分组$/, (_, a) => `📁 Move "${innerTr(a)}" to Group`],
  [/^✂️ 裁切「(.+)」后贴入模型面$/, (_, a) => `✂️ Crop "${innerTr(a)}" & Apply to Face`],
  [/^全部纹理 \((\d+)\)$/, (_, n) => `All Textures (${n})`],
  [/^已新建分组「(.+)」$/, (_, g) => `Created group "${innerTr(g)}"`],
  [/^已将分组重命名为「(.+)」$/, (_, g) => `Renamed group to "${innerTr(g)}"`],
  [
    /^确定删除分组「(.+)」吗？分组内的 (\d+) 张贴图不会被删除，将安全返回「我的贴图」。$/,
    (_, g, n) => `Delete group "${innerTr(g)}"? Its ${n} texture(s) will safely return to "My Textures".`,
  ],
  [
    /^确定删除分组「(.+)」吗？该分组内暂无贴图。$/,
    (_, g) => `Delete empty group "${innerTr(g)}"?`,
  ],
  [/^已删除分组「(.+)」，贴图已移回「我的贴图」$/, (_, g) => `Deleted group "${innerTr(g)}"; textures returned to "My Textures"`],
  [/^🖌️ 基于预设「(.+)」绘制副本$/, (_, a) => `🖌️ Paint Copy of Preset "${innerTr(a)}"`],
  [/^✅ 已将副本「(.+)」保存到纹理库$/, (_, a) => `✅ Saved copy "${innerTr(a)}" to Texture Library`],
  [/^🖌️ 编辑像素纹理 · (.+)$/, (_, a) => `🖌️ Edit Pixel Texture · ${innerTr(a)}`],
  [/^✅ 已更新纹理「(.+)」\((\d+)×(\d+)\)$/, (_, a, w, h) => `✅ Updated texture "${innerTr(a)}" (${w}×${h})`],
  [
    /^贴图「(.+)」当前被模型上的 (\d+) 处平面引用，删除后对应平面贴图将不再显示。确定删除吗？$/,
    (_, a, n) => `Texture "${innerTr(a)}" is used on ${n} face(s). Deleting it will clear those faces. Continue?`,
  ],
  [/^已删除贴图「(.+)」$/, (_, a) => `Deleted texture "${innerTr(a)}"`],
  [
    /^(.+?)( \(当前工程内嵌\))? \[(.+)\] \((\d+)×(\d+) px · (平行四边形形态|矩形形态)\)$/,
    (_, a, emb, grp, w, h, form) =>
      `${innerTr(a)}${emb ? ' (Project Embedded)' : ''} [${innerTr(grp)}] (${w}×${h} px · ${innerTr(form)})`,
  ],
  [/^点击应用到当前平面$/, () => 'Click to apply to active face'],
  [/^✅ 已新建像素纹理「(.+)」\((\d+)×(\d+)\)$/, (_, a, w, h) => `✅ Created pixel texture "${innerTr(a)}" (${w}×${h})`],
  [
    /^规范矩形底图：(\d+)×(\d+) px(?:（已裁切 (\d+)×(\d+)）)?（库中可随时 ▭⇄▱ 无损切换）$/,
    (_, w, h, cw, ch) =>
      `Rect base: ${w}×${h} px${cw ? ` (cropped ${cw}×${ch})` : ''} (lossless ▭⇄▱ toggle in library)`,
  ],
  [/^(\d+)% 邻近缩小$/, (_, pct) => `${pct}% Nearest Downscale`],
  [
    /^已载入原图：(\d+)×(\d+) px(?:（已最近邻缩至 (\d+)×(\d+)）)?$/,
    (_, rw, rh, sw, sh) => `Loaded source: ${rw}×${rh} px${sw ? ` (nearest-scaled to ${sw}×${sh})` : ''}`,
  ],
  [/^✅ 已将「(.+)」导入纹理库 \((\d+)×(\d+)\)$/, (_, a, w, h) => `✅ Imported "${innerTr(a)}" into library (${w}×${h})`],
  [
    /^矩形尺寸 (\d+)×(\d+) px ⇄ 平行四边形形态 (\d+)×(\d+) px · 当前展示「(▱ 平行四边形|▭ 矩形)」( \(已修改待保存\))?$/,
    (_, rw, rh, pw, ph, form, dirty) =>
      `Rect ${rw}×${rh} px ⇄ Parallelogram ${pw}×${ph} px · Showing "${innerTr(form)}"${dirty ? ' (Unsaved)' : ''}`,
  ],
  [/^预览已反解为 (\d+)×(\d+) 正交矩形（点保存生效）$/, (_, w, h) => `Preview unsheared to ${w}×${h} rectangle (click Save to apply)`],
  [/^📐 Pixel Meow 斜切工坊 · (.+)$/, (_, a) => `📐 Pixel Meow Shear Studio · ${innerTr(a)}`],
  [/^已保存「(.+)」的斜切与形态设置$/, (_, a) => `Saved shear & form settings for "${innerTr(a)}"`],
  [/^「(.+)」不支持平面贴图（仅支持立方体、多棱柱、直角三棱柱、楔形坡屋顶、四棱锥）\.?。?$/, (_, n) => `"${innerTr(n)}" does not support planar face textures (Box, Prism, Tri-Prism, Wedge, Pyramid only).`],
  [/^「(.+)」不支持平面贴图（仅支持立方体、多棱柱、三棱柱、坡屋顶、四棱锥）。$/, (_, n) => `"${innerTr(n)}" does not support planar face textures (Box, Prism, Tri-Prism, Wedge, Pyramid only).`],
  [/^图层「(.+)」已锁定，请先解锁$/, (_, n) => `Layer "${innerTr(n)}" is locked. Unlock it first.`],
  [/^已将「(.+)」应用到「(.+) · (.+)」$/, (_, a, l, f) => `Applied "${innerTr(a)}" to "${innerTr(l)} · ${innerTr(f)}"`],
  [/^🖌️ 编辑贴图面 · (.+) \((\d+)×(\d+)\)$/, (_, f, w, h) => `🖌️ Edit Textured Face · ${innerTr(f)} (${w}×${h})`],
  [/^像素画布编辑 (.+) 整面$/, (_, f) => `Paint Whole Face (${innerTr(f)})`],
  [/^✅ 已将整面像素编辑 \((\d+)×(\d+)\) 应用到「(.+)」$/, (_, w, h, f) => `✅ Applied whole-face pixel edit (${w}×${h}) to "${innerTr(f)}"`],
  [/^将「(.+)」\((\d+)×(\d+) px\) 打开为像素画布整面编辑$/, (_, f, w, h) => `Open "${innerTr(f)}" (${w}×${h} px) for whole-face pixel editing`],
  [/^目标: (.+)$/, (_, n) => `Target: ${innerTr(n)}`],
  [/^点击素材应用到「(.+)」（支持分组、手绘与斜切）$/, (_, f) => `Click a texture to apply to "${innerTr(f)}" (groups, draw & shear)`],
  [/^点击素材直接贴入「(.+) · (.+)」（支持分组管理、像素绘制与裁剪）$/, (_, l, f) => `Click a texture to apply to "${innerTr(l)} · ${innerTr(f)}" (groups, draw & crop)`],
  // Generic suffix fallback (kept last so specific patterns match first)
  [/^(.+) \((\d+)×(\d+)\)$/, (full, n, w, h) => {
    const tn = innerTr(n);
    return tn !== n ? `${tn} (${w}×${h})` : full;
  }],
];
