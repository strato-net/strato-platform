pragma solidvm 11.5;

import <509>;
import "../Assets/Asset.sol";
import "../Staking/Reserve.sol";
import "../Utils/Utils.sol";

abstract contract Escrow is Utils {
    address public reserve;
    uint public collateralQuantity;
    decimal public collateralValue;
    uint public maxLoanAmount;
    decimal public totalCataRewardInDollars;
    decimal public borrowedAmount;
    uint public lastRewardTimestamp;

    address public borrower;
    string public borrowerCommonName;

    address public assetRootAddress;
    Asset[] public assets;

    constructor(
        address[] _assets,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio
    ) {
        reserve = msg.sender;
        borrower = address(0);
        assetRootAddress = address(0);
        attachAssets(_assets, _collateralQuantity, _assetPrice, _loanToValueRatio);
        require(collateralQuantity > 0, "No collateral has been staked");
        totalCataRewardInDollars = 0.0; // Assuming the CATA reward rate is provided externally
    }

    function attachAssets(
        address[] _assets,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio
    ) public {
        require(msg.sender == reserve, "Only the reserve can attach assets to the escrow");
        uint unallocatedQuantity = _collateralQuantity;

        for (uint i = 0; i < _assets.length && unallocatedQuantity > 0; i++) {
            Asset asset = Asset(_assets[i]);

            asset.attachSale();
            address assetOwner = asset.owner();
            address assetRoot = address(asset).root;
            if (borrower == address(0) && assetRootAddress == address(0)) {
                borrower = assetOwner;
                borrowerCommonName = getCommonName(assetOwner);
                assetRootAddress = assetRoot;
            } else {
                string assetOwnerCommonName = getCommonName(assetOwner);
                require(assetOwnerCommonName == borrowerCommonName, "Not all provided assets are owned by the same owner");
                require(assetRoot == assetRootAddress, "Not all provided assets are of the same type");
            }

            uint assetQuantity = asset.quantity();
            if (assetQuantity > unallocatedQuantity) { // split
                asset.transferOwnership(assetOwner, assetQuantity - unallocatedQuantity, false, 0, 0.0); // Even though we don't get the new asset address, it's ok because the newly created UTXO is the one we won't be staking
                unallocatedQuantity = 0;
            } else {
                unallocatedQuantity -= assetQuantity;
            }

            assets.push(asset);
        }

        collateralQuantity += _collateralQuantity - unallocatedQuantity;
        _updateOnPriceChange(_assetPrice, _loanToValueRatio);
    }

    function unlockAssets(
        uint _quantity,
        decimal _assetPrice,
        uint _loanToValueRatio
    ) public {
        require(msg.sender == reserve, "Only the reserve can attach assets to the escrow");
        uint quantityToUnlock = _quantity;
        if (_quantity > collateralQuantity) {
            quantityToUnlock = collateralQuantity;
        }
        uint unallocatedQuantity = quantityToUnlock;

        for (uint i = 0; i < assets.length && unallocatedQuantity > 0; i++) {
            Asset asset = Asset(assets[i]);

            uint assetQuantity = asset.quantity();
            if (assetQuantity > unallocatedQuantity) { // split
                asset.transferOwnership(asset.owner(), unallocatedQuantity, false, 0, 0.0); // Here we want to transfer the amount we want to unlock, and retain the locked amount
                unallocatedQuantity = 0;
            } else {
                asset.closeSale();
                assets[i] = Asset(address(0));
                unallocatedQuantity -= assetQuantity;
            }
        }

        collateralQuantity -= quantityToUnlock - unallocatedQuantity;
        _updateOnPriceChange(_assetPrice, _loanToValueRatio);
        require(uint(borrowedAmount) <= maxLoanAmount, "Invalid unstaking attempt: unstaking "
                                               + string(quantityToUnlock)
                                               + " units would result in undercollateralization."
                                               + "\nCurrent loan balance: "
                                               + string(borrowedAmount)
                                               + "\nCollateral value after unstaking: "
                                               + string(collateralValue)
                                               + "\nMaximum loan amount after unstaking: "
                                               + string(maxLoanAmount));
    }

    function updateBorrowedAmount(decimal _borrowAmount, bool add) external {
        require(msg.sender == reserve, "Only reserve can update borrowed amount");
        require(_borrowAmount >= 0.0, "Borrowed amount cannot be negative");
        if (add) {
            require(uint(borrowedAmount + _borrowAmount) <= maxLoanAmount, "Cannot borrow more than loan amount");
            borrowedAmount += _borrowAmount;
        } else {
            require(borrowedAmount >= _borrowAmount, "Cannot pay back more than loan amount");
            borrowedAmount -= _borrowAmount;
        }
    }

    function updateOnPriceChange(decimal _newPrice, uint _loanToValueRatio) external {
        require(msg.sender == reserve, "Only reserve can update collateral price");
        _updateOnPriceChange(_newPrice, _loanToValueRatio);
        lastRewardTimestamp = block.timestamp;
    }

    function _updateOnPriceChange(decimal _newPrice, uint _loanToValueRatio) internal {
        collateralValue = collateralQuantity * _newPrice.truncate(2);
        maxLoanAmount = uint(collateralValue * decimal(_loanToValueRatio));
    }

    function updateTotalCataReward(decimal _newCataReward) external {
        require(msg.sender == reserve, "Only reserve can update CATA reward");
        totalCataRewardInDollars += _newCataReward;
    }

    function updateReserve(address _newReserve) external {
        require(msg.sender == reserve, "Only the existing reserve can update the reserve address");
        reserve = _newReserve;
    }

}
