import "UTXO.sol";
import "../Redemptions/RedemptionService.sol";

abstract contract Redeemable is UTXO {
    uint public redeemableMagicNumber = 0x52656465656d61626c65; // 'Redeemable'

    RedemptionService public redemptionService;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) UTXO(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _status
    ) {
        redemptionService = RedemptionService(_redemptionService);
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        return UTXO(new Redeemable(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService)));
    }

    function _callMint(address _newOwner, uint _quantity) internal virtual override {
        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
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
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");

        UTXO newAsset = mint(_quantity);
        quantity -= _quantity;
        uint restStatus = Redeemable(newAsset).issueRedemptionRequest(_redemptionId, owner);

        return (restStatus, address(newAsset));
    }

    function issueRedemptionRequest(string _redemptionId, address _newOwner) requireOwner("issue redemption request") public returns (uint) {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");

        _transfer(_newOwner, quantity, false, 0, 0);
        RedemptionService(getRedemptionService()).redemptionRequested(_redemptionId);
        status = AssetStatus.PENDING_REDEMPTION;

        return RestStatus.OK;
    }
}
