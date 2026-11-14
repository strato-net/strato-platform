import "../../concrete/Admin/MultisigFactory.sol";
import "../../concrete/Admin/MultisigLogic.sol";
import "../../concrete/User/UserRegistry.sol";
import "../../concrete/Proxy/Proxy.sol";

contract AuditSigner {
    function invoke(address _target, string _function, variadic _arguments) public returns (variadic) {
        return _target.call(_function, _arguments);
    }
}

contract AuditToken {
    mapping (address => uint) public balanceOf;

    constructor(address _holder) {
        balanceOf[_holder] = 1000;
    }

    function transfer(address _to, uint _amount) public {
        require(balanceOf[msg.sender] >= _amount, "Insufficient balance");
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
    }
}

contract AuditSeeder {
    mapping (address => uint) public record adminMap;
    mapping (address => uint) private userAddressMap;

    function seedAdmin(address _account) public {
        adminMap[_account] = 7;
    }

    function seedUser(address _account) public {
        userAddressMap[_account] = 7;
    }
}

contract AuditNamed {
    string public name;

    function setName(string _name) public {
        name = _name;
    }
}

contract AuditContractTarget {
    address public selected;

    function select(AuditSigner _signer) public {
        selected = address(_signer);
    }

    function selectMany(AuditSigner[] _signers) public {
        selected = address(_signers[0]);
    }

    function selectAddresses(address[] _signers) public {
        selected = _signers[0];
    }
}

contract Describe_DedicatedMultisigAudit {
    MultisigFactory factory;
    MultisigLogic logic;
    AuditSigner a;
    AuditSigner b;
    AuditSigner c;
    AuditSigner evil;

    function beforeEach() {
        logic = new MultisigLogic();
        MultisigFactory implementation = new MultisigFactory(address(0xdeadbeef));
        factory = MultisigFactory(address(new Proxy(address(implementation), address(this))));
        factory.initializeRegistryGovernance(address(this));
        factory.publishLogicVersion("1", address(logic));
        a = new AuditSigner();
        b = new AuditSigner();
        c = new AuditSigner();
        evil = new AuditSigner();
    }

    function deploy(uint _timelock) internal returns (address) {
        string setupHash = factory.registerSetup(
            [address(a), address(b), address(c)],
            2,
            _timelock,
            "1",
            "secondary-audit"
        );
        a.invoke(address(factory), "confirmSetup", setupHash);
        b.invoke(address(factory), "confirmSetup", setupHash);
        return c.invoke(address(factory), "confirmSetup", setupHash);
    }

    function rejects(AuditSigner _caller, address _target, string _function, variadic _arguments) internal returns (bool) {
        try _caller.invoke(_target, _function, _arguments) {
            return false;
        } catch {
            return true;
        }
    }

    function it_f1_rejects_lowering_the_threshold_to_one_of_three() {
        address wallet = deploy(0);
        string issueId = a.invoke(
            wallet,
            "proposeIssue",
            wallet,
            "applyConfiguration",
            ["address[]", "uint256"],
            [address(a), address(b), address(c)],
            1
        );
        require(
            rejects(
                b,
                wallet,
                "approveIssue",
                issueId,
                wallet,
                "applyConfiguration",
                ["address[]", "uint256"],
                [address(a), address(b), address(c)],
                1
            ),
            "One-of-three threshold was accepted"
        );
        require(MultisigLogic(wallet).requiredApprovals() == 2, "Threshold changed");
    }

    function it_f2_uses_fresh_storage_without_preseeded_user_or_admin_authority() {
        User legacy = new User("seeded");
        AuditSeeder seeder = new AuditSeeder();
        legacy.setLogicContract(address(seeder));
        AuditSeeder(address(legacy)).seedUser(address(evil));
        AuditSeeder(address(legacy)).seedAdmin(address(evil));

        address wallet = deploy(0);
        AuditToken token = new AuditToken(wallet);
        require(MultisigLogic(wallet).signerMap(address(evil)) == 0, "Preseeded signer crossed into fresh wallet");
        require(rejects(evil, wallet, "callContract", address(token), "transfer", address(evil), 1000), "Hidden User authority survived");
        require(rejects(evil, wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(evil), 1000), "Hidden signer survived");
        require(token.balanceOf(wallet) == 1000, "Fresh wallet funds moved");
    }

    function it_f2_creator_cannot_leave_a_pending_signer() {
        address wallet = deploy(0);
        require(
            rejects(
                evil,
                wallet,
                "nominateConfiguration",
                address(evil),
                [address(a), address(b), address(c), address(evil)],
                2
            ),
            "Creator or outsider nominated without quorum"
        );
        require(rejects(evil, wallet, "acceptNomination"), "Unapproved pending signer activated");
        require(MultisigLogic(wallet).signerMap(address(evil)) == 0, "Evil signer activated");
    }

    function it_f3_expired_queued_issue_does_not_block_an_identical_proposal() {
        address wallet = deploy(86400);
        AuditToken token = new AuditToken(wallet);
        string expired = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(evil), 1000);
        b.invoke(wallet, "approveIssue", expired, address(token), "transfer", ["address", "uint256"], address(evil), 1000);
        fastForward(86400 + 604800 + 1);
        require(
            rejects(c, wallet, "executeIssue", expired, address(token), "transfer", ["address", "uint256"], address(evil), 1000),
            "Expired issue executed"
        );

        string replacement = a.invoke(wallet, "proposeIssue", address(token), "transfer", ["address", "uint256"], address(evil), 1000);
        require(replacement != expired, "Identical proposal reused the expired issue ID");
        b.invoke(wallet, "approveIssue", replacement, address(token), "transfer", ["address", "uint256"], address(evil), 1000);
        (,,,,,,,, uint executableAt,,, bool active) = MultisigLogic(wallet).issues(replacement);
        require(active && executableAt > block.timestamp, "Replacement issue was not queued");
    }

    function it_f4_assigns_distinct_ids_to_differently_typed_proposals() {
        address wallet = deploy(0);
        AuditNamed target = new AuditNamed();
        string boolIssue = a.invoke(wallet, "proposeIssue", address(target), "setName", ["bool"], true);
        string uintIssue = a.invoke(wallet, "proposeIssue", address(target), "setName", ["uint256"], 1);
        string stringIssue = a.invoke(wallet, "proposeIssue", address(target), "setName", ["string"], "A");
        require(boolIssue != uintIssue && uintIssue != stringIssue && boolIssue != stringIssue, "Typed proposals shared an issue ID");
    }

    function it_f4_rejects_retyping_a_committed_string_argument() {
        address wallet = deploy(0);
        AuditNamed target = new AuditNamed();
        string issueId = a.invoke(wallet, "proposeIssue", address(target), "setName", ["string"], "A");
        require(
            rejects(b, wallet, "approveIssue", issueId, address(target), "setName", ["uint256"], 65),
            "Retyped argument approved"
        );
        b.invoke(wallet, "approveIssue", issueId, address(target), "setName", ["string"], "A");
        require(target.name() == "A", "Committed string did not execute");
    }

    function it_f4_rejects_substituting_a_contract_typed_argument() {
        address wallet = deploy(0);
        AuditContractTarget target = new AuditContractTarget();
        string issueId = a.invoke(wallet, "proposeIssue", address(target), "select", ["AuditSigner"], a);
        require(
            rejects(b, wallet, "approveIssue", issueId, address(target), "select", ["AuditSigner"], evil),
            "Different contract argument approved"
        );
        b.invoke(wallet, "approveIssue", issueId, address(target), "select", ["AuditSigner"], a);
        require(target.selected() == address(a), "Committed contract argument did not execute");
    }

    function it_f4_rejects_noncanonical_contract_typed_arrays() {
        address wallet = deploy(0);
        AuditContractTarget target = new AuditContractTarget();
        require(
            rejects(a, wallet, "proposeIssue", address(target), "selectMany", ["AuditSigner[]"], [a]),
            "Contract-typed array was accepted without canonical encoding"
        );
    }

    function it_f4_rejects_substituting_an_address_array_element() {
        address wallet = deploy(0);
        AuditContractTarget target = new AuditContractTarget();
        string issueId = a.invoke(wallet, "proposeIssue", address(target), "selectAddresses", ["address[]"], [address(a)]);
        require(
            rejects(b, wallet, "approveIssue", issueId, address(target), "selectAddresses", ["address[]"], [address(evil)]),
            "Different address array approved"
        );
        b.invoke(wallet, "approveIssue", issueId, address(target), "selectAddresses", ["address[]"], [address(a)]);
        require(target.selected() == address(a), "Committed address array did not execute");
    }

    function it_f4_rejects_contract_references_labelled_as_address_array_elements() {
        address wallet = deploy(1);
        AuditContractTarget target = new AuditContractTarget();
        string issueId = a.invoke(wallet, "proposeIssue", address(target), "selectMany", ["address[]"], [a]);
        require(
            rejects(b, wallet, "approveIssue", issueId, address(target), "selectMany", ["address[]"], [evil]),
            "Different contract reference labelled as address approved"
        );
        b.invoke(wallet, "approveIssue", issueId, address(target), "selectMany", ["address[]"], [a]);
        (,,,,,,,, uint executableAt,,, bool active) = MultisigLogic(wallet).issues(issueId);
        require(active && executableAt > block.timestamp, "Committed contract reference array was not queued");
    }

    function it_f4_rejects_arguments_beyond_the_declared_types() {
        address wallet = deploy(1);
        AuditContractTarget target = new AuditContractTarget();
        string issueId = a.invoke(wallet, "proposeIssue", address(target), "select", ["AuditSigner"], a);
        require(
            rejects(b, wallet, "approveIssue", issueId, address(target), "select", ["AuditSigner"], a, evil),
            "Extra contract argument was accepted"
        );
        b.invoke(wallet, "approveIssue", issueId, address(target), "select", ["AuditSigner"], a);
        (,,,,,,,, uint executableAt,,, bool active) = MultisigLogic(wallet).issues(issueId);
        require(active && executableAt > block.timestamp, "Exact committed payload was not queued");
    }

    function it_f4_rejects_arguments_with_an_empty_type_list() {
        address wallet = deploy(0);
        AuditNamed target = new AuditNamed();
        require(
            rejects(a, wallet, "proposeIssue", address(target), "setName", [], "A"),
            "Argument with no declared type was accepted"
        );
        require(
            rejects(a, wallet, "proposeIssue", address(target), "setName", [], ""),
            "Empty string argument with no declared type was accepted"
        );
    }

    function it_rejects_signature_style_proposal_function_names() {
        address wallet = deploy(0);
        AuditToken token = new AuditToken(wallet);
        require(
            rejects(
                a,
                wallet,
                "proposeIssue",
                address(token),
                " transfer(address,uint256)",
                ["address", "uint256"],
                address(evil),
                100
            ),
            "Signature-style token function was proposed"
        );
        require(
            rejects(a, wallet, "proposeIssueNoArgs", wallet, " freezeUpgrades()"),
            "Signature-style shell function was proposed"
        );
    }
}
