// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Admin/AdminRegistry.sol";

contract MsgSenderCatchOwnable is Ownable {
    bool public executed;

    constructor(address _owner) Ownable(_owner) {
    }

    function protectedCall() external onlyOwner returns (address) {
        executed = true;
        return _msgSender();
    }
}

contract AuthorizingAdminCaller {
    function callProtected(address a) public returns (variadic) {
        variadic result = address(a).call("protectedCall");
        return result;
    }

    function isAuthorized(address _account) external returns (bool) {
        return true;
    }
}

contract Describe_OwnableMsgSenderCatch {
    function beforeAll() {
    }

    function beforeEach() {
    }

    function it_records_real_admin_registry_vote_for_original_sender() {
        AuthorizingAdminCaller adminCaller = new AuthorizingAdminCaller();
        address[] memory admins = new address[](2);
        admins[0] = address(adminCaller);
        admins[1] = address(0x1234);

        AdminRegistry admin = new AdminRegistry();
        admin.initialize(admins);
        MsgSenderCatchOwnable governedOwnable = new MsgSenderCatchOwnable(address(admin));

        adminCaller.callProtected(address(governedOwnable));

        string memory issueId = admin.getIssueId(address(governedOwnable), "protectedCall");
        require(admin.votesMap(issueId, address(adminCaller)) > 0, "Vote should be recorded for the original caller");
        require(admin.votesMap(issueId, address(governedOwnable)) == 0, "Vote should not be recorded for the governed contract");
    }
}
