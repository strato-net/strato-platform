pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of CarbonDAO assets
contract CarbonDAO is SemiFungible {
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        uint _quantity,
        string _serialNumber
    ) public SemiFungible(_name, _description, _images, _files, _createdDate, _quantity, _serialNumber) {
    }

    function mint(unit _quantity) internal override returns (UTXO) {
        CarbonDAO newAsset = new CarbonDAO(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity,
            serialNumber
        );
        return UTXO(newAsset);
    }
}
