/**
 * Calculates the bonus-adjusted multiplier for a time period
 * Replicates the getMultiplier() logic from RewardsChef.sol
 *
 * @param bonusPeriods - Array of bonus periods sorted by startTimestamp
 * @param from - Start timestamp
 * @param to - End timestamp
 * @returns Bonus-adjusted time multiplier as BigInt
 */
const getMultiplier = (
  bonusPeriods: Array<{ startTimestamp: string; bonusMultiplier: string }>,
  from: bigint,
  to: bigint
): bigint => {
  if (from == to) {
    return 0n;
  }

  const MAX_INT = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  let totalMultipliedTime = 0n;
  let currentTime = from;

  for (let i = 0; i < bonusPeriods.length && currentTime < to; i++) {
    const periodStart = BigInt(bonusPeriods[i].startTimestamp);
    const periodEnd = (i + 1 < bonusPeriods.length)
      ? BigInt(bonusPeriods[i + 1].startTimestamp)
      : MAX_INT;

    if (currentTime < periodStart) {
      currentTime = periodStart;
    }

    if (currentTime < to && currentTime < periodEnd) {
      const segmentEnd = to < periodEnd ? to : periodEnd;
      const segmentDuration = segmentEnd - currentTime;
      totalMultipliedTime += segmentDuration * BigInt(bonusPeriods[i].bonusMultiplier);
      currentTime = segmentEnd;
    }
  }
  return totalMultipliedTime;
};
