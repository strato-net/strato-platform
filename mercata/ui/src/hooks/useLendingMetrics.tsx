import { useState, useMemo, useCallback, useEffect } from "react";
import { formatUnits } from "ethers";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { usdstAddress } from "@/lib/contants";

export const useLendingMetrics = () => {
  const [loanList, setLoanList] = useState([]);
  
  const {
    loans,
    refreshLoans,
  } = useLendingContext();
  
  const { userAddress } = useUser();

  // Fetch loans for the current user
  const fetchLoans = useCallback(async () => {
    if (!userAddress) return;
    try {
      const userLoans = Object.entries(loans || {})
        .map(([loanId, loan]) => ({loanId,
          ...(loan as unknown as {
            loan: {
              user: string;
              active: boolean;
              amount: string;
              interest: string;
              lastUpdated?: string;
              asset?: string;
              collateralAsset?: string;
            };
            assetName?: string;
            assetSymbol?: string;
            [key: string]: unknown;
          }),}))
        .filter((loan) => loan?.loan?.user === userAddress && loan?.loan?.active === true);

      const enrichedLoans = await Promise.all(
        userLoans.map(async (loan) => {
          const balanceHuman = formatUnits(
            BigInt(loan?.loan?.amount || 0) + BigInt(loan?.loan?.interest || 0),
            18
          );
          return {
            ...loan,
            _name: loan.assetName,
            _symbol: loan?.assetSymbol || "",
            balanceHuman,
          };
        })
      );
      setLoanList(enrichedLoans);
    } catch (e) {
      console.error("Error fetching loans:", e);
    }
  }, [loans]);

  useEffect(() => {
    if (Object.keys(loans || {}).length > 0 && userAddress) {
      fetchLoans();
    }
  }, [loans, fetchLoans, userAddress]);
  const depositableTokens = []

  // Calculate Available Borrowing Power
  const availableBorrowingPower = useMemo(() => {
    if (!depositableTokens || depositableTokens.length === 0) return "$0.00";
    
    let totalBorrowingPower = 0;
    
    for (const token of depositableTokens) {
      try {
        // Skip USDST as it's the borrowed asset, not collateral
        if (token?.address === usdstAddress) continue;
        
        // Handle price conversion
        let price = 0;
        if (token?.price) {
          if (typeof token.price === "string" && token.price.includes("e")) {
            // Handle scientific notation
            price = parseFloat(formatUnits(BigInt(Number(token.price)), 18));
          } else {
            price = parseFloat(formatUnits(BigInt(token.price.toString()), 18));
          }
        }
        
        // Handle value conversion
        let value = 0;
        if (token?.value) {
          if (typeof token.value === "string" && token.value.includes("e")) {
            // Handle scientific notation
            value = parseFloat(formatUnits(BigInt(Number(token.value)), 18));
          } else {
            value = parseFloat(formatUnits(BigInt(token.value.toString()), 18));
          }
        }
        
        // Handle collateral ratio
        const ratio = Number(token?.collateralRatio || "0") / 100;
        
        // Calculate borrowing power: (price * value) / ratio
        if (price > 0 && value > 0 && ratio > 0) {
          const tokenBorrowingPower = (price * value) / ratio;
          if (!isNaN(tokenBorrowingPower) && isFinite(tokenBorrowingPower)) {
            totalBorrowingPower += tokenBorrowingPower;
          }
        }
      } catch (error) {
        console.error("Error calculating borrowing power for token:", token, error);
      }
    }
    
    return "$" + totalBorrowingPower.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [depositableTokens]);

  // Calculate Current Borrowed
  const currentBorrowed = useMemo(() => {
    if (!loanList || loanList.length === 0) return "$0.00";
    
    let totalBorrowed = 0;
    
    for (const loan of loanList) {
      try {
        // Only count active loans
        if (!loan?.loan?.active) continue;
        
        const principal = parseFloat(formatUnits(BigInt(loan?.loan?.amount || 0), 18));
        const interest = parseFloat(formatUnits(BigInt(loan?.loan?.interest || 0), 18));
        
        // Validate the values
        if (!isNaN(principal) && principal >= 0 && !isNaN(interest) && interest >= 0) {
          totalBorrowed += principal + interest;
        }
      } catch (error) {
        console.error("Error calculating borrowed amount for loan:", loan, error);
      }
    }
    
    return "$" + totalBorrowed.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [loanList]);

  // Calculate Average Interest Rate
  const averageInterestRate = useMemo(() => {
    if (!loanList || loanList.length === 0) return "0.00%";
    
    let totalWeightedRate = 0;
    let totalPrincipal = 0;
    
    for (const loan of loanList) {
      try {
        const principal = parseFloat(formatUnits(BigInt(loan?.loan?.amount || 0), 18));
        const interest = parseFloat(formatUnits(BigInt(loan?.loan?.interest || 0), 18));
        
        if (principal > 0 && !isNaN(principal)) {
          let interestRate = 0;
          
          // Method 1: Try to get interest rate from collateral token
          const collateralToken = depositableTokens?.find(token => token.address === loan?.loan?.collateralAsset);
          if (collateralToken?.interestRate) {
            const tokenRate = parseFloat(collateralToken.interestRate.toString());
            if (!isNaN(tokenRate) && tokenRate >= 0) {
              interestRate = tokenRate;
            }
          }
          
          // Method 2: If no collateral token rate, try to calculate from accrued interest
          if (interestRate === 0 && interest > 0) {
            const lastUpdated = loan?.loan?.lastUpdated;
            if (lastUpdated) {
              try {
                // Convert Unix timestamp to milliseconds
                const lastUpdatedMs = parseInt(lastUpdated) * 1000;
                const timeElapsed = Date.now() - lastUpdatedMs;
                const daysElapsed = Math.max(timeElapsed / (1000 * 60 * 60 * 24), 1); // Minimum 1 day
                
                // Calculate annualized interest rate: (interest / principal) * (365 / days) * 100
                const calculatedRate = (interest / principal) * (365 / daysElapsed) * 100;
                
                // Only use calculated rate if it's reasonable (between 0.1% and 100%)
                if (!isNaN(calculatedRate) && isFinite(calculatedRate) && calculatedRate >= 0.1 && calculatedRate <= 100) {
                  interestRate = calculatedRate;
                }
              } catch (dateError) {
                console.error("Error calculating interest rate from time:", dateError);
              }
            }
          }
          
          // Method 3: If still no rate, use a reasonable default
          if (interestRate === 0) {
            // Use the interest rate from the borrowed asset (USDST in this case)
            const borrowedToken = depositableTokens?.find(token => token.address === loan?.loan?.asset);
            if (borrowedToken?.interestRate) {
              const borrowedRate = parseFloat(borrowedToken.interestRate.toString());
              if (!isNaN(borrowedRate) && borrowedRate >= 0) {
                interestRate = borrowedRate;
              }
            }
          }
          
          // Method 4: Last resort - reasonable default for DeFi lending
          if (interestRate === 0) {
            interestRate = 8.0; // 8% APY as a reasonable default
          }
          
          // Weight the rate by loan principal amount
          totalWeightedRate += (interestRate * principal);
          totalPrincipal += principal;
        }
      } catch (error) {
        console.error("Error calculating interest rate for loan:", loan, error);
      }
    }
    
    const averageRate = totalPrincipal > 0 ? totalWeightedRate / totalPrincipal : 0;
    
    // Final validation to ensure we return a valid number
    if (isNaN(averageRate) || !isFinite(averageRate)) {
      return "0.00%";
    }
    
    return averageRate.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%";
  }, [loanList, depositableTokens]);

  // Function to refresh all lending data
  const refreshLendingData = useCallback(() => {
    refreshLoans();
  }, [ refreshLoans]);

  return {
    availableBorrowingPower,
    currentBorrowed,
    averageInterestRate,
    loanList,
    setLoanList,
    refreshLendingData,
    loading: !depositableTokens || !loans,
  };
}; 