import "../../concrete/Escrow/Escrow.sol";

contract MockToken {
  mapping(address => uint) public balanceOf;
  mapping(address => mapping(address => uint)) public allowance;

  function mint(address to, uint a) public { balanceOf[to] += a; }
  function approve(address s, uint a) public returns (bool) { allowance[msg.sender][s] = a; return true; }

  function transfer(address to, uint a) public returns (bool) {
    require(balanceOf[msg.sender] >= a, "balance");
    balanceOf[msg.sender] -= a;
    balanceOf[to] += a;
    return true;
  }

  function transferFrom(address f, address to, uint a) public returns (bool) {
    require(allowance[f][msg.sender] >= a, "allowance");
    require(balanceOf[f] >= a, "balance");
    allowance[f][msg.sender] -= a;
    balanceOf[f] -= a;
    balanceOf[to] += a;
    return true;
  }
}

// Writes a deposit the way the previous Escrow could: several redemptions left.
contract LegacyEscrow is Escrow {
  constructor(address _initialOwner) Escrow(_initialOwner) { }

  function seed(address ephemeralAddress, address sender, address token, uint amount, uint quantity) public {
    deposits[ephemeralAddress] = Deposit({
      sender: sender,
      quantity: quantity,
      tokens: [token],
      amounts: [amount],
      expiry: block.timestamp + 1
    });
  }
}

contract Depositor {
  function fund(Escrow e, MockToken t, address eph, uint amount) public {
    t.approve(address(e), amount);
    e.deposit([address(t)], [amount], eph, 1000);
  }

  function cancel(Escrow e, address eph) public { e.cancelDeposit(eph); }
  function setFee(Escrow e, uint f) public { e.setFee(f); }
}

// A depositor that lists itself as a token and tries to re-enter the escrow
// when the escrow pays it out.
contract Reenterer {
  Escrow escrow;
  MockToken usd;
  address eph;
  uint mode;
  bool public reentered;

  constructor(Escrow _escrow, MockToken _usd) { escrow = _escrow; usd = _usd; }

  function transferFrom(address f, address t, uint a) public returns (bool) { return true; }

  function transfer(address to, uint a) public returns (bool) {
    if (mode == 1) {
      mode = 0;
      try escrow.cancelDeposit(eph) { reentered = true; } catch { }
    } else if (mode == 2) {
      mode = 0;
      try escrow.deposit([address(this)], [1], address(0xdead), 1) { reentered = true; } catch { }
    }
    return true;
  }

  function setup(address _eph, uint amount) public {
    eph = _eph;
    usd.approve(address(escrow), amount);
    escrow.deposit([address(usd), address(this)], [amount, 1], eph, 1);
  }

  function attack(uint _mode, uint8 v, string r, string s) public {
    mode = _mode;
    escrow.redeem(address(this), v, r, s);
  }
}

contract Describe_Escrow {
  // Test key 0x2222…22 signs keccak256(RLP["STRATO_ESCROW_REDEEM_V1", recipient]),
  // the digest RecipientClaim.tsx and the referral service build.
  address EPH = address(0x1563915e194d8cfba1943570603f7606a3115508);
  address R1 = address(0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1);
  address R2 = address(0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2);
  address R3 = address(0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3);
  string R1r = "ee9da00b4f8b31b80cf74590478e3a6f6d66b17e093181812eb9a9ad8cc69f51";
  string R1s = "21f88397aade64f478537e47a517f70e5dbf4bbd3c0c2668baed55abe9cc5481";
  string R2r = "5cce587a72fa061c3092af6cac38acdb4a11c4f3157e164f31aa2bfc19235aec";
  string R2s = "7a14efbb7ecd143f728c376a665fdb7ff0d91243f7aa081c1323f2984b0e60b8";
  string R3r = "0c02312e2c0419f70ed9207cb97b2c901268eb1ba6f01186d478292823aba31c";
  string R3s = "0ae32717217efa6b20d4c5a334ab595cc817b518d0af10a0dc17e3b0280496ee";

  Escrow escrow;
  MockToken usd;

  function beforeEach() public {
    escrow = new Escrow(address(this));
    usd = new MockToken();
    usd.mint(address(this), 1000e18);
    usd.approve(address(escrow), 1000e18);
  }

  function depositFails(address[] tokens, uint[] amounts, address eph) internal returns (bool) {
    try escrow.deposit(tokens, amounts, eph, 1000) { return false; } catch { return true; }
  }

  function redeemFails(address recipient, string r, string s) internal returns (bool) {
    try escrow.redeem(recipient, 28, r, s) { return false; } catch { return true; }
  }

  function it_recovers_the_link_address_from_a_client_signature() public {
    require(escrow.recoverSigner(escrow.redemptionHash(R1), 28, R1r, R1s) == EPH, "R1");
    require(escrow.recoverSigner(escrow.redemptionHash(R2), 28, R2r, R2s) == EPH, "R2");
  }

  function it_pays_the_recipient_and_the_submitter_once() public {
    escrow.deposit([address(usd)], [100e18], EPH, 1000);
    require(usd.balanceOf(address(escrow)) == 100e18, "escrowed");

    escrow.redeem(R1, 28, R1r, R1s);
    require(usd.balanceOf(R1) == 99e18, "recipient");
    require(usd.balanceOf(address(this)) == 901e18, "fee to submitter");
    require(usd.balanceOf(address(escrow)) == 0, "escrow emptied");

    require(redeemFails(R2, R2r, R2s), "second recipient");
    require(redeemFails(R1, R1r, R1s), "same recipient");
  }

  function it_never_reuses_a_link_address() public {
    escrow.deposit([address(usd)], [10e18], EPH, 1000);
    require(depositFails([address(usd)], [10e18], EPH), "while open");

    escrow.redeem(R1, 28, R1r, R1s);
    require(depositFails([address(usd)], [10e18], EPH), "after redeem");

    escrow.deposit([address(usd)], [10e18], address(0xbeef), 1);
    fastForward(2);
    escrow.cancelDeposit(address(0xbeef));
    require(depositFails([address(usd)], [10e18], address(0xbeef)), "after cancel");
  }

  function it_refunds_only_the_sender_and_only_after_expiry() public {
    Depositor alice = new Depositor();
    Depositor bob = new Depositor();
    usd.mint(address(alice), 50e18);
    alice.fund(escrow, usd, EPH, 50e18);

    bool early = false;
    try alice.cancel(escrow, EPH) { } catch { early = true; }
    require(early, "cancelled before expiry");

    fastForward(1000);
    bool stranger = false;
    try bob.cancel(escrow, EPH) { } catch { stranger = true; }
    require(stranger, "cancelled by someone else");

    alice.cancel(escrow, EPH);
    require(usd.balanceOf(address(alice)) == 50e18, "refund");
    require(usd.balanceOf(address(escrow)) == 0, "escrow emptied");
    require(redeemFails(R1, R1r, R1s), "redeemed after cancel");

    bool twice = false;
    try alice.cancel(escrow, EPH) { } catch { twice = true; }
    require(twice, "cancelled twice");
  }

  function it_rejects_empty_or_mismatched_token_lists() public {
    require(depositFails([], [1], EPH), "no tokens");
    require(depositFails([address(usd)], [1, 2], EPH), "extra amount");
    require(depositFails([address(usd), address(usd)], [1], EPH), "missing amount");
    escrow.deposit([address(usd)], [1], EPH, 1000);
  }

  function it_rejects_a_deposit_below_a_minimum_and_takes_nothing() public {
    MockToken gold = new MockToken();
    gold.mint(address(this), 100e18);
    gold.approve(address(escrow), 100e18);
    escrow.setMinimumDeposit(address(this), address(gold), 50e18);

    require(depositFails([address(usd), address(gold)], [100e18, 10e18], EPH), "below minimum");
    require(usd.balanceOf(address(this)) == 1000e18, "usd kept");
    require(gold.balanceOf(address(this)) == 100e18, "gold kept");

    escrow.deposit([address(usd), address(gold)], [100e18, 50e18], EPH, 1000);
    require(gold.balanceOf(address(escrow)) == 50e18, "at minimum");
  }

  function it_ignores_a_minimum_raised_after_the_deposit() public {
    escrow.deposit([address(usd)], [100e18], EPH, 1000);
    escrow.setMinimumDeposit(address(this), address(usd), 500e18);
    escrow.redeem(R1, 28, R1r, R1s);
    require(usd.balanceOf(R1) == 99e18, "paid");
  }

  function it_stops_a_payout_from_reentering_cancel() public {
    Depositor victim = new Depositor();
    usd.mint(address(victim), 1000e18);
    victim.fund(escrow, usd, address(0x1234), 1000e18);

    Reenterer attacker = new Reenterer(escrow, usd);
    usd.mint(address(attacker), 100e18);
    // Any (r, s) recovers to some address; the attacker deposits under it.
    address eph = escrow.recoverSigner(escrow.redemptionHash(address(attacker)), 28, R1r, R1s);
    attacker.setup(eph, 100e18);
    fastForward(2);

    attacker.attack(1, 28, R1r, R1s);
    require(!attacker.reentered(), "reentered");
    require(usd.balanceOf(address(attacker)) == 100e18, "attacker got back only its own deposit");
    require(usd.balanceOf(address(escrow)) == 1000e18, "victim's deposit intact");
  }

  function it_stops_a_payout_from_reentering_deposit() public {
    Reenterer attacker = new Reenterer(escrow, usd);
    usd.mint(address(attacker), 100e18);
    address eph = escrow.recoverSigner(escrow.redemptionHash(address(attacker)), 28, R1r, R1s);
    attacker.setup(eph, 100e18);

    attacker.attack(2, 28, R1r, R1s);
    require(!attacker.reentered(), "reentered");
  }

  function it_caps_the_fee_and_leaves_it_to_the_owner() public {
    bool tooHigh = false;
    try escrow.setFee(1e18 + 1) { } catch { tooHigh = true; }
    require(tooHigh, "fee above 100%");

    Depositor stranger = new Depositor();
    bool notOwner = false;
    try stranger.setFee(escrow, 0) { } catch { notOwner = true; }
    require(notOwner, "set by non-owner");

    escrow.setFee(0);
    escrow.deposit([address(usd)], [100e18], EPH, 1000);
    escrow.redeem(R1, 28, R1r, R1s);
    require(usd.balanceOf(R1) == 100e18, "no fee taken");
  }

  function it_pays_out_and_refunds_a_legacy_deposit_with_several_redemptions_left() public {
    LegacyEscrow legacy = new LegacyEscrow(address(this));
    usd.mint(address(legacy), 30e18);
    legacy.seed(EPH, address(this), address(usd), 10e18, 3);

    legacy.redeem(R1, 28, R1r, R1s);
    bool again = false;
    try legacy.redeem(R1, 28, R1r, R1s) { } catch { again = true; }
    require(again, "same recipient twice");

    legacy.redeem(R2, 28, R2r, R2s);
    require(usd.balanceOf(R1) == 99e17 && usd.balanceOf(R2) == 99e17, "paid");

    fastForward(2);
    uint before = usd.balanceOf(address(this));
    legacy.cancelDeposit(EPH);
    require(usd.balanceOf(address(this)) == before + 10e18, "refunds the redemption left");
    require(usd.balanceOf(address(legacy)) == 0, "escrow emptied");

    bool afterCancel = false;
    try legacy.redeem(R3, 28, R3r, R3s) { } catch { afterCancel = true; }
    require(afterCancel, "redeemed after cancel");
  }
}
