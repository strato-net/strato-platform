import { PurchaseLock } from "../../types/types";

const LOCK_TIMEOUT = 10 * 60 * 1000;
const purchaseLocks = new Map<string, PurchaseLock>();

export function getLockKey(token: string, amount: string): string {
  return `${token}:${amount}`;
}

export function canLockAmount(token: string, amount: string, reserve: string): boolean {
  purchaseLocks.forEach((lock, key) => {
    if (lock.token === token && Date.now() - lock.timestamp > LOCK_TIMEOUT) {
      purchaseLocks.delete(key);
    }
  });

  const totalLocked = Array.from(purchaseLocks.values())
    .filter(lock => lock.token === token)
    .reduce((sum, lock) => sum + BigInt(lock.amount), 0n);

  return BigInt(amount) <= (BigInt(reserve) - totalLocked);
}

export function addLock(token: string, amount: string, sessionId?: string): void {
  purchaseLocks.set(getLockKey(token, amount), {
    timestamp: Date.now(),
    sessionId,
    token,
    amount
  });
}

export function removeLock(token: string, amount: string, sessionId?: string): void {
  const key = getLockKey(token, amount);
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