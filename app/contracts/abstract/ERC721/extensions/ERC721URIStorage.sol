// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC721/extensions/ERC721URIStorage.sol)
import "../ERC721.sol";

/**
 * @dev ERC-721 token with storage based token URI management.
 *
 * SOLIDVM_COMPATIBILITY: canonical OZ also implements IERC4906 (metadata-update events standard)
 * and its ERC-165 interface id; ERC-165 is dropped (D1) so the MetadataUpdate event is declared inline.
 */
abstract contract ERC721URIStorage is ERC721 {
    /// @dev This event emits when the metadata of a token is changed (from ERC-4906).
    event MetadataUpdate(uint256 _tokenId);

    // Optional mapping for token URIs
    mapping(uint256 => string) private record _tokenURIs;

    //SOLIDVM_COMPATIBILITY (D11): canonical OZ extensions have no constructor — children pass args to the
    // ERC721 grandparent directly. SolidVM only resolves constructor args for DIRECT parents, so each
    // extension needs a pass-through constructor and children invoke it instead of ERC721's.
    constructor(string name_, string symbol_) ERC721(name_, symbol_) {}

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string) {
        _requireOwned(tokenId);

        string _tokenURI = _tokenURIs[tokenId];
        string base = _baseURI();

        // If there is no base URI, return the token URI.
        if (bytes(base).length == 0) {
            return _tokenURI;
        }
        // If both are set, concatenate the baseURI and tokenURI.
        if (bytes(_tokenURI).length > 0) {
            return base + _tokenURI; //SOLIDVM_COMPATIBILITY: string.concat replaced by SolidVM `+` (D7)
        }

        //SOLIDVM_COMPATIBILITY (D12): canonical OZ returns super.tokenURI(tokenId) here. In SolidVM a
        // super call statically binds the parent body's nested virtual calls to the parent scope — the
        // child's _baseURI() override is ignored and the base's empty default is used. The base
        // computation (base is non-empty in this branch) is inlined instead.
        return base + string(tokenId);
    }

    /**
     * @dev Sets `_tokenURI` as the tokenURI of `tokenId`.
     *
     * Emits {MetadataUpdate}.
     */
    function _setTokenURI(uint256 tokenId, string _tokenURI) internal virtual {
        _tokenURIs[tokenId] = _tokenURI;
        emit MetadataUpdate(tokenId);
    }
}
