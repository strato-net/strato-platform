pragma es6;
pragma strict;

import <86483be23fa65cf7f992d9cb35eca840e74090bc>;

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

