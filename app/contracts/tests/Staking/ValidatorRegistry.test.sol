// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/ValidatorRegistry.sol";
import "../Util.sol";

contract record MockValidatorSync is IStratoStakingValidatorSync {
    uint256 public recordSyncCount;
    uint256 public operatorSyncCount;
    address public lastValidator;
    bool public lastActive;
    address public lastOperator;

    mapping(address => bool) public record validatorActive;
    mapping(address => address) public record validatorOperator;

    function syncValidatorRecord(address validator, bool active, uint256 commissionBps, address operator) external override {
        recordSyncCount += 1;
        lastValidator = validator;
        lastActive = active;
        lastOperator = operator;
        validatorActive[validator] = active;
        validatorOperator[validator] = operator;
    }

    function syncValidatorOperator(address validator, address operator) external override {
        operatorSyncCount += 1;
        lastValidator = validator;
        lastOperator = operator;
        validatorOperator[validator] = operator;
    }

}

// Signing is impossible inside a test, so this registry stands in a key's signature with a
// record of which digests each key has "signed". Digests carry the nonce, so a recorded
// consent goes stale exactly when a real signature would. The real recovery path is covered
// against a known secp256k1 vector below.
contract ConsentRegistry is ValidatorRegistry {
    mapping(bytes32 => address) public record signedBy;

    constructor(address initialOwner) ValidatorRegistry(initialOwner) { }

    function sign(address validator, address operator) public {
        signedBy[operatorAuthorizationDigest(validator, operator)] = validator;
    }

    // The network the test runner lacks: helium's network ID.
    function _chainId() internal view override returns (uint256) {
        return 114784819836269;
    }

    function _recoverSigner(bytes32 digest, uint8 v, uint256 r, uint256 s) internal override returns (address) {
        return signedBy[digest];
    }
}

contract RecoveryHarness is ValidatorRegistry {
    constructor(address initialOwner) ValidatorRegistry(initialOwner) { }

    function recover(bytes32 digest, uint8 v, uint256 r, uint256 s) public returns (address) {
        return _recoverSigner(digest, v, r, s);
    }
}

contract Describe_ValidatorRegistry {
    address constant VALIDATOR_A = address(0xaaaa);
    address constant GENESIS_X = address(0xcccc);

    ConsentRegistry registry;
    MockValidatorSync staking;

    User operatorA;
    User operatorB;
    User user;
    User validatorKey;

    function beforeAll() public {
        operatorA = new User();
        operatorB = new User();
        user = new User();
        validatorKey = new User();
    }

    function beforeEach() public {
        staking = new MockValidatorSync();
        registry = new ConsentRegistry(address(this));
        registry.initialize(address(staking));
    }

    function _addValidatorA() internal {
        registry.addValidator(VALIDATOR_A, address(operatorA), 500, "Validator A", "First validator", "ipfs://validator-a", "validator-a");
    }

    function _register(User operator, address validator) internal {
        operator.doSuccessfully(address(registry), "register", validator, uint256(0), "Validator", "", "", uint8(0), uint256(0), uint256(0));
    }

    function it_lists_validators_by_key_with_the_operator_as_a_field() public {
        _addValidatorA();
        (bool exists, bool active, string name,,, string protocolValidatorId, address operator) = registry.operators(VALIDATOR_A);
        require(exists && active, "listed");
        require(name == "Validator A" && protocolValidatorId == "validator-a", "profile stored");
        require(operator == address(operatorA), "operator field");
        require(registry.operatorOf(VALIDATOR_A) == address(operatorA), "operatorOf");
        require(registry.operatorList(0) == VALIDATOR_A, "listed by validator");
        require(staking.validatorOperator(VALIDATOR_A) == address(operatorA), "staking record keyed by validator");
        require(registry.protocolValidatorOperators("validator-a") == VALIDATOR_A, "protocol id resolves to the validator");

        bool rejected = false;
        try registry.addValidator(VALIDATOR_A, address(operatorB), 0, "Again", "", "", "") {
        } catch {
            rejected = true;
        }
        require(rejected, "a listed validator cannot be listed twice");
    }

    // FINDING 2 regression: a registration names a validator only with that key's consent.
    function it_rejects_registration_without_the_validator_keys_consent() public {
        user.doExpectingFailure(address(registry), "register", "VR: validator did not authorize operator", GENESIS_X, uint256(0), "Squat", "", "", uint8(27), uint256(1), uint256(1));

        registry.sign(GENESIS_X, address(operatorB));
        user.doExpectingFailure(address(registry), "register", "VR: validator did not authorize operator", GENESIS_X, uint256(0), "Squat", "", "", uint8(27), uint256(1), uint256(1));

        registry.sign(GENESIS_X, address(user));
        _register(user, GENESIS_X);
        require(registry.operatorOf(GENESIS_X) == address(user), "consented operator bound");
        require(registry.authorizationNonce(GENESIS_X) == 1, "consent spent");
        require(staking.validatorOperator(GENESIS_X) == address(user), "staking record created");

        operatorB.doExpectingFailure(address(registry), "register", "VR: already registered", GENESIS_X, uint256(0), "Again", "", "", uint8(0), uint256(0), uint256(0));
    }

    function it_lets_a_validator_key_register_itself() public {
        _register(validatorKey, address(validatorKey));
        require(registry.operatorOf(address(validatorKey)) == address(validatorKey), "self-operated");
    }

    function it_spends_each_consent_once() public {
        registry.sign(GENESIS_X, address(user));
        _register(user, GENESIS_X);

        registry.sign(GENESIS_X, address(operatorB));
        operatorB.doSuccessfully(address(registry), "setOperator", GENESIS_X, address(operatorB), uint8(0), uint256(0), uint256(0));
        require(registry.operatorOf(GENESIS_X) == address(operatorB), "handed over with consent");
        require(staking.operatorSyncCount() == 1, "staking settles the handover");

        registry.adminSetOperator(GENESIS_X, address(user));
        // operatorB's consent was recorded at an earlier nonce; it cannot be replayed.
        operatorB.doExpectingFailure(address(registry), "setOperator", "VR: validator did not authorize operator", GENESIS_X, address(operatorB), uint8(0), uint256(0), uint256(0));
        require(registry.operatorOf(GENESIS_X) == address(user), "unchanged");
    }

    function it_only_lets_the_owner_move_an_operator_without_consent() public {
        _addValidatorA();
        bool rejected = false;
        try user.do(address(registry), "adminSetOperator(address,address)", VALIDATOR_A, address(user)) {
        } catch {
            rejected = true;
        }
        require(rejected, "non-owner rejected");
        require(registry.operatorOf(VALIDATOR_A) == address(operatorA), "unchanged");

        operatorA.doExpectingFailure(address(registry), "setOperator", "VR: validator did not authorize operator", VALIDATOR_A, address(user), uint8(0), uint256(0), uint256(0));

        registry.adminSetOperator(VALIDATOR_A, address(operatorB));
        require(registry.operatorOf(VALIDATOR_A) == address(operatorB), "owner moved it");
        require(staking.validatorOperator(VALIDATOR_A) == address(operatorB), "synced");
    }

    function it_updates_profiles_only_by_the_operator_or_owner() public {
        _addValidatorA();
        user.doExpectingFailure(address(registry), "updateProfile", "VR: not operator", VALIDATOR_A, "Hijacked", "", "", "");
        operatorA.doSuccessfully(address(registry), "updateProfile", VALIDATOR_A, "Renamed", "d", "u", "validator-a2");
        (,, string name,,, string protocolValidatorId,) = registry.operators(VALIDATOR_A);
        require(name == "Renamed" && protocolValidatorId == "validator-a2", "profile updated");
        require(registry.protocolValidatorOperators("validator-a") == address(0), "old protocol id released");
    }

    function it_delists_and_relists_through_the_owner() public {
        _addValidatorA();
        registry.removeValidator(VALIDATOR_A);
        (, bool active,,,,,) = registry.operators(VALIDATOR_A);
        require(!active, "delisted");
        require(!staking.validatorActive(VALIDATOR_A), "staking synced as delisted");
        require(staking.lastOperator() == address(operatorA), "delisting names the operator");

        registry.addValidator(VALIDATOR_A, address(operatorB), 250, "Validator A", "", "", "validator-a");
        require(staking.validatorActive(VALIDATOR_A), "relisted");
        require(registry.operatorOf(VALIDATOR_A) == address(operatorB), "relisted under a new operator");
        require(registry.validatorCount() == 1, "slot reused");
    }

    // Known vector, produced off-chain with ethers:
    //   solidityPackedKeccak256(["string", "uint256", "address", "address", "address", "uint256"],
    //     ["STRATO validator operator authorization", 114784819836269, 0x1111...1111, <validator>, 0x2222...2222, 7])
    //   new SigningKey(<anvil key 0>).sign(digest)
    // 114784819836269 is helium's network ID.
    // It pins both the digest encoding off-chain tooling must reproduce and the signature
    // conventions (v as 27/28 or as a 0/1 recovery id) the registry accepts.
    function it_matches_off_chain_digests_and_recovers_real_signatures() public {
        address signer = address(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);
        bytes32 expected = bytes32(0xba7b553d0f1ae8dada79984723ddf311b90c9d0e84c6eb16a19445aa557d0d27);
        bytes32 digest = registry.authorizationDigest(114784819836269, address(0x1111111111111111111111111111111111111111), signer, address(0x2222222222222222222222222222222222222222), 7);
        require(digest == expected, "digest matches Ethereum packed encoding");

        uint256 r = 0xe20114a7c9c9d0f87b14b2db2ae0aba935e9ce37ef66472fecc6ed17aac55598;
        uint256 s = 0x74d78323e445044c3967614d037c46ae23d8ffba019480ec5d67c64754aa3b3c;
        RecoveryHarness harness = new RecoveryHarness(address(this));
        require(harness.recover(digest, 27, r, s) == signer, "recovers with v = 27");
        require(harness.recover(digest, 0, r, s) == signer, "recovers with a 0/1 recovery id");
        require(harness.recover(digest, 28, r, s) != signer, "the other parity is someone else");
        require(harness.recover(digest, 5, r, s) == address(0), "nonsense v recovers nobody");
    }

    // SolidVM feeds a never-written storage slot to abi.encodePacked as zero bytes, not as
    // uint256(0). Every validator starts with an unwritten nonce, so without the `+ 0` in
    // operatorAuthorizationDigest the on-chain digest was 32 bytes short of what every off-chain
    // signer hashes and no first `register` / `setOperator` signature could ever verify.
    function it_digest_for_a_fresh_validator_includes_nonce_zero() public {
        require(registry.authorizationNonce(GENESIS_X) == 0, "nonce never written");
        bytes32 onChain = registry.operatorAuthorizationDigest(GENESIS_X, address(operatorB));
        bytes32 offChain = registry.authorizationDigest(114784819836269, address(registry), GENESIS_X, address(operatorB), 0);
        require(onChain == offChain, "operatorAuthorizationDigest must encode an unwritten nonce as uint256(0)");
    }

    function it_digest_after_a_consumed_consent_uses_the_written_nonce() public {
        registry.sign(GENESIS_X, address(user));
        _register(user, GENESIS_X);
        require(registry.authorizationNonce(GENESIS_X) == 1, "consent spent");
        bytes32 onChain = registry.operatorAuthorizationDigest(GENESIS_X, address(operatorB));
        bytes32 offChain = registry.authorizationDigest(114784819836269, address(registry), GENESIS_X, address(operatorB), 1);
        require(onChain == offChain, "operatorAuthorizationDigest must track the written nonce");
    }

    // The digest carries the chain id, so a consent signed on one network does not verify on
    // another that shares the registry address and the validator key, as a network started
    // from a copy of another's state does.
    function it_scopes_the_digest_to_the_chain() public {
        bytes32 onChain = registry.operatorAuthorizationDigest(GENESIS_X, address(operatorB));
        uint256 chainId = 114784819836269;
        uint256 nonce = 0;
        require(onChain == keccak256(abi.encodePacked("STRATO validator operator authorization", chainId, address(registry), GENESIS_X, address(operatorB), nonce)), "this chain's id is in the digest");
        require(onChain != keccak256(abi.encodePacked("STRATO validator operator authorization", address(registry), GENESIS_X, address(operatorB), nonce)), "a digest without it is not accepted");
    }
}
