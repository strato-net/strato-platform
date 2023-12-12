pragma es6;
pragma strict;

import <86483be23fa65cf7f992d9cb35eca840e74090bc>;

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

    function mint(unit _quantity) internal override returns (UTXO) {
        CarbonDAO newAsset = new CarbonDAO(
            name,
            description,
            images,
            files,
            createdDate,
            _quantity
        );
        return UTXO(newAsset);
    }
}
