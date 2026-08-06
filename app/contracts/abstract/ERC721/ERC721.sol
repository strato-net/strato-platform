// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC721/ERC721.sol)
import "./IERC721.sol";
import "./extensions/IERC721Metadata.sol";
import "../ERC20/utils/Context.sol"; //SOLIDVM_COMPATIBILITY: shared Context — do not duplicate the contract

/**
 * @dev Implementation of https://eips.ethereum.org/EIPS/eip-721[ERC-721] Non-Fungible Token Standard, including
 * the Metadata extension, but not including the Enumerable extension.
 *
 * SolidVM port of the OpenZeppelin v5 implementation, following the same porting rules as
 * ../ERC20/ERC20.sol (record mappings, no unchecked, require strings instead of custom errors,
 * initializer pattern for Proxy/factory deployment). Deviations from canonical OZ are marked
 * SOLIDVM_COMPATIBILITY and catalogued in design-documents/nft-erc721.md.
 *
 * WARNING: like the ERC-20 port, this implementation is strictly revert-on-failure. safeTransferFrom
 * does NOT perform the ERC-721 receiver acceptance check (unportable to SolidVM) and is otherwise
 * identical to transferFrom.
 */
abstract contract ERC721 is Context, IERC721, IERC721Metadata {
    // Token name
    string private _name;

    // Token symbol
    string private _symbol;

    mapping(uint256 => address) private record _owners;

    mapping(address => uint256) private record _balances;

    mapping(uint256 => address) private record _tokenApprovals;

    mapping(address => mapping(address => bool)) private record _operatorApprovals;

    // Follows the initializer pattern,
    // allowing name and symbol to be set once during the first initialization
    bool private _erc721Initialized;
    function __ERC721_init(string name_, string symbol_) internal {
        require(!_erc721Initialized, "ERC721: already initialized");
        _name = name_;
        _symbol = symbol_;
        _erc721Initialized = true;
    }

    /**
     * Rename the collection with a new name and symbol.
     * @dev The above one-time initializer notwithstanding, collections can be renamed by calling this function.
     */
    function __ERC721_rename(string name_, string symbol_) internal {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Initializes the contract by setting a `name` and a `symbol` to the token collection.
     */
    constructor(string name_, string symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    //SOLIDVM_COMPATIBILITY: supportsInterface (ERC-165) is dropped in the SolidVM port (D1)

    /**
     * @dev See {IERC721-balanceOf}.
     */
    function balanceOf(address owner) public view virtual override returns (uint256) {
        require(owner != address(0), "ERC721: address zero is not a valid owner");
        return _balances[owner];
    }

    /**
     * @dev See {IERC721-ownerOf}.
     */
    function ownerOf(uint256 tokenId) public view virtual override returns (address) {
        return _requireOwned(tokenId);
    }

    /**
     * @dev See {IERC721Metadata-name}.
     */
    function name() public view virtual override returns (string) {
        return _name;
    }

    /**
     * @dev See {IERC721Metadata-symbol}.
     */
    function symbol() public view virtual override returns (string) {
        return _symbol;
    }

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string) {
        _requireOwned(tokenId);

        string baseURI = _baseURI();
        //SOLIDVM_COMPATIBILITY: string.concat/Strings.toString replaced by SolidVM `+` and string(uint) (D7)
        return bytes(baseURI).length > 0 ? baseURI + string(tokenId) : "";
    }

    /**
     * @dev Base URI for computing {tokenURI}. If set, the resulting URI for each
     * token will be the concatenation of the `baseURI` and the `tokenId`. Empty
     * by default, can be overridden in child contracts.
     */
    function _baseURI() internal view virtual returns (string) {
        return "";
    }

    /**
     * @dev See {IERC721-approve}.
     */
    function approve(address to, uint256 tokenId) public virtual override {
        _approve(to, tokenId, _msgSender());
    }

    /**
     * @dev See {IERC721-getApproved}.
     */
    function getApproved(uint256 tokenId) public view virtual override returns (address) {
        _requireOwned(tokenId);

        return _getApproved(tokenId);
    }

    /**
     * @dev See {IERC721-setApprovalForAll}.
     */
    function setApprovalForAll(address operator, bool approved) public virtual override {
        _setApprovalForAll(_msgSender(), operator, approved);
    }

    /**
     * @dev See {IERC721-isApprovedForAll}.
     */
    function isApprovedForAll(address owner, address operator) public view virtual override returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /**
     * @dev See {IERC721-transferFrom}.
     */
    function transferFrom(address from, address to, uint256 tokenId) public virtual override {
        require(to != address(0), "ERC721: transfer to the zero address");
        //SOLIDVM_COMPATIBILITY: canonical OZ checks _update's return value (the pre-write owner) AFTER the
        // state change. SolidVM locals are call-by-name — they re-evaluate their defining storage read at
        // every use — so a post-write check would read the NEW owner. Ownership is pre-checked instead (D10).
        require(_ownerOf(tokenId) == from, "ERC721: transfer from incorrect owner");
        _update(to, tokenId, _msgSender());
    }

    /**
     * @dev See {IERC721-safeTransferFrom}.
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) public virtual override {
        transferFrom(from, to, tokenId);
        //SOLIDVM_COMPATIBILITY: canonical OZ calls ERC721Utils.checkOnERC721Received(_msgSender(), from, to, tokenId, data)
        // here. The acceptance check needs to.code.length, call-form try/catch, bytes4 selectors and assembly — none of
        // which exist in SolidVM — so safeTransferFrom intentionally behaves exactly like transferFrom (D2).
        // The canonical four-argument overload (trailing `bytes data`) is dropped: SolidVM does not resolve public
        // function overloads, and `data` only existed to be forwarded to the dropped receiver callback (D9).
    }

    /**
     * @dev Returns the owner of the `tokenId`. Does NOT revert if token doesn't exist
     *
     * IMPORTANT: Any overrides to this function that add ownership of tokens not tracked by the
     * core ERC-721 logic MUST be matched with the use of {_increaseBalance} to keep balances
     * consistent with ownership. The invariant to preserve is that for any address `a` the value returned by
     * `balanceOf(a)` must be equal to the number of tokens such that `_ownerOf(tokenId)` is `a`.
     */
    function _ownerOf(uint256 tokenId) internal view virtual returns (address) {
        return _owners[tokenId];
    }

    /**
     * @dev Returns the approved address for `tokenId`. Returns 0 if `tokenId` is not minted.
     */
    function _getApproved(uint256 tokenId) internal view virtual returns (address) {
        return _tokenApprovals[tokenId];
    }

    /**
     * @dev Returns whether `spender` is allowed to manage `owner`'s tokens, or `tokenId` in
     * particular (ignoring whether it is owned by `owner`).
     *
     * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
     * assumption.
     */
    function _isAuthorized(address owner, address spender, uint256 tokenId) internal view virtual returns (bool) {
        return
            spender != address(0) &&
            (owner == spender || isApprovedForAll(owner, spender) || _getApproved(tokenId) == spender);
    }

    /**
     * @dev Checks if `spender` can operate on `tokenId`, assuming the provided `owner` is the actual owner.
     * Reverts if:
     * - `spender` does not have approval from `owner` for `tokenId`.
     * - `spender` does not have approval to manage all of `owner`'s assets.
     *
     * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
     * assumption.
     */
    function _checkAuthorized(address owner, address spender, uint256 tokenId) internal view virtual {
        if (!_isAuthorized(owner, spender, tokenId)) {
            //SOLIDVM_COMPATIBILITY: branch structure preserved from OZ; unconditional require replaces the custom-error revert (D3)
            require(owner != address(0), "ERC721: invalid token ID");
            require(false, "ERC721: caller is not token owner or approved");
        }
    }

    /**
     * @dev Unsafe write access to the balances, used by extensions that "mint" tokens using an {ownerOf} override.
     *
     * NOTE: the value is limited to type(uint128).max. This protects against _balance overflow. It is unrealistic that
     * a uint256 would ever overflow from increments when these increments are bounded to uint128 values.
     *
     * WARNING: Increasing an account's balance using this function tends to be paired with an override of the
     * {_ownerOf} function to resolve the ownership of the corresponding tokens so that balances and ownership
     * remain consistent with one another.
     */
    function _increaseBalance(address accountAddress, uint128 value) internal virtual { //SOLIDVM_COMPATIBILITY: `account` is a reserved keyword in SolidVM, renamed to accountAddress
        _balances[accountAddress] += value; //SOLIDVM_COMPATIBILITY: removed unchecked block as it is not compatible with SolidVM
    }

    /**
     * @dev Transfers `tokenId` from its current owner to `to`, or alternatively mints (or burns) if the current owner
     * (or `to`) is the zero address.
     *
     * The `auth` argument is optional. If the value passed is non 0, then this function will check that
     * `auth` is either the owner of the token, or approved to operate on the token (by the owner).
     *
     * Emits a {Transfer} event.
     *
     * SOLIDVM_COMPATIBILITY (D10): canonical OZ returns the pre-write owner for callers to post-check.
     * SolidVM locals are call-by-name (every use of `from` re-reads _owners[tokenId] from CURRENT storage),
     * so after `_owners[tokenId] = to` the value of `from` silently becomes `to` — the returned value would
     * be a trap. The return is removed; callers pre-check invariants BEFORE calling (see _mint/_burn/
     * _transfer/transferFrom). Inside this function every use of `from` (including the Transfer event)
     * happens strictly before the _owners write.
     *
     * NOTE: If overriding this function in a way that tracks balances, see also {_increaseBalance}.
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual {
        address from = _ownerOf(tokenId);

        // Perform (optional) operator check
        if (auth != address(0)) {
            _checkAuthorized(from, auth, tokenId);
        }

        // Execute the update
        if (from != address(0)) {
            // Clear approval. No need to re-authorize or emit the Approval event
            _approve(address(0), tokenId, address(0), false);

            _balances[from] -= 1; //SOLIDVM_COMPATIBILITY: removed unchecked block as it is not compatible with SolidVM
        }

        if (to != address(0)) {
            _balances[to] += 1; //SOLIDVM_COMPATIBILITY: removed unchecked block as it is not compatible with SolidVM
        }

        emit Transfer(from, to, tokenId); //SOLIDVM_COMPATIBILITY (D10): emitted before the _owners write so `from` still reads the previous owner

        _owners[tokenId] = to;
    }

    /**
     * @dev Mints `tokenId` and transfers it to `to`.
     *
     * Requirements:
     *
     * - `tokenId` must not exist.
     * - `to` cannot be the zero address.
     *
     * Emits a {Transfer} event.
     */
    function _mint(address to, uint256 tokenId) internal {
        require(to != address(0), "ERC721: mint to the zero address");
        require(_ownerOf(tokenId) == address(0), "ERC721: token already minted"); //SOLIDVM_COMPATIBILITY (D10): pre-check instead of post-checking _update's return
        _update(to, tokenId, address(0));
    }

    /**
     * @dev Mints `tokenId` and transfers it to `to`.
     *
     * SOLIDVM_COMPATIBILITY: canonical _safeMint additionally performs the receiver acceptance check,
     * which is unportable (D2); kept for source compatibility with OZ-shaped code.
     *
     * Emits a {Transfer} event.
     */
    function _safeMint(address to, uint256 tokenId) internal {
        _safeMint(to, tokenId, bytes("")); //SOLIDVM_COMPATIBILITY: "" is a string literal in SolidVM, explicit bytes cast required
    }

    /**
     * @dev Same as {_safeMint}, with an additional `data` parameter (ignored — see D2).
     */
    function _safeMint(address to, uint256 tokenId, bytes data) internal virtual {
        _mint(to, tokenId);
    }

    /**
     * @dev Destroys `tokenId`.
     * The approval is cleared when the token is burned.
     * This is an internal function that does not check if the sender is authorized to operate on the token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     *
     * Emits a {Transfer} event.
     */
    function _burn(uint256 tokenId) internal {
        require(_ownerOf(tokenId) != address(0), "ERC721: invalid token ID"); //SOLIDVM_COMPATIBILITY (D10): pre-check instead of post-checking _update's return
        _update(address(0), tokenId, address(0));
    }

    /**
     * @dev Transfers `tokenId` from `from` to `to`.
     *  As opposed to {transferFrom}, this imposes no restrictions on msg.sender.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - `tokenId` token must be owned by `from`.
     *
     * Emits a {Transfer} event.
     */
    function _transfer(address from, address to, uint256 tokenId) internal {
        require(to != address(0), "ERC721: transfer to the zero address");
        //SOLIDVM_COMPATIBILITY (D10): pre-checks instead of post-checking _update's return
        require(_ownerOf(tokenId) != address(0), "ERC721: invalid token ID");
        require(_ownerOf(tokenId) == from, "ERC721: transfer from incorrect owner");
        _update(to, tokenId, address(0));
    }

    /**
     * @dev Safely transfers `tokenId` token from `from` to `to`.
     * Like {safeTransferFrom} but with no restrictions on msg.sender.
     *
     * SOLIDVM_COMPATIBILITY: no receiver acceptance check (D2) — identical to {_transfer}.
     */
    function _safeTransfer(address from, address to, uint256 tokenId) internal {
        _safeTransfer(from, to, tokenId, bytes("")); //SOLIDVM_COMPATIBILITY: "" is a string literal in SolidVM, explicit bytes cast required
    }

    /**
     * @dev Same as {_safeTransfer}, with an additional `data` parameter (ignored — see D2).
     */
    function _safeTransfer(address from, address to, uint256 tokenId, bytes data) internal virtual {
        _transfer(from, to, tokenId);
    }

    /**
     * @dev Approve `to` to operate on `tokenId`
     *
     * The `auth` argument is optional. If the value passed is non 0, then this function will check that `auth` is
     * either the owner of the token, or approved to operate on all tokens held by this owner.
     *
     * Emits an {Approval} event.
     *
     * Overrides to this logic should be done to the variant with an additional `bool emitEvent` argument.
     */
    function _approve(address to, uint256 tokenId, address auth) internal {
        _approve(to, tokenId, auth, true);
    }

    /**
     * @dev Variant of `_approve` with an optional flag to enable or disable the {Approval} event. The event is not
     * emitted in the context of transfers.
     */
    function _approve(address to, uint256 tokenId, address auth, bool emitEvent) internal virtual {
        // Avoid reading the owner unless necessary
        if (emitEvent || auth != address(0)) {
            address owner = _requireOwned(tokenId);

            // We do not use _isAuthorized because single-token approvals should not be able to call approve
            require(
                auth == address(0) || owner == auth || isApprovedForAll(owner, auth),
                "ERC721: approve caller is not token owner or approved for all"
            );

            if (emitEvent) {
                emit Approval(owner, to, tokenId);
            }
        }

        _tokenApprovals[tokenId] = to;
    }

    /**
     * @dev Approve `operator` to operate on all of `owner` tokens
     *
     * Requirements:
     * - operator can't be the address zero.
     *
     * Emits an {ApprovalForAll} event.
     */
    function _setApprovalForAll(address owner, address operator, bool approved) internal virtual {
        require(operator != address(0), "ERC721: invalid operator");
        _operatorApprovals[owner][operator] = approved;
        emit ApprovalForAll(owner, operator, approved);
    }

    /**
     * @dev Reverts if the `tokenId` doesn't have a current owner (it hasn't been minted, or it has been burned).
     * Returns the owner.
     *
     * Overrides to ownership logic should be done to {_ownerOf}.
     */
    function _requireOwned(uint256 tokenId) internal view returns (address) {
        address owner = _ownerOf(tokenId);
        require(owner != address(0), "ERC721: invalid token ID");
        return owner;
    }
}
