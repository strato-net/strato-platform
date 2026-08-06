// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../abstract/ERC721/ERC721.sol";
import "../../abstract/ERC721/extensions/ERC721URIStorage.sol";
import "../../abstract/ERC721/extensions/ERC721Burnable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

// Minimal concrete harness for the abstract ERC721 base
contract TestERC721 is ERC721 {
    string baseURI;

    constructor(string name_, string symbol_) ERC721(name_, symbol_) {}

    function setBaseURI(string uri) external {
        baseURI = uri;
    }

    function _baseURI() internal view override returns (string) {
        return baseURI;
    }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function burnToken(uint256 tokenId) external {
        _burn(tokenId);
    }
}

// Harness for the URIStorage extension
contract TestERC721URIStorage is ERC721URIStorage {
    string baseURI;

    constructor(string name_, string symbol_) ERC721URIStorage(name_, symbol_) {}

    function setBaseURI(string uri) external {
        baseURI = uri;
    }

    function _baseURI() internal view override returns (string) {
        return baseURI;
    }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setTokenURI(uint256 tokenId, string uri) external {
        _setTokenURI(tokenId, uri);
    }
}

// Harness for the Burnable extension
contract TestERC721Burnable is ERC721Burnable {
    constructor(string name_, string symbol_) ERC721Burnable(name_, symbol_) {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract Describe_ERC721 {
    TestERC721 nft;
    User user1;
    User user2;

    function beforeAll() {
        user1 = new User();
        user2 = new User();
    }

    function beforeEach() {
        nft = new TestERC721("Test NFT", "TNFT");
    }

    // ============ METADATA ============

    function it_erc721_has_name_and_symbol() {
        require(keccak256(nft.name()) == keccak256("Test NFT"), "Name should be set");
        require(keccak256(nft.symbol()) == keccak256("TNFT"), "Symbol should be set");
    }

    // ============ MINTING ============

    function it_erc721_mint_assigns_owner_and_balance() {
        nft.mint(address(user1), 1);
        require(nft.ownerOf(1) == address(user1), "Owner should be user1");
        require(nft.balanceOf(address(user1)) == 1, "Balance should be 1");
    }

    function it_erc721_mint_duplicate_id_reverts() {
        nft.mint(address(user1), 1);
        bool reverted = false;
        try { nft.mint(address(user2), 1); } catch { reverted = true; }
        require(reverted, "Minting an existing id should revert");
        require(nft.ownerOf(1) == address(user1), "Owner should be unchanged");
    }

    function it_erc721_mint_to_zero_reverts() {
        bool reverted = false;
        try { nft.mint(address(0), 1); } catch { reverted = true; }
        require(reverted, "Minting to the zero address should revert");
    }

    function it_erc721_ownerof_nonexistent_reverts() {
        bool reverted = false;
        try { nft.ownerOf(999); } catch { reverted = true; }
        require(reverted, "ownerOf on a nonexistent token should revert");
    }

    function it_erc721_balanceof_zero_address_reverts() {
        bool reverted = false;
        try { nft.balanceOf(address(0)); } catch { reverted = true; }
        require(reverted, "balanceOf(0) should revert");
    }

    // ============ TRANSFERS ============

    function it_erc721_owner_can_transfer() {
        nft.mint(address(this), 1);
        nft.transferFrom(address(this), address(user1), 1);
        require(nft.ownerOf(1) == address(user1), "Owner should be user1 after transfer");
        require(nft.balanceOf(address(this)) == 0, "Sender balance should be 0");
        require(nft.balanceOf(address(user1)) == 1, "Receiver balance should be 1");
    }

    function it_erc721_transfer_to_zero_reverts() {
        nft.mint(address(this), 1);
        bool reverted = false;
        try { nft.transferFrom(address(this), address(0), 1); } catch { reverted = true; }
        require(reverted, "Transfer to the zero address should revert");
    }

    function it_erc721_transfer_from_wrong_owner_reverts() {
        nft.mint(address(this), 1);
        bool reverted = false;
        try { nft.transferFrom(address(user1), address(user2), 1); } catch { reverted = true; }
        require(reverted, "Transfer with wrong from should revert");
        require(nft.ownerOf(1) == address(this), "Owner should be unchanged");
    }

    function it_erc721_unauthorized_transfer_reverts() {
        nft.mint(address(user1), 1);
        bool reverted = false;
        try { nft.transferFrom(address(user1), address(user2), 1); } catch { reverted = true; }
        require(reverted, "Unauthorized transfer should revert");
        require(nft.ownerOf(1) == address(user1), "Owner should be unchanged");
    }

    function it_erc721_holder_can_transfer_via_dispatch() {
        nft.mint(address(user1), 1);
        user1.do(address(nft), "transferFrom", address(user1), address(user2), 1);
        require(nft.ownerOf(1) == address(user2), "Owner should be user2 after dispatched transfer");
    }

    // ============ APPROVALS ============

    function it_erc721_approved_address_can_transfer() {
        nft.mint(address(this), 1);
        nft.approve(address(user1), 1);
        require(nft.getApproved(1) == address(user1), "Approval should be set");

        user1.do(address(nft), "transferFrom", address(this), address(user2), 1);
        require(nft.ownerOf(1) == address(user2), "Approved address should be able to transfer");
    }

    function it_erc721_approval_cleared_after_transfer() {
        nft.mint(address(this), 1);
        nft.approve(address(user1), 1);
        nft.transferFrom(address(this), address(user2), 1);
        require(nft.getApproved(1) == address(0), "Approval should be cleared by transfer");
    }

    function it_erc721_approve_by_non_owner_reverts() {
        nft.mint(address(user1), 1);
        bool reverted = false;
        try { nft.approve(address(user2), 1); } catch { reverted = true; }
        require(reverted, "Approve by a non-owner should revert");
    }

    function it_erc721_operator_can_transfer() {
        nft.mint(address(this), 1);
        nft.setApprovalForAll(address(user1), true);
        require(nft.isApprovedForAll(address(this), address(user1)), "Operator should be set");

        user1.do(address(nft), "transferFrom", address(this), address(user2), 1);
        require(nft.ownerOf(1) == address(user2), "Operator should be able to transfer");

        nft.setApprovalForAll(address(user1), false);
        require(!nft.isApprovedForAll(address(this), address(user1)), "Operator should be revoked");
    }

    function it_erc721_zero_operator_reverts() {
        bool reverted = false;
        try { nft.setApprovalForAll(address(0), true); } catch { reverted = true; }
        require(reverted, "Zero operator should revert");
    }

    // ============ SAFE TRANSFER (SolidVM port: no receiver check, D2) ============

    function it_erc721_safe_transfer_behaves_like_transfer() {
        nft.mint(address(this), 1);
        nft.safeTransferFrom(address(this), address(user1), 1);
        require(nft.ownerOf(1) == address(user1), "safeTransferFrom should transfer");
    }

    // ============ TOKEN URI (base implementation) ============

    function it_erc721_tokenuri_empty_without_base() {
        nft.mint(address(this), 1);
        require(keccak256(nft.tokenURI(1)) == keccak256(""), "tokenURI should be empty without baseURI");
    }

    // SolidVM spike: string(tokenId) must render base-10 for baseURI + id concatenation
    function it_erc721_tokenuri_concatenates_base_and_id() {
        nft.setBaseURI("https://example.com/meta/");
        nft.mint(address(this), 7);
        require(
            keccak256(nft.tokenURI(7)) == keccak256("https://example.com/meta/7"),
            "tokenURI should be baseURI + decimal tokenId, got: " + nft.tokenURI(7)
        );
    }

    function it_erc721_tokenuri_nonexistent_reverts() {
        bool reverted = false;
        try { nft.tokenURI(999); } catch { reverted = true; }
        require(reverted, "tokenURI on a nonexistent token should revert");
    }

    // ============ BURN (internal _burn via harness) ============

    function it_erc721_burn_clears_state_and_allows_remint() {
        nft.mint(address(this), 1);
        nft.approve(address(user1), 1);
        nft.burnToken(1);

        require(nft.balanceOf(address(this)) == 0, "Balance should be 0 after burn");
        bool reverted = false;
        try { nft.ownerOf(1); } catch { reverted = true; }
        require(reverted, "ownerOf should revert after burn");

        // Canonical: a burned id can be minted again (owner reset to 0)
        nft.mint(address(user2), 1);
        require(nft.ownerOf(1) == address(user2), "Burned id should be mintable again");
        require(nft.getApproved(1) == address(0), "Old approval should not survive burn/remint");
    }

    function it_erc721_burn_nonexistent_reverts() {
        bool reverted = false;
        try { nft.burnToken(999); } catch { reverted = true; }
        require(reverted, "Burning a nonexistent token should revert");
    }

    // ============ URI STORAGE EXTENSION ============

    function it_uristorage_returns_stored_uri_without_base() {
        TestERC721URIStorage u = new TestERC721URIStorage("URI NFT", "UNFT");
        u.mint(address(this), 1);
        u.setTokenURI(1, "ipfs://abc");
        require(keccak256(u.tokenURI(1)) == keccak256("ipfs://abc"), "Stored URI should be returned as-is without base");
    }

    function it_uristorage_concatenates_base_and_stored() {
        TestERC721URIStorage u = new TestERC721URIStorage("URI NFT", "UNFT");
        u.mint(address(this), 1);
        u.setTokenURI(1, "item-1.json");
        u.setBaseURI("https://example.com/");
        require(
            keccak256(u.tokenURI(1)) == keccak256("https://example.com/item-1.json"),
            "Base + stored URI should concatenate"
        );
    }

    function it_uristorage_falls_back_to_base_plus_id() {
        TestERC721URIStorage u = new TestERC721URIStorage("URI NFT", "UNFT");
        u.mint(address(this), 42);
        u.setBaseURI("https://example.com/");
        require(
            keccak256(u.tokenURI(42)) == keccak256("https://example.com/42"),
            "Without a stored URI, should fall back to base + id, got: " + u.tokenURI(42)
        );
    }

    // ============ BURNABLE EXTENSION ============

    function it_burnable_holder_can_burn() {
        TestERC721Burnable b = new TestERC721Burnable("Burn NFT", "BNFT");
        b.mint(address(user1), 1);
        user1.do(address(b), "burn", 1);
        require(b.balanceOf(address(user1)) == 0, "Balance should be 0 after holder burn");
    }

    function it_burnable_stranger_cannot_burn() {
        TestERC721Burnable b = new TestERC721Burnable("Burn NFT", "BNFT");
        b.mint(address(user1), 1);
        bool reverted = false;
        try { b.burn(1); } catch { reverted = true; }
        require(reverted, "Burn by a non-owner should revert");
        require(b.ownerOf(1) == address(user1), "Owner should be unchanged");
    }

    function it_burnable_operator_can_burn() {
        TestERC721Burnable b = new TestERC721Burnable("Burn NFT", "BNFT");
        b.mint(address(user1), 1);
        user1.do(address(b), "setApprovalForAll", address(this), true);
        b.burn(1);
        require(b.balanceOf(address(user1)) == 0, "Operator should be able to burn");
    }
}
