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
        uint _decimals,
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
        _decimals,
        _status
    ) {
        redemptionService = RedemptionService(_redemptionService);
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        return UTXO(new Redeemable(name, description, images, files, fileNames, createdDate, _quantity, decimals, status, address(redemptionService)));
    }

    function _callMint(address _newOwner, uint _quantity) internal virtual override {
        require(_quantity > 0, "Quantity must be greater than 0");
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
        require(_quantity > 0, "Quantity must be greater than 0");

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

        // Quantity is already checked by transferOwnership function
    // function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, decimal _price) internal override {
    //     require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
    //     require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
    //     require(_quantity > 0, "Quantity must be greater than 0");
    //     require(checkCondition(), "Condition is not met");
    //     // Create a new UTXO with a portion of the units
    //     try {
    //         // This is a hack to prevent the splitted UTXO from infinitely creating new UTXOs
    //         assert(UTXO(owner).utxoMagicNumber() == utxoMagicNumber);
    //         owner = _newOwner;
    //         ownerCommonName = getCommonName(_newOwner);
    //     } catch {
            
    //         if(_isUserTransfer && _transferNumber>0){
    //         // Emit ItemTransfers Event
    //             emit ItemTransfers(
    //                 originAddress,
    //                 owner,
    //                 ownerCommonName,
    //                 _newOwner,
    //                 getCommonName(_newOwner),
    //                 name,
    //                 itemNumber,
    //                 itemNumber + _quantity - 1,
    //                 _quantity,
    //                 _transferNumber,
    //                 block.timestamp,
    //                 _price
    //                 );
    //         }

    //         emit OwnershipTransfer(
    //             originAddress,
    //             owner,
    //             ownerCommonName,
    //             _newOwner,
    //             getCommonName(_newOwner),
    //             itemNumber,
    //             itemNumber + _quantity - 1
    //         );
    //         _callMint(_newOwner, _quantity);
    //         quantity -= _quantity;
    //         itemNumber += _quantity;
    //     }
    // }

}
