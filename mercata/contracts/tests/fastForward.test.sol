// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../concrete/BaseCodeCollection.sol";

/// @title Test to verify fastForward behavior in beforeEach
/// @notice This test demonstrates a bug where fastForward in beforeEach doesn't persist to test execution
contract Describe_BeforeEach_FastForward_Bug {

    constructor() {
    }

    function beforeEach() public {
        // Fast forward time by 10 seconds
        fastForward(10);
    }

    /// @notice This test will FAIL if fastForward in beforeEach doesn't work
    /// @dev Expected: block.timestamp should be 10 after fastForward(10) in beforeEach
    ///      Actual (if bug exists): block.timestamp will be 0
    function it_should_have_block_timestamp_of_10_after_beforeEach() public {
        // If fastForward in beforeEach worked, block.timestamp should be 10
        require(block.timestamp == 10, "block.timestamp should be 10 after fastForward(10) in beforeEach. Got: " + string(block.timestamp));
    }

    /// @notice This test will PASS because fastForward is called within the test
    /// @dev This proves that fastForward works when called inside the test function
    function it_should_have_block_timestamp_of_30_when_called_in_test() public {
        // Fast forward in the test itself
        fastForward(10);

        // Now block.timestamp should be 30
        require(block.timestamp == 30, "block.timestamp should be 30 after fastForward(10) in test. Got: " + string(block.timestamp));
    }
}
