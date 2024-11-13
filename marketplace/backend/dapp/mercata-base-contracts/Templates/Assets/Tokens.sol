pragma es6;
pragma strict;


/// @title A representation of Token assets
contract Tokens is Mintable {

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
    ) public Mintable(_name, _description, _images, _files, _fileNames, _createdDate, _quantity, _status, _redemptionService) {}

    function mint(uint _quantity) internal override returns (UTXO) {
        require(_quantity > 0, "Quantity must be greater than 0");
        Tokens newToken = new Tokens(name, description, images, files, fileNames, createdDate, _quantity, status, address(redemptionService));
        return UTXO(address(newToken)); 
    }
}