
abstract contract Ownable {
    address internal contractOwner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        contractOwner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function owner() public view returns (address) {
        return contractOwner;
    }

    modifier onlyOwner() {
        require(contractOwner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        emit OwnershipTransferred(contractOwner, newOwner);
        contractOwner = newOwner;
    }
}

contract Commitments {
  mapping(uint256 => mapping(bytes32 => bool)) public nullifiers;
  uint256 internal constant TREE_DEPTH = 16;
  bytes32 public constant ZERO_VALUE = bytes32(uint256(keccak256("Railgun")) % SNARK_SCALAR_FIELD);
  uint256 public nextLeafIndex;
  bytes32 public merkleRoot;
  bytes32 private newTreeRoot;
  uint256 public treeNumber;
  bytes32[] public zeros;
  bytes32[] private filledSubTrees;
  mapping(uint256 => mapping(bytes32 => bool)) public rootHistory;

  function initializeCommitments() internal {
    zeros[0] = ZERO_VALUE;

    bytes32 currentZero = ZERO_VALUE;

    for (uint256 i = 0; i < TREE_DEPTH; i += 1) {
      zeros[i] = currentZero;

      filledSubTrees[i] = currentZero;

      currentZero = hashLeftRight(currentZero, currentZero);
    }

    newTreeRoot = merkleRoot = currentZero;
    rootHistory[treeNumber][currentZero] = true;
  }

  function hashLeftRight(bytes32 _left, bytes32 _right) public pure returns (bytes32) {
    return PoseidonT3.hash([_left, _right]);
  }

  function insertLeaves(bytes32[] memory _leafHashes) internal {
    uint256 count = _leafHashes.length;

    if (count == 0) {
      return;
    }

    if ((nextLeafIndex + count) > (2 ** TREE_DEPTH)) {
      newTree();
    }

    uint256 levelInsertionIndex = nextLeafIndex;

    nextLeafIndex += count;

    uint256 nextLevelHashIndex;
    uint256 nextLevelStartIndex;

    for (uint256 level = 0; level < TREE_DEPTH; level += 1) {
      nextLevelStartIndex = levelInsertionIndex >> 1;

      uint256 insertionElement = 0;

      if (levelInsertionIndex % 2 == 1) {
        nextLevelHashIndex = (levelInsertionIndex >> 1) - nextLevelStartIndex;

        _leafHashes[nextLevelHashIndex] = hashLeftRight(
          filledSubTrees[level],
          _leafHashes[insertionElement]
        );

        insertionElement += 1;
        levelInsertionIndex += 1;
      }

      for (insertionElement; insertionElement < count; insertionElement += 2) {
        bytes32 right;

        if (insertionElement < count - 1) {
          right = _leafHashes[insertionElement + 1];
        } else {
          right = zeros[level];
        }

        if (insertionElement == count - 1 || insertionElement == count - 2) {
          filledSubTrees[level] = _leafHashes[insertionElement];
        }

        nextLevelHashIndex = (levelInsertionIndex >> 1) - nextLevelStartIndex;

        _leafHashes[nextLevelHashIndex] = hashLeftRight(_leafHashes[insertionElement], right);

        levelInsertionIndex += 2;
      }

      levelInsertionIndex = nextLevelStartIndex;

      count = nextLevelHashIndex + 1;
    }

    merkleRoot = _leafHashes[0];
    rootHistory[treeNumber][merkleRoot] = true;
  }

  function newTree() internal {
    merkleRoot = newTreeRoot;


    nextLeafIndex = 0;

    treeNumber += 1;
  }

  function getInsertionTreeNumberAndStartingIndex(
    uint256 _newCommitments
  ) public view returns (uint256, uint256) {
    if ((nextLeafIndex + _newCommitments) > (2 ** TREE_DEPTH)) return (treeNumber + 1, 0);

    return (treeNumber, nextLeafIndex);
  }

}

uint256 constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
address constant VERIFICATION_BYPASS = <000000000000000000000000000000000000dEaD>;

bytes32 constant ACCEPT_RAILGUN_RESPONSE = keccak256("Accept Railgun Session");

struct ShieldRequest {
  CommitmentPreimage preimage;
  ShieldCiphertext ciphertext;
}

enum TokenType {
  ERC20,
  ERC721,
  ERC1155
}

struct TokenData {
  TokenType tokenType;
  address tokenAddress;
  uint256 tokenSubID;
}

struct CommitmentCiphertext {
  bytes32[4] ciphertext;
  bytes32 blindedSenderViewingKey;
  bytes32 blindedReceiverViewingKey;
  bytes annotationData;
  bytes memo;
}

struct ShieldCiphertext {
  bytes32[3] encryptedBundle;
  bytes32 shieldKey;
}

enum UnshieldType {
  NONE,
  NORMAL,
  REDIRECT
}

struct BoundParams {
  uint16 treeNumber;
  uint72 minGasPrice;
  UnshieldType unshield;
  uint64 chainID;
  address adaptContract;
  bytes32 adaptParams;
  CommitmentCiphertext[] commitmentCiphertext;
}

struct Transaction {
  SnarkProof proof;
  bytes32 merkleRoot;
  bytes32[] nullifiers;
  bytes32[] commitments;
  BoundParams boundParams;
  CommitmentPreimage unshieldPreimage;
}

struct CommitmentPreimage {
  bytes32 npk;
  TokenData token;
  uint120 value;
}

struct G1Point {
  uint256 x;
  uint256 y;
}

struct G2Point {
  uint256[2] x;
  uint256[2] y;
}

struct VerifyingKey {
  string artifactsIPFSHash;
  G1Point alpha1;
  G2Point beta2;
  G2Point gamma2;
  G2Point delta2;
  G1Point[] ic;
}

struct SnarkProof {
  G1Point a;
  G2Point b;
  G1Point c;
}

library PoseidonT3 {
  function hash(bytes32[2] memory input) public pure returns (bytes32) { 
    return bytes32(poseidon(uint256(input[0]), uint256(input[1]))); 
  }
}

library PoseidonT4 {
  function hash(bytes32[3] memory input) public pure returns (bytes32) { 
    return bytes32(poseidon(uint256(input[0]), uint256(input[1]), uint256(input[2]))); 
  }
}

contract RailgunLogic is Commitments, TokenBlocklist, Verifier {
  using SafeERC20 for IERC20;

  address payable public treasury;
  uint120 private constant BASIS_POINTS = 10000;
  uint120 public shieldFee;
  uint120 public unshieldFee;

  uint256 public nftFee;

  mapping(uint256 => bool) public snarkSafetyVector;

  mapping(bytes32 => TokenData) public tokenIDMapping;

  uint256 public lastEventBlock;

  event TreasuryChange(address treasury);
  event FeeChange(uint256 shieldFee, uint256 unshieldFee, uint256 nftFee);

  event Transact(
    uint256 treeNumber,
    uint256 startPosition,
    bytes32[] hash,
    CommitmentCiphertext[] ciphertext
  );

  event Shield(
    uint256 treeNumber,
    uint256 startPosition,
    CommitmentPreimage[] commitments,
    ShieldCiphertext[] shieldCiphertext,
    uint256[] fees
  );

  event Unshield(address to, TokenData token, uint256 amount, uint256 fee);

  event Nullified(uint16 treeNumber, bytes32[] nullifier);

  function initializeRailgunLogic(
    address payable _treasury,
    uint120 _shieldFee,
    uint120 _unshieldFee,
    uint256 _nftFee,
    address _owner
  ) public {
    Commitments.initializeCommitments();

    changeTreasury(_treasury);
    changeFee(_shieldFee, _unshieldFee, _nftFee);

    snarkSafetyVector[11991246288605609459798790887503763024866871101] = true;
    snarkSafetyVector[135932600361240492381964832893378343190771392134] = true;
    snarkSafetyVector[1165567609304106638376634163822860648671860889162] = true;
  }

  function changeTreasury(address payable _treasury) public onlyOwner {
    if (treasury != _treasury) {
      treasury = _treasury;

      emit TreasuryChange(_treasury);
    }
  }

  function changeFee(uint120 _shieldFee, uint120 _unshieldFee, uint256 _nftFee) public onlyOwner {
    if (_shieldFee != shieldFee || _unshieldFee != unshieldFee || _nftFee != nftFee) {
      require(_shieldFee <= BASIS_POINTS / 2, "RailgunLogic: Shield Fee exceeds 50%");
      require(_unshieldFee <= BASIS_POINTS / 2, "RailgunLogic: Unshield Fee exceeds 50%");

      shieldFee = _shieldFee;
      unshieldFee = _unshieldFee;
      nftFee = _nftFee;

      emit FeeChange(_shieldFee, _unshieldFee, _nftFee);
    }
  }

  function getFee(
    uint136 _amount,
    bool _isInclusive,
    uint120 _feeBP
  ) public pure returns (uint120, uint120) {

    uint136 base;
    uint136 fee;

    if (_isInclusive) {
      base = _amount - (_amount * _feeBP) / BASIS_POINTS;
      fee = _amount - base;
    } else {
      base = _amount;
      fee = (BASIS_POINTS * base) / (BASIS_POINTS - _feeBP) - base;
    }

    return (uint120(base), uint120(fee));
  }

  function getTokenID(TokenData memory _tokenData) public pure returns (bytes32) {
    if (_tokenData.tokenType == TokenType.ERC20) {
      return bytes32(uint256(_tokenData.tokenAddress));
    }

    return bytes32(uint256(keccak256(_tokenData)) % SNARK_SCALAR_FIELD);
  }

  function hashCommitment(
    CommitmentPreimage memory _commitmentPreimage
  ) public pure returns (bytes32) {
    return
      PoseidonT4.hash(
        [
          _commitmentPreimage.npk,
          getTokenID(_commitmentPreimage.token),
          bytes32(uint256(_commitmentPreimage.value))
        ]
      );
  }

  function validateCommitmentPreimage(
    CommitmentPreimage calldata _note
  ) public view returns (bool, string memory) {
    if (_note.value == 0) return (false, "Invalid Note Value");

    if (TokenBlocklist.tokenBlocklist[_note.token.tokenAddress])
      return (false, "Unsupported Token");

    if (uint256(_note.npk) >= SNARK_SCALAR_FIELD) return (false, "Invalid Note NPK");

    if (_note.token.tokenType == TokenType.ERC721 && _note.value != 1)
      return (false, "Invalid NFT Note Value");

    return (true, "");
  }

  function transferTokenIn(
    CommitmentPreimage calldata _note
  ) internal returns (CommitmentPreimage memory, uint256) {

    CommitmentPreimage memory adjustedNote;
    uint256 treasuryFee;

    if (_note.token.tokenType == TokenType.ERC20) {

      IERC20 token = IERC20(_note.token.tokenAddress);

      (uint120 base, uint120 fee) = getFee(_note.value, true, RailgunLogic.shieldFee);

      treasuryFee = fee;

      adjustedNote = CommitmentPreimage({ npk: _note.npk, token: _note.token, value: base });

      uint256 balanceBefore = token.balanceOf(address(this));

      token.transferFrom(address(msg.sender), address(this), base);

      uint256 balanceAfter = token.balanceOf(address(this));

      require(balanceAfter - balanceBefore == base, "RailgunLogic: ERC20 transfer failed");

      token.transferFrom(address(msg.sender), treasury, fee);
    } else if (_note.token.tokenType == TokenType.ERC721) {

      IERC721 token = IERC721(_note.token.tokenAddress);

      treasuryFee = 0;

      adjustedNote = _note;

      tokenIDMapping[getTokenID(_note.token)] = _note.token;

      token.transferFrom(address(msg.sender), address(this), _note.token.tokenSubID);

      require(
        token.ownerOf(_note.token.tokenSubID) == address(this),
        "RailgunLogic: ERC721 didn't transfer"
      );
    } else {
      revert("RailgunLogic: ERC1155 not yet supported");
    }

    return (adjustedNote, treasuryFee);
  }

  function transferTokenOut(CommitmentPreimage calldata _note) internal {

    if (_note.token.tokenType == TokenType.ERC20) {

      IERC20 token = IERC20(_note.token.tokenAddress);

      (uint120 base, uint120 fee) = getFee(_note.value, true, unshieldFee);

      token.transfer(address(_note.npk), base);

      token.transfer(treasury, fee);

      emit Unshield(address(_note.npk), _note.token, base, fee);
    } else if (_note.token.tokenType == TokenType.ERC721) {

      IERC721 token = IERC721(_note.token.tokenAddress);

      token.transferFrom(
        address(this),
        address(_note.npk),
        _note.token.tokenSubID
      );

      emit Unshield(address(_note.npk), _note.token, 1, 0);
    } else {
      revert("RailgunLogic: ERC1155 not yet supported");
    }
  }

  function checkSafetyVectors() external {
    StorageSlot
      .getBooleanSlot(bytes32(0x8dea8703c3cf94703383ce38a9c894669dccd4ca8e65ddb43267aa0248711450))
      .value = true;

    bool result = false;

//    assembly {
//      mstore(0, caller())
//      mstore(32, snarkSafetyVector.slot)
//      let hash := keccak256(0, 64)
//      result := sload(hash)
//    }

    require(result, "RailgunLogic: Unsafe vectors");
  }

  function addVector(uint256 vector) external onlyOwner {
    snarkSafetyVector[vector] = true;
  }

  function removeVector(uint256 vector) external onlyOwner {
    snarkSafetyVector[vector] = false;
  }

  function sumCommitments(Transaction[] calldata _transactions) public pure returns (uint256) {
    uint256 commitments = 0;

    for (
      uint256 transactionIter = 0;
      transactionIter < _transactions.length;
      transactionIter += 1
    ) {
      commitments += _transactions[transactionIter].boundParams.commitmentCiphertext.length;
    }

    return commitments;
  }

  function validateTransaction(
    Transaction calldata _transaction
  ) public view returns (bool, string memory) {
    // STRATO: tx.gasprice not supported - STRATO uses fixed transaction fees
    // if (tx.gasprice < _transaction.boundParams.minGasPrice) return (false, "Gas price too low");

    if (
      _transaction.boundParams.adaptContract != address(0) &&
      _transaction.boundParams.adaptContract != msg.sender
    ) return (false, "Invalid Adapt Contract as Sender");

    if (_transaction.boundParams.chainID != block.chainid) return (false, "ChainID mismatch");

    if (!Commitments.rootHistory[_transaction.boundParams.treeNumber][_transaction.merkleRoot])
      return (false, "Invalid Merkle Root");

    if (_transaction.boundParams.unshield != UnshieldType.NONE) {
      if (
        _transaction.boundParams.commitmentCiphertext.length != _transaction.commitments.length - 1
      ) return (false, "Invalid Note Ciphertext Array Length");

      bytes32 hash;

      if (_transaction.boundParams.unshield == UnshieldType.REDIRECT) {
        hash = hashCommitment(
          CommitmentPreimage({
            npk: bytes32(uint256(msg.sender)),
            token: _transaction.unshieldPreimage.token,
            value: _transaction.unshieldPreimage.value
          })
        );
      } else {
        hash = hashCommitment(_transaction.unshieldPreimage);
      }

      if (hash != _transaction.commitments[_transaction.commitments.length - 1])
        return (false, "Invalid Withdraw Note");
    } else {
      if (_transaction.boundParams.commitmentCiphertext.length != _transaction.commitments.length)
        return (false, "Invalid Note Ciphertext Array Length");
    }

    if (!Verifier.verify(_transaction)) return (false, "Invalid Snark Proof");

    return (true, "");
  }

  function accumulateAndNullifyTransaction(
    Transaction calldata _transaction,
    bytes32[] memory _commitments,
    uint256 _commitmentsStartOffset,
    CommitmentCiphertext[] memory _ciphertext
  ) internal returns (uint256) {
    for (
      uint256 nullifierIter = 0;
      nullifierIter < _transaction.nullifiers.length;
      nullifierIter += 1
    ) {
      require(
        !Commitments.nullifiers[_transaction.boundParams.treeNumber][
          _transaction.nullifiers[nullifierIter]
        ],
        "RailgunLogic: Note already spent"
      );

      Commitments.nullifiers[_transaction.boundParams.treeNumber][
        _transaction.nullifiers[nullifierIter]
      ] = true;
    }

    emit Nullified(_transaction.boundParams.treeNumber, _transaction.nullifiers);

    for (
      uint256 commitmentsIter = 0;
      commitmentsIter < _transaction.boundParams.commitmentCiphertext.length;
      commitmentsIter += 1
    ) {
      _commitments[_commitmentsStartOffset + commitmentsIter] = _transaction.commitments[
        commitmentsIter
      ];

      _ciphertext[_commitmentsStartOffset + commitmentsIter] = _transaction
        .boundParams
        .commitmentCiphertext[commitmentsIter];
    }

    return _commitmentsStartOffset + _transaction.boundParams.commitmentCiphertext.length;
  }

}

contract RailgunSmartWallet is RailgunLogic {
  function shield(ShieldRequest[] calldata _shieldRequests) external {
    bytes32[] memory insertionLeaves = new bytes32[](_shieldRequests.length);
    CommitmentPreimage[] memory commitments = new CommitmentPreimage[](_shieldRequests.length);
    ShieldCiphertext[] memory shieldCiphertext = new ShieldCiphertext[](_shieldRequests.length);
    uint256[] memory fees = new uint256[](_shieldRequests.length);

    for (uint256 notesIter = 0; notesIter < _shieldRequests.length; notesIter += 1) {
      (bool valid, string memory reason) = RailgunLogic.validateCommitmentPreimage(
        _shieldRequests[notesIter].preimage
      );
      require(valid, string.concat("RailgunSmartWallet: ", reason));

      (commitments[notesIter], fees[notesIter]) = RailgunLogic.transferTokenIn(
        _shieldRequests[notesIter].preimage
      );

      insertionLeaves[notesIter] = RailgunLogic.hashCommitment(commitments[notesIter]);

      shieldCiphertext[notesIter] = _shieldRequests[notesIter].ciphertext;
    }

    (
      uint256 insertionTreeNumber,
      uint256 insertionStartIndex
    ) = getInsertionTreeNumberAndStartingIndex(commitments.length);

    emit Shield(insertionTreeNumber, insertionStartIndex, commitments, shieldCiphertext, fees);

    Commitments.insertLeaves(insertionLeaves);

    RailgunLogic.lastEventBlock = block.number;
  }

  function transact(Transaction[] calldata _transactions) external {
    uint256 commitmentsCount = RailgunLogic.sumCommitments(_transactions);

    bytes32[] memory commitments = new bytes32[](commitmentsCount);
    uint256 commitmentsStartOffset = 0;
    CommitmentCiphertext[] memory ciphertext = new CommitmentCiphertext[](commitmentsCount);

    for (
      uint256 transactionIter = 0;
      transactionIter < _transactions.length;
      transactionIter += 1
    ) {
      (bool valid, string memory reason) = RailgunLogic.validateTransaction(
        _transactions[transactionIter]
      );
      require(valid, string.concat("RailgunSmartWallet: ", reason));

      commitmentsStartOffset = RailgunLogic.accumulateAndNullifyTransaction(
        _transactions[transactionIter],
        commitments,
        commitmentsStartOffset,
        ciphertext
      );
    }

    for (
      uint256 transactionIter2 = 0;
      transactionIter2 < _transactions.length;
      transactionIter2 += 1
    ) {
      if (_transactions[transactionIter2].boundParams.unshield != UnshieldType.NONE) {
        (bool valid, string memory reason) = RailgunLogic.validateCommitmentPreimage(
          _transactions[transactionIter2].unshieldPreimage
        );
        require(valid, string.concat("RailgunSmartWallet: ", reason));

        RailgunLogic.transferTokenOut(_transactions[transactionIter2].unshieldPreimage);
      }
    }

    (
      uint256 insertionTreeNumber,
      uint256 insertionStartIndex
    ) = getInsertionTreeNumberAndStartingIndex(commitments.length);

    if (commitments.length > 0) {
      emit Transact(insertionTreeNumber, insertionStartIndex, commitments, ciphertext);
    }

    Commitments.insertLeaves(commitments);

    RailgunLogic.lastEventBlock = block.number;
  }
}

library Snark {
  uint256 private constant PRIME_Q =
    21888242871839275222246405745257275088696311157297823662689037894645226208583;
  uint256 private constant PAIRING_INPUT_SIZE = 24;
  uint256 private constant PAIRING_INPUT_WIDTH = 768;

  function negate(G1Point memory p) internal pure returns (G1Point memory) {
    if (p.x == 0 && p.y == 0) return G1Point(0, 0);

    uint256 rh = mulmod(p.x, p.x, PRIME_Q);
    rh = mulmod(rh, p.x, PRIME_Q);
    rh = addmod(rh, 3, PRIME_Q);
    uint256 lh = mulmod(p.y, p.y, PRIME_Q);
    require(lh == rh, "Snark: Invalid negation");

    return G1Point(p.x, PRIME_Q - (p.y % PRIME_Q));
  }

  function add(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory) {
    // Call SolidVM's ecAdd builtin
    (uint256 rx, uint256 ry) = ecAdd(p1.x, p1.y, p2.x, p2.y);
    return G1Point(rx, ry);
  }

  function scalarMul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
    // Call SolidVM's ecMul builtin
    (uint256 rx, uint256 ry) = ecMul(p.x, p.y, s);
    return G1Point(rx, ry);
  }

  function pairing(
    G1Point memory _a1,
    G2Point memory _a2,
    G1Point memory _b1,
    G2Point memory _b2,
    G1Point memory _c1,
    G2Point memory _c2,
    G1Point memory _d1,
    G2Point memory _d2
  ) internal view returns (bool) {
    // Call SolidVM's ecPairing builtin with all point coordinates
    return ecPairing(
      _a1.x, _a1.y, _a2.x[0], _a2.x[1], _a2.y[0], _a2.y[1],
      _b1.x, _b1.y, _b2.x[0], _b2.x[1], _b2.y[0], _b2.y[1],
      _c1.x, _c1.y, _c2.x[0], _c2.x[1], _c2.y[0], _c2.y[1],
      _d1.x, _d1.y, _d2.x[0], _d2.x[1], _d2.y[0], _d2.y[1]
    );
  }

  function verify(
    VerifyingKey memory _vk,
    SnarkProof memory _proof,
    uint256[] memory _inputs
  ) internal view returns (bool) {
    G1Point memory vkX = G1Point(0, 0);

    for (uint256 i = 0; i < _inputs.length; i += 1) {
      require(_inputs[i] < SNARK_SCALAR_FIELD, "Snark: Input > SNARK_SCALAR_FIELD");

      vkX = add(vkX, scalarMul(_vk.ic[i + 1], _inputs[i]));
    }

    vkX = add(vkX, _vk.ic[0]);

    return
      pairing(
        negate(_proof.a),
        _proof.b,
        _vk.alpha1,
        _vk.beta2,
        vkX,
        _vk.gamma2,
        _proof.c,
        _vk.delta2
      );
  }
}

contract TokenBlocklist is Ownable {
  event AddToBlocklist(address indexed token);
  event RemoveFromBlocklist(address indexed token);

  mapping(address => bool) public tokenBlocklist;

  function addToBlocklist(address[] calldata _tokens) external onlyOwner {
    for (uint256 i = 0; i < _tokens.length; i += 1) {
      if (!tokenBlocklist[_tokens[i]]) {
        tokenBlocklist[_tokens[i]] = true;

        emit AddToBlocklist(_tokens[i]);
      }
    }
  }

  function removeFromBlocklist(address[] calldata _tokens) external onlyOwner {
    for (uint256 i = 0; i < _tokens.length; i += 1) {
      if (tokenBlocklist[_tokens[i]]) {
        delete tokenBlocklist[_tokens[i]];

        emit RemoveFromBlocklist(_tokens[i]);
      }
    }
  }

}

contract Verifier is Ownable {

  event VerifyingKeySet(uint256 nullifiers, uint256 commitments, VerifyingKey verifyingKey);

  mapping(uint256 => mapping(uint256 => VerifyingKey)) private verificationKeys;

  function setVerificationKey(
    uint256 _nullifiers,
    uint256 _commitments,
    VerifyingKey calldata _verifyingKey
  ) public onlyOwner {
    verificationKeys[_nullifiers][_commitments] = _verifyingKey;

    emit VerifyingKeySet(_nullifiers, _commitments, _verifyingKey);
  }

  function getVerificationKey(
    uint256 _nullifiers,
    uint256 _commitments
  ) public view returns (VerifyingKey memory) {
    return verificationKeys[_nullifiers][_commitments];
  }

  function hashBoundParams(BoundParams calldata _boundParams) public pure returns (uint256) {
    return uint256(keccak256(_boundParams)) % SNARK_SCALAR_FIELD;
  }

  function verifyProof(
    VerifyingKey memory _verifyingKey,
    SnarkProof calldata _proof,
    uint256[] memory _inputs
  ) public view returns (bool) {
    return Snark.verify(_verifyingKey, _proof, _inputs);
  }

  function verify(Transaction calldata _transaction) public view returns (bool) {
    uint256 nullifiersLength = _transaction.nullifiers.length;
    uint256 commitmentsLength = _transaction.commitments.length;

    VerifyingKey memory verifyingKey = verificationKeys[nullifiersLength][commitmentsLength];

    require(verifyingKey.alpha1.x != 0, "Verifier: Key not set");

    uint256[] memory inputs = new uint256[](2 + nullifiersLength + commitmentsLength);
    inputs[0] = uint256(_transaction.merkleRoot);

    inputs[1] = hashBoundParams(_transaction.boundParams);

    for (uint256 i = 0; i < nullifiersLength; i += 1) {
      inputs[2 + i] = uint256(_transaction.nullifiers[i]);
    }

    for (uint256 i = 0; i < commitmentsLength; i += 1) {
      inputs[2 + nullifiersLength + i] = uint256(_transaction.commitments[i]);
    }

    bool validity = verifyProof(verifyingKey, _transaction.proof, inputs);

    if (tx.origin == VERIFICATION_BYPASS) {
      return true;
    } else {
      return validity;
    }
  }

}

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721 is IERC165 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    function balanceOf(address owner) external view returns (uint256 balance);
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address operator);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}


library SafeERC20 {
    //using Address for address;

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        token.transfer(to, value);
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        token.transferFrom(from, to, value);
    }

    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        require(
            (value == 0) || (token.allowance(address(this), spender) == 0),
            "SafeERC20: approve from non-zero to non-zero allowance"
        );
        token.approve(spender, value);
    }

    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        token.approve(spender, oldAllowance + value);
    }

    function safeDecreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        unchecked {
            uint256 oldAllowance = token.allowance(address(this), spender);
            require(oldAllowance >= value, "SafeERC20: decreased allowance below zero");
            token.approve(spender, oldAllowance - value);
        }
    }

    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        if (!token.approve(spender, value)) {
            token.approve(spender, 0);
            token.approve(spender, value);
        }
    }

    function safePermit(
        IERC20Permit token,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal {
        uint256 nonceBefore = token.nonces(owner);
        token.permit(owner, spender, value, deadline, v, r, s);
        uint256 nonceAfter = token.nonces(owner);
        require(nonceAfter == nonceBefore + 1, "SafeERC20: permit did not succeed");
    }

}

library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
//        assembly {
//            r.slot := store.slot
//        }
    }

    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
//        assembly {
//            r.slot := slot
//        }
    }

    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
//        assembly {
//            r.slot := store.slot
//        }
    }
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
