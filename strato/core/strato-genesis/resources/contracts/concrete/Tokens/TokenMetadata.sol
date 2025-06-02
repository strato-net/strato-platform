contract TokenMetadata {
    string description;
    string[] public record images;
    string[] public record files;
    string[] public record fileNames;

    mapping(string => string) public record attributes;

    constructor(
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ){
        description = _description;
        images = _images;
        files = _files;
        fileNames = _fileNames;
    }

    function _setMetadata(
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) internal {
        description = _description;
        images = _images;
        files = _files;
        fileNames = _fileNames;
    }

    function _setAttribute(
        string key,
        string value
    ) internal {
        attributes[key] = value;
    }
}
