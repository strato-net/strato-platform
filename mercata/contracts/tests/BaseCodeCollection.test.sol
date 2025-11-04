import "../abstract/ERC20/access/Authorizable.sol";
import "../abstract/ERC20/utils/StringUtils.sol";
import "../concrete/BaseCodeCollection.sol";
import "General/main.groth16.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_Mercata is Authorizable {
    using StringUtils for string;
    using BytesUtils for bytes;
    constructor() {
    }

    Mercata m;
    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() {
    }

    function it_can_deploy_Mercata() {
        require(address(m) != address(0), "address is 0");
    }

    function it_checks_that_lending_pool_is_set() {
        require(address(m.collateralVault().registry().lendingPool()) != address(0), "CollateralVault's LendingPool address is 0");
        require(address(m.liquidityPool().registry().lendingPool()) != address(0), "LiquidityPool's LendingPool address is 0");
    }

    function it_can_create_tokens() {
        address t = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(t != address(0), "Failed to create Token");
    }

    function it_can_create_pools() {
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);
        User u1 = new User();
        User u2 = new User();
        Token(t1).mint(address(this), 8000e18);
        Token(t2).mint(address(this), 20000000e18);
        Token(t1).mint(address(u1), 4e18);
        Token(t2).mint(address(u1), 10000e18);
        Token(t1).mint(address(u1), 4e18);
        Token(t2).mint(address(u2), 10000e18);
        address p1 = m.poolFactory().createPool(t1,t2);
        require(p1 != address(0), "Failed to create pool 1");

        // Give Pool mint/burn rights over its LP token
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        // address p2 = m.poolFactory().createPool(t2,t1);
        // require(p2 != address(0), "Failed to create pool 2");
        require(ERC20(t1).approve(address(p1), 4000e18), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), 10000000e18), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18, 1);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        // uint l2 = Pool(p2).addLiquidity(4000e18, 10000000e18);
        // require(l2 > 0, "Failed to add liquidity to pool 2");
        require(u1.do(t1, "approve", p1, 1e18), "Approval failed for u1");
        uint o1 = u1.do(p1, "swap", true, 1e18, 2000e18, 1);
        require(o1 > 2490e18, "Swap 1 returned less money than expected: " + string(o1));
        require(u1.do(t2, "approve", p1, o1), "Approval failed for u1");
        uint o2 = u1.do(p1, "swap", false, o1, 990e15, 1);
        require(o2 > 994e15, "Swap returned less money than expected: " + string(o2));
    }

    function it_cannot_bankrupt_a_pool() {
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);
        User u1 = new User();
        User u2 = new User();
        Token(t1).mint(address(this), 8000e18);
        Token(t2).mint(address(this), 20000000e18);
        uint u1t1Amt = 16000000000000000e18;
        Token(t1).mint(address(u1), u1t1Amt);
        Token(t2).mint(address(u1), 20000000e18);
        address p1 = m.poolFactory().createPool(t1,t2);

        // Give Pool mint/burn rights over its LP token
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        require(p1 != address(0), "Failed to create pool 1");
        require(ERC20(t1).approve(address(p1), 4000e18), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), 10000000e18), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(10000000e18, 4000e18, 1);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        require(u1.do(t1, "approve", p1, u1t1Amt), "Approval failed for u1");
        uint o1 = u1.do(p1, "swap", true, u1t1Amt, 2000e18, 1);
        require(o1 > 0, "Swap 1 returned less money than expected: " + string(o1));
    }

    function it_can_hash_last_piecewise_transaction_data() {
        uint ver = 2;
        uint nonce = 1620;
        uint gasLimit = 150000;
        address to = address(0x000000000000000000000000000000000000100e);
        string funcName = "mint";
        string[] args = ["0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7","10000000000000000000"];
        string network = "mercata";
        uint v = 0x1c;
        uint r = 0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9;
        uint s = 0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19;

        string h = keccak256(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);
        string u = keccak256(ver, nonce, gasLimit, to, funcName, args, network);
        address from = ecrecover(u, v, r, s);
        require(from == address(0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce), "Signed tx hash: " + h + ", unsigned tx hash: " + u + ", Signer: 0x" + string(from) + " didn't match 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce");
    }

    function property_hex_encoding_roundtrips(uint w) {
        string x = string(w, 16);
        uint y = uint(x);
        string z = string(y, 16);
        require(w == y && x == z, "Hex encoding failed: " + ", ".intercalate([string(w), x, string(y), z]));
    }

    struct Transaction {
        uint aversion;
        uint bnonce;
        uint cgasLimit;
        address dto;
        string efuncName;
        string[] fargs;
        string gnetwork;
        uint hv;
        uint ir;
        uint js;
    }

    function it_can_hash_transaction_data() {
        uint ver = 2;
        uint nonce = 1620;
        uint gasLimit = 150000;
        address to = address(0x000000000000000000000000000000000000100e);
        string funcName = "mint";
        string[] args = ["0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7","10000000000000000000"];
        string network = "mercata";
        uint v = 0x1c;
        uint r = 0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9;
        uint s = 0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19;
        Transaction t = Transaction(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);

        string h = keccak256(ver, nonce, gasLimit, to, funcName, args, network, v, r, s);
        string h2 = keccak256(t);
        require(h == h2, "Hashes don't match");
    }

    function it_can_add_from_an_uninitialized_map() {
        mapping (string => uint) nums;
        mapping (string => string) strs;
        require(3 + nums["hello"] == 3, "Mapping should return 0, instead got " + string(nums["hello"]));
        require(strs["hello"] + "yo" + strs["goodbye"] == "yo", "Mapping should return empty string, instead got " + strs["hello"]);
    }

    function it_can_verify_a_groth16_proof() {
        Verifier v = new Verifier();
        uint[2] a = [20348134256098970836791698380745204561149982307630007331497990210535215633804
                    ,17047090529279272178521185816798077482473992365880795169418958005435937255996
                    ];
        uint[2][2] b = [[206876084447300627063121429396318370735584980167805529582154880449824344014
                        ,14947686089120604769769784949379328695715511612486963200123048001762229853278
                        ]
                       ,[2141374389071108004656405359387431325641207078107831407433470926425711135283
                        ,2661185514261631787375844320766919545104757118016155500592111776642041751995
                        ]
                       ];
        uint[2] c = [6145793198071121393725752479858901773486324758290578166199925709581458279366
                    ,12206080442278167004276900791675511277948731192661226368768045458330757029774
                    ];
        uint[2] input = [1517,41];
        bool success = v.verifyProof(a, b, c, input);
        require(success, "Groth16 proof failed!");
    }

    string output;

    function performIssue(uint num, bool should, address isDeadbeef, string message) public {
        output = ",".intercalate([string(num), string(should), string(isDeadbeef), string(message)]);
    }

    function it_can_execute_issues() {
        User adminUser = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        User u = new User();
        bool didExecute = false;
        try {
            (bool didExecute2, string issueId) = u.do(address(admin), "castVoteOnIssue", this, "performIssue", 7, true, address(0xdeadbeef), "what");
            didExecute = didExecute2;
        } catch {

        }
        require(!didExecute, "Why did the issue get executed without votes?");
        admin.castVoteOnIssue(this, "performIssue", 7, true, address(0xdeadbeef), "what");
        require(output == "", "Got unexpected output before vote: " + output);
        adminUser.do(address(admin), "castVoteOnIssue", this, "performIssue", 7, true, address(0xdeadbeef), "what");
        require(output == "7,true,00000000000000000000000000000000deadbeef,what", "Got unexpected output: " + output);
    }

    function it_can_execute_internal_issues() {
        User adminUser = new User();
        User u = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        admin.addAdmin(address(u));
        require(admin.admins(1) == address(adminUser) && admin.admins(2) == address(0), "Admin was added before enough votes were cast");
        adminUser.do(address(admin), "addAdmin", address(u));
        require(admin.admins(2) == address(u) && admin.admins(3) == address(0), "New admin was not added correctly");
    }

    function it_can_execute_contract_creations() {
        User adminUser = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        string src = "contract Blob { string public val; constructor(uint x, string _val) { val = string(x) + _val; }}";
        (bool didntDoIt, ) = admin.castVoteOnIssue(address(admin), "createContract", "Blob", src, 7, "hello");
        require(!didntDoIt, "Contract was created before enough votes were cast");
        (bool didIt, address blob) = adminUser.do(address(admin), "castVoteOnIssue", address(admin), "createContract", "Blob", src, 7, "hello");
        require(didIt, "Contract was not created correctly");
        string blobOutput = blob.staticcall("val");
        require(blobOutput == "7hello", "blobOutput was not set correctly");
    }

    function it_can_execute_contract_creations_from_code_collection() {
        User adminUser = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        string src = '{"A.sol":"contract A{}","Blob.sol":"import \\"A.sol\\"; contract Blob { string public val; constructor(uint x, string _val) { val = string(x) + _val; new A(); }}"}';
        (bool didntDoIt, ) = admin.castVoteOnIssue(address(admin), "createContract", "Blob", src, 7, "hello");
        require(!didntDoIt, "Contract was created before enough votes were cast");
        (bool didIt, address blob) = adminUser.do(address(admin), "castVoteOnIssue", address(admin), "createContract", "Blob", src, 7, "hello");
        require(didIt, "Contract was not created correctly");
        string blobOutput = blob.staticcall("val");
        require(blobOutput == "7hello", "blobOutput was not set correctly");
    }

    function it_can_allow_new_admin_to_vote() {
        User adminUser = new User();
        User u = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        admin.addAdmin(address(u));
        require(admin.admins(1) == address(adminUser) && admin.admins(2) == address(0), "Admin was added before enough votes were cast");
        adminUser.do(address(admin), "addAdmin", address(u));
        require(admin.admins(2) == address(u) && admin.admins(3) == address(0), "New admin was not added correctly");
        string src = "contract Blob { string public val; constructor(uint x, string _val) { val = string(x) + _val; }}";
        (bool didntDoIt, ) = admin.castVoteOnIssue(address(admin), "createContract", "Blob", src, 7, "hello");
        require(!didntDoIt, "Contract was created before enough votes were cast");
        (bool didIt, address blob) = adminUser.do(address(admin), "castVoteOnIssue", address(admin), "createContract", "Blob", src, 7, "hello");
        string blobOutput = blob.staticcall("val");
        require(blobOutput == "7hello", "blobOutput was not set correctly");
    }

    function xit_can_change_voting_logic() {
        User adminUser = new User();
        User u = new User();
        AdminRegistry admin = new AdminRegistry();
        admin.initialize([this, address(adminUser)]);
        string src = 'contract VotingRule { function _shouldExecute(variadic _args) internal returns (bool) {  return true; } }';
        (bool didntDoIt, ) = admin.castVoteOnIssue(address(admin), "createContract", "VotingRule", src);
        require(!didntDoIt, "Contract was created before enough votes were cast");
        (bool didIt, address newVotingRules) = adminUser.do(address(admin), "castVoteOnIssue", address(admin), "createContract", "VotingRule", src);
        require(didIt, "Contract was not created correctly");
        admin.castVoteOnIssue(address(admin), "updateDelegate", "_shouldExecute", newVotingRules);
        adminUser.do(address(admin), "castVoteOnIssue", address(admin), "updateDelegate", "_shouldExecute", newVotingRules);
        admin.removeAdmin(address(adminUser));
        require(admin.admins(0) == address(this) && admin.admins(1) == address(0), "Voting logic was not overwritten properly");
    }

    function it_can_use_string_utils() {
        string v = "HeLlO wOrLd";
        string w = v.toLower();
        string x = v.toUpper();
        string y = w.toUpper();
        bytes z = bytes(v).b16encode();
        string alpha = string(z.b16decode());
        require(w == "hello world", w);
        require(x == y, x + ", " + y);
        require(string(z) == "48654c6c4f20774f724c64", z);
        require(alpha == v, alpha);
        string blob0 = "16dad75a9959f69f811ebca00b839206cdee3f51611f2f44283d3c19ae429e47";
        bytes blob = bytes(blob0).b16decode();
        string blob2 = string(blob.b16encode());
        require(blob0 == blob2, blob0 + ", " + blob2);
        string blob3 = "0x" + blob0;
        require(blob3.normalizeHex() == blob3, blob0 + ", " + blob2);
        bytes blob4 = bytes("16dad75a9959f69f811ebca00b839206cdee3f51611f2f44283d3c19ae429e47").b16decode();
        string emojis = "🦑🎉⚡🪩🌮🐘🚀💾🐧🔥🍕🧠🌈🎸🦄💻🕹️💥";
        string emojiHexString = "f09fa691f09f8e89e29aa1f09faaa9f09f8caef09f9098f09f9a80f09f92bef09f90a7f09f94a5f09f8d95f09fa7a0f09f8c88f09f8eb8f09fa684f09f92bbf09f95b9efb88ff09f92a5";
        bytes emojiBytes = bytes(emojis, "utf-8");
        bytes emojiBytesHex = emojiBytes.b16encode();
        string emojiBytesHexString = string(emojiBytesHex, "utf-8");
        require(emojiBytesHexString == emojiHexString, "Emojis did not encode properly: " + emojiBytesHexString);
        bytes emojiBytesUnhex = emojiBytesHex.b16decode();
        string emojis2 = string(emojiBytesUnhex, "utf-8");
        require(emojis == emojis2, "Emojis did not decode properly: " + emojis2);
    }

    function property_one_sided_liquidity_doesnt_corrupt_internal_accounting(
        uint _a,
        uint _b1,
        uint _b2,
        uint _b3,
        uint _c
    ) {
        address t1 = m.tokenFactory().createToken("ETHST", "ETHST Token", [], [], [], "ETHST", 0, 18);
        Token(t1).setStatus(2);
        address t2 = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(t2).setStatus(2);
        User u1 = new User();
        User u2 = new User();
        uint a = _a + 1; // Mint _a + 1 A tokens
        uint b = a * (10 + (((_b1 % 10) + 1) * ((_b2 % 10) + 1) * ((_b3 * 10) + 1))); // Mint roughly 1-1000x as many B tokens
        uint c = (_c % b) + 1; // User deposits anywhere from 1 to b units of token B
        uint t1Amt = a * 1e18;
        uint t2Amt = b * 1e17; // b is denominated in 0.1 token units
        uint u1Amt = c * 1e17; // c is denominated in 0.1 token units
        Token(t1).mint(address(this), t1Amt);
        Token(t2).mint(address(this), t2Amt);
        Token(t2).mint(address(u1), u1Amt);
        address p1 = m.poolFactory().createPool(t1,t2);

        // Give Pool mint/burn rights over its LP token
        Token lpToken = Pool(p1).lpToken();
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "mint", address(p1));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(lpToken), "burn", address(p1));

        require(p1 != address(0), "Failed to create pool 1");
        require(ERC20(t1).approve(address(p1), t1Amt), "Approval failed for t1");
        require(ERC20(t2).approve(address(p1), t2Amt), "Approval failed for t2");
        uint l1 = Pool(p1).addLiquidity(t2Amt, t1Amt, 1);
        require(l1 > 0, "Failed to add liquidity to pool 1");
        require(u1.do(t2, "approve", p1, u1Amt), "Approval failed for u1");
        u1.do(p1, "addLiquiditySingleToken", false, u1Amt, 1);
        uint lpBal = lpToken.balanceOf(address(u1));
        u1.do(p1, "removeLiquidity", lpBal, 1, 1, 1);
        require(Pool(p1).tokenABalance() == Token(t1).balanceOf(p1), "Pool's tokenABalance doesn't match reality: " + string(Pool(p1).tokenABalance()) + ", " + string(Token(t1).balanceOf(p1)));
        require(Pool(p1).tokenBBalance() == Token(t2).balanceOf(p1), "Pool's tokenBBalance doesn't match reality: " + string(Pool(p1).tokenBBalance()) + ", " + string(Token(t2).balanceOf(p1)));
    }
}
