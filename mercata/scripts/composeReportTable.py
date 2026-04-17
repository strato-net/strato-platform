#!/usr/bin/env python3
"""
Compose a markdown summary of the Loop Router sweep test results.

Auto-discovers /tmp/sweep_*.txt. Each file begins with a METADATA=... JSON line
followed by per-target blocks (TARGET, POOL_BEFORE_A/B, POOL_AFTER_A/B, POSITION).
Emits one markdown table per asset — columns: Target, Actual Lev, Collateral,
Collateral ($), Debt ($), CR, Carry APR (yearly), Swap Cost (1-time),
Net APR (1-yr), Break-even.

Carry APR is annualized (full-year hold). Swap Cost is a one-time entry fee.
Net APR (1-yr) folds the swap cost in as if amortized over 12 months.
"""

import glob
import json
import math
import os
import re


def parse(path):
    try:
        with open(path) as f:
            text = f.read()
    except FileNotFoundError:
        return None, []
    meta = None
    m = re.search(r"METADATA=(\{.*?\})", text)
    if m:
        try:
            meta = json.loads(m.group(1))
        except Exception:
            meta = None
    rows_by_target = {}
    for blk in text.split("\n---\n"):
        if not blk.strip() or blk.strip().startswith("METADATA="):
            continue
        m_tgt = re.search(r"TARGET=([\d.]+)", blk)
        if not m_tgt:
            continue
        if "ERROR=" in blk:
            rows_by_target[float(m_tgt.group(1))] = {"TARGET": float(m_tgt.group(1)), "ERROR": True}
            continue
        m_pba = re.search(r"POOL_BEFORE_A=(\d+)", blk)
        m_pbb = re.search(r"POOL_BEFORE_B=(\d+)", blk)
        m_paa = re.search(r"POOL_AFTER_A=(\d+)", blk)
        m_pab = re.search(r"POOL_AFTER_B=(\d+)", blk)
        m_pos = re.search(r"POSITION=(\{.*?\})", blk, re.DOTALL)
        if not (m_pba and m_pos):
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
        }
    return meta, [rows_by_target[k] for k in sorted(rows_by_target)]


def fmt_row(r, price, base_yield, borrow_rate, token_is_A):
    if r.get("ERROR"):
        return None
    p = r["POS"]
    lev = float(p["leverage"])
    coll_raw = int(p["collateral"]) / 1e18
    coll_usd = int(p["collateralUSD"]) / 1e18
    debt = int(p["debt"]) / 1e18
    cr = float(p["collateralizationRatio"])
    carry = lev * base_yield - (lev - 1) * borrow_rate
    # Swap impact from pool reserves.
    # Router swaps USDST -> asset. On the pool: USDST in, asset out.
    # If asset is tokenB (poolType CP with USDST as tokenA), coll_out = PBA - PAA is wrong — need to know token position.
    # METADATA.poolType tells us; token_is_A represents whether asset is tokenA of the pool.
    if token_is_A:
        asset_out = r["PBA"] - r["PAA"]
        usdst_in = r["PAB"] - r["PBB"]
    else:
        asset_out = r["PBB"] - r["PAB"]
        usdst_in = r["PAA"] - r["PBA"]
    if asset_out > 0 and usdst_in > 0:
        effective_price = usdst_in / asset_out
        impact = (effective_price - price) / price * 100 if price > 0 else 0
        fee = 0.30
        swap_cost = max(0, impact) + fee
    else:
        swap_cost = None
    return (lev, coll_raw, coll_usd, debt, cr, carry, swap_cost)


def print_table(meta, rows):
    title = meta.get("symbol", "?")
    price = float(meta.get("price", 0))
    base_yield = float(meta.get("baseYield", 0))
    borrow = float(meta.get("borrow", 2.0))
    units = meta.get("units", "?")
    pool_type = int(meta.get("poolType", 0))
    pool_addr = meta.get("poolAddress", "")
    # CP: the asset position in the pool determines tokenA/tokenB.
    # For CP (poolType 0), LoopRouter's isAToB = (coinI == 0). coinI points to USDST.
    # So asset is at coinJ. token_is_A = (coinJ == 0) = (coinI == 1).
    coin_i = int(meta.get("coinI", 1))
    token_is_A = coin_i == 1

    pool_label = {0: "CP pool", 1: "StablePool"}.get(pool_type, "?")
    print(f"\n### {title}  ({pool_label} `{pool_addr[:6]}..{pool_addr[-4:]}`) @ oracle ${price:,.4f}\n")
    print(f"Borrow: {borrow}%. Base yield: {base_yield}%. Input: {units}.\n")
    print("| Target | Actual Lev | Collateral | Collateral ($) | Debt ($) | CR | Carry APR (yearly) | Swap Cost (1-time) | Net APR (1-yr) | Break-even |")
    print("|:------:|-----------:|-----------:|---------------:|---------:|---:|-------------------:|-------------------:|---------------:|-----------:|")
    max_dev = 0.0
    for r in rows:
        tgt = r["TARGET"]
        row = fmt_row(r, price, base_yield, borrow, token_is_A)
        if row is None:
            print(f"| {tgt:.2f}x | — | — | — | — | — | — | — | — | **revert** |")
            continue
        lev, coll, cusd, debt, cr, carry, sc = row
        dev = abs(lev - tgt) / tgt * 100 if tgt > 0 else 0
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
        print(f"| {tgt:.2f}x | {lev:.4f}x | {coll:.4f} | ${cusd:,.2f} | ${debt:,.2f} | {cr:.2f}% | {carry:.2f}% | {sc_str} | {net_str} | {be_str} |")
    print(f"\nMax |actual − target| / target: **{max_dev:.3f}%**")


def main():
    files = sorted(glob.glob("/tmp/sweep_*.txt"))
    if not files:
        print("No /tmp/sweep_*.txt files found. Run loopSweep.js first.")
        return

    print("# Loop sweep results\n")
    print("*Carry APR is annualized (full-year hold). Swap Cost is one-time at entry. Net APR (1-yr) folds the swap cost in as if amortized over 12 months.*\n")
    for f in files:
        meta, rows = parse(f)
        if not meta:
            print(f"\n<!-- skipped {os.path.basename(f)}: missing METADATA -->\n")
            continue
        if not rows:
            print(f"\n### {meta.get('symbol','?')}  — no results\n")
            continue
        print_table(meta, rows)


if __name__ == "__main__":
    main()
