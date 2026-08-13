// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/NFTs/NFT.sol";
import "../../concrete/NFTs/NFTFactory.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_NFTFactory {
    NFTFactory factory;
    User user1;
    address owner;
    string[] emptyArray;

    function beforeAll() {
        owner = address(this);
        user1 = new User();
        emptyArray = new string[](0);
    }

    function beforeEach() {
        factory = new NFTFactory(owner);
    }

    function createCollection() internal returns (address) {
        return factory.createNFTCollection(
            "Test Collection",
            "Test Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TNFT"
        );
    }

    function it_factory_creates_and_registers_collection() {
        address collection = createCollection();
        require(collection != address(0), "Collection address should not be zero");
        require(factory.isFactoryCollection(collection), "Collection should be registered");
        require(factory.allCollections(0) == collection, "Collection should be in allCollections");
    }

    function it_factory_tracks_multiple_collections() {
        address c1 = createCollection();
        address c2 = createCollection();
        require(c1 != c2, "Collections should have distinct addresses");
        require(factory.allCollections(0) == c1, "First collection tracked");
        require(factory.allCollections(1) == c2, "Second collection tracked");
    }

    function it_factory_collection_active_flow() {
        address collection = createCollection();
        require(!factory.isCollectionActive(collection), "New collection should not be active (PENDING)");

        NFT(collection).setStatus(2); // ACTIVE
        require(factory.isCollectionActive(collection), "Collection should be active after setStatus(2)");

        NFT(collection).setStatus(3); // LEGACY
        require(!factory.isCollectionActive(collection), "LEGACY collection should not be active");
    }

    function it_factory_unknown_collection_is_not_active() {
        address collection = createCollection();
        NFT(collection).setStatus(2);

        NFTFactory otherFactory = new NFTFactory(owner);
        require(!otherFactory.isCollectionActive(collection), "Foreign collection should not be active");
    }

    function it_factory_only_owner_can_create() {
        bool reverted = false;
        try {
            user1.do(
                address(factory),
                "createNFTCollection",
                "X", "Y", emptyArray, emptyArray, emptyArray, "Z"
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Create by a non-owner should revert");
    }

    function it_factory_migration_flow() {
        address collection = createCollection();
        NFTFactory newFactory = new NFTFactory(owner);

        factory.migrateCollectionsToFactory(address(newFactory));
        require(address(NFT(collection).nftFactory()) == address(newFactory), "Collection should point at new factory");

        address[] memory collections = new address[](1);
        collections[0] = collection;
        newFactory.registerMigratedCollections(collections);
        require(newFactory.isFactoryCollection(collection), "New factory should register migrated collection");

        NFT(collection).setStatus(2);
        require(newFactory.isCollectionActive(collection), "Migrated collection should be active in new factory");
    }
}
