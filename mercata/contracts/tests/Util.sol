import "../../abstract/ERC20/access/Authorizable.sol";
// This is the import path needed for:
// find mercata/contracts/tests -name '*.test.sol' -print0   | xargs -0 -I {} sh -c 'echo "{}" && cd "$(dirname "{}")" && solid-vm-cli test "$(basename "{}")"'
// It doesn't work to compile this contract alone; see https://github.com/strato-net/strato-platform/issues/4905

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }

    function doSuccessfully(address a, string f, variadic args) public returns (variadic) {
        try address(a).call(f, args) returns (variadic result) {
            return result;
        } catch Error(string e) {
            revert("Failed to call " + f + " on behalf of user with error: " + e);
        }
    }
}

// Authorizable admin to enable callback-style ownership checks
contract Admin is User, Authorizable {
    constructor() {
        bypassAuthorizations = true;
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
     * @param actualError The error string captured from the catch block
     * @param expectedError The expected error message
     * @param context Additional context for the assertion failure message
     */
    function assertErrorMessage(string memory actualError, string memory expectedError, string memory context) internal pure {
        require(
            actualError == expectedError,
            string.concat(context, " - Expected: ", expectedError, ", Got: ", actualError)
        );
    }
}