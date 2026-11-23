#!/usr/bin/env python3
"""Snapshot the live lending stack from a node's public Cirrus and code endpoints into build/.

  build/chain/*.json   state of the lending contracts, their tokens and the AdminRegistry
  build/code/<hash>    source of every proxy and logic contract involved, by code hash

Read-only, no credentials. Usage: fetch.py [--node-url https://app.strato.nexus]
"""
import argparse, json, os, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--node-url", default="https://app.strato.nexus")
args = ap.parse_args()
NODE = args.node_url.rstrip("/")
HERE = os.path.dirname(os.path.abspath(__file__))
CHAIN = os.path.join(HERE, "build", "chain")
CODE = os.path.join(HERE, "build", "code")
os.makedirs(CHAIN, exist_ok=True)
os.makedirs(CODE, exist_ok=True)

def get(path):
    req = urllib.request.Request(NODE + path, headers={"User-Agent": "lending-sunset-replay"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def cirrus(table, **params):
    return json.loads(get("/cirrus/search/" + urllib.parse.quote(table) + "?" + urllib.parse.urlencode(params, safe="().,*:>-")))

def save(name, data):
    json.dump(data, open(os.path.join(CHAIN, name + ".json"), "w"), indent=1)
    print("%-26s %s" % (name, "%d rows" % len(data) if isinstance(data, list) else "ok"))
    return data

A = lambda s: s.rjust(40, "0")
LP, SM, AR = A("1005"), A("1015"), A("100c")
USDST = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"
DEAD = A("dead")

# the block the snapshot is taken at, first, so the replay never runs ahead of its state
block = json.loads(get("/strato-api/eth/v1.2/block/last/1"))[0]["blockData"]
save("lastBlock", {"number": block["number"], "timestamp": block["timestamp"]})

pool = save("LendingPool", cirrus("BlockApps-LendingPool", address="eq." + LP))[0]
safety = save("SafetyModule", cirrus("BlockApps-SafetyModule", address="eq." + SM))[0]
registry = save("LendingRegistry", cirrus("BlockApps-LendingRegistry", address="eq." + pool["registry"]))[0]
LIQ, CV, ORACLE = registry["liquidityPool"], registry["collateralVault"], registry["priceOracle"]
MTOKEN, STOKEN, TF, FC = pool["mToken"], safety["sToken"], pool["tokenFactory"], pool["feeCollector"]
assert pool["safetyModule"] == SM and pool["borrowableAsset"] == USDST and safety["lendingPool"] == LP

save("userLoan", cirrus("BlockApps-LendingPool-userLoan", address="eq." + LP, limit=10000))
assets = save("configuredAssets", cirrus("BlockApps-LendingPool-configuredAssets", address="eq." + LP, limit=10000))
save("assetConfigs", cirrus("BlockApps-LendingPool-assetConfigs", address="eq." + LP, limit=10000))
save("userCollaterals", cirrus("BlockApps-CollateralVault-userCollaterals", address="eq." + CV, limit=10000))
save("cooldownStart", cirrus("BlockApps-SafetyModule-cooldownStart", address="eq." + SM, limit=10000))
save("prices", cirrus("BlockApps-PriceOracle-prices", address="eq." + ORACLE, limit=10000))
save("AdminRegistry", cirrus("BlockApps-AdminRegistry", address="eq." + AR))
save("admins", cirrus("BlockApps-AdminRegistry-admins", address="eq." + AR, limit=10000))
save("whitelist", cirrus("BlockApps-AdminRegistry-whitelist", address="eq." + AR, limit=10000))
save("mTokenBalances", cirrus("BlockApps-Token-_balances", address="eq." + MTOKEN, limit=10000))
save("sTokenBalances", cirrus("BlockApps-Token-_balances", address="eq." + STOKEN, limit=10000))
tokens = sorted({r["value"] for r in assets} | {USDST, MTOKEN, STOKEN})
save("Tokens", cirrus("BlockApps-Token", address="in.(%s)" % ",".join(tokens),
                      select="address,_name,_symbol,_totalSupply::text,_paused,_owner,customDecimals,status,tokenFactory"))
save("tokenBalancesOfProtocol", cirrus("BlockApps-Token-_balances", address="in.(%s)" % ",".join(tokens),
                                       key="in.(%s)" % ",".join([LP, LIQ, CV, SM, FC, DEAD]), limit=10000))

# code: every proxy involved and the logic contract behind it
roles = {"adminRegistry": AR, "tokenFactory": TF, "oracle": ORACLE, "registry": pool["registry"], "collateralVault": CV,
         "liquidityPool": LIQ, "feeCollector": FC, "lendingPool": LP, "safetyModule": SM}
proxies = {r["address"]: r["logicContract"] for r in cirrus("BlockApps-Proxy", address="in.(%s)" % ",".join(list(roles.values()) + tokens))}

def account(address):
    a = json.loads(get("/strato-api/eth/v1.2/account?address=" + address))[0]
    path = os.path.join(CODE, a["codeHash"])
    if not os.path.exists(path):
        open(path, "wb").write(get("/strato-api/eth/v1.2/code/" + a["codeHash"]))
    return {"address": address, "name": a["contractName"], "codeHash": a["codeHash"]}

index = {"logic": {}, "tokens": {}}
for role, proxy in list(roles.items()) + [(t, t) for t in tokens]:
    p = account(proxy)
    assert p["name"] == "Proxy", (role, p)
    logic = account(proxies[proxy])
    logic["proxyCodeHash"] = p["codeHash"]
    (index["tokens"] if role in tokens else index["logic"])[role] = logic
save("codeIndex", index)
save("addresses", {"lendingPool": LP, "safetyModule": SM, "adminRegistry": AR, "liquidityPool": LIQ, "collateralVault": CV, "oracle": ORACLE,
                   "registry": pool["registry"], "tokenFactory": TF, "feeCollector": FC, "poolConfigurator": pool["poolConfigurator"],
                   "rateStrategy": registry["rateStrategy"], "mToken": MTOKEN, "sToken": STOKEN, "usdst": USDST, "dead": DEAD})
print("snapshot at block %s (%s)" % (block["number"], block["timestamp"]))
