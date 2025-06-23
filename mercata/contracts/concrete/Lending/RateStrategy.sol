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
        uint256 durationSeconds = block.timestamp - lastUpdated;
        uint256 hoursElapsed = durationSeconds / 3600; // whole hours only; <1h accrues 0 interest
        if (hoursElapsed == 0) return 0;
        // 8760 hours in a year; divide by 100 to convert rate percentage
        return (principal * rate * hoursElapsed) / (8760 * 100);
    }
}