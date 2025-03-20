pragma solidvm 11.5;

import <509>;
import "../Assets/Asset.sol";
import "../Staking/Reserve.sol";
import "../Utils/Utils.sol";

abstract contract Escrow is Utils {
    address public reserve;
    uint public collateralQuantity;
    uint public collateralValue;
    uint public maxLoanAmount; 
    uint public liquidationAmount;
    uint public totalCataReward;
    uint public borrowedAmount;
    uint public lastRewardTimestamp;
    bool public isActive;

    address public borrower;
    string public borrowerCommonName;
    address public assetRootAddress;

    string public version;

    constructor(
        address[] _assets,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio,
        uint _liquidationRatio,
        string _version
        ) {
        reserve = msg.sender;
        borrower = address(0);
        assetRootAddress = address(0);
        attachAssets(_assets, _collateralQuantity, _assetPrice, _loanToValueRatio, _liquidationRatio);
        require(collateralQuantity > 0, "No collateral has been staked");
        totalCataReward = 0; // Assuming the CATA reward rate is provided externally
        isActive = true;
        lastRewardTimestamp = block.timestamp;
        version = _version;
    }

    function attachAsset(
        address _asset,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio,
        uint _liquidationRatio
    ) public {
        require(msg.sender == reserve, "Only the reserve can attach assets to the escrow");
        uint unallocatedQuantity = _collateralQuantity;
        Asset asset = Asset(_asset);
        asset.transferOwnership(address(this), _collateralQuantity, false, 0);
        collateralQuantity += _collateralQuantity;
        _updateOnPriceChange(_assetPrice, _loanToValueRatio, _liquidationRatio);
    }

    function showUSDSTValue(uint _value) internal returns (string) {
        return string(_value)
             + "."
             + string(_value)
             + " USDST";
    }

    function unlockAssets(
        uint _quantity,
        decimal _assetPrice,
        uint _loanToValueRatio,
        uint _liquidationRatio
    ) public {
        require(msg.sender == reserve, "Only the reserve can unlock assets from the escrow");
        uint quantityToUnlock = _quantity;
        if (_quantity > collateralQuantity) {
            quantityToUnlock = collateralQuantity;
        }

        Asset(assetRootAddress).transferOwnership(borrower, quantityToUnlock, false, 0);

        collateralQuantity -= quantityToUnlock - unallocatedQuantity;
        _updateOnPriceChange(_assetPrice, _loanToValueRatio, _liquidationRatio);
        require(borrowedAmount <= maxLoanAmount, "Invalid unstaking attempt: unstaking "
                                               + string(quantityToUnlock)
                                               + " units would result in undercollateralization."
                                               + "\nCurrent loan balance: "
                                               + showUSDSTValue(uint(borrowedAmount))
                                               + "\nCollateral value after unstaking: "
                                               + showUSDSTValue(uint(collateralValue))
                                               + "\nMaximum loan amount after unstaking: "
                                               + showUSDSTValue(uint(maxLoanAmount)));
        if (collateralQuantity == 0) {
            isActive = false;
        }
    }

    //Update this
    function updateBorrowedAmount(uint _borrowAmount, bool add) external {
        require(msg.sender == reserve, "Only reserve can update borrowed amount");
        require(_borrowAmount >= 0, "Borrowed amount cannot be negative");
        if (add) {
            require(borrowedAmount + _borrowAmount <= maxLoanAmount, "Cannot borrow more than loan amount");
            borrowedAmount += _borrowAmount;
        } else {
            require(borrowedAmount >= _borrowAmount, "Cannot pay back more than loan amount");
            borrowedAmount -= _borrowAmount;
        }
    }

    function updateOnPriceChange(decimal _newPrice, uint _loanToValueRatio, uint _liquidationRatio) external {
        require(msg.sender == reserve, "Only reserve can update collateral price");
        _updateOnPriceChange(_newPrice, _loanToValueRatio, _liquidationRatio);
        lastRewardTimestamp = block.timestamp;
    }

    function _updateOnPriceChange(decimal _newPriceInUSDST, uint _loanToValueRatio, uint _liquidationRatio) internal {
        uint newCollateralValue = uint((decimal(collateralQuantity).truncate(4) * _newPriceInUSDST).truncate(0)); // 1 USDST per dollar * 10^18 USDST units per USDST = 10^18.
        collateralValue = uint(newCollateralValue);
        maxLoanAmount = uint(collateralValue * _loanToValueRatio/ 100);
        liquidationAmount = uint(collateralValue * _liquidationRatio/100);
    }

    function updateTotalCataReward(uint _newCataReward) external {
        require(msg.sender == reserve, "Only reserve can update CATA reward");
        totalCataReward += _newCataReward;
    }

    function updateReserve(address _newReserve) external {
        require(msg.sender == reserve, "Only the existing reserve can update the reserve address");
        reserve = _newReserve;
    }

    function updateVersion(string _newVersion) external {
        require(msg.sender == reserve, "Only the reserve can update the version");
        version = _newVersion;
    }
}
