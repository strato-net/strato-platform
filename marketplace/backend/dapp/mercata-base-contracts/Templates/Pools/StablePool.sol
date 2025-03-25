// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../Templates/Assets/Asset.sol"; // Contains UTXO and Asset definitions for USDST
import "../ERC20/ERC20.sol";
import "../../Templates/Oracles/OracleService.sol";

/// @title  Asset/USDST Liquidity Pool (with UTXO-based USDST and Oracle integration)
/// @notice  Asset is a standard ERC20 token. USDST is a UTXO-based asset pegged to $1,
///         and  Asset price is provided by an external oracle.
contract StablePool {
    ERC20 public asset;              // ERC20 token
    OracleService public oracle;     // Oracle service returning  Asset price (in USD)

    // Array tracking all USDST UTXOs held by the pool.
    UTXO[] public usdstUTXOs;
    
    // Liquidity provider tracking (using the USDST side as the basis).
    mapping(address => uint256) public liquidity;
    uint256 public totalLiquidity;
    
    // Fee constants (for example, a 0.3% fee on swaps).
    uint256 public constant FEE_NUMERATOR = 997;
    uint256 public constant FEE_DENOMINATOR = 1000;
    
    constructor(address _asset, address _oracle) {
        asset = Asset(_asset)   ;
        oracle = OracleService(_oracle);
    }
    
    /// @notice Computes the total USDST liquidity by summing the quantities in all UTXOs.
    function totalUSDSTReserve() public view returns (uint256 total) {
        for (uint i = 0; i < usdstUTXOs.length; i++) {
            total += usdstUTXOs[i].quantity;
        }
    }
    
    /// @notice Add liquidity to the pool.
    /// @param assetAmount The amount of Assets being deposited.
    /// @param usdstUTXOAddresses Array of addresses for the provided USDST UTXO contracts.
    /// @param usdstQuantities Corresponding quantities for each USDST UTXO (in smallest units).
    /// @dev The deposit ratio must meet: totalUSDSTDeposited == assetAmount * oraclePrice.
    function addLiquidity(
        uint256 assetAmount,
        address[] usdstUTXOAddresses,
        uint totalQuantity
    ) external {
        require(usdstUTXOAddresses.length == usdstQuantities.length, "Array length mismatch");
        
        // Aggregate USDST deposits from the provided UTXOs.
        uint256 totalUSDSTDeposited = 0;
        for (uint i = 0; i < usdstUTXOAddresses.length; i++) {
            UTXO utxo = UTXO(usdstUTXOAddresses[i]);
            totalUSDSTDeposited += utxo.quantity();
            usdstUTXOs.push(utxo);
        }
        
        // Get  Asset price from the Oracle.
        // The oracle returns a consensus price (as a decimal) and a timestamp.
        (decimal oraclePrice, ) = oracle.getLatestPrice();
        
        // Enforce the deposit ratio.
        // Since USDST is pegged to $1, the USDST deposit should equal:
        // assetAmount * oraclePrice (assuming oraclePrice is expressed in USD for 1  Asset).
        require(
            totalUSDSTDeposited == assetAmount * oraclePrice,
            "Deposit ratio mismatch: USDST deposit does not match  Asset deposit per oracle price"
        );
        
        // Transfer Assets from the liquidity provider to the pool.
        require(asset.transferFrom(msg.sender, address(this), assetAmount), " Asset transfer failed");
        
        // Mint liquidity tokens proportionally. For initial liquidity, set LP tokens equal to totalUSDSTDeposited.
        uint256 liquidityMinted;
        if (totalLiquidity == 0) {
            liquidityMinted = totalUSDSTDeposited;
        } else {
            // For subsequent deposits, mint LP tokens proportional to the additional USDST liquidity.
            uint256 currentReserve = totalUSDSTReserve() - totalUSDSTDeposited;
            liquidityMinted = (totalUSDSTDeposited * totalLiquidity) / currentReserve;
        }
        liquidity[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;
    }
    
    /// @notice Swap function: exchange USDST for  Asset.
    /// @param usdstAmount The USDST amount (aggregated from UTXOs) to swap.
    /// @return assetOut The amount of   Assets received.
    function swapUSDSTForAsset(uint256 usdstAmount) external returns (uint256 assetOut) {
        uint256 totalReserve = totalUSDSTReserve();
        require(totalReserve >= usdstAmount, "Insufficient USDST liquidity");
        
        //  Asset reserve is the token balance held by the pool.
        uint256 assetReserve = asset.balanceOf(address(this));
        // Apply fee to the input amount.
        uint256 amountInWithFee = usdstAmount * FEE_NUMERATOR;
        // Constant product formula: output = (amountInWithFee * assetReserve) / (totalReserve * FEE_DENOMINATOR + amountInWithFee)
        assetOut = (amountInWithFee * assetReserve) / (totalReserve * FEE_DENOMINATOR + amountInWithFee);
        require(assetOut <= assetReserve, "Insufficient  Asset liquidity");
        
        // Consume (or spend) the provided USDST amount from the UTXO list.
        _consumeUSDST(usdstAmount, false);
        
        // Transfer   Assets to the user.
        require(asset.transfer(msg.sender, assetOut), " Asset transfer failed");
    }
    
    /// @notice Swap function: exchange  Asset for USDST.
    /// @param assetAmount The amount of   Assets the user wants to swap.
    /// @return usdstOut The aggregated USDST amount (from UTXOs) to be received.
    /// @dev In a complete implementation, this function would also reassign or mint USDST UTXOs to the recipient.
    function swapAssetForUSDST(uint256 assetAmount) external returns (uint256 usdstOut) {
        // Transfer   Assets from the user into the pool.
        require(asset.transferFrom(msg.sender, address(this), assetAmount), " Asset transfer failed");
        
        uint256 totalReserve = totalUSDSTReserve();
        //  Asset reserve prior to this swap is current balance minus the new deposit.
        uint256 assetReserve = asset.balanceOf(address(this)) - assetAmount;
        uint256 amountInWithFee = assetAmount * FEE_NUMERATOR;
        usdstOut = (amountInWithFee * totalReserve) / (assetReserve * FEE_DENOMINATOR + amountInWithFee);
        require(usdstOut <= totalReserve, "Insufficient USDST liquidity");
        
        // Consume the required USDST from the pool's UTXO array.
        _consumeUSDST(usdstOut, true);
        
    }
    
    /// @notice Internal helper to consume USDST liquidity from the UTXO list.
    /// @dev Iterates over the list and deducts quantities until the desired amount is spent.
    function _consumeUSDST(uint256 amount, bool swapAssetForUSDST) internal {
        uint256 remaining = amount;
        uint256 totalAmountGross = 0;
        uint256 totalAmountNet = 0;
    
        for (uint i = 0; i < usdstUTXOs.length && remaining > 0; ) {
            UTXO utxo = usdstUTXOs[i];
            
            // Calculate gross, net, and fee amounts in dollars
            decimal gross = decimal(utxo.quantity);
            decimal fee = (gross * (primarySaleFee / 100.000000000000000000));
            decimal net = gross - fee;
            totalAmountGross += gross;
            totalAmountNet += net;
            totalFee += fee;

            // Calculate net and fee amounts in 18 decimal places
            uint tokenAmountNet = uint(net * (10**18));
            uint tokenFee = uint(fee * (10**18));

            // Transfer token
            uint remainingTokenToTransfer = tokenAmountNet;
            uint remainingFeeToTransfer = tokenFee;
            uint tokenQuantity = 0;
            uint transferAmount = 0;
            uint transferFee = 0;
            uint transferNumber = 0;

            // Assuming _tokenAssetAddresses is available in the context
            for (uint j = 0; j < _tokenAssetAddresses.length; j++) {
                Tokens tokenAsset = Tokens(_tokenAssetAddresses[j]);
                require(tokenAsset.root == tokenAddress, "Asset is not a " + serviceName  + " asset");
                require(tokenAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own " + serviceName);
                tokenQuantity = tokenAsset.quantity();
                transferNumber = (uint(_checkoutHash, 16) + j) % 1000000;
                if (remainingTokenToTransfer > 0) {
                    transferAmount = tokenQuantity >= remainingTokenToTransfer ? remainingTokenToTransfer : tokenQuantity;
                    if(swapAssetForUSDST){
                        tokenAsset.purchaseTransfer(address(this), transferAmount, transferNumber, 1/(10**18));
                    }else{
                        tokenAsset.purchaseTransfer(msg.sender, transferAmount, transferNumber, 1/(10**18));
                    }
                    remainingTokenToTransfer -= transferAmount;
                }
                tokenQuantity = tokenQuantity - transferAmount;
                if (remainingFeeToTransfer > 0 && tokenQuantity > 0) {
                    transferNumber = (uint(_checkoutHash, 16) + j + block.timestamp) % 1000000;
                    transferFee = tokenQuantity >= remainingFeeToTransfer ? remainingFeeToTransfer : tokenQuantity;
                    tokenAsset.purchaseTransfer(feeRecipient, transferFee, transferNumber, 1/(10**18));
                    remainingFeeToTransfer -= transferFee;
                }
                transferAmount = 0;
                if (remainingTokenToTransfer == 0 && remainingFeeToTransfer == 0) {
                    break;
                }
            }

            if (utxo.quantity <= remaining) {
                remaining -= utxo.quantity;
                // Remove the UTXO by swapping with the last element and popping.
                usdstUTXOs[i] = usdstUTXOs[usdstUTXOs.length - 1];
                usdstUTXOs.pop();
            } else {
                // Assuming the UTXO contract has a method to reduce the quantity
                utxo.reduceQuantity(remaining);
                remaining = 0;
            }
        }
        require(remaining == 0, "Not enough USDST liquidity");
    }

    function transferUSDST(UTXO[] utxos, uint256 amount, address recipient) internal {
        uint256 remaining = amount;
        uint256 totalAmountGross = 0;
        uint256 totalAmountNet = 0;

        for (uint i = 0; i < utxos.length && remaining > 0; ) {
            UTXO utxo = utxos[i];
            
            // Calculate gross, net, and fee amounts in dollars
            decimal net = decimal(utxo.quantity);
            totalAmountNet += net;

            // Calculate net and fee amounts in 18 decimal places
            uint tokenAmountNet = uint(net * (10**18));

            // Transfer token
            uint remainingTokenToTransfer = tokenAmountNet;
            uint tokenQuantity = 0;
            uint transferAmount = 0;
            uint transferNumber = 0;

            // Assuming _tokenAssetAddresses is available in the context
            for (uint j = 0; j < utxos.length; j++) {
                Tokens tokenAsset = Tokens(utxos[j]);
                require(tokenAsset.root == tokenAddress, "Asset is not a " + serviceName  + " asset");
                require(tokenAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own " + serviceName);
                tokenQuantity = tokenAsset.quantity();
                transferNumber = (uint(_checkoutHash, 16) + j) % 1000000;
                if (remainingTokenToTransfer > 0) {
                    transferAmount = tokenQuantity >= remainingTokenToTransfer ? remainingTokenToTransfer : tokenQuantity;
                    tokenAsset.purchaseTransfer(recipient, transferAmount, transferNumber, 1/(10**18));
                    remainingTokenToTransfer -= transferAmount;
                }
                tokenQuantity = tokenQuantity - transferAmount;
                transferAmount = 0;
                if (remainingTokenToTransfer == 0 && remainingFeeToTransfer == 0) {
                    break;
                }
            }
            require(remainingTokenToTransfer == 0, "Not enough USDST liquidity");
        }
    }
}
