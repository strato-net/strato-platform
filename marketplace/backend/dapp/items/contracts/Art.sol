pragma es6;
pragma strict;

import <1d2bdc27fe948a302ced772409305ff42bd76582>;

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
    ) public Asset(_name, _description, "Art", "Art", _images, _files, _createdDate, 1) {
        artist = _artist;
    }
}

