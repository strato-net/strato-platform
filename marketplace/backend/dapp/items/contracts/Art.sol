pragma es6;
pragma strict;

import <3efeac2e0e1801d90653e56ebdce867bbec5874a>;

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

