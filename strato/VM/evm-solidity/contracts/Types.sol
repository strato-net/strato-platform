
contract Types {

  bool theBool = true;
  int8 theInt8 = 8;
  int16 theInt16 = -16;
  int24 theInt24 = 24;
  int32 theInt32 = -32;
  int40 theInt40 = 40;
  int48 theInt48 = -48;
  int56 theInt56 = 56;
  int64 theInt64 = -64;
  int72 theInt72 = 72;
  int80 theInt80 = -80;
  int88 theInt88 = 88;
  int96 theInt96 = -96;
  int104 theInt104 = 104;
  int112 theInt112 = -112;
  int120 theInt120 = 120;
  int128 theInt128 = -128;
  int136 theInt136 = 136;
  int144 theInt144 = -144;
  int152 theInt152 = 152;
  int160 theInt160 = -160;
  int168 theInt168 = 168;
  int176 theInt176 = -176;
  int184 theInt184 = 184;
  int192 theInt192 = -192;
  int200 theInt200 = 200;
  int208 theInt208 = -208;
  int216 theInt216 = 216;
  int224 theInt224 = -224;
  int232 theInt232 = 232;
  int240 theInt240 = -240;
  int248 theInt248 = 248;
  int256 theInt256 = -256;

  uint8 theUint8 = 8;
  uint16 theUint16 = 0xfff0;
  uint24 theUint24 = 24;
  uint32 theUint32 = 0xffffffe0;
  uint40 theUint40 = 40;
  uint48 theUint48 = 0xffffffffffd0;
  uint56 theUint56 = 56;
  uint64 theUint64 = 0xffffffffffffffc0;
  uint72 theUint72 = 72;
  uint80 theUint80 = 0xffffffffffffffffffb0;
  uint88 theUint88 = 88;
  uint96 theUint96 = 0xffffffffffffffffffffffa0;
  uint104 theUint104 = 104;
  uint112 theUint112 = 0xffffffffffffffffffffffffff90;
  uint120 theUint120 = 120;
  uint128 theUint128 = 0xffffffffffffffffffffffffffffff80;
  uint136 theUint136 = 136;
  uint144 theUint144 = 0xffffffffffffffffffffffffffffffffff70;
  uint152 theUint152 = 152;
  uint160 theUint160 = 0xffffffffffffffffffffffffffffffffffffff60;
  uint168 theUint168 = 168;
  uint176 theUint176 = 0xffffffffffffffffffffffffffffffffffffffffff50;
  uint184 theUint184 = 184;
  uint192 theUint192 = 0xffffffffffffffffffffffffffffffffffffffffffffff40;
  uint200 theUint200 = 200;
  uint208 theUint208 = 0xffffffffffffffffffffffffffffffffffffffffffffffffff30;
  uint216 theUint216 = 216;
  uint224 theUint224 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffff20;
  uint232 theUint232 = 232;
  uint240 theUint240 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffff10;
  uint248 theUint248 = 248;
  uint256 theUint256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00;

  int theInt = 1;
  uint theUint = 1;

  address theAddress = 0xaabb;

  address myAddress = this;

  bytes1 theBytes1 = 1;
  bytes2 theBytes2 = 1;
  bytes3 theBytes3 = 1;
  bytes4 theBytes4 = 1;
  bytes5 theBytes5 = 1;
  bytes6 theBytes6 = 1;
  bytes7 theBytes7 = 1;
  bytes8 theBytes8 = 1;
  bytes9 theBytes9 = 1;
  bytes10 theBytes10 = 1;
  bytes11 theBytes11 = 1;
  bytes12 theBytes12 = 1;
  bytes13 theBytes13 = 1;
  bytes14 theBytes14 = 1;
  bytes15 theBytes15 = 1;
  bytes16 theBytes16 = 1;
  bytes17 theBytes17 = 1;
  bytes18 theBytes18 = 1;
  bytes19 theBytes19 = 1;
  bytes20 theBytes20 = 1;
  bytes21 theBytes21 = 1;
  bytes22 theBytes22 = 1;
  bytes23 theBytes23 = 1;
  bytes24 theBytes24 = 1;
  bytes25 theBytes25 = 1;
  bytes26 theBytes26 = 1;
  bytes27 theBytes27 = 1;
  bytes28 theBytes28 = 1;
  bytes29 theBytes29 = 1;
  bytes30 theBytes30 = 1;
  bytes31 theBytes31 = 1;
  bytes32 theBytes32 = 1;

  byte theByte = 1;

  bytes theBytes = "abcd"; // hex values 0xab, 0xcd


  string theString = "abcd"; // characters 'a' 'b' 'c' 'd'

  //fixed x = 1.1;


  enum ActionChoices { GoLeft, GoRight, GoStraight, SitStill }

  ActionChoices choice;

  ActionChoices constant defaultChoice = ActionChoices.GoStraight;

}

