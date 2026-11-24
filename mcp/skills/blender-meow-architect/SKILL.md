---
name: blender-meow-architect
description: 指导 AI 通过 blendermeow_studio MCP 工具套件（#M1–#M10）在 Blender Meow 2:1 等轴测 3D 参数化建模坊中进行严格符合 TheoTown 透视的白模起型、拱形/放样/柱体截面雕刻与四视角验证，并无缝将纯色分层 PSD 交接至 Pixel Meow 画板进行细节精绘（仅在用户明确要求时启用 3D 平面纹理贴附）。当用户要求搭建 3D 轴测建筑、参数化几何体、多视角导出或将 Blender Meow 模型导入 Pixel Meow 时激活。
---

# Blender Meow 3D 轴测起型与协同工作流技能

> [!IMPORTANT]
> 本技能与 `pixel-meow-artist` 分工明确、无缝衔接：
> - **Blender Meow（起型与透视辅助）**：严格遵循 TheoTown 2:1 等轴测透视，负责空间体积比例、4×90° 视角闭合、拱形/放样曲率、分块结构以及**自动 TheoTown 1:1 正右方地面阴影（`地面阴影` 独立图层，默认 `#00071C5A`）**。**默认仅输出“纯色 + 明暗区分”的干净体块**，不同功能体块用不同纯色区分边界，**不提前填充纹理或立面图案**，避免固化画面、限制后续 2D 像素创作。
> - **Pixel Meow（细节与美术精绘）**：承接 Blender Meow 导出的分层纯色透视底稿（与可选的 `地面阴影` 图层），负责全部建筑立面细节（门窗、檐口、招牌、栏杆）、材质肌理、建筑阴影与结构阴影补充、羽化玻璃反光、建筑质感渲染滤镜与 3 像素小人等精细绘制。

---

## 1. 端到端 3D 起型 -> 2D 精绘协同工作流

1. **启动与确认状态**：调用 `#M1 studio_open` 启动建模坊 Hub（Antigravity Sidecar 环境下传 `autoOpen: false`，并在回复中给出 `[Blender Meow 建模坊](sidecar://blender-meow/blender_studio/ui.html)`），再视需要调用 `#M2 studio_get_state` 检查画布尺寸、`plotU × plotV`、`viewRotation` 与已有图层。
2. **新建地块或清空重建**：调用 `#M3 studio_doc_action(action="new_doc", plotU, plotV, width, height, withBase: true)` 设定标准 `32×16 px` 绿地格基地。
3. **分层搭建参数化体块**：用 `#M5 studio_upsert_shape` 按“底座 -> 商业裙房 -> 主体塔楼 -> 退台/女儿墙 -> 屋顶设备间/尖顶/拱门”自下而上堆叠图层，启用 `stackOnBelow: true` 自动吸附到下方体块顶面。
4. **高级结构雕刻**：使用 `#M6 studio_edit_structure` 微调 `arch`（拱形预设/控制点/镂空壁厚）、`loft`（多高度控制截面/过渡面/空心顶板）与多截面柱体（`col_enable` / 锥度 / 扭转 / 棱边倒角），把复杂透视造型在 3D 阶段一次定准。
5. **纯色分块原则（禁止在起型阶段填充纹理与图案）**：
   - **默认禁用非纯色纹理与程序化图案**：除非用户明确要求在 Blender Meow 中贴图，否则**不要调用 `#M7 studio_texture_action`**（不贴内置材质、不导入贴图、不在 3D 面上画门窗），且 `#M5 studio_upsert_shape` 的 `pattern.type` 必须保持默认 `"none"`（不要填 `windows` / `curtain_v` / `curtain_h` / `brick` / `roof_grid`）。
   - **纯色明暗区分体块**：默认保持 `autoShade: true`，仅输出只区分顶面 / 左亮面 / 右暗面的纯色体块，并为不同功能部位设置易区分的 `baseColor`（及可选 `roofColor`），例如裙房、主楼、屋顶、雨棚、设备间各自使用不同色块，方便导入 Pixel Meow 后快速识别结构边界与选区。
   - **定位边界**：Blender Meow 的输出严格符合 TheoTown 2:1 等距透视，核心价值是提供精准的**建筑造型与透视参考**；所有门窗排布、墙面肌理与建筑细节一律留到 Pixel Meow 中自由创作。
6. **双通道视觉自检 & 4 视角核验**：
   - 调用 `#M8 studio_get_preview`（无网格纯净图，支持 `fourViews: true` 四向拼接与 `hideTheoTownBase: true`）检查整体比例、体块明暗关系与 4 向封闭性；
   - 调用 `#M9 studio_get_snapshot`（叠加 `32×16` 等距格、地块边框、`(x, y)` 标尺）确认无坐标偏移、无悬浮缝隙；
   - 必要时执行 `studio_doc_action(action="sort_depth")` 校准遮挡排序。
7. **无缝导入 Pixel Meow 精修**：
   - 调用 `#M10 studio_handoff_to_pixelmeow` 将分层纯色白模 PSD（或四视角 PSD / 扁平 PNG）直传 Pixel Meow 画板（通常设 `hideTheoTownBase: true` 以免绿地草皮干扰 2D 精修）；
   - 附上 `[Pixel Meow 画板](sidecar://pixel-meow/pixel_canvas/ui.html)` 并切换参照 `pixel-meow-artist` 技能，以导入的透视体块为造型基底，完成立面细化、三大类阴影、玻璃反光与质感渲染。

---

## 2. TheoTown 统一双坐标、比例尺与 0-AA 铁律

### 2.1 双单位换算（格子/像素 vs 真实米制）
- **单格地基**：`1 cell = 32 × 16 px` 菱形投影，对应现实边长 **`9.6m × 9.6m`**（面积 `92.16 m²`）。
- **垂直比例与人物标尺**：
  - **人物身高仅 `3 px`**（约 `1.6m`），**`1m ≈ 1.875 px`**（`16m = 30 px`），`3px = 1.6m`。
  - 住宅标准层高 **`3.2m ≈ 6 px`**（商业首层可取 `7–9 px`，即 `3.7m–4.8m`）。
- `#M5 studio_upsert_shape` 支持两套单位参数（像素/格子优先，或传米制自动换算）：
  - **格子/像素单位**：`u`, `v`, `sizeU`, `sizeV`, `zPx`, `heightPx`
  - **米制单位**：`uMeters`, `vMeters`, `sizeUMeters`, `sizeVMeters`, `zMeters`, `heightMeters`

### 2.2 `0-AA`、纯色起型与光影规则
- **严格 `0-AA`**：所有参数化渲染保持 `alpha === 0 || 255`，禁止抗锯齿半透明边缘。
- **描边控制 (`outlineMode`)**：作为 Pixel Meow 精绘底稿时，推荐默认 `outlineMode: "none"`（契合 TheoTown 无描边光影法则，避免黑边残留污染后续上色）；仅当需要强调单层外剪影参考时才设 `"outer"`。
- **光影与图案默认设置**：
  - 默认保持 **`autoShade: true`**（输出顶面/左亮面/右暗面清晰分色的纯色体块，既直观体现透视转折，也便于在 Pixel Meow 中按明暗面魔棒选区）；仅在需要纯扁平 Albedo 色块时设 `autoShade: false`。
  - 默认保持 **`pattern.type: "none"`**，禁止在起型阶段叠加程序化门窗或砖格图案。

---

## 3. 11 种 3D 几何体与高级结构微调（`#M5` / `#M6`）

### 3.1 `studio_upsert_shape` (`#M5`) 支持的全部 11 种 `shapeType`
| `shapeType` | 适用建筑部位 | 核心专属参数 |
| :--- | :--- | :--- |
| `box` | 主楼体块、裙房、女儿墙、设备间、空调外机 | 支持 `col_*` 多截面编辑（按需支持 6 面贴图） |
| `right_tri_prism` | 直角斜切转角体块、坡道、三角山墙 | `ori: 0..3`, `triPrismCut: "vertical" \| "slope"` |
| `wedge` | 单坡斜屋顶、人字双坡屋顶、斜坡雨棚 | `ori: 0..3`, `wedgeMode: "ramp" \| "gable"` |
| `pyramid` | 四棱锥尖顶、方亭屋顶、装饰方尖碑 | 棱锥顶点收束 |
| `prism` | 3–16 边形塔楼、八角厅堂、多棱采光顶 | `prismSides: 3..16`, `ori: 0..3`, 支持 `col_*` |
| `cylinder` | 圆柱核心筒、水塔、圆筒形转角、灯柱 | 支持 `col_*` 截面锥度与偏移 |
| `cone` | 圆锥尖顶、尖塔教堂屋冠、灯塔顶部 | 圆锥收尖 |
| `dome` | 半球穹顶、天文台、球形雕塑、树冠球体 | `domeMode: "dome" \| "sphere"` |
| `arch` | 券门洞、连续拱廊、哥特尖拱窗、门头牌坊 | `archPreset`, `archHollow`, `archHollowStyle`, `archInnerMode`, `archThickness`, `archNodes`, `archInnerNodes` |
| `loft` | 异形曲线塔楼、扭转摩天楼、心形/星形/三叶草异形体 | `loftPreset`, `topScale`, `loftInterp`, `loftHollow`, `loftFloorT`, `loftSections` |
| `theotown_base` | `32×16` TheoTown 绿地格参考底座 | `sizeU`, `sizeV`, `heightPx: 0` |

- **程序化立面图案 (`pattern`)**：**默认保持 `type: "none"`**；仅当用户明确要求在 Blender Meow 中直接预览立面分格时，才按需使用 `windows | curtain_v | curtain_h | brick | roof_grid`（配合 `rows` / `cols` / `spacingPx` / `marginPx` / `applyTop`）。
- **更新 vs 新建 (`mode`)**：默认 `mode: "auto"` 会优先按 `layerId` 或同名 `name` 更新已有 3D 图层，找不到再创建新图层，方便 AI 迭代微调不产生冗余垃圾层。

### 3.2 `studio_edit_structure` (`#M6`) 高级结构编辑
- **拱形微调**：
  - `subAction: "arch_preset"`：套用 `semicircle | segmental | pointed | parabolic | horseshoe | ogee | stilted | trapezoid | rect_door` 到外环或内孔（`target: "outer" | "inner"`）。
  - `subAction: "arch_nodes"` / `"arch_slide_node"`：编辑外/内轮廓曲线节点及镂空参数，或沿轨道弧长 `arcS ∈ [0, 1]` 无极滑动第 `nodeIndex` 个控制点。
- **放样曲面体 (`loft`)**：
  - 支持 23 种 `loftPreset`（`circle`, `rounded_rect`, `square`, `octagon`, `flat_arch_d`, `c_arch`, `u_arch`, `kidney`, `clover`, `heart`, `star`, `teardrop`, `l_shape`, `poly_3`..`poly_12`）。
  - `subAction: "loft_add_section" | "loft_update_section" | "loft_delete_section"`：沿高度 `t ∈ [0, 1]` 增删改控制面（`scale`, `twistDeg`, `offsetU`, `offsetV`, `isTransition`, `innerMode`, `innerThickness`），构建收缩塔身或突变层。
- **多截面柱体 (`col_enable` 等)**：
  - 适用于 `box`、`prism`、`cylinder` 及 `triPrismCut="vertical"` 的 `right_tri_prism`。
  - `subAction: "col_enable" | "col_add_section" | "col_update_section" | "col_update_edge"`：开启退台锥度/扭转或精确编辑任意高度截面第 `edgeIndex` 条棱边的 `offset`、`angleDeg` 与 `locked`。

---

## 4. 规则平面纹理贴附与像素绘制（`#M7 studio_texture_action`，仅用户明确要求时启用）

> [!CAUTION]
> **常规起型工作流默认跳过本节！** 不要主动为建筑体块贴附非纯色纹理，以免 Blender Meow 的贴图固化立面、削弱后续在 Pixel Meow 中的像素细节创作能力。**仅当用户明确指示**要在 Blender Meow 中贴附指定纹理、拼贴材质或编辑模型面像素时，才调用 `#M7 studio_texture_action`。

拥有规则平面的几何体（`box`、`prism`、`wedge`、`pyramid`、`right_tri_prism`、`theotown_base`）支持视向不变的平面纹理：

1. **查询平面规格**：`action="list_faces"` 返回该图层所有可贴图面的 `faceId`（如 `top`, `bottom`, `pu`, `nu`, `pv`, `nv`, `wall_pu`, `slope_main`, `side_0`）及其精确矩形展开尺寸 `width × height` 与世界朝向。
2. **导入纹理到素材库**：`action="import_asset"` 支持直接传紧凑 ASCII **`spriteMatrix`**（`paletteSpec` + `rows` + `scale`）、`pngBase64` / `filePath`（支持相对工作区路径）或 `rgbaBase64`，可选 `shear: { direction: "up_right" | "down_right", step }` 引入斜切形态与分组归档（`groupName` / `groupId`）。
3. **贴附到模型表面**：
   - `action="set_face_texture"`：支持 `mode: "stretch" | "tile" | "custom" | "none"`，可裁剪 `crop: { x, y, w, h }`、`tileScale`、`offsetX/Y`、`flipX/Y`、`rot90`、`opacity`、`shadeWithFace` 与 `applyToAllSides: true` 一键全立面套用。
   - `action="compose_face_decals"`：在 `custom` 模式下将多个 `assetId` 按平面像素坐标 `(x, y, w, h)` 自由拼贴到同一墙面。
   - `action="paint_face_pixels"`：直接向某平面烘焙后缓冲区执行 `sprite_matrix`、`rect` 或 `pixels/stroke` 像素完美笔刷精修。

---

## 5. 无缝导入 Pixel Meow（`#M10 studio_handoff_to_pixelmeow`）

| `exportScope` | 适用场景 | 默认 `importMode` | 说明 |
| :--- | :--- | :--- | :--- |
| `"all_layers"` | 完整建筑多部件分层交付精绘 | `"new_project"`（或 `"as_layer"`） | 将所有可见纯色 3D 体块打包为多图层 PSD 直传 Pixel Meow |
| `"selected_layers"` | 仅传递新做的屋顶/门楼/塔尖体块 | `"as_layer"` | 支持按 `layerIds` / `layerNames` 或 `activeOnly: true` 筛选后导入已有 Pixel Meow 画布 |
| `"four_views"` | 制作 TheoTown 4 朝向旋转插件图集 | `"new_project"` | 一键导出 `0° / 90° / 180° / 270°` 四视角纯色白模图层 PSD 到 Pixel Meow 统一精绘 |
| `"flat_png"` | 快速叠加单一透视剪影参考 | `"as_layer"` | 导出合成 PNG 直接贴到 Pixel Meow 指定 `(x, y)` |

> [!TIP]
> 导出到 Pixel Meow 前，若 Pixel Meow 画布已通过 `stamp_theotown_base` 生成草地或不需要绿地底垫，务必设置 **`hideTheoTownBase: true`**（不会破坏 Blender Meow 场景内的底座状态）。如需保留物理备份文件，附加 `saveWorkspaceCopyPath: "assets/building_layers.psd"`。界面用户也可随时点击右上角/弹窗中的 **`🚀 导入 Pixel Meow`** 按钮完成同样交接。

---

## 6. `#M1–#M10` 工具速查表与小体量建筑标准例程

| 编号 | 工具名 | 核心用途 |
| :---: | :--- | :--- |
| **#M1** | `studio_open` | 启动 Hub、自动打开独立窗或返回 Sidecar 入口 |
| **#M2** | `studio_get_state` | 读取画布尺寸、地块格数、旋转角、全图层参数与贴图/分组信息 |
| **#M3** | `studio_doc_action` | 新建/缩放画布、地块与地面阴影设置 (`set_ground_shadow`)、`rotate_view`、`sort_depth`、撤回重做、导入导出 PSD/PNG/JSON(`.bmeow`) |
| **#M4** | `studio_layer_action` | 选中、改名/显隐/混合模式、复制、删除、清场、`stack_on_below`、导入参考 `add_raster` |
| **#M5** | `studio_upsert_shape` | 创建/按名更新全部 11 种参数化几何体（双单位 + `stackOnBelow` + 纯色分块明暗） |
| **#M6** | `studio_edit_structure` | 拱形预设/控制点/滑轨、放样控制面、柱体多截面与棱边精修 |
| **#M7** | `studio_texture_action` | （仅用户明确要求贴图时使用）查面 `list_faces`、纹理入库、贴图拼贴、整面像素绘制 |
| **#M8** | `studio_get_preview` | 无网格纯净效果图（支持 `fourViews: true` 四视图拼图） |
| **#M9** | `studio_get_snapshot` | 带 `32×16` 轴测格、地块框、`(x, y)` 标尺的定位快照 |
| **#M10** | `studio_handoff_to_pixelmeow` | 全层/指定层/四视角纯色白模 PSD 或 PNG 无缝直传 Pixel Meow 画板 |

### 快速示范：1×1 三层小商铺纯色白模起型 -> Pixel Meow 精绘
1. `studio_open(autoOpen: false)`
2. `studio_doc_action(action: "new_doc", plotU: 1, plotV: 1, width: 96, height: 128, withBase: true, name: "转角咖啡馆")`
3. `studio_upsert_shape(name: "一楼店面体块", shapeType: "box", u: 0.125, v: 0.125, sizeU: 0.75, sizeV: 0.75, zPx: 0, heightPx: 8, baseColor: "#C87D55", autoShade: true, outlineMode: "none")`
4. `studio_upsert_shape(name: "二楼住宅体块", shapeType: "box", u: 0.125, v: 0.125, sizeU: 0.75, sizeV: 0.75, stackOnBelow: true, heightPx: 12, baseColor: "#E5D3B3", autoShade: true, outlineMode: "none")`
5. `studio_upsert_shape(name: "双坡屋顶体块", shapeType: "wedge", wedgeMode: "gable", u: 0.0625, v: 0.0625, sizeU: 0.875, sizeV: 0.875, stackOnBelow: true, heightPx: 6, baseColor: "#9E3B33", autoShade: true, outlineMode: "none")`
6. `studio_get_preview(fourViews: true, hideTheoTownBase: true)` & `studio_get_snapshot()` 自检确认体块比例与四向闭合（保持纯色无纹理）。
7. `studio_handoff_to_pixelmeow(exportScope: "all_layers", importMode: "new_project", hideTheoTownBase: true, projectName: "转角咖啡馆")` -> 进入 Pixel Meow 后再自由绘制橱窗、门窗、招牌、三类阴影、玻璃羽化反光与 `3px` 路人。
