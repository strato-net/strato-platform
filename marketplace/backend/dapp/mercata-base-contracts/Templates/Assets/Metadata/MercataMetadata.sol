pragma es6;
pragma strict;

import "../Utils/Utils.sol";

abstract contract MercataMetadata is Utils {
    address owner;
    string ownerCommonName;

    constructor(){
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);
    }

    struct TokenMetadata {
        string name;
        string description;
        string[] images;
        string[] files;
        string[] fileNames;
        uint createdDate;
    }

    mapping(address => TokenMetadata) public record tokenMetadata;

    function registerMetadata(
        address tokenAddress,
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate
        ) public virtual {
        require(getCommonName(msg.sender) == tokenAddress.creator || msg.sender == tokenAddress, "Only the the creator or the token can register metadata");
        tokenMetadata[tokenAddress] = TokenMetadata(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _createdDate
        );
    }
}
