import { Group, Oval } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { PlantBody } from './PlantSprite';
import { animalSprite } from './creatures';

/** How an animal crosses the hill: seconds per crossing, hop height (in units) and hops per second. */
const GAIT: Record<string, { cross: number; hop: number; rate: number }> = {
  rabbit: { cross: 9, hop: 0.2, rate: 2.2 },
  squirrel: { cross: 7, hop: 0.1, rate: 4 },
  hedgehog: { cross: 22, hop: 0.015, rate: 5 },
  fox: { cross: 11, hop: 0.04, rate: 3 },
  deer: { cross: 14, hop: 0.04, rate: 2.4 },
  frog: { cross: 10, hop: 0.34, rate: 1.2 },
};

export function canPassBy(id: string) {
  return id in GAIT;
}

interface Props {
  /** Animals that may come by (only walkers are used). */
  ids: string[];
  w: number;
  /** Height of the ground at x. */
  groundY: (x: number) => number;
  unit: number;
  clock: SharedValue<number>;
  /** Seconds between two visits. */
  every?: number;
}

function One({ id, index, count, w, groundY, unit, clock, every }: { id: string; index: number; count: number } & Omit<Props, 'ids'> & { every: number }) {
  const sprite = useMemo(() => animalSprite(id, unit), [id, unit]);
  const gait = GAIT[id];
  const ys = useMemo(() => Array.from({ length: 41 }, (_, i) => groundY((i / 40) * (w + 120) - 60)), [groundY, w]);
  const state = useDerivedValue(() => {
    const t = clock.value / 1000 + 6;
    const visit = Math.floor(t / every);
    const f = (t - visit * every) / gait.cross;
    if (visit % count !== index || f < 0 || f > 1) return { x: 0, y: 0, lift: 0, dir: 1, show: 0 };
    const dir = visit % 2 === 0 ? 1 : -1;
    const k = dir > 0 ? f : 1 - f;
    const at = k * 40;
    const i = Math.min(39, Math.floor(at));
    const y = ys[i] + (ys[i + 1] - ys[i]) * (at - i);
    return { x: k * (w + 120) - 60, y, lift: Math.abs(Math.sin(Math.PI * gait.rate * f * gait.cross)) * gait.hop * unit, dir, show: 1 };
  });
  const transform = useDerivedValue(() => [{ translateX: state.value.x }, { translateY: state.value.y - state.value.lift }, { scaleX: state.value.dir }]);
  const shadow = useDerivedValue(() => [{ translateX: state.value.x }, { translateY: state.value.y }]);
  const opacity = useDerivedValue(() => state.value.show);
  if (!sprite) return null;
  return (
    <Group opacity={opacity}>
      <Group transform={shadow}>
        <Oval x={-sprite.width * 0.42} y={-sprite.width * 0.07} width={sprite.width * 0.84} height={sprite.width * 0.16} color="#12301F" opacity={0.16} />
      </Group>
      <Group transform={transform}>
        <PlantBody parts={sprite.parts} />
      </Group>
    </Group>
  );
}

/** Now and then one of the island's animals walks across the hill while you focus. */
export function Passerby({ ids, every = 34, ...rest }: Props) {
  const walkers = useMemo(() => ids.filter(canPassBy).slice(0, 5), [ids]);
  return (
    <>
      {walkers.map((id, i) => (
        <One key={id} id={id} index={i} count={walkers.length} every={every} {...rest} />
      ))}
    </>
  );
}
