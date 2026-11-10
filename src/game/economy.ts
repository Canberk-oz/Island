import { CONFIG } from './config';

/** The most that can be staked on a session of this length with this balance. */
export function maxStake(durationSec: number, coins: number): number {
  const cap = Math.floor((durationSec / 60) * CONFIG.economy.stakePerMinute);
  return Math.max(0, Math.min(Math.floor(coins), cap));
}

/** Coins handed back when a staked session is completed (stake included). */
export function wagerPayout(stake: number): number {
  return Math.floor(stake * CONFIG.economy.wagerMultiplier);
}

export function coinsForSession(durationSec: number): number {
  return Math.floor(durationSec / 60) * CONFIG.economy.coinsPerMinute;
}
