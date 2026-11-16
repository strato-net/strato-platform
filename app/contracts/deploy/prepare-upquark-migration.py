#!/usr/bin/env python3
"""Build migration call arguments from a freshly exported, matching Upquark state."""

import argparse
import hashlib
import json
import re
from pathlib import Path

POSITION_FIELDS = (
    "delegatedStake",
    "userRewardPerStakePaid",
    "pendingDelegatorRewards",
    "userFeePerStakePaid",
    "pendingDelegatorFees",
)
ADDRESS = re.compile(r"^(?:0x)?[0-9a-fA-F]{40}$")


def load(path):
    data = Path(path).read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def address(value):
    if not isinstance(value, str) or not ADDRESS.fullmatch(value):
        raise ValueError(f"invalid address: {value}")
    return value.removeprefix("0x").lower()


def checked(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staking", required=True, help="fresh StratoStaking proxy state JSON")
    parser.add_argument("--registry", required=True, help="fresh ValidatorRegistry proxy state JSON")
    parser.add_argument("--governance", required=True, help="fresh MercataGovernance state JSON")
    parser.add_argument(
        "--mapping",
        default=str(Path(__file__).with_name("upquark-operator-mapping.json")),
        help="reviewed operator-to-validator mapping",
    )
    args = parser.parse_args()
    staking, staking_sha = load(args.staking)
    registry, registry_sha = load(args.registry)
    governance, governance_sha = load(args.governance)
    mapping, mapping_sha = load(args.mapping)

    operator_keys = [address(value) for value in staking["operatorList"]]
    registry_keys = [address(value) for value in registry["operatorList"]]
    checked(operator_keys == registry_keys, "staking/registry operator lists differ")
    checked(len(operator_keys) > 0 and len(set(operator_keys)) == len(operator_keys), "invalid operator list")
    pairs = {address(key): address(value) for key, value in mapping["operatorToValidator"].items()}
    checked(len(pairs) == len(mapping["operatorToValidator"]), "duplicate normalized operator key")
    checked(set(pairs) == set(operator_keys), "mapping must cover every legacy operator exactly")
    validators = [pairs[key] for key in operator_keys]
    checked(len(set(validators)) == len(validators), "duplicate target validator")
    checked(all(target == key or target not in set(operator_keys)
                for key, target in zip(operator_keys, validators)),
            "target collides with a different legacy operator")

    governance_keys = [address(value) for value in governance["validators"]]
    checked(len(governance_keys) > 0 and len(set(governance_keys)) == len(governance_keys), "invalid governance set")
    governance_set = set(governance_keys)
    checked(int(staking["periodFinish"]) > 0
            and int(staking["lastUpdateTime"]) >= int(staking["periodFinish"]),
            "retired reward schedule has not finalized")

    positions = []
    counts = []
    active_targets = set()
    zero_weight = []
    self_bond_total = 0
    stake_total = 0
    rewardable_total = 0
    for key, target in zip(operator_keys, validators):
        record = staking["operators"][key]
        profile = registry["operators"][key]
        checked(record.get("exists") and profile.get("exists"), f"missing legacy record/profile: {key}")
        checked(not record.get("operator") and not profile.get("operator"), f"not a legacy key: {key}")
        checked(bool(record.get("active")) == bool(profile.get("active")), f"active flags differ: {key}")
        protocol_id = profile.get("protocolValidatorId") or ""
        if protocol_id:
            checked(address(registry["protocolValidatorOperators"][protocol_id]) == key,
                    f"protocol ID mapping differs: {key}")
        weight = int(record.get("selfBond", 0)) + int(record.get("delegatedStake", 0))
        self_bond_total += int(record.get("selfBond", 0))
        stake_total += int(record.get("delegatedStake", 0))
        if record.get("active"):
            checked(target in governance_set, f"active record target missing from governance: {key}")
            active_targets.add(target)
            rewardable_total += weight
            if weight == 0:
                zero_weight.append(target)
        else:
            checked(target == key and target not in governance_set,
                    f"inactive record needs a separately verified mapping: {key}")

        users = set()
        for field in POSITION_FIELDS:
            for user, by_operator in staking.get(field, {}).items():
                checked(address(user) == user, f"noncanonical user key in {field}: {user}")
                for stored_key in by_operator:
                    checked(address(stored_key) == stored_key,
                            f"noncanonical operator key in {field}: {stored_key}")
                if key in by_operator and int(by_operator[key]) != 0:
                    users.add(address(user))
        users = sorted(users)
        listed_stake = sum(int(staking.get("delegatedStake", {}).get(user, {}).get(key, 0))
                           for user in users)
        checked(listed_stake == int(record.get("delegatedStake", 0)),
                f"delegator principal does not cover record: {key}")
        if target != key:
            for user in users:
                for field in POSITION_FIELDS:
                    checked(int(staking.get(field, {}).get(user, {}).get(target, 0)) == 0,
                            f"destination {field} already exists: {user}/{target}")
        positions.extend(users)
        counts.append(len(users))

    checked(stake_total == int(staking["totalUserStake"]), "totalUserStake mismatch")
    checked(self_bond_total == int(staking["totalSelfBond"]), "totalSelfBond mismatch")
    checked(rewardable_total == int(staking["totalRewardableStake"]), "totalRewardableStake mismatch")
    for field in POSITION_FIELDS:
        for user, by_operator in staking.get(field, {}).items():
            for key, value in by_operator.items():
                checked(int(value) == 0 or address(key) in set(operator_keys),
                        f"{field} has an unlisted operator key for user {user}")

    result = {
        "sourceSha256": {
            "staking": staking_sha,
            "registry": registry_sha,
            "governance": governance_sha,
            "mapping": mapping_sha,
        },
        "records": len(operator_keys),
        "positionEntries": len(positions),
        "zeroWeightMappedIncumbents": zero_weight,
        "governanceValidatorsWithoutLegacyRecords": [
            key for key in governance_keys if key not in active_targets
        ],
        "StratoStakingMigration.migrateRecords": {
            "operatorKeys": operator_keys,
            "validators": validators,
            "positionCounts": counts,
            "delegators": positions,
        },
        "ValidatorRegistryMigration.migrateProfiles": {
            "operatorKeys": operator_keys,
            "validators": validators,
        },
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (KeyError, TypeError, ValueError) as exc:
        raise SystemExit(f"migration preflight failed: {exc}")
