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

contract Describe_NFT {
    NFT nft;
    NFTFactory factory;
    User user1;
    User user2;
    address owner;
    string[] emptyArray;

    function beforeAll() {
        owner = address(this);
        factory = new NFTFactory(owner);
        user1 = new User();
        user2 = new User();
        emptyArray = new string[](0);
    }

    function beforeEach() {
        address collectionAddress = factory.createNFTCollectionWithInitialOwner(
            "Test Collection",
            "Test Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TNFT",
            owner
        );
        nft = NFT(collectionAddress);
    }

    // ============ LIFECYCLE ============

    function it_nft_starts_pending_with_next_id_one() {
        require(uint(nft.status()) == 1, "Should start with PENDING status");
        require(nft.nextTokenId() == 1, "First token id should be 1");
        require(keccak256(nft.name()) == keccak256("Test Collection"), "Name should be set by initialize");
        require(keccak256(nft.symbol()) == keccak256("TNFT"), "Symbol should be set by initialize");
    }

    function it_nft_double_initialize_reverts() {
        bool reverted = false;
        try {
            nft.initialize("X", "Y", emptyArray, emptyArray, emptyArray, "Z");
        } catch {
            reverted = true;
        }
        require(reverted, "Second initialize should revert");
    }

    function it_nft_can_set_status() {
        nft.setStatus(2);
        require(uint(nft.status()) == 2, "Status should be ACTIVE (2)");
        nft.setStatus(3);
        require(uint(nft.status()) == 3, "Status should be LEGACY (3)");
    }

    function it_nft_set_same_status_reverts() {
        bool reverted = false;
        try { nft.setStatus(1); } catch { reverted = true; }
        require(reverted, "Setting the same status should revert");
    }

    function it_nft_has_correct_factory() {
        require(address(nft.nftFactory()) == address(factory), "NFT factory not set correctly");
    }

    // ============ MINTING ============

    function it_nft_mint_returns_incrementing_ids() {
        uint256 id1 = nft.mint(address(user1), "ipfs://1");
        uint256 id2 = nft.mint(address(user1), "ipfs://2");
        require(id1 == 1, "First id should be 1");
        require(id2 == 2, "Second id should be 2");
        require(nft.nextTokenId() == 3, "nextTokenId should advance");
        require(nft.ownerOf(1) == address(user1), "Owner of id 1 should be user1");
        require(nft.ownerOf(2) == address(user1), "Owner of id 2 should be user1");
        require(nft.balanceOf(address(user1)) == 2, "Balance should be 2");
    }

    function it_nft_mint_stores_token_uri() {
        uint256 id = nft.mint(address(user1), "ipfs://item-1");
        require(keccak256(nft.tokenURI(id)) == keccak256("ipfs://item-1"), "Per-token URI should be stored");
    }

    function it_nft_mint_without_uri_has_empty_tokenuri() {
        uint256 id = nft.mint(address(user1), "");
        require(keccak256(nft.tokenURI(id)) == keccak256(""), "tokenURI should be empty when not provided");
    }

    function it_nft_mint_by_non_owner_reverts() {
        bool reverted = false;
        try { user1.do(address(nft), "mint", address(user1), "ipfs://x"); } catch { reverted = true; }
        require(reverted, "Mint by a non-owner should revert");
    }

    function it_nft_owner_can_set_token_uri_later() {
        uint256 id = nft.mint(address(user1), "");
        nft.setTokenURI(id, "ipfs://later");
        require(keccak256(nft.tokenURI(id)) == keccak256("ipfs://later"), "Owner should be able to set URI later");
    }

    // ============ BURN (canonical holder-burn) ============

    function it_nft_holder_can_burn() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        user1.do(address(nft), "burn", id);
        require(nft.balanceOf(address(user1)) == 0, "Balance should be 0 after burn");
        bool reverted = false;
        try { nft.ownerOf(id); } catch { reverted = true; }
        require(reverted, "ownerOf should revert after burn");
    }

    function it_nft_collection_owner_cannot_burn_holders_token() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        bool reverted = false;
        try { nft.burn(id); } catch { reverted = true; }
        require(reverted, "Collection owner should not be able to burn a holder's token without approval");
        require(nft.ownerOf(id) == address(user1), "Owner should be unchanged");
    }

    function it_nft_pause_blocks_holder_burn() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        nft.pause();

        bool reverted = false;
        try { user1.do(address(nft), "burn", id); } catch { reverted = true; }
        require(reverted, "Holder burn should revert while paused");
        require(nft.ownerOf(id) == address(user1), "Token should survive a paused burn attempt");

        nft.unpause();
        user1.do(address(nft), "burn", id);
        require(nft.balanceOf(address(user1)) == 0, "Burn should work after unpause");
    }

    function it_nft_owner_can_burn_while_paused() {
        uint256 id = nft.mint(address(this), "ipfs://1");
        nft.pause();
        nft.burn(id); // collection owner holds the token, so this is a valid owner-burn while paused
        bool reverted = false;
        try { nft.ownerOf(id); } catch { reverted = true; }
        require(reverted, "Collection owner should be able to burn its own token while paused");
        nft.unpause();
    }

    // ============ TRANSFERS & PAUSE ============

    function it_nft_holder_can_transfer() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        user1.do(address(nft), "transferFrom", address(user1), address(user2), id);
        require(nft.ownerOf(id) == address(user2), "Owner should be user2 after transfer");
    }

    function it_nft_pause_blocks_holder_transfer() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        nft.pause();

        bool reverted = false;
        try { user1.do(address(nft), "transferFrom", address(user1), address(user2), id); } catch { reverted = true; }
        require(reverted, "Holder transfer should revert while paused");
        require(nft.ownerOf(id) == address(user1), "Owner should be unchanged while paused");

        nft.unpause();
        user1.do(address(nft), "transferFrom", address(user1), address(user2), id);
        require(nft.ownerOf(id) == address(user2), "Transfer should work after unpause");
    }

    function it_nft_owner_can_transfer_while_paused() {
        uint256 id = nft.mint(address(this), "ipfs://1");
        nft.pause();
        nft.transferFrom(address(this), address(user1), id);
        require(nft.ownerOf(id) == address(user1), "Collection owner should transfer while paused");
        nft.unpause();
    }

    // ============ METADATA (TokenMetadata reuse) ============

    function it_nft_can_set_attributes() {
        nft.setAttribute("category", "art");
        nft.setAttribute("edition", "first");
        require(keccak256(TokenMetadata(nft).attributes("category")) == keccak256("art"), "Category attribute not set");
        require(keccak256(TokenMetadata(nft).attributes("edition")) == keccak256("first"), "Edition attribute not set");
    }

    function it_nft_can_update_name_and_symbol() {
        nft.setNameAndSymbol("New Collection", "NEWC");
        require(keccak256(nft.name()) == keccak256("New Collection"), "Name not updated");
        require(keccak256(nft.symbol()) == keccak256("NEWC"), "Symbol not updated");
    }
}
