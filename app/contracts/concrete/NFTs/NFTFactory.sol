/**
 * @title NFTFactory
 * @notice Factory pattern contract that standardizes NFT collection creation and tracking
 * @dev While collections are created here, users interact directly with collection contracts after creation.
 *      Mirror of concrete/Tokens/TokenFactory.sol.
 */

// SPDX-License-Identifier: MIT
import "./NFT.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";

/// @notice NFT collection factory contract
contract record NFTFactory is Ownable {

    // ============ EVENTS ============

    /// @notice Event emitted when a new collection is created
    event NFTCollectionCreated(address collection, address creator, string name, string symbol);

    /// @notice Event emitted when collections are migrated
    event NFTCollectionsMigrated(address oldFactory, address newFactory, uint256 collectionCount);

    /// @notice Event emitted when collections are registered
    event NFTCollectionsRegistered(uint256 collectionCount);

    // ============ STATE VARIABLES ============

    /// @notice Mapping of collection addresses to factory collection status
    mapping(address => bool) public isFactoryCollection;

    /// @notice Array of all collection addresses
    address[] public record allCollections;

    // ============ CONSTRUCTOR ============

    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) {
    }

    // ============ COLLECTION MANAGEMENT ============

    /// @notice Create a new NFT collection
    /// @param _name Collection name
    /// @param _description Collection description
    /// @param _images Array of image URLs
    /// @param _files Array of file URLs
    /// @param _fileNames Array of file names
    /// @param _symbol Collection symbol
    /// @return Address of the created collection
    function createNFTCollection(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol
    ) external onlyOwner returns (address) {
        return createNFTCollectionWithInitialOwner(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _symbol,
            msg.sender
        );
    }

    function createNFTCollectionWithInitialOwner(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        address _initialOwner
    ) public onlyOwner returns (address) {
        NFT newCollection = NFT(address(new Proxy(address(new NFT(_initialOwner)), address(this))));
        newCollection.initialize(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _symbol
        );
        newCollection.transferOwnership(_initialOwner);

        // Register the collection
        address collectionAddress = address(newCollection);
        isFactoryCollection[collectionAddress] = true;
        allCollections.push(collectionAddress);

        emit NFTCollectionCreated(collectionAddress, msg.sender, _name, _symbol);
        return collectionAddress;
    }

    /// @notice Check if a collection is active and belongs to this factory
    /// @param collection Collection address to check
    /// @return True if collection is active and belongs to this factory
    function isCollectionActive(address collection) external view returns (bool) {
        return NFT(collection).status() == NFTStatus.ACTIVE && isFactoryCollection[collection];
    }

    /// @notice Migrate collections to a new factory
    /// @param newFactory Address of the new factory
    function migrateCollectionsToFactory(address newFactory) external onlyOwner {
        for (uint256 i = 0; i < allCollections.length; i++) {
            NFT(allCollections[i]).setNFTFactory(newFactory);
        }
        emit NFTCollectionsMigrated(address(this), newFactory, allCollections.length);
    }

    /// @notice Register collections that were migrated from another factory
    /// @param collections Array of collection addresses to register
    function registerMigratedCollections(address[] collections) external onlyOwner {
        for (uint256 i = 0; i < collections.length; i++) {
            isFactoryCollection[collections[i]] = true;
            allCollections.push(collections[i]);
        }
        emit NFTCollectionsRegistered(collections.length);
    }
}
