pragma es6;
pragma strict;

import <ed13af446c955a0fe01417e962fca11ff3721b0f>;

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

