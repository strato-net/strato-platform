import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract Escrow is Ownable {
  struct Deposit {
    address sender;
    address[] tokens;
    uint[] amounts;
    uint expiry;
  }

  // Cirrus mapping keys:
  //  - key  = ephemeralAddress
  mapping(address => Deposit) public deposits;

  event Deposited(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address indexed sender, uint expiry);
  event Redeemed(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address sender, address recipient);
  event Cancelled(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address sender);

  constructor(address _initialOwner) Ownable(_initialOwner) { }

  function deposit(address[] tokens, uint256[] amounts, address ephemeralAddress, uint expiry) external {
    require(ephemeralAddress != address(0), "ephemeral=0");

    Deposit storage d = deposits[ephemeralAddress];
    require(d.tokens.length == 0 && d.amounts.length == 0, "active deposit exists");

    for (uint i = 0; i < tokens.length; i++) {
        address token = tokens[i];
        require(token != address(0), "token=0");
        require(amounts[i] > 0, "amount=0");
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amounts[i]);
        require(ok, "transferFrom failed");
    }

    uint expiryTimestamp = block.timestamp + expiry;

    deposits[ephemeralAddress] = Deposit({
      sender: msg.sender,
      tokens: tokens,
      amounts: amounts,
      expiry: expiryTimestamp
    });

    emit Deposited(ephemeralAddress, tokens, amounts, msg.sender, expiryTimestamp);
  }

  function redemptionHash(
    address ephemeralAddress
  ) public pure returns (string) {
    return keccak256(
        "STRATO_ESCROW_REDEEM_V1",
        ephemeralAddress
    );
  }

  function redeem(
    address recipient,
    uint8 v,
    string r,
    string s
  ) external {
    string h = redemptionHash(recipient);
    address ephemeralAddress = recoverSigner(h, v, r, s);

    Deposit storage d = deposits[ephemeralAddress];
    require(d.sender != address(0) && d.tokens.length > 0 && d.amounts.length > 0, "no deposit");

    emit Redeemed(ephemeralAddress, d.tokens, d.amounts, d.sender, recipient);

    for (uint i = 0; i < d.tokens.length; i++) {
        bool ok = IERC20(d.tokens[i]).transfer(recipient, d.amounts[i]);
        deposits[ephemeralAddress].tokens[i] = address(0);
        deposits[ephemeralAddress].amounts[i] = 0;
        require(ok, "transfer failed");
    }
    deposits[ephemeralAddress].sender = address(0);
    deposits[ephemeralAddress].tokens.length = 0;
    deposits[ephemeralAddress].amounts.length = 0;
    deposits[ephemeralAddress].expiry = 0;
  }

  function cancelDeposit(
    address ephemeralAddress
  ) external {
    Deposit storage d = deposits[ephemeralAddress];
    require(d.sender == msg.sender, "unauthorized cancellation request");
    require(d.tokens.length > 0 && d.amounts.length > 0, "no deposit");
    require(block.timestamp >= d.expiry, "deposit not eligible for cancellation yet");

    emit Cancelled(ephemeralAddress, d.tokens, d.amounts, msg.sender);

    for (uint i = 0; i < d.tokens.length; i++) {
        bool ok = IERC20(d.tokens[i]).transfer(msg.sender, d.amounts[i]);
        deposits[ephemeralAddress].tokens[i] = address(0);
        deposits[ephemeralAddress].amounts[i] = 0;
        require(ok, "transfer failed");
    }
    deposits[ephemeralAddress].sender = address(0);
    deposits[ephemeralAddress].tokens.length = 0;
    deposits[ephemeralAddress].amounts.length = 0;
    deposits[ephemeralAddress].expiry = 0;
  }

  function recoverSigner(string digest, uint8 v, string r, string s) public pure returns (address) {
    if (v < 27) v += 27;
    require(v == 27 || v == 28, "bad v");

    address signer = ecrecover(digest, v, r, s);
    require(signer != address(0), "ecrecover failed");
    return signer;
  }
}
