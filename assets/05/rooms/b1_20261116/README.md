# 四间正式底图（批次 1，2026-11-16）

用户用 Gemini 出的四间空屋白天底图，原生 2560×1440，不是放大图。出图要求见 `设计/出图要求/2026-11-16_批次1_四间正式底图.md`，复核见 `设计/讨论记录/2026-11-16_批次1四间底图复核_Claude.md`。

四间都齐了（卧室补了床头柜后重出过一次）。**内核从 2026-11-16 起读这一套的 `room_locations.json`**，`g5_20261115/` 冻结不再用。

## 每间有什么

| 文件 | 内容 |
|---|---|
| `interior_rgba.webp` | 整张底图，玻璃处透明，边缘软化约 1 像素。窗框、窗格、窗框内侧的亮边和挡在玻璃前的东西（炉间的收音机、唱片机、扶手椅背，观测间的玻璃罐，卧室的床和木箱）都在这一层 |
| `outside_winter_day_clear_rgba.webp` | 窗外，冬天晴天白天，只留玻璃那块（比玻璃外扩 2 像素，垫在软边下面） |
| `glass_mask.png` | 玻璃掩码 |

叠法：窗外层在下、室内层在上，叠回去跟原图逐像素一样。

## 状态图层（批次 2，白天）

整幅 2560×1440 的透明 WebP，从左上角叠在室内层上面，叠法和顺序见 `game/src/art/layers.ts`。由 `build2.py` 从 `出图/批次2/` 抠出，来源记在 `room_locations.json` 各间的 `stateLayers`。复核见 `设计/讨论记录/2026-11-16_批次2物件状态复核_Claude.md`，观测间见 `设计/讨论记录/2026-11-16_观测间补出复核_Claude.md`。

| 间 | 图层 |
|---|---|
| 炉间 | `woodpile_1..4`、`fire_flame_ember/low/mid/high`（含白天炉前石台的暖光）、`kettle`、`armchair_blanket`、`snack_plate`、`oil_lamp_body`、`radio_fixed`/`radio_broken`、`gramophone_open`/`gramophone_covered` |
| 灶间 | `stock_sparse/half/full`、`coat`、`prep`、`oil_lamp_body` |
| 卧室 | `quilt_thick`、`oil_lamp_body` |
| 观测间 | `desk_work`、`cup`、`heater_flame_on`（含暖炉龛里和地上的暖光）、`jar_1..3`、`books_few`/`books_many`（整个书架取新图）；`oil_lamp_body` 还没有：补出那张把油灯画成点着的，等再出 |

炉间唱片机原来罩着布，揭开后布占的那块是窗外：这块并进了炉间的玻璃掩码（室内层透明、窗外层用新图的窗外），没修好时由 `radio_broken`、`gramophone_covered` 把底图原样盖回去。所以炉间的室内层、窗外层、掩码是 `build.py` 之后再由 `build2.py` 改过的，重跑 `build.py` 以后要接着跑 `build2.py`。

还没有的（G6、G7、G8 做）：夜里的窗外、下雪和暴风雪、夜色、夜里的炉火光和点着的油灯、人物。观测间的玻璃罐、灶间的油灯灯罩是半透明的，里面烤着白天的雪景，夜里会露馅，等夜景那批一起处理。

## 坐标

`room_locations.json` 是这套的唯一坐标，结构跟 `../g5_20261115/room_locations.json` 一样。

- 玻璃多边形按新掩码重描，每块一个。
- 门洞、展示位、人物框、油灯和衣架、储物锚点，以及没改的站位（扶手椅、书桌、后门、床）：新图跟参考图几乎没挪位，每间拿几十个特征点做局部模板匹配，拟合出来只是竖直方向拉伸约 0.9%（`y' ≈ 1.009·y − 6`，横向不变），误差在 2 像素内，就按这个换算。`standingHeightPx` 按原公式重算。
- 其余十二个站位重新标过（`build.py` 的 `STATIONS`）：旧套好些脚底落在家具里或窗台高度，人形会站进柴炉、料理台、书桌。现在都放在他要用的那件家具前面、看得见的地板上，遮挡关系清空。批次 2 画出人物以后，按画出来的位置再量一次。
- 状态图层、人物图、暖炉火光的文件引用都去掉了，那些是旧套的文件。

## 重做

```
python build.py <本机 出图/批次1 目录> [hearth_room observation_room kitchen_room bedroom]
```

状态图层：

```
python build2.py <本机 出图 目录> [hearth_room observation_room kitchen_room bedroom]
```

要 Pillow、numpy、scipy、opencv-python。玻璃按「偏冷的像素、跟旧玻璃位置重合的连通块」找；观测间、灶间每块玻璃再取凸包，补上窗框边偏暖的雪光；炉间、卧室玻璃前有家具，不取凸包。挡在玻璃前、颜色又分不开的东西（玻璃罐、床）用排除区先扣掉，太小的玻璃（卧室山墙的小三角窗）用补入区收进来。参数都写在脚本开头。`FIT` 里没有的房间（现在是卧室）从 `批次1_参考/` 现算拟合。
