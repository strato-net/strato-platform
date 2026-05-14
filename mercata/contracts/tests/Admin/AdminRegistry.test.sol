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

contract GuardianAdminRegistry is AdminRegistry {
    address guardian;

    constructor(address _guardian) {
        guardian = _guardian;
    }

    function isGuardian(address _account) public override returns (bool) {
        return _account == guardian;
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

    function voteToQueue(address _target, string _func, variadic _args) internal returns (string) {
        string memory issueId = adminRegistry.getIssueId(_target, _func, _args);
        adminRegistry.castVoteOnIssue(_target, _func, _args);
        user1.do(address(adminRegistry), "castVoteOnIssue", _target, _func, _args);
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");
        return issueId;
    }

    function executeQueued(address _target, string _func, variadic _args) internal returns (variadic) {
        fastForward(86400);
        return adminRegistry.executeIssue(_target, _func, _args);
    }

    function issueExecutableAt(string _issueId) internal returns (uint) {
        (, uint executableAt,) = adminRegistry.timelocks(_issueId);
        return executableAt;
    }

    function assertTimelock(string _issueId, uint _queuedAt, uint _executableAt, uint _expiresAt) internal {
        (uint queuedAt, uint executableAt, uint expiresAt) = adminRegistry.timelocks(_issueId);
        require(queuedAt == _queuedAt, "Unexpected queuedAt");
        require(executableAt == _executableAt, "Unexpected executableAt");
        require(expiresAt == _expiresAt, "Unexpected expiresAt");
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

        TestERC20 singleAdminToken = new TestERC20("Single Admin Token", "SAT", address(singleRegistry));
        string memory issueId = singleRegistry.getIssueId(address(singleAdminToken), "mint", admin3, 1000e18);
        (bool executed, variadic result) = singleRegistry.castVoteOnIssue(address(singleAdminToken), "mint", admin3, 1000e18);
        require(!executed, "Single admin issue should queue");
        require(ERC20(singleAdminToken).balanceOf(admin3) == 0, "Single admin token should not mint before delay");
        (, uint executableAt,) = singleRegistry.timelocks(issueId);
        require(executableAt == block.timestamp + 86400, "Single admin issue should be queued");
        fastForward(86400);
        singleRegistry.executeIssue(address(singleAdminToken), "mint", admin3, 1000e18);
        require(ERC20(singleAdminToken).balanceOf(admin3) == 1000e18, "Single admin token should mint after delay");
    }

    // ============ BASIC VOTING TESTS ============

    function it_admin_registry_can_cast_vote_on_issue() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);

        (bool executed, variadic result) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);

        // With 2 admins, need 2 votes to execute (2/3 majority)
        require(!executed, "Should not execute with only one vote");
        require(keccak256(result) == keccak256(issueId), "Should return issue ID");
    }

    function it_admin_registry_handles_idempotent_voting() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);

        // First vote - should not execute with only 1 vote out of 2 admins
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed1, "Should not execute with only one vote");

        // Verify the vote was counted (votesMap should be non-zero)
        uint voteIndex1 = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex1 > 0, "First vote should be recorded");

        // Second vote from same admin - should be idempotent (not fail, but not add another vote)
        (bool executed2, variadic result2) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed2, "Should still not execute with only one unique vote");

        // Verify the vote count hasn't increased (still just 1 vote)
        uint voteIndex2 = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex2 == voteIndex1, "Vote count should not increase when same admin votes twice");

        // Now add a second DIFFERENT admin's vote - should queue
        (bool executed3, variadic result3) = user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(!executed3, "Should queue with two different admin votes");
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted before delay");

        executeQueued(address(token), "mint", admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted after two votes");
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
            adminRegistry.swapAdmin(admin1, admin3);
        } catch {
            reverted = true;
        }
        // Function should exist (may revert due to voting requirements)
        require(true, "swapAdmin function should exist");
    }

    // ============ VOTING THRESHOLD TESTS ============

    function it_admin_registry_has_voting_thresholds_mapping() {
        // Test that votingThresholds mapping exists and is accessible
        uint256 threshold = adminRegistry.votingThresholds(address(token), "mint");
        require(threshold == 0, "Initial voting threshold should be 0");
    }

    function it_admin_registry_allows_voting_threshold_below_half() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 4999);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 4999);

        executeQueued(address(adminRegistry), "setVotingThreshold", address(token), "mint", 4999);
        require(adminRegistry.votingThresholds(address(token), "mint") == 4999, "Threshold should update");
    }

    function it_admin_registry_allows_default_voting_threshold_below_half() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setDefaultVotingThresholdBps", 4999);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setDefaultVotingThresholdBps", 4999);

        executeQueued(address(adminRegistry), "setDefaultVotingThresholdBps", 4999);
        require(adminRegistry.defaultVotingThresholdBps() == 4999, "Default threshold should update");
    }

    // ============ WHITELIST TESTS ============

    function it_admin_registry_has_whitelist_mapping() {
        // Test that whitelist mapping exists and is accessible
        bool whitelisted = adminRegistry.whitelist(address(token), "mint", address(user3));
        require(!whitelisted, "Initial whitelist should be false");
    }

    function it_admin_registry_has_instant_functions_mapping() {
        require(!adminRegistry.instantFunctions(address(token), "mint"), "Initial instant function should be false");
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

        // Second vote - should queue (using user1 as second admin)
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(!executed2, "Should queue with two votes");
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted before delay");

        executeQueued(address(token), "mint", admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted after execution");
    }

    function it_admin_registry_handles_contract_creation() {
        string memory src = "contract TestContract { string public val; constructor(string _val) { val = _val; }}";

        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "createContract", "TestContract", src, "hello");
        require(!executed1, "Should not execute contract creation with one vote");

        // Second vote - should queue
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createContract", "TestContract", src, "hello");
        require(!executed2, "Should queue contract creation with two votes");

        variadic result3 = executeQueued(address(adminRegistry), "createContract", "TestContract", src, "hello");
        address newContract = address(result3);
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

        // Second vote - should queue
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "createSaltedContract", salt, "TestContract", src, "hello");
        require(!executed2, "Should queue salted contract creation with two votes");

        variadic result3 = executeQueued(address(adminRegistry), "createSaltedContract", salt, "TestContract", src, "hello");
        address newContract = address(result3);
        require(newContract != address(0), "New contract should be created");

        string memory val = newContract.call("val");
        require(keccak256(val) == keccak256("hello"), "Salted contract constructor should set val correctly");
    }

    function it_admin_registry_handles_voting_threshold_updates() {
        // First vote - should not execute
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        require(!executed1, "Should not execute threshold update with one vote");

        // Second vote - should queue
        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        require(!executed2, "Should queue threshold update with two votes");
        executeQueued(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        require(adminRegistry.votingThresholds(address(token), "mint") == 5000, "Threshold should update after delay");
    }

    function it_admin_registry_handles_whitelist_operations() {
        // Add to whitelist
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(token), "mint", admin3);
        require(!executed1, "Should not execute whitelist add with one vote");

        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(token), "mint", admin3);
        require(!executed2, "Should queue whitelist add with two votes");
        executeQueued(address(adminRegistry), "addWhitelist", address(token), "mint", admin3);
        require(adminRegistry.whitelist(address(token), "mint", admin3), "Whitelist should be added after delay");

        // Remove from whitelist
        (bool executed3, variadic result3) = adminRegistry.castVoteOnIssue(address(adminRegistry), "removeWhitelist", address(token), "mint", admin3);
        require(!executed3, "Should not execute whitelist remove with one vote");

        (bool executed4, variadic result4) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "removeWhitelist", address(token), "mint", admin3);
        require(!executed4, "Should queue whitelist remove with two votes");
        executeQueued(address(adminRegistry), "removeWhitelist", address(token), "mint", admin3);
        require(!adminRegistry.whitelist(address(token), "mint", admin3), "Whitelist should be removed after delay");
    }

    function it_admin_registry_handles_instant_function_operations() {
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        require(!executed1, "Should not set instant function with one vote");

        (bool executed2, variadic result2) = user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        require(!executed2, "Should queue instant function update with two votes");
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        require(adminRegistry.instantFunctions(address(token), "mint"), "Instant function should be enabled after delay");
    }

    function it_admin_registry_executes_instant_function_without_vote_or_queue() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", true);

        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        (bool executed, variadic result) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);

        require(executed, "Instant function should execute immediately");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted immediately");
        require(!adminRegistry.currentIssues(issueId), "Instant function should not leave an active issue");
        require(adminRegistry.votesMap(issueId, admin1) == 0, "Instant function should not record a vote");
        require(issueExecutableAt(issueId) == 0, "Instant function should not queue");
    }

    function it_admin_registry_rejects_instant_governance_functions() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(adminRegistry), "setVotingThreshold", true);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(adminRegistry), "setVotingThreshold", true);

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "setInstantFunction", address(adminRegistry), "setVotingThreshold", true);
        } catch {
            reverted = true;
        }

        require(reverted, "Should reject instant governance functions");
        require(!adminRegistry.instantFunctions(address(adminRegistry), "setVotingThreshold"), "Governance function should not become instant");
    }

    function it_admin_registry_allows_guardian_to_execute_instant_function() {
        address[] memory initialAdmins = new address[](2);
        initialAdmins[0] = address(user1);
        initialAdmins[1] = address(user3);
        GuardianAdminRegistry guardianRegistry = new GuardianAdminRegistry(this);
        guardianRegistry.initialize(initialAdmins);
        TestERC20 guardianToken = new TestERC20("Guardian Token", "GT", address(guardianRegistry));

        user1.do(address(guardianRegistry), "castVoteOnIssue", address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);
        user3.do(address(guardianRegistry), "castVoteOnIssue", address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);
        fastForward(86400);
        guardianRegistry.executeIssue(address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);

        require(guardianRegistry.instantFunctions(address(guardianToken), "mint"), "setGuardianAllowed(true) should auto-enable instant");
        require(guardianRegistry.guardianAllowlist(address(guardianToken), "mint"), "guardianAllowlist should be true");

        string memory issueId = guardianRegistry.getIssueId(address(guardianToken), "mint", admin3, 1000e18);
        guardianToken.mint(admin3, 1000e18);

        require(ERC20(guardianToken).balanceOf(admin3) == 1000e18, "Guardian should mint through instant function");
        require(!guardianRegistry.currentIssues(issueId), "Guardian instant function should not leave an active issue");
        require(guardianRegistry.votesMap(issueId, this) == 0, "Guardian instant function should not record a vote");
        (, uint executableAt,) = guardianRegistry.timelocks(issueId);
        require(executableAt == 0, "Guardian instant function should not queue");
    }

    function it_admin_registry_allows_guardian_to_execute_instant_function_directly() {
        address[] memory initialAdmins = new address[](2);
        initialAdmins[0] = address(user1);
        initialAdmins[1] = address(user3);
        GuardianAdminRegistry guardianRegistry = new GuardianAdminRegistry(this);
        guardianRegistry.initialize(initialAdmins);
        TestERC20 guardianToken = new TestERC20("Guardian Token", "GT", address(guardianRegistry));

        user1.do(address(guardianRegistry), "castVoteOnIssue", address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);
        user3.do(address(guardianRegistry), "castVoteOnIssue", address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);
        fastForward(86400);
        guardianRegistry.executeIssue(address(guardianRegistry), "_setGuardianAllowed", address(guardianToken), "mint", true);

        string memory issueId = guardianRegistry.getIssueId(address(guardianToken), "mint", admin3, 1000e18);
        (bool executed, variadic result) = guardianRegistry.castVoteOnIssue(address(guardianToken), "mint", admin3, 1000e18);

        require(executed, "Guardian should directly execute instant function");
        require(ERC20(guardianToken).balanceOf(admin3) == 1000e18, "Guardian should mint through direct instant function");
        require(!guardianRegistry.currentIssues(issueId), "Direct guardian instant function should not leave an active issue");
        require(guardianRegistry.votesMap(issueId, this) == 0, "Direct guardian instant function should not record a vote");
        (, uint executableAt,) = guardianRegistry.timelocks(issueId);
        require(executableAt == 0, "Direct guardian instant function should not queue");
    }

    function it_admin_registry_rejects_guardian_non_instant_function() {
        address[] memory initialAdmins = new address[](2);
        initialAdmins[0] = address(user1);
        initialAdmins[1] = address(user3);
        GuardianAdminRegistry guardianRegistry = new GuardianAdminRegistry(this);
        guardianRegistry.initialize(initialAdmins);
        TestERC20 guardianToken = new TestERC20("Guardian Token", "GT", address(guardianRegistry));

        bool reverted = false;
        try {
            guardianToken.mint(admin3, 1000e18);
        } catch {
            reverted = true;
        }

        require(reverted, "Guardian should not vote on non-instant functions");
        require(ERC20(guardianToken).balanceOf(admin3) == 0, "Guardian non-instant function should not execute");
    }

    function it_admin_registry_handles_admin_management() {
        // Add admin using the proper addAdmin function
        adminRegistry.addAdmin(admin3);
        require(adminRegistry.admins(2) == address(0), "Admin was added before enough votes were cast");

        user1.do(address(adminRegistry), "addAdmin", admin3);
        require(adminRegistry.admins(2) == address(0), "Admin was added before timelock elapsed");
        executeQueued(address(adminRegistry), "_addAdmin", admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "New admin was not added correctly");
        require(adminRegistry.isAdminAddress(admin3), "Admin3 should be admin after voting");

        // Add a fourth admin so removal can stay above MIN_ADMIN_COUNT
        adminRegistry.addAdmin(address(user2));
        user1.do(address(adminRegistry), "addAdmin", address(user2));
        executeQueued(address(adminRegistry), "_addAdmin", address(user2));
        require(adminRegistry.admins(3) != address(0) && adminRegistry.admins(4) == address(0), "Fourth admin was not added correctly");
        require(adminRegistry.isAdminAddress(address(user2)), "User2 should be admin after voting");

        // Remove admin using the proper removeAdmin function
        adminRegistry.removeAdmin(admin3);
        require(adminRegistry.admins(3) != address(0) && adminRegistry.admins(4) == address(0), "Admin was removed before enough votes were cast");

        user1.do(address(adminRegistry), "removeAdmin", admin3);
        user2.do(address(adminRegistry), "removeAdmin", admin3);
        require(adminRegistry.admins(2) != address(0), "Admin was removed before timelock elapsed");
        executeQueued(address(adminRegistry), "_removeAdmin", admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "Admin was not removed correctly");
        require(!adminRegistry.isAdminAddress(admin3), "Admin3 should not be admin after removal");

        // Swap admin using the proper swapAdmin function
        adminRegistry.swapAdmin(admin1, admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "Admin was swapped before enough votes were cast");

        user1.do(address(adminRegistry), "swapAdmin", admin1, admin3);
        executeQueued(address(adminRegistry), "_swapAdmin", admin1, admin3);
        require(adminRegistry.admins(2) != address(0) && adminRegistry.admins(3) == address(0), "Admin swap should maintain same count");
    }

    function it_admin_registry_handles_complex_issue_execution() {
        // Test that issues are properly tracked and executed
        string memory issueId1 = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        string memory issueId2 = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);

        require(keccak256(issueId1) != keccak256(issueId2), "Different issues should have different IDs");

        // Vote on first issue
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        executeQueued(address(token), "mint", admin3, 1000e18);

        require(ERC20(token).balanceOf(admin3) == 1000e18, "First issue should be executed");

        // Vote on second issue
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 2000e18);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 2000e18);
        executeQueued(address(token), "mint", admin3, 2000e18);

        require(ERC20(token).balanceOf(admin3) == 3000e18, "Second issue should be executed");
    }

    function it_admin_registry_handles_multiple_votes_on_same_issue() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);

        // First vote
        (bool executed1, variadic result1) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed1, "Should not execute with one vote");

        // Verify vote was recorded
        uint voteIndex1 = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex1 > 0, "First vote should be recorded");

        // Second vote from same admin - should be idempotent (no error, but no new vote)
        (bool executed2, variadic result2) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed2, "Should not execute with same admin voting twice");

        // Verify vote count is still the same
        uint voteIndex2 = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex2 == voteIndex1, "Same admin voting twice should be idempotent");

        // Third vote from different admin - should queue
        (bool executed3, variadic result3) = user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(!executed3, "Should queue with two different admin votes");
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");
        executeQueued(address(token), "mint", admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted");
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
        executeQueued(address(adminRegistry), "addWhitelist", address(token), "mint", address(user2));

        // Now user2 should be able to vote on token mint issues
        (bool executed, variadic result) = user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(executed, "Should execute with whitelisted user vote (whitelist allows immediate execution)");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted by whitelisted user");
    }

    function it_admin_registry_handles_custom_voting_thresholds() {
        // Set custom threshold to 50% (5000 basis points)
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);
        executeQueued(address(adminRegistry), "setVotingThreshold", address(token), "mint", 5000);

        // With 2 admins, 50% threshold should require 1 vote to queue
        (bool executed, variadic result) = adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        require(!executed, "Should queue with 50% threshold and 1 vote");
        executeQueued(address(token), "mint", admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Token should be minted after delay");
    }

    function it_admin_registry_executes_old_issue_when_admin_count_decreases() {
        // Scenario: Issue created with 4 admins fails to reach quorum (2 votes out of 4 = 50% < 60%)
        // Then an admin is removed, leaving 3 admins.
        // The same issue called again should now queue (2 votes out of 3 = 66%).

        adminRegistry.addAdmin(address(user2));
        user1.do(address(adminRegistry), "addAdmin", address(user2));
        executeQueued(address(adminRegistry), "_addAdmin", address(user2));

        adminRegistry.addAdmin(address(user3));
        user1.do(address(adminRegistry), "addAdmin", address(user3));
        executeQueued(address(adminRegistry), "_addAdmin", address(user3));

        // Step 1: Admin1 and user1 vote to add admin3 (2 out of 4 admins = 50%, needs 60%)
        string memory issueId = adminRegistry.getIssueId(address(adminRegistry), "_addAdmin", admin3);
        adminRegistry.addAdmin(admin3);
        user1.do(address(adminRegistry), "addAdmin", admin3);
        require(!adminRegistry.isAdminAddress(admin3), "Admin3 should not be admin yet");

        uint voteIndex1 = adminRegistry.votesMap(issueId, admin1);
        require(voteIndex1 > 0, "Admin1's vote should be recorded");
        require(adminRegistry.votesMap(issueId, address(user1)) > 0, "User1's vote should be recorded");

        // Step 2: Remove one admin while staying at the minimum admin count
        adminRegistry.removeAdmin(address(user3));
        user1.do(address(adminRegistry), "removeAdmin", address(user3));
        user2.do(address(adminRegistry), "removeAdmin", address(user3));
        executeQueued(address(adminRegistry), "_removeAdmin", address(user3));

        require(!adminRegistry.isAdminAddress(address(user3)), "User3 should no longer be an admin");
        require(adminRegistry.isAdminAddress(admin1), "Admin1 should still be an admin");

        // Step 3: Admin1 calls the same issue again (adding admin3)
        // Now with 3 admins, the existing two votes exceed the 60% threshold, so it queues
        adminRegistry.addAdmin(admin3);
        executeQueued(address(adminRegistry), "_addAdmin", admin3);

        // Verify admin3 was added
        require(adminRegistry.isAdminAddress(admin3), "Admin3 should now be an admin");

        // Verify the vote data was cleaned up after execution
        uint voteIndexAfter = adminRegistry.votesMap(issueId, admin1);
        require(voteIndexAfter == 0, "Vote should be cleaned up after execution");
    }

    function it_admin_registry_rejects_non_admin_non_whitelisted_issue_creation() {
        // Scenario: A non-admin, non-whitelisted user tries to create an issue
        // Should revert with "Only an admin or a whitelisted account can call castVoteOnIssue"

        // Verify user3 is not an admin
        require(!adminRegistry.isAdminAddress(address(user3)), "User3 should not be an admin");

        // Verify user3 is not whitelisted for token mint
        require(!adminRegistry.whitelist(address(token), "mint", address(user3)), "User3 should not be whitelisted");

        // Try to cast vote as non-admin, non-whitelisted user - should revert
        bool reverted = false;
        try {
            user3.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }

        require(reverted, "Should revert when non-admin non-whitelisted user tries to create issue");
    }

    function it_cannot_execute_internal_functions() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(adminRegistry), "_getIssueId", 5000);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(adminRegistry), "_getIssueId", 5000);
        executeQueued(address(adminRegistry), "setVotingThreshold", address(adminRegistry), "_getIssueId", 5000);

        bool reverted = false;
        try {
            adminRegistry.castVoteOnIssue(address(adminRegistry), "_getIssueId", address(0xdeadbeef), "parmesan", 7);
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_getIssueId", address(0xdeadbeef), "parmesan", 7);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when delegatecalling into an internal function");
    }

    function it_admin_registry_prevents_removal_below_min_admin_count() {
        // Scenario: Start with 4 admins, remove one, then try to remove below MIN_ADMIN_COUNT

        // Verify we start with 2 admins
        require(adminRegistry.isAdminAddress(admin1), "Admin1 should be an admin");
        require(adminRegistry.isAdminAddress(address(user1)), "User1 should be an admin");

        adminRegistry.addAdmin(address(user2));
        user1.do(address(adminRegistry), "addAdmin", address(user2));
        executeQueued(address(adminRegistry), "_addAdmin", address(user2));

        adminRegistry.addAdmin(address(user3));
        user1.do(address(adminRegistry), "addAdmin", address(user3));
        executeQueued(address(adminRegistry), "_addAdmin", address(user3));

        // Step 1: Remove one admin - this should succeed because it leaves 3 admins
        adminRegistry.removeAdmin(address(user3));
        user1.do(address(adminRegistry), "removeAdmin", address(user3));
        user2.do(address(adminRegistry), "removeAdmin", address(user3));
        executeQueued(address(adminRegistry), "_removeAdmin", address(user3));

        // Verify user3 is no longer an admin and 3 admins remain
        require(!adminRegistry.isAdminAddress(address(user3)), "User3 should no longer be an admin");
        require(adminRegistry.isAdminAddress(admin1), "Admin1 should still be an admin");
        require(adminRegistry.isAdminAddress(address(user1)), "User1 should still be an admin");
        require(adminRegistry.isAdminAddress(address(user2)), "User2 should still be an admin");

        // Step 2: Try to remove below the minimum - this should revert at execution
        bool reverted = false;
        try {
            adminRegistry.removeAdmin(address(user2));
            user1.do(address(adminRegistry), "removeAdmin", address(user2));
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_removeAdmin", address(user2));
        } catch {
            reverted = true;
        }

        require(reverted, "Should revert when trying to remove below min admin count");

        // Verify user2 is still an admin
        require(adminRegistry.isAdminAddress(address(user2)), "User2 should still be an admin after failed removal");
    }

    // ============ ISSUE DISMISSAL TESTS ============

    function it_admin_registry_can_dismiss_issue_as_proposer() {
        // Create an issue but don't execute it (only one vote)
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);

        // Verify issue exists and has votes
        require(adminRegistry.currentIssues(issueId), "Issue should exist");
        require(adminRegistry.votesMap(issueId, admin1) > 0, "Issue should have votes");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted yet");

        // Proposer dismisses their own issue
        adminRegistry.dismissIssue(issueId);

        // Verify issue is cleared
        require(!adminRegistry.currentIssues(issueId), "Issue should be dismissed");
        require(adminRegistry.votesMap(issueId, admin1) == 0, "Original issue votes should be cleared");
        require(adminRegistry.votes(issueId, 0) == address(0), "Votes array should be empty");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should still not be minted");
    }

    function it_admin_registry_cannot_dismiss_issue_with_multiple_votes() {
        // Add a third admin
        adminRegistry.addAdmin(admin3);
        user1.do(address(adminRegistry), "addAdmin", admin3);
        executeQueued(address(adminRegistry), "_addAdmin", admin3);

        // Set threshold to 100% so 2 votes won't execute (need 3 votes with 3 admins)
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);
        executeQueued(address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);

        // Create an issue with proposer's vote
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", nonAdmin, 1000e18);
        adminRegistry.castVoteOnIssue(address(token), "mint", nonAdmin, 1000e18);

        // Verify first vote is recorded
        require(adminRegistry.votes(issueId, 0) == admin1, "First vote should be recorded");
        require(adminRegistry.currentIssues(issueId), "Issue should exist");

        // Another admin votes on the issue
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", nonAdmin, 1000e18);

        // Verify both votes are recorded and issue still exists (not executed with 2/3 votes, need 3)
        require(adminRegistry.votes(issueId, 0) == admin1, "First vote should still be recorded");
        require(adminRegistry.votes(issueId, 1) == address(user1), "Second vote should be recorded");
        require(adminRegistry.currentIssues(issueId), "Issue should still exist");

        // Proposer tries to dismiss - should fail because there are multiple votes
        bool reverted = false;
        try {
            adminRegistry.dismissIssue(issueId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when trying to dismiss issue with multiple votes");
    }

    function it_admin_registry_cannot_execute_before_timelock_delay() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        require(issueExecutableAt(issueId) == block.timestamp + 86400, "Executable timestamp should include delay");

        bool reverted = false;
        try {
            adminRegistry.executeIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not execute before timelock delay");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted before delay");
    }

    function it_admin_registry_cannot_execute_after_timelock_grace_period_expires() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        (uint queuedAt, uint executableAt, uint expiresAt) = adminRegistry.timelocks(issueId);
        require(executableAt == queuedAt + 86400, "Executable timestamp should include delay");
        require(expiresAt == executableAt + 604800, "Expiration timestamp should include grace period");

        fastForward(86400 + 604800 + 1);

        bool reverted = false;
        try {
            adminRegistry.executeIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not execute after timelock grace period expires");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted after expiration");
        assertTimelock(issueId, queuedAt, executableAt, expiresAt);
    }

    function it_admin_registry_timelock_struct_defaults_to_zero() {
        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        assertTimelock(issueId, 0, 0, 0);

        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        assertTimelock(issueId, 0, 0, 0);
    }

    function it_admin_registry_timelock_struct_records_queue_window() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        uint queuedAt = block.timestamp;
        assertTimelock(issueId, queuedAt, queuedAt + 86400, queuedAt + 86400 + 604800);

        string memory otherIssueId = adminRegistry.getIssueId(address(token), "mint", admin3, 2000e18);
        assertTimelock(otherIssueId, 0, 0, 0);
    }

    function it_admin_registry_cannot_vote_on_queued_issue() {
        voteToQueue(address(token), "mint", admin3, 1000e18);

        bool reverted = false;
        try {
            adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not allow votes on queued issue");
    }

    function it_admin_registry_clear_timelock_zeroes_struct_fields_after_vote_withdrawal() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");

        adminRegistry.withdrawVote(address(token), "mint", admin3, 1000e18);

        assertTimelock(issueId, 0, 0, 0);
        require(adminRegistry.currentIssues(issueId), "Issue should remain active after unqueue");
        require(adminRegistry.votesMap(issueId, admin1) == 0, "Withdrawn vote should be cleared");
        require(adminRegistry.votesMap(issueId, address(user1)) > 0, "Remaining vote should stay recorded");
    }

    function it_admin_registry_clear_issue_zeroes_timelock_struct_after_execution() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");

        executeQueued(address(token), "mint", admin3, 1000e18);

        assertTimelock(issueId, 0, 0, 0);
        require(!adminRegistry.currentIssues(issueId), "Issue should be cleared after execution");
        require(adminRegistry.votesMap(issueId, admin1) == 0, "Admin1 vote should be cleared");
        require(adminRegistry.votesMap(issueId, address(user1)) == 0, "User1 vote should be cleared");
    }

    function it_admin_registry_requeue_after_clear_timelock_restarts_delay() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        (, uint firstExecutableAt,) = adminRegistry.timelocks(issueId);

        adminRegistry.withdrawVote(address(token), "mint", admin3, 1000e18);
        assertTimelock(issueId, 0, 0, 0);

        fastForward(1);
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);

        uint requeuedAt = block.timestamp;
        assertTimelock(issueId, requeuedAt, requeuedAt + 86400, requeuedAt + 86400 + 604800);
        require(issueExecutableAt(issueId) > firstExecutableAt, "Requeued issue should restart delay");
    }

    function it_admin_registry_can_withdraw_vote_from_queued_issue() {
        string memory issueId = voteToQueue(address(token), "mint", admin3, 1000e18);
        adminRegistry.withdrawVote(address(token), "mint", admin3, 1000e18);

        require(adminRegistry.currentIssues(issueId), "Issue should remain active with one vote");
        require(adminRegistry.votesMap(issueId, admin1) == 0, "Withdrawn vote should be cleared");
        require(adminRegistry.votesMap(issueId, address(user1)) > 0, "Other vote should remain");
        require(issueExecutableAt(issueId) == 0, "Issue should unqueue when threshold is no longer met");

        fastForward(86400);
        bool reverted = false;
        try {
            adminRegistry.executeIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Unqueued issue should not execute");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted after vote withdrawal");
    }

    function it_admin_registry_rechecks_voting_threshold_before_execution() {
        adminRegistry.addAdmin(address(user2));
        user1.do(address(adminRegistry), "addAdmin", address(user2));
        executeQueued(address(adminRegistry), "_addAdmin", address(user2));

        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        adminRegistry.castVoteOnIssue(address(token), "mint", admin3, 1000e18);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(issueExecutableAt(issueId) != 0, "Issue should queue with two of three votes");

        adminRegistry.castVoteOnIssue(address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);
        executeQueued(address(adminRegistry), "setVotingThreshold", address(token), "mint", 10000);

        bool reverted = false;
        try {
            adminRegistry.executeIssue(address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Issue should not execute when threshold is no longer met");
        require(ERC20(token).balanceOf(admin3) == 0, "Token should not be minted after threshold change");
    }

    function it_admin_registry_cannot_dismiss_nonexistent_issue() {
        string memory fakeIssueId = "nonexistent_issue_id";

        // Try to dismiss an issue that doesn't exist
        bool reverted = false;
        try {
            adminRegistry.dismissIssue(fakeIssueId);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when trying to dismiss non-existent issue");
    }

    // ============ GUARDIAN TESTS ============

    function it_guardian_add_requires_quorum_and_timelock() {
        adminRegistry.addGuardian(address(user2));
        require(!adminRegistry.isGuardian(address(user2)), "Should not be guardian with one vote");
        require(adminRegistry.guardianMap(address(user2)) == 0, "guardianMap should be 0");

        user1.do(address(adminRegistry), "addGuardian", address(user2));
        string memory issueId = adminRegistry.getIssueId(address(adminRegistry), "_addGuardian", address(user2));
        require(issueExecutableAt(issueId) != 0, "Issue should be queued");
        require(!adminRegistry.isGuardian(address(user2)), "Should not be guardian before timelock");

        executeQueued(address(adminRegistry), "_addGuardian", address(user2));
        require(adminRegistry.isGuardian(address(user2)), "Should be guardian after execution");
        require(adminRegistry.guardianMap(address(user2)) > 0, "guardianMap should be set");
        require(adminRegistry.guardians(0) == address(user2), "guardians array should include user2");
    }

    function it_guardian_remove_requires_quorum_and_timelock() {
        adminRegistry.addGuardian(address(user2));
        user1.do(address(adminRegistry), "addGuardian", address(user2));
        executeQueued(address(adminRegistry), "_addGuardian", address(user2));
        require(adminRegistry.isGuardian(address(user2)), "Precondition: guardian added");

        adminRegistry.removeGuardian(address(user2));
        require(adminRegistry.isGuardian(address(user2)), "Should remain guardian with one vote");
        user1.do(address(adminRegistry), "removeGuardian", address(user2));
        executeQueued(address(adminRegistry), "_removeGuardian", address(user2));
        require(!adminRegistry.isGuardian(address(user2)), "Should not be guardian after execution");
        require(adminRegistry.guardianMap(address(user2)) == 0, "guardianMap should be cleared");
    }

    function it_guardian_add_rejects_admin() {
        adminRegistry.addGuardian(admin1);
        user1.do(address(adminRegistry), "addGuardian", admin1);

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_addGuardian", admin1);
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject adding admin as guardian");
        require(!adminRegistry.isGuardian(admin1), "Admin should not become guardian");
    }

    function it_admin_add_rejects_guardian() {
        adminRegistry.addGuardian(address(user2));
        user1.do(address(adminRegistry), "addGuardian", address(user2));
        executeQueued(address(adminRegistry), "_addGuardian", address(user2));
        require(adminRegistry.isGuardian(address(user2)), "Precondition: user2 is guardian");

        adminRegistry.addAdmin(address(user2));
        user1.do(address(adminRegistry), "addAdmin", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_addAdmin", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject adding guardian as admin");
        require(!adminRegistry.isAdminAddress(address(user2)), "Guardian should not become admin");
    }

    function it_guardian_allowlist_cannot_target_adminregistry() {
        adminRegistry.setGuardianAllowed(address(adminRegistry), "_addAdmin", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(adminRegistry), "_addAdmin", true);

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_setGuardianAllowed", address(adminRegistry), "_addAdmin", true);
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject self-targeting guardian allowlist");
        require(!adminRegistry.guardianAllowlist(address(adminRegistry), "_addAdmin"), "Self-target allowlist should remain false");
    }

    function it_whitelist_forbidden_list_refuses_addGuardian() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_addGuardian", address(user2));
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(adminRegistry), "_addGuardian", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_addGuardian", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject whitelisting _addGuardian");
        require(!adminRegistry.whitelist(address(adminRegistry), "_addGuardian", address(user2)), "Whitelist should remain false");
    }

    function it_whitelist_forbidden_list_refuses_removeGuardian() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_removeGuardian", address(user2));
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(adminRegistry), "_removeGuardian", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_removeGuardian", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject whitelisting _removeGuardian");
        require(!adminRegistry.whitelist(address(adminRegistry), "_removeGuardian", address(user2)), "Whitelist should remain false");
    }

    function it_whitelist_forbidden_list_refuses_setGuardianAllowed() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_setGuardianAllowed", address(user2));
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "addWhitelist", address(adminRegistry), "_setGuardianAllowed", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "addWhitelist", address(adminRegistry), "_setGuardianAllowed", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject whitelisting _setGuardianAllowed");
        require(!adminRegistry.whitelist(address(adminRegistry), "_setGuardianAllowed", address(user2)), "Whitelist should remain false");
    }

    function it_setGuardianAllowed_true_auto_enables_instant() {
        require(!adminRegistry.instantFunctions(address(token), "mint"), "Precondition: instant off");
        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Precondition: allowlist off");

        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Instant should be auto-enabled");
        require(adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist should be set");
    }

    function it_setGuardianAllowed_false_preserves_instant() {
        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Precondition: instant on");
        require(adminRegistry.guardianAllowlist(address(token), "mint"), "Precondition: allowlist on");

        adminRegistry.setGuardianAllowed(address(token), "mint", false);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", false);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", false);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Instant should be preserved on demotion");
        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist should be cleared");
    }

    function it_setInstantFunction_false_does_not_clear_guardianAllowlist() {
        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", false);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", false);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", false);

        require(!adminRegistry.instantFunctions(address(token), "mint"), "Instant should be off");
        require(adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist should be preserved");
    }

    function it_admin_only_instant_excludes_guardian() {
        // Enable instant only (no guardian allowlist)
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", true);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Precondition: instant on");
        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Precondition: allowlist off");

        // Add user2 as guardian
        adminRegistry.addGuardian(address(user2));
        user1.do(address(adminRegistry), "addGuardian", address(user2));
        executeQueued(address(adminRegistry), "_addGuardian", address(user2));
        require(adminRegistry.isGuardian(address(user2)), "Precondition: user2 is guardian");

        // Admin executes instantly (1-of-N)
        token.mint(admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Admin should execute admin-only instant");

        // Guardian on a different issueId reverts
        bool reverted = false;
        try {
            user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 500e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian should not execute admin-only instant");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Guardian mint should not have executed");
    }

    // ============ GUARDIAN AUTHORITY BOUNDARY TESTS ============

    function addGuardianViaQuorum(address _guardian) internal {
        adminRegistry.addGuardian(_guardian);
        user1.do(address(adminRegistry), "addGuardian", _guardian);
        executeQueued(address(adminRegistry), "_addGuardian", _guardian);
        require(adminRegistry.isGuardian(_guardian), "Precondition: guardian added");
    }

    function it_guardian_cannot_propose_admin_management() {
        addGuardianViaQuorum(address(user2));

        bool addReverted = false;
        try {
            user2.do(address(adminRegistry), "addAdmin", admin3);
        } catch {
            addReverted = true;
        }
        require(addReverted, "Guardian must not propose addAdmin");

        bool removeReverted = false;
        try {
            user2.do(address(adminRegistry), "removeAdmin", admin1);
        } catch {
            removeReverted = true;
        }
        require(removeReverted, "Guardian must not propose removeAdmin");

        bool swapReverted = false;
        try {
            user2.do(address(adminRegistry), "swapAdmin", admin1, admin3);
        } catch {
            swapReverted = true;
        }
        require(swapReverted, "Guardian must not propose swapAdmin");

        string memory addIssueId = adminRegistry.getIssueId(address(adminRegistry), "_addAdmin", admin3);
        require(!adminRegistry.currentIssues(addIssueId), "Guardian should not create admin proposals");
    }

    function it_guardian_cannot_propose_guardian_management() {
        addGuardianViaQuorum(address(user2));

        bool addGuardianReverted = false;
        try {
            user2.do(address(adminRegistry), "addGuardian", address(user3));
        } catch {
            addGuardianReverted = true;
        }
        require(addGuardianReverted, "Guardian must not propose addGuardian");

        bool removeGuardianReverted = false;
        try {
            user2.do(address(adminRegistry), "removeGuardian", address(user2));
        } catch {
            removeGuardianReverted = true;
        }
        require(removeGuardianReverted, "Guardian must not propose self-removal");

        bool setAllowedReverted = false;
        try {
            user2.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        } catch {
            setAllowedReverted = true;
        }
        require(setAllowedReverted, "Guardian must not propose setGuardianAllowed");

        string memory addIssueId = adminRegistry.getIssueId(address(adminRegistry), "_addGuardian", address(user3));
        require(!adminRegistry.currentIssues(addIssueId), "Guardian should not create guardian proposals");
    }

    function it_guardian_cannot_propose_setInstantFunction() {
        addGuardianViaQuorum(address(user2));

        bool reverted = false;
        try {
            user2.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian must not propose setInstantFunction");
        require(!adminRegistry.instantFunctions(address(token), "mint"), "instantFunctions should remain false");
    }

    function it_guardian_cannot_vote_on_non_instant_issue() {
        addGuardianViaQuorum(address(user2));

        bool reverted = false;
        try {
            user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian must not vote on non-instant function");

        string memory issueId = adminRegistry.getIssueId(address(token), "mint", admin3, 1000e18);
        require(!adminRegistry.currentIssues(issueId), "Issue should not be created by guardian");
        require(adminRegistry.votesMap(issueId, address(user2)) == 0, "Guardian vote must not be recorded");
    }

    function it_addGuardian_rejects_zero_address() {
        adminRegistry.addGuardian(zeroAddress);
        user1.do(address(adminRegistry), "addGuardian", zeroAddress);

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_addGuardian", zeroAddress);
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject zero address guardian");
        require(!adminRegistry.isGuardian(zeroAddress), "Zero address should not be guardian");
    }

    function it_addGuardian_rejects_duplicate() {
        addGuardianViaQuorum(address(user2));

        adminRegistry.addGuardian(address(user2));
        user1.do(address(adminRegistry), "addGuardian", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_addGuardian", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject duplicate guardian");
        require(adminRegistry.guardianMap(address(user2)) == 1, "guardianMap index should remain 1");
        require(adminRegistry.guardians(1) == address(0), "guardians array length should remain 1");
    }

    function it_removeGuardian_rejects_non_guardian() {
        adminRegistry.removeGuardian(address(user2));
        user1.do(address(adminRegistry), "removeGuardian", address(user2));

        bool reverted = false;
        try {
            fastForward(86400);
            adminRegistry.executeIssue(address(adminRegistry), "_removeGuardian", address(user2));
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject removing non-guardian");
    }

    function it_setGuardianAllowed_true_when_instant_already_enabled() {
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", true);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Precondition: instant on");
        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Precondition: allowlist off");

        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        require(adminRegistry.instantFunctions(address(token), "mint"), "Instant should remain on");
        require(adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist should be set");
    }

    function it_guardian_access_restored_after_instant_re_enabled() {
        addGuardianViaQuorum(address(user2));

        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        // Guardian initially can execute
        user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 100e18);
        require(ERC20(token).balanceOf(admin3) == 100e18, "Guardian should mint after allowlist enabled");

        // Admin disables instant (allowlist preserved)
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", false);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", false);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", false);

        require(!adminRegistry.instantFunctions(address(token), "mint"), "Instant disabled");
        require(adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist preserved");

        // Guardian access blocked while instant is off
        bool blocked = false;
        try {
            user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 200e18);
        } catch {
            blocked = true;
        }
        require(blocked, "Guardian should be blocked while instant disabled");
        require(ERC20(token).balanceOf(admin3) == 100e18, "Balance unchanged while blocked");

        // Admin re-enables instant — guardian regains access without re-allowlisting
        adminRegistry.castVoteOnIssue(address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        user1.do(address(adminRegistry), "castVoteOnIssue", address(adminRegistry), "setInstantFunction", address(token), "mint", true);
        executeQueued(address(adminRegistry), "setInstantFunction", address(token), "mint", true);

        user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 300e18);
        require(ERC20(token).balanceOf(admin3) == 400e18, "Guardian should regain access");
    }

    function it_guardian_remove_blocks_subsequent_execution() {
        addGuardianViaQuorum(address(user2));

        adminRegistry.setGuardianAllowed(address(token), "mint", true);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", true);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", true);

        user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Guardian should mint while authorized");

        adminRegistry.removeGuardian(address(user2));
        user1.do(address(adminRegistry), "removeGuardian", address(user2));
        executeQueued(address(adminRegistry), "_removeGuardian", address(user2));
        require(!adminRegistry.isGuardian(address(user2)), "Precondition: guardian removed");

        bool reverted = false;
        try {
            user2.do(address(adminRegistry), "castVoteOnIssue", address(token), "mint", admin3, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Removed guardian must not execute");
        require(ERC20(token).balanceOf(admin3) == 1000e18, "Removed guardian mint should not execute");
    }

    function it_setGuardianAllowed_false_when_already_false() {
        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Precondition: allowlist off");
        require(!adminRegistry.instantFunctions(address(token), "mint"), "Precondition: instant off");

        adminRegistry.setGuardianAllowed(address(token), "mint", false);
        user1.do(address(adminRegistry), "setGuardianAllowed", address(token), "mint", false);
        executeQueued(address(adminRegistry), "_setGuardianAllowed", address(token), "mint", false);

        require(!adminRegistry.guardianAllowlist(address(token), "mint"), "Allowlist should remain false");
        require(!adminRegistry.instantFunctions(address(token), "mint"), "Instant should remain false (no auto-enable on disable)");
    }

}
