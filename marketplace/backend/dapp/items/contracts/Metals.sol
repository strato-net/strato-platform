pragma es6;
pragma strict;

import <787dbd85880c9c4c238dd7ef4b4b1b8c8f0eb95f>;

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
    ) public Asset(_name, _description, _images, _files, _createdDate, 1) {
        serialNumber = _serialNumber;
        source = _source;
    }
}