pragma es6;
pragma strict;

import <9171f04844f9c3d8883821cbcdf91983a5d1d522>;

/// @title A representation of Art assets
contract Art is Asset {
    string public artist;

    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        uint _createdDate,
        string _artist
    ) public Asset(_name, _description, _images, _files, _createdDate, 1) {
        artist = _artist;
    }
}

