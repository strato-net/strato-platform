import "Asset.sol";

abstract contract UTXO is Asset {
    uint public utxoMagicNumber = 0x5554584F; // 'UTXO'
    event AssetSplit(address newAsset, uint unitsMoved);

    constructor(
        string _name,
        string _description,
        string _category,
        string _subCategory,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) Asset(
        _name,
        _description,
        _category,
        _subCategory,
        _images,
        _files,
        _createdDate,
        _quantity
    ) {
    }

    function mint(uint _quantity) internal virtual returns (UTXO) {
        return new UTXO(name, description, category, subCategory, images, files, createdDate, quantity);
    }

    // Quantity is already checked by transferOwnership function
    function _transfer(address _newOwner, uint _quantity) internal override {
        // Create a new UTXO with a portion of the units
        try {
            // This is a hack to prevent the splitted UTXO from infinitely creating new UTXOs
            assert(UTXO(owner).utxoMagicNumber() == utxoMagicNumber);
            owner = _newOwner;
            ownerCommonName = getCommonName(_newOwner);
        } catch {
            UTXO newAsset = mint(_quantity);
            Asset(newAsset).transferOwnership(_newOwner, _quantity);
            quantity -= _quantity;
            emit AssetSplit(address(newAsset), _quantity);
        }
    }
}