/**
 * 风雪之外 05 v1.0 | G2 只读视觉适配器（候选）
 *
 * Input: Claude 06 v0.2 game/src/core/view.ts present(): Snapshot
 * Output: a new lightweight view model. NEVER mutates input or simulation state.
 *
 * Coordinates below are a 640x360 PROPOSED spatial study for checking G2
 * mappings. They are NOT final artist-authored anchors or validated cameras.
 */
(function (root) {
  "use strict";

  const ART_W = 640, ART_H = 360;
  const FIRE_KINDS = ["out", "ember", "low", "mid", "high"];
  const CAMERA_RECTS = Object.freeze({
    wide: [0, 0, 640, 360],
    window: [24, 62, 376, 211.5],
    hearth: [328, 82, 300, 168.75]
  });

  // A first art-space candidate. Outside and hidden locations deliberately
  // have no anchor; they must not be "teleported" inside for an attractive shot.
  const ANCHORS = Object.freeze({
    bed: [554, 302],
    door: [35, 268],
    window: [168, 128],
    windowsill: [175, 193],
    desk: [217, 245],
    bookshelf: [377, 115],
    radio: [386, 188],
    workbench: [358, 267],
    gramophone: [352, 205],
    shelf: [412, 250],
    cellar: [424, 334],
    hearth: [474, 245],
    armchair: [408, 277],
    stove: [565, 227],
    instruments: [515, 128],
    backdoor: [618, 274]
  });
  const SPRITE_BOUNDS = Object.freeze([24, 48]); // placeholder only

  function intersects(rect, cx, cy, spriteWidth, spriteHeight) {
    const [x, y, w, h] = rect;
    const left = cx - spriteWidth / 2, top = cy - spriteHeight;
    return left < x + w && left + spriteWidth > x &&
      top < y + h && top + spriteHeight > y;
  }
  function copyPoint(x) { return x ? [x[0], x[1]] : null; }
  function plain(value) {
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : null;
  }

  function makeFrame(snapshot, cameraId, cameraOverrides) {
    if (!snapshot || !snapshot.stage || !snapshot.world || !snapshot.actor ||
      !snapshot.fire || !snapshot.jar || !snapshot.focus) {
      throw new TypeError("05 G2 adapter requires a full readonly 06 Snapshot");
    }
    const id = cameraId || "window";
    const cameras = cameraOverrides || CAMERA_RECTS;
    const crop = cameras[id];
    if (!crop || crop.length !== 4 || crop[2] <= 0 || crop[3] <= 0) {
      throw new RangeError("Unknown or invalid camera rect: " + id);
    }
    const mode = snapshot.mode;
    const place = plain(snapshot.stage.place);
    const anchor = place && Object.prototype.hasOwnProperty.call(ANCHORS, place)
      ? ANCHORS[place] : null;
    const stageShow = snapshot.stage.show === true;
    const seen = Boolean(stageShow && anchor && intersects(
      crop, anchor[0], anchor[1], SPRITE_BOUNDS[0], SPRITE_BOUNDS[1]));
    const illusory = snapshot.stage.illusion === true;

    // Structured pose/prop are anticipated G2-only additions. Never infer
    // sprite pose by parsing Chinese story prose from actor.label/stage.label.
    const pose = plain(snapshot.stage.pose);
    const prop = plain(snapshot.stage.prop);
    const activity = plain(snapshot.stage.activity);
    const fire = FIRE_KINDS.includes(snapshot.fire.look)
      ? snapshot.fire.look : "out";

    // The real weather remains available as factual info, but MUST NOT be
    // silently painted as the user's selected ambience weather.
    const projectedLook = snapshot.look && typeof snapshot.look === "object"
      ? snapshot.look : null;
    const isAmbience = mode === "ambience";
    const projected = isAmbience && projectedLook;
    const weather = projected
      ? {
          source: "ambience_projection",
          weather: plain(projected.weather),
          season: plain(projected.season),
          dayPart: plain(projected.dayPart)
        }
      : isAmbience
      ? { source: "projection_missing", weather: null, season: null, dayPart: null }
      : {
          source: "real_world",
          weather: plain(snapshot.world.look),
          season: plain(snapshot.world.dayLabel),
          dayPart: plain(snapshot.world.dayPart)
        };

    const cones = Math.max(0, Math.trunc(Number(snapshot.jar.cones) || 0));
    const pending = Math.max(0, Math.trunc(Number(snapshot.jar.pending) || 0));

    return {
      schema: "beyond-the-storm.art-frame.v1",
      camera: id,
      crop: copyPoint(crop.slice(0, 2)).concat(crop.slice(2)),
      artSize: [ART_W, ART_H],
      mode: mode,
      worldFrozen: snapshot.frozen === true,
      actor: {
        rendered: seen,
        actualPlace: plain(snapshot.actor.place),
        stagePlace: place,
        at: seen ? copyPoint(anchor) : null,
        illusion: illusory,
        pose: seen ? pose : null,
        posePending: Boolean(seen && !pose),
        activity: seen ? activity : null,
        prop: seen ? prop : null,
        outfit: seen ? plain(snapshot.actor.outfit) : null,
        whereabouts: !seen && !illusory ? plain(snapshot.actor.whereabouts) : null
      },
      fire: {
        look: fire,
        drawFlame: fire !== "out",
        // Fire and glow may be drawn only by the real state or a separately
        // marked frozen ambience look, never by proximity to the actor.
        drawGlow: fire !== "out",
        fromActualState: true
      },
      jar: {
        stagedCones: cones,
        pendingButNotDrawn: pending
      },
      weather,
      today: {
        events: Array.isArray(snapshot.today?.top)
          ? snapshot.today.top.map(e => ({ id: e.id, text: e.text, weight: e.weight, minute: e.minute })) : [],
        moreCount: Array.isArray(snapshot.today?.more) ? snapshot.today.more.length : 0
      },
      focus: {
        bar: plain(snapshot.focus.bar),
        text: plain(snapshot.focus.text),
        lastRoundSummary: plain(snapshot.focus.summaryText)
      },
      diagnostics: {
        // Non-final: no occlusion/pixel silhouette check yet.
        visibilityBasis: "candidate art-space bbox intersection, not 06 coarse camera memberships",
        missingPoseProjection: seen && !pose,
        missingAmbienceProjection: isAmbience && !projectedLook,
        snapshotActorVisibleNotUsed: true
      }
    };
  }
  root.BeyondStormG2Art = Object.freeze({
    makeFrame,
    cameraRects: CAMERA_RECTS,
    anchors: ANCHORS,
    spriteBounds: SPRITE_BOUNDS,
    fireKinds: FIRE_KINDS
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
