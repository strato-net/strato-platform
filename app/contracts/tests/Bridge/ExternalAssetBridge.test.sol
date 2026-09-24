import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Admin/FeeCollector.sol";
import "../../concrete/Bridge/ExternalAssetBridge.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../../concrete/Metals/MetalForge.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../libraries/Bridge/ExternalBridgeTypes.sol";
import "../../libraries/Router/RouterTypes.sol";

contract ExternalBridgeUser {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract PlainRevertRouter {
    bool public initialized = true;
    function executeRouteWithActions(
        address,
        address,
        uint256,
        address,
        RouteStepData[],
        uint256,
        uint256
    ) public returns (uint256) {
        revert();
    }
}

contract RefundTestBridge is ExternalAssetBridge {
    using ExternalBridgeTypes for *;
    constructor(address initialOwner) ExternalAssetBridge(initialOwner) {}

    function seedRefund(address token, address recipient, address destinationVault) public {
        withdrawals[1].status = Status.READY;
        withdrawals[1].stratoToken = token;
        withdrawals[1].stratoSender = recipient;
        withdrawals[1].stratoTokenAmount = 100;
        withdrawals[1].externalChainId = 1;
        withdrawals[1].authorizationDeadline = 1;
        withdrawalAuthorizations[1].deadline = 1;
        withdrawalAuthorizations[1].destinationVault = destinationVault;
    }
}

contract Describe_ExternalAssetBridge is Authorizable {
    using ExternalBridgeTypes for *;
    using RouterTypes for *;

    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    ExternalAssetBridge bridge;
    Token stratoToken;
    Token metalToken;
    SaveUSDSTVault saveVault;
    MetalForge metalForge;
    PriceOracle oracle;
    PoolFactory poolFactory;
    PoolV3Factory poolV3Factory;
    DirectMintPSM directMintPsm;
    TokenRouter tokenRouter;
    ExternalBridgeUser user;
    ExternalBridgeUser relayer;
    ExternalBridgeUser verifierOne;
    ExternalBridgeUser verifierTwo;
    ExternalBridgeUser verifierThree;

    uint256 externalChainId;
    address externalToken;
    address externalRecipient;
    address externalVault;
    address depositRouter;

    function beforeAll() {
        bypassAuthorizations = true;
        externalChainId = 1;
        externalToken = address(0x5555);
        externalRecipient = address(0x2222);
        externalVault = address(0x3333);
        depositRouter = address(0x4444);
    }

    function beforeEach() {
        adminRegistry = new AdminRegistry();
        address[] admins = [address(this)];
        adminRegistry.initialize(admins);
        tokenFactory = new TokenFactory(address(adminRegistry));
        user = new ExternalBridgeUser();
        relayer = new ExternalBridgeUser();
        verifierOne = new ExternalBridgeUser();
        verifierTwo = new ExternalBridgeUser();
        verifierThree = new ExternalBridgeUser();

        bridge = ExternalAssetBridge(
            address(
                new Proxy(
                    address(new ExternalAssetBridge(address(0xdeadbeef))),
                    address(adminRegistry)
                )
            )
        );

        stratoToken = Token(
            tokenFactory.createTokenWithInitialOwner(
                "External USD",
                "xUSD",
                [],
                [],
                [],
                "xUSD",
                0,
                18,
                address(adminRegistry)
            )
        );
        stratoToken.setStatus(2);
        metalToken = Token(
            tokenFactory.createTokenWithInitialOwner(
                "Gold",
                "GOLD",
                [],
                [],
                [],
                "GOLD",
                0,
                18,
                address(adminRegistry)
            )
        );
        metalToken.setStatus(2);

        bridge.initialize(
            address(tokenFactory),
            address(relayer),
            address(user),
            address(stratoToken)
        );
        bridge.setChain(
            "External",
            externalVault,
            depositRouter,
            true,
            externalChainId,
            100
        );
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            true,
            18,
            "External USD",
            "xUSD",
            1000e18,
            100e18
        );

        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(stratoToken),
            "mint",
            address(bridge)
        );
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(stratoToken),
            "burn",
            address(bridge)
        );

        saveVault = new SaveUSDSTVault(address(this));
        saveVault.initialize(
            address(stratoToken),
            "Save External USD",
            "savexUSD"
        );

        oracle = new PriceOracle(address(this));
        oracle.initialize();
        bridge.setPriceOracle(address(oracle));
        FeeCollector feeCollector = new FeeCollector(address(this));
        metalForge = new MetalForge(address(this));
        metalForge.initialize(
            address(oracle),
            address(0xdead),
            address(feeCollector),
            address(stratoToken)
        );
        oracle.setAssetPrice(address(metalToken), 2000e18);
        metalForge.setMetalConfig(
            address(metalToken),
            true,
            1000000e18,
            0
        );
        metalForge.setPayToken(address(stratoToken), true);
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(metalToken),
            "mint",
            address(metalForge)
        );

        poolFactory = new PoolFactory(address(this));
        poolFactory.initialize(
            address(tokenFactory),
            address(adminRegistry),
            address(feeCollector)
        );
        poolV3Factory = new PoolV3Factory(address(this));
        poolV3Factory.initialize(
            address(tokenFactory),
            address(feeCollector)
        );
        directMintPsm = new DirectMintPSM(address(this));
        directMintPsm.initialize(
            address(stratoToken),
            address(feeCollector),
            [address(metalToken)]
        );
        tokenRouter = new TokenRouter(address(this));
        tokenRouter.initialize(
            address(poolFactory),
            address(poolV3Factory),
            address(directMintPsm),
            address(metalForge),
            address(saveVault)
        );
        bridge.setTokenRouter(address(tokenRouter));
        bridge.setDepositAction(
            externalToken,
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            true
        );
        bridge.setSettlementVerifier(address(verifierOne), true);
        bridge.setSettlementVerifier(address(verifierTwo), true);
        bridge.setSettlementVerifier(address(verifierThree), true);
        bridge.setSettlementVerifierThreshold(2);
        bridge.setMintPolicy(address(stratoToken), 1000000e18, 1000e18);
    }

    function _attestDeposit(
        address router,
        uint256 id,
        address sender,
        address token,
        uint256 amount,
        string txHash,
        address recipient,
        address targetToken,
        uint256 action,
        address actionToken,
        uint256 minFinalOut
    ) internal {
        verifierOne.do(
            address(bridge),
            "attestDepositSettlement",
            externalChainId,
            router,
            id,
            sender,
            token,
            amount,
            txHash,
            recipient,
            targetToken,
            action,
            actionToken,
            minFinalOut,
            bridge.depositGenerations(externalChainId, router, id)
        );
        verifierTwo.do(
            address(bridge),
            "attestDepositSettlement",
            externalChainId,
            router,
            id,
            sender,
            token,
            amount,
            txHash,
            recipient,
            targetToken,
            action,
            actionToken,
            minFinalOut,
            bridge.depositGenerations(externalChainId, router, id)
        );
    }

    function _attestWithdrawal(
        uint256 withdrawalId,
        string reservationId,
        string txHash
    ) internal {
        verifierOne.do(
            address(bridge),
            "attestWithdrawalRelease",
            withdrawalId,
            reservationId,
            txHash
        );
        verifierTwo.do(
            address(bridge),
            "attestWithdrawalRelease",
            withdrawalId,
            reservationId,
            txHash
        );
    }

    function it_initializes_once_with_separate_operator_and_guardian() {
        require(bridge.initialized(), "Bridge should initialize");
        require(
            bridge.bridgeOperator() == address(relayer),
            "Operator should initialize"
        );
        require(
            bridge.guardian() == address(user),
            "Guardian should initialize"
        );

        bool reverted = false;
        try bridge.initialize(
            address(tokenFactory),
            address(relayer),
            address(user),
            address(stratoToken)
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Second initialization should revert");
    }

    function it_atomically_settles_a_plain_deposit() {
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xABCDEF",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xABCDEF",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Recipient should receive minted route token"
        );
        (
            Status status,
            address storedSender,
            address storedExternalToken,
            uint256 storedExternalAmount,
            string storedTxHash,
            uint256 requestedAt,
            address storedRecipient,
            address storedStratoToken,
            uint256 storedStratoAmount,
            uint256 timestamp
        ) = bridge.deposits(
            externalChainId,
            depositRouter,
            1
        );
        require(
            status == Status.COMPLETED,
            "Deposit should complete"
        );
        require(
            storedSender == address(0x1111) &&
                storedExternalToken == externalToken &&
                storedExternalAmount == 25e18 &&
                storedTxHash == "0xabcdef" &&
                storedRecipient == address(user) &&
                storedStratoToken == address(stratoToken) &&
                storedStratoAmount == 25e18 &&
                timestamp >= requestedAt,
            "Deposit metadata should persist"
        );
    }

    function it_requires_threshold_attestations_and_allows_any_relayer() {
        bool reverted = false;
        try user.do(
            address(bridge),
            "attestDepositSettlement",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0,
            bridge.depositGenerations(externalChainId, depositRouter, 1)
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unknown verifier should not attest");

        verifierOne.do(
            address(bridge),
            "attestDepositSettlement",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0,
            bridge.depositGenerations(externalChainId, depositRouter, 1)
        );
        reverted = false;
        try user.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "One verifier should not authorize settlement");

        verifierTwo.do(
            address(bridge),
            "attestDepositSettlement",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0,
            bridge.depositGenerations(externalChainId, depositRouter, 1)
        );
        user.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            25e18,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Permissionless relayer should settle attested deposit"
        );
    }

    function it_applies_rebase_factor_to_inbound_mint_accounting() {
        address[] assets = [address(stratoToken)];
        uint256[] factors = [2e18];
        oracle.setRebaseFactors(assets, factors);
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            true,
            6,
            "External USD",
            "xUSD",
            1000e6,
            100e6
        );
        bridge.setRouteRebaseRequired(
            externalToken,
            externalChainId,
            address(stratoToken),
            true
        );
        bridge.setBridgeOperator(address(this));

        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e6,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        bridge.settleDeposit(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e6,
            "0xabcdef",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        require(
            stratoToken.balanceOf(address(user)) == 5e18,
            "Inbound rebase should divide the STRATO mint"
        );
        (
            ,
            ,
            ,
            uint256 storedExternalAmount,
            ,
            ,
            ,
            ,
            uint256 storedStratoAmount,

        ) = bridge.deposits(externalChainId, depositRouter, 1);
        require(
            storedExternalAmount == 10e6 && storedStratoAmount == 5e18,
            "Deposit should preserve raw external and rebased STRATO amounts"
        );
    }

    function it_does_not_block_an_ordinary_deposit_when_a_rebase_factor_is_missing() {
        address[] assets = [address(stratoToken)];
        uint256[] factors = [2e18];
        oracle.setRebaseFactors(assets, factors);
        bridge.setRouteRebaseRequired(
            externalToken,
            externalChainId,
            address(stratoToken),
            true
        );
        factors[0] = 0;
        oracle.setRebaseFactors(assets, factors);
        bridge.setBridgeOperator(address(this));

        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        try bridge.settleDeposit(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Missing rebase factor should reject its deposit");

        address ordinaryExternalToken = address(0x9999);
        bridge.setRoute(
            ordinaryExternalToken,
            externalChainId,
            address(stratoToken),
            true,
            true,
            18,
            "Ordinary",
            "ORD",
            1000e18,
            100e18
        );
        _attestDeposit(
            depositRouter,
            2,
            address(0x2222),
            ordinaryExternalToken,
            10e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        bridge.settleDeposit(
            externalChainId,
            depositRouter,
            2,
            address(0x2222),
            ordinaryExternalToken,
            10e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Ordinary deposit should settle independently"
        );
    }

    function it_preserves_action_intent_and_falls_back_to_route_token() {
        bridge.setDepositAction(
            externalToken,
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            false
        );
        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x1234",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );
        try user.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x1234",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unprivileged relayer should not force fallback");
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x1234",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x1234",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );

        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Failed optional action should mint fallback token"
        );
        (
            uint256 action,
            address actionToken,
            uint256 minFinalOut
        ) = bridge.depositActions(
            externalChainId,
            depositRouter,
            1
        );
        require(
            action == 0 &&
                actionToken == address(0) &&
                minFinalOut == 0,
            "Completed action intent should be deleted"
        );
    }

    function it_settles_multiple_deposits_from_one_external_transaction() {
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        _attestDeposit(
            depositRouter,
            2,
            address(0x1111),
            externalToken,
            15e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            2,
            address(0x1111),
            externalToken,
            15e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Both deposits should settle"
        );
    }

    function it_rejects_duplicate_router_deposit_ids() {
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        try relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Duplicate deposit identity should revert");
    }

    function it_reuses_an_aborted_deposit_id_after_a_reorg() {
        relayer.do(
            address(bridge),
            "recordDepositForReview",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        bridge.abortDeposit(externalChainId, depositRouter, 1);

        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x2222),
            externalToken,
            15e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        try relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x2222),
            externalToken,
            15e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Operator should not reuse an aborted identity");

        reverted = false;
        try relayer.do(
            address(bridge),
            "authorizeDepositReuse",
            externalChainId,
            depositRouter,
            1
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Only owner should authorize reuse");

        bridge.authorizeDepositReuse(externalChainId, depositRouter, 1);
        bool staleRejected = false;
        try relayer.do(address(bridge), "settleDeposit", externalChainId, depositRouter, 1,
            address(0x2222), externalToken, 15e18, "0xbbbb", address(user), address(stratoToken),
            uint256(DepositAction.NONE), address(0), 0) {} catch { staleRejected = true; }
        require(staleRejected, "Reuse must invalidate old attestations");
        staleRejected = false;
        try verifierOne.do(address(bridge), "attestDepositSettlement", externalChainId, depositRouter, 1,
            address(0x2222), externalToken, 15e18, "0xbbbb", address(user), address(stratoToken),
            uint256(DepositAction.NONE), address(0), 0, 0) {} catch { staleRejected = true; }
        require(staleRejected, "In-flight attestations must be bound to the old generation");
        _attestDeposit(depositRouter, 1, address(0x2222), externalToken, 15e18, "0xbbbb",
            address(user), address(stratoToken), uint256(DepositAction.NONE), address(0), 0);
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x2222),
            externalToken,
            15e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        require(
            stratoToken.balanceOf(address(user)) == 15e18,
            "Canonical replacement should settle"
        );
    }

    function it_rolls_back_identity_when_atomic_settlement_fails() {
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "removeWhitelist",
            address(stratoToken),
            "mint",
            address(bridge)
        );
        bool reverted = false;
        try relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Settlement failure should revert");

        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(stratoToken),
            "mint",
            address(bridge)
        );
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Failed settlement must not retain the identity"
        );
    }

    function it_keeps_previous_router_deposits_valid_after_rotation() {
        address nextRouter = address(0x8888);
        bridge.setChain(
            "External",
            externalVault,
            nextRouter,
            true,
            externalChainId,
            100
        );

        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0xaaaa",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        _attestDeposit(
            nextRouter,
            1,
            address(0x1111),
            externalToken,
            15e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            nextRouter,
            1,
            address(0x1111),
            externalToken,
            15e18,
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Old and new routers should settle independently"
        );
    }

    function _saveRoute(
        uint256 minAmountOut
    ) internal returns (RouteStep[] steps) {
        steps = new RouteStep[](1);
        RouteStep step;
        step.action = RouteAction.SAVE;
        step.target = address(saveVault);
        step.tokenIn = address(stratoToken);
        step.tokenOut = address(saveVault);
        step.minAmountOut = minAmountOut;
        steps[0] = step;
    }

    function it_executes_auto_route_and_delivers_the_final_token() {
        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        try user.do(
            address(bridge),
            "settleDepositWithRoute",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            10e18,
            _saveRoute(10e18)
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unprivileged relayer should not select route steps");
        bridge.setBridgeOperator(address(this));
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            10e18,
            _saveRoute(10e18)
        );

        require(
            saveVault.balanceOf(address(user)) == 10e18,
            "AUTO_ROUTE should deliver final tokens"
        );
        require(
            stratoToken.balanceOf(address(user)) == 0,
            "AUTO_ROUTE should not deliver fallback tokens"
        );
        require(
            bridge.depositRouteStepCounts(
                externalChainId,
                depositRouter,
                1
            ) == 0,
            "Completed route should be deleted"
        );
    }

    function it_executes_auto_route_for_the_native_external_token() {
        bridge.setBridgeOperator(address(this));
        bridge.setRoute(
            address(0),
            externalChainId,
            address(stratoToken),
            true,
            true,
            18,
            "Native",
            "NATIVE",
            1000e18,
            100e18
        );
        bridge.setDepositAction(
            address(0),
            externalChainId,
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            true
        );
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            address(0),
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            address(0),
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            10e18,
            _saveRoute(10e18)
        );

        require(
            saveVault.balanceOf(address(user)) == 10e18,
            "Native AUTO_ROUTE should deliver final tokens"
        );
        require(
            stratoToken.balanceOf(address(user)) == 0,
            "Native AUTO_ROUTE should not fall back"
        );
    }

    function it_falls_back_when_auto_route_misses_the_minimum() {
        bridge.setBridgeOperator(address(this));
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            11e18
        );
        bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            11e18,
            _saveRoute(1)
        );

        require(
            saveVault.balanceOf(address(user)) == 0,
            "Failed AUTO_ROUTE should revert output"
        );
        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Failed AUTO_ROUTE should mint fallback tokens"
        );
        require(
            stratoToken.balanceOf(address(bridge)) == 0,
            "Failed AUTO_ROUTE should not strand source tokens"
        );
    }

    function it_prevents_set_chain_from_rewinding_the_poll_cursor() {
        bridge.setChain("Test", externalVault, depositRouter, true, externalChainId, 100);
        bool reverted = false;
        try bridge.setChain("Test", externalVault, depositRouter, false, externalChainId, 99) {} catch {
            reverted = true;
        }
        require(reverted, "setChain must not rewind the cursor");
        bridge.setChain("Test", externalVault, depositRouter, false, externalChainId, 100);
        bridge.setChain("Test", externalVault, depositRouter, true, externalChainId, 101);
    }

    function it_surfaces_router_step_slippage_in_deposit_action_failed() {
        bridge.setBridgeOperator(address(this));
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );
        bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            1,
            _saveRoute(11e18)
        );

        require(
            bridge.lastDepositActionFailureReason() == "TR: step slippage",
            "Router require reason should surface in DepositActionFailed"
        );
        require(
            saveVault.balanceOf(address(user)) == 0,
            "Slippage should revert routed output"
        );
        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Slippage should mint fallback tokens"
        );
    }

    function it_surfaces_a_plain_router_revert_in_deposit_action_failed() {
        bridge.setBridgeOperator(address(this));
        bridge.setTokenRouter(address(new PlainRevertRouter()));
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );
        bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            1,
            _saveRoute(1)
        );

        require(
            bridge.lastDepositActionFailureReason() == "Unknown token router error",
            "Plain router revert should surface through the typed catch"
        );
        require(
            stratoToken.balanceOf(address(user)) == 10e18,
            "Plain router revert should mint fallback tokens"
        );
    }

    function it_reverts_a_routed_settlement_when_mint_policy_is_exhausted() {
        bridge.setBridgeOperator(address(this));
        bridge.setMintPolicy(address(stratoToken), 5e18, 1e18);
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            1
        );
        bool reverted = false;
        try bridge.settleDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x2345",
            address(user),
            address(stratoToken),
            address(saveVault),
            1,
            _saveRoute(1)
        ) {} catch {
            reverted = true;
        }
        require(reverted, "Mint-policy exhaustion during AUTO_ROUTE must revert the settlement");
        require(
            stratoToken.balanceOf(address(user)) == 0,
            "Exhausted mint policy must not deliver fallback tokens"
        );
        (Status status, , , , , , , , , ) = bridge.deposits(
            externalChainId,
            depositRouter,
            1
        );
        require(
            status == Status.NONE,
            "Failed mint must not persist a completed deposit"
        );
    }

    function it_executes_a_fresh_route_for_a_reviewed_deposit() {
        bridge.setBridgeOperator(address(this));
        bridge.recordDepositForReview(
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x3456",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        bool reverted = false;
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x3456",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        try user.do(
            address(bridge),
            "confirmReviewedDeposit",
            externalChainId,
            depositRouter,
            1
        ) {
        } catch {
            reverted = true;
        }
        require(
            reverted,
            "Unprivileged relayer should not force reviewed fallback"
        );
        bridge.approveReviewedDeposit(externalChainId, depositRouter, 1, bridge.getDepositSettlementDigest(
            externalChainId, depositRouter, 1, address(0x1111), externalToken, 10e18, "0x3456",
            address(user), address(stratoToken), uint256(DepositAction.AUTO_ROUTE), address(saveVault), 10e18
        ));
        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            10e18,
            "0x3456",
            address(user),
            address(stratoToken),
            uint256(DepositAction.AUTO_ROUTE),
            address(saveVault),
            10e18
        );
        bridge.confirmReviewedDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            _saveRoute(10e18)
        );

        require(
            saveVault.balanceOf(address(user)) == 10e18,
            "Reviewed route should deliver final tokens"
        );
    }

    function it_rejects_an_uninitialized_token_router() {
        TokenRouter uninitializedRouter = new TokenRouter(address(this));
        bool reverted = false;
        try bridge.setTokenRouter(address(uninitializedRouter)) {
        } catch {
            reverted = true;
        }
        require(reverted, "Uninitialized router should be rejected");
    }

    function it_keeps_deposit_and_withdrawal_route_controls_independent() {
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            false,
            18,
            "External USD",
            "xUSD",
            1000e18,
            100e18
        );

        _attestDeposit(
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            5e18,
            "0x5678",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );
        relayer.do(
            address(bridge),
            "settleDeposit",
            externalChainId,
            depositRouter,
            1,
            address(0x1111),
            externalToken,
            5e18,
            "0x5678",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0
        );

        bool reverted = false;
        try user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            5e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Disabled withdrawal should revert");
    }

    function it_allows_guardian_pause_but_only_owner_unpause() {
        user.do(address(bridge), "setPause", true, true);
        require(bridge.depositsPaused(), "Guardian should pause deposits");
        require(
            bridge.withdrawalsPaused(),
            "Guardian should pause withdrawals"
        );

        bool reverted = false;
        try user.do(address(bridge), "setPause", false, false) {
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian should not unpause");

        adminRegistry.castVoteOnIssue(
            address(bridge),
            "setPause",
            false,
            false
        );
        require(!bridge.depositsPaused(), "Owner should unpause deposits");
        require(
            !bridge.withdrawalsPaused(),
            "Owner should unpause withdrawals"
        );
    }

    function it_moves_withdrawal_from_escrow_to_ready_then_burns_after_release() {
        stratoToken.mint(address(user), 200e18);
        user.do(address(stratoToken), "approve", address(bridge), 200e18);

        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            150e18
        );

        (
            Status requestedStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool requiresManualReview,
            ,
            ,
            ,

        ) = bridge.withdrawals(withdrawalId);
        require(
            requestedStatus == Status.INITIATED,
            "Withdrawal should be requested"
        );
        require(
            requiresManualReview,
            "Amount above threshold should require review"
        );
        require(
            stratoToken.balanceOf(address(bridge)) == 150e18,
            "Bridge should escrow representation"
        );

        uint256 deadline = block.timestamp + 1800;
        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 7 * 24 * 60 * 60,
            "0xbbbb"
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            deadline,
            1
        );
        (
            uint256 authorizationNotBefore,
            uint256 authorizationDeadline,
            uint256 signerSetVersion,
            address authorizationVault
        ) = bridge.withdrawalAuthorizations(withdrawalId);
        require(
            authorizationNotBefore == block.timestamp &&
                authorizationDeadline == deadline &&
                signerSetVersion == 1 && authorizationVault == externalVault,
            "Withdrawal authorization should be persisted"
        );
        relayer.do(
            address(bridge),
            "recordWithdrawalReservation",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        );
        _attestWithdrawal(
            withdrawalId,
            "0xaaaa",
            "0xcccc"
        );
        user.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xcccc"
        );

        (
            Status completedStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            string externalTxHash,

        ) = bridge.withdrawals(withdrawalId);
        require(
            completedStatus == Status.COMPLETED,
            "Withdrawal should complete"
        );
        require(
            externalTxHash == "0xcccc",
            "External release hash should be recorded"
        );
        require(
            stratoToken.balanceOf(address(bridge)) == 0,
            "Escrow should burn only after release"
        );
        bool replayReverted = false;
        try {
            bridge.finalizeWithdrawal(withdrawalId, "0xaaaa", "0xcccc");
        } catch {
            replayReverted = true;
        }
        require(replayReverted, "Completed withdrawal settlement must not replay");
        bool refundReverted = false;
        try
            adminRegistry.castVoteOnIssue(
                address(bridge),
                "refundWithdrawal",
                withdrawalId
            )
        {
        } catch {
            refundReverted = true;
        }
        require(
            refundReverted,
            "Completed withdrawal should never be refundable"
        );
    }

    function it_requires_refund_attestations_even_after_operator_cancellation() {
        fastForward(2);
        RefundTestBridge refundBridge = new RefundTestBridge(address(this));
        refundBridge.seedRefund(address(stratoToken), address(user), externalVault);
        refundBridge.setSettlementVerifier(address(verifierOne), true);
        refundBridge.setSettlementVerifier(address(verifierTwo), true);
        refundBridge.setSettlementVerifierThreshold(2);
        stratoToken.mint(address(refundBridge), 100);
        bool rejected = false;
        try { refundBridge.refundWithdrawal(1); } catch { rejected = true; }
        require(rejected, "Refund without proof must fail");
        verifierOne.do(address(refundBridge), "attestWithdrawalRefund", 1, refundBridge.getWithdrawalRefundDigest(1));
        rejected = false;
        try { refundBridge.refundWithdrawal(1); } catch { rejected = true; }
        require(rejected, "One verifier must not authorize refund");
        verifierTwo.do(address(refundBridge), "attestWithdrawalRefund", 1, refundBridge.getWithdrawalRefundDigest(1));
        uint256 beforeBalance = stratoToken.balanceOf(address(user));
        refundBridge.refundWithdrawal(1);
        require(stratoToken.balanceOf(address(user)) == beforeBalance + 100, "Attested refund must return escrow");
        rejected = false;
        try { refundBridge.refundWithdrawal(1); } catch { rejected = true; }
        require(rejected, "Refund must not replay");
    }

    function it_applies_rebase_factor_to_external_withdrawal_amount() {
        address[] assets = [address(stratoToken)];
        uint256[] factors = [2e18];
        oracle.setRebaseFactors(assets, factors);
        bridge.setRoute(
            externalToken,
            externalChainId,
            address(stratoToken),
            true,
            true,
            6,
            "External USD",
            "xUSD",
            1000e6,
            100e6
        );
        bridge.setRouteRebaseRequired(
            externalToken,
            externalChainId,
            address(stratoToken),
            true
        );
        stratoToken.mint(address(user), 50e18);
        user.do(address(stratoToken), "approve", address(bridge), 50e18);

        factors[0] = 0;
        oracle.setRebaseFactors(assets, factors);
        bool reverted = false;
        try user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            50e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Rebase route should fail without a factor");

        factors[0] = 2e18;
        oracle.setRebaseFactors(assets, factors);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            50e18
        );
        (
            ,
            ,
            ,
            ,
            uint256 externalAmount,
            ,
            ,
            ,
            uint256 escrowedAmount,
            ,
            ,
            ,
            ,
            ,
            ,

        ) = bridge.withdrawals(withdrawalId);

        require(
            externalAmount == 100e6,
            "Withdrawal should apply inverse rebase"
        );
        require(
            escrowedAmount == 50e18,
            "Withdrawal should escrow STRATO amount"
        );
    }

    function it_records_and_rejects_large_withdrawal_review() {
        stratoToken.mint(address(user), 200e18);
        user.do(address(stratoToken), "approve", address(bridge), 200e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            150e18
        );

        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 7 * 24 * 60 * 60,
            "0xbbbb"
        );
        (
            string reviewDigest,
            uint256 approvalDeadline,
            string proposalHash
        ) = bridge.withdrawalManualReviews(withdrawalId);
        (Status pendingStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            pendingStatus == Status.PENDING_REVIEW &&
                reviewDigest == "0xaaaa" &&
                approvalDeadline == block.timestamp + 7 * 24 * 60 * 60 &&
                proposalHash == "0xbbbb",
            "Manual review should be persisted"
        );

        relayer.do(
            address(bridge),
            "rejectWithdrawalReview",
            withdrawalId
        );
        (Status rejectedStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            rejectedStatus == Status.ABORTED,
            "Rejected withdrawal should abort"
        );
        require(
            stratoToken.balanceOf(address(user)) == 200e18,
            "Rejected withdrawal should refund escrow"
        );
    }

    function it_refreshes_signer_set_only_for_live_unreserved_withdrawals() {
        stratoToken.mint(address(user), 20e18);
        user.do(address(stratoToken), "approve", address(bridge), 20e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            10e18
        );
        uint256 deadline = block.timestamp + 1800;
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            deadline,
            1
        );

        bool reverted = false;
        try user.do(
            address(bridge),
            "refreshWithdrawalSignerSet",
            withdrawalId,
            2
        ) {} catch { reverted = true; }
        require(reverted, "Only the operator may refresh the signer set");

        reverted = false;
        try relayer.do(
            address(bridge),
            "refreshWithdrawalSignerSet",
            withdrawalId,
            1
        ) {} catch { reverted = true; }
        require(reverted, "Refresh must require a newer signer set");

        relayer.do(
            address(bridge),
            "refreshWithdrawalSignerSet",
            withdrawalId,
            2
        );
        (
            ,
            uint256 refreshedDeadline,
            uint256 signerSetVersion,

        ) = bridge.withdrawalAuthorizations(withdrawalId);
        require(
            signerSetVersion == 2 && refreshedDeadline == deadline,
            "Refresh must move the signer set forward without touching the window"
        );

        relayer.do(
            address(bridge),
            "recordWithdrawalReservation",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        );
        reverted = false;
        try relayer.do(
            address(bridge),
            "refreshWithdrawalSignerSet",
            withdrawalId,
            3
        ) {} catch { reverted = true; }
        require(reverted, "Reserved withdrawal must not refresh");

        uint256 secondId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            10e18
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            secondId,
            block.timestamp,
            block.timestamp + 10,
            1
        );
        fastForward(11);
        reverted = false;
        try relayer.do(
            address(bridge),
            "refreshWithdrawalSignerSet",
            secondId,
            2
        ) {} catch { reverted = true; }
        require(reverted, "Expired authorization must not refresh");
    }

    function it_records_verifier_initiated_review_below_route_threshold() {
        stratoToken.mint(address(user), 200e18);
        user.do(address(stratoToken), "approve", address(bridge), 200e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            50e18
        );
        (
            Status requestedStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool requestedReviewFlag,
            ,
            ,
            ,

        ) = bridge.withdrawals(withdrawalId);
        require(
            requestedStatus == Status.INITIATED && !requestedReviewFlag,
            "Amount below route threshold should not require review"
        );

        // A local verifier policy may demand review below the route
        // threshold; recording the review flips the flag so the withdrawal
        // inherits the standard review lifecycle.
        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 7 * 24 * 60 * 60,
            "0xbbbb"
        );
        (
            Status pendingStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool pendingReviewFlag,
            ,
            ,
            ,

        ) = bridge.withdrawals(withdrawalId);
        require(
            pendingStatus == Status.PENDING_REVIEW && pendingReviewFlag,
            "Verifier-initiated review should mark the withdrawal as reviewed"
        );

        uint256 deadline = block.timestamp + 1800;
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            deadline,
            1
        );
        (Status readyStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            readyStatus == Status.READY,
            "Approved review should authorize the withdrawal"
        );

        bool reviewAfterReady = false;
        try
            relayer.do(
                address(bridge),
                "recordWithdrawalReview",
                withdrawalId,
                "0xcccc",
                block.timestamp + 7 * 24 * 60 * 60,
                "0xdddd"
            )
        {} catch {
            reviewAfterReady = true;
        }
        require(
            reviewAfterReady,
            "Review must not be recordable once authorized"
        );
    }

    function it_lets_anyone_expire_a_stale_withdrawal_review() {
        stratoToken.mint(address(user), 150e18);
        user.do(address(stratoToken), "approve", address(bridge), 150e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            150e18
        );
        relayer.do(
            address(bridge),
            "recordWithdrawalReview",
            withdrawalId,
            "0xaaaa",
            block.timestamp + 100,
            "0xbbbb"
        );

        bool expiredEarly = false;
        try user.do(address(bridge), "expireWithdrawalReview", withdrawalId) {}
        catch { expiredEarly = true; }
        require(expiredEarly, "Active review must not expire");

        bool rejectedByUser = false;
        try user.do(address(bridge), "rejectWithdrawalReview", withdrawalId) {}
        catch { rejectedByUser = true; }
        require(rejectedByUser, "Users must not reject an active review");

        ExternalBridgeUser stranger = new ExternalBridgeUser();
        fastForward(100);
        bool expiredAtDeadline = false;
        try stranger.do(address(bridge), "expireWithdrawalReview", withdrawalId) {}
        catch { expiredAtDeadline = true; }
        require(expiredAtDeadline, "Review must remain active at its deadline");

        fastForward(1);
        stranger.do(address(bridge), "expireWithdrawalReview", withdrawalId);
        (Status initiatedStatus, , , , , , , , , , , , , , , ) = bridge
            .withdrawals(withdrawalId);
        require(
            initiatedStatus == Status.INITIATED,
            "Expired review should return to initiated"
        );

        (string reviewDigest, uint256 approvalDeadline, string proposalHash) = bridge
            .withdrawalManualReviews(withdrawalId);
        require(reviewDigest == "", "Expired review digest should be cleared");
        require(approvalDeadline == 0, "Expired review deadline should be cleared");
        require(proposalHash == "", "Expired review proposal should be cleared");
        require(
            stratoToken.balanceOf(address(bridge)) == 150e18,
            "Expiring review must preserve escrow"
        );

        bool expiredTwice = false;
        try stranger.do(address(bridge), "expireWithdrawalReview", withdrawalId) {}
        catch { expiredTwice = true; }
        require(expiredTwice, "An initiated withdrawal has no review to expire");

        bool abortedEarly = false;
        try user.do(address(bridge), "abortWithdrawal", withdrawalId) {}
        catch { abortedEarly = true; }
        require(abortedEarly, "Expiring review must not bypass the abort delay");

        fastForward(172699);
        bool abortedByStranger = false;
        try stranger.do(address(bridge), "abortWithdrawal", withdrawalId) {}
        catch { abortedByStranger = true; }
        require(abortedByStranger, "Only the sender may reclaim without operator privileges");
        user.do(address(bridge), "abortWithdrawal", withdrawalId);
        require(
            stratoToken.balanceOf(address(user)) == 150e18,
            "Sender should reclaim escrow after the review expires"
        );
    }

    function it_allows_requested_reclaim_but_blocks_ready_reclaim() {
        stratoToken.mint(address(user), 100e18);
        user.do(address(stratoToken), "approve", address(bridge), 100e18);
        bridge.setWithdrawalAbortDelay(0);

        uint256 requestedId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        user.do(address(bridge), "abortWithdrawal", requestedId);

        uint256 readyId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            readyId,
            block.timestamp,
            block.timestamp + 1800,
            1
        );

        fastForward(1801);
        bool expiredReady = false;
        try user.do(address(bridge), "expireWithdrawalReview", readyId) {}
        catch { expiredReady = true; }
        require(expiredReady, "Review expiry must not reset a ready withdrawal");

        bool reverted = false;
        try user.do(address(bridge), "abortWithdrawal", readyId) {
        } catch {
            reverted = true;
        }
        require(reverted, "Ready withdrawal should not be reclaimable");
    }

    function it_does_not_finalize_without_a_matching_vault_reservation() {
        stratoToken.mint(address(user), 25e18);
        user.do(address(stratoToken), "approve", address(bridge), 25e18);
        uint256 withdrawalId = user.do(
            address(bridge),
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            externalToken,
            address(stratoToken),
            25e18
        );
        relayer.do(
            address(bridge),
            "markWithdrawalReady",
            withdrawalId,
            block.timestamp,
            block.timestamp + 1800,
            1
        );

        bool reverted = false;
        try verifierOne.do(
            address(bridge),
            "attestWithdrawalRelease",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        ) {} catch {
            reverted = true;
        }
        require(reverted, "Verifier must reject a mismatched reservation");
        reverted = false;
        try relayer.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unreserved withdrawal should not finalize");
        require(
            stratoToken.balanceOf(address(bridge)) == 25e18,
            "Failed finalization should preserve escrow"
        );
    }
    function it_finalizes_multiple_releases_in_one_transaction_despite_cancellation_metadata() {
        stratoToken.mint(address(user), 20e18);
        user.do(address(stratoToken), "approve", address(bridge), 20e18);
        bool cancellationOverwritten = false;
        for (uint256 i = 1; i <= 2; i++) {
            uint256 id = user.do(address(bridge), "requestWithdrawal", externalChainId,
                externalRecipient, externalToken, address(stratoToken), 10e18);
            relayer.do(address(bridge), "markWithdrawalReady", id, block.timestamp, block.timestamp + 10, 1);
            string reservation = i == 1 ? "0xaaaa" : "0xbbbb";
            relayer.do(address(bridge), "recordWithdrawalReservation", id, reservation, "0xdddd");
            fastForward(11);
            relayer.do(address(bridge), "recordWithdrawalCancellation", id, reservation, "0xeeee");
            // The refund digest binds the recorded hash, so the record is
            // one-shot: a repeat submission must not overwrite it.
            cancellationOverwritten = false;
            try relayer.do(address(bridge), "recordWithdrawalCancellation", id, reservation, "0xffff") {}
            catch { cancellationOverwritten = true; }
            require(cancellationOverwritten, "Cancellation record must be one-shot");
            _attestWithdrawal(id, reservation, "0xcccc");
            bridge.finalizeWithdrawal(id, reservation, "0xcccc");
        }
        require(stratoToken.balanceOf(address(bridge)) == 0, "Both released withdrawals must finalize and burn escrow");
    }

    function it_requires_governance_approval_for_reviewed_plain_deposits() {
        relayer.do(address(bridge), "recordDepositForReview", externalChainId, depositRouter, 1,
            address(0x1111), externalToken, 10e18, "0xaaaa", address(user), address(stratoToken),
            uint256(DepositAction.NONE), address(0), 0);
        _attestDeposit(depositRouter, 1, address(0x1111), externalToken, 10e18,
            "0xaaaa", address(user), address(stratoToken), uint256(DepositAction.NONE), address(0), 0);
        bytes32 digest = bridge.getDepositSettlementDigest(externalChainId, depositRouter, 1,
            address(0x1111), externalToken, 10e18, "0xaaaa", address(user), address(stratoToken),
            uint256(DepositAction.NONE), address(0), 0);
        bool reverted = false;
        try user.do(address(bridge), "confirmReviewedDeposit", externalChainId, depositRouter, 1) {}
        catch { reverted = true; }
        require(reverted, "Attestations must not substitute for governance review");
        reverted = false;
        try relayer.do(address(bridge), "approveReviewedDeposit", externalChainId, depositRouter, 1, digest) {}
        catch { reverted = true; }
        require(reverted, "Operator must not approve its own review");
        bridge.approveReviewedDeposit(externalChainId, depositRouter, 1, digest);
        user.do(address(bridge), "confirmReviewedDeposit", externalChainId, depositRouter, 1);
        require(stratoToken.balanceOf(address(user)) == 10e18, "Approved review must settle");
    }

    function it_bounds_governance_recovery_delays() {
        bool reverted = false;
        try bridge.setWithdrawalAbortDelay(172801) {} catch { reverted = true; }
        require(reverted, "Abort delay must be bounded");
        reverted = false;
        try bridge.setMaxAuthorizationValiditySeconds(1801) {} catch { reverted = true; }
        require(reverted, "Authorization validity must be bounded");
    }

    function it_rejects_future_ready_authorizations_without_locking_escrow() {
        stratoToken.mint(address(user), 10e18);
        user.do(address(stratoToken), "approve", address(bridge), 10e18);
        uint256 id = user.do(address(bridge), "requestWithdrawal", externalChainId,
            externalRecipient, externalToken, address(stratoToken), 10e18);
        bool reverted = false;
        try relayer.do(address(bridge), "markWithdrawalReady", id, block.timestamp + 1000000, block.timestamp + 1000010, 1) {}
        catch { reverted = true; }
        require(reverted, "Operator must not lock a withdrawal behind a future authorization");
        fastForward(172801);
        user.do(address(bridge), "abortWithdrawal", id);
        require(stratoToken.balanceOf(address(user)) == 10e18, "Rejected READY transition must preserve abort");
    }

    function it_rejects_non_18_decimal_representations() {
        address lowDecimalToken = tokenFactory.createTokenWithInitialOwner("Low", "LOW", [], [], [], "LOW", 0, 6, address(adminRegistry));
        Token(lowDecimalToken).setStatus(2);
        bool reverted = false;
        try bridge.setRoute(externalToken, externalChainId, lowDecimalToken, true, true, 6, "Low", "LOW", 100, 10) {}
        catch { reverted = true; }
        require(reverted, "Non-18 representation must not be configured");
    }

    function it_requires_token_unpause_before_returning_withdrawal_escrow() {
        stratoToken.mint(address(user), 10e18);
        user.do(address(stratoToken), "approve", address(bridge), 10e18);
        uint256 id = user.do(address(bridge), "requestWithdrawal", externalChainId,
            externalRecipient, externalToken, address(stratoToken), 10e18);
        stratoToken.pause();
        fastForward(172801);
        bool reverted = false;
        try user.do(address(bridge), "abortWithdrawal", id) {} catch { reverted = true; }
        require(reverted, "Token pause must block escrow refunds");
        require(stratoToken.balanceOf(address(user)) == 0, "Failed refund must not return tokens");
        require(stratoToken.balanceOf(address(bridge)) == 10e18, "Failed refund must preserve escrow");
        stratoToken.unpause();
        user.do(address(bridge), "abortWithdrawal", id);
        require(stratoToken.balanceOf(address(user)) == 10e18, "Unpausing must allow the escrow refund");
        require(stratoToken.balanceOf(address(bridge)) == 0, "Refund must empty escrow");
    }

    function it_limits_all_mints_and_preserves_consumption_on_policy_updates() {
        bridge.setMintPolicy(address(stratoToken), 10e18, 1e18);
        _attestDeposit(depositRouter, 1, address(0x1111), externalToken, 6e18, "0xaaaa",
            address(user), address(stratoToken), uint256(DepositAction.NONE), address(0), 0);
        relayer.do(address(bridge), "settleDeposit", externalChainId, depositRouter, 1, address(0x1111), externalToken, 6e18,
            "0xaaaa", address(user), address(stratoToken), uint256(DepositAction.NONE), address(0), 0);
        bridge.setMintPolicy(address(stratoToken), 10e18, 1e18);
        _attestDeposit(depositRouter, 2, address(0x1111), externalToken, 6e18, "0xbbbb",
            address(user), address(stratoToken), uint256(DepositAction.AUTO_ROUTE), address(metalToken), 1);
        bool rejected = false;
        try relayer.do(address(bridge), "settleDeposit", externalChainId, depositRouter, 2, address(0x1111), externalToken, 6e18,
            "0xbbbb", address(user), address(stratoToken), uint256(DepositAction.AUTO_ROUTE), address(metalToken), 1) {} catch { rejected = true; }
        require(rejected, "Fallback mint must share the plain mint limit; resetting policy must not refill it");
        require(stratoToken.balanceOf(address(user)) == 6e18, "Failed mint must be atomic");
        fastForward(2);
        relayer.do(address(bridge), "settleDeposit", externalChainId, depositRouter, 2, address(0x1111), externalToken, 6e18,
            "0xbbbb", address(user), address(stratoToken), uint256(DepositAction.AUTO_ROUTE), address(metalToken), 1);
        require(stratoToken.balanceOf(address(user)) == 12e18, "Elapsed refill must permit retry");
    }

    function it_rejects_refund_attestations_for_a_changed_source_digest() {
        fastForward(2);
        RefundTestBridge refundBridge = new RefundTestBridge(address(this));
        refundBridge.seedRefund(address(stratoToken), address(user), externalVault);
        refundBridge.setSettlementVerifier(address(verifierOne), true);
        bytes32 digest = refundBridge.getWithdrawalRefundDigest(1);
        refundBridge.seedRefund(address(stratoToken), address(relayer), externalVault);
        bool rejected = false;
        try verifierOne.do(address(refundBridge), "attestWithdrawalRefund", 1, digest) {} catch { rejected = true; }
        require(rejected, "Verifier must never attest different source state than it validated");
    }

}
