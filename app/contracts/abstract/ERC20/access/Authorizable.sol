abstract contract Authorizable {
    mapping (address => mapping (address => uint)) public record authorizations;

    bool internal bypassAuthorizations = false;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error AuthorizableUnauthorizedAccount(address account);

    event AccountAuthorized(address indexed account);

    event AuthorizationUsed(address indexed account, uint authorizationsRemaining);

    function _authorize(address _target, address _account, uint _authorizations) internal {
        authorizations[_target][_account] += _authorizations;
    }

    function isAuthorized(address _account) external returns (bool) {
        if (bypassAuthorizations) {
            return true;
        } else {
            uint numAuthorizations = authorizations[msg.sender][_account];
            if (numAuthorizations > 0) {
                authorizations[msg.sender][_account]--;
                return true;
            } else {
                return false;
            }
        }
    }
}
