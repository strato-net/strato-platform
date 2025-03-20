import "Asset.sol";
import "../Redemptions/RedemptionService.sol";

abstract contract Redeemable is Asset {

    RedemptionService public redemptionService;
    
    mapping(address => uint) public redemptionRequests;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals,
        address _redemptionService
    ) Asset(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _decimals
    ) {
        redemptionService = RedemptionService(_redemptionService);
    }

    function getRedemptionService() internal returns (RedemptionService) {
        redemptionService = Redeemable(this.root).redemptionService();
        return redemptionService;
    }

    function updateRedemptionService(address _redemptionService) public {
        require(address(this) == this.root, "Only the root asset can have its redemption service updated.");
        require(getCommonName(msg.sender) == this.creator, "Only the issuer can update the redemption service.");
        redemptionService = RedemptionService(_redemptionService);
    }

    function requestRedemption(string _redemptionId, uint _quantity) requireOwner("request redemption") public returns (uint, address) {
        require(_quantity > 0, "Quantity must be greater than 0");

        uint restStatus = issueRedemptionRequest(_redemptionId, owner);

        return (restStatus, address(this));
    }

    function issueRedemptionRequest(string _redemptionId, address _newOwner) requireOwner("issue redemption request") public returns (uint) {
        _transferAsset(_newOwner, quantity, false, 0);
        RedemptionService(getRedemptionService()).redemptionRequested(_redemptionId);
        redemptionRequests[msg.sender] += quantity;
        
        return RestStatus.OK;
    }

}
