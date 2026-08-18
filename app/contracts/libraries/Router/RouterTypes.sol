library RouterTypes {
    enum RouteAction {
        NONE,
        SWAP_V2,
        SWAP_STABLE,
        SWAP_V3,
        PSM_MINT,
        FORGE,
        SAVE,
        YIELD_VAULT_DEPOSIT
    }

    struct RouteStep {
        RouteAction action;
        address target;
        address tokenIn;
        address tokenOut;
        uint256 minAmountOut;
        uint256 parameter1;
        uint256 parameter2;
        bool direction;
        uint256 factoryPoolIndex;
    }
}
