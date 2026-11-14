import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record Escrow is Ownable {
  struct Deposit {
    address sender;
    uint quantity;
    address[] tokens;
    uint[] amounts;
    uint expiry;
  }

  // Cirrus mapping keys:
  //  - key  = ephemeralAddress
  // A deposit is open while quantity > 0. New deposits allow one redemption;
  // deposits made before that change may have several left. A closed deposit
  // keeps its sender, so its ephemeral address never takes another deposit.
  mapping(address => Deposit) public record deposits;
  mapping(address => mapping (address => bool)) public record depositRecipients;
  mapping(address => mapping(address => uint)) minimumDeposits;
  bool locked;

  event Deposited(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address indexed sender, uint expiry);
  event Redeemed(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address sender, address recipient);
  event Cancelled(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address sender);

  constructor(address _initialOwner) Ownable(_initialOwner) { }

  uint public fee = 1e16;

  // Every entry point moves tokens of caller-chosen contracts, so none may run inside another.
  modifier nonReentrant() {
    require(!locked, "reentrant call");
    locked = true;
    _;
    locked = false;
  }

  function setMinimumDeposit(address _sender, address _token, uint _amount) external onlyOwner {
    minimumDeposits[_sender][_token] = _amount;
  }

  function deposit(address[] tokens, uint256[] amounts, address ephemeralAddress, uint expiry) external nonReentrant {
    require(ephemeralAddress != address(0), "ephemeral=0");
    require(expiry > 0, "expiry=0");
    require(tokens.length > 0 && tokens.length == amounts.length, "tokens/amounts mismatch");
    require(deposits[ephemeralAddress].sender == address(0), "ephemeral address already used");

    uint expiryTimestamp = block.timestamp + expiry;

    deposits[ephemeralAddress] = Deposit({
      sender: msg.sender,
      quantity: 1,
      tokens: tokens,
      amounts: amounts,
      expiry: expiryTimestamp
    });

    for (uint i = 0; i < tokens.length; i++) {
        address token = tokens[i];
        require(token != address(0), "token=0");
        require(amounts[i] > 0, "amount=0");
        require(amounts[i] >= minimumDeposits[msg.sender][token], "below minimum deposit");
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amounts[i]);
        require(ok, "transferFrom failed");
    }

    emit Deposited(ephemeralAddress, tokens, amounts, msg.sender, expiryTimestamp);
  }

  function redemptionHash(
    address recipient
  ) public pure returns (string) {
    return keccak256(
        "STRATO_ESCROW_REDEEM_V1",
        recipient
    );
  }

  function redeem(
    address recipient,
    uint8 v,
    string r,
    string s
  ) external nonReentrant {
    address ephemeralAddress = recoverSigner(redemptionHash(recipient), v, r, s);

    require(!depositRecipients[ephemeralAddress][recipient], "recipient has already redeemed this referral");
    Deposit storage d = deposits[ephemeralAddress];
    require(d.quantity > 0, "no referral");

    address sender = d.sender;
    address[] tokens = [];
    uint[] amounts = [];
    for (uint i = 0; i < d.tokens.length; i++) {
        tokens.push(d.tokens[i]);
        amounts.push(d.amounts[i]);
    }

    depositRecipients[ephemeralAddress][recipient] = true;
    d.quantity = d.quantity - 1;
    if (d.quantity == 0) {
        _close(ephemeralAddress);
    }

    for (uint j = 0; j < tokens.length; j++) {
        uint feeAmount = (amounts[j] * fee) / 1e18;
        require(IERC20(tokens[j]).transfer(recipient, amounts[j] - feeAmount), "transfer failed");
        if (feeAmount > 0) {
            require(IERC20(tokens[j]).transfer(msg.sender, feeAmount), "transfer failed");
        }
    }

    emit Redeemed(ephemeralAddress, tokens, amounts, sender, recipient);
  }

  function cancelDeposit(
    address ephemeralAddress
  ) external nonReentrant {
    Deposit storage d = deposits[ephemeralAddress];
    require(d.sender == msg.sender, "unauthorized cancellation request");
    require(d.quantity > 0, "no deposit");
    require(block.timestamp >= d.expiry, "deposit not eligible for cancellation yet");

    // Every redemption left is refunded.
    address[] tokens = [];
    uint[] amounts = [];
    for (uint i = 0; i < d.tokens.length; i++) {
        tokens.push(d.tokens[i]);
        amounts.push(d.quantity * d.amounts[i]);
    }

    _close(ephemeralAddress);

    for (uint j = 0; j < tokens.length; j++) {
        require(IERC20(tokens[j]).transfer(msg.sender, amounts[j]), "transfer failed");
    }

    emit Cancelled(ephemeralAddress, tokens, amounts, msg.sender);
  }

  function _close(address ephemeralAddress) internal {
    Deposit storage d = deposits[ephemeralAddress];
    for (uint i = 0; i < d.tokens.length; i++) {
        d.tokens[i] = address(0);
        d.amounts[i] = 0;
    }
    d.tokens.length = 0;
    d.amounts.length = 0;
    d.expiry = 0;
    d.quantity = 0;
  }

  function recoverSigner(string digest, uint8 v, string r, string s) public pure returns (address) {
    if (v < 27) v += 27;
    require(v == 27 || v == 28, "bad v");

    address signer = ecrecover(digest, v, r, s);
    require(signer != address(0), "ecrecover failed");
    return signer;
  }

  function setFee(uint _fee) external onlyOwner {
    require(_fee <= 1e18, "fee above 100%");
    fee = _fee;
  }
}
