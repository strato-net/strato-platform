pragma es6;
pragma strict;

/// @title A representation of Token assets
abstract contract LendingToken is Asset, MinterAuthorization {
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        uint _quantity,
        uint _decimals
    ) public Asset(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _decimals) MinterAuthorization(_name) {
    }

    function transferByReserve(address _userAddress, uint _quantity) public {
        require(MinterAuthorization(address(this)).isReserveMinter(msg.sender), "Only one of the minter can mint new units");
                
        _transferAsset(_userAddress, _quantity, true, 0.000000000000000001);
    }

}