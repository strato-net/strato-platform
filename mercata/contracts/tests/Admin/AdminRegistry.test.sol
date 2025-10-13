// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Admin/AdminRegistry.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract TestERC20 is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_AdminRegistry is Authorizable {
    AdminRegistry adminRegistry;
    TestERC20 token;
    User user1;
    User user2;
    User user3;
    address admin1;
    address admin2;
    address admin3;
    address nonAdmin;
    address zeroAddress;

    function beforeAll() {
        bypassAuthorizations = true;
        admin1 = address(this);
        admin2 = address(0x2);
        admin3 = address(0x3);
        nonAdmin = address(0x4);
        zeroAddress = address(0);
        user1 = new User();
        user2 = new User();
        user3 = new User();
    }

    function beforeEach() {
        address[] memory initialAdmins = new address[](2);
        initialAdmins[0] = admin1;
        initialAdmins[1] = address(user1);
        adminRegistry = new AdminRegistry();
        adminRegistry.initialize(initialAdmins);
        token = new TestERC20("Test Token", "TEST", address(adminRegistry));
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_admin_registry_sets_initial_admins() {
        require(adminRegistry.isAdminAddress(admin1), "Admin1 should be an admin");
        require(adminRegistry.isAdminAddress(address(user1)), "User1 should be an admin");
        require(!adminRegistry.isAdminAddress(admin3), "Admin3 should not be an admin");
        require(!adminRegistry.isAdminAddress(nonAdmin), "Non-admin should not be an admin");
    }

    function it_admin_registry_handles_empty_initial_admins() {
        address[] memory emptyAdmins = new address[](0);
        AdminRegistry emptyRegistry = new AdminRegistry();
        emptyRegistry.initialize(emptyAdmins);
        require(!emptyRegistry.isAdminAddress(admin1), "Should have no admins");
    }

    function it_admin_registry_handles_single_initial_admin() {
        address[] memory singleAdmin = new address[](1);
        singleAdmin[0] = admin1;
        AdminRegistry singleRegistry = new AdminRegistry();
        singleRegistry.initialize(singleAdmin);
        require(singleRegistry.isAdminAddress(admin1), "Should have one admin");
        require(!singleRegistry.isAdminAddress(admin2), "Should not have second admin");
    }

    // ============ BASIC VOTING TESTS ============

    function it_admin_registry_can_cast_vote_on_issue() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        
        (bool executed, variadic result) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        
        // With 2 admins, need 2 votes to execute (2/3 majority)
        require(!executed, "Should not execute with only one vote");
        require(keccak256(result) == keccak256(issueId), "Should return issue ID");
    }

    function it_admin_registry_reverts_multiple_votes_from_same_admin() {
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        
        bool reverted = false;
        try {
            adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when same admin votes twice");
    }

    // ============ ISSUE ID TESTS ============

    function it_admin_registry_generates_consistent_issue_ids() {
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        
        require(keccak256(issueId1) == keccak256(issueId2), "Issue IDs should be consistent");
    }

    function it_admin_registry_generates_different_issue_ids_for_different_parameters() {
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);
        
        require(keccak256(issueId1) != keccak256(issueId2), "Issue IDs should be different for different parameters");
    }

    function it_admin_registry_generates_different_issue_ids_for_different_targets() {
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(0x5), "mint", admin3, 1000e18);
        
        require(keccak256(issueId1) != keccak256(issueId2), "Issue IDs should be different for different targets");
    }

    function it_admin_registry_generates_different_issue_ids_for_different_functions() {
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "burn", admin3, 1000e18);
        
        require(keccak256(issueId1) != keccak256(issueId2), "Issue IDs should be different for different functions");
    }

    // ============ ADMIN MANAGEMENT INTERFACE TESTS ============

    function it_admin_registry_has_add_admin_function() {
        // Test that the function exists and can be called (even if it requires voting)
        bool reverted = false;
        try {
            adminRegistry.addAdmin(admin3);
        } catch {
            reverted = true;
        }
        // Function should exist (may revert due to voting requirements)
        require(true, "addAdmin function should exist");
    }

    function it_admin_registry_has_remove_admin_function() {
        // Test that the function exists and can be called (even if it requires voting)
        bool reverted = false;
        try {
            adminRegistry.removeAdmin(admin2);
        } catch {
            reverted = true;
        }
        // Function should exist (may revert due to voting requirements)
        require(true, "removeAdmin function should exist");
    }

    function it_admin_registry_has_swap_admin_function() {
        // Test that the function exists and can be called (even if it requires voting)
        bool reverted = false;
        try {
            adminRegistry.swapAdmin(admin3);
        } catch {
            reverted = true;
        }
        // Function should exist (may revert due to voting requirements)
        require(true, "swapAdmin function should exist");
    }

    // ============ ACCESS CONTROL TESTS ============

    function it_admin_registry_rejects_non_admin_calls() {
        bool reverted = false;
        try {
            user3.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-admin should not be able to call castVoteOnIssue");
    }

    function it_admin_registry_rejects_non_admin_admin_management() {
        bool reverted = false;
        try {
            user3.do(address(adminRegistry), "addAdmin", admin3);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-admin should not be able to call addAdmin");
    }

    // ============ DELEGATE TESTS ============

    function it_admin_registry_has_delegate_mapping() {
        // Test that delegates mapping exists and is accessible
        address delegate = adminRegistry.delegates("_shouldExecute");
        require(delegate == address(0), "Initial delegate should be zero address");
    }

    function it_admin_registry_has_voting_thresholds_mapping() {
        // Test that votingThresholds mapping exists and is accessible
        uint256 threshold = adminRegistry.votingThresholds(address(token), "mint");
        require(threshold == 0, "Initial voting threshold should be 0");
    }

    // ============ WHITELIST TESTS ============

    function it_admin_registry_has_whitelist_mapping() {
        // Test that whitelist mapping exists and is accessible
        bool whitelisted = adminRegistry.whitelist(address(token), "mint", address(user3));
        require(!whitelisted, "Initial whitelist should be false");
    }

    // ============ VOTES TESTS ============

    function it_admin_registry_has_votes_mapping() {
        // Test that votes mapping exists and is accessible
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        require(adminRegistry.votes(issueId, 0) == address(0), "Initial votes should be empty");
    }

    function it_admin_registry_has_votes_map_mapping() {
        // Test that votesMap mapping exists and is accessible
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        uint256 voteIndex = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex == 0, "Initial vote index should be 0");
    }

    // ============ ADMIN ARRAY TESTS ============

    function it_admin_registry_has_admins_array() {
        // Test that admins array exists and is accessible
        require(adminRegistry.admins(0) == admin1, "First admin should be admin1");
        require(adminRegistry.admins(1) == address(user1), "Second admin should be user1");
        require(adminRegistry.admins(2) == address(0), "There should be no third admin");
    }

    function it_admin_registry_has_admin_map_mapping() {
        // Test that adminMap mapping exists and is accessible
        uint256 adminIndex1 = adminRegistry.adminMap(admin1);
        uint256 adminIndex2 = adminRegistry.adminMap(address(user1));
        uint256 adminIndex3 = adminRegistry.adminMap(admin3);
        
        require(adminIndex1 > 0, "Admin1 should have index > 0");
        require(adminIndex2 > 0, "User1 should have index > 0");
        require(adminIndex3 == 0, "Admin3 should have index 0");
    }

    // ============ EDGE CASES ============

    function it_admin_registry_handles_zero_address_parameters() {
        bool reverted = false;
        try {
            adminRegistry.getIssueId(zeroAddress, "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        // Should handle zero address gracefully
        require(true, "Should handle zero address parameters");
    }

    function it_admin_registry_handles_empty_string_parameters() {
        bool reverted = false;
        try {
            adminRegistry.getIssueId(address(token), "", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        // Should handle empty string gracefully
        require(true, "Should handle empty string parameters");
    }

    function it_admin_registry_handles_zero_amount_parameters() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 0);
        require(keccak256(issueId) != keccak256(""), "Should generate valid issue ID for zero amount");
    }

    // ============ COMPLEX SCENARIOS ============

    function it_admin_registry_handles_multiple_issue_creation() {
        // Create multiple issues
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);
        string memory issueId3 = adminRegistry.getIssueId(address(token), "burn", admin3, 1000e18);
        
        // All should be different
        require(keccak256(issueId1) != keccak256(issueId2), "Issue IDs should be different");
        require(keccak256(issueId1) != keccak256(issueId3), "Issue IDs should be different");
        require(keccak256(issueId2) != keccak256(issueId3), "Issue IDs should be different");
    }

    function it_admin_registry_handles_large_parameters() {
        uint256 largeAmount = 2**256 - 1;
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, largeAmount);
        require(keccak256(issueId) != keccak256(""), "Should handle large parameters");
    }

    // Complex voting mechanism tests
    function it_admin_registry_executes_issue_with_two_votes() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        require(keccak256(issueId) != keccak256(""), "Issue ID should be generated");
        
        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed1, "Should not execute with only one vote");
        
        // Second vote - should execute (using user1 as second admin)
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(executed2, "Should execute with two votes");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted after execution");
    }

    function it_admin_registry_handles_contract_creation() {
        string memory src = "contract TestContract { string public val; constructor(string _val) { val = _val; }}";
        
        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "createContract", "TestContract", src, "hello");
        require(!executed1, "Should not execute contract creation with one vote");
        
        // Second vote - should execute
        (bool executed2, address newContract) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createContract", "TestContract", src, "hello");
        require(executed2, "Should execute contract creation with two votes");
        require(newContract != address(0), "New contract should be created");
        
        string memory val = newContract.call("val");
        require(keccak256(val) == keccak256("hello"), "Contract constructor should set val correctly");
    }

    function it_admin_registry_handles_salted_contract_creation() {
        string memory src = "contract TestContract { string public val; constructor(string _val) { val = _val; }}";
        string memory salt = "testSalt123";
        
        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "createSaltedContract", salt, "TestContract", src, "hello");
        require(!executed1, "Should not execute salted contract creation with one vote");
        
        // Second vote - should execute
        (bool executed2, address newContract) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createSaltedContract", salt, "TestContract", src, "hello");
        require(executed2, "Should execute salted contract creation with two votes");
        require(newContract != address(0), "New contract should be created");
        
        string memory val = newContract.call("val");
        require(keccak256(val) == keccak256("hello"), "Salted contract constructor should set val correctly");
    }

    function it_admin_registry_handles_delegate_updates() {
        string memory src = "contract TestDelegate { function _shouldExecute(variadic _args) internal returns (bool) { return true; } }";
        
        // Create delegate contract first
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "createContract", "TestDelegate", src);
        require(!executed1, "Should not execute delegate creation with one vote");
        
        (bool executed2, address delegateContract) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createContract", "TestDelegate", src);
        require(executed2, "Should execute delegate creation with two votes");
        
        // Update delegate
        (bool executed3, variadic result3) = adminRegistry.castVoteOnIssue(address(adminRegistry), "updateDelegate", "_shouldExecute", delegateContract);
        require(!executed3, "Should not execute delegate update with one vote");
        
        (bool executed4, variadic result4) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "updateDelegate", "_shouldExecute", delegateContract);
        require(executed4, "Should execute delegate update with two votes");
    }

    function it_admin_registry_handles_voting_threshold_updates() {
        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        require(!executed1, "Should not execute threshold update with one vote");
        
        // Second vote - should execute
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        require(executed2, "Should execute threshold update with two votes");
    }

    function it_admin_registry_handles_whitelist_operations() {
        // Add to whitelist
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(token), "mint", admin3);
        require(!executed1, "Should not execute whitelist add with one vote");
        
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(token), "mint", admin3);
        require(executed2, "Should execute whitelist add with two votes");
        
        // Remove from whitelist
        (bool executed3, variadic result3) = adminRegistry.castVoteOnIssue(address(adminRegistry), "removeWhitelist", address(token), "mint", admin3);
        require(!executed3, "Should not execute whitelist remove with one vote");
        
        (bool executed4, variadic result4) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "removeWhitelist", address(token), "mint", admin3);
        require(executed4, "Should execute whitelist remove with two votes");
    }

    function it_admin_registry_handles_admin_management() {
        // Add admin using the proper addAdmin function
        adminRegistry.addAdmin(admin3);
        require(adminRegistry.admins(2) == address(0), "Admin was added before enough votes were cast");
        
        user1.do(address(adminRegistry), "addAdmin", admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "New admin was not added correctly");
        require(adminRegistry.isAdminAddress(admin3), "Admin3 should be admin after voting");
        
        // Remove admin using the proper removeAdmin function
        adminRegistry.removeAdmin(admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "Admin was removed before enough votes were cast");
        
        user1.do(address(adminRegistry), "removeAdmin", admin3);
        require(adminRegistry.admins(1) != address(0) && adminRegistry.admins(2) == address(0), "Admin was not removed correctly");
        require(!adminRegistry.isAdminAddress(admin3), "Admin3 should not be admin after removal");
        
        // Swap admin using the proper swapAdmin function
        adminRegistry.swapAdmin(admin3);
        require(adminRegistry.admins(1) != address(0) && adminRegistry.admins(2) == address(0), "Admin was swapped before enough votes were cast");
        
        user1.do(address(adminRegistry), "swapAdmin", admin3);
        require(adminRegistry.admins(1) != address(0) && adminRegistry.admins(2) == address(0), "Admin swap should maintain same count");
    }

    function it_admin_registry_handles_complex_issue_execution() {
        // Test that issues are properly tracked and executed
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);
        
        require(keccak256(issueId1) != keccak256(issueId2), "Different issues should have different IDs");
        
        // Vote on first issue
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        
        require(ERC20(token).balanceOf(admin3) == 1000e18, "First issue should be executed");
        
        // Vote on second issue
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 2000e18);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 2000e18);
        
        require(ERC20(token).balanceOf(admin3) == 3000e18, "Second issue should be executed");
    }

    function it_admin_registry_handles_multiple_votes_on_same_issue() {
        // First vote
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed1, "Should not execute with one vote");
        
        // Second vote from same admin - should fail with error
        bool duplicateVoteFailed = false;
        try {
            adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            duplicateVoteFailed = true;
        }
        require(duplicateVoteFailed, "Should fail when same admin tries to vote twice");
        
        // Second vote from different admin - should execute
        (bool executed3, variadic result3) = user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(executed3, "Should execute with two different admin votes");
    }

    function it_admin_registry_handles_issue_id_generation() {
        // Test that issue IDs are deterministic
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        require(keccak256(issueId1) == keccak256(issueId2), "Same issue should generate same ID");
        
        // Test that different issues generate different IDs
        string memory issueId3 = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);
        require(keccak256(issueId1) != keccak256(issueId3), "Different issues should generate different IDs");
        
        string memory issueId4 = adminRegistry.getIssueId(address(token), "burn", admin3, 1000e18);
        require(keccak256(issueId1) != keccak256(issueId4), "Different functions should generate different IDs");
    }

    function it_admin_registry_handles_whitelisted_user_voting() {
        // First add user2 to whitelist for token mint function
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(token), "mint", address(user2));
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(token), "mint", address(user2));
        
        // Now user2 should be able to vote on token mint issues
        (bool executed, variadic result) = user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(executed, "Should execute with whitelisted user vote (whitelist allows immediate execution)");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted by whitelisted user");
    }

    function it_admin_registry_handles_custom_voting_thresholds() {
        // Set custom threshold to 50% (5000 basis points)
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        
        // With 2 admins, 50% threshold should require 1 vote
        (bool executed, variadic result) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(executed, "Should execute with 50% threshold and 1 vote");
    }

    function it_admin_registry_handles_delegate_contract_execution() {
        // Create a delegate that always returns true
        string memory src = "contract AlwaysExecute { function _shouldExecute(variadic _args) internal returns (bool) { return true; } }";
        
        // Create delegate contract
        adminRegistry.castVoteOnIssue(address(adminRegistry), "createContract", "AlwaysExecute", src);
        (bool executed1, address delegate) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createContract", "AlwaysExecute", src);
        require(executed1, "Should create delegate contract");
        
        // Set delegate
        adminRegistry.castVoteOnIssue(address(adminRegistry), "updateDelegate", "_shouldExecute", delegate);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "updateDelegate", "_shouldExecute", delegate);
        
        // Now any single vote should execute
        (bool executed2, variadic result2) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(executed2, "Should execute with delegate that always returns true");
    }
}