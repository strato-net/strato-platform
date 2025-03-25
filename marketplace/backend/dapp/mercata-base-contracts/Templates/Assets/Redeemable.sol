import "Asset.sol";
import "../Redemptions/RedemptionService.sol";
import "MercataMetadata.sol";


abstract contract Redeemable is Asset, ERC20Burnable {

    RedemptionService public redemptionService;
    Metadata public metadata;
    mapping(address => uint) public redemptionRequests;

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint256 _initialSupply,
        uint _decimals,
        address _redemptionService,
        address _metadataContract
    ) Asset(
        _name,
        _symbol,
        _initialSupply,
        _decimals
    ) {
        metadata = Metadata(_metadataContract);
        metadata.registerMetadata(address(this), _name, _description, _images, _files, _fileNames, _createdDate);
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

    function requestRedemption(string _redemptionId, uint _quantity) onlyOwner("request redemption") public returns (uint, address) {
        require(_quantity > 0, "Quantity must be greater than 0");

        uint restStatus = issueRedemptionRequest(_redemptionId, _quantity);

        return (restStatus, address(this));
    }

    function issueRedemptionRequest(string _redemptionId, uint _quantity) onlyOwner("issue redemption request") public returns (uint) {
        transfer(owner(), _quantity); //transfer to the owner or issuer
        RedemptionService(getRedemptionService()).redemptionRequested(_redemptionId);
        redemptionRequests[msg.sender] += _quantity;
        return RestStatus.OK;
    }

    function redemptionCompleted(string _redemptionId, address _redeemer,uint _quantity) onlyOwner("redeem redemption") public returns (uint) {
        burn(_quantity);//redemption completed, burn the tokens from the owner
        redemptionRequests[_redeemer] -= _quantity;
        return RestStatus.OK;
    }

    function redemptionCancelled(string _redemptionId, address _newOwner, uint _quantity) onlyOwner("cancel redemption") public returns (uint) {
        transfer(_newOwner, _quantity);
        redemptionRequests[msg.sender] -= _quantity;
        return RestStatus.OK;
    }

    function getRedemptionQuantity(address _redeemer) public view returns (uint) {
        return redemptionRequests[_redeemer];
    }
}
