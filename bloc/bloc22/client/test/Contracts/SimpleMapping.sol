contract SimpleMapping {
    mapping(uint => byte[]) m;
    mapping(uint => bool) m2;

    function SimpleMapping() {
        byte[] memory b = new byte[](10);
        for (uint i = 0; i < 10; i++) {
            b[i] = 0x01;
        }
        m[1] = b;
        m2[1] = true;
    }
}
