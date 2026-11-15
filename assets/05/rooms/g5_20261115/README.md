# 四间游戏分层底图修订版（2026-11-15，GPT）

> 分支 `gpt/05-four-room-r1-r7-layers-20261115`，从 `main@cfebd563` 分出。根据根目录 Claude《四间底图复核与修改单》继续制作，**这套四间构图没有重新布局**，仅修复家具与物件、矩形/多边形玻璃、夜间光照、天气、站位与男性角色摆放。**仍是 1672×941 原画重采样到 2560×1440 的阶段游戏资产，不能标记原生 G5 通过**。

## 现有资源（均真实二进制，不是空白占位）

每间目录含 `source_clean_1672x940.webp`（可追溯修订底图）、`interior_rgba.webp`（玻璃区透明）、`glass_mask.png`（仅玻璃几何）、`outside_winter_day_rgba.webp`、`outside_winter_night_rgba.webp`、`day_preview.webp`。新增 `night_ambient.webp` **空间不同明暗**、`fire_spill_low/high.webp`（炉间直接受光，其他房间经门洞暖光）、`weather_snow/blizzard.webp`（统一种子和风向，严格受玻璃 mask 限制）、`oil_lamp_body/glow.webp`（两个独立层）、`actor_male_pose.webp`、`actor_contact.webp`；卧室有 `bed_front_occlusion.webp`。

可开关物品在各间目录里：炉间 `woodpile_0..4.webp`（五档）和 `armchair_blanket.webp`、`snack_plate.webp`；观测间 `books_few/many.webp`、`cup.webp`、`map.webp`；灶间 `stock_sparse/full.webp`、`coat.webp`、`herbs.webp`；卧室 `quilt_thick.webp`，**底图开局只显示薄床褥**。炉间另有独立 `fire_flame_ember/low/high.webp`，没有第二口火炉。真实物件一律独立开关。

[room_locations.json](room_locations.json) 是唯一坐标来源（2560×1440）；`manifest.json` 只记资源路径和技术状态，**不重复各地点锚点**；旧草图的 1600×900 站位 JSON 已弃用，仅保留重定向说明。

[preview.html](preview.html) 可以在浏览器中手动选炉间/观测间/灶间/卧室（默认观测间），选择日夜、天气、炉火、油灯、物品、人物以及实际 320×180 / 480×270 / 1280×720 三个显示尺寸。它只是美术审图页，**不读真实 Snapshot**，不能证明游戏已经接入。完整的内核接入属于 Claude 的 `game/` 工作。

测试：`python validate.py`（需 Pillow）；检验全部文件存在、SHA、RGBA、窗外不透物件、四间坐标单源、六处展示位、男主人物层、天气三状态。前景/后景的 PNG/WebP 像素已实际校验；小窗口可在浏览器打开审图。

## 必须保留的限制

1. 所有原画源尺寸仍为 1672×941，虽交付 2560×1440，**不是原生 2560×1440 手绘**。
2. 窗洞改用人工画的多边形，前景地毯/毯子不会误抠；对窗框细节仍有人工再精修的空间，窗前器材与可变展示物未做逐像素手工分离。
3. 日夜有分布式局部受光、炉火/油灯独立蒙版，但不能冒称物理准确的全局照明；暖炉局部残光需要最终原画人工精修。
4. 同一天气事件由同一套雪粒参数驱动，但每间原画窗外背景里仍烘焙了一些零星雪花；“calm”是无新增雪粒而不是晴天完全无雪的最终素材。
5. 男性四姿态能在各房小窗看到，仍是单帧试摆，不是 G8 已通过的多动作、多朝向独立精灵；卧室使用从已批准插画提取的薄被前景遮挡。
6. 自动截图、游戏内部 Snapshot 接入与真实可见率仍由 Claude 后续复核；本轮不碰 `game/`、06、00、HANDOFF、01–03。

**中断续做修正（2026-11-15）**：卧室 `bed_front_occlusion.webp` 已从现有薄床褥画面取样替换原来不自然的格纹条状遮挡；属于可审阅的 G8 姿态试摆，人物面部/被角仍需精修。四间窗片坐标统一换算成发布画布 2560×1440，唯一真源继续是 `room_locations.json`。`manifest.json` 已同步更新该二进制的 SHA-256。
