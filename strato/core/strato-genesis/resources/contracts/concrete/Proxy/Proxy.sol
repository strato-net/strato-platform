import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title Proxy
 * @notice Upgradeable proxy pattern implementation that enables smart contract upgradeability
 * @dev Separates contract logic from storage, allowing logic to be upgraded while preserving state
 *
 * Architecture:
 *   User → Proxy (storage) → delegatecall → Logic Contract (code)
 *            ↑                                      ↓
 *            └──────── executes in proxy context ──┘
 *
 * Key Components:
 * - logicContract: Address of the implementation contract containing the actual
 *   business logic
 * - setLogicContract(): Owner-only function to upgrade the logic contract
 * - fallback(): Delegates all function calls to the logic contract using
 *   delegatecall
 *
 * How it works:
 * - When you call a function on the Proxy, the fallback function intercepts it
 * - Using delegatecall, it executes the function in the logic contract's code
 * - Crucially: The execution happens in the Proxy's storage context, not the
 *   logic contract's
 * - This means state variables are stored in the Proxy, while logic is in the
 *   implementation
 *
 * Benefits:
 * - Upgradeability: Fix bugs or add features without changing the contract
 *   address
 * - Storage Preservation: User balances, state variables remain intact across
 *   upgrades
 * - Separation of Concerns: Logic and data are decoupled
 */
contract record Proxy is Ownable {
    address logicContract;

    constructor(address _logicContract, address _initialOwner) Ownable(_initialOwner) {
        logicContract = _logicContract;
    }

    function setLogicContract(address _logicContract) onlyOwner {
        logicContract = _logicContract;
    }

    fallback(variadic args) external returns (variadic) {
        return logicContract.delegatecall(msg.sig, args);
    }
}
