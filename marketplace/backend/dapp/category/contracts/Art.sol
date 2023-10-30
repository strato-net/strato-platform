
/// @title The Art Category
contract Art {
  
    string public category = "Art";
    string public artist;

    constructor (string _artist) public {
        artist = _artist;
    }
}