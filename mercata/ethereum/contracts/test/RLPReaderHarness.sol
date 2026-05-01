// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {RLPReader} from "../bridge/lib/RLPReader.sol";

contract RLPReaderHarness {
    using RLPReader for bytes;
    using RLPReader for RLPReader.RLPItem;

    function isList(bytes memory b) external pure returns (bool) {
        return b.toRLPItem().isList();
    }

    function listLength(bytes memory b) external pure returns (uint256) {
        return b.toRLPItem().listLength();
    }

    function payloadLength(bytes memory b) external pure returns (uint256) {
        return b.toRLPItem().payloadLength();
    }

    function toUint(bytes memory b) external pure returns (uint256) {
        return b.toRLPItem().toUint();
    }
}
