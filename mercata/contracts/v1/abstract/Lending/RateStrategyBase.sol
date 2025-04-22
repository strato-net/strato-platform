
pragma solidvm 12.0;

abstract contract RateStrategyBase {
    constructor() {
    } 
    
    function calculateInterest(uint256 principal, uint256 rate, uint256 lastUpdated) pure  returns (uint256) {
        if (block.timestamp <= lastUpdated) return 0;
        uint256 duration = block.timestamp - lastUpdated;
        return (principal * rate * duration) / (365 * 24 * 60 * 60 * 100);
    }
}