#!/usr/bin/env python3
"""Generate a solid-vm-cli test that replays the lending sunset against the snapshot in build/.

The generated test
  1. deploys the code that is on chain (every proxy and logic contract, from the source the node
     serves for its code hash) with create(name, source)
  2. writes the snapshot state into each proxy through a seeder logic contract, then points the
     proxy at its real logic and hands it to the AdminRegistry (same admin count and threshold)
  3. checks the state reads back through the real logic exactly as the snapshot
  4. runs the planned admin actions, each [gov] one as castVoteOnIssue calls from the admins,
     with LendingPool.sol and SafetyModule.sol taken from this checkout and flattened the way
     deploy/upgrade.js does
  5. checks every balance against the integer model of the sunset below

Each test function is one transaction, so it runs on the same gas budget as a transaction on chain.
"""
import argparse, calendar, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--repo", default=os.path.normpath(os.path.join(HERE, "..", "..", "..")), help="app/contracts of the checkout to test")
ap.add_argument("--name", default="Replay")
ap.add_argument("--exec-delay", type=int, default=2 * 86400, help="seconds between the snapshot and the first sunset vote")
ap.add_argument("--approve", default="", help="payer allowance in wei (default: the debt at the vote plus --margin)")
ap.add_argument("--margin", default="5000000000000000000", help="added to the debt for the default allowance, wei")
ap.add_argument("--payer-balance", default="5000000000000000000000", help="USDST the payer starts with, wei")
ap.add_argument("--reimburse", default="107714081647064509748", help="burned from 0x..dEaD and minted to the payer, wei (0 skips)")
ap.add_argument("--batch", type=int, default=31, help="suppliers per sunset call; 0 puts every account in one call")
ap.add_argument("--batch-gap", type=int, default=3600, help="seconds between two sunset calls")
ap.add_argument("--skip-pause", action="store_true", help="leave lendUSDST and safetyUSDST unpaused")
ap.add_argument("--burn", type=int, default=0, help="gas-burner iterations run in the same transaction as an executing sunset vote")
ap.add_argument("--burn-call", type=int, default=1, help="which sunset call (1-based) the burn rides with")
args = ap.parse_args()
REPO = args.repo
CHAIN = os.path.join(HERE, "build", "chain")
CODE = os.path.join(HERE, "build", "code")
OUT = os.path.join(HERE, "build", "replay")

L = lambda n: json.load(open(os.path.join(CHAIN, n + ".json")))
RAY, WAD = 10 ** 27, 10 ** 18

# ───────────────────────────── snapshot ─────────────────────────────
ADDR = L("addresses")
M_LP, M_SM, M_AR, M_LIQ, M_CV, M_FC = [ADDR[k] for k in ["lendingPool", "safetyModule", "adminRegistry", "liquidityPool", "collateralVault", "feeCollector"]]
M_USDST, M_MTOKEN, M_STOKEN, M_DEAD = ADDR["usdst"], ADDR["mToken"], ADDR["sToken"], ADDR["dead"]
PAYER, FILLER = "PAYER", "FILLER"   # accounts that exist only in the replay
REIMBURSE = int(args.reimburse)

lp, sm, ar = L("LendingPool")[0], L("SafetyModule")[0], L("AdminRegistry")[0]
last_block = L("lastBlock")
SNAP_TIME = calendar.timegm(time.strptime(last_block["timestamp"], "%Y-%m-%dT%H:%M:%SZ"))
SNAP_BLOCK = int(last_block["number"])
EXEC_TIME = SNAP_TIME + args.exec_delay

tokens = {t["address"]: t for t in L("Tokens")}
code_index = L("codeIndex")
sym = lambda a: tokens[a]["_symbol"]
tvar = lambda a: "T_" + re.sub(r"\W", "_", sym(a))
cfg_assets = [r["value"] for r in sorted(L("configuredAssets"), key=lambda r: int(r["key"]))]
asset_cfg = {r["key"]: {k: int(v) for k, v in r["value"].items()} for r in L("assetConfigs")}
prices = {r["key"]: int(r["value"]) for r in L("prices")}
loans = {}
for r in L("userLoan"):
    v = r["value"]
    if str(v["scaledDebt"]).isdigit() and int(v["scaledDebt"]) > 0:
        loans[r["key"]] = (int(v["scaledDebt"]), int(v["lastUpdated"]))
coll = {}
for r in L("userCollaterals"):
    if int(r["value"]) > 0:
        coll.setdefault(r["key"], {})[r["key2"]] = int(r["value"])
mbal = {r["key"]: int(r["value"]) for r in L("mTokenBalances") if int(r["value"]) > 0}
sbal = {r["key"]: int(r["value"]) for r in L("sTokenBalances") if int(r["value"]) > 0}
cooldowns = {r["key"]: int(r["value"]) for r in L("cooldownStart") if int(r["value"]) > 0}
n_admins = len(L("admins"))
threshold = int(ar["defaultVotingThresholdBps"])
VOTES = -(-threshold * n_admins // 10000)   # votes the default threshold needs
assert int(ar["timelockDelay"]) == 0, "the AdminRegistry has a timelock: a passed vote would queue, not execute"

# balances[token][holder]; holders are chain addresses, PAYER or FILLER
bal = {a: {} for a in tokens}
for r in L("tokenBalancesOfProtocol"):
    if int(r["value"]) > 0:
        bal[r["address"]][r["key"]] = int(r["value"])
bal[M_MTOKEN].update(mbal)
bal[M_STOKEN].update(sbal)
bal[M_USDST][PAYER] = int(args.payer_balance)
supply = {a: int(t["_totalSupply"]) for a, t in tokens.items()}
for a in tokens:
    rest = supply[a] - sum(bal[a].values())
    assert rest >= 0, (sym(a), rest)
    if rest > 0:
        bal[a][FILLER] = rest

# the lists the votes carry, in a fixed order (by address)
BORROWERS, HOLDERS, SUPPLIERS, STAKERS = sorted(loans), sorted(coll), sorted(mbal), sorted(sbal)
if args.batch:
    n_calls = max(1, -(-len(SUPPLIERS) // args.batch))
    size = max(1, -(-len(SUPPLIERS) // n_calls))
    CALLS = [(BORROWERS, HOLDERS, [], STAKERS)] + [([], [], SUPPLIERS[i:i + size], []) for i in range(0, len(SUPPLIERS), size)]
else:
    CALLS = [(BORROWERS, HOLDERS, SUPPLIERS, STAKERS)]

# what the plan relies on, checked against the snapshot before anything is generated
problems = []
def expect(ok, msg):
    if not ok: problems.append(msg)
expect(sum(v[0] for v in loans.values()) == int(lp["totalScaledDebt"]), "open loans do not sum to totalScaledDebt: the sunset could never complete")
expect(int(lp["badDebt"]) == 0, "badDebt > 0: suppliers cannot be redeemed until it is covered or written off")
expect(sum(mbal.values()) == supply[M_MTOKEN], "lendUSDST balances do not sum to totalSupply (Cirrus lagging?)")
expect(sum(sbal.values()) == supply[M_STOKEN], "safetyUSDST balances do not sum to totalSupply (Cirrus lagging?)")
for a in sorted(set(x for d in coll.values() for x in d)):
    expect(sum(d.get(a, 0) for d in coll.values()) == bal[a].get(M_CV, 0), "CollateralVault balance != tracked collateral for " + sym(a))
    expect(not tokens[a]["_paused"], sym(a) + " is paused: the vault cannot transfer it")
    expect(int(tokens[a]["customDecimals"]) == 18, sym(a) + " is not 18 decimals")
    expect(prices.get(a, 0) > 0, sym(a) + " collateral is unpriced")
expect(int(sm["_managedAssets"]) == bal[M_USDST].get(M_SM, 0), "SafetyModule managed assets != its USDST balance")
expect(supply[M_STOKEN] > 0 or int(sm["_managedAssets"]) == 0, "SafetyModule manages assets without shares: the sunset could never complete")
expect(bal[M_USDST].get(M_DEAD, 0) >= REIMBURSE, "0x..dEaD holds less USDST than the burn")
wl = {(r["key"], r["key2"], r["key3"]) for r in L("whitelist") if r["value"]}
expect((M_MTOKEN, "burn", M_LIQ) in wl, "LiquidityPool is not whitelisted to burn lendUSDST")
expect((M_STOKEN, "burn", M_SM) in wl, "SafetyModule is not whitelisted to burn safetyUSDST")
for a in (M_LP, M_SM, M_USDST, M_MTOKEN, M_STOKEN):
    owner = (tokens.get(a) or {M_LP: lp, M_SM: sm}[a])["_owner"]
    expect(owner == M_AR, "%s is not owned by the AdminRegistry" % a)
if problems:
    sys.exit("snapshot does not fit the plan:\n  - " + "\n  - ".join(problems))

# ───────────────────────────── integer model of the pool ─────────────────────────────
def rpow(x, n, b):
    z = b
    if n == 0:
        return z
    y = x
    while n > 0:
        if n % 2 == 1:
            z = (z * y) // b
        n //= 2
        if n > 0:
            y = (y * y) // b
    return z

class Model:
    def __init__(self):
        self.idx = int(lp["borrowIndex"]); self.last = int(lp["lastAccrual"])
        self.tsd = int(lp["totalScaledDebt"]); self.reserves = int(lp["reservesAccrued"]); self.bad = int(lp["badDebt"])
        self.loans = {k: v[0] for k, v in loans.items()}
        self.coll = {u: dict(d) for u, d in coll.items()}
        self.bal = {t: dict(d) for t, d in bal.items()}
        self.supply = dict(supply)
        self.managed = int(sm["_managedAssets"])
        self.paused = bool(lp["_paused"])
        self.log = {"loans": [], "suppliers": {}, "stakers": {}, "swept": 0}

    def b(self, t, h): return self.bal[t].get(h, 0)
    def move(self, t, src, dst, amt):
        assert self.b(t, src) >= amt, ("insufficient", sym(t), src, amt, self.b(t, src))
        self.bal[t][src] = self.b(t, src) - amt
        self.bal[t][dst] = self.b(t, dst) + amt
    def mint(self, t, to, amt): self.bal[t][to] = self.b(t, to) + amt; self.supply[t] += amt
    def burn(self, t, frm, amt):
        assert self.b(t, frm) >= amt
        self.bal[t][frm] -= amt; self.supply[t] -= amt

    def accrue(self, now):
        if now == self.last: return
        idx1 = (self.idx * rpow(asset_cfg[M_USDST]["perSecondFactorRAY"], now - self.last, RAY)) // RAY
        if self.tsd > 0:
            interest = (self.tsd * (idx1 - self.idx)) // RAY
            rf = asset_cfg[M_USDST]["reserveFactor"]
            if rf > 0 and interest > 0:
                self.reserves += (interest * rf) // 10000
        self.idx = idx1; self.last = now

    def rate(self):
        s = self.supply[M_MTOKEN]
        if s == 0: return WAD
        cash = self.b(M_USDST, M_LIQ)
        under = cash + (self.tsd * self.idx) // RAY + self.bad
        under = under - self.reserves if self.reserves < under else cash
        return (under * WAD) // s if under else WAD

    def debt(self, u): return (self.loans.get(u, 0) * self.idx) // RAY

    def settle(self, borrowers):
        n = 0
        for u in borrowers:
            sd = self.loans.get(u, 0)
            if sd == 0: continue
            debt = (sd * self.idx) // RAY
            owed = debt * prices[M_USDST]
            covered, unpriced = 0, False
            for i, a in enumerate(cfg_assets):
                if a in cfg_assets[:i]: continue
                held = self.coll.get(u, {}).get(a, 0)
                if held == 0: continue
                p = prices.get(a, 0)
                if p == 0: unpriced = True
                covered += held * p
            assert covered >= owed or not unpriced, "Sunset: unpriced collateral below debt"
            self.move(M_USDST, PAYER, M_LIQ, debt)
            self.tsd -= sd; self.loans[u] = 0
            remaining, seized = owed, {}
            for a in cfg_assets:
                if remaining <= 0: break
                p = prices.get(a, 0); held = self.coll.get(u, {}).get(a, 0)
                if p == 0 or held == 0: continue
                take = min(remaining // p, held)
                if take == 0: continue
                self.coll[u][a] -= take; self.move(a, M_CV, PAYER, take)
                remaining -= take * p
                seized[a] = seized.get(a, 0) + take
            self.log["loans"].append(dict(borrower=u, debt=debt, seized=seized, shortfall=remaining // prices[M_USDST]))
            n += 1
        return n

    def return_collateral(self, holders):
        n = 0
        for u in holders:
            if self.loans.get(u, 0) > 0: continue
            did = False
            for a in cfg_assets:
                held = self.coll.get(u, {}).get(a, 0)
                if held == 0: continue
                self.coll[u][a] = 0; self.move(a, M_CV, u, held); did = True
            n += did
        return n

    def redeem_suppliers(self, suppliers):
        n = 0
        for u in suppliers:
            shares = self.b(M_MTOKEN, u)
            if shares == 0: continue
            under = (shares * self.rate()) // WAD
            cash = self.b(M_USDST, M_LIQ)
            assert 0 < under <= max(cash - self.reserves, 0), "Insufficient liquidity (excl reserves)"
            self.burn(M_MTOKEN, u, shares); self.move(M_USDST, M_LIQ, u, under)
            self.log["suppliers"][u] = under
            n += 1
        return n

    def redeem_stakers(self, stakers):
        n = 0
        for u in stakers:
            shares = self.b(M_STOKEN, u)
            if shares == 0: continue
            out = (shares * self.managed) // self.supply[M_STOKEN]
            if out > self.b(M_USDST, M_SM): continue
            self.burn(M_STOKEN, u, shares)
            if out > 0:
                self.move(M_USDST, M_SM, u, out); self.managed -= out
            self.log["stakers"][u] = out
            n += 1
        assert self.managed <= self.b(M_USDST, M_SM), "SM: assets not backed"
        assert self.supply[M_STOKEN] > 0 or self.managed == 0, "SM: assets left without shares"
        return n

    def complete(self):
        return self.tsd == 0 and self.supply[M_MTOKEN] == 0 and self.supply[M_STOKEN] == 0 and self.managed == 0

    def sunset(self, now, borrowers, holders, suppliers, stakers):
        self.accrue(now)
        counts = [self.settle(borrowers), self.return_collateral(holders)]
        assert not suppliers or (self.tsd == 0 and self.bad == 0), "Sunset: loans outstanding"
        counts.append(self.redeem_suppliers(suppliers))
        counts.append(self.redeem_stakers(stakers) if stakers else 0)
        refund = self.b(M_USDST, M_LP)
        if refund > 0: self.move(M_USDST, M_LP, PAYER, refund)
        if self.complete():
            rem = self.b(M_USDST, M_LIQ)
            if rem > 0: self.move(M_USDST, M_LIQ, M_FC, rem)
            self.log["swept"] += rem
            self.reserves = 0
            self.paused = True
        return tuple(counts)

# ───────────────────────────── sources ─────────────────────────────
def combine(filename):
    """deploy/strato.js importer.combine: depth-first, each basename once, post-order."""
    names, files = set(), []
    def read(full):
        names.add(os.path.basename(full))
        buf = ""
        for line in open(full, encoding="utf8").read().split("\n"):
            if line.startswith("import") and "<" not in line:
                buf += "//" + line + "\n"
                imp = re.search(r"[\"']([^\"']+)[\"']", line).group(1)
                if os.path.basename(imp) not in names:
                    read(os.path.normpath(os.path.join(os.path.dirname(full), imp)))
            else:
                buf += line.replace("\r", " ", 1) + "\n"
        files.append((os.path.basename(full), buf))
    read(filename)
    return files

def strip_comments(s):
    """deploy/upgrade.js stripComments."""
    out = re.sub(r"/\*[\s\S]*?\*/", "", s)
    lines = []
    for ln in out.split("\n"):
        t = ln.strip()
        if t.startswith("//"):
            lines.append(ln if "SPDX-License-Identifier" in t else "")
        else:
            lines.append(re.sub(r"//.*$", "", ln))
    return "\n".join(lines)

def flatten(rel):
    return "\n".join(strip_comments(buf) for _, buf in combine(os.path.join(REPO, rel)))

def resolve_in_collection(path):
    """ImportResolver.resolvePath' for a file at the collection's root."""
    parts = path.split("/")
    while parts and parts[0] == ".":
        parts = parts[1:]
    return None if (not parts or parts[0] == "..") else "/".join(parts)

SOURCES = {}   # code hash -> what create() is given
STUBS = set()  # imports a multi-file collection keeps but cannot resolve inside itself
def chain_source(code_hash):
    if code_hash not in SOURCES:
        raw = open(os.path.join(CODE, code_hash), encoding="utf8").read()
        decoded = json.loads(raw)
        if isinstance(decoded, str):
            SOURCES[code_hash] = decoded          # one flattened source
        else:
            SOURCES[code_hash] = raw              # [[file, source]]: passed to create() as it is stored
            names = {n for n, _ in decoded}
            for _, src in decoded:
                for line in src.split("\n"):
                    if re.match(r"\s*import\b", line):
                        p = re.search(r"[\"']([^\"']+)[\"']", line).group(1)
                        r = resolve_in_collection(p) or p
                        if r not in names: STUBS.add(r)
    return "SRC_" + code_hash[:8]

def sol_str(s):
    out = []
    for ch in s:
        if ch == "\\": out.append("\\\\")
        elif ch == '"': out.append('\\"')
        elif ch == "\n": out.append("\\n")
        elif ch == "\r": out.append("\\r")
        elif ch == "\t": out.append("\\t")
        elif ord(ch) < 32: out.append("\\x%02x" % ord(ch))
        else: out.append(ch)
    return '"' + "".join(out) + '"'

# ───────────────────────────── solidity helpers ─────────────────────────────
ROLES = ["adminRegistry", "tokenFactory", "oracle", "registry", "collateralVault", "liquidityPool", "feeCollector", "lendingPool", "safetyModule"]
VARS = {ADDR[r]: r for r in ROLES}
VARS.update({ADDR["poolConfigurator"]: "poolConfigurator", ADDR["rateStrategy"]: "rateStrategy", PAYER: "payer", FILLER: "FILLER"})
VARS.update({a: tvar(a) for a in tokens})

def sa(a):
    """Solidity expression for a chain address (protocol contracts map to the replay's own)."""
    return VARS[a] if a in VARS else "address(0x%s)" % a

def addr_list(xs): return "[" + ", ".join(sa(x) for x in xs) + "]"
def uint_list(xs): return "[" + ", ".join(str(x) for x in xs) + "]"
def chunks(xs, n): return [xs[i:i + n] for i in range(0, len(xs), n)]
def req(cond, msg): return 'require(%s, "%s");' % (cond, msg)

steps = []
def step(name, *lines):
    steps.append((name, [l for l in lines if l is not None]))

by_symbol = sorted(tokens, key=sym)

# ───────────────────────────── setup ─────────────────────────────
step("clock_at_the_snapshot", "fastForward(%d, %d);" % (SNAP_TIME, SNAP_BLOCK),
     req("block.timestamp == %d" % SNAP_TIME, "timestamp"), req("block.number == %d" % SNAP_BLOCK, "block number"))
for i, ch in enumerate(chunks(list(range(n_admins)), 4)):
    step("actors_admins_%d" % i, *["admins.push(address(new Admin()));" for _ in ch])
step("actors_others", "payer = address(new User());", "stranger = address(new User());", "burner = address(new GasBurner());")
SEEDERS = ["AdminSeeder", "TokenSeeder", "TokenFactorySeeder", "OracleSeeder", "RegistrySeeder", "VaultSeeder", "LiquiditySeeder", "PoolSeeder", "SafetySeeder"]
for i, ch in enumerate(chunks(SEEDERS, 5)):
    step("seeders_%d" % i, *["s%s = address(new %s());" % (s, s) for s in ch])

# logic contracts, one per (name, code hash)
LOGIC_VARS = {}
def logic_var(entry):
    key = (entry["name"], entry["codeHash"])
    if key not in LOGIC_VARS:
        var = "logic_%s_%s" % (entry["name"], entry["codeHash"][:8])
        LOGIC_VARS[key] = var
        ctor = "" if entry["name"] == "AdminRegistry" else ", address(this)"
        step("deploy_onchain_%s_%s" % (entry["name"], entry["codeHash"][:8]),
             '%s = create("%s", %s()%s);' % (var, entry["name"], chain_source(entry["codeHash"]), ctor), req("%s != address(0)" % var, "created"))
    return LOGIC_VARS[key]
for r in ROLES: logic_var(code_index["logic"][r])
for a in by_symbol: logic_var(code_index["tokens"][a])

SEEDER_OF = {"adminRegistry": "sAdminSeeder", "tokenFactory": "sTokenFactorySeeder", "oracle": "sOracleSeeder", "registry": "sRegistrySeeder",
             "collateralVault": "sVaultSeeder", "liquidityPool": "sLiquiditySeeder", "lendingPool": "sPoolSeeder", "safetyModule": "sSafetySeeder"}
PROXIES = [(r, SEEDER_OF.get(r) or logic_var(code_index["logic"][r]), code_index["logic"][r]) for r in ROLES]
PROXIES += [(tvar(a), "sTokenSeeder", code_index["tokens"][a]) for a in by_symbol]
for var, first_logic, entry in PROXIES:
    step("proxy_%s" % var, '%s = create("Proxy", %s(), %s, address(this));' % (var, chain_source(entry["proxyCodeHash"]), first_logic))

step("seed_admin_registry",
     "address[] list = new address[](admins.length);",
     "for (uint i = 0; i < admins.length; i++) { list[i] = admins[i]; }",
     "AdminSeeder(adminRegistry).seedAdmins(list);",
     "AdminSeeder(adminRegistry).seedParams(%d, %d, %d);" % (threshold, int(ar["timelockDelay"]), int(ar["configVersion"])),
     *['AdminSeeder(adminRegistry).seedWhitelist(%s, "%s", %s);' % (tvar(t), f, w) for t, w in [(M_MTOKEN, "liquidityPool"), (M_STOKEN, "safetyModule")] for f in ("mint", "burn")])
step("seed_token_factory", "TokenFactorySeeder(tokenFactory).seedTokens(%s);" % addr_list(by_symbol))
for a in by_symbol:
    t = tokens[a]
    step("seed_token_%s_meta" % tvar(a), "TokenSeeder(%s).seedMeta(%s, %s, tokenFactory, %d);" % (tvar(a), sol_str(t["_name"]), sol_str(t["_symbol"]), supply[a]))
    for i, ch in enumerate(chunks(sorted(bal[a].items(), key=lambda kv: str(kv[0])), 30)):
        step("seed_token_%s_balances_%d" % (tvar(a), i),
             "TokenSeeder(%s).seedBalances(%s, %s);" % (tvar(a), addr_list([k for k, _ in ch]), uint_list([v for _, v in ch])))
priced = sorted(set(cfg_assets))
step("seed_oracle", "OracleSeeder(oracle).seedPrices(%s, %s, %d);" % (addr_list(priced), uint_list([prices.get(a, 0) for a in priced]), SNAP_TIME))
step("seed_registry", "RegistrySeeder(registry).seed(lendingPool, liquidityPool, collateralVault, rateStrategy, oracle);")
rows = [(u, a, v) for u in sorted(coll) for a, v in sorted(coll[u].items())]
step("seed_collateral_vault_registry", "VaultSeeder(collateralVault).seedRegistry(registry);")
for i, ch in enumerate(chunks(rows, 30)):
    step("seed_collateral_vault_%d" % i, "VaultSeeder(collateralVault).seedCollateral(%s, %s, %s);" % (addr_list([r[0] for r in ch]), addr_list([r[1] for r in ch]), uint_list([r[2] for r in ch])))
step("seed_liquidity_pool", "LiquiditySeeder(liquidityPool).seed(registry, %s);" % tvar(M_MTOKEN))
step("seed_lending_pool_core",
     "PoolSeeder(lendingPool).seedIndex(%d, %d, %d, %d, %d);" % (int(lp["borrowIndex"]), int(lp["lastAccrual"]), int(lp["totalScaledDebt"]), int(lp["reservesAccrued"]), int(lp["badDebt"])),
     "PoolSeeder(lendingPool).seedParams(%d, %d, %d);" % (int(lp["debtCeilingAsset"]), int(lp["debtCeilingUSD"]), int(lp["safetyShareBps"])),
     "PoolSeeder(lendingPool).seedWiring(%s, %s, registry, tokenFactory, poolConfigurator, feeCollector, safetyModule);" % (tvar(M_USDST), tvar(M_MTOKEN)))
for i, ch in enumerate(chunks(sorted(loans), 30)):
    step("seed_lending_pool_loans_%d" % i, "PoolSeeder(lendingPool).seedLoans(%s, %s, %s);" % (addr_list(ch), uint_list([loans[u][0] for u in ch]), uint_list([loans[u][1] for u in ch])))
for i, ch in enumerate(chunks(cfg_assets, 6)):
    step("seed_lending_pool_assets_%d" % i, *["PoolSeeder(lendingPool).seedAsset(%s, %d, %d, %d, %d, %d, %d);" % (
        sa(a), asset_cfg[a]["ltv"], asset_cfg[a]["liquidationThreshold"], asset_cfg[a]["liquidationBonus"], asset_cfg[a]["interestRate"],
        asset_cfg[a]["reserveFactor"], asset_cfg[a]["perSecondFactorRAY"]) for a in ch])
cd = sorted(cooldowns)
step("seed_safety_module",
     "SafetySeeder(safetyModule).seedWiring(registry, lendingPool, liquidityPool, tokenFactory, %s, %s);" % (tvar(M_USDST), tvar(M_STOKEN)),
     "SafetySeeder(safetyModule).seedParams(%d, %d, %d, %d);" % (int(sm["COOLDOWN_SECONDS"]), int(sm["UNSTAKE_WINDOW"]), int(sm["MAX_SLASH_BPS"]), int(sm["_managedAssets"])),
     "SafetySeeder(safetyModule).seedCooldowns(%s, %s);" % (addr_list(cd), uint_list([cooldowns[u] for u in cd])))

# real logic in, ownership to the AdminRegistry (itself last)
FINAL = [(var, None if first == logic_var(entry) else logic_var(entry)) for var, first, entry in PROXIES[1:]] + [("adminRegistry", logic_var(code_index["logic"]["adminRegistry"]))]
for ch in chunks(FINAL, 4):
    lines = []
    for var, logic in ch:
        if logic: lines.append("Proxy(%s).setLogicContract(%s);" % (var, logic))
        lines.append("Ownable(%s).transferOwnership(adminRegistry);" % var)
    step("go_live_" + "_".join(v for v, _ in ch), *lines)

# ───────────────────────────── the seeded state reads back as the snapshot ─────────────────────────────
m = Model()
USD, MT, ST = tvar(M_USDST), tvar(M_MTOKEN), tvar(M_STOKEN)
P = "LendingPool(lendingPool)"
step("snapshot_reads_back_pool",
     req("%s.borrowIndex() == %d" % (P, m.idx), "borrowIndex"), req("%s.lastAccrual() == %d" % (P, m.last), "lastAccrual"),
     req("%s.totalScaledDebt() == %d" % (P, m.tsd), "totalScaledDebt"), req("%s.reservesAccrued() == %d" % (P, m.reserves), "reservesAccrued"),
     req("%s.badDebt() == %d" % (P, m.bad), "badDebt"), req("%s.getExchangeRate() == %d" % (P, m.rate()), "exchange rate"),
     req("!%s.paused()" % P, "pool not paused"),
     req("%s.borrowableAsset() == %s && %s.mToken() == %s" % (P, USD, P, MT), "pool tokens"),
     req("address(%s.safetyModule()) == safetyModule && address(%s.feeCollector()) == feeCollector" % (P, P), "pool wiring"),
     req("Ownable(lendingPool).owner() == adminRegistry && Ownable(safetyModule).owner() == adminRegistry && Ownable(%s).owner() == adminRegistry" % USD, "owned by the AdminRegistry"),
     *[req("%s.configuredAssets(%d) == %s" % (P, i, sa(a)), "configuredAssets[%d]" % i) for i, a in enumerate(cfg_assets)])
for i, ch in enumerate(chunks(BORROWERS, 30)):
    step("snapshot_reads_back_loans_%d" % i, *[req("%s.getUserDebt(%s) == %d" % (P, sa(u), m.debt(u)), "debt of " + u[:8]) for u in ch])
for i, ch in enumerate(chunks(rows, 10)):
    step("snapshot_reads_back_collateral_%d" % i,
         *[req("CollateralVault(collateralVault).userCollaterals(%s, %s) == %d" % (sa(u), sa(a), v), "collateral %s %s" % (u[:8], sym(a))) for u, a, v in ch])
step("snapshot_reads_back_vault_and_tokens",
     *[req("IERC20(%s).balanceOf(collateralVault) == %d" % (sa(a), bal[a][M_CV]), "vault holds " + sym(a)) for a in priced if bal[a].get(M_CV, 0) > 0],
     *[req("IERC20(%s).totalSupply() == %d" % (sa(a), supply[a]), "supply of " + sym(a)) for a in by_symbol],
     req("IERC20(%s).balanceOf(liquidityPool) == %d" % (USD, bal[M_USDST].get(M_LIQ, 0)), "pool cash"),
     req("IERC20(%s).balanceOf(address(0x%s)) == %d" % (USD, M_DEAD, bal[M_USDST].get(M_DEAD, 0)), "dead balance"),
     req("TokenFactory(tokenFactory).isTokenActive(%s) && TokenFactory(tokenFactory).isTokenActive(%s) && TokenFactory(tokenFactory).isTokenActive(%s)" % (USD, MT, ST), "tokens active"),
     req("%sToken(%s).paused() && %sToken(%s).paused()" % ("" if tokens[M_MTOKEN]["_paused"] else "!", MT, "" if tokens[M_STOKEN]["_paused"] else "!", ST), "receipt tokens paused as on chain"))
step("snapshot_reads_back_safety_and_governance",
     req("SafetyModule(safetyModule).totalAssets() == %d" % int(sm["_managedAssets"]), "SM managed assets"),
     req("SafetyModule(safetyModule).exchangeRate() == %d" % ((int(sm["_managedAssets"]) * WAD) // supply[M_STOKEN] if supply[M_STOKEN] else WAD), "SM rate"),
     req("address(SafetyModule(safetyModule).lendingPool()) == lendingPool && SafetyModule(safetyModule).sToken() == %s" % ST, "SM wiring"),
     req("AdminRegistry(adminRegistry).defaultVotingThresholdBps() == %d" % threshold, "threshold"),
     req("AdminRegistry(adminRegistry).admins(%d) == admins[%d] && AdminRegistry(adminRegistry).adminMap(admins[0]) == 1" % (n_admins - 1, n_admins - 1), "admins"),
     req('AdminRegistry(adminRegistry).whitelist(%s, "burn", liquidityPool) && AdminRegistry(adminRegistry).whitelist(%s, "burn", safetyModule)' % (MT, ST), "burn whitelist"),
     req("Ownable(adminRegistry).owner() == adminRegistry", "registry owns itself"),
     *[req("IERC20(%s).balanceOf(%s) == %d" % (ST, sa(u), sbal[u]), "safetyUSDST of " + u[:8]) for u in STAKERS[:20]])
for i, ch in enumerate(chunks(SUPPLIERS, 40)):
    step("snapshot_reads_back_suppliers_%d" % i, *[req("IERC20(%s).balanceOf(%s) == %d" % (MT, sa(u), mbal[u]), "lendUSDST of " + u[:8]) for u in ch])
# the code that is live today is what runs: a deposit gets as far as the LiquidityPool pulling funds
step("before_the_upgrade_lending_is_open",
     "bool closed = false;",
     'try User(stranger).do(lendingPool, "depositLiquidity", 1000000000000000000) returns (variadic r) { } catch Error(string e) { closed = (e == "Lending is closed"); }',
     req("!closed", "the live logic must not say Lending is closed"), req("%s.totalScaledDebt() == %d" % (P, m.tsd), "nothing changed"))

# ───────────────────────────── the plan ─────────────────────────────
def gov(name, call, *after):
    """One [gov] action: every vote short of the threshold leaves it pending, the last executes it."""
    step(name + "_votes_1_to_%d" % (VOTES - 1), *[req("!_vote(%d, %s)" % (i, call), "vote %d must not execute" % (i + 1)) for i in range(VOTES - 1)])
    step(name + "_vote_%d_executes" % VOTES, req("_vote(%d, %s)" % (VOTES - 1, call), "the last vote must execute"), *after)

step("step_01_deploy_LendingPool_implementation", 'newPoolLogic = create("LendingPool", SRC_NEW_LP(), address(this));')
step("step_02_deploy_SafetyModule_implementation", 'newSafetyLogic = create("SafetyModule", SRC_NEW_SM(), address(this));')
gov("step_03_upgrade_LendingPool", 'lendingPool, "setLogicContract", newPoolLogic')
gov("step_04_upgrade_SafetyModule", 'safetyModule, "setLogicContract", newSafetyLogic')
E18 = "1000000000000000000"
step("after_the_upgrade_every_way_in_is_closed",
     *['User(stranger).doExpectingFailure(lendingPool, "%s", "Lending is closed"%s);' % (f, a) for f, a in [
         ("depositLiquidity", ", " + E18), ("depositLiquidityOnBehalfOf", ", stranger, " + E18), ("supplyCollateral", ", %s, %s" % (USD, E18)), ("borrow", ", " + E18), ("borrowMax", "")]],
     'User(stranger).doExpectingFailure(safetyModule, "stake", "Staking is closed", %s, 0);' % E18,
     req("%s.borrowIndex() == %d && %s.totalScaledDebt() == %d" % (P, m.idx, P, m.tsd), "state carried over the upgrade"),
     req("%s.getExchangeRate() == %d" % (P, m.rate()), "exchange rate carried over"),
     req("SafetyModule(safetyModule).totalAssets() == %d" % int(sm["_managedAssets"]), "SM assets carried over"),
     *[req("%s.getUserDebt(%s) == %d" % (P, sa(u), m.debt(u)), "debt carried over") for u in BORROWERS[:3]])
if REIMBURSE:
    gov("step_05_burn_from_dead", '%s, "burn", address(0x%s), %d' % (USD, M_DEAD, REIMBURSE),
        req("IERC20(%s).balanceOf(address(0x%s)) == %d" % (USD, M_DEAD, bal[M_USDST][M_DEAD] - REIMBURSE), "dead balance after the burn"),
        req("IERC20(%s).totalSupply() == %d" % (USD, supply[M_USDST] - REIMBURSE), "supply after the burn"))
    m.burn(M_USDST, M_DEAD, REIMBURSE)
    gov("step_06_mint_to_payer", '%s, "mint", payer, %d' % (USD, REIMBURSE),
        req("IERC20(%s).balanceOf(payer) == %d" % (USD, bal[M_USDST][PAYER] + REIMBURSE), "payer after the mint"),
        req("IERC20(%s).totalSupply() == %d" % (USD, supply[M_USDST]), "supply back where it was"))
    m.mint(M_USDST, PAYER, REIMBURSE)
if not args.skip_pause:
    for n, t in ((7, M_MTOKEN), (8, M_STOKEN)):
        if not tokens[t]["_paused"]:
            gov("step_%02d_pause_%s" % (n, sym(t)), '%s, "pause"' % tvar(t), req("Token(%s).paused()" % tvar(t), sym(t) + " paused"),
                'User(stranger).doExpectingFailure(%s, "transfer", "not whitelisted", payer, 0);' % tvar(t))

# time passes between the snapshot and the first sunset vote
if args.exec_delay:
    step("clock_at_the_vote", "fastForward(%d, %d);" % (args.exec_delay, args.exec_delay), req("block.timestamp == %d" % EXEC_TIME, "timestamp at the vote"))
pre = Model(); pre.accrue(EXEC_TIME)
total_debt = sum(pre.debt(u) for u in BORROWERS)
approve = int(args.approve) if args.approve else total_debt + int(args.margin)
step("dry_run_funding_matches_the_model",
     req("%s.previewBorrowIndex() == %d" % (P, pre.idx), "projected index"),
     *[req("%s.getUserDebtPreview(%s) == %d" % (P, sa(u), pre.debt(u)), "projected debt of " + u[:8]) for u in BORROWERS])

def sargs(k):
    c = CALLS[k]
    return 'lendingPool, "sunset", %s, %s, %s, %s, payer' % ("_borrowers()" if c[0] else "_none()", "_holders()" if c[1] else "_none()",
                                                              ("_suppliers_%d()" % k) if c[2] else "_none()", "_stakers()" if c[3] else "_none()")
def early_votes(k): return [req("!_vote(%d, %s)" % (i, sargs(k)), "vote %d must not execute" % (i + 1)) for i in range(VOTES - 1)]
untouched = req("%s.totalScaledDebt() == %d && %s.lastAccrual() == %d && !%s.paused()" % (P, m.tsd, P, m.last, P), "nothing moved")
step("step_10_call_1_votes_1_to_%d" % (VOTES - 1), *early_votes(0), untouched)
# without the payer's approval the executing vote reverts as a whole and can be cast again
if BORROWERS:
    step("step_10_call_1_last_vote_before_the_approval_reverts",
         "bool reverted = false;", "try { _vote(%d, %s); } catch { reverted = true; }" % (VOTES - 1, sargs(0)),
         req("reverted", "sunset must revert without an allowance"), untouched,
         req("IERC20(%s).balanceOf(payer) == %d && IERC20(%s).totalSupply() == %d" % (USD, m.b(M_USDST, PAYER), MT, m.supply[M_MTOKEN]), "balances untouched"))
if len(CALLS) > 1:
    step("step_10_call_2_votes_1_to_%d_collected_early" % (VOTES - 1), *early_votes(1), untouched)
    if BORROWERS:
        # a supplier call cannot run ahead of the loans: its last vote reverts until they are settled
        step("step_10_call_2_last_vote_before_the_loans_are_settled_reverts",
             'User(admins[%d]).doExpectingFailure(adminRegistry, "castVoteOnIssue", "Sunset: loans outstanding", %s);' % (VOTES - 1, sargs(1)), untouched,
             req("IERC20(%s).totalSupply() == %d" % (MT, m.supply[M_MTOKEN]), "no supplier redeemed"))
step("step_09_payer_approves", 'User(payer).do(%s, "approve", lendingPool, %d);' % (USD, approve),
     req("IERC20(%s).allowance(payer, lendingPool) == %d" % (USD, approve), "allowance"))

now = EXEC_TIME
all_counts, settled_rate = [], None
for k, c in enumerate(CALLS):
    if k > 0:
        now += args.batch_gap
        step("clock_before_call_%d" % (k + 1), "fastForward(%d, %d);" % (args.batch_gap, args.batch_gap))
    if k > 1:
        step("step_10_call_%d_votes_1_to_%d" % (k + 1, VOTES - 1), *early_votes(k))
    try:
        all_counts.append(m.sunset(now, *c))
    except AssertionError as e:
        sys.exit("the model rejects sunset call %d: %s (payer balance %s, approval %d, debt %d)" % (k + 1, e, args.payer_balance, approve, total_debt))
    checks = [req("%s.totalScaledDebt() == %d" % (P, m.tsd), "debt after call %d" % (k + 1)),
              req("IERC20(%s).totalSupply() == %d" % (MT, m.supply[M_MTOKEN]), "lendUSDST left after call %d" % (k + 1)),
              req("IERC20(%s).balanceOf(liquidityPool) == %d" % (USD, m.b(M_USDST, M_LIQ)), "pool cash after call %d" % (k + 1)),
              req("%s.reservesAccrued() == %d" % (P, m.reserves), "reserves after call %d" % (k + 1)),
              req(("" if m.paused else "!") + "%s.paused()" % P, "paused by the completing call and no other")]
    if m.supply[M_MTOKEN] > 0 and m.tsd == 0:
        r = m.rate()
        if settled_rate is None: settled_rate = r
        assert 0 <= r - settled_rate < 10 ** 6, "the supplier rate moved between calls"
        checks.append(req("%s.getExchangeRate() == %d" % (P, r), "one rate for every call"))
    burn = ("GasBurner(burner).burn(%d);" % args.burn) if (args.burn and args.burn_call == k + 1) else None
    step("step_10_call_%d_vote_%d_executes" % (k + 1, VOTES), burn,
         req("Admin(admins[%d]).vote(adminRegistry, %s)" % (VOTES - 1, sargs(k)), "the last vote must execute the sunset"))
    step("step_10_call_%d_effects" % (k + 1), *checks)
    if k == 0:
        step("step_11_payer_revokes", 'User(payer).do(%s, "approve", lendingPool, 0);' % USD, req("IERC20(%s).allowance(payer, lendingPool) == 0" % USD, "allowance cleared"))
if not (m.complete() and m.paused):
    sys.exit("the model does not complete the sunset with these lists")
counts = tuple(sum(c[i] for c in all_counts) for i in range(4))

# ───────────────────────────── effects ─────────────────────────────
step("effects_pool_accounting",
     req("%s.paused()" % P, "pool paused"), req("%s.totalScaledDebt() == 0" % P, "no debt"), req("%s.reservesAccrued() == 0" % P, "no reserves"),
     req("%s.borrowIndex() == %d && %s.lastAccrual() == %d" % (P, m.idx, P, now), "index accrued to the last call"),
     req("IERC20(%s).totalSupply() == 0 && IERC20(%s).totalSupply() == 0" % (MT, ST), "no receipt tokens"),
     req("SafetyModule(safetyModule).totalAssets() == 0", "SM manages nothing"),
     req("IERC20(%s).balanceOf(liquidityPool) == 0 && IERC20(%s).balanceOf(lendingPool) == 0 && IERC20(%s).balanceOf(safetyModule) == 0" % (USD, USD, USD), "pool, module and LendingPool hold no USDST"),
     req("IERC20(%s).balanceOf(feeCollector) == %d" % (USD, m.b(M_USDST, M_FC)), "FeeCollector got reserves and dust"),
     req("IERC20(%s).totalSupply() == %d" % (USD, m.supply[M_USDST]), "USDST supply unchanged by the sunset"),
     *[req("%s.getUserDebt(%s) == 0" % (P, sa(u)), "loan closed") for u in BORROWERS[:30]])
checks = []
for t in by_symbol:
    for h, v in sorted(m.bal[t].items(), key=lambda kv: str(kv[0])):
        if h != FILLER:
            checks.append(req("IERC20(%s).balanceOf(%s) == %d" % (sa(t), sa(h), v), "%s of %s" % (sym(t), str(h)[:8])))
for i, ch in enumerate(chunks(checks, 40)):
    step("effects_every_balance_%d" % i, *ch)
for i, ch in enumerate(chunks(rows, 20)):
    step("effects_vault_emptied_%d" % i, *[req("CollateralVault(collateralVault).userCollaterals(%s, %s) == 0" % (sa(u), sa(a)), "vault entry cleared") for u, a, _ in ch])
again = 'lendingPool, "sunset", _none(), _holders(), _none(), _none(), payer'
step("after_the_sunset_the_pool_stays_closed",
     'User(stranger).doExpectingFailure(lendingPool, "depositLiquidity", "Lending is closed", 1);',
     'User(stranger).doExpectingFailure(lendingPool, "withdrawLiquidity", "This functionality has been paused and is currently not available", 1);',
     # another sunset on the finished pool changes nothing
     *[req("!_vote(%d, %s)" % (i, again), "vote %d" % (i + 1)) for i in range(VOTES - 1)],
     req("_vote(%d, %s)" % (VOTES - 1, again), "a follow-up sunset executes"),
     req("IERC20(%s).balanceOf(feeCollector) == %d && %s.paused()" % (USD, m.b(M_USDST, M_FC), P), "nothing moved"))

# ───────────────────────────── emit ─────────────────────────────
o = []
w = o.append
w("// GENERATED by gen_replay.py from the snapshot at block %d (%s). Do not edit." % (SNAP_BLOCK, last_block["timestamp"]))
for imp in ["tests/Util.sol", "abstract/ERC20/IERC20.sol", "abstract/ERC20/access/Ownable.sol", "concrete/Admin/AdminRegistry.sol", "concrete/Admin/FeeCollector.sol",
            "concrete/Proxy/Proxy.sol", "concrete/Tokens/TokenFactory.sol", "concrete/Tokens/Token.sol", "concrete/Lending/LendingRegistry.sol",
            "concrete/Lending/CollateralVault.sol", "concrete/Lending/LiquidityPool.sol", "concrete/Lending/RateStrategy.sol",
            "concrete/Lending/PriceOracle.sol", "concrete/Lending/SafetyModule.sol", "concrete/Lending/LendingPool.sol"]:
    w('import "%s/%s";' % (REPO, imp))
w(open(os.path.join(HERE, "Seeders.sol"), encoding="utf8").read())
w("contract Describe_%s {" % args.name)
w("    address[] admins;")
w("    address payer; address stranger; address burner;")
w("    address FILLER = address(0x00000000000000000000000000000000f111e500);")
w("    address poolConfigurator = address(0x%s);" % ADDR["poolConfigurator"])
w("    address rateStrategy = address(0x%s);" % ADDR["rateStrategy"])
for s in SEEDERS: w("    address s%s;" % s)
for var in LOGIC_VARS.values(): w("    address %s;" % var)
for var, _, _ in PROXIES: w("    address %s;" % var)
w("    address newPoolLogic; address newSafetyLogic;")
w("")
for h, src in SOURCES.items():
    w("    function SRC_%s() internal returns (string) { return %s; }" % (h[:8], sol_str(src)))
w("    function SRC_NEW_LP() internal returns (string) { return %s; }" % sol_str(flatten("concrete/Lending/LendingPool.sol")))
w("    function SRC_NEW_SM() internal returns (string) { return %s; }" % sol_str(flatten("concrete/Lending/SafetyModule.sol")))
w("")
w("    function _vote(uint i, address target, string func, variadic args) internal returns (bool) {")
w("        return Admin(admins[i]).vote(adminRegistry, target, func, args);")
w("    }")
w("    function _none() internal returns (address[]) { return new address[](0); }")
for nm, xs in [("_borrowers", BORROWERS), ("_holders", HOLDERS), ("_stakers", STAKERS)] + [("_suppliers_%d" % k, c[2]) for k, c in enumerate(CALLS) if c[2]]:
    w("    function %s() internal returns (address[]) { address[] list = %s; return list; }" % (nm, addr_list(xs)))
w("")
for i, (name, lines) in enumerate(steps):
    w("    function it_%03d_%s() {" % (i, name))
    for l in lines: w("        " + l)
    w("    }")
w("}")
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, args.name + ".replay.sol")
open(path, "w", encoding="utf8").write("\n".join(o) + "\n")
json.dump(sorted(STUBS), open(os.path.join(OUT, "stub_imports.json"), "w"))
unused = dict(user="unused", password="", host="127.0.0.1", port=1, database="unused", poolsize=1)
json.dump(dict(sqlConfig=unused, cirrusConfig=unused, apiConfig={}, discoveryConfig=dict(discoveryPort=0, minAvailablePeers=0),
               redisBlockDBConfig=dict(redisHost="127.0.0.1", redisPort=1, redisAuth=None, redisDBNumber=0, redisMaxConnections=1, redisMaxIdleTime=30),
               networkConfig=dict(network="upquark", networkID=33056204878082667)), open(os.path.join(OUT, "upquark.json"), "w"), indent=2)

# ───────────────────────────── what to expect ─────────────────────────────
f = lambda v: "%.6f" % (v / 1e18)
hx = lambda xs: "[" + ", ".join("0x" + x for x in xs) + "]"
print("snapshot: block %d, %s; sunset voted %+.1f days later" % (SNAP_BLOCK, last_block["timestamp"], args.exec_delay / 86400))
print("accounts: %d borrowers, %d collateral holders, %d suppliers, %d stakers; %d of %d admins pass a vote" % (len(BORROWERS), len(HOLDERS), len(SUPPLIERS), len(STAKERS), VOTES, n_admins))
nxt = Model(); nxt.accrue(EXEC_TIME + 86400)
print("debt at the vote %s USDST (+%s per day); allowance %s" % (f(total_debt), f(sum(nxt.debt(u) for u in BORROWERS) - total_debt), f(approve)))
for l in m.log["loans"]:
    print("  loan %s  debt %s  payer receives %s%s" % (l["borrower"], f(l["debt"]), ", ".join("%s %s" % (f(v), sym(a)) for a, v in l["seized"].items()) or "nothing",
                                                         ("  SHORT by %s USDST" % f(l["shortfall"])) if l["shortfall"] > 10 ** 9 else ""))
short = sum(l["shortfall"] for l in m.log["loans"] if l["shortfall"] > 10 ** 9)
print("payer absorbs %s USDST of uncovered debt; reimbursed %s" % (f(short), f(REIMBURSE)))
print("suppliers paid %s USDST at %s per lendUSDST; stakers paid %s; FeeCollector receives %s" % (
    f(sum(m.log["suppliers"].values())), f(settled_rate or WAD), f(sum(m.log["stakers"].values())), f(m.log["swept"])))
print("payer ends with: " + ", ".join("%s %s" % (f(m.b(t, PAYER)), sym(t)) for t in by_symbol if m.b(t, PAYER) > 0) + "  (started with %s USDST)" % f(int(args.payer_balance)))
print("%d sunset call(s), %d test steps -> %s" % (len(CALLS), len(steps), path))
with open(os.path.join(OUT, args.name + ".calls.txt"), "w") as fh:
    fh.write("# LendingPool.sunset(borrowers, collateralHolders, suppliers, stakers, payer), one [gov] vote per call\n")
    for k, c in enumerate(CALLS):
        fh.write("\n## call %d\nborrowers:         %s\ncollateralHolders: %s\nsuppliers:         %s\nstakers:           %s\n" % (k + 1, hx(c[0]), hx(c[1]), hx(c[2]), hx(c[3])))
