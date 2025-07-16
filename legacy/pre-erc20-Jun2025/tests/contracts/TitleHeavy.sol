pragma solidity ^0.4.8;

/**
 * Title wrapper
 */
contract record TitleHeavy {
  // NOTE: members must be public to be indexed for search
  string public s0;
  string public s1;
  string public s2;
  string public s3;
  string public s4;
  string public s5;
  string public s6;
  string public s7;
  string public s8;
  string public s9;
  uint public u0;
  uint public u1;
  uint public u2;
  uint public u3;
  uint public u4;
  uint public u5;
  uint public u6;
  uint public u7;
  uint public u8;
  uint public u9;
  bool public b0;
  bool public b1;
  bool public b2;
  bool public b3;
  bool public b4;
  bool public b5;
  bool public b6;
  bool public b7;
  bool public b8;
  bool public b9;
  address public a0;
  address public a1;
  address public a2;
  address public a3;
  address public a4;
  address public a5;
  address public a6;
  address public a7;
  address public a8;
  address public a9;

  function TitleHeavy(string _s0, string _s1, string _s2, string _s3, string _s4, string _s5, string _s6) public {
    s0 = _s0;
    s1 = _s1;
    s2 = _s2;
    s3 = _s3;
    s4 = _s4;
    s5 = _s5;
    s6 = _s6;
    // s7 = _s7;
    // s8 = _s8;
    // s9 = _s9;
  }
  function setUint(uint _u0, uint _u1, uint _u2, uint _u3, uint _u4, uint _u5, uint _u6) public {
    u0 = _u0;
    u1 = _u1;
    u2 = _u2;
    u3 = _u3;
    u4 = _u4;
    u5 = _u5;
    u6 = _u6;
    // u7 = _u7;
    // u8 = _u8;
    // u9 = _u9;
  }
  function setBool(bool _b0, bool _b1, bool _b2, bool _b3, bool _b4, bool _b5, bool _b6) public {
    b0 = _b0;
    b1 = _b1;
    b2 = _b2;
    b3 = _b3;
    b4 = _b4;
    b5 = _b5;
    b6 = _b6;
    // b7 = _b7;
    // b8 = _b8;
    // b9 = _b9;
  }
  function setAddress(address _a0, address _a1, address _a2, address _a3, address _a4, address _a5, address _a6) public {
    a0 = _a0;
    a1 = _a1;
    a2 = _a2;
    a3 = _a3;
    a4 = _a4;
    a5 = _a5;
    a6 = _a6;
    // a7 = _a7;
    // a8 = _a8;
    // a9 = _a9;
  }
}
