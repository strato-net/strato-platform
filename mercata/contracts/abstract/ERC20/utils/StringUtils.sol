library StringUtils {
    function fromHex(uint x) internal pure returns (uint) {
        if (x >= 0x30 && x <= 0x39) {
            return x - 0x30;
        } else if (x >= 0x61 && x <= 0x66) {
            return x - 0x57;
        } else {
            require(x >= 0x41 && x <= 0x46, "not a valid hex digit: " + string(x));
            return x - 0x37;
        }
    }

    function b16encode(string s) internal pure returns (string) {
        bytes b = bytes(s);
        bytes dst = new bytes(2 * b.length);
        for (uint i = 0; i < b.length; i++) {
            uint upper = (b[i] >> 4) & 0xf;
            if (upper >= 0xa) {
                upper += 0x27;
            }
            upper += 0x30;
            dst[2*i] = upper; 
            uint lower = uint(b[i]) & 0xf;
            if (lower >= 0xa) {
                lower += 0x27;
            }
            lower += 0x30;
            dst[2*i + 1] = lower; 
        }
        return string(dst);
    }

    function b16decode(string s) internal pure returns (string) {
        bytes b = bytes(s);
        bool isEven = b.length % 2 == 0;
        uint offset = isEven ? 0 : 1;
        bytes dst = new bytes((b.length / 2) + offset);
        if (!isEven) {
            dst[0] = fromHex(b[0]);
        }
        for (uint i = offset; i < b.length; i += 2) {
            dst[i/2 + offset] = (fromHex(b[i]) << 4) | fromHex(b[i+1]);
        }
        return string(dst);
    }

    function toLower(string s) internal pure returns (string) {
        bytes b = bytes(s);
        for (uint i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5a) {
                b[i] = b[i] + 0x20;
            }
        }
        return string(b);
    }

    function toUpper(string s) internal pure returns (string) {
        bytes b = bytes(s);
        for (uint i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7a) {
                b[i] = b[i] - 0x20;
            }
        }
        return string(b);
    }

    function intercalate(string s, string[] strs) internal pure returns (string) {
        string r = "";
        for (uint i = 0; i < strs.length; i++) {
            if (i > 0) {
                r += s;
            }
            r += strs[i];
        }
        return r;
    }

    function substring(string s, uint start) internal pure returns (string) {
        return substring(s, start, s.length);
    }
    
    function substring(string s, uint start, uint end) internal pure returns (string) {
        require(end > start, "substring: end index must be greater than starting index");
        bytes b = bytes(s);
        bytes ret = new bytes(end - start);
        for (uint i = start; i < end; i++) {
            ret[i - start] = b[i];
        }
        return string(ret);
    }

    function normalizeHex(string s) internal pure returns (string) {
        string hexPart = substring(s,0,2) == "0x" ? substring(s,2) : s;
        return "0x" + b16encode(b16decode(hexPart));
    }
}