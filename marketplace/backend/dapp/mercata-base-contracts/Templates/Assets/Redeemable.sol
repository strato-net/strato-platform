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
        uint _createdDate,
        uint _quantity,
        AssetStatus _status,
        address _redemptionService
    ) UTXO(
        _name,
        _description,
        _images,
        _files,
        _createdDate,
        _quantity,
        _status
    ) {
        redemptionService = RedemptionService(_redemptionService);
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        return UTXO(new Redeemable(name, description, images, files, createdDate, _quantity, status, address(redemptionService)));
    }

    function _callMint(address _newOwner, uint _quantity) internal virtual override {
        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }
    
    function checkCondition() internal virtual override returns (bool){
        return true;   
    }

    function requestRedemption(uint _quantity) public returns (uint, address) {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(getCommonName(msg.sender) == ownerCommonName, "Only the owner of the Asset can request for redemption");

        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(owner, _quantity, false, 0, 0);
        Asset(newAsset).updateStatus(AssetStatus.PENDING_REDEMPTION);
        quantity -= _quantity;

        return (RestStatus.OK, address(newAsset));
    }
}
