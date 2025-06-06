/**
 * @title RateStrategy
 * @notice Defines the interest rate calculation logic based on loan duration and static rates.
 * @dev Called by LendingPool to compute interest owed on active loans.
 */
 
 contract record RateStrategy {
    constructor()  {
    } 
    
    function calculateInterest(uint256 principal, uint256 rate, uint256 lastUpdated) pure  returns (uint256) {
        if (block.timestamp <= lastUpdated) return 0;
        uint256 duration = block.timestamp - lastUpdated;
        return (principal * rate * duration) / (365 * 24 * 60 * 100);
    }
}