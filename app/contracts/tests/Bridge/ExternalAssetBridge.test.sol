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
        bridge.setMetalForge(address(metalForge));

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
    }

    function _depositSignatures(
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
    ) internal returns (bytes) {
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
            minFinalOut
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
            minFinalOut
        );
        return new bytes(0);
    }

    function _withdrawalSignatures(
        uint256 withdrawalId,
        string reservationId,
        string txHash
    ) internal returns (bytes) {
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
        return new bytes(0);
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
            0,
            _depositSignatures(
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
            )
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
            0
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
            0
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
            0,
            new bytes(0)
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
            0
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
            0,
            new bytes(0)
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
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            1,
            _depositSignatures(
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
            )
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unprivileged relayer should not force fallback");
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
            1,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
        );

        require(
            stratoToken.balanceOf(address(user)) == 25e18,
            "Both deposits should settle"
        );
    }

    function it_rejects_duplicate_router_deposit_ids() {
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
            0,
            _depositSignatures(
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
            )
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
            "0xbbbb",
            address(user),
            address(stratoToken),
            uint256(DepositAction.NONE),
            address(0),
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            0,
            new bytes(0)
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
            0,
            new bytes(0)
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
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            _saveRoute(10e18),
            _depositSignatures(
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
            )
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Unprivileged relayer should not select route steps");
        bridge.setBridgeOperator(address(this));
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
            _saveRoute(10e18),
            _depositSignatures(
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
            )
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

    function it_falls_back_when_auto_route_misses_the_minimum() {
        bridge.setBridgeOperator(address(this));
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
            _saveRoute(1),
            _depositSignatures(
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
            )
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
        try user.do(
            address(bridge),
            "confirmReviewedDeposit",
            externalChainId,
            depositRouter,
            1,
            _depositSignatures(
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
            )
        ) {
        } catch {
            reverted = true;
        }
        require(
            reverted,
            "Unprivileged relayer should not force reviewed fallback"
        );
        bridge.confirmReviewedDepositWithRoute(
            externalChainId,
            depositRouter,
            1,
            _saveRoute(10e18),
            _depositSignatures(
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
            )
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
            0,
            _depositSignatures(
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
            )
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
            uint256 signerSetVersion
        ) = bridge.withdrawalAuthorizations(withdrawalId);
        require(
            authorizationNotBefore == block.timestamp &&
                authorizationDeadline == deadline &&
                signerSetVersion == 1,
            "Withdrawal authorization should be persisted"
        );
        relayer.do(
            address(bridge),
            "recordWithdrawalReservation",
            withdrawalId,
            "0xaaaa",
            "0xbbbb"
        );
        user.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xcccc",
            _withdrawalSignatures(
                withdrawalId,
                "0xaaaa",
                "0xcccc"
            )
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
        try relayer.do(
            address(bridge),
            "finalizeWithdrawal",
            withdrawalId,
            "0xaaaa",
            "0xbbbb",
            _withdrawalSignatures(
                withdrawalId,
                "0xaaaa",
                "0xbbbb"
            )
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
}
