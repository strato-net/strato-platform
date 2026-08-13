#!/usr/bin/env python3

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "bin" / "strato-across-deploy"
loader = importlib.machinery.SourceFileLoader("strato_across_deploy", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
deploy = importlib.util.module_from_spec(spec)
loader.exec_module(deploy)


def valid_config(now=2_000_000_000):
    genesis_time = 1_606_824_023
    head = (now - genesis_time - 900) // 12
    return {
        "schemaVersion": 1,
        "network": {
            "name": "STRATO Across isolated trial",
            "expectedChainId": "229025714941789",
        },
        "roles": {
            "deployer": "0x1111111111111111111111111111111111111111",
            "stateUpdater": "0x2222222222222222222222222222222222222222",
            "emergencyOwner": "0x3333333333333333333333333333333333333333",
        },
        "ethereum": {
            "chainId": "1",
            "hubPool": "0xc186fa914353c44b2e33ebe05f21846f1048beda",
            "hubPoolStore": "0x1ace3bbd69b63063f859514eca29c9bdd8310e61",
            "withdrawalRecipient": "0xc186fa914353c44b2e33ebe05f21846f1048beda",
            "checkpoint": {
                "generatedAt": now - 600,
                "source": "sp1-helios genesis release CHECKSUM-VERIFIED",
                "generatorSha256": "0x" + "aa" * 32,
                "executionStateRoot": "0x" + "11" * 32,
                "genesisTime": genesis_time,
                "head": head,
                "header": "0x" + "22" * 32,
                "syncCommitteeHash": "0x" + "33" * 32,
                "secondsPerSlot": 12,
                "slotsPerEpoch": 32,
                "slotsPerPeriod": 8192,
            },
        },
        "proofRoute": {
            "programVkey": "0x0052e51b66660cd62ad4a2b38fe53f4c5a0dbfa4876a2ebc58bb1c0e4945af03",
            "verifierSelector": "0x4388a21c",
            "verifierHash": "0x4388a21c687fdd5f218d7e3d13190cac4c5355818d3605fd5fb811df468ee696",
            "recursionVkeyRoot": "0x002f850ee998974d6cc00e50cd0814b098c05bfade466d28573240d057f25352",
            "proofBytes": 356,
        },
        "spoke": {
            "quoteTimeBuffer": 3600,
            "fillDeadlineBuffer": 21600,
            "initialDepositId": 1,
            "adminUpdateBuffer": 86400,
        },
        "upstream": {
            "contractsCommit": "dd9c9beb3f31bd1a282f851453978efaf33c848c",
            "relayerCommit": "4f19338d78949cd237bbaa65fcefd9aef81edb6b",
        },
    }


def proof_response(config, now=2_000_000_000):
    checkpoint = config["ethereum"]["checkpoint"]
    prev_head = checkpoint["head"]
    new_head = (now - checkpoint["genesisTime"] - 300) // checkpoint["secondsPerSlot"]

    def word(value):
        if isinstance(value, str):
            return bytes.fromhex(value.removeprefix("0x")).rjust(32, b"\0")
        return int(value).to_bytes(32, "big")

    public_values = b"".join(
        [
            word(32),
            word("0x" + "44" * 32),
            word("0x" + "55" * 32),
            word(0),
            word(new_head),
            word(checkpoint["header"]),
            word(prev_head),
            word(checkpoint["syncCommitteeHash"]),
            word(checkpoint["syncCommitteeHash"]),
            word(288),
            word(1),
            word("0x" + "66" * 32),
            word("0x" + "77" * 32),
            word(config["ethereum"]["hubPoolStore"]),
        ]
    )
    proof = b"".join(
        [
            bytes.fromhex(config["proofRoute"]["verifierSelector"][2:]),
            word(0),
            word(config["proofRoute"]["recursionVkeyRoot"]),
            word(0),
            bytes(256),
        ]
    )
    return {"status": "success", "update_calldata": {"proof": proof.hex(), "public_values": public_values.hex()}}


def deployed_manifest(config):
    def deployed(address_byte, tx_byte, block):
        return {
            "address": "0x" + address_byte * 20,
            "transactionHash": "0x" + tx_byte * 32,
            "blockHash": "0x" + "ee" * 32,
            "blockNumber": block,
            "gasUsed": 100_000 + block,
        }

    return {
        "schemaVersion": 1,
        "networkName": config["network"]["name"],
        "chainId": config["network"]["expectedChainId"],
        "generatedAt": 2_000_000_000,
        "upstream": config["upstream"],
        "proofRoute": config["proofRoute"],
        "ethereum": config["ethereum"],
        "roles": config["roles"],
        "spokeConfig": config["spoke"],
        "sourceHashes": {
            "SP1Groth16VerifierV6.sol": "11" * 32,
            "SP1HeliosSolidVM.sol": "22" * 32,
            "AcrossV4SpokePool.sol": "33" * 32,
            "AcrossV4UniversalSpoke.sol": "44" * 32,
        },
        "contracts": {
            "verifier": deployed("aa", "01", 10),
            "helios": deployed("bb", "02", 11),
            "spoke": deployed("cc", "03", 12),
        },
        "activation": {
            "depositsPaused": True,
            "fillsPaused": True,
            "ethereumGovernanceActivated": False,
        },
        "postStateAudit": {
            "chainId": config["network"]["expectedChainId"],
            "checkedAt": 2_000_000_000,
            "checks": {
                "depositsPaused": True,
                "fillsPaused": True,
            },
        },
    }


def onboarding_tokens():
    return [
        {
            "symbol": "USDST",
            "name": "STRATO USD",
            "decimals": 18,
            "stratoToken": "0x" + "55" * 20,
            "ethereumToken": "0x" + "66" * 20,
            "canonicalReturnBridge": "0x" + "77" * 20,
            "enabledOrigin": True,
            "enabledDestination": True,
        }
    ]


class RuntimeHarnessTests(unittest.TestCase):
    def api_url(self, api_config):
        with tempfile.TemporaryDirectory() as temp_dir:
            node_dir = Path(temp_dir)
            config_dir = node_dir / ".ethereumH"
            config_dir.mkdir()
            (config_dir / "ethconf.yaml").write_text(api_config, encoding="utf-8")
            return subprocess.run(
                [str(ROOT / "bin" / "strato-across-replay"), str(node_dir), "api-url"],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_api_readiness_uses_generated_bridge_address(self):
        result = self.api_url(
            "apiConfig:\n  apiListenAddress: 172.17.0.1\n  apiPort: 3000\nnetworkConfig:\n  chainId: 1\n"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "http://172.17.0.1:3000/eth/v1.2/block/last/1")

    def test_api_readiness_maps_wildcard_bind_to_loopback(self):
        result = self.api_url("apiConfig:\n  apiListenAddress: 0.0.0.0\n  apiPort: 3000\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "http://127.0.0.1:3000/eth/v1.2/block/last/1")

    def test_api_readiness_rejects_non_numeric_port(self):
        result = self.api_url("apiConfig:\n  apiListenAddress: 127.0.0.1\n  apiPort: nope\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid apiPort", result.stderr)


class ConfigTests(unittest.TestCase):
    def test_accepts_fresh_pinned_configuration(self):
        config = valid_config()
        normalized = deploy.validate_config(config, now=2_000_000_000)
        self.assertEqual(normalized["network"]["expectedChainId"], 229025714941789)
        self.assertEqual(normalized["spoke"]["fillDeadlineBuffer"], 21600)

    def test_rejects_chain_ids_the_pinned_relayer_cannot_represent(self):
        config = valid_config()
        config["network"]["expectedChainId"] = str(2**53)
        with self.assertRaisesRegex(deploy.ConfigError, "safe integer"):
            deploy.validate_config(config, now=2_000_000_000)

    def test_rejects_stale_or_future_ethereum_checkpoints(self):
        config = valid_config()
        config["ethereum"]["checkpoint"]["head"] -= 7 * 24 * 60 * 60 // 12
        with self.assertRaisesRegex(deploy.ConfigError, "checkpoint head"):
            deploy.validate_config(config, now=2_000_000_000)

        config = valid_config()
        config["ethereum"]["checkpoint"]["head"] += 2_000
        with self.assertRaisesRegex(deploy.ConfigError, "future"):
            deploy.validate_config(config, now=2_000_000_000)

    def test_rejects_proof_route_or_upstream_drift(self):
        config = valid_config()
        config["proofRoute"]["verifierSelector"] = "0xdeadbeef"
        with self.assertRaisesRegex(deploy.ConfigError, "verifierSelector"):
            deploy.validate_config(config, now=2_000_000_000)

        config = valid_config()
        config["upstream"]["contractsCommit"] = "0" * 40
        with self.assertRaisesRegex(deploy.ConfigError, "contractsCommit"):
            deploy.validate_config(config, now=2_000_000_000)

    def test_rejects_shared_roles_or_an_unpinned_checkpoint_generator(self):
        config = valid_config()
        config["roles"]["emergencyOwner"] = config["roles"]["deployer"]
        with self.assertRaisesRegex(deploy.ConfigError, "pairwise distinct"):
            deploy.validate_config(config, now=2_000_000_000)

        config = valid_config()
        config["ethereum"]["checkpoint"]["generatorSha256"] = "0x" + "00" * 32
        with self.assertRaisesRegex(deploy.ConfigError, "generatorSha256 must not be zero"):
            deploy.validate_config(config, now=2_000_000_000)


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.config = deploy.validate_config(valid_config(), now=2_000_000_000)
        self.contracts = deploy._default_contracts_dir()

    def test_default_contracts_directory_contains_every_deployment_source(self):
        self.assertTrue(self.contracts.is_dir())
        for name in (
            "SP1Groth16VerifierV6.sol",
            "SP1HeliosSolidVM.sol",
            "AcrossV4SpokePool.sol",
            "AcrossV4UniversalSpoke.sol",
        ):
            self.assertTrue((self.contracts / name).is_file(), name)

    def test_builds_dependency_ordered_source_map_payloads(self):
        plan = deploy.build_plan(self.config, self.contracts)
        self.assertEqual([step["id"] for step in plan["steps"][:3]], ["verifier", "helios", "spoke"])
        verifier = plan["steps"][0]["request"]
        self.assertEqual(verifier["txs"][0]["payload"]["contract"], "SP1Groth16VerifierV6")
        self.assertEqual(verifier["txs"][0]["payload"]["args"], {})
        spoke_sources = plan["steps"][2]["sourceFiles"]
        self.assertEqual(spoke_sources, ["AcrossV4SpokePool.sol", "AcrossV4UniversalSpoke.sol"])
        helios_args = plan["steps"][1]["requestTemplate"]["txs"][0]["payload"]["args"]
        self.assertEqual(helios_args["initialHeader"], "22" * 32)
        self.assertFalse(helios_args["initialHeliosProgramVkey"].startswith("0x"))
        role = plan["steps"][3]["requestTemplates"][0]["txs"][0]["payload"]["args"]["role"]
        self.assertEqual(role, "00" * 32)
        self.assertEqual(plan["steps"][1]["dependsOn"], ["verifier"])
        self.assertEqual(plan["steps"][2]["dependsOn"], ["helios"])
        self.assertEqual(plan["steps"][3]["dependsOn"], ["helios", "spoke"])

    def test_generated_spoke_constructor_is_paused_in_source(self):
        plan = deploy.build_plan(self.config, self.contracts)
        source = plan["steps"][2]["requestTemplate"]["txs"][0]["payload"]["src"]["AcrossV4UniversalSpoke.sol"]
        self.assertIn("pausedDeposits = true", source)
        self.assertIn("pausedFills = true", source)

    def test_relayer_env_contains_no_rpc_or_prover_secret(self):
        manifest = {
            "chainId": self.config["network"]["expectedChainId"],
            "contracts": {"spoke": {"address": "0x" + "ab" * 20, "blockNumber": 17}},
        }
        rendered = deploy.render_relayer_env(manifest)
        self.assertIn("ACROSS_CUSTOM_CHAINS=", rendered)
        self.assertIn("SPOKE_POOL_CHAINS_OVERRIDE", rendered)
        self.assertNotIn("RPC_PROVIDERS", rendered)
        self.assertNotIn("HELIOS_PROOF_API_URL", rendered)

    def test_prepare_is_offline_and_refuses_an_existing_output_directory(self):
        import tempfile

        with tempfile.TemporaryDirectory() as parent:
            out = Path(parent) / "ceremony"
            plan = deploy.prepare(self.config, self.contracts, out)
            self.assertEqual(json.loads((out / "deployment-plan.json").read_text())["sourceHashes"], plan["sourceHashes"])
            self.assertEqual((out / "deployment-plan.json").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(FileExistsError, "already exists"):
                deploy.prepare(self.config, self.contracts, out)

    def test_private_text_writer_is_atomic_and_mode_0600(self):
        import tempfile

        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / "relayer.env"
            deploy._write_text(output, "STRATO_CHAIN_ID=1\n")
            self.assertEqual(output.read_text(), "STRATO_CHAIN_ID=1\n")
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertFalse(output.with_name(output.name + ".tmp").exists())

    def test_builds_non_secret_upstream_onboarding_packet(self):
        manifest = deployed_manifest(self.config)
        packet = deploy.build_onboarding_packet(
            self.config,
            manifest,
            onboarding_tokens(),
            "https://rpc.strato.org/rpc",
            "https://explorer.strato.org",
            "ab" * 32,
            "cd" * 32,
        )
        self.assertEqual(packet["chain"]["chainId"], self.config["network"]["expectedChainId"])
        self.assertEqual(packet["deployments"]["SpokePool"]["address"], "0x" + "cc" * 20)
        self.assertEqual(packet["deployments"]["SP1Helios"]["blockNumber"], 11)
        self.assertEqual(packet["tokens"][0]["symbol"], "USDST")
        self.assertEqual(packet["evidence"]["deploymentManifestSha256"], "ab" * 32)
        self.assertEqual(packet["stratoGovernance"]["emergencyOwner"], self.config["roles"]["emergencyOwner"])
        self.assertEqual(packet["stratoGovernance"]["heliosDefaultAdmin"], "0x" + "cc" * 20)
        self.assertIn("constants", packet["upstreamChanges"])
        self.assertIn("swapApi", packet["upstreamChanges"])
        self.assertTrue(packet["activationGate"]["depositsPaused"])
        serialized = json.dumps(packet)
        self.assertNotIn("privateKey", serialized)
        self.assertNotIn("Authorization", serialized)

    def test_onboarding_packet_rejects_unsafe_urls_or_unpaused_deployment(self):
        manifest = deployed_manifest(self.config)
        with self.assertRaisesRegex(deploy.ConfigError, "HTTPS"):
            deploy.build_onboarding_packet(
                self.config,
                manifest,
                onboarding_tokens(),
                "http://rpc.strato.org",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

        with self.assertRaisesRegex(deploy.ConfigError, "publicly routable"):
            deploy.build_onboarding_packet(
                self.config,
                deployed_manifest(self.config),
                onboarding_tokens(),
                "https://127.0.0.1:8545",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

        with self.assertRaisesRegex(deploy.ConfigError, "publicly routable"):
            deploy.build_onboarding_packet(
                self.config,
                deployed_manifest(self.config),
                onboarding_tokens(),
                "https://rpc.strato.example/rpc",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

        manifest["activation"]["fillsPaused"] = False
        with self.assertRaisesRegex(deploy.ConfigError, "paused"):
            deploy.build_onboarding_packet(
                self.config,
                manifest,
                onboarding_tokens(),
                "https://rpc.strato.org",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

        manifest = deployed_manifest(self.config)
        manifest["postStateAudit"]["checks"]["depositsPaused"] = False
        with self.assertRaisesRegex(deploy.ConfigError, "post-state audit"):
            deploy.build_onboarding_packet(
                self.config,
                manifest,
                onboarding_tokens(),
                "https://rpc.strato.org",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

    def test_onboarding_packet_rejects_mismatched_or_incomplete_tokens(self):
        manifest = deployed_manifest(self.config)
        manifest["chainId"] += 1
        with self.assertRaisesRegex(deploy.ConfigError, "chain ID"):
            deploy.build_onboarding_packet(
                self.config,
                manifest,
                onboarding_tokens(),
                "https://rpc.strato.org",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

        manifest = deployed_manifest(self.config)
        tokens = onboarding_tokens()
        tokens[0]["ethereumToken"] = deploy.ZERO_ADDRESS
        with self.assertRaisesRegex(deploy.ConfigError, "zero address"):
            deploy.build_onboarding_packet(
                self.config,
                manifest,
                tokens,
                "https://rpc.strato.org",
                "https://explorer.strato.org",
                "ab" * 32,
                "cd" * 32,
            )

    def test_onboarding_pack_cli_writes_a_public_non_secret_file_and_refuses_overwrite(self):
        import tempfile

        now = int(time.time())
        deployment_time = now - 2 * 60 * 60
        config = valid_config(deployment_time)
        normalized = deploy.validate_config(config, now=deployment_time)
        manifest = deployed_manifest(normalized)
        manifest["generatedAt"] = deployment_time
        with tempfile.TemporaryDirectory() as parent:
            parent = Path(parent)
            config_path = parent / "config.json"
            manifest_path = parent / "manifest.json"
            tokens_path = parent / "tokens.json"
            bundle_path = parent / "bundle.tar.gz"
            output_path = parent / "onboarding.json"
            config_path.write_text(json.dumps(config))
            manifest_path.write_text(json.dumps(manifest))
            tokens_path.write_text(json.dumps(onboarding_tokens()))
            bundle_path.write_bytes(b"bundle")

            argv = [
                "onboarding-pack",
                str(config_path),
                str(manifest_path),
                str(tokens_path),
                "--public-rpc-url",
                "https://rpc.strato.org/rpc",
                "--explorer-url",
                "https://explorer.strato.org",
                "--bundle",
                str(bundle_path),
                "--out",
                str(output_path),
            ]
            self.assertEqual(deploy.main(argv), 0)
            self.assertEqual(output_path.stat().st_mode & 0o777, 0o644)
            packet = json.loads(output_path.read_text())
            self.assertEqual(packet["evidence"]["runtimeBundleSha256"], deploy.sha256_file(bundle_path))
            self.assertEqual(deploy.main(argv), 2)
            self.assertEqual(os.listdir(parent).count("onboarding.json"), 1)

class GateTests(unittest.TestCase):
    def test_broadcast_ack_is_chain_specific(self):
        deploy.require_broadcast_ack(229025714941789, True, "DEPLOY ACROSS TO CHAIN 229025714941789")
        with self.assertRaisesRegex(deploy.BroadcastRefused, "exact acknowledgment"):
            deploy.require_broadcast_ack(229025714941789, True, "yes")
        with self.assertRaisesRegex(deploy.BroadcastRefused, "--broadcast"):
            deploy.require_broadcast_ack(229025714941789, False, "DEPLOY ACROSS TO CHAIN 229025714941789")

    def test_api_send_supports_oidc_edge_and_direct_bloc_auth(self):
        token = "header.payload.signature"
        response = [{"status": "Success"}]
        with mock.patch.object(deploy, "_http_json", return_value=response) as request:
            self.assertEqual(deploy._api_send("http://localhost/bloc/v2.2", token, {"txs": []}), response[0])
        headers = request.call_args.args[2]
        self.assertEqual(headers["Authorization"], "Bearer " + token)
        self.assertEqual(headers["X-USER-ACCESS-TOKEN"], token)

    def test_token_signer_uses_the_matching_vault_endpoint(self):
        response = {"address": "11" * 20}
        with mock.patch.object(deploy, "_http_json", return_value=response) as request:
            address = deploy._token_signer("https://node.example/bloc/v2.2", "header.payload.signature")
        self.assertEqual(address, "0x" + "11" * 20)
        self.assertEqual(request.call_args.args[0], "https://node.example/strato/v2.3/key")
        self.assertEqual(request.call_args.kwargs["headers"]["Authorization"], "Bearer header.payload.signature")

    def test_token_signer_rejects_a_malformed_vault_response(self):
        with mock.patch.object(deploy, "_http_json", return_value={"address": 17}):
            with self.assertRaisesRegex(deploy.RemoteError, "must be a string"):
                deploy._token_signer("https://node.example/bloc/v2.2", "header.payload.signature")

    def test_validates_a_fresh_first_proof_linked_to_the_checkpoint(self):
        now = 2_000_000_000
        config = deploy.validate_config(valid_config(now), now=now)
        manifest = {"chainId": config["network"]["expectedChainId"], "proofRoute": config["proofRoute"]}
        validated = deploy.validate_proof_response(config, manifest, proof_response(config, now), now=now)
        self.assertEqual(validated["prevHead"], config["ethereum"]["checkpoint"]["head"])
        self.assertGreater(validated["newHead"], validated["prevHead"])
        self.assertEqual(validated["slots"][0]["contractAddress"], config["ethereum"]["hubPoolStore"])

    def test_rejects_a_mislinked_or_wrong_route_proof(self):
        now = 2_000_000_000
        config = deploy.validate_config(valid_config(now), now=now)
        manifest = {"chainId": config["network"]["expectedChainId"], "proofRoute": config["proofRoute"]}
        response = proof_response(config, now)
        response["update_calldata"]["proof"] = "deadbeef" + response["update_calldata"]["proof"][8:]
        with self.assertRaisesRegex(deploy.ConfigError, "selector"):
            deploy.validate_proof_response(config, manifest, response, now=now)

        response = proof_response(config, now)
        public_values = bytearray.fromhex(response["update_calldata"]["public_values"])
        public_values[32 + 128 + 31] ^= 1
        response["update_calldata"]["public_values"] = public_values.hex()
        with self.assertRaisesRegex(deploy.ConfigError, "does not extend"):
            deploy.validate_proof_response(config, manifest, response, now=now)

    def test_rejects_a_proof_without_a_nonzero_across_hub_pool_store_slot(self):
        now = 2_000_000_000
        config = deploy.validate_config(valid_config(now), now=now)
        manifest = {"chainId": config["network"]["expectedChainId"], "proofRoute": config["proofRoute"]}
        response = proof_response(config, now)
        public_values = bytearray.fromhex(response["update_calldata"]["public_values"])
        public_values[-20:] = bytes.fromhex("88" * 20)
        response["update_calldata"]["public_values"] = public_values.hex()
        with self.assertRaisesRegex(deploy.ConfigError, "Across HubPoolStore"):
            deploy.validate_proof_response(config, manifest, response, now=now)

        response = proof_response(config, now)
        public_values = bytearray.fromhex(response["update_calldata"]["public_values"])
        public_values[-64:-32] = bytes(32)
        response["update_calldata"]["public_values"] = public_values.hex()
        with self.assertRaisesRegex(deploy.ConfigError, "Across HubPoolStore"):
            deploy.validate_proof_response(config, manifest, response, now=now)

    def test_proof_ack_is_chain_specific(self):
        deploy.require_proof_ack(229025714941789, True, "VERIFY ACROSS PROOF ON CHAIN 229025714941789")
        with self.assertRaisesRegex(deploy.BroadcastRefused, "exact acknowledgment"):
            deploy.require_proof_ack(229025714941789, True, "yes")


if __name__ == "__main__":
    unittest.main()
