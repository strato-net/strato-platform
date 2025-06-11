import { PurchaseLock } from "../../types/types";

const LOCK_TIMEOUT = 10 * 60 * 1000;
const purchaseLocks = new Map<string, PurchaseLock>();

export function getLockKey(listingId: string, amount: string): string {
  return `${listingId}:${amount}`;
}

export function canLockAmount(listingId: string, amount: string, reserve: string): boolean {
  purchaseLocks.forEach((lock, key) => {
    if (lock.listingId === listingId && Date.now() - lock.timestamp > LOCK_TIMEOUT) {
      purchaseLocks.delete(key);
    }
  });

  const totalLocked = Array.from(purchaseLocks.values())
    .filter(lock => lock.listingId === listingId)
    .reduce((sum, lock) => sum + BigInt(lock.amount), 0n);

  return BigInt(amount) <= (BigInt(reserve) - totalLocked);
}

export function addLock(listingId: string, amount: string, sessionId?: string): void {
  purchaseLocks.set(getLockKey(listingId, amount), {
    timestamp: Date.now(),
    sessionId,
    listingId,
    amount
  });
}

export function removeLock(listingId: string, amount: string, sessionId?: string): void {
  const key = getLockKey(listingId, amount);
  const lock = purchaseLocks.get(key);
  if (lock && (!sessionId || lock.sessionId === sessionId)) {
    purchaseLocks.delete(key);
  }
}

export function calculatePaymentAmount(amount: string, price: string, marginBps: number): number {
  const amountBigInt = BigInt(amount);
  const priceBigInt = BigInt(price);
  const divisor = BigInt(10 ** 34);
  const marginMultiplier = BigInt(10000 + Number(marginBps));
  const marginDivisor = BigInt(10000);
  
  const rawAmount = (amountBigInt * priceBigInt * marginMultiplier + (divisor * marginDivisor) / 2n) / (divisor * marginDivisor);
  return Math.max(Number(rawAmount.toString()), 50);
}