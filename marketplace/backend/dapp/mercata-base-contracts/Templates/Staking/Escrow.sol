import "../Assets/Asset.sol";
import "../Sales/Sale.sol";
import "../Utils/Utils.sol";

// TODO: Need to do the unstaking flow
// TODO: Security review
// TODO: Add the Oracle?

contract Escrow is Sale {
    address public reserve;
    address public borrower;
    uint public silverAmount;
    uint public stratsLoanAmount;
    uint public cataReward;
    uint public cataWeeklyReward;


    event LoanClaimed(address indexed borrower, uint loanAmount);
    event CollateralReleased(address indexed borrower, uint silverAmount);

    modifier onlyReserve() {
        require(msg.sender == reserve, "Only Reserve can call this");
        _;
    }

    constructor(
        address _borrower,
        uint _silverAmount,
        address _silverAsset,
        uint _stratsLoanAmount,
        uint _cataReward,
        address _reserve
    ) Sale(_silverAsset, 0, _silverAmount, new PaymentService[] ) {
        borrower = _borrower;
        silverAmount = _silverAmount;
        stratsLoanAmount = _stratsLoanAmount;
        cataReward = _cataReward;
        cataWeeklyReward = uint(cataRewardRate / 52);
        reserve = _reserve;

        // Attach this Escrow contract as the sale of the Silver asset
        Asset(_silverAsset).attachSale();
    }

    function getAssetAmount() public view returns (uint) {
        return silverAmount;
    }

    function releaseCollateral(address requester) external onlyReserve {
        Asset(assetToBeSold).transferOwnership(requester, silverAmount, false, 0, 0);
        emit CollateralReleased(requester, silverAmount);
    }

    function attachEscrowToAsset(address asset) public onlyReserve {
        // Attach the Escrow contract to the specified asset
        Asset(asset).attachSale();
    }
}
