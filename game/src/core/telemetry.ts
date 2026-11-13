// 06 第 4 节要记、但不给玩家看的指标。只读世界状态；不属于世界事实，可以随时清零重记。
import { CAMERA_IDS, visibleIn, type CameraId } from "./cameras.ts";
import { zoneOf, type Zone } from "./content.ts";
import type { World } from "./state.ts";

export interface Telemetry {
  /** 正常陪伴状态下走过的游戏分钟（含他睡着的时候） */
  companionMinutes: number;
  /** 其中他醒着、也没有被带出门的分钟。可见率的分母是它。 */
  awakeMinutes: number;
  /** 他醒着的时间里，各镜头看得见他的分钟 */
  visibleAwake: Record<CameraId, number>;
  zoneAwake: Record<Zone, number>;
  placeAwake: Record<string, number>;
  /** 按活动类别分的分钟（含睡觉） */
  category: Record<string, number>;
}

export function createTelemetry(): Telemetry {
  return {
    companionMinutes: 0,
    awakeMinutes: 0,
    visibleAwake: { window: 0, hearth: 0, wideIndoor: 0, wideYard: 0 },
    zoneAwake: { indoor: 0, eaves: 0, yard: 0, nearby: 0, away: 0 },
    placeAwake: {},
    category: {},
  };
}

/** 每走过一个陪伴状态的游戏分钟调一次 */
export function sampleTelemetry(t: Telemetry, w: World): void {
  t.companionMinutes += 1;
  const a = w.actor;
  const cat = a.activity?.category ?? "none";
  t.category[cat] = (t.category[cat] ?? 0) + 1;
  if (a.asleep || a.away) return;
  t.awakeMinutes += 1;
  t.zoneAwake[zoneOf(a.place)] += 1;
  t.placeAwake[a.place] = (t.placeAwake[a.place] ?? 0) + 1;
  for (const cam of CAMERA_IDS) if (visibleIn(cam, a.place)) t.visibleAwake[cam] += 1;
}
