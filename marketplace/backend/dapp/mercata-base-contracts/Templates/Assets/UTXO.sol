import "Asset.sol";

abstract contract UTXO is Asset {
    uint public utxoMagicNumber = 0x5554584F; // 'UTXO'

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        AssetStatus _status
    ) Asset(
        _name,
        _description,
        _images,
        _files,
        _fileNames,
        _createdDate,
        _quantity,
        _status
    ) {
    }

    function mint(uint _quantity) internal virtual returns (UTXO) {
        return new UTXO(name, description, images, files, fileNames, createdDate, _quantity, status);
    }

    // Quantity is already checked by transferOwnership function
    function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, decimal _price) internal override {
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(checkCondition(), "Condition is not met");
        // Create a new UTXO with a portion of the units
        try {
            // This is a hack to prevent the splitted UTXO from infinitely creating new UTXOs
            assert(UTXO(owner).utxoMagicNumber() == utxoMagicNumber);
            owner = _newOwner;
            ownerCommonName = getCommonName(_newOwner);
        } catch {
            
            if(_isUserTransfer && _transferNumber>0){
            // Emit ItemTransfers Event
                emit ItemTransfers(
                    originAddress,
                    owner,
                    ownerCommonName,
                    _newOwner,
                    getCommonName(_newOwner),
                    name,
                    itemNumber,
                    itemNumber + _quantity - 1,
                    _quantity,
                    _transferNumber,
                    block.timestamp,
                    _price
                    );
            }

            emit OwnershipTransfer(
                originAddress,
                owner,
                ownerCommonName,
                _newOwner,
                getCommonName(_newOwner),
                itemNumber,
                itemNumber + _quantity - 1
            );
            _callMint(_newOwner, _quantity);
            quantity -= _quantity;
            itemNumber += _quantity;
        }
    }

    function _callMint(address _newOwner, uint _quantity) internal virtual{
        UTXO newAsset = mint(_quantity);
        Asset(newAsset).transferOwnership(_newOwner, _quantity, false, 0, 0);
    }

    function checkCondition() internal virtual returns (bool){
        return true;
    }
}