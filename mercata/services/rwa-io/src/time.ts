/**
 * Round a Date down to the start of the current UTC hour (RWA.io requirement
 * for hourly series). Returns UNIX milliseconds.
 */
export function floorToHour(date: Date): number {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}
