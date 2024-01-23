pragma es6;
pragma strict;

import <b63644c5e28bb14f2c6f420c8adf318272a419cd>;

/// @title A representation of CarbonDAO assets
contract CarbonDAO is SemiFungible {
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity
    ) public SemiFungible(_name, _description, _images, _files, _createdDate, _quantity) {
    }

    function mint(uint _quantity) internal override returns (UTXO) {
        CarbonDAO newAsset = new CarbonDAO(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity
        );
        return UTXO(address(newAsset));
    }
}
