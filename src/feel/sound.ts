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
} as const;

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
