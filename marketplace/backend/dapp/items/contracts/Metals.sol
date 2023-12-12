pragma es6;
pragma strict;

import <1d2bdc27fe948a302ced772409305ff42bd76582>;

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