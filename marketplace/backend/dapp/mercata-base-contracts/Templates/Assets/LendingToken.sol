pragma es6;
pragma strict;

/// @title A representation of Token assets
abstract contract LendingToken is Mintable, ReserveMinterAuthorization {
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
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) ReserveMinterAuthorization(_name) {
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        LendingToken newToken = new LendingToken(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService));
        return UTXO(address(newToken)); 
    }

    function mintNewUnits(uint _quantity) public override returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(_quantity > 0, "Quantity must be greater than 0");
        require(ReserveMinterAuthorization(address(this)).isReserveMinter(msg.sender), "Only one of the minter can mint new units");
        emit OwnershipTransfer(
            originAddress,
            address(0),
            "",
            owner,
            ownerCommonName,
            itemNumber + quantity,
            itemNumber + quantity + _quantity - 1
        );
        quantity += _quantity;
        return RestStatus.OK;
    }

    function transferByReserve(address _userAddress, uint _quantity) public {
        require(ReserveMinterAuthorization(address(this)).isReserveMinter(msg.sender), "Only one of the minter can mint new units");
        
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        _transfer(_userAddress, _quantity, true, transferNumber, 0.000000000000000001);
    }

        // Quantity is already checked by transferOwnership function
    // function _transfer(address _newOwner, uint _quantity, bool _isUserTransfer, uint _transferNumber, decimal _price) internal override {
    //     require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
    //     require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
    //     require(_quantity > 0, "Quantity must be greater than 0");
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