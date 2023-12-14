pragma es6;
pragma strict;

import <a3d9911aeffee71e0c6cd37946d80f3864b49d45>;

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