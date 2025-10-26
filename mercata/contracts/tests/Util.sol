// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Test Utilities
 * @dev Provides utilities for writing Solidity unit tests with user simulation
 *
 * Usage example:
 * ```
 * import "../Util.sol";
 *
 * contract Describe_SomeContract {
 *     using TestUtils for User;
 *
 *     User user1;
 *
 *     function beforeAll() {
 *         // Create test users
 *         user1 = new User();
 *     }
 *
 *     function it_should_do_sth() {
 *         TestUtils.callAs(user1, address(contractAddr), "sth(uint256)", amount);
 *         // ... continue with assertions
 *     }
 * }
 * ```
 */

contract User {
    function do(address a, string memory f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

library TestUtils {
    function callAs(User user, address target, string memory functionSignature, variadic args) internal {
        try user.do(target, functionSignature, args) {
            // Success - do nothing
        } catch {
            string memory errorMsg = string.concat(
                "Failed to call ",
                functionSignature,
                " on behalf of user"
            );
            require(false, errorMsg);
        }
    }

    /**
     * @notice Call a function expecting it to fail with a specific error message
     * @param user The User contract to execute the call
     * @param target The contract address to call
     * @param functionSignature The function signature to call
     * @param expectedError The expected error message (without SString wrapper)
     * @param args Variadic arguments to pass to the function
     */
    function callExpectFailure(User user, address target, string memory functionSignature, string memory expectedError, variadic args) internal {
        string e;
        try user.do(target, functionSignature, args) {
            string memory errorMsg = string.concat(
                "Expected ",
                functionSignature,
                " to fail but it succeeded"
            );
            require(false, errorMsg);
        } catch Error(string z) {
            e = z;
        }
        assertErrorMessage(e, expectedError, functionSignature);
    }

    /**
     * @notice Assert that an error message matches the expected value
     * @dev Wraps the expected error in SString format as required by SolidVM
     * @param actualError The error string captured from the catch block
     * @param expectedError The expected error message (without SString wrapper)
     * @param context Additional context for the assertion failure message
     */
    function assertErrorMessage(string memory actualError, string memory expectedError, string memory context) internal pure {
        string memory expectedWrapped = string.concat('SString "', expectedError, '"');
        require(
            actualError == expectedWrapped,
            string.concat(context, " - Expected: ", expectedWrapped, ", Got: ", actualError)
        );
    }
}