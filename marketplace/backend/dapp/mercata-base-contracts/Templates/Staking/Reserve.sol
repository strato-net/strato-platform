pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Sales/Escrow.sol";
import "../Utils/Utils.sol";
import "../Structs/Structs.sol";
import "../Oracle/OracleService.sol";

abstract contract Reserve is Utils, Structs {
    OracleService public oracle;
    address public owner;
    string public name;
    bool public isActive = true;

    Asset public stratsToken;
    address public cataToken;//Manual for now
    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards

    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);

    constructor(address _assetOracle, address _cataToken, string _name) {
        oracle = OracleService(_assetOracle);
        cataToken = _cataToken;
        owner = msg.sender;
        name = _name;
    }

    modifier requireActive() {
        require(isActive, "Reserve is not active");
        _;
    }

    modifier requireOwner(string action) {
        require(msg.sender == owner, "Only owner can " + action + ".");
        _;
    }

    function createEscrow(address _assetAddress, PaymentServiceInfo _stratPaymentService) public requireActive() returns (address) {
        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        uint _quantity = _assetToBeSold.quantity();
        (decimal _assetPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        uint stratsLoanAmount = uint((decimal(_quantity) * _assetPrice * decimal(loanToValueRatio)) / 100);
        decimal cataReward = decimal(_quantity * stratsLoanAmount * cataAPYRate) / 100;

        // Create the Escrow contract but do not attach assets or transfer STRATS
        Escrow escrow = new Escrow(msg.sender, stratsLoanAmount, cataReward, _assetToBeSold, _assetPrice, _quantity, [_stratPaymentService]);

        stakeAsset(escrow);

        return address(escrow);
    }

    function stakeAsset(Escrow _escrow) internal {
        uint stratsLoanAmount = _escrow.stratsLoanAmount();
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transferOwnership(_escrow.borrower(), stratsLoanAmount*100, true, transferNumber, 0.0001);

        // Emit the StakeCreated event
        emit StakeCreated(msg.sender, address(_escrow), _escrow.quantity(), stratsLoanAmount, _escrow.cataReward());
    }
    
    function calculateCATAReward(uint _assetAmount, decimal _stratsLoanAmount) internal view returns (decimal) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (decimal(_assetAmount) * _stratsLoanAmount * decimal(cataAPYRate)) / 100;
    }

    function getStratsToken() public view returns (Asset) {
        return stratsToken;
    }

    function setStratsToken(address _newStratsToken) public requireOwner("update STRATS token") {
        stratsToken = Asset(_newStratsToken);
    }

    function transferSTRATSbacktoOwner(uint _amount) public requireOwner("transfer STRATS back") {
        stratsToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function deactivate() public requireActive() requireOwner("deactivate reserve") {
        isActive = false;
    }
}