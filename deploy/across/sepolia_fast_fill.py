#!/usr/bin/env python3
"""Run the minimal canonical Sepolia -> SolidVM Across fast-fill path."""

import argparse
import json
import time
import urllib.request
from pathlib import Path


FUNDS_DEPOSITED_TOPIC = "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3"


def _word(data, index):
    start = 2 + index * 64
    return int(data[start : start + 64], 16)


def _bytes32(value):
    if not isinstance(value, str) or len(value) != 66 or not value.startswith("0x"):
        raise ValueError("expected bytes32 hex value")
    int(value[2:], 16)
    return value.lower()


def decode_funds_deposited(log):
    topics = log.get("topics") or []
    if len(topics) != 4 or topics[0].lower() != FUNDS_DEPOSITED_TOPIC:
        raise ValueError("log is not a canonical FundsDeposited event")
    data = log.get("data")
    if not isinstance(data, str) or not data.startswith("0x") or (len(data) - 2) % 64:
        raise ValueError("malformed FundsDeposited data")
    # The fixed head is ten words and the dynamic message always adds its
    # length word. An empty message therefore has exactly eleven words.
    if len(data) < 2 + 11 * 64:
        raise ValueError("FundsDeposited data is too short")

    message_offset = _word(data, 9)
    if message_offset % 32 or message_offset < 10 * 32:
        raise ValueError("non-canonical FundsDeposited message offset")
    message_length_index = message_offset // 32
    message_length = _word(data, message_length_index)
    message_start = 2 + (message_length_index + 1) * 64
    message_end = message_start + message_length * 2
    if message_end > len(data):
        raise ValueError("FundsDeposited message exceeds log data")

    return {
        "destinationChainId": int(topics[1], 16),
        "depositId": int(topics[2], 16),
        "depositor": _bytes32(topics[3]),
        "inputToken": "0x" + data[2 : 2 + 64].lower(),
        "outputToken": "0x" + data[66 : 66 + 64].lower(),
        "inputAmount": _word(data, 2),
        "outputAmount": _word(data, 3),
        "quoteTimestamp": _word(data, 4),
        "fillDeadline": _word(data, 5),
        "exclusivityDeadline": _word(data, 6),
        "recipient": "0x" + data[2 + 7 * 64 : 2 + 8 * 64].lower(),
        "exclusiveRelayer": "0x" + data[2 + 8 * 64 : 2 + 9 * 64].lower(),
        "message": "0x" + data[message_start:message_end].lower(),
    }


def _json_request(url, payload):
    return _json_request_with_headers(url, payload, {})


def _json_request_with_headers(url, payload, headers):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def rpc(url, method, params):
    response = _json_request(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in response or "result" not in response:
        raise RuntimeError(f"{method} failed: {response}")
    return response["result"]


def find_deposit_log(rpc_url, transaction_hash, spoke_pool):
    receipt = rpc(rpc_url, "eth_getTransactionReceipt", [transaction_hash])
    if receipt is None or receipt.get("status") != "0x1":
        raise RuntimeError("Sepolia deposit transaction has no successful receipt")
    matching = [
        log
        for log in receipt.get("logs", [])
        if log.get("address", "").lower() == spoke_pool.lower()
        and log.get("topics", [""])[0].lower() == FUNDS_DEPOSITED_TOPIC
    ]
    if len(matching) != 1:
        raise RuntimeError(f"expected one FundsDeposited log, found {len(matching)}")
    return receipt, matching[0]


def build_fill_request(spoke_pool, relay, repayment_chain_id, repayment_address):
    return {
        "txs": [
            {
                "type": "FUNCTION",
                "payload": {
                    "contractAddress": spoke_pool,
                    "method": "fillRelay",
                    "args": {
                        "relayData": {
                            "depositor": relay["depositor"][2:],
                            "recipient": relay["recipient"][2:],
                            "exclusiveRelayer": relay["exclusiveRelayer"][2:],
                            "inputToken": relay["inputToken"][2:],
                            "outputToken": relay["outputToken"][2:],
                            "inputAmount": relay["inputAmount"],
                            "outputAmount": relay["outputAmount"],
                            "originChainId": 11155111,
                            "depositId": relay["depositId"],
                            "fillDeadline": relay["fillDeadline"],
                            "exclusivityDeadline": relay["exclusivityDeadline"],
                            "message": relay["message"][2:],
                        },
                        "repaymentChainId": repayment_chain_id,
                        "repaymentAddress": repayment_address.removeprefix("0x"),
                    },
                },
            }
        ],
        "txParams": {"gasLimit": 12_000_000, "gasPrice": 1},
    }


def build_approval_request(output_token, spoke_pool, amount):
    return {
        "txs": [
            {
                "type": "FUNCTION",
                "payload": {
                    "contractAddress": output_token,
                    "method": "approve",
                    "args": {"spender": spoke_pool, "value": amount},
                },
            }
        ],
        "txParams": {"gasLimit": 12_000_000, "gasPrice": 1},
    }


def transaction_headers(token, trusted_header_only=False):
    """Build headers for either the normal OAuth proxy or isolated trusted route."""
    if trusted_header_only:
        return {"X-USER-ACCESS-TOKEN": token}
    return {"Authorization": "Bearer " + token, "X-USER-ACCESS-TOKEN": token}


def _address_word(address):
    value = address.lower().removeprefix("0x")
    if len(value) != 40:
        raise ValueError("expected 20-byte address")
    int(value, 16)
    return value.rjust(64, "0")


def _address_from_bytes32(value):
    value = _bytes32(value)[2:]
    if value[:24] != "0" * 24:
        raise ValueError("recipient is not an EVM address")
    return "0x" + value[24:]


def _uint_call(rpc_url, contract, data):
    return int(rpc(rpc_url, "eth_call", [{"to": contract, "data": data}, "latest"]), 16)


def _submit_transaction(api_url, request, headers, label):
    result = _json_request_with_headers(
        api_url.rstrip("/") + "/transaction/parallel?resolve=true",
        request,
        headers,
    )
    if not isinstance(result, list) or len(result) != 1 or result[0].get("status") != "Success":
        raise RuntimeError(f"SolidVM {label} failed: {result}")
    return "0x" + result[0]["hash"].removeprefix("0x")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sepolia-rpc", required=True)
    parser.add_argument("--transaction-hash", required=True)
    parser.add_argument("--sepolia-spoke", required=True)
    parser.add_argument("--solidvm-spoke", required=True)
    parser.add_argument("--solidvm-api", required=True)
    parser.add_argument("--solidvm-rpc", required=True)
    parser.add_argument("--solidvm-token", required=True)
    parser.add_argument("--solidvm-chain-id", type=int, required=True)
    parser.add_argument("--relayer-address", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument(
        "--trusted-header-only",
        action="store_true",
        help="omit Authorization for an isolated local-auth trusted route",
    )
    parser.add_argument(
        "--approve-output",
        action="store_true",
        help="approve the exact output amount before filling",
    )
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    receipt, log = find_deposit_log(args.sepolia_rpc, args.transaction_hash, args.sepolia_spoke)
    relay = decode_funds_deposited(log)
    if relay["destinationChainId"] != args.solidvm_chain_id:
        raise RuntimeError("deposit destination chain does not match SolidVM")
    expected_output = "0x" + "00" * 12 + args.solidvm_token.lower().removeprefix("0x")
    if relay["outputToken"] != expected_output:
        raise RuntimeError("deposit output token does not match SolidVM token")
    if relay["fillDeadline"] < int(time.time()):
        raise RuntimeError("deposit fill deadline has expired")

    token = Path(args.token_file).read_text().strip()
    try:
        token = json.loads(token)["access_token"]
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    headers = transaction_headers(token, args.trusted_header_only)
    recipient = _address_from_bytes32(relay["recipient"])
    recipient_before = _uint_call(
        args.solidvm_rpc,
        args.solidvm_token,
        "0x70a08231" + _address_word(recipient),
    )

    approval_hash = None
    if args.approve_output:
        approval_hash = _submit_transaction(
            args.solidvm_api,
            build_approval_request(
                args.solidvm_token,
                args.solidvm_spoke,
                relay["outputAmount"],
            ),
            headers,
            "approval",
        )
        approval_receipt = rpc(args.solidvm_rpc, "eth_getTransactionReceipt", [approval_hash])
        if approval_receipt is None or approval_receipt.get("status") != "0x1":
            raise RuntimeError("SolidVM approval receipt is not successful")

    allowance_before_fill = _uint_call(
        args.solidvm_rpc,
        args.solidvm_token,
        "0xdd62ed3e"
        + _address_word(args.relayer_address)
        + _address_word(args.solidvm_spoke),
    )
    if allowance_before_fill < relay["outputAmount"]:
        raise RuntimeError("SolidVM relayer allowance is below output amount")

    request = build_fill_request(
        args.solidvm_spoke,
        relay,
        args.solidvm_chain_id,
        "0x" + "00" * 12 + args.relayer_address.removeprefix("0x"),
    )
    fill_hash = _submit_transaction(
        args.solidvm_api,
        request,
        headers,
        "fill",
    )
    fill_receipt = rpc(args.solidvm_rpc, "eth_getTransactionReceipt", [fill_hash])
    if fill_receipt is None or fill_receipt.get("status") != "0x1":
        raise RuntimeError("SolidVM fill receipt is not successful")
    recipient_after = _uint_call(
        args.solidvm_rpc,
        args.solidvm_token,
        "0x70a08231" + _address_word(recipient),
    )
    allowance_after_fill = _uint_call(
        args.solidvm_rpc,
        args.solidvm_token,
        "0xdd62ed3e"
        + _address_word(args.relayer_address)
        + _address_word(args.solidvm_spoke),
    )
    if recipient_after - recipient_before != relay["outputAmount"]:
        raise RuntimeError("recipient balance delta does not equal output amount")
    if allowance_before_fill - allowance_after_fill != relay["outputAmount"]:
        raise RuntimeError("relayer allowance delta does not equal output amount")

    output = {
        "schemaVersion": 1,
        "sepolia": {
            "chainId": 11155111,
            "spokePool": args.sepolia_spoke.lower(),
            "transactionHash": args.transaction_hash.lower(),
            "blockNumber": int(receipt["blockNumber"], 16),
            "blockHash": receipt["blockHash"].lower(),
            "logIndex": int(log["logIndex"], 16),
        },
        "relay": relay,
        "solidvm": {
            "chainId": args.solidvm_chain_id,
            "spokePool": args.solidvm_spoke.lower(),
            "outputToken": args.solidvm_token.lower(),
            "approvalTransactionHash": approval_hash.lower() if approval_hash else None,
            "fillTransactionHash": fill_hash.lower(),
            "fillBlockNumber": int(fill_receipt["blockNumber"], 16),
            "fillBlockHash": fill_receipt["blockHash"].lower(),
            "status": 1,
            "recipientBalanceBefore": recipient_before,
            "recipientBalanceAfter": recipient_after,
            "allowanceBeforeFill": allowance_before_fill,
            "allowanceAfterFill": allowance_after_fill,
        },
    }
    Path(args.out).write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
