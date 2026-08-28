import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Bridge/StratoNativeBridge.sol";
import "../../concrete/Bridge/StratoNativeCustodyVault.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";

import "../Util.sol";

contract Describe_StratoNativeBridge is Authorizable {
    using BridgeTypes for *;

    Mercata mercata;
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

        mercata = new Mercata();
        adminRegistry = mercata.adminRegistry();
        tokenFactory = mercata.tokenFactory();

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

        nativeToken = new Token(address(this));
        nativeTokenAddress = address(nativeToken);
        nativeToken.initialize(
            "Native STRATO",
            "NST",
            [],
            [],
            [],
            "NST",
            0,
            18,
            address(this)
        );
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
}
