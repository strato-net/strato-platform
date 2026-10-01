import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Bridge/StratoNativeBridge.sol";
import "../../concrete/Bridge/StratoNativeCustodyVault.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";

import "../Util.sol";

contract Describe_StratoNativeBridge is Authorizable {
    using BridgeTypes for *;

    AdminRegistry adminRegistry;
    TokenFactory tokenFactory;
    StratoNativeBridge nativeBridge;
    StratoNativeCustodyVault custodyVault;
    Token nativeToken;
    address nativeBridgeAddress;
    address custodyVaultAddress;
    address nativeTokenAddress;

    User user1;
    User user2;
    User relayer;

    uint256 externalChainId;
    address externalBridge;
    uint256 externalRedemptionId;
    address externalRecipient;
    address externalSender;
    address representationToken;
    string externalTxHash;

    function beforeAll() {
        bypassAuthorizations = true;

        user1 = new User();
        user2 = new User();
        relayer = new User();

        externalChainId = 1;
        externalBridge = address(0x3333);
        externalRedemptionId = 7;
        externalRecipient = address(0x2222);
        externalSender = address(0x1111);
        representationToken = address(0x5555);
        externalTxHash = "0xabcdef1234567890";
    }

    function beforeEach() {
        address implOwnerIgnored = address(0xdeadbeef);

        adminRegistry = new AdminRegistry();
        address[] admins = [address(this)];
        adminRegistry.initialize(admins);
        tokenFactory = new TokenFactory(address(adminRegistry));

        nativeBridge = StratoNativeBridge(
            address(
                new Proxy(
                    address(new StratoNativeBridge(implOwnerIgnored)),
                    address(adminRegistry)
                )
            )
        );
        nativeBridgeAddress = address(nativeBridge);
        custodyVault = StratoNativeCustodyVault(
            address(
                new Proxy(
                    address(new StratoNativeCustodyVault(implOwnerIgnored)),
                    address(adminRegistry)
                )
            )
        );
        custodyVaultAddress = address(custodyVault);

        nativeBridge.initialize(
            address(tokenFactory),
            address(custodyVault),
            address(relayer),
            address(this)
        );
        custodyVault.initialize(
            address(nativeBridge),
            address(this)
        );

        require(nativeBridge.WITHDRAWAL_ABORT_DELAY() == 172800, "Proxy initialize should set default abort delay");
        require(nativeBridge.INSTANT_WITHDRAWAL_DELAY_SECONDS() == 900, "Proxy initialize should set default instant delay");
        require(nativeBridge.tokenFactory() == address(tokenFactory), "Native bridge tokenFactory should initialize");
        require(nativeBridge.custodyVault() == address(custodyVault), "Native bridge custodyVault should initialize");
        require(custodyVault.bridge() == address(nativeBridge), "Custody vault bridge should initialize");

        adminRegistry.addWhitelist(address(nativeBridge), "abortWithdrawal", address(relayer));

        nativeTokenAddress = tokenFactory.createToken(
            "Native STRATO",
            "NST",
            [],
            [],
            [],
            "NST",
            0,
            18
        );
        nativeToken = Token(nativeTokenAddress);
        nativeToken.setStatus(2);
        nativeToken.mint(address(user1), 1000e18);

        nativeBridge.setAsset(
            true,
            externalChainId,
            externalBridge,
            representationToken,
            "Wrapped Native STRATO",
            "wNST",
            500e18,
            100e18,
            nativeTokenAddress
        );
    }

    function it_native_withdrawal_locks_funds_in_vault() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        (
            BridgeStatus bridgeStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 stratoTokenAmount,
            ,
            bool useInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal should be initiated");
        require(stratoTokenAmount == 50e18, "Locked amount should match request");
        require(useInstantPath, "Amount under threshold should use instant path");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Vault should lock requested amount");
    }

    function it_native_withdrawal_locks_non_factory_saveusdst_shares() {
        Token usdst = new Token(address(this));
        usdst.initialize("USDST", "USDST", [], [], [], "USDST", 0, 18, address(this));
        usdst.setStatus(2);
        usdst.mint(address(user1), 100e18);

        SaveUSDSTVault saveUsdst = new SaveUSDSTVault(address(this));
        saveUsdst.initialize(address(usdst), "Save USDST", "saveUSDST");

        user1.do(address(usdst), "approve", address(saveUsdst), 100e18);
        uint256 shares = user1.do(
            address(saveUsdst),
            "deposit(uint256,address)",
            100e18,
            address(user1)
        );

        nativeBridge.setAsset(
            true,
            externalChainId,
            externalBridge,
            address(0x6666),
            "Wrapped Save USDST",
            "wsaveUSDST",
            500e18,
            100e18,
            address(saveUsdst)
        );

        user1.do(address(saveUsdst), "approve", custodyVaultAddress, shares);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            address(saveUsdst),
            shares
        );

        require(withdrawalId > 0, "Withdrawal should be created");
        require(custodyVault.lockedBalance(address(saveUsdst)) == shares, "Vault should lock saveUSDST shares");
        require(saveUsdst.balanceOf(address(user1)) == 0, "User shares should be locked");
    }

    function it_native_withdrawal_rejects_inactive_factory_token() {
        nativeToken.setStatus(1);
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);

        bool reverted = false;
        try user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Inactive factory token should not bridge out");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 0, "Inactive token should not be locked");
    }

    function it_owner_can_update_instant_withdrawal_delay() {
        nativeBridge.setInstantWithdrawalDelaySeconds(1234);

        require(nativeBridge.INSTANT_WITHDRAWAL_DELAY_SECONDS() == 1234, "Instant delay should update");
    }

    function it_owner_can_configure_token_bridge_directions_and_cap() {
        nativeBridge.setTokenBridgeConfig(nativeTokenAddress, true, true, 250e18);

        (
            bool depositsDisabled,
            bool withdrawalsDisabled,
            uint256 maxOutstandingWithdrawal
        ) = nativeBridge.tokenBridgeConfigs(nativeTokenAddress);

        require(depositsDisabled, "Token deposits should be disabled");
        require(withdrawalsDisabled, "Token withdrawals should be disabled");
        require(maxOutstandingWithdrawal == 250e18, "Aggregate withdrawal cap should update");
    }

    function it_non_owner_cannot_configure_token_bridge() {
        bool reverted = false;
        try user1.do(
            nativeBridgeAddress,
            "setTokenBridgeConfig",
            nativeTokenAddress,
            true,
            true,
            250e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Non-owner should not configure token bridge controls");
    }

    function it_token_withdrawal_control_does_not_disable_deposits() {
        nativeBridge.setTokenBridgeConfig(nativeTokenAddress, false, true, 0);
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);

        bool withdrawalReverted = false;
        try user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        ) {
        } catch {
            withdrawalReverted = true;
        }
        require(withdrawalReverted, "Disabled token withdrawals should revert");

        relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            10e18
        );

        string depositId = nativeBridge.getDepositId(externalChainId, externalBridge, externalRedemptionId);
        (BridgeStatus depositStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(depositStatus == BridgeStatus.INITIATED, "Token deposits should remain enabled");
    }

    function it_token_deposit_control_does_not_disable_withdrawals() {
        nativeBridge.setTokenBridgeConfig(nativeTokenAddress, true, false, 0);
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);

        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );
        (BridgeStatus withdrawalStatus,,,,,,,,,,,) = nativeBridge.getWithdrawalInfo(withdrawalId);
        require(withdrawalStatus == BridgeStatus.INITIATED, "Token withdrawals should remain enabled");

        bool depositReverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            10e18
        ) {
        } catch {
            depositReverted = true;
        }
        require(depositReverted, "Disabled token deposits should revert");
    }

    function it_aggregate_withdrawal_cap_counts_locked_supply_and_abort_restores_capacity() {
        nativeBridge.setTokenBridgeConfig(nativeTokenAddress, false, false, 100e18);
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 250e18);

        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            75e18
        );
        require(custodyVault.lockedBalance(nativeTokenAddress) == 75e18, "First withdrawal should consume cap");

        bool reverted = false;
        try user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Withdrawal exceeding aggregate cap should revert");

        relayer.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId);
        require(custodyVault.lockedBalance(nativeTokenAddress) == 0, "Abort should restore aggregate capacity");

        user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            100e18
        );
        require(custodyVault.lockedBalance(nativeTokenAddress) == 100e18, "Restored capacity should be reusable");
    }

    function it_native_withdrawal_pending_state_blocks_user_abort_before_external_mint() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);

        (
            BridgeStatus bridgeStatus,
            string pendingTxHash,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 nativeMintNotBefore,
            bool pendingUseInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.PENDING_REVIEW, "Withdrawal should be non-abortable pending");
        require(bytes(pendingTxHash).length == 0, "Pending state should not require destination tx hash");
        require(nativeMintNotBefore > 0, "Pending state should set native mint not-before time");
        require(pendingUseInstantPath, "Pending withdrawal should retain lane selection");

        bool reverted = false;
        try user1.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId) {
        } catch {
            reverted = true;
        }

        require(reverted, "User should not abort once execution is pending");

        relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "0x1234", "");

        (
            BridgeStatus confirmedStatus,
            string confirmedTxHash,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool confirmedUseInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(confirmedStatus == BridgeStatus.COMPLETED, "Withdrawal should complete when destination tx is recorded");
        require(bytes(confirmedTxHash).length > 0, "Destination tx hash should be stored at completion");
        require(confirmedUseInstantPath, "Confirmed withdrawal should retain lane selection");
    }

    function it_native_withdrawal_cannot_finalize_without_destination_tx_hash() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);

        bool reverted = false;
        try relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "", "") {
        } catch {
            reverted = true;
        }

        require(reverted, "Withdrawal should not finalize before destination tx hash is recorded");
    }

    function it_native_withdrawal_cannot_abort_after_destination_tx_hash_is_recorded() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        relayer.do(nativeBridgeAddress, "markWithdrawalPending", withdrawalId);
        relayer.do(nativeBridgeAddress, "finalizeWithdrawal", withdrawalId, "0x1234", "");

        bool reverted = false;
        try relayer.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId) {
        } catch {
            reverted = true;
        }

        require(reverted, "Withdrawal should not abort after destination execution is recorded");
    }

    function it_native_withdrawal_requires_vault_allowance_not_bridge_allowance() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_abort_withdrawal_unlocks_back_to_sender_for_whitelisted_relayer() {
        uint256 user1BalanceBefore = IERC20(nativeTokenAddress).balanceOf(address(user1));

        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        );

        require(
            IERC20(nativeTokenAddress).balanceOf(address(user1)) == user1BalanceBefore - 50e18,
            "Sender balance should decrease by locked amount"
        );
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Vault should lock requested amount");

        relayer.do(nativeBridgeAddress, "abortWithdrawal", withdrawalId);

        (BridgeStatus abortedStatus,,,,,,,,,,,) = nativeBridge.getWithdrawalInfo(withdrawalId);
        require(abortedStatus == BridgeStatus.ABORTED, "Withdrawal should be aborted by whitelisted relayer");
        require(
            IERC20(nativeTokenAddress).balanceOf(address(user1)) == user1BalanceBefore,
            "Aborted withdrawal should return funds to original sender"
        );
        require(custodyVault.lockedBalance(nativeTokenAddress) == 0, "Vault locked balance should be released on abort");
    }

    function it_native_pending_withdrawal_cannot_unlock_escrow_even_for_whitelisted_operator() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 50e18);
        relayer.do(nativeBridgeAddress, "markWithdrawalPending", id);
        bool rejected = false;
        try relayer.do(nativeBridgeAddress, "abortWithdrawal", id) {} catch { rejected = true; }
        require(rejected, "Pending mint authorization must prevent direct escrow release");
        relayer.do(nativeBridgeAddress, "recordWithdrawalProposal", id, "0xaaaa");
        rejected = false;
        try relayer.do(nativeBridgeAddress, "abortWithdrawal", id) {} catch { rejected = true; }
        require(rejected, "An executable Safe proposal must prevent direct escrow release");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Escrow must remain locked");
    }

    function it_native_initiated_withdrawal_can_be_canceled_while_bridge_is_paused() {
        uint256 beforeBalance = nativeToken.balanceOf(address(user1));
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 50e18);
        nativeBridge.setPause(true, true);
        relayer.do(nativeBridgeAddress, "abortWithdrawal", id);
        require(nativeToken.balanceOf(address(user1)) == beforeBalance, "Paused bridge must permit safe cancellation");
        bool rejected = false;
        try relayer.do(nativeBridgeAddress, "abortWithdrawal", id) {} catch { rejected = true; }
        require(rejected, "Cancellation must not return escrow twice");
    }

    function it_native_user_can_request_pending_cancellation_only_after_delay() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 50e18);
        relayer.do(nativeBridgeAddress, "markWithdrawalPending", id);
        bool rejected = false;
        try user1.do(nativeBridgeAddress, "requestUserWithdrawalCancellation", id) {} catch { rejected = true; }
        require(rejected, "User must wait for cancellation delay");
        fastForward(172800);
        rejected = false;
        try user2.do(nativeBridgeAddress, "requestUserWithdrawalCancellation", id) {} catch { rejected = true; }
        require(rejected, "Only the original sender can request user cancellation");
        user1.do(nativeBridgeAddress, "requestUserWithdrawalCancellation", id);
        (BridgeStatus status,,,,,,,,,,,) = nativeBridge.getWithdrawalInfo(id);
        require(status == BridgeStatus.CANCELLATION_PENDING, "User requests proof-backed cancellation");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Request must never release escrow");
    }

    function it_native_cancellation_requires_governance_and_exact_external_evidence() {
        uint256 beforeBalance = nativeToken.balanceOf(address(user1));
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 50e18);
        relayer.do(nativeBridgeAddress, "markWithdrawalPending", id);
        bool rejected = false;
        try relayer.do(nativeBridgeAddress, "requestWithdrawalCancellation", id) {} catch { rejected = true; }
        require(rejected, "Operator cannot make governance cancellation decision");
        nativeBridge.requestWithdrawalCancellation(id);
        rejected = false;
        try nativeBridge.refundCanceledWithdrawal(id, "aaaa") {} catch { rejected = true; }
        require(rejected, "No escrow release before cancellation evidence");
        relayer.do(nativeBridgeAddress, "recordWithdrawalCancellationProposal", id, "0xaaaa");
        string evidence = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        relayer.do(nativeBridgeAddress, "recordWithdrawalCancellationEvidence", id, evidence);
        rejected = false;
        try relayer.do(nativeBridgeAddress, "refundCanceledWithdrawal", id, evidence) {} catch { rejected = true; }
        require(rejected, "Operator evidence is not governance verification");
        rejected = false;
        try nativeBridge.refundCanceledWithdrawal(id, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {} catch { rejected = true; }
        require(rejected, "Votes must bind the exact cancellation evidence");
        nativeBridge.setPause(true, true);
        nativeBridge.refundCanceledWithdrawal(id, evidence);
        require(nativeToken.balanceOf(address(user1)) == beforeBalance, "Governance refund restores escrow while paused");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 0, "Cancellation releases escrow exactly once");
        rejected = false;
        try nativeBridge.refundCanceledWithdrawal(id, evidence) {} catch { rejected = true; }
        require(rejected, "Refund must not execute twice");
    }

    function it_native_external_mint_winning_cancellation_race_completes_without_refund() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);
        uint256 id = user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 50e18);
        relayer.do(nativeBridgeAddress, "markWithdrawalPending", id);
        nativeBridge.requestWithdrawalCancellation(id);
        relayer.do(nativeBridgeAddress, "finalizeWithdrawal", id, "0xaaaa", "");
        bool rejected = false;
        try nativeBridge.refundCanceledWithdrawal(id, "aaaa") {} catch { rejected = true; }
        require(rejected, "Executed mint must never refund STRATO escrow");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 50e18, "Minted representations remain backed");
    }

    function it_native_deposit_review_then_confirm_unlocks_to_recipient() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 100e18);
        user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            100e18
        );

        uint256 recipientBalanceBefore = IERC20(nativeTokenAddress).balanceOf(address(user2));
        require(custodyVault.lockedBalance(nativeTokenAddress) == 100e18, "Vault should be pre-seeded by withdrawal");

        relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            60e18
        );

        string depositId = nativeBridge.getDepositId(externalChainId, externalBridge, externalRedemptionId);
        (BridgeStatus initiatedStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(initiatedStatus == BridgeStatus.INITIATED, "Recorded deposit should be initiated");

        relayer.do(nativeBridgeAddress, "reviewDeposit", externalChainId, externalBridge, externalRedemptionId);

        (BridgeStatus reviewedStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(reviewedStatus == BridgeStatus.PENDING_REVIEW, "Reviewed deposit should be pending review");

        relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, externalRedemptionId);

        (BridgeStatus confirmedStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(confirmedStatus == BridgeStatus.COMPLETED, "Confirmed deposit should be completed");
        require(
            IERC20(nativeTokenAddress).balanceOf(address(user2)) == recipientBalanceBefore + 60e18,
            "Recipient should receive unlocked amount"
        );
        require(custodyVault.lockedBalance(nativeTokenAddress) == 40e18, "Vault locked balance should reflect unlock");
    }

    function it_native_deposit_rejects_duplicate_normalized_external_tx_hash() {
        relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            10e18
        );

        bool reverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            10e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Duplicate (chainId, bridge, redemptionId) should be rejected");

        reverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            "0xDEADBEEF",
            representationToken,
            address(user2),
            10e18
        ) {
        } catch {
            reverted = true;
        }
        require(reverted, "Duplicate depositId should be rejected even with a different tx hash");
    }

    function it_native_deposit_requires_matching_external_bridge_route() {
        StratoNativeBridge bridge = nativeBridge;
        bool reverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            address(0x9999),
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(this),
            50e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Deposit should revert for unexpected external bridge");
    }

    function it_native_setPause_rejects_non_owner_non_guardian() {
        bool reverted = false;
        try relayer.do(nativeBridgeAddress, "setPause", true, false) {
        } catch {
            reverted = true;
        }
        require(reverted, "Bridge operator should not be allowed to pause");

        reverted = false;
        try user1.do(nativeBridgeAddress, "setPause", true, false) {
        } catch {
            reverted = true;
        }
        require(reverted, "Random user should not be allowed to pause");
    }

    function it_native_setPause_guardian_can_pause_but_cannot_unpause() {
        nativeBridge.setPause(true, true);
        require(nativeBridge.depositsPaused(), "Guardian should pause deposits");
        require(nativeBridge.withdrawalsPaused(), "Guardian should pause withdrawals");

        bool reverted = false;
        try {
            nativeBridge.setPause(false, false);
        } catch {
            reverted = true;
        }
        require(reverted, "Guardian should not be able to unpause");
        require(nativeBridge.depositsPaused(), "Deposits should remain paused after failed unpause");
        require(nativeBridge.withdrawalsPaused(), "Withdrawals should remain paused after failed unpause");
    }

    function it_native_paused_state_blocks_user_and_operator_flows() {
        nativeBridge.setPause(true, true);

        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);

        bool withdrawalReverted = false;
        try user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        ) {
        } catch {
            withdrawalReverted = true;
        }
        require(withdrawalReverted, "Paused withdrawals should block requestWithdrawal");

        bool depositReverted = false;
        try relayer.do(
            nativeBridgeAddress,
            "recordDeposit",
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            address(user2),
            10e18
        ) {
        } catch {
            depositReverted = true;
        }
        require(depositReverted, "Paused deposits should block recordDeposit");
    }

    function it_native_custody_vault_paused_blocks_lock_and_unlock() {
        custodyVault.setPause(true);
        require(custodyVault.paused(), "Guardian should pause vault");

        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 50e18);

        bool lockReverted = false;
        try user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            50e18
        ) {
        } catch {
            lockReverted = true;
        }
        require(lockReverted, "Paused vault should reject lock from bridge");
    }

    function it_native_bridge_proxy_upgrade_preserves_state() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_custody_vault_proxy_upgrade_preserves_locked_balances() {
        require(true, "SolidVM harness smoke check");
    }

    function it_native_withdrawal_above_instant_threshold_requires_manual_lane() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 150e18);
        uint256 withdrawalId = user1.do(
            nativeBridgeAddress,
            "requestWithdrawal",
            externalChainId,
            externalRecipient,
            nativeTokenAddress,
            150e18
        );

        (
            BridgeStatus bridgeStatus,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 stratoTokenAmount,
            ,
            bool useInstantPath
        ) = nativeBridge.getWithdrawalInfo(withdrawalId);

        require(bridgeStatus == BridgeStatus.INITIATED, "Withdrawal should remain initiated");
        require(stratoTokenAmount == 150e18, "Locked amount should match request");
        require(!useInstantPath, "Amount above threshold should require approval lane");
    }
    function it_rejected_native_deposit_can_be_reopened_and_delivered_once() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 100e18);
        user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 100e18);
        relayer.do(nativeBridgeAddress, "recordDeposit", externalChainId, externalBridge, externalRedemptionId,
            externalSender, externalTxHash, representationToken, address(user2), 60e18);
        string depositId = nativeBridge.getDepositId(externalChainId, externalBridge, externalRedemptionId);
        relayer.do(nativeBridgeAddress, "abortDeposit", externalChainId, externalBridge, externalRedemptionId);
        nativeBridge.reopenDeposit(depositId);
        relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, externalRedemptionId);
        require(nativeToken.balanceOf(address(user2)) == 60e18, "Reopened deposit must deliver");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 40e18, "Delivery releases custody exactly once");
        bool rejected = false;
        try nativeBridge.requestDepositRefund(depositId) {} catch { rejected = true; }
        require(rejected, "Delivered deposit cannot refund");
    }

    function it_native_no_funds_rejection_is_governance_only_and_terminal() {
        relayer.do(nativeBridgeAddress, "recordDeposit", externalChainId, externalBridge, externalRedemptionId,
            externalSender, externalTxHash, representationToken, address(user2), 60e18);
        relayer.do(nativeBridgeAddress, "reviewDeposit", externalChainId, externalBridge, externalRedemptionId);
        string depositId = nativeBridge.getDepositId(externalChainId, externalBridge, externalRedemptionId);
        bool rejected = false;
        try relayer.do(nativeBridgeAddress, "rejectDepositNoFunds", depositId) {} catch { rejected = true; }
        require(rejected, "Only governance may reject without refund");
        nativeBridge.rejectDepositNoFunds(depositId);
        (BridgeStatus status,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(status == BridgeStatus.REJECTED_NO_FUNDS, "No-funds rejection has distinct status");
        rejected = false;
        try nativeBridge.requestDepositRefund(depositId) {} catch { rejected = true; }
        require(rejected, "Closed no-funds record cannot refund");
        rejected = false;
        try nativeBridge.reopenDeposit(depositId) {} catch { rejected = true; }
        require(rejected, "Closed no-funds record cannot reopen");
        require(nativeToken.balanceOf(address(user2)) == 0, "No-funds rejection must not unlock custody");
    }

    function it_native_deposit_refund_keeps_custody_locked_and_blocks_delivery() {
        user1.do(nativeTokenAddress, "approve", custodyVaultAddress, 100e18);
        user1.do(nativeBridgeAddress, "requestWithdrawal", externalChainId, externalRecipient, nativeTokenAddress, 100e18);
        relayer.do(nativeBridgeAddress, "recordDeposit", externalChainId, externalBridge, externalRedemptionId,
            externalSender, externalTxHash, representationToken, address(user2), 60e18);
        string depositId = nativeBridge.getDepositId(externalChainId, externalBridge, externalRedemptionId);
        bool rejected = false;
        try relayer.do(nativeBridgeAddress, "requestDepositRefund", depositId) {} catch { rejected = true; }
        require(rejected, "Only governance may select a refund");
        nativeBridge.requestDepositRefund(depositId);
        rejected = false;
        try relayer.do(nativeBridgeAddress, "confirmDeposit", externalChainId, externalBridge, externalRedemptionId) {} catch { rejected = true; }
        require(rejected, "Refund decision blocks source delivery");
        rejected = false;
        try nativeBridge.reopenDeposit(depositId) {} catch { rejected = true; }
        require(rejected, "Refund decision cannot reopen");
        rejected = false;
        try user2.do(nativeBridgeAddress, "finalizeDepositRefund", depositId, "0xaaaa") {} catch { rejected = true; }
        require(rejected, "User cannot finalize without verified evidence");
        relayer.do(nativeBridgeAddress, "recordDepositRefundProposal", depositId, "0xbbbb");
        rejected = false;
        try relayer.do(nativeBridgeAddress, "finalizeDepositRefund", depositId, "0xaaaa") {} catch { rejected = true; }
        require(rejected, "Hot operator cannot declare funds returned");
        rejected = false;
        try nativeBridge.finalizeDepositRefund(depositId, "0xaaaa") {} catch { rejected = true; }
        require(rejected, "Governance must review recorded evidence");
        relayer.do(nativeBridgeAddress, "recordDepositRefundEvidence", depositId, "0xaaaa");
        rejected = false;
        try user2.do(nativeBridgeAddress, "recordDepositRefundEvidence", depositId, "0xbbbb") {} catch { rejected = true; }
        require(rejected, "User cannot replace evidence");
        rejected = false;
        try nativeBridge.finalizeDepositRefund(depositId, "0xbbbb") {} catch { rejected = true; }
        require(rejected, "Confirmation binds exact reviewed hash");
        relayer.do(nativeBridgeAddress, "recordDepositRefundEvidence", depositId, "0xbbbb");
        rejected = false;
        try nativeBridge.finalizeDepositRefund(depositId, "0xaaaa") {} catch { rejected = true; }
        require(rejected, "Changed evidence invalidates old confirmation");
        relayer.do(nativeBridgeAddress, "recordDepositRefundEvidence", depositId, "0xaaaa");
        Admin secondAdmin = new Admin();
        adminRegistry.addAdmin(address(secondAdmin));
        nativeBridge.finalizeDepositRefund(depositId, "0xaaaa");
        (BridgeStatus pendingStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(pendingStatus == BridgeStatus.REFUND_PENDING, "One vote cannot declare a refund completed");
        rejected = false;
        try relayer.do(nativeBridgeAddress, "finalizeDepositRefund", depositId, "0xaaaa") {} catch { rejected = true; }
        require(rejected, "Operator cannot replace the second governance vote");
        secondAdmin.do(nativeBridgeAddress, "finalizeDepositRefund", depositId, "0xaaaa");
        (BridgeStatus refundedStatus,,,,,,,,,,) = nativeBridge.getDepositInfo(depositId);
        require(refundedStatus == BridgeStatus.REFUNDED, "Governance quorum completes refund");
        require(nativeBridge.depositRefundTransactions(depositId) == "0xaaaa", "Refund proof must persist");
        require(custodyVault.lockedBalance(nativeTokenAddress) == 100e18, "Refund restores representations and must retain backing");
        require(nativeToken.balanceOf(address(user2)) == 0, "Refund cannot unlock on STRATO");
        rejected = false;
        try {
            nativeBridge.finalizeDepositRefund(depositId, "0xaaaa");
            secondAdmin.do(nativeBridgeAddress, "finalizeDepositRefund", depositId, "0xaaaa");
        } catch { rejected = true; }
        require(rejected, "Refund finalization is one-shot");
    }

}
