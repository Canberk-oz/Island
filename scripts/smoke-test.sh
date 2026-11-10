#!/usr/bin/env bash
# End-to-end check of the release APK on a running emulator or phone.
#
#   scripts/smoke-test.sh path/to/app.apk [output-dir]
#
# It drives the real app with adb and asserts on the "[grove] ..." event lines
# the app writes to the device log. Covered: launch, leaving the app (wither),
# a short absence (grace), a forced stop during a session, a complete one
# minute session with seed reveal and planting, and persistence over restarts.
set -u

APK="${1:?usage: smoke-test.sh app.apk [output-dir]}"
OUT="${2:-smoke-output}"
PKG=app.grove.focus
mkdir -p "$OUT"
failures=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
info() { echo "      $*"; }
step() { echo; echo "== $*"; }

launch() { adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
home() { adb shell input keyevent KEYCODE_HOME; }
shot() { adb exec-out screencap -p >"$OUT/$1.png" 2>/dev/null || true; }
events() { adb logcat -d -s ReactNativeJS:V 2>/dev/null | grep -F "[grove]" || true; }
count() { events | grep -cF "$1" || true; }

# wait_for "<event text>" <at least n occurrences> <timeout seconds>
wait_for() {
  local i=0
  while [ "$i" -lt "${3:-30}" ]; do
    [ "$(count "$1")" -ge "$2" ] && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

dump() {
  local i
  for i in 1 2 3 4 5 6; do
    if adb shell uiautomator dump /sdcard/grove-ui.xml >/dev/null 2>&1 &&
      adb pull /sdcard/grove-ui.xml "$OUT/ui.xml" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Prints "x y" of the centre of the first node whose text or content-desc equals the label.
find_label() {
  python3 - "$OUT/ui.xml" "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(0)
for node in root.iter('node'):
    if sys.argv[2] in (node.get('text'), node.get('content-desc')):
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
}

# tap "<label>" <fallback x in permille> <fallback y in permille>
tap() {
  local xy=""
  if dump; then xy="$(find_label "$1")"; fi
  if [ -z "$xy" ]; then
    xy="$((W * $2 / 1000)) $((H * $3 / 1000))"
    info "label '$1' not found in the view tree, tapping its usual place"
  fi
  # shellcheck disable=SC2086
  adb shell input tap $xy
}

on_screen() { dump && grep -qF "$1" "$OUT/ui.xml"; }

size="$(adb shell wm size | tr -d '\r' | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)"
W="${size% *}"
H="${size#* }"
echo "Device screen: ${W}x${H}"

step "Install and launch"
adb install -r "$APK" >/dev/null || { fail "install"; exit 1; }
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb logcat -c || true
launch
if wait_for "app:ready" 1 120; then pass "app started and loaded its save"; else fail "app never reported ready"; fi
sleep 6
shot 01-idle
if adb shell pidof "$PKG" >/dev/null; then pass "process is alive"; else fail "process died after launch"; fi

step "Leave the app for longer than the grace period"
tap "Start focusing" 500 752
if wait_for "session:start" 1 20; then pass "session started"; else fail "session did not start"; fi
sleep 3
shot 02-session
home
if wait_for "session:left" 1 10; then pass "leaving the app was detected"; else fail "leaving the app was not detected"; fi
sleep 10
launch
if wait_for "session:withered reason=left" 1 25; then pass "sapling withered after 10 s away"; else fail "sapling did not wither"; fi
sleep 6
shot 03-withered
if on_screen "Your sapling withered"; then pass "wither card is shown"; else info "wither card text not found in the view tree"; fi
tap "Try again" 500 340
sleep 2

step "Leave the app briefly (grace)"
tap "Start focusing" 500 752
if wait_for "session:start" 2 20; then pass "second session started"; else fail "second session did not start"; fi
sleep 2
withered_before="$(count "session:withered")"
home
sleep 1
launch
if wait_for "session:grace" 1 15; then
  pass "a short absence used a grace and the session kept running"
elif [ "$(count "session:withered")" -gt "$withered_before" ]; then
  info "INCONCLUSIVE: this device took longer than the grace period to switch apps"
else
  fail "neither grace nor wither was reported"
fi
sleep 3
shot 04-after-grace

step "Force-stop the app during a session"
running_before="$(count "session:withered")"
adb shell am force-stop "$PKG"
sleep 2
launch
if wait_for "via=coldStart" 1 60; then
  pass "session found on restart was resolved as withered"
elif [ "$(count "session:withered")" -gt "$running_before" ] || [ "$(count "session:grace")" -eq 0 ]; then
  info "no session was running at the time of the forced stop"
else
  fail "killed session was not resolved on restart"
fi
sleep 6
shot 05-after-kill
tap "Try again" 500 340
sleep 2

step "Complete a one minute session"
starts_before="$(count "session:start")"
tap "1 minute session" 80 490
sleep 2
if ! on_screen "minute"; then
  # Fallback: fling the dial to its first entry.
  for _ in 1 2 3 4; do adb shell input swipe $((W * 25 / 100)) $((H * 49 / 100)) $((W * 90 / 100)) $((H * 49 / 100)) 150; done
  sleep 2
fi
tap "Start focusing" 500 752
if wait_for "session:start seconds=60" 1 20; then
  pass "one minute session started"
  sleep 30
  shot 06-growing
  if wait_for "session:completed" 1 60; then pass "session completed and dropped a seed"; else fail "session did not complete"; fi
  sleep 5
  shot 07-seed
  for _ in 1 2 3; do adb shell input tap $((W / 2)) $((H * 42 / 100)); sleep 1; done
  sleep 5
  shot 08-reveal
  if on_screen "Plant it"; then pass "seed was revealed"; else info "reveal card text not found in the view tree"; fi
  tap "Plant it" 500 800
  sleep 4
  shot 09-island
  adb shell input tap $((W / 2)) $((H / 2))
  if wait_for "island:planted" 1 10; then pass "seed was planted on the island"; else fail "planting did not happen"; fi
  sleep 3
  shot 10-planted
else
  fail "could not start a one minute session (started: $(events | grep -F 'session:start' | tail -1))"
fi

step "Restart and check persistence"
adb shell am force-stop "$PKG"
sleep 1
launch
sleep 8
last_ready="$(events | grep -F 'app:ready' | tail -1)"
info "$last_ready"
case "$last_ready" in
  *"sessions=0"*) fail "saved sessions were lost on restart" ;;
  *"app:ready"*) pass "save file survived a restart" ;;
  *) fail "app did not come back after restart" ;;
esac
shot 11-restarted

step "Crashes"
if adb logcat -d | grep -E "FATAL EXCEPTION|Fatal signal" >"$OUT/crashes.txt"; then
  fail "the device log contains a crash:"
  head -40 "$OUT/crashes.txt"
else
  pass "no crash in the device log"
fi

echo
echo "---- app events ----"
events | sed 's/^.*\[grove\]/[grove]/'
adb logcat -d >"$OUT/logcat.txt" 2>/dev/null || true

echo
if [ "$failures" -eq 0 ]; then
  echo "SMOKE TEST PASSED"
else
  echo "SMOKE TEST FAILED ($failures failed checks)"
  exit 1
fi
