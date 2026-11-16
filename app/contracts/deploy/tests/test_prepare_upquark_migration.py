import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "prepare-upquark-migration.py"


class MigrationPlanTest(unittest.TestCase):
    def test_includes_users_with_only_pending_rewards_or_checkpoints(self):
        operator = "1" * 40
        validator = "a" * 40
        staker = "2" * 40
        reward_only = "3" * 40
        checkpoint_only = "4" * 40
        staking = {
            "operatorList": [operator],
            "operators": {operator: {
                "exists": True, "active": True, "selfBond": "0", "delegatedStake": "5",
            }},
            "delegatedStake": {staker: {operator: "5"}},
            "pendingDelegatorRewards": {reward_only: {operator: "3"}},
            "userRewardPerStakePaid": {checkpoint_only: {operator: "4"}},
            "userFeePerStakePaid": {},
            "pendingDelegatorFees": {},
            "periodFinish": "1", "lastUpdateTime": "1",
            "totalUserStake": "5", "totalSelfBond": "0", "totalRewardableStake": "5",
        }
        registry = {
            "operatorList": [operator],
            "operators": {operator: {
                "exists": True, "active": True, "protocolValidatorId": "v1",
            }},
            "protocolValidatorOperators": {"v1": operator},
        }
        governance = {"validators": [validator]}
        mapping = {"operatorToValidator": {operator: validator}}

        with tempfile.TemporaryDirectory() as tmp:
            paths = {}
            for name, value in (
                ("staking", staking), ("registry", registry),
                ("governance", governance), ("mapping", mapping),
            ):
                path = Path(tmp) / (name + ".json")
                path.write_text(json.dumps(value))
                paths[name] = path
            result = subprocess.run(
                [sys.executable, str(SCRIPT)]
                + [arg for name, path in paths.items() for arg in ("--" + name, str(path))],
                text=True, capture_output=True, check=True,
            )
        plan = json.loads(result.stdout)
        call = plan["StratoStakingMigration.migrateRecords"]
        self.assertEqual(call["positionCounts"], [3])
        self.assertEqual(set(call["delegators"]), {staker, reward_only, checkpoint_only})


if __name__ == "__main__":
    unittest.main()
