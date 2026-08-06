// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Review probes for the NFT port (see design-documents/nft-erc721.md):
//
// 1. NFT.sol gates transfers by overriding transferFrom only, on the claim that the
//    inherited ERC721.safeTransferFrom body's nested `transferFrom(...)` call dispatches
//    dynamically to the child override. SolidVM statically binds nested virtual calls
//    under `super` (D12) — these tests prove whether plain nested calls dispatch
//    dynamically (gate reached) or statically (gate silently bypassed while paused).
// 2. Self-transfer (from == to) must preserve the owner's balance (the _update body
//    decrements then increments the same slot) and still clear the token approval.

import "../../concrete/NFTs/NFT.sol";
import "../../concrete/NFTs/NFTFactory.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_PauseGateProbe {
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
            "Probe Collection",
            "Probe",
            emptyArray,
            emptyArray,
            emptyArray,
            "PRB",
            owner
        );
        nft = NFT(collectionAddress);
    }

    function it_probe_safe_transfer_works_when_not_paused() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        user1.do(address(nft), "safeTransferFrom", address(user1), address(user2), id);
        require(nft.ownerOf(id) == address(user2), "safeTransferFrom should move the token when not paused");
    }

    function it_probe_safe_transfer_blocked_when_paused() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        nft.pause();

        bool reverted = false;
        try {
            user1.do(address(nft), "safeTransferFrom", address(user1), address(user2), id);
        } catch {
            reverted = true;
        }
        nft.unpause();
        require(reverted, "GATE BYPASSED: safeTransferFrom ignored the pause gate (nested transferFrom call did not dispatch to the NFT override)");
        require(nft.ownerOf(id) == address(user1), "Owner must be unchanged after blocked safeTransferFrom");
    }

    function it_probe_self_transfer_preserves_balance_and_clears_approval() {
        uint256 id = nft.mint(address(user1), "ipfs://1");
        user1.do(address(nft), "approve", address(user2), id);
        require(nft.getApproved(id) == address(user2), "Approval should be set before self-transfer");

        user1.do(address(nft), "transferFrom", address(user1), address(user1), id);

        require(nft.ownerOf(id) == address(user1), "Self-transfer must keep the owner");
        require(nft.balanceOf(address(user1)) == 1, "Self-transfer must not change the balance");
        require(nft.getApproved(id) == address(0), "Self-transfer must clear the token approval");
    }
}
