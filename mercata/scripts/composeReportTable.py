#!/usr/bin/env python3
"""
Compose a markdown summary of the Loop Router sweep test results.

Reads: /tmp/sweep_results.txt (wstETH), /tmp/sweep_syrup_results.txt (syrupUSDC)
Emits: two markdown tables — Target, Actual Lev, Collateral, Collateral ($), Debt ($),
       CR, Carry APR (yearly), Swap Cost (1-time), Net APR (1-yr), Break-even.

Carry APR is annualized (full-year hold). Swap Cost is a one-time entry fee.
Net APR (1-yr) folds the swap cost in as if amortized over 12 months.
Break-even reports how many months the carry must run to recoup the swap cost.
"""

import json
import math
import re


def parse(path, asset):
    """Return LAST non-empty-POSITION entry per TARGET (later entries win, empties skipped)."""
    rows_by_target = {}
    try:
        with open(path) as f:
            text = f.read()
    except FileNotFoundError:
        return []
    blocks = text.split("\n---\n")
    for blk in blocks:
        if not blk.strip():
            continue
        m_tgt = re.search(r"TARGET=([\d.]+)", blk)
        m_pba = re.search(r"POOL_BEFORE_A=(\d+)", blk)
        m_pbb = re.search(r"POOL_BEFORE_B=(\d+)", blk)
        m_paa = re.search(r"POOL_AFTER_A=(\d+)", blk)
        m_pab = re.search(r"POOL_AFTER_B=(\d+)", blk)
        m_pos = re.search(r"POSITION=(\{.*?\})", blk, re.DOTALL)
        if not (m_tgt and m_pba and m_pos):
            continue
        try:
            pos = json.loads(m_pos.group(1))
        except Exception:
            continue
        rows_by_target[float(m_tgt.group(1))] = {
            "TARGET": float(m_tgt.group(1)),
            "POS": pos,
            "PBA": int(m_pba.group(1)),
            "PBB": int(m_pbb.group(1)),
            "PAA": int(m_paa.group(1)),
            "PAB": int(m_pab.group(1)),
            "ASSET": asset,
        }
    return [rows_by_target[k] for k in sorted(rows_by_target)]


def fmt_row(r, price, base_yield, borrow_rate, token_is_A):
    p = r["POS"]
    lev = float(p["leverage"])
    coll_raw = int(p["collateral"]) / 1e18
    coll_usd = int(p["collateralUSD"]) / 1e18
    debt = int(p["debt"]) / 1e18
    cr = float(p["collateralizationRatio"])
    carry = lev * base_yield - (lev - 1) * borrow_rate
    if token_is_A:
        usdst_in = r["PAB"] - r["PBB"]
        coll_out = r["PBA"] - r["PAA"]
    else:
        usdst_in = r["PAA"] - r["PBA"]
        coll_out = r["PBB"] - r["PAB"]
    if coll_out > 0 and usdst_in > 0:
        effective_price = usdst_in / coll_out
        impact = (effective_price - price) / price * 100 if price > 0 else 0
        fee = 0.30
        swap_cost = max(0, impact) + fee
    else:
        swap_cost = None
    return (lev, coll_raw, coll_usd, debt, cr, carry, swap_cost)


WST_PRICE = 2896.44
WST_YIELD = 2.46
SYRUP_PRICE = 1.1595
SYRUP_YIELD = 4.36
BORROW = 2.00


def print_table(title, rows, price, y, token_is_A, units):
    print(f"\n### {title}\n")
    print(f"Oracle: ${price:,.4f}. Borrow: {BORROW}%. Base yield: {y}%. Input: {units}.\n")
    print("| Target | Actual Lev | Collateral | Collateral ($) | Debt ($) | CR | Carry APR (yearly) | Swap Cost (1-time) | Net APR (1-yr) | Break-even |")
    print("|:------:|-----------:|-----------:|---------------:|---------:|---:|-------------------:|-------------------:|---------------:|-----------:|")
    max_dev = 0.0
    for r in rows:
        lev, coll, cusd, debt, cr, carry, sc = fmt_row(r, price, y, BORROW, token_is_A)
        tgt = r["TARGET"]
        dev = abs(lev - tgt) / tgt * 100
        if dev > max_dev:
            max_dev = dev
        if sc is None:
            sc_str = "n/a"
            net_str = "n/a"
            be_str = "n/a"
        else:
            sc_str = f"{sc:.2f}%"
            net = carry - sc
            net_str = f"{net:.2f}%"
            if carry <= 0:
                be_str = "∞"
            else:
                months = math.ceil(sc / (carry / 12))
                be_str = f"{months} mo"
        print(f"| {tgt:.1f}x | {lev:.4f}x | {coll:.4f} | ${cusd:,.2f} | ${debt:,.2f} | {cr:.2f}% | {carry:.2f}% | {sc_str} | {net_str} | {be_str} |")
    print(f"\nMax |actual - target|/target: **{max_dev:.3f}%** (router convergence tolerance 0.1%)")


def main():
    wst_rows = parse("/tmp/sweep_results.txt", "wstETH")
    syrup_rows = parse("/tmp/sweep_syrup_results.txt", "syrupUSDC")

    print("*Carry APR is annualized, assuming the position is held for a full year. Swap Cost is one-time at entry. Net APR (1-yr) folds the swap cost in as if amortized over 12 months.*")

    print_table(
        "wstETH (CP pool `72f029...258e`) @ oracle $2,896.44",
        wst_rows, WST_PRICE, WST_YIELD, True, "1 wstETH",
    )
    print_table(
        "syrupUSDC (CP pool `5888fb...44c6`) @ oracle $1.1595",
        syrup_rows, SYRUP_PRICE, SYRUP_YIELD, True, "5 syrupUSDC",
    )


if __name__ == "__main__":
    main()
