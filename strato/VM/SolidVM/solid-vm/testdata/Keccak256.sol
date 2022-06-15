contract qq {
    bytes buf1 = '\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe';
    bytes buf2 = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    bytes32 hash1;
    bytes32 hash2;
  constructor() public {
      hash1 = keccak256(buf1);
      hash2 = keccak256(buf2);
  }

}