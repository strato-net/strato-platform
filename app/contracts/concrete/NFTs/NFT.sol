import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../../abstract/ERC721/ERC721.sol";
import "../../abstract/ERC721/extensions/ERC721URIStorage.sol";
import "../Admin/AdminRegistry.sol";
import "../Tokens/TokenMetadata.sol";
import "./NFTFactory.sol";

/**
 * NFT collection contract — the ERC-721 counterpart of concrete/Tokens/Token.sol.
 *
 * Platform concerns only: status lifecycle, factory link, pause-or-owner transfer gate, and
 * collection-level metadata (TokenMetadata). All ERC-721 semantics live in the abstract layer
 * (abstract/ERC721/), which is a canonical OpenZeppelin v5 port — see design-documents/nft-erc721.md.
 *
 * Deployed by NFTFactory behind a Proxy, so configuration happens in initialize(), not the constructor.
 */

enum NFTStatus { NULL, PENDING, ACTIVE, LEGACY }

contract record NFT is ERC721URIStorage, Ownable, TokenMetadata, Pausable {
    NFTStatus public status;
    NFTFactory public nftFactory;

    /// @notice Auto-incrementing id for the next mint. Ids start at 1 so that 0 always means "nonexistent".
    uint256 public nextTokenId;

    event StatusChanged(NFTStatus newStatus);
    event Minted(address to, uint256 tokenId, string uri);

    modifier onlyNFTFactory() {
        require(msg.sender == address(nftFactory), "NFT: caller is not nft factory");
        _;
    }

    modifier whenNotPausedOrOwner() {
        if (paused()) {
            try {
                _checkOwner();
            } catch {
                AdminRegistry admin = AdminRegistry(Ownable(nftFactory).owner());
                require(admin.whitelist(address(this), msg.sig, _msgSender()), "not whitelisted");
            }
        }
        _;
    }

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC721URIStorage("", "") //SOLIDVM_COMPATIBILITY (D11): SolidVM resolves constructor args on direct parents only
        TokenMetadata("", [], [], [])
    {}

    /// @dev This initializer may be called only once, during the first initialization of the collection.
    function initialize(
        string name_,
        string description_,
        string[] images_,
        string[] files_,
        string[] fileNames_,
        string symbol_
    ) external onlyOwner {

        // ERC721(name_, symbol_)
        __ERC721_init(name_, symbol_);

        // TokenMetadata(description_, images_, files_, fileNames_)
        _setMetadata(description_, images_, files_, fileNames_);

        status = NFTStatus.PENDING;
        nftFactory = NFTFactory(msg.sender);
        nextTokenId = 1;

        emit StatusChanged(status);
    }

    function setStatus(uint newStatus) external onlyOwner {
        require(newStatus != uint(status), "NFT: New status is the same as the current status");
        require(newStatus != uint(NFTStatus.NULL), "NFT: New status is NULL");
        NFTStatus _newStatus = NFTStatus(newStatus);
        status = _newStatus;

        emit StatusChanged(status);
    }

    function setNFTFactory(address _nftFactory) external onlyNFTFactory {
        nftFactory = NFTFactory(_nftFactory);
    }

    /// @notice Mint the next token id to `to`, with an optional per-token URI.
    /// @dev SolidVM locals are call-by-name (`tokenId` re-reads nextTokenId at every use), so nextTokenId
    ///      is incremented only after the last use of `tokenId`, and the id is returned as an expression
    ///      over post-increment state (see design-documents/nft-erc721.md, D10).
    function mint(address to, string uri) external onlyOwner returns (uint256) {
        uint256 tokenId = nextTokenId;
        _mint(to, tokenId);
        if (bytes(uri).length > 0) {
            _setTokenURI(tokenId, uri);
        }
        emit Minted(to, tokenId, uri);
        nextTokenId += 1;
        return nextTokenId - 1;
    }

    /// @notice Canonical ERC721Burnable semantics: caller must own `tokenId` or be an approved operator.
    /// @dev Body inlined from abstract/ERC721/extensions/ERC721Burnable.sol (D8).
    function burn(uint256 tokenId) external {
        _update(address(0), tokenId, _msgSender());
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setMetadata (
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) external onlyOwner {
        _setMetadata(_description, _images, _files, _fileNames);
    }

    function setAttribute(string key, string value) external onlyOwner {
        _setAttribute(key, value);
    }

    function setTokenURI(uint256 tokenId, string uri) external onlyOwner {
        _requireOwned(tokenId);
        _setTokenURI(tokenId, uri);
    }

    function setNameAndSymbol(string name_, string symbol_) external onlyOwner {
        __ERC721_rename(name_, symbol_);
    }

    /// @dev Gating transferFrom also covers both safeTransferFrom variants (they call transferFrom).
    function transferFrom(address from, address to, uint256 tokenId) public virtual override whenNotPausedOrOwner {
        super.transferFrom(from, to, tokenId);
    }
}
