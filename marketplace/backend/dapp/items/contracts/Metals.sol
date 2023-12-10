pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

/// @title A representation of Metals assets
contract Metals is Asset {
    string public serialNumber;
    string public source;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        string _source,
        string _serialNumber
    ) public Asset(_name, _description, "Metals", "Metals", _images, _files, _createdDate, 1) {
        serialNumber = _serialNumber;
        source = _source;
    }
}