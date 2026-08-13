// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC721/extensions/ERC721Burnable.sol)
import "../ERC721.sol";

/**
 * @title ERC-721 Burnable Token
 * @dev ERC-721 Token that can be burned (destroyed).
 *
 * NOTE: concrete/NFTs/NFT.sol implements this body inline instead of inheriting (D8);
 * this file exists for standalone ERC721 consumers (e.g. a future position manager).
 */
abstract contract ERC721Burnable is ERC721 {
    //SOLIDVM_COMPATIBILITY (D11): pass-through constructor — SolidVM only resolves constructor args for
    // direct parents, so children cannot invoke ERC721's constructor through this extension without it.
    constructor(string name_, string symbol_) ERC721(name_, symbol_) {}

    /**
     * @dev Burns `tokenId`. See {ERC721-_burn}.
     *
     * Requirements:
     *
     * - The caller must own `tokenId` or be an approved operator.
     */
    function burn(uint256 tokenId) public virtual {
        // Setting an "auth" argument enables the `_isAuthorized` check inside _update, which also verifies
        // that the token exists (a nonexistent token has owner 0, which can never be authorized).
        _update(address(0), tokenId, _msgSender());
    }
}
