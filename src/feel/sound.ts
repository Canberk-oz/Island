import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useStore } from '../store/store';

const SOURCES = {
  tap: require('../../assets/sounds/tap.wav'),
  tick: require('../../assets/sounds/tick.wav'),
  start: require('../../assets/sounds/start.wav'),
  leaf1: require('../../assets/sounds/leaf1.wav'),
  leaf2: require('../../assets/sounds/leaf2.wav'),
  leaf3: require('../../assets/sounds/leaf3.wav'),
  leaf4: require('../../assets/sounds/leaf4.wav'),
  complete: require('../../assets/sounds/complete.wav'),
  drop: require('../../assets/sounds/drop.wav'),
  crack: require('../../assets/sounds/crack.wav'),
  reveal_common: require('../../assets/sounds/reveal_common.wav'),
  reveal_rare: require('../../assets/sounds/reveal_rare.wav'),
  reveal_epic: require('../../assets/sounds/reveal_epic.wav'),
  reveal_legendary: require('../../assets/sounds/reveal_legendary.wav'),
  wither: require('../../assets/sounds/wither.wav'),
  plant: require('../../assets/sounds/plant.wav'),
  coin: require('../../assets/sounds/coin.wav'),
  warn: require('../../assets/sounds/warn.wav'),
  grow: require('../../assets/sounds/grow.wav'),
  arrive: require('../../assets/sounds/arrive.wav'),
  place_water: require('../../assets/sounds/place_water.wav'),
  place_stone: require('../../assets/sounds/place_stone.wav'),
  levelup: require('../../assets/sounds/levelup.wav'),
  animal_chirp: require('../../assets/sounds/animal_chirp.wav'),
  animal_quack: require('../../assets/sounds/animal_quack.wav'),
  animal_ribbit: require('../../assets/sounds/animal_ribbit.wav'),
  animal_splash: require('../../assets/sounds/animal_splash.wav'),
  animal_squeak: require('../../assets/sounds/animal_squeak.wav'),
  animal_sniff: require('../../assets/sounds/animal_sniff.wav'),
  animal_yip: require('../../assets/sounds/animal_yip.wav'),
  animal_snort: require('../../assets/sounds/animal_snort.wav'),
  animal_buzz: require('../../assets/sounds/animal_buzz.wav'),
  animal_hoot: require('../../assets/sounds/animal_hoot.wav'),
  animal_twinkle: require('../../assets/sounds/animal_twinkle.wav'),
  animal_flutter: require('../../assets/sounds/animal_flutter.wav'),
} as const;

const AMBIENCE = {
  day: require('../../assets/sounds/amb_day.wav'),
  night: require('../../assets/sounds/amb_night.wav'),
  water: require('../../assets/sounds/amb_water.wav'),
} as const;

export type AmbienceName = keyof typeof AMBIENCE;

export type SoundName = keyof typeof SOURCES;

const players = new Map<SoundName, AudioPlayer>();
let modeSet = false;

function ensureMode() {
  if (modeSet) return;
  modeSet = true;
  // Mix with whatever the player is listening to: focus music must keep playing.
  setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: false, shouldPlayInBackground: false }).catch(
    () => {},
  );
}

function playerFor(name: SoundName): AudioPlayer | null {
  let p = players.get(name);
  if (!p) {
    try {
      p = createAudioPlayer(SOURCES[name]);
      players.set(name, p);
    } catch {
      return null;
    }
  }
  return p;
}

/** Play a sound effect. Never throws. */
export function playSound(name: SoundName, volume = 1) {
  if (!useStore.getState().settings.sound) return;
  try {
    ensureMode();
    const p = playerFor(name);
    if (!p) return;
    p.volume = volume;
    // A player that already finished must be rewound before it can play again.
    p.seekTo(0)
      .catch(() => {})
      .then(() => {
        try {
          p.play();
        } catch {
          // ignore
        }
      });
  } catch {
    // audio is decoration: failing silently is always right
  }
}

/** Create the players for the most frequent sounds up front so the first tap is not late. */
export function warmUpSounds() {
  try {
    ensureMode();
    (['tap', 'tick', 'start', 'leaf1'] as SoundName[]).forEach(playerFor);
  } catch {
    // ignore
  }
}

/** Play the call of an animal (see `AnimalDef.sound`). */
export function playAnimal(sound: string, volume = 0.9) {
  const name = `animal_${sound}` as SoundName;
  if (name in SOURCES) playSound(name, volume);
}

// ---------------------------------------------------------------------------
// Ambience: looping nature beds that fade in and out smoothly.
// ---------------------------------------------------------------------------

const beds = new Map<AmbienceName, { player: AudioPlayer; volume: number; target: number }>();
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function stepFades() {
  let busy = false;
  for (const [name, bed] of beds) {
    const diff = bed.target - bed.volume;
    if (Math.abs(diff) < 0.01) {
      bed.volume = bed.target;
    } else {
      bed.volume += Math.sign(diff) * Math.min(Math.abs(diff), 0.04);
      busy = true;
    }
    try {
      bed.player.volume = bed.volume;
      if (bed.volume <= 0 && bed.target <= 0) {
        bed.player.pause();
        bed.player.remove();
        beds.delete(name);
      }
    } catch {
      beds.delete(name);
    }
  }
  if (!busy && fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/**
 * Set the target volume of every ambience bed (missing ones fade out).
 * Volumes fade over about a second, so calling this often is fine.
 */
export function setAmbience(levels: Partial<Record<AmbienceName, number>>) {
  const enabled = useStore.getState().settings.sound;
  try {
    ensureMode();
    for (const name of Object.keys(AMBIENCE) as AmbienceName[]) {
      const target = enabled ? Math.max(0, Math.min(1, levels[name] ?? 0)) : 0;
      let bed = beds.get(name);
      if (!bed) {
        if (target <= 0) continue;
        const player = createAudioPlayer(AMBIENCE[name]);
        player.loop = true;
        player.volume = 0;
        player.play();
        bed = { player, volume: 0, target };
        beds.set(name, bed);
      }
      bed.target = target;
    }
  } catch {
    // ambience is decoration
  }
  if (!fadeTimer) fadeTimer = setInterval(stepFades, 50);
}

export function stopAmbience() {
  setAmbience({});
}
