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
        // 8760 hours in a year; divide by 10_000 to convert rate from basis points (bps) to a percentage
        // @adrian it's not a percentage is it; it's a decimal. It doesn't give X such that X / 100 = rate.
        return (principal * rate * hoursElapsed) / (8760 * 10000);
    }
}