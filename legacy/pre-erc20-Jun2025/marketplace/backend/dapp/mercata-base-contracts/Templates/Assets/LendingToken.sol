/// @title A representation of Token assets
abstract contract LendingToken is Mintable, MinterAuthorization {
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
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _decimals, _status, _redemptionService) MinterAuthorization(_name) {
    }

    function mint(uint _quantity) internal virtual override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        LendingToken newToken = new LendingToken(name, description, images, files, fileNames, createdDate, _quantity, decimals, status, address(redemptionService));
        return UTXO(address(newToken));
    }

    function mintNewUnits(uint _quantity) public override returns (uint) {
        require(isMint, "Only the mint contract can mint new units");
        require(status != AssetStatus.PENDING_REDEMPTION, "Asset is not in ACTIVE state.");
        require(status != AssetStatus.RETIRED, "Asset is not in ACTIVE state.");
        require(_quantity > 0, "Quantity must be greater than 0");
        require(getCommonName(msg.sender) == minterCommonName || MinterAuthorization(address(this)).isReserveMinter(msg.sender), "Only one of the minters can mint new units");
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
        require(MinterAuthorization(address(this)).isReserveMinter(msg.sender), "Only one of the minter can mint new units");

        uint transferNumber = (uint(block.number + 16)) % 1000000;

        _transfer(_userAddress, _quantity, true, transferNumber, 0.000000000000000001);
    }

}