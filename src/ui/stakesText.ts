import { HOUR_MS } from '../game/config';
import { TERRAIN_INFO, getAnimal } from '../game/nature';
import { getSpecies } from '../game/species';
import { callName, type Threat } from '../game/stakes';
import type { NewsItem, TerrainKind } from '../game/types';

/** Words for everything the stakes can tell the player. Kept apart from the rules and from the screens. */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "3 h", "2 days", "under an hour". */
export function formatSpan(ms: number): string {
  const hours = ms / HOUR_MS;
  if (hours < 1) return 'under an hour';
  if (hours < 36) return `${Math.floor(hours)} h`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

/** "today 14:32", "yesterday", "3 days ago". */
export function formatAgo(at: number, now: number): string {
  const hours = (now - at) / HOUR_MS;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function formatTime(at: number): string {
  const d = new Date(at);
  const m = d.getMinutes();
  return `${d.getHours()}:${m < 10 ? '0' : ''}${m}`;
}

function plantsText(item: NewsItem): string {
  const name = getSpecies(item.subject).name;
  const n = item.count ?? 1;
  return n === 1 ? `Your ${name}` : `Your ${name} and ${n - 1} more ${n === 2 ? 'plant' : 'plants'}`;
}

export type NewsTone = 'bad' | 'good' | 'info';

export function newsTone(item: NewsItem): NewsTone {
  switch (item.kind) {
    case 'left':
    case 'died':
    case 'ruined':
    case 'questFailed':
      return 'bad';
    case 'questStarted':
      return 'info';
    default:
      return 'good';
  }
}

export function newsText(item: NewsItem): string {
  const animal = () => cap(callName(item.subject, item.name));
  const landmark = () => TERRAIN_INFO[item.subject as TerrainKind]?.name.toLowerCase() ?? item.subject;
  switch (item.kind) {
    case 'left':
      return `${animal()} moved away`;
    case 'returned':
      return `${animal()} came back`;
    case 'died':
      return `${plantsText(item)} died`;
    case 'revived':
      return `${plantsText(item)} came back to life`;
    case 'born':
      return `${animal()} had a little one`;
    case 'befriended':
      return item.name ? `${cap(getAnimal(item.subject)?.name.toLowerCase() ?? '')} became your friend: meet ${item.name}` : `${animal()} became your friend`;
    case 'landmark':
      return `Your streak built a ${landmark()}`;
    case 'ruined':
      return `The ${landmark()} fell to ruins`;
    case 'rebuilt':
      return `The ${landmark()} was rebuilt`;
    case 'questStarted':
      return 'Revival started: focus on 3 days';
    case 'questDone':
      return 'Revival complete: half of what you lost is back';
    case 'questFailed':
      return 'The revival ran out of time';
  }
}

/** One line for the countdown: what happens, and how long until it does. */
export function threatText(t: Threat, now: number): string {
  const span = formatSpan(t.at - now);
  const who = t.animalId ? cap(callName(t.animalId, t.name)) : '';
  switch (t.kind) {
    case 'fade':
      return `Your island starts to fade in ${span}`;
    case 'hide':
      return `${who} hides in ${span}`;
    case 'leave':
      return `${who} moves away in ${span}`;
    case 'dry':
      return `The water dries up in ${span}`;
    case 'stump':
      return `The next plant dies in ${span}`;
    case 'streak':
      return `Your streak ends in ${span}`;
    case 'quest':
      return `Revival: ${span} left`;
  }
}

/** How urgent a countdown is, for its colour. */
export function threatLevel(t: Threat, now: number): 'calm' | 'soon' | 'urgent' {
  const hours = (t.at - now) / HOUR_MS;
  if (t.kind === 'fade' || t.kind === 'quest') return hours < 3 ? 'soon' : 'calm';
  if (t.kind === 'hide') return hours < 6 ? 'urgent' : 'soon';
  return hours < 24 ? 'urgent' : 'soon';
}
