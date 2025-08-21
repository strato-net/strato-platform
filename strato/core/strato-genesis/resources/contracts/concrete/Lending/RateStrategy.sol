/**
 * @title RateStrategy
 * @notice Defines the interest rate calculation logic based on loan duration and static rates.
 * @dev Called by LendingPool to compute interest owed on active loans.
 */
 
 contract record RateStrategy {
    constructor()  {
    } 
    
    function calculateInterest(uint principal, uint rate, uint lastUpdated) pure  returns (uint) {
        if (block.timestamp <= lastUpdated) return 0;
        uint durationSeconds = block.timestamp - lastUpdated;
        uint hoursElapsed = durationSeconds / 3600; // whole hours only; <1h accrues 0 interest
        if (hoursElapsed == 0) return 0;
        // 8760 hours in a year; divide by 10_000 to convert rate from basis points (bps) to a percentage
        return (principal * rate * hoursElapsed) / (8760 * 10000);
    }
}