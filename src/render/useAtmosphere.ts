import { useEffect, useMemo, useState } from 'react';
import { atmosphereAt, type Atmosphere } from '../game/atmosphere';
import { vitalityNow } from '../game/decay';
import { useStore } from '../store/store';
import { skyAt, type SkyPalette } from '../ui/theme';

/** Time of day, season, weather and the matching sky colours. Refreshes every minute. */
export function useAtmosphere(): { atmo: Atmosphere; palette: SkyPalette } {
  const world = useStore((s) => s.game.world);
  const clock = useStore((s) => s.now);
  const offset = useStore((s) => s.settings.timeOffsetMs);
  const south = useStore((s) => s.settings.south);
  const season = useStore((s) => s.settings.seasonOverride);
  const weather = useStore((s) => s.settings.weatherOverride);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => b + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const now = clock();
    let atmo = atmosphereAt(now, vitalityNow(world, now), { south, season });
    if (weather) atmo = { ...atmo, weather };
    return { atmo, palette: skyAt(atmo.hour, atmo.weather) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, clock, offset, south, season, weather, beat]);
}
