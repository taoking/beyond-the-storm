# 风雪之外 · 游戏源码

正式游戏的代码在这里。现在是 06 的灰盒阶段（G0 内核 + G1 的薄界面）：世界模拟、专注时钟、角色自主行为、事件记录和自动化测试是要一直用下去的；界面只有色块和文字，以后按 04、05 整个换掉。

设计在 `../设计/`，规则以那里为准。技术方案见 `../设计/06_技术与版本.md`。

## 运行

需要 Node 22.18 以上（开发时用的是 26）。

```sh
npm install
npm test            # 全部自动化测试（约 10 秒）
npm run typecheck   # 类型检查
npm run dev         # 灰盒界面，http://localhost:5173
npm run build       # 类型检查 + 打包到 dist/
npm run longrun     # 无人值守长跑，对照 02 第 5.7 节的验收目标。可加 --runs 300 --years 8 --case bare
npm run sample      # 打印头几天的动作流水：npm run sample -- 3 2（种子 3，2 天）
node tools/report.ts  # 人物可见率、活动密度、时间配比
```

## 结构

```
src/core/      内核：纯逻辑，不碰 DOM、不读系统时钟，种子固定就能重跑
  config.ts      所有数值（02 第 13 节）。02/03 没写、实现时补的初值在 IMPL 一节
  content.ts     地点、修缮和慢事、作物、样式（03）
  state.ts       世界状态：一份能整个存成 JSON 的事实
  sim.ts         世界模拟，一步一个游戏分钟：天气、柴粮、炉火、他怎么决定下一件事、项目、菜地
  outing.ts      出门和回家：行囊下限、压火、收尾、返家提示、昏倒
  focus.ts       专注计时、有效时间、份的结算、任务、成就
  heartbeat.ts   「这段时间应用是不是一直在运行」的判定
  game.ts        一局游戏：四种世界状态、白名单命令、把现实时间交给专注和世界
  view.ts        只读投影：界面要显示的一切从这里拿
  visual.ts      G2 只读姿态/道具与独立氛围投影：不改世界规则和 RNG
  cameras.ts     镜头里看得见哪些地点（表现层的假设，05 定稿后改这张表）
  telemetry.ts   可见率、时间配比这些不给玩家看的指标
  save.ts        存档
  longrun.ts     长跑的统计口径，工具和测试共用
src/app/       灰盒界面：runtime.ts（心跳、存档、多窗口）、scene.ts（色块场景）、main.ts（面板）
tests/         自动化测试，标题里写着对应 02/04/06 的哪一条
tools/         长跑、采样、指标报告
```

内核和界面之间只有两样东西：`game.ts` 里 `cmd` 开头的命令，和 `view.ts` 的 `present()`。换界面不用动内核。

## G2：画面与世界分离（06 v0.3）

本阶段由 GPT 临时接手 06 的只读表现部分；原 G0 世界模拟、专注、项目经济、存档与自动化不改。输出依然只有 `present(game, wall, calendar): Snapshot`。

新增的**只读字段**：

- `snapshot.stage.activity`：真正的 Activity.kind；当世界没有行动、氛围是独立演出或者户外临时专注是空屋时为 `null`。
- `snapshot.stage.pose`：九种可供精灵选择的姿态键（`sleep / sit / sitRead / sitWrite / sitHold / standWork / standLook / crouch / walk`），不通过解析中文活动说明生成。
- `snapshot.stage.prop`：当前可绘制道具（书、日志、杯、碗、壶、工具等），没有就为 `null`。
- `snapshot.look`：当前**实际应该绘制**的季节、天气、时段；`source` 清楚区分 `world`（真实）、`ambience`（冻结的选择）和 `missing`（旧存档/没有有效选择）。`snapshot.world` 依然报告真正的世界事实，两个投影不会互相覆盖。
- `fire.look`、`jar.cones`、`jar.pending` 保持旧有语义，画面不能自行生火、摆球果或计份。

`src/app/` 的**色块灰盒**已使用这些展示字段。正式像素画和场景坐标仍待 05 生产，不能认为有 `poseKey` 就已经拥有全部角色帧。

运行新旧全部测试：

```bash
npm test
npm run typecheck
npm run build
# 在仓库根目录运行：
node "设计/原型/05_v1.0_G2只读视觉适配器.test.cjs"
node --experimental-strip-types "设计/原型/05_v1.0_06真实快照冒烟.mjs"
```

新增测试位于 `tests/visual.test.ts`。自动化见 `../.github/workflows/06-g2-presentation.yml`。**这不是 Safari/macOS 长时间运行或完整野外 G2 验收**；野外吃饭 D6 仍是暂行规则。

