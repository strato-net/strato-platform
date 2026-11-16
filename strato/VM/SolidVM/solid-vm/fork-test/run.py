#!/usr/bin/env python3
"""Run the root-make-built fixtures with isolated network configurations."""

import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[5]

    # Required configuration fields; the VM tests use runMemContextM and do
    # not connect to SQL, Redis, discovery or API services.
    sql = dict(user="unused", password="", host="127.0.0.1", port=1,
               database="unused", poolsize=1)
    config = dict(sqlConfig=sql, cirrusConfig=sql, apiConfig={},
                  discoveryConfig=dict(discoveryPort=0, minAvailablePeers=0),
                  redisBlockDBConfig=dict(redisHost="127.0.0.1", redisPort=1,
                      redisAuth=None, redisDBNumber=0, redisMaxConnections=1,
                      redisMaxIdleTime=30))
    networks = dict(helium=114784819836269, upquark=33056204878082667,
                    forktest=7381244120123405172, private=42)
    for network, network_id in networks.items():
        config["networkConfig"] = dict(network=network, networkID=network_id)
        (output / f"{network}.json").write_text(json.dumps(config, indent=2) + "\n")

    def executable(package, name):
        matches = list((root / "strato/VM/SolidVM" / package / ".stack-work/dist").glob(
            f"*/*/build/{name}/{name}"))
        if len(matches) != 1:
            raise RuntimeError(f"Expected one {package}:{name} binary; found {matches}. Build with root make first.")
        return matches[0]

    results = []

    def run(label, network, command, cwd):
        env = dict(os.environ, STRATO_CONF=str(output / f"{network}.json"))
        result = subprocess.run(command, cwd=cwd, env=env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = output / f"{label}.log"
        log.write_text(result.stdout)
        results.append(dict(test=label, exit=result.returncode, log=str(log)))
        print(f"{label}: exit {result.returncode}; {log}")
        print("\n".join(result.stdout.splitlines()[-3:]))

    for engine in ("solid-vm", "solid-vm-native"):
        binary = executable(engine, "caught-failure-fork-check")
        for network in networks:
            run(f"{engine}-{network}", network, [str(binary)], root)

    run("trycatch-contract-suite", "private",
        [str(executable("solid-vm-fuzzer", "solid-vm-cli")), "test", "TryCatch.test.sol"],
        root / "app/contracts/tests/General")
    (output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    return int(any(result["exit"] != 0 for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
