// Hong Kong uses UTC+8 year-round.
const HKT_OFFSET_MINUTES = 8 * 60;
const START_MINUTES = 9 * 60 + 30;
const END_MINUTES = 22 * 60;

export function hongKongMinutes(at) {
  const date = new Date(at);
  return (date.getUTCHours() * 60 + date.getUTCMinutes() + HKT_OFFSET_MINUTES) % (24 * 60);
}

export function isCheckingWindow(at) {
  const minutes = hongKongMinutes(at);
  return minutes >= START_MINUTES && minutes <= END_MINUTES;
}

export function shouldWarnStale(checkedAt, now = Date.now()) {
  const minutes = hongKongMinutes(now);
  return minutes >= START_MINUTES + 15 && minutes <= END_MINUTES
    && now - Date.parse(checkedAt) > 75 * 60_000;
}
