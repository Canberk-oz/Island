# Grove

A phone-first focus timer for Android. Pick a duration, start a session, and a
sapling grows while you stay in the app. Finish and a random seed drops; leave
and the sapling withers. Seeds become plants on an island that slowly fades on
the days you do not focus, and comes back when you do.

The island is alive: focus earns water, rocks and other pieces of nature to
place, and animals move in when the island suits them. Neglect it and they
hide, one by one, until you focus again.

Built with Expo (React Native) and TypeScript. Everything is stored on the
phone; there is no backend.

## Get it on your phone

**APK.** Every push runs the *Build APK* workflow (GitHub → Actions). Open the
latest run, download the `grove-apk` artifact, unzip it and install `grove.apk`.
The same workflow installs the build on an emulator and checks the session
logic end to end (see `scripts/smoke-test.sh`).

**Expo Go.** For development:

```bash
npm install
npx expo start        # scan the QR code with Expo Go on Android
```

Inside Expo Go the notifications are switched off (Expo Go does not ship them);
everything else works the same.

**Build the APK yourself** (needs the Android SDK and JDK 17):

```bash
npm run build:apk     # android/app/build/outputs/apk/release/app-release.apk
```

## How it plays

| | |
|---|---|
| **Session** | 1 to 120 minutes. The screen stays on. Leaving the app for more than 6 seconds withers the sapling; shorter absences are forgiven up to 3 times per session. |
| **Seeds** | Every finished session drops a seed: common 70%, rare 22%, epic 7%, legendary 1% at 25 minutes. Longer sessions are luckier, and after 7 commons in a row the next one is rare or better. |
| **Island** | You plant seeds yourself. The island grows when 70% of its tiles are planted (9 → 21 → 37 → 69 tiles). |
| **Decay** | Nothing fades for 20 hours after a session of 10+ minutes. After that the island takes 72 hours to wilt completely. It never drops below zero and nothing dies: 75 minutes of focus revive a fully wilted island, 25 minutes undo one missed day. |
| **Wager** | Stake up to 2 coins per session minute. Finish and get 1.5x back, leave and lose the stake. |
| **Coins** | 1 per focused minute. A lucky pouch (100 coins) holds a seed that is rare or better. |
| **Streak** | A day counts with one finished session of 10+ minutes. Days roll over at 04:00. |
| **Freezes** | One per 120 focused minutes, at most 2 in the pocket. A freeze covers a missed day automatically. They cannot be bought. |
| **Daily ring** | Progress toward the daily focus goal (default 60 minutes, adjustable in the Journal). |
| **Island level** | Lifetime focus raises the island level (level 2 at 30 minutes, level 5 at 5 hours, level 10 at 30 hours, then one per 10 hours). Each level hands out nature pieces to place: water, rocks, a hollow log, a beehive, a campfire. |
| **Water** | Water tiles join up: one or two make a pond, three or more a lake. Water at the front rim of the island falls over the edge. |
| **Wildlife** | 13 animals, none of them bought. Each needs a habitat, for example a frog needs water, a deer needs 3 trees and a lake, a fox needs 10 plants and a hollow log. The Journal shows who is missing and what they need. |
| **Hiding** | Animals hide when the island wilts, the shyest first (fox and deer below about 60% vitality), and return when it recovers. None is ever lost. |
| **Sound** | The island has a soundscape: birds and wind by day, crickets at night, running water where there is water. It gets quieter as the island wilts. Tap an animal to hear it. |
| **Share** | The Share button renders the island with this week's numbers as a picture. |

All of these numbers live in `src/game/config.ts`.

### How decay is calculated

Nothing runs in the background. The island stores a vitality value together
with the moment it was measured, and the fading since then is computed whenever
it is needed, so "closed for five days" is the same case as "a second passed":

```
fadingFrom = max(vitalityAt, graceUntil)
vitality   = clamp(storedVitality − hoursSince(fadingFrom) / 72, 0, 1)
```

Each plant has its own threshold (edge plants first, legendary plants last), so
the island droops plant by plant. When you open the Island tab it animates from
the vitality you last saw to the current one.

## Project layout

```
src/game/      Pure game logic: no React, no storage, no clock. Fully unit tested.
  config.ts      every tunable number
  engine.ts      session state machine, completion, pouch, migration
  decay.ts       vitality over time, per-plant wilting
  rewards.ts     seed odds, pity, species pick
  streak.ts      streak, freezes, daily ring
  world.ts       island tiles, planting, growth
  nature.ts      island levels, nature pieces, water bodies, animal habitats
  economy.ts     coins and wager
src/store/     Zustand store: wires the pure logic to the clock and AsyncStorage
src/render/    Skia drawing: sapling, plants, island, water, animals, sky, particles
src/screens/   Focus, Island, Journal, seed reveal, share card
src/feel/      Haptics, sound, notifications
src/ui/        Theme and small UI parts
scripts/       Sound and icon generators, emulator smoke test
```

The session state machine (`resolveSession` in `src/game/engine.ts`) handles
every way time can pass with one function: a timer tick, returning from the
background, and a cold start after the app was killed.

## Checks

```bash
npm run check         # TypeScript + unit tests
```

## Developer tools

Journal → Settings → *Developer tools* adds a 10 second test session to the
duration dial, plus buttons to skip the clock forward (to watch the island
fade and the animals hide), add coins, add focus time (to raise the island
level) and erase all data.

Every session event is written to the device log, which helps when testing the
leave detection on a real phone:

```bash
adb logcat -s ReactNativeJS | grep grove
```

## Web harness

The app also runs in a browser, which is how the screens are checked
automatically. It is a development tool, not a product target.

```bash
npm run web:setup     # copies Skia's WebAssembly build into public/
npm run web
```

## Assets

Sounds (effects, animal calls and the looping ambience) are synthesised by
`scripts/make-sounds.py` and the icons are drawn by
`scripts/make-icons.py`, so nothing in the repository needs a licence from a
third party. The typeface is Nunito (SIL Open Font License).
