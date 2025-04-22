pragma es6;
pragma strict;

import "../Utils/Utils.sol";

abstract contract TokenMetadata is Utils {
    address owner;
    string ownerCommonName;

    constructor(){
        owner = msg.sender;
        ownerCommonName = getCommonName(msg.sender);
    }

    struct MetadataInfo {
        string name;
        string description;
        string[] images;
        string[] files;
        string[] fileNames;
        uint createdDate;
    }

    struct MetadataAttributes {
        string key;
        string value;
    }

    mapping(address => MetadataInfo) public record metadataInfo;
    mapping(address => MetadataAttributes) public record metadataAttributes;

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
        metadataInfo[tokenAddress] = MetadataInfo(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _createdDate
        );
    }

    function registerMetadataAttribute(
        address tokenAddress,
        string key,
        string value
    ) public virtual {
        require(getCommonName(msg.sender) == tokenAddress.creator || msg.sender == tokenAddress, "Only the the creator or the token can register metadata");
        metadataAttributes[tokenAddress] = MetadataAttributes(
            key,
            value
        );
    }
}
