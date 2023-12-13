pragma es6;
pragma strict;

import <ed13af446c955a0fe01417e962fca11ff3721b0f>;

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