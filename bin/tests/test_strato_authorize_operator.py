#!/usr/bin/env python3
"""Integration tests for bin/strato-authorize-operator against a local mock of Keycloak,
the vault and the app host. Run: python3 bin/tests/test_strato_authorize_operator.py"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "strato-authorize-operator")

REGISTRY = "bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd"
VALIDATOR = "0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82"
OPERATOR = "7b1f8cd02cd09ab9510e30fc8e15ff898a639771"
OLD_OPERATOR = "1111111111111111111111111111111111111111"
CLIENT_ID, CLIENT_SECRET, TOKEN = "node-client", "s3cr3t-value", "tok.en.value"
SIG_R = "b5eefa7d20ec97007bd0fb457ac8da3140d90a4f163337c3de9778650b83d121"
SIG_S = "545274b8ace3c5a2044b42023d102bdc9cce776288710f2d4a09ef1751ba939f"

sys.path.insert(0, os.path.dirname(SCRIPT))
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_loader("sao", loader=None)
sao = importlib.util.module_from_spec(_spec)
with open(SCRIPT, encoding="utf-8") as fh:
    exec(compile(fh.read(), SCRIPT, "exec"), sao.__dict__)


class Mock(http.server.BaseHTTPRequestHandler):
    """One handler plays Keycloak, the vault and the app host, keyed by path."""
    scenario = {}
    calls = []

    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode() if not isinstance(body, bytes) else body
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        Mock.calls.append(("GET", path, dict(self.headers)))
        sc = Mock.scenario
        base = f"http://127.0.0.1:{self.server.server_port}"
        if path.endswith("/.well-known/openid-configuration"):
            return self._send(200, {"token_endpoint": f"{base}/token"})
        if path == "/strato/v2.3/key":
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                return self._send(401, "bad token")
            if sc.get("vault_no_key"):
                return self._send(400, "User x doesn't exist")
            return self._send(200, {"status": "success", "address": VALIDATOR, "pubkey": "04.."})
        if path == "/api/staking/info/public":
            if sc.get("info_down"):
                return self._send(500, {"error": "boom"})
            return self._send(200, {"validatorRegistryAddress": REGISTRY, "contractVersion": "v2"})
        if path == f"/bloc/v2.2/contracts/ValidatorRegistry/{REGISTRY}/state":
            state = {"staking": "d6" * 20, "operators": {}}
            if not sc.get("v1"):
                state["operatorAuthorizationDigest"] = "function (address,address) returns (bytes32)"
            if sc.get("nonce") is not None:
                state["authorizationNonce"] = {VALIDATOR: str(sc["nonce"])}
            if sc.get("record"):
                state["operators"][VALIDATOR] = sc["record"]
            return self._send(200, state)
        return self._send(404, {"error": "no route " + path})

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        Mock.calls.append(("POST", path, dict(self.headers), body))
        sc = Mock.scenario
        if path == "/token":
            auth = self.headers.get("Authorization", "")
            import base64
            ok = auth == "Basic " + base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
            if sc.get("token_error") or not ok or body != b"grant_type=client_credentials":
                return self._send(401, {"error": sc.get("token_error", "invalid_client")})
            return self._send(200, {"access_token": TOKEN, "expires_in": 300})
        if path == "/bloc/v2.2/transaction/simulate":
            req = json.loads(body)
            args = req["txs"][0]["payload"]["args"]
            nonce = sc.get("nonce") or 0
            digest = sao.authorization_digest(REGISTRY, args["validator"], args["operator"], nonce).hex()
            if sc.get("chain_drops_nonce"):
                digest = sao.keccak256(sao.PREFIX + bytes.fromhex(REGISTRY) + bytes.fromhex(args["validator"])
                                       + bytes.fromhex(args["operator"])).hex()
            return self._send(200, [{"status": "Success", "data": {"tag": "Call", "contents": [digest]}}])
        if path == "/strato/v2.3/signature":
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                return self._send(401, "bad token")
            msg = json.loads(body)["msgHash"]
            if len(msg) != 64 or msg.startswith("0x"):
                return self._send(400, "Message was not 32 bytes long")
            return self._send(200, {"r": SIG_R, "s": SIG_S, "v": 0})
        return self._send(404, {"error": "no route " + path})


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock)
        cls.port = cls.server.server_port
        cls.base = f"http://127.0.0.1:{cls.port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        Mock.scenario = {}
        Mock.calls = []
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.node = os.path.join(self.tmp.name, "mynode")
        os.makedirs(os.path.join(self.home, ".strato"))
        os.makedirs(os.path.join(self.node, "secrets"))
        os.makedirs(os.path.join(self.node, ".ethereumH"))
        with open(os.path.join(self.home, ".strato", "default-node"), "w") as fh:
            fh.write(self.node + "\n")
        self.write_creds()
        self.write_ethconf()

    def tearDown(self):
        self.tmp.cleanup()

    def write_creds(self, path=None, secret=CLIENT_SECRET):
        path = path or os.path.join(self.node, "secrets", "oauth_credentials.yaml")
        with open(path, "w") as fh:
            fh.write(f'discoveryUrl: "{self.base}/realms/mercata/.well-known/openid-configuration"\n'
                     f'clientId: "{CLIENT_ID}"\nclientSecret: "{secret}"\n')
        os.chmod(path, 0o600)

    def write_ethconf(self, vault_suffix="/strato/v2.3", network="helium"):
        with open(os.path.join(self.node, ".ethereumH", "ethconf.yaml"), "w") as fh:
            fh.write("sqlConfig:\n  sqlHost: postgres\nurlConfig:\n  cookieRealm: strato-mercata\n"
                     f"  nodeUrl: https://strato-mercata\n  vaultTimeoutSec: 12\n  vaultUrl: {self.base}{vault_suffix}\n"
                     f"networkConfig:\n  network: {network}\n  networkID: 114784819836269\n")

    def run_script(self, *extra, stdin_text=None, env_extra=None):
        env = dict(os.environ, HOME=self.home)
        if env_extra:
            env.update(env_extra)
        if stdin_text is not None:
            env["STRATO_CONFIRM_FROM_STDIN"] = "1"
        argv = [sys.executable, SCRIPT, "0x" + OPERATOR, "--api-url", self.base, *extra]
        return subprocess.run(argv, input=stdin_text, capture_output=True, text=True, env=env, timeout=60)

    def posts(self, path):
        return [c for c in Mock.calls if c[0] == "POST" and c[1] == path]


class HappyPaths(Base):
    def test_first_registration_prints_signature_and_link(self):
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), f"0x{SIG_R}{SIG_S}00")
        self.assertIn("first registration", r.stderr)
        self.assertIn(f"{self.base}/dashboard/earn-staking?validator=0x{VALIDATOR}&operator=0x{OPERATOR}"
                      f"&signature=0x{SIG_R}{SIG_S}00&nonce=0", r.stderr)
        self.assertNotIn(CLIENT_SECRET, r.stdout + r.stderr)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)
        sign = self.posts("/strato/v2.3/signature")
        self.assertEqual(len(sign), 1)
        expected = sao.authorization_digest(REGISTRY, VALIDATOR, OPERATOR, 0).hex()
        self.assertEqual(json.loads(sign[0][3])["msgHash"], expected)

    def test_operator_change_warns_and_uses_written_nonce(self):
        Mock.scenario = {"record": {"exists": True, "active": True, "name": "node1", "operator": OLD_OPERATOR}, "nonce": 3}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"operator change from 0x{OLD_OPERATOR}", r.stderr)
        self.assertIn("executes", r.stderr)
        self.assertIn("&nonce=3", r.stderr)
        self.assertNotIn("not listed as active", r.stderr)
        expected = sao.authorization_digest(REGISTRY, VALIDATOR, OPERATOR, 3).hex()
        self.assertEqual(json.loads(self.posts("/strato/v2.3/signature")[0][3])["msgHash"], expected)

    def test_delisted_record_gets_relist_notice(self):
        Mock.scenario = {"record": {"exists": True, "name": "old", "operator": OLD_OPERATOR}}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("not listed as active", r.stderr)

    def test_legacy_record_without_operator_field_is_operated_by_itself(self):
        Mock.scenario = {"record": {"exists": True, "active": True, "name": "legacy"}}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"operator change from 0x{VALIDATOR}", r.stderr)

    def test_already_bound_is_a_noop_without_signing(self):
        Mock.scenario = {"record": {"exists": True, "active": True, "operator": OPERATOR}}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Nothing to do", r.stderr)
        self.assertEqual(r.stdout, "")
        self.assertEqual(self.posts("/strato/v2.3/signature"), [])

    def test_digest_only_matches_contract_vector_and_never_signs(self):
        r = self.run_script("--digest-only", "--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        expected = sao.authorization_digest(REGISTRY, VALIDATOR, OPERATOR, 0).hex()
        self.assertEqual(r.stdout.strip(), "0x" + expected)
        self.assertEqual(self.posts("/strato/v2.3/signature"), [])

    def test_vault_url_without_api_suffix_is_normalised(self):
        self.write_ethconf(vault_suffix="")
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_confirmation_yes_via_prompt(self):
        r = self.run_script(stdin_text="y\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Sign? [y/N]", r.stderr)

    def test_falls_back_to_home_credentials(self):
        os.remove(os.path.join(self.node, "secrets", "oauth_credentials.yaml"))
        os.makedirs(os.path.join(self.home, ".secrets"))
        self.write_creds(os.path.join(self.home, ".secrets", "strato_credentials.yaml"))
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_explicit_registry_skips_info_endpoint(self):
        Mock.scenario = {"info_down": True}
        r = self.run_script("--yes", "--registry", REGISTRY)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("(from --registry)", r.stderr)


class Failures(Base):
    def test_bad_operator_address(self):
        r = subprocess.run([sys.executable, SCRIPT, "0x1234"], capture_output=True, text=True,
                           env=dict(os.environ, HOME=self.home))
        self.assertEqual(r.returncode, 2)

    def test_missing_credentials(self):
        os.remove(os.path.join(self.node, "secrets", "oauth_credentials.yaml"))
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 3)
        self.assertIn("strato-login", r.stderr)

    def test_missing_default_node_and_no_flag(self):
        os.remove(os.path.join(self.home, ".strato", "default-node"))
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 3)
        self.assertIn("--node-dir", r.stderr)

    def test_permissive_credentials_warn_but_continue(self):
        os.chmod(os.path.join(self.node, "secrets", "oauth_credentials.yaml"), 0o644)
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("readable by other users", r.stderr)

    def test_invalid_client(self):
        self.write_creds(secret="wrong")
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 4)
        self.assertIn("invalid_client", r.stderr)
        self.assertNotIn("wrong", r.stdout)

    def test_vault_has_no_key(self):
        Mock.scenario = {"vault_no_key": True}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 5)
        self.assertIn("not completed setup", r.stderr)

    def test_info_endpoint_down_without_registry_flag(self):
        Mock.scenario = {"info_down": True}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 6)
        self.assertIn("--registry", r.stderr)

    def test_v1_registry(self):
        Mock.scenario = {"v1": True}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 7)
        self.assertIn("not the validator-keyed contract", r.stderr)
        self.assertEqual(self.posts("/strato/v2.3/signature"), [])

    def test_registry_logic_that_drops_the_nonce_is_refused(self):
        Mock.scenario = {"chain_drops_nonce": True}
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 7)
        self.assertIn("predates the nonce fix", r.stderr)
        self.assertEqual(self.posts("/strato/v2.3/signature"), [])

    def test_unknown_network_without_overrides(self):
        self.write_ethconf(network="devnet")
        env = dict(os.environ, HOME=self.home)
        r = subprocess.run([sys.executable, SCRIPT, "0x" + OPERATOR], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 8)
        self.assertIn("--api-url", r.stderr)

    def test_declined_at_prompt_signs_nothing(self):
        r = self.run_script(stdin_text="n\n")
        self.assertEqual(r.returncode, 10)
        self.assertEqual(self.posts("/strato/v2.3/signature"), [])

    def test_https_required_for_non_localhost(self):
        with open(os.path.join(self.node, ".ethereumH", "ethconf.yaml"), "a") as fh:
            pass
        with open(os.path.join(self.node, "secrets", "oauth_credentials.yaml"), "w") as fh:
            fh.write(f'discoveryUrl: "http://keycloak.example.net/x/.well-known/openid-configuration"\n'
                     f'clientId: "{CLIENT_ID}"\nclientSecret: "{CLIENT_SECRET}"\n')
        r = self.run_script("--yes")
        self.assertEqual(r.returncode, 2)
        self.assertIn("non-HTTPS", r.stderr)


class Crypto(unittest.TestCase):
    def test_keccak_empty_and_vector(self):
        self.assertTrue(sao.keccak256(b"").hex().startswith("c5d2460186f7233c927e7db2dcc703c0"))
        reg, val, op, nonce, expect = sao.SELF_TEST
        self.assertEqual(sao.authorization_digest(reg, val, op, nonce).hex(), expect)

    def test_yaml_reader_handles_sections_and_quotes(self):
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
            fh.write("top: 'x'\nurlConfig:\n  vaultUrl: https://v:8093/strato/v2.3\n  notificationServerUrl: ''\n"
                     "networkConfig:\n  network: upquark\n  networkID: 33056204878082667\n")
            name = fh.name
        d = sao.read_yaml_sections(name)
        os.unlink(name)
        self.assertEqual(d[""]["top"], "x")
        self.assertEqual(d["urlConfig"]["vaultUrl"], "https://v:8093/strato/v2.3")
        self.assertEqual(d["urlConfig"]["notificationServerUrl"], "")
        self.assertEqual(d["networkConfig"]["network"], "upquark")


if __name__ == "__main__":
    unittest.main(verbosity=1)
