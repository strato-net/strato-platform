import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("sepolia_fast_fill.py")
spec = importlib.util.spec_from_file_location("sepolia_fast_fill", SCRIPT)
fast_fill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fast_fill)


def word(value):
    if isinstance(value, str):
        return value.removeprefix("0x").rjust(64, "0")
    return hex(value)[2:].rjust(64, "0")


class FundsDepositedTests(unittest.TestCase):
    def test_decodes_canonical_event_and_builds_solidvm_request(self):
        message = "1234"
        data = "0x" + "".join(
            [
                word("0x" + "11" * 32),
                word("0x" + "00" * 12 + "22" * 20),
                word(100),
                word(99),
                word(1_700_000_000),
                word(1_700_010_000),
                word(0),
                word("0x" + "00" * 12 + "33" * 20),
                word(0),
                word(320),
                word(2),
                message.ljust(64, "0"),
            ]
        )
        log = {
            "topics": [
                fast_fill.FUNDS_DEPOSITED_TOPIC,
                "0x" + word(777),
                "0x" + word(42),
                "0x" + word("0x" + "00" * 12 + "44" * 20),
            ],
            "data": data,
        }
        relay = fast_fill.decode_funds_deposited(log)
        self.assertEqual(relay["destinationChainId"], 777)
        self.assertEqual(relay["depositId"], 42)
        self.assertEqual(relay["outputAmount"], 99)
        self.assertEqual(relay["message"], "0x1234")
        request = fast_fill.build_fill_request("0x" + "aa" * 20, relay, 777, "0x" + "00" * 12 + "bb" * 20)
        args = request["txs"][0]["payload"]["args"]
        self.assertEqual(args["relayData"]["originChainId"], 11155111)
        self.assertEqual(args["relayData"]["outputAmount"], 99)
        self.assertEqual(args["repaymentChainId"], 777)
        approval = fast_fill.build_approval_request("0x" + "22" * 20, "0x" + "aa" * 20, 99)
        approval_payload = approval["txs"][0]["payload"]
        self.assertEqual(approval_payload["method"], "approve")
        self.assertEqual(approval_payload["args"]["value"], 99)

    def test_rejects_wrong_event_topic(self):
        with self.assertRaisesRegex(ValueError, "canonical FundsDeposited"):
            fast_fill.decode_funds_deposited({"topics": ["0x" + "00" * 32] * 4, "data": "0x"})

    def test_decodes_empty_message_with_minimal_canonical_length(self):
        data = "0x" + "".join(
            [
                word("0x" + "11" * 32),
                word("0x" + "00" * 12 + "22" * 20),
                word(100),
                word(99),
                word(1_700_000_000),
                word(1_700_010_000),
                word(0),
                word("0x" + "00" * 12 + "33" * 20),
                word(0),
                word(320),
                word(0),
            ]
        )
        log = {
            "topics": [
                fast_fill.FUNDS_DEPOSITED_TOPIC,
                "0x" + word(777),
                "0x" + word(42),
                "0x" + word("0x" + "00" * 12 + "44" * 20),
            ],
            "data": data,
        }
        self.assertEqual(fast_fill.decode_funds_deposited(log)["message"], "0x")

    def test_supports_isolated_trusted_auth_route(self):
        self.assertEqual(
            fast_fill.transaction_headers("secret", trusted_header_only=True),
            {"X-USER-ACCESS-TOKEN": "secret"},
        )

    def test_encodes_and_recovers_evm_addresses(self):
        address = "0x" + "12" * 20
        self.assertEqual(fast_fill._address_word(address), "0" * 24 + "12" * 20)
        self.assertEqual(
            fast_fill._address_from_bytes32("0x" + "00" * 12 + "12" * 20),
            address,
        )
        with self.assertRaisesRegex(ValueError, "not an EVM address"):
            fast_fill._address_from_bytes32("0x" + "01" + "00" * 31)
        self.assertEqual(
            fast_fill.transaction_headers("secret"),
            {
                "Authorization": "Bearer secret",
                "X-USER-ACCESS-TOKEN": "secret",
            },
        )


if __name__ == "__main__":
    unittest.main()
