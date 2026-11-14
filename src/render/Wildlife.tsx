import { BlurMask, Group, Oval, Path, Skia } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { Shadow } from '../game/atmosphere';
import { PlantBody } from './PlantSprite';
import { animalSprite } from './creatures';
import {
  FISH_JUMP,
  fishCycle,
  liftOf,
  swarmAt,
  trackAt,
  type Actor,
  type FishSchool,
  type Swarm,
  type WildlifeScene,
} from './wildlife';

/** The most recent tap on an animal: it answers with a little jump. */
export interface Poke {
  key: string;
  /** Clock time (ms) of the tap. */
  at: number;
  /** For fish: where to jump. */
  x: number;
  y: number;
}

export const NO_POKE: Poke = { key: '', at: -1e9, x: 0, y: 0 };

/** Draw order above everything that stands on the ground. */
const SKY = 1_000_000;

interface Shared {
  clock: SharedValue<number>;
  vitality: SharedValue<number>;
  poke: SharedValue<Poke>;
  tileW: number;
  /** Where the light comes from (shadows lean away from it). */
  shade?: Shadow;
}

function presence(vitality: number, shy: number) {
  'worklet';
  return Math.min(1, Math.max(0, (vitality - shy) / 0.07));
}

/** How long a startled hedgehog stays rolled up, in seconds. */
const BALL_TIME = 2.4;

function ActorView({ actor, clock, vitality, poke, tileW, shade }: { actor: Actor } & Shared) {
  const sprite = useMemo(() => animalSprite(actor.id, actor.unit), [actor.id, actor.unit]);
  const ball = useMemo(() => (actor.id === 'hedgehog' ? animalSprite('hedgehog_ball', actor.unit) : null), [actor.id, actor.unit]);

  const state = useDerivedValue(() => {
    const t = clock.value / 1000;
    const s = trackAt(actor.track, t + actor.offset);
    let lift = liftOf(actor, s, tileW);
    let squash = 0;
    // A tap makes it jump and squash, whatever it was doing.
    const since = (clock.value - poke.value.at) / 1000;
    const poked = poke.value.key === actor.key && since >= 0;
    const rolled = ball != null && poked && since < BALL_TIME ? 1 : 0;
    if (poked && since < 0.7 && !rolled) {
      const k = since / 0.7;
      lift += Math.sin(Math.PI * k) * actor.unit * 0.35;
      squash = Math.sin(Math.PI * k * 2) * 0.18 * (1 - k);
    }
    // Asleep, breathing is slow and deep.
    const asleep = actor.kind === 'sleep';
    const breathe = Math.sin(t * (asleep ? 1.1 : 2.2) + actor.offset) * (asleep ? 0.05 : 0.025);
    // Ducks bob on the water.
    const bob = actor.kind === 'duck' ? Math.sin(t * 2 + actor.offset) * actor.unit * 0.012 : 0;
    // Head down: a deer drinks, a rabbit nibbles in little bursts.
    let tilt = 0;
    if (!s.moving && !rolled) {
      if (s.bow) tilt = 0.26 + Math.sin(t * 1.3) * 0.03;
      else if (actor.idle === 'nibble' && Math.sin(t * 0.55 + actor.offset) > 0.1) tilt = 0.16 + Math.sin(t * 11) * 0.05;
    }
    return {
      x: s.x,
      y: s.y,
      lift: lift + bob,
      dir: s.dir,
      moving: s.moving,
      sx: 1 + squash - breathe * 0.5,
      sy: 1 - squash + breathe,
      tilt,
      rolled,
    };
  });

  const transform = useDerivedValue(() => {
    const s = state.value;
    return [{ translateX: s.x }, { translateY: s.y - s.lift }, { scaleX: s.dir * s.sx }, { scaleY: s.sy }, { rotate: s.tilt }];
  });
  const bodyOpacity = useDerivedValue(() => 1 - state.value.rolled);
  const ballOpacity = useDerivedValue(() => state.value.rolled);
  // A swimming duck leaves a wake.
  const wake = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    if (actor.kind !== 'duck') return b.build();
    const s = state.value;
    const t = clock.value / 1000;
    for (let i = 0; i < 2; i++) {
      const f = (t * 0.7 + i * 0.5 + actor.offset) % 1;
      const r = actor.unit * (0.16 + f * 0.3) * (s.moving ? 1 : 0.6);
      b.addOval({ x: s.x - s.dir * actor.unit * 0.12 - r, y: s.y - r * 0.32, width: r * 2, height: r * 0.64 });
    }
    return b.build();
  });
  const wakeOpacity = useDerivedValue(() => 0.2 + 0.35 * state.value.moving);
  // Zzz drifts up from a sleeper.
  const zzz = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    if (actor.kind !== 'sleep') return b.build();
    const s = state.value;
    const t = clock.value / 1000;
    for (let i = 0; i < 3; i++) {
      const f = (t * 0.28 + i / 3) % 1;
      const z = actor.unit * (0.045 + f * 0.05);
      const x = s.x + actor.unit * (0.2 + f * 0.22) + Math.sin(t + i) * 2;
      const y = s.y - actor.unit * (0.3 + f * 0.55);
      b.moveTo(x - z, y - z).lineTo(x + z, y - z).lineTo(x - z, y + z).lineTo(x + z, y + z);
    }
    return b.build();
  });
  const shadow = useDerivedValue(() => {
    const s = state.value;
    const k = 1 / (1 + s.lift / (actor.unit * 0.5));
    const lean = shade ? shade.dx * (0.3 + (shade.length - 1) * 0.5) * actor.unit * 0.4 : 0;
    return [{ translateX: s.x + lean }, { translateY: s.y }, { scaleX: k * (shade ? 1 + (shade.length - 1) * 0.5 : 1) }, { scaleY: k }];
  });
  const z = useDerivedValue(() => {
    const s = state.value;
    // In flight a bird is above everything; perched it sits just in front of its tree.
    if (actor.kind === 'bird' && s.moving) return SKY;
    if (actor.kind === 'bird' || actor.kind === 'perch') return s.y + actor.unit * 2;
    return s.y + 0.5;
  });
  const opacity = useDerivedValue(() => presence(vitality.value, actor.shy));
  const flap = useDerivedValue(() => (state.value.moving && Math.sin(clock.value / 55) > 0 ? 1 : 0));
  const fold = useDerivedValue(() => 1 - flap.value);

  if (!sprite) return null;
  const grounded = actor.kind === 'walk' || actor.kind === 'sleep';
  return (
    <Group zIndex={z} opacity={opacity}>
      {actor.kind === 'duck' && <Path path={wake} color="#FFFFFF" style="stroke" strokeWidth={1.2} opacity={wakeOpacity} />}
      {actor.kind === 'sleep' && <Path path={zzz} color="#FFFFFF" style="stroke" strokeWidth={1.6} strokeCap="round" strokeJoin="round" opacity={0.85} />}
      {grounded && (
        <Group transform={shadow}>
          <Oval x={-sprite.width * 0.42} y={-sprite.width * 0.09} width={sprite.width * 0.84} height={sprite.width * 0.18} color="#12301F" opacity={0.18} />
        </Group>
      )}
      {ball && (
        <Group transform={transform} opacity={ballOpacity}>
          <PlantBody parts={ball.parts} />
        </Group>
      )}
      <Group transform={transform} opacity={bodyOpacity}>
        <PlantBody parts={sprite.parts} />
        {sprite.rest && (
          <Group opacity={fold}>
            <PlantBody parts={sprite.rest} />
          </Group>
        )}
        {sprite.alt && (
          <Group opacity={flap}>
            <PlantBody parts={sprite.alt} />
          </Group>
        )}
      </Group>
    </Group>
  );
}

function Fish({ school, index, clock, vitality, poke, tileW }: { school: FishSchool; index: number } & Shared) {
  const sprite = useMemo(() => animalSprite('fish', school.unit), [school.unit]);
  const state = useDerivedValue(() => {
    const t = clock.value / 1000;
    // The last fish belongs to the player: it jumps where the water was tapped.
    const since = (clock.value - poke.value.at) / 1000;
    const poked = index === school.count && poke.value.key === 'fish';
    let f: number;
    let x0: number;
    let y0: number;
    let flip = 1;
    if (index === school.count) {
      if (!poked) return { x: 0, y: 0, rot: 0, show: 0, flip: 1 };
      f = since;
      x0 = poke.value.x;
      y0 = poke.value.y;
    } else {
      const c = fishCycle(school, index, t);
      f = c.f;
      x0 = school.xs[c.tile];
      y0 = school.ys[c.tile];
      flip = c.flip;
    }
    if (f < 0 || f > FISH_JUMP) return { x: x0, y: y0, rot: 0, show: 0, flip };
    const k = f / FISH_JUMP;
    const span = tileW * 0.42;
    const height = tileW * 0.55;
    return {
      x: x0 + (k - 0.5) * span * flip,
      y: y0 - Math.sin(Math.PI * k) * height,
      // Nose up on the way out, nose down on the way back in.
      rot: -Math.cos(Math.PI * k) * 1.15,
      show: 1,
      flip,
    };
  });
  const transform = useDerivedValue(() => {
    const s = state.value;
    return [{ translateX: s.x }, { translateY: s.y }, { scaleX: s.flip }, { rotate: s.rot }];
  });
  const opacity = useDerivedValue(() => state.value.show * presence(vitality.value, school.shy));
  if (!sprite) return null;
  return (
    <Group zIndex={SKY} opacity={opacity} transform={transform}>
      <PlantBody parts={sprite.parts} />
    </Group>
  );
}

function FishRipples({ school, clock, vitality, poke, tileW }: { school: FishSchool } & Shared) {
  const rings = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    const ring = (x: number, y: number, age: number) => {
      if (age < 0 || age > 1.1) return;
      const r = tileW * (0.08 + age * 0.3);
      b.addOval({ x: x - r, y: y - r * 0.5, width: r * 2, height: r });
    };
    for (let i = 0; i < school.count; i++) {
      const c = fishCycle(school, i, t);
      const x = school.xs[c.tile];
      const y = school.ys[c.tile];
      const span = tileW * 0.21 * c.flip;
      ring(x - span, y, c.f);
      ring(x + span, y, c.f - FISH_JUMP);
    }
    if (poke.value.key === 'fish') {
      const since = (clock.value - poke.value.at) / 1000;
      ring(poke.value.x - tileW * 0.21, poke.value.y, since);
      ring(poke.value.x + tileW * 0.21, poke.value.y, since - FISH_JUMP);
    }
    return b.build();
  });
  const opacity = useDerivedValue(() => 0.75 * presence(vitality.value, school.shy));
  return <Path path={rings} color="#FFFFFF" style="stroke" strokeWidth={1.5} opacity={opacity} />;
}

function SwarmView({ swarm, clock, vitality }: { swarm: Swarm } & Shared) {
  const body = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    const s = swarm.size;
    for (let i = 0; i < swarm.count; i++) {
      const p = swarmAt(swarm, i, t);
      if (swarm.id === 'butterfly') {
        if (i % 2 === 1) continue;
        const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 13 + i));
        b.moveTo(p.x, p.y).lineTo(p.x - s * 1.5 * flap, p.y - s * 1.3).lineTo(p.x - s * 1.2 * flap, p.y + s * 0.9).close();
        b.moveTo(p.x, p.y).lineTo(p.x + s * 1.5 * flap, p.y - s * 1.3).lineTo(p.x + s * 1.2 * flap, p.y + s * 0.9).close();
      } else if (swarm.id === 'bee') {
        b.addOval({ x: p.x - s * 1.3, y: p.y - s, width: s * 2.6, height: s * 2 });
      } else {
        const glow = Math.max(0, Math.sin(t * 1.4 + i * 2.1));
        b.addCircle(p.x, p.y, Math.max(0.01, s * (0.5 + glow)));
      }
    }
    return b.build();
  });
  // Second colour: every other butterfly, the stripes of the bees, the halo of the fireflies.
  const detail = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    const t = clock.value / 1000;
    const s = swarm.size;
    for (let i = 0; i < swarm.count; i++) {
      const p = swarmAt(swarm, i, t);
      if (swarm.id === 'butterfly') {
        if (i % 2 === 0) continue;
        const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 13 + i));
        b.moveTo(p.x, p.y).lineTo(p.x - s * 1.5 * flap, p.y - s * 1.3).lineTo(p.x - s * 1.2 * flap, p.y + s * 0.9).close();
        b.moveTo(p.x, p.y).lineTo(p.x + s * 1.5 * flap, p.y - s * 1.3).lineTo(p.x + s * 1.2 * flap, p.y + s * 0.9).close();
      } else if (swarm.id === 'bee') {
        b.addRect({ x: p.x - s * 0.35, y: p.y - s, width: s * 0.7, height: s * 2 });
        const w = s * (0.9 + 0.5 * Math.abs(Math.sin(t * 40 + i)));
        b.addOval({ x: p.x - w, y: p.y - s * 2.2, width: w * 2, height: s * 1.2 });
      } else {
        const glow = Math.max(0, Math.sin(t * 1.4 + i * 2.1));
        b.addCircle(p.x, p.y, Math.max(0.01, s * 3.2 * glow));
      }
    }
    return b.build();
  });
  const opacity = useDerivedValue(() => presence(vitality.value, swarm.shy));

  if (swarm.id === 'firefly') {
    return (
      <Group zIndex={SKY} opacity={opacity}>
        <Path path={detail} color="#F6F18A" opacity={0.5}>
          <BlurMask blur={swarm.size * 2.5} style="normal" />
        </Path>
        <Path path={body} color="#FFFDD0" />
      </Group>
    );
  }
  if (swarm.id === 'bee') {
    return (
      <Group zIndex={SKY} opacity={opacity}>
        <Path path={body} color="#F5C542" />
        <Path path={detail} color="#3B2618" opacity={0.8} />
      </Group>
    );
  }
  return (
    <Group zIndex={SKY} opacity={opacity}>
      <Path path={body} color="#FF9FB2" />
      <Path path={detail} color="#FFD166" />
    </Group>
  );
}

/**
 * Every animal on the island. Render it as a direct child of the group that
 * holds the plants: each animal carries its own draw order, so it walks
 * behind the trees in front of it and in front of the ones behind.
 */
export function Wildlife({ scene, ...shared }: { scene: WildlifeScene } & Shared) {
  return (
    <>
      {scene.fish && <FishRipples school={scene.fish} {...shared} />}
      {scene.actors.map((a) => (
        <ActorView key={a.key} actor={a} {...shared} />
      ))}
      {scene.fish &&
        Array.from({ length: scene.fish.count + 1 }, (_, i) => <Fish key={`fish:${i}`} school={scene.fish!} index={i} {...shared} />)}
      {scene.swarms.map((s) => (
        <SwarmView key={s.id} swarm={s} {...shared} />
      ))}
    </>
  );
}
