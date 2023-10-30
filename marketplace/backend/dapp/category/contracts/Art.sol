
/// @title The Art Category
contract Art {

    string public category = "Art";
    string public artist;
    string public collection;
    string public style;

    constructor (
        string _artist
      , string _collection
      , string _style
    ) public {
        artist = _artist;
        collection = _collection;
        style = _style;
    }
}