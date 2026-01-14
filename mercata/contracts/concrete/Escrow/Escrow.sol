import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract Escrow is Ownable {
  struct Deposit {
    address sender;
    uint quantity;
    address[] tokens;
    uint[] amounts;
    uint expiry;
    address[] recipients;
  }

  // Cirrus mapping keys:
  //  - key  = ephemeralAddress
  mapping(address => Deposit) public deposits;
  mapping(address => mapping (address => bool)) public depositRecipients;

  event Deposited(address indexed ephemeralAddress, uint quantity, address[] indexed tokens, uint256[] amounts, address indexed sender, uint expiry);
  event Redeemed(address indexed ephemeralAddress, address[] indexed tokens, uint256[] amounts, address sender, address recipient);
  event Cancelled(address indexed ephemeralAddress, uint quantity, address[] indexed tokens, uint256[] amounts, address sender);

  constructor(address _initialOwner) Ownable(_initialOwner) { }

  uint public fee = 1e16;

  function deposit(address[] tokens, uint256[] amounts, address ephemeralAddress, uint expiry, uint quantity) external {
    require(ephemeralAddress != address(0), "ephemeral=0");
    require(expiry > 0, "expiry=0");
    require(quantity > 0, "quantity=0");

    Deposit storage d = deposits[ephemeralAddress];
    require(d.tokens.length == 0 && d.amounts.length == 0, "active deposit exists");

    for (uint i = 0; i < tokens.length; i++) {
        address token = tokens[i];
        require(token != address(0), "token=0");
        require(amounts[i] > 0, "amount=0");
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), quantity * amounts[i]);
        require(ok, "transferFrom failed");
    }

    uint expiryTimestamp = block.timestamp + expiry;

    deposits[ephemeralAddress] = Deposit({
      sender: msg.sender,
      quantity: quantity,
      tokens: tokens,
      amounts: amounts,
      expiry: expiryTimestamp,
      recipients: []
    });

    emit Deposited(ephemeralAddress, quantity, tokens, amounts, msg.sender, expiryTimestamp);
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

    require(!depositRecipients[ephemeralAddress][recipient], "recipient has already redeemed this referral");
    Deposit storage d = deposits[ephemeralAddress];
    require(d.quantity > 0, "referral quantity is 0");
    require(d.sender != address(0) && d.tokens.length > 0 && d.amounts.length > 0, "no referral");

    address[] tokens = [];
    uint[] amounts = [];
    address sender = d.sender;

    for (uint i = 0; i < d.tokens.length; i++) {
        uint feeAmount = (d.amounts[i] * fee) / 1e18;
        bool ok = IERC20(d.tokens[i]).transfer(recipient, d.amounts[i] - feeAmount);
        bool feeOk = IERC20(d.tokens[i]).transfer(msg.sender, feeAmount);
        tokens.push(deposits[ephemeralAddress].tokens[i]);
        amounts.push(deposits[ephemeralAddress].amounts[i]);
        if (d.quantity == 1) {
          deposits[ephemeralAddress].tokens[i] = address(0);
          deposits[ephemeralAddress].amounts[i] = 0;
        }
        require(ok && feeOk, "transfer failed");
    }

    if (d.quantity == 1) {
        deposits[ephemeralAddress].sender = address(0);
        deposits[ephemeralAddress].tokens.length = 0;
        deposits[ephemeralAddress].amounts.length = 0;
        deposits[ephemeralAddress].expiry = 0;
        for (uint j = 0; j < d.recipients.length; j++) {
            depositRecipients[ephemeralAddress][d.recipients[j]] = false;
            d.recipients[j] = address(0);
        }
        d.recipients.length = 0;
    } else {
        d.recipients.push(recipient);
        depositRecipients[ephemeralAddress][recipient] = true;
    }
    d.quantity = d.quantity - 1;

    emit Redeemed(ephemeralAddress, tokens, amounts, sender, recipient);
  }

  function cancelDeposit(
    address ephemeralAddress
  ) external {
    Deposit storage d = deposits[ephemeralAddress];
    require(d.sender == msg.sender, "unauthorized cancellation request");
    require(d.tokens.length > 0 && d.amounts.length > 0, "no deposit");
    require(block.timestamp >= d.expiry, "deposit not eligible for cancellation yet");

    address[] tokens = [];
    uint[] amounts = [];
    address sender = d.sender;
    uint quantity = d.quantity;

    for (uint i = 0; i < d.tokens.length; i++) {
        bool ok = IERC20(d.tokens[i]).transfer(sender, quantity * d.amounts[i]);
        tokens.push(deposits[ephemeralAddress].tokens[i]);
        amounts.push(deposits[ephemeralAddress].amounts[i]);
        deposits[ephemeralAddress].tokens[i] = address(0);
        deposits[ephemeralAddress].amounts[i] = 0;
        require(ok, "transfer failed");
    }

    deposits[ephemeralAddress].sender = address(0);
    deposits[ephemeralAddress].tokens.length = 0;
    deposits[ephemeralAddress].amounts.length = 0;
    deposits[ephemeralAddress].expiry = 0;
    for (uint j = 0; j < d.recipients.length; j++) {
        depositRecipients[ephemeralAddress][d.recipients[j]] = false;
        d.recipients[j] = address(0);
    }
    d.recipients.length = 0;

    emit Cancelled(ephemeralAddress, quantity, tokens, amounts, sender);
  }

  function recoverSigner(string digest, uint8 v, string r, string s) public pure returns (address) {
    if (v < 27) v += 27;
    require(v == 27 || v == 28, "bad v");

    address signer = ecrecover(digest, v, r, s);
    require(signer != address(0), "ecrecover failed");
    return signer;
  }

  function setFee(uint _fee) external onlyOwner {
    fee = _fee;
  }
}
