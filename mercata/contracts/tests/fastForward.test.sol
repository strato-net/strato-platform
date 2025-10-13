// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract Describe_FastForward {

  function beforeAll() {
  }

  function beforeEach() {
  }

  function it_can_call_fastForward() {
    log("Testing fastForward function");
    uint256 before = block.timestamp;
    fastForward(100);
    uint256 after = block.timestamp;
    log("Before timestamp", before);
    log("After timestamp", after);
    require(after == before + 100, "FastForward did not work");
  }

}