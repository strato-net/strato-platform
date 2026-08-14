// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../contracts/across/AcrossCanaryHubPoolStore.sol";

contract AcrossCanaryHubPoolStoreTest {
    function testStoresOnlyTheConstructorMessageHash() public {
        uint256 nonce = 42;
        bytes memory message = abi.encode(address(0), hex"493a4f84");
        AcrossCanaryHubPoolStore store = new AcrossCanaryHubPoolStore(nonce, message);

        require(store.relayMessageCallData(nonce) == keccak256(message), "wrong message hash");
        require(store.relayMessageCallData(nonce + 1) == bytes32(0), "unexpected second value");
    }

    function testRejectsAnEmptyMessage() public {
        bool rejected;
        try new AcrossCanaryHubPoolStore(1, bytes("")) {
            rejected = false;
        } catch {
            rejected = true;
        }
        require(rejected, "empty canary message accepted");
    }
}
