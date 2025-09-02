// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

contract record RewardsChef is Ownable {

    // ═════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════════════════
    // DATA STRUCTURES
    // ═════════════════════════════════════════════════════════════════════════

    struct UserInfo {
        uint256 amount;      // How many LP tokens the user has provided.
        uint256 rewardDebt;  // Reward debt
    }

    struct PoolInfo {
        address lpToken;             // The LP Token added to the stake pool
        uint256 allocPoint;          // How many allocation points assigned to
	                             // this pool.  Importance of the pool.
        uint256 lastRewardTimestamp; // Last time the CATA distribution occurs
        uint256 accPerToken;         // Accumulated CATA per share (per token)
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═════════════════════════════════════════════════════════════════════════


    // ═════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════════

    constructor(address initialOwner) Ownable(initialOwner) {
	pools = [];
    }


}
