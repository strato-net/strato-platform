/* pragma solidity ^0.4.8; */

/**
 * Title form
 */
contract record StackDepth {
  // NOTE: members must be public to be indexed for search
  string public s0 = 's0_abcdefghijklmnop';
  string public s1 = 's1_abcdefghijklmnop';
  string public s2 = 's2_abcdefghijklmnop';
  string public s3 = 's3_abcdefghijklmnop';
  string public s4 = 's4_abcdefghijklmnop';
  string public s5 = 's5_abcdefghijklmnop';
  string public s6 = 's6_abcdefghijklmnop';
  string public s7 = 's7_abcdefghijklmnop';
  string public s8 = 's8_abcdefghijklmnop';
  string public s9 = 's9_abcdefghijklmnop';
  uint public u0 = 0;
  uint public u1 = 1;
  uint public u2 = 2;
  uint public u3 = 3;
  uint public u4 = 4;
  uint public u5 = 5;
  uint public u6 = 6;
  uint public u7 = 7;
  uint public u8 = 8;
  uint public u9 = 9;
  bool public b0 = true;
  bool public b1 = false;
  bool public b2 = true;
  bool public b3 = false;
  bool public b4 = true;
  bool public b5 = false;
  bool public b6 = true;
  bool public b7 = false;
  bool public b8 = true;
  bool public b9 = false;
  address public a0 = 0x1000;
  address public a1 = 0x1001;
  address public a2 = 0x1002;
  address public a3 = 0x1003;
  address public a4 = 0x1004;
  address public a5 = 0x1005;
  address public a6 = 0x1006;
  address public a7 = 0x1007;
  address public a8 = 0x1008;
  address public a9 = 0x1009;

  function StackDepth(
    string _s0,
    string _s1,
    string _s2,
    string _s3,
    string _s4,
    string _s5,
    string _s6,
    string _s7,
    string _s8,
    string _s9,
    uint _u0,
    uint _u1,
    uint _u2,
    uint _u3
    /* uint _u4,
    uint _u5,
    uint _u6,
    uint _u7,
    uint _u8,
    uint _u9 */
    ) public {
    s0 = _s0;
    s1 = _s1;
    s2 = _s2;
    s3 = _s3;
    s4 = _s4;
    s5 = _s5;
    s6 = _s6;
    s7 = _s7;
    s8 = _s8;
    s9 = _s9;
    u0 = _u0;
    u1 = _u1;
    u2 = _u2;
    u3 = _u3;
    /* u4 = _u4;
    u5 = _u5;
    u6 = _u6;
    u7 = _u7;
    u8 = _u8;
    u9 = _u9; */
  }
}
