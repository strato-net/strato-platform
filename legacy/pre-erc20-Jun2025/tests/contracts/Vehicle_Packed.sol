/* pragma solidity ^0.4.8; */

/**
 * Vehicle root
 */
contract record Vehicle_Packed {
  uint public timestamp;

  // vehcile info
  string public vin;
  string public vehicleType;
  string public vehicleYear;
  string public vehicleMake;
  string public vehicleModel;
  string public vehicleStyle;
  // Lien Holders
  struct LienHolder {
    uint number;
    uint hash; // FIXME pending on struct bug
  }
  LienHolder[] lienHolders;

  // titles
  struct Title {
    uint number;
    uint issueDate;
    uint[] lienHolderIndex;
  }

  Title[] titles;

  string _x;
  string _y;

  struct slice {
      uint _len;
      uint _ptr;
  }

  function memcpy(uint dest, uint src, uint len) private {
      // Copy word-length chunks while possible
      for (; len >= 32; len -= 32) {
          assembly {
              mstore(dest, mload(src))
          }
          dest += 32;
          src += 32;
      }

      // Copy remaining bytes
      uint mask = 256 ** (32 - len) - 1;
      assembly {
          let srcpart := and(mload(src), not(mask))
          let destpart := and(mload(dest), mask)
          mstore(dest, or(destpart, srcpart))
      }
  }

  function toSlice(string self) internal returns (slice) {
      uint ptr;
      assembly {
          ptr := add(self, 0x20)
      }
      return slice(bytes(self).length, ptr);
  }

  function toString(slice self) internal returns (string) {
      var ret = new string(self._len);
      uint retptr;
      assembly { retptr := add(ret, 32) }

      memcpy(retptr, self._ptr, self._len);
      return ret;
  }

  function split(slice self, slice needle) internal returns (slice) {
    slice token;
    uint ptr = findPtr(self._len, self._ptr, needle._len, needle._ptr);
    token._ptr = self._ptr;
    token._len = ptr - self._ptr;
    if (ptr == self._ptr + self._len) {
        // Not found
        self._len = 0;
    } else {
        self._len -= token._len + needle._len;
        self._ptr = ptr + needle._len;
    }

    return token;
  }

  function findPtr(uint selflen, uint selfptr, uint needlelen, uint needleptr) private returns (uint) {
      uint ptr;
      uint idx;

      if (needlelen <= selflen) {
          if (needlelen <= 32) {
              // Optimized assembly for 68 gas per byte on short strings
              var s0 = 32 - needlelen;
              var s1 = 8 * s0;
              var s2 = 2 ** s1;
              var s3 = s2 - 1;
              var s4 = ~s3;
              
              assembly {
                  let mask := not(sub(exp(2, mul(8, sub(32, needlelen))), 1))
                  let needledata := and(mload(needleptr), mask)
                  let end := add(selfptr, sub(selflen, needlelen))
                  ptr := selfptr
                  loop:
                  jumpi(exit, eq(and(mload(ptr), mask), needledata))
                  ptr := add(ptr, 1)
                  jumpi(loop, lt(sub(ptr, 1), end))
                  ptr := add(selfptr, selflen)
                  exit:
              }
              return ptr;
          } else {
              // For long needles, use hashing
              bytes32 hash;
              assembly { hash := sha3(needleptr, needlelen) }
              ptr = selfptr;
              for (idx = 0; idx <= selflen - needlelen; idx++) {
                  bytes32 testHash;
                  assembly { testHash := sha3(ptr, needlelen) }
                  if (hash == testHash)
                      return ptr;
                  ptr += 1;
              }
          }
      }
      return selfptr + selflen;
  }
  
      function count(slice self, slice needle) internal returns (uint cnt) {
        uint ptr = findPtr(self._len, self._ptr, needle._len, needle._ptr) + needle._len;
        while (ptr <= self._ptr + self._len) {
            cnt++;
            ptr = findPtr(self._len - (ptr - self._ptr), ptr, needle._len, needle._ptr) + needle._len;
        }
    }

  function Vehicle_Packed(string x, string y) public {
    timestamp = block.timestamp;
    string memory xp = x;
    string memory yp = y;
    setVinTypeYear(xp);
    setMakeModelStyle(yp);
  }

  function setVinTypeYear(string x) private {
    var s = toSlice(x);
    var delim = toSlice(";");
    var parts = new string[](count(s,delim) + 1);
    for(uint i = 0; i < parts.length; i++) {
      parts[i] = toString(split(s,delim));
    }
    vin = parts[0];
    vehicleType = parts[1];
    vehicleYear = parts[2];
  }

  function setMakeModelStyle(string x) private {
    var s = toSlice(x);
    var delim = toSlice(";");
    var parts = new string[](count(s,delim) + 1);
    for(uint i = 0; i < parts.length; i++) {
      parts[i] = toString(split(s,delim));
    }
    vehicleMake = parts[0];
    vehicleModel = parts[1];
    vehicleStyle = parts[2];
  }

}