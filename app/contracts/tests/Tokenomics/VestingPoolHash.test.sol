import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Hash.spec.ts (main 886fc7b0).
// Adaptation: upstream compares against an off-chain TypeScript EIP-712 implementation;
// here the expected hash is recomputed in Solidity from the EIP-712 definition (typehash
// strings, block.chainid, pool address), so the test proves the contract's derivation
// matches the spec rather than a hardcoded EVM value.
contract Describe_VestingPoolHash {
    Token strato;
    User user2;
    VestingPool pool;

    function beforeAll() public {
        user2 = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        pool = new VestingPool(address(strato), address(this));
    }

    function _units(uint n) internal pure returns (uint128) {
        return uint128(n * 10**18);
    }

    // EIP-712 hash of a vesting, computed independently of the contract (src/utils/hash.ts upstream)
    function _calculateVestingHash(address account, uint8 curveType, bool managed, uint16 durationWeeks, uint64 startDate, uint128 amount) internal view returns (bytes32) {
        bytes32 domainTypehash = keccak256(abi.encodePacked("EIP712Domain(uint256 chainId,address verifyingContract)"));
        bytes32 vestingTypehash = keccak256(abi.encodePacked("Vesting(address account,uint8 curveType,bool managed,uint16 durationWeeks,uint64 startDate,uint128 amount)"));
        bytes32 domainSeparator = keccak256(abi.encode(domainTypehash, block.chainid, address(pool)));
        bytes32 vestingDataHash = keccak256(abi.encode(vestingTypehash, account, curveType, managed, durationWeeks, startDate, amount));
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, vestingDataHash));
    }

    function it_calculate_correct_hash_for_managed_vesting() public {
        uint64 startDate = uint64(block.timestamp) + 1000;
        bytes32 expected = _calculateVestingHash(address(user2), 0, true, 104, startDate, _units(200000));
        require(pool.vestingHash(address(user2), 0, true, 104, startDate, _units(200000)) == expected, "managed hash");
    }

    function it_calculate_correct_hash_for_unmanaged_vesting() public {
        uint64 startDate = uint64(block.timestamp) + 1000;
        bytes32 expected = _calculateVestingHash(address(user2), 0, false, 104, startDate, _units(200000));
        require(pool.vestingHash(address(user2), 0, false, 104, startDate, _units(200000)) == expected, "unmanaged hash");
        // the managed flag is part of the id
        require(pool.vestingHash(address(user2), 0, true, 104, startDate, _units(200000)) != expected, "managed flag not hashed");
    }

    function it_calculate_correct_hash_for_exponential_vesting() public {
        uint64 startDate = uint64(block.timestamp) + 1000;
        bytes32 expected = _calculateVestingHash(address(user2), 1, true, 104, startDate, _units(200000));
        require(pool.vestingHash(address(user2), 1, true, 104, startDate, _units(200000)) == expected, "exponential hash");
        require(pool.vestingHash(address(user2), 0, true, 104, startDate, _units(200000)) != expected, "curve type not hashed");
    }

    function it_calculate_correct_hash_for_zero_amount_vesting() public {
        uint64 startDate = uint64(block.timestamp) + 1000;
        bytes32 expected = _calculateVestingHash(address(user2), 0, true, 104, startDate, 0);
        require(pool.vestingHash(address(user2), 0, true, 104, startDate, 0) == expected, "zero amount hash");
        // same parameters always give the same id
        require(pool.vestingHash(address(user2), 0, true, 104, startDate, 0) == pool.vestingHash(address(user2), 0, true, 104, startDate, 0), "hash not deterministic");
    }

    // Extra: the contract's hardcoded typehash constants equal the keccak of their type strings
    // (the recomputation above relies on it; a mismatch would mean ids differ from the EIP-712 spec).
    function it_typehash_constants_match_their_type_strings() public {
        require(keccak256(abi.encodePacked("EIP712Domain(uint256 chainId,address verifyingContract)")) == bytes32(0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218), "domain typehash");
        require(keccak256(abi.encodePacked("Vesting(address account,uint8 curveType,bool managed,uint16 durationWeeks,uint64 startDate,uint128 amount)")) == bytes32(0x43838b5ce9ca440d1ac21b07179a1fdd88aa2175e5ea103f6e37aa6d18ce78ad), "vesting typehash");
    }
}
