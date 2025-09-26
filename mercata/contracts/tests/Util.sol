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
}