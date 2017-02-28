contract EmbeddedContract {
    uint public x;

    function EmbeddedContract(uint _uint) {
        x = _uint;
    }
}
contract Test {
    address tAddress;
    uint tUint;
    int tInt;
    bool tBool;
    int256 tInt256;
    uint[] tUintArray;
    string tString;
    byte[] tByteArray;
    byte tByte;
    bytes32 tBytes32;
    mapping(address => uint) tMapping;
    mapping(string => byte[]) tMapping2;
    mapping(int => string) tMapping3;
    EmbeddedContract tEc;

    function Test() {
        tAddress = 0x123;
        tUint = 20;
        tInt = 40;
        tBool = true;
        tInt256 = 2173456789;
        tUintArray = new uint[](10);
        for (uint i = 0; i < 10; i++) {
            tUintArray[i] = i;
        }
        tString = "Hello World";
        tByteArray = new byte[](10);
        for (uint j = 0; j < 10; j++) {
            tByteArray[j] = 0x01;
        }
        tByte = 0x02;
        tBytes32 = "test";
        tMapping[tAddress] = 20;
        tMapping2["first"] = tByteArray;
        tMapping3[0] = "hello";
        tMapping3[1] = "world";
    }

    function getAddress() returns(address) {
        return tAddress;
    }

    function getUInt() returns(uint) {
        return tUint;
    }

    function getTInt() returns(int) {
        return tInt;
    }

    function getBool() returns(bool) {
        return tBool;
    }

    function getInt256() returns(int256) {
        return tInt256;
    }

    function getUIntArray() returns(uint[]) {
        return tUintArray;
    }

    function getString() returns(string) {
        return tString;
    }

    function getByteArrat() returns(byte[]) {
        return tByteArray;
    }

    function getBytes32() returns(bytes32) {
        return tBytes32;
    }

    function getByte() returns(byte) {
        return tByte;
    }

    function getMultipleValues() returns(string s, uint i) {
        s = tString;
        i = tUint;
    }

    function testFunction(address _address, string _string) returns(byte[]) {}

    function testFunction3(string _string, bytes32 _bytes32, byte[] _byteArray) returns(string stringValue, uint uintValue) {}

    function test4() returns(EmbeddedContract) {}

    function test5(EmbeddedContract ec) {}
}
