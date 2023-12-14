pragma es6;
pragma strict;

import <787dbd85880c9c4c238dd7ef4b4b1b8c8f0eb95f>;

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

