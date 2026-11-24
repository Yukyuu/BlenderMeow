// English dictionary: Shortcuts, AI Studio history labels & Changelog entries
export const EN_SHORTCUTS_CHANGELOG: Record<string, string> = {
  // AI Studio Ops history labels
  'AI 等距建筑': 'AI Iso Building',
  'AI 调整阴影设置': 'AI Adjust Shadow Settings',
  'AI 调整光影精细度': 'AI Adjust Shading Precision',
  'AI 调整场地网格与边框': 'AI Adjust Plot Grid & Frame',
  'AI 导入 PSD 参考图层': 'AI Import PSD Reference Layers',
  'AI 参考图': 'AI Reference',
  '清空重建空白场景': 'Clear & Rebuild Blank Scene',
  'AI 修改拱形控制点': 'AI Edit Arch Nodes',
  'AI 沿轨微调拱形节点': 'AI Slide Arch Node',
  'AI 新增曲面柱控制面': 'AI Add Loft Section',
  'AI 删除曲面控制面': 'AI Delete Loft Section',
  '新分组': 'New Group',
  'AI 自定义纹理': 'AI Custom Texture',

  // Shortcuts categories, actions & presets
  '画布移动、旋转与视野': 'Canvas Pan, Rotation & View',
  '撤回与恢复': 'Undo & Redo',
  '微调操作（3D 图形 / 曲线节点 / 控制边）': 'Nudge (3D Shapes / Curve Nodes / Control Edges)',
  '工具切换与快捷指令': 'Tools & Quick Actions',
  '按住抓手拖拽平移画布': 'Hold to Pan Canvas',
  '按住此键配合鼠标左键拖拽即可平移视野': 'Hold and drag with left mouse button to pan',
  '向上移动画布视野': 'Pan View Up',
  '按住平滑移动，配合 Shift 加速移动': 'Hold for smooth pan; hold Shift for faster speed',
  '向下移动画布视野': 'Pan View Down',
  '向左移动画布视野': 'Pan View Left',
  '向右移动画布视野': 'Pan View Right',
  '放大画布视野': 'Zoom In',
  '缩小画布视野': 'Zoom Out',
  '适应屏幕居中画布': 'Fit Canvas to Screen',
  '逆时针旋转 90° 视角': 'Rotate View 90° CCW',
  '顺时针旋转 90° 视角': 'Rotate View 90° CW',
  '撤回上一步': 'Undo',
  '同时适用于主画布与曲线/控制面大屏编辑弹窗': 'Works on main canvas and fullscreen curve/section editors',
  '恢复重做': 'Redo',
  '向上微调': 'Nudge Up',
  '微调选中的曲线/拱形节点、柱体控制边或主画布 3D 图形（配合 Shift 大步距）':
    'Nudge selected curve/arch node, column edge, or 3D shape (Shift for larger step)',
  '向下微调': 'Nudge Down',
  '向左微调': 'Nudge Left',
  '向右微调': 'Nudge Right',
  '沿当前轨迹逆向微调 / 控制边内收': 'Slide Backward Along Path / Inset Edge',
  '在曲面柱与拱形编辑器开启「沿当前轨迹移动」时对应 ◀ 沿轨；柱体控制边下对应内收':
    'Slides node backward when "Slide Along Path" is on; insets edge in column editor',
  '沿当前轨迹顺向微调 / 控制边外扩': 'Slide Forward Along Path / Outset Edge',
  '在曲面柱与拱形编辑器开启「沿当前轨迹移动」时对应 沿轨 ▶；柱体控制边下对应外扩':
    'Slides node forward when "Slide Along Path" is on; outsets edge in column editor',
  '3D 图形垂直升高 (Z+)': 'Raise 3D Shape (Z+)',
  '将主画布当前选中的图形向上抬高 1px（配合 Shift 抬高 4px）': 'Raise active 3D shape by 1px (Shift: 4px)',
  '3D 图形垂直降低 (Z-)': 'Lower 3D Shape (Z-)',
  '将主画布当前选中的图形向下降低 1px（配合 Shift 降低 4px）': 'Lower active 3D shape by 1px (Shift: 4px)',
  '选择 / 3D 调整工具': 'Select / 3D Adjust Tool',
  '拖拽放置图形工具': 'Draw Shape Tool',
  'TheoTown 量尺工具': 'TheoTown Ruler Tool',
  '场地边框工具': 'Plot Frame Tool',
  '抓手平移工具': 'Pan Hand Tool',
  '复制当前选中图层': 'Duplicate Active Layer',
  '删除当前选中图层': 'Delete Active Layer',
  '开启 / 关闭网格吸附': 'Toggle Grid Snap',
  '打开保存与导出面板 (.bmeow / PSD / PNG)': 'Open Save & Export Dialog (.bmeow / PSD / PNG)',
  '打开键盘快捷键与预设设置': 'Open Keyboard Shortcuts & Presets',
  '标准推荐预设（WASD 移画布 + 方向键微调）': 'Standard Recommended (WASD Pan + Arrow Nudge)',
  'WASD 丝滑平移画布、空格抓手、Ctrl+Z/Y 撤回恢复、方向键微调控制点或图形、Q/E 旋转视角。':
    'Smooth WASD pan, Space hand, Ctrl+Z/Y undo/redo, Arrow keys to nudge nodes/shapes, Q/E to rotate view.',
  '方向键移画布预设（方向键移画布 + IJKL / Ctrl+方向键微调）': 'Arrow Pan Layout (Arrow Pan + IJKL / Ctrl+Arrow Nudge)',
  '习惯用方向键直接移动画布视野时的布局；微调控制点/图形改为 Ctrl+方向键 或 I / J / K / L。':
    'Use Arrow keys directly to pan the viewport; nudge nodes/shapes with Ctrl+Arrows or I/J/K/L.',
  '数位板 / 左手高频单手预设': 'Pen Tablet / Left-Hand Quick Preset',
  '左手无需频繁按组合键：Z 直接撤回、X 直接重做、1/2/3 缩放适应、WASD 移画布，右手可用方向键微调。':
    'Single-key left-hand workflow: Z undo, X redo, 1/2/3 zoom & fit, WASD pan, right-hand Arrows to nudge.',
  '⌨️ 键盘快捷键与预设方案（支持自定义绑定与导出至 Pixel Meow）':
    '⌨️ Keyboard Shortcuts & Presets (Customizable & Compatible with Pixel Meow)',
  '完成 ✓': 'Done ✓',
  '选择内置键盘预设方案': 'Select built-in keyboard preset',
  '恢复当前预设（或推荐预设）的默认键位绑定': 'Reset bindings to active preset defaults',
  '↺ 恢复默认': '↺ Reset Defaults',
  '导出键盘配置 JSON（可用于备份或同步导入到 Pixel Meow）': 'Export shortcut JSON (backup or import into Pixel Meow)',
  '📤 导出配置': '📤 Export JSON',
  '导入保存的 JSON 键盘配置（兼容 Blender Meow 与 Pixel Meow 通用键位）': 'Import saved shortcut JSON (shared with Pixel Meow)',
  '📥 导入配置': '📥 Import JSON',
  '🔍 搜索操作名称或按键（如：画布、撤回、微调、Space、Arrow）...': '🔍 Search actions or keys (e.g. Pan, Undo, Nudge, Space, Arrow)...',
  '已清空该槽位按键绑定': 'Cleared shortcut binding',
  '✨ 自定义修改方案 (基于预设)': '✨ Custom Layout (Modified Preset)',
  '当前为自定义键位布局；点击任意按键槽位可重新录制，按 Esc 取消，按 Backspace 清空槽位。':
    'Custom keymap active; click any slot to record, Esc to cancel, Backspace to clear.',
  '按下按键… (Esc取消 / ⌫清空)': 'Press a key… (Esc cancel / ⌫ clear)',
  '未绑定（点击设置）': 'Unbound (Click to set)',
  '+ 备用键': '+ Alt Key',
  '请按下目标快捷键组合；Esc 取消，Backspace 清空': 'Press desired key combo; Esc to cancel, Backspace to clear',
  '主键位': 'Primary Key',
  '备用键位': 'Secondary Key',
  '恢复此项默认绑定': 'Reset this action to default',
  '没有匹配的快捷键项': 'No matching shortcuts',
  '键盘预设': 'Preset',
  '✨ 自定义方案': '✨ Custom',
  '默认预设': 'Default Preset',
  '无效的快捷键配置文件格式': 'Invalid shortcut configuration JSON format',

  // Changelog entries
  '📜 版本更新日志': '📜 Release Changelog',
  '我知道了喵 ✨': 'Got it, Meow ✨',
  'v1.4.x 全面审查修复、四视角分层阴影与性能升级': 'v1.4.x Full Audit Fixes, 4-View Shadow Groups & Performance Upgrade',
  '核心状态与缓存修复：修复四视角导出/交接后画布滞留 270° 旧视角与结构阴影关闭再开后视口不显示的问题；「光影精细度」现随 .bmeow 工程与撤销栈持久化保存，跨设备导出结果一致。':
    'Core state & cache fixes: fixed stale 270° view layers after 4-view export/handoff and invisible cast shadows after toggling off & on; Shading Precision now persists per .bmeow project & undo history for deterministic cross-device exports.',
  '阴影与曲面精度升级：结构阴影严格跳过背光面防止二次压暗并支持凹体（镂空拱洞/镂空放样内庭）自投影；四视角 PSD 开启阴影时自动分组成独立「地面阴影」「结构阴影」图层；圆柱升级为解析像素中心椭圆消除半像素偏移与边缘阴影渗漏；统一光影反差下限为 0.3 并修正色阶档数对称性。':
    'Shadow & curved precision: cast shadows strictly skip back-facing surfaces and support concave self-shadowing (hollow arches & loft courtyards); 4-view PSD exports separate Ground/Cast Shadow layers per view group; analytical pixel-centered cylinders fix half-pixel offset; unified contrast min at 0.3 and symmetric cel bands.',
  '性能、内存与交互优化：地面阴影改为按图层缓存蒙版合并，体块阴影按包围盒并集求值并惰性分配深度缓冲（未开启时零额外内存）；扁平化曲面角点法线数组并节流色阶滑条；修复阴影不透明度 0.1% 无损精度往返、重置按钮不再强行开启地面阴影及 Pixel Meow 交接跨异步安全恢复。':
    'Performance, memory & UX: per-layer cached ground shadow masks, bounding-box union inter-block evaluation & lazy depth buffer allocation (0 extra RAM when off); flat Float32Array Phong normals & rAF-throttled precision slider; lossless 0.1% shadow opacity round-trip & sync-safe Pixel Meow handoff restore.',
  '实验性体块间投射阴影（结构阴影）': 'Experimental Inter-Block Cast Shadows',
  '实验性体块间投射阴影：支持 3D 体块按 TheoTown 1:1 正右方平行光向低矮邻楼、退台裙房屋顶及挑檐下立面投射阴影，并支持镂空拱形/放样柱/多截面柱等凹体自身受光面投射，随四视角旋转实时更新':
    'Experimental inter-block shadows: 3D blocks cast 1:1 right-directed TheoTown shadows onto shorter neighbors, setback podium roofs, eaves, and concave self-shadowing surfaces, updating across all 4 rotations.',
  '防双重叠加与防接缝：严格跳过背光面防止二次压暗，垂直齐平叠放楼层零黑缝，并与地面阴影 1px 无缝衔接':
    'Zero double-darkening & zero seams: skips back-facing walls, produces zero black seams on flush stacked floors, and joins ground shadows seamlessly.',
  '独立「结构阴影」图层：在图层面板独立展示（与地面阴影共用颜色与不透明度），导出单视角 PSD、四视角分层 PSD（各视角自动分组成独立阴影层）及直传 Pixel Meow 时作为独立图层输出，PNG 导出按层序平面合成（默认关闭，可在材质面板或设置中开启）':
    'Standalone "Cast Shadow" layer (shares color & opacity with ground shadow): exports as its own layer in single/4-view PSD & Pixel Meow handoff, composited in PNG (off by default).',
  '曲面光影精细度升级、解析圆锥与 0.3~5.0 光影反差': 'Curved Shading Precision, Analytical Cones & 0.3–5.0 Contrast',
  '曲面逐像素平滑着色与解析圆锥：新增折角感知 Phong 逐像素法线插值（覆盖拱形、放样柱与多截面渐变柱，平滑过渡曲面同时保留硬折角棱边）、圆柱逐列解析椭圆法线，并将圆锥体及地面阴影升级为等距解析射线求交，适度提升拱体/放样柱/多截面圆柱采样上限。':
    'Crease-aware Phong per-pixel normals for arches, lofts & multi-section columns, analytical elliptical cylinder normals, and analytical isometric raycast cones + cone shadows.',
  '设置新增「光影精细度」调节：支持在「无极连续平滑（最高精细度 · 默认）」与「3 ~ 64 档分段像素色阶（含 4 / 6 / 10 / 16 / 32 档快捷预设与微调滑条）」之间实时切换，兼顾丝滑高精曲面与导入 Pixel Meow 后便于魔棒/油漆桶选区的像素色带。':
    'Configurable Shading Precision: switch live between Continuous Smooth (default) and 3–64 cel-shaded pixel bands (with 4/6/10/16/32 presets) for effortless selection in Pixel Meow.',
  '光影反差范围扩展至 0.3 ~ 5.0：引入高动态 S 型柔肩曲线（shadeColorSoftHsv），高反差下可精细拉开浅曲率起伏层次，同时防止浅色墙面亮部硬裁切泛白或暗部死黑。':
    'Expanded Shade Contrast to 0.3–5.0 with a high-dynamic soft-shoulder HSV curve that brings out subtle curvature without clipping bright highlights or crushing shadows.',
  '自动 TheoTown 1:1 地面阴影与独立阴影图层': 'Automatic TheoTown 1:1 Ground Shadow & Standalone Layer',
  '自动地面阴影计算：根据场景内所有可见 3D 参数化几何体（含长方体、多棱柱、斜三棱柱、楔形屋顶、四棱锥、圆柱、圆锥、穹顶/球体、镂空拱形与放样/多截面柱体）自动投影地面 Z=0 的 1-bit 合并阴影蒙版；严格遵循 TheoTown 规则：阴影投射于物体正右方且长度与物体高度保持 1:1。':
    'Automatic Z=0 1-bit union ground shadow across all 3D primitives strictly following TheoTown’s 1:1 height-to-length direct-right projection rule.',
  '实时视角同步与分层隔离：随 90° 视角旋转、形状调整与图层显隐实时刷新；阴影仅作用于地面（渲染在底座之上、所有 3D 体块之下），不会遮暗位于阴影区内的其他 3D 形体；在导出 PSD 或一键导入 Pixel Meow 时自动作为独立「地面阴影」图层输出。':
    'Updates live on 90° rotation and shape edits; renders strictly above the ground base and below all 3D shapes, exporting as a standalone "Ground Shadow" PSD layer.',
  '自定义阴影色彩与不透明度：可在「材质与纹理」与「图层管理」的「地面阴影 (自动)」行直接开关显隐并自定义颜色与透明度，默认采用 TheoTown 冷调半透明阴影色 #00071C5A，随撤销重做与 .bmeow 工程完整保存。':
    'Customizable shadow color & opacity (defaults to TheoTown #00071C5A) in Material & Layer panels, persisted in undo/redo and .bmeow projects.',
  '导出所有视角分层 PSD': 'Export All 4 Views as Layered PSD',
  '新增「导出所有视角（图层 PSD）」选项：在导出弹窗中可将当前项目 0° / 90° / 180° / 270° 四个等距视角作为 4 个独立可见图层导出到同一个 .psd 文件（默认命名 <项目名>_4views.psd），支持导出倍率、是否包含参考底图与四视角联合紧致裁切。':
    'Added "Export All 4 Views (Layered PSD)" to export 0° / 90° / 180° / 270° isometric views as 4 layers in one .psd file with scale, rasters & joint trim support.',
  '纹理库独立菜单与分组、Pixel Meow 轻量画布及整面像素精修': 'Texture Library Dock & Groups, Pixel Canvas & Whole-Face Pixel Editing',
  '顶部工具栏独立「纹理库」入口与显示模式切换：可在设置中开启侧边停靠纹理库菜单，与「材质与纹理」面板并排共存且「图层管理」始终保持在屏幕最右侧；默认未开启时以全屏大窗口弹出纹理库，两种形态均支持直接选取和添加纹理到模型平面。':
    'Added dedicated topbar Texture Library button with fullscreen modal and docked side-panel mode.',
  '纹理库分组管理与「预设纹理」独立分组：内置预设纹理独立归入「预设纹理」分组，支持新建、重命名与删除自定义分组（删除分组时组内贴图安全归还「我的贴图」不丢失），支持随时调整贴图所属分组并随本地数据库与 .bmeow 工程持久化保存。':
    'Added texture groups ("Presets", "My Textures", and custom groups) persisted across local DB and .bmeow projects.',
  '移植 Pixel Meow 轻量全屏像素画布编辑器：支持独立绘制新贴图或编辑已有纹理，精简保留框选与魔棒选区工具（新选/加选/减选/交集）、1px 像素完美画笔（及橡皮擦）、Pixel Meow 吸管取色器与调色板取色窗口，并仅保留单一竖向透明度快捷滑条（不设画笔粗细滑条）。':
    'Embedded Pixel Meow’s lightweight pixel canvas editor with marquee, magic wand, 1px pixel-perfect brush, eraser, eyedropper & palette picker.',
  '已贴图模型面整面像素精修：支持在材质面板、拼图界面与纹理库一键将当前已贴纹理的模型平面（含填充、覆盖平铺或自定义拼图）提取为等尺寸像素画布进行整面精修绘制，支持立面底色垫底参考、无损撤销及严格 0-AA 与 4×90° 视角旋转闭环。':
    'Whole-face pixel detailing: flatten any textured face to an exact-size pixel canvas for 1px touch-ups with strict 0-AA and 4×90° rotation closure.',
  '平面纹理贴附、自定义素材库、拼图平面与贴图裁切': 'Planar Face Textures, Custom Library, Decal Composer & Cropping',
  '全新「材质与纹理」与「形状修改」分栏：原参数与材质栏目拆分为「形状修改」与独立「材质与纹理」栏目，迁移所有通用材质/光影/轮廓/程序纹理选项，并新增规则平面图形（立方体、棱柱、斜三角棱柱、楔形坡体、棱锥）专属平面选择芯片。':
    'Split right drawer into dedicated Shape and Material & Texture tabs with per-face selector chips for flat-faced primitives.',
  '覆盖（无失真平铺）与自定义纹理素材库：除「填充（拉伸）」外新增「覆盖（等比重复平铺，不失真）」模式；支持导入自定义贴图并引入 Pixel Meow 无损锯齿斜切工具，可在矩形（▭）与任意平行四边形（▱）形态间随时互转；支持通过裁剪框按像素精细裁切导入或贴入模型面的局部纹理区域，支持透明留白自动裁切与平面比例吸附。':
    'Added distortion-free Tile mode, custom texture library with lossless Pixel Meow sawtooth shear (▭ ⇄ ▱), and non-destructive pixel crop.',
  '「自定义」拼图操作平面：提供与目标模型面完全等尺寸（W×H）的可交互拼图画板，支持自由摆放、缩放、旋转 90°、镜像翻转与多贴片层叠组合，可随时在正向「矩形拼图平面」与 2:1 等轴测「平行四边形操作面」之间一键切换操作或预览。':
    'Added interactive Custom decal composer (W×H) supporting multi-decal layering, move/scale/rotate/flip, and live Rect ⇄ Iso view switching.',
  '稳定性与导出强化：修复斜切弹窗非破坏取消、大屏微调控件焦点丢失、多节柱体楔形渐变平铺密度的真实面宽适配、自定义贴图多项目同 ID 冲突保护、IndexedDB 与核心模块解耦，并保持导出 .bmeow 工程与 4×90° 视角旋转的像素级闭环一致。':
    'Stability & export upgrades: non-destructive shear cancel, tapered multi-section tile width adaptation, multi-project texture ID isolation, and 4×90° pixel closure.',
  '自定义键盘快捷键与多套键位预设系统': 'Customizable Keyboard Shortcuts & Presets',
  '全新可扩展快捷键与预设中心：支持「标准推荐预设（WASD 移画布 + 方向键微调）」「方向键移画布预设（Ctrl+方向键 / IJKL 微调）」「数位板 / 左手高频单手预设（Z 撤回 / X 重做 / 1-3 缩放）」一键切换；顶栏与设置弹窗均可直接打开快捷键面板，支持双键位槽位录制（Esc 取消 / Backspace 清空）、同域冲突自动解绑、搜索过滤以及与 Pixel Meow 互通的 JSON 配置导出/导入。':
    'Added customizable shortcut center with 3 built-in presets, dual key slots, conflict resolution, search, and Pixel Meow-compatible JSON import/export.',
  '平滑移动画布与全域微调联动：支持 WASD 连续平滑平移画布（配合 Shift 加速）及按住空格抓手拖拽；撤回恢复与微调快捷键（方向键、`[` / `]` 沿轨与控制边伸缩、`PgUp` / `PgDn` 3D 图形升降）统一打通主画布、曲面柱/拱形/柱体控制边内嵌编辑与大屏精细编辑弹窗。':
    'Smooth WASD canvas panning, Space pan hold, and unified undo/redo & nudge keys across main stage and fullscreen curve/section editors.',
  '拱形控制点精细微调操作升级': 'Arch Node Fine-Tuning Upgrade',
  '拱形编辑器控制点微调系统：在右侧检查器与大屏精细编辑弹窗中同步加入实时 (s, h) 坐标徽章、长按连发「← ↑ ↓ →」微调按键、多档微调步距选择（0.002 ~ 0.05）及画布键盘方向键微调（Shift 4× 步距）。':
    'Added live (s, h) coordinate badge, hold-to-repeat directional nudge buttons, multi-step precision (0.002–0.05), and Arrow key nudging for arches.',
  '沿轨与镜像微调联动：开启「🛤️ 沿当前轨迹移动」时自动提供「◀ 沿轨 / 沿轨 ▶」滑动微调及方向键贴轨投影；完整支持「↔ 左右对称」镜像同步与拱脚底面基准线 (H=0) 安全约束。':
    'Added path-sliding nudge controls, left-right mirror sync, and base pier (H=0) safety constraints.',
  '控制点沿轨迹移动与上下控制面自动过渡面': 'Slide Along Path & Auto-Transition Sections',
  '控制点「🛤️ 沿当前轨迹移动」模式：在曲面柱控制面（外圈/自定义内圈）与拱形编辑器中启用后，拖拽、方向键或「◀ 沿轨 / 沿轨 ▶」滑动控制点将贴合当前截面轮廓轨迹移动；对圆角矩形与平顶/高脚拱可沿直边双向延长或收缩圆角，同时按比例自动缩放贝塞尔手柄并保持直边绝对平直，支持「↔ 对称」联动与轨上「🧲 锚点吸附」。':
    'Added "Slide Along Path" mode for loft & arch nodes with proportional Bezier handle scaling, symmetry sync, and on-rail anchor snapping.',
  '控制面「✨ 新建过渡面」与「🔄 转换为过渡面」：在曲面柱与柱体控制面（长方体/多棱柱/垂直三棱柱/圆柱）中，新建或转换的过渡面将作为上下相邻普通控制面的中间形态，当上下控制面高度、外圈/内圈曲线或控制边修改时自动实时插值联动，手动调整该面自身形状时则自动解锁转为独立控制面。':
    'Added auto-interpolated Transition Sections for lofts & multi-section columns that dynamically track neighboring sections until manually edited.',
  '控制面精细操作升级、柱体控制边系统与 1024px 超高上限': 'Section Fine-Tuning, Column Control Edges & 1024px Height Cap',
  '控制面精细交互升级：曲面柱与柱体控制面新增「🧲 锚点吸附」（支持顶点/网格/角点对齐参考线，按住 Alt 可临时忽略吸附）与长按连发方向键「微调移动按钮」，搭配坐标实时徽章。':
    'Added anchor snapping with guide lines (Alt to bypass) and hold-to-repeat nudge controls with live coordinate badges.',
  '大屏精细操作窗口独立撤回/恢复：曲面柱、拱形及柱体控制面大屏弹窗顶部均配备「↩ 撤回」与「↪ 恢复」按钮及 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 快捷键，支持历史状态与画布实时联动。':
    'Added integrated Undo/Redo buttons & shortcuts inside fullscreen Loft, Arch, and Column Section editors.',
  '曲面柱新增可折叠「🔷 正多边形预设 (3~12 边形)」，支持外圈与镂空自定义内圈一键套用正三角形至正十二边形。':
    'Added collapsible Regular Polygon presets (3–12 sides) for loft outer & custom inner rings.',
  '新增柱体控制面与「控制边」编辑：支持长方体、多棱柱与垂直直角三棱柱启用多层高度控制面，直接拖拽或微调单条边的位置与绕中点倾角，并可「🔒 固定此边」锁死指定边不受邻边联动或截面缩放平移影响；圆柱体支持极简多层截面位移与半径缩放控制。':
    'Added Multi-Section Column Control Edges (offset, angle & edge locking) for boxes, prisms & vertical tri-prisms, plus radial ring sections for cylinders.',
  '超高建筑上限提升：3D 视图拖拽黄色高度控制点及垂直偏移高度上限由 512px 提升至 1024px（约 546m）。':
    'Raised max building height & vertical Z elevation from 512px to 1024px (~546m).',
  'v1.2.x 全优先级架构审计修复与交互稳定性升级': 'v1.2.x Architecture Audit Fixes & Stability Upgrade',
  '曲面柱镂空重构：统一米制壁厚基准与凹形安全内中心；升级环形插值拓扑对齐与内底封底退化保护，消除扭转与高低面撕裂；彻底修复漏斗状/收腰镂空柱体的顶面与中腰堆叠吸附精确度，并加入有界 LRU 缓存避免滑条拖拽内存膨胀。':
    'Refactored hollow loft geometry with metric wall thickness, pole-safe centers, bounded LRU SDF caching, and accurate courtyard stacking.',
  '拱形几何精度升级：重做平行偏移采样避免内凹拱肚消失，保留矩形券门正角特征与宽高比联动采样；加强序列化空值校验并在非对称类型切换时剥离冗余曲线字段。':
    'Upgraded arch parallel offset sampling, crisp rectangular portal corners, and clean serialization validation.',
  '双曲线编辑器交互加固：增加多指追踪锁与失焦兜底；阻止空白处双击误删节点，区分曲线双击与单点插入，加严镜像配对阈限并锁定节点过中线防跳点；全面适配高分屏 DPR 锐利渲染与触控热区，支持面板与大屏弹窗间无缝状态继承。':
    'Hardened curve editors with pointer-ID locks, safe double-click guards, tight symmetry thresholds, and crisp HiDPI rendering.',
  '曲面柱体融合平放拱形与多层内圈镂空系统': 'Hollow Loft Columns, Per-Section Inner Curves & Flat Arches',
  '「曲面柱 / 平放拱 (控制面)」正式融合平放拱形与镂空能力：支持一键切换「实心柱体」与「中间镂空」，并可调节「内底封底 (%)」轻松制作贯通空心筒、弧形围院、体育场碗形看台或喷泉水池。':
    'Merged flat arches & hollow shafts into Loft Columns with adjustable inner floor elevation for courtyards, bowls, and pools.',
  '每个控制面均可独立配置内圈曲线：支持「📏 平行等厚」（基于精确有向距离场等距内缩，凹多边形与矩形地块均保持均匀壁厚且无自交）、「🎯 等比同心」与「✒️ 自由内圈」（每个控制面可独立拥有不同内圈轮廓，如底层方孔过渡到顶层圆孔/星孔，并支持一键同步到全部控制面）。':
    'Independent per-section inner modes: SDF Parallel Offset, Proportional Concentric, and Custom Inner curves with one-click Sync All.',
  '截面预设扩展至 13 款，新增「平放半圆拱」、「平放圆弧拱 (C形)」、「马蹄U形拱」、「八角形」，外圈与内圈均可独立套用任意预设、手绘闭合或拖拽贝塞尔手柄，且堆叠吸附自动识别镂空庭院内部地面高度。':
    'Expanded section presets to 13 (including Flat Arch, C-Arc, Horseshoe U & Octagon) with hollow courtyard floor stacking.',
  '拱形内圈曲线交互编辑与平行等厚预设': 'Interactive Arch Inner Curve Editing & Parallel Offset',
  '镂空模式下新增拱圈内圈模式预设：「📏 平行等厚」（默认，按真实物理法向内缩保持拱顶与两侧拱脚壁厚完全一致，修复窄高拱顶偏厚问题）、「🎯 等比同心」、「🌉 竖向等厚」与「✒️ 自由内圈」，实心模式下自动隐藏内圈控件。':
    'Added 4 arch inner relation modes: Parallel Offset (default), Proportional, Equal Vertical, and Custom Inner.',
  '镂空模式下支持直接编辑内圈曲线：可切换「🟢 编辑外圈 / 🔵 编辑内圈」（或双击内圈虚线直接解锁），独立拖拽控制点、圆滑/折角/贝塞尔手柄、插点删点、左右对称、手绘拟合，也可直接拖拽内圈拱顶菱形手柄实时调节壁厚。':
    'Direct inner arch editing with independent nodes, handles, symmetry, freehand fitting, and live diamond thickness handle.',
  '新增「方门平顶」等共 9 款曲线预设，可分别一键应用到外圈或内圈（例如外平顶城门 + 内哥特尖拱、外半圆拱 + 内马蹄拱），并内置防穿模自动钳制保护。':
    'Expanded to 9 arch presets (including Square Portal) applicable independently to outer or inner arches with anti-intersection clamping.',
  '新增拱形 / 拱券立体工具（实心与镂空 + 多控制点曲线）': 'New Arch / Vault Parametric Primitive (Solid, Hollow & Curves)',
  '新增「拱形 / 拱券（躺卧半圆柱）」参数化立体预设，支持 0° / 90° / 180° / 270° 四向水平拉伸与四向视角无损旋转闭合。':
    'Added parametric Arch / Vault primitive supporting 4 orientations and lossless 4×90° rotation closure.',
  '支持一键切换「实心躺卧半圆柱」与「中间镂空」，镂空模式下提供「空心半圆筒壳体（独立拱圈）」与「方体城门 / 桥洞（平顶券门）」双样式及实时拱壁厚度滑块。':
    'Toggle between Solid Barrel, Hollow Shell, and Flat-Top Gate Portal with live thickness slider.',
  '配备交互式拱形立面曲线编辑器与放大精细编辑弹窗：支持点击弧线任意处添加多个控制点、切换圆滑 / 折角 / 贝塞尔手柄、左右对称同步编辑、一笔手绘拟合，并内置半圆拱、扁弧桥拱、哥特尖拱、抛物线拱、马蹄拱、葱头拱、直壁高拱、折线平拱 8 款建筑预设。':
    'Interactive arch curve editor with node insertion, smooth/corner/Bezier modes, symmetry, freehand fitting, and 8 architectural presets.',
  '模型取色器升级为 Pixel Meow 同款专业选色器': 'Upgraded to Pixel Meow Pro Color Picker',
  '彻底替换模型主体色、顶面色与纹理色的系统原生取色弹窗，接入 Pixel Meow 同款专业选色器：支持 SV 二维取色面板、色相条、HSV / RGB / HSL 三模式通道滑块与 < / > 长按微调按钮。':
    'Replaced native color inputs with Pixel Meow’s SV square, Hue bar, HSV/RGB/HSL sliders, and hold-to-nudge controls.',
  '支持 HEX / rgb() / rgba() 代码复制与粘贴（从 Pixel Meow 复制的 8 位 RGBA 代码可直接粘贴到模型取色器并自动保持不透明）。':
    'Supports HEX / rgb() / rgba() copy & paste (8-digit RGBA from Pixel Meow pastes cleanly).',
  '内置 23 套像素与轴测建筑色板（含「轴测建筑 · 城市建材」），支持新建/另存/重命名/删除自定义色板、长按删色、导入 .gpl / .hex / .bmeow 色板、导出 .gpl 及从当前模型画布提取色板，并持久化最近使用色彩。':
    'Includes 23 built-in palettes, custom palette CRUD, .gpl/.hex/.bmeow import, .gpl export, canvas color extraction & persistent recent colors.',
  '检查器交互全面修复与几何细节打磨': 'Inspector Fixes & Geometry Polish',
  '彻底修复参数检查器与图层面板中拖拽滑块、修改输入框及切换开关时保存撤销点导致面板重建、拖动中断或旧值残留的问题。':
    'Fixed inspector & layer panel slider interruptions and stale inputs during history saves.',
  '修复关闭自动光影时大尺寸穹顶/斜坡顶面色失效、穹顶等距格栅越界铺满下半球，以及图形超出画布边缘时的伪轮廓线问题。':
    'Fixed large dome/slope top colors, dome roof grid clipping, and out-of-bounds outline artifacts.',
  '优化曲面柱体接缝对齐稳定性与包围盒计算性能，新增控制面自动插值过渡，并完善外扩控制面与直角三棱柱的遮挡排序及叠放计算。':
    'Improved loft seam stability, depth sorting, and stacking calculations for expanded sections and right tri-prisms.',
  '精简非曲面图形的工程与历史快照体积，保留老用户主动选择的主题配色，并优化大屏曲线弹窗与场地边框细节体验。':
    'Reduced non-curved snapshot size, preserved user themes, and polished fullscreen curve modals & plot frame UX.',
  '控制面交互与参数面板修复': 'Section Controls & Parameter Panel Fixes',
  '修复曲面柱体控制面参数面板中高度、缩放、扭转、U/V 偏移、名称及上下移动无法实时调节的问题。':
    'Fixed live updates for loft section height, scale, twist, U/V offset, renaming, and reordering.',
  '修复滑块右侧数值输入框点击焦点被抢占的问题，提升触屏与键鼠调节体验。':
    'Fixed numeric input focus loss next to sliders for smoother touch & mouse editing.',
  'Blender Meow 品牌升级与建模体验焕新': 'Blender Meow Rebrand & Major Modeling Upgrade',
  '应用名称正式升级为 Blender Meow（内部工程与数据无缝兼容保留）。':
    'Officially rebranded to Blender Meow with seamless project compatibility.',
  '新增「曲面柱体（多控制面）」工具：支持用闭合曲线工具自由绘制截面控制面、像图层一样堆叠管理任意多个控制面并自动插值补全曲面，完美支持四向 90° 等距旋转变形。':
    'Added Multi-Section Loft Column tool with closed-curve drawing, stacked sections, smooth interpolation & 4×90° rotation.',
  '新增「直角三棱柱」立体预设：操作与立方体一致，支持竖直对角切半（直角底面）与水平对角切半（直角坡体）及四向朝向旋转。':
    'Added Right Tri-Prism primitive with vertical & horizontal diagonal cuts and 4 orientations.',
  '默认界面主题调整为「暗夜黑」，新建图形的「轮廓」默认选项改为「无描边」（原“1px 轮廓”现更名为“轮廓”）。':
    'Updated default theme to Dark Night and default shape outline to None.',
  '左侧工具栏新增「场地边框」工具：支持隐藏地面方向指示边框，并可在画布直接拖拽移动/缩放，或在参数面板精确设置边框大小与位置。':
    'Added Plot Frame tool to toggle, drag, resize, or precisely configure the ground compass frame.',
  '新增版本更新日志：每次版本更新启动后自动弹出一次提示，也可随时在项目主页查看。':
    'Added version changelog dialog shown once after upgrades and accessible anytime.',
  '稳定度、导出精度与 3D 量尺增强': 'Stability, Export Precision & 3D Ruler Upgrade',
  '优化历史撤销/重做栈快照时机，拖拽取消不污染重做列表。':
    'Improved undo/redo snapshot timing so cancelled drags never pollute history.',
  '增强 3D 混合量尺、非正方形场地旋转闭合与 2:1 像素立面纹理对齐精度。':
    'Enhanced 3D mixed ruler, non-square plot rotation closure, and 2:1 pixel wall pattern alignment.',
  '修复精简裁切 PSD 导出中隐藏图层与跨端 Pixel Meow 导入联动问题。':
    'Fixed trimmed PSD hidden layer bounds and cross-platform Pixel Meow handoff.',
  '初版发布': 'Initial Release',
  '支持 32×16 等距菱形网格拖拽生成立方体、圆柱体、多棱柱、斜坡、四棱锥、圆锥、穹顶与 TheoTown 绿地底座。':
    'Drag-to-create Box, Cylinder, Prism, Wedge, Pyramid, Cone, Dome & TheoTown Grass Base on a 32×16 isometric grid.',
  '支持四向 90° 等距视角旋转、TheoTown 双比例尺量尺、分层 PSD/PNG 导出及一键导入 Pixel Meow。':
    'Supports 4×90° isometric rotation, TheoTown dual-scale ruler, layered PSD/PNG export & one-click Pixel Meow handoff.',
};
