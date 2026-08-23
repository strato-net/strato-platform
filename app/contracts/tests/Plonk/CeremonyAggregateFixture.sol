// GENERATED from a proverd backed by the real ceremony SRS -- do not edit by hand.
//
// The same circuit and the same witness as BridgeAggregateFixture, but the
// setup came from a powers-of-tau ceremony rather than gnark's unsafe test
// SRS. The verifying key is therefore different, and this fixture exists to
// show that the deployment path -- ceremony SRS in, on-chain verification out
// -- closes.

library CeremonyAggregateFixture {
    uint256 constant VK_WORDS = 32;
    uint256 constant PROOF_WORDS = 27;
    uint256 constant NB_PUBLIC_INPUTS = 17;

    function vkWord(uint256 i) internal returns (uint256) {
        if (i == 0) { return 0x400000; }
        if (i == 1) { return 0x1ad92f46b1f8d9a7cda0ceb68be08215ec1a1f05359eebbba76dde56a219447e; }
        if (i == 2) { return 0x30644db14ff7d4a4f1cf9ed5406a7e5722d273a7aa184eaa5e1fb0846829b041; }
        if (i == 3) { return 0x5; }
        if (i == 4) { return 0x11; }
        if (i == 5) { return 0x66aea44852307271ba0f221741d4ce11b94599586d5f05cbc9606dcbb717688; }
        if (i == 6) { return 0x7d95562231bbc8d30cd1066105d374e76f321ec45b5470a81e561d1ee966554; }
        if (i == 7) { return 0x1ed656baafc2a9d58769107af641a4e81e5ca11689bb6481617653e80b88188a; }
        if (i == 8) { return 0xa895456576488da2fa6f992acff718ab1e7551b16587f4f463a34a14fc4042a; }
        if (i == 9) { return 0xc514242c982ce653f50a20b90c7ee16f10b89a03a6595d26d1dc88fd774db94; }
        if (i == 10) { return 0x2b157d8d99f6f8848c835486b4ceb2a8aaa3de5f96e58dde76048af6d9174d5f; }
        if (i == 11) { return 0x1e4e023aed01e088e7a97e92ef5f8408a2786973462c49c68e4d58b55d16de0d; }
        if (i == 12) { return 0x2e85932b2cc0c6090af0404e095f2021d32300e70c207be4c64021a90307d3f9; }
        if (i == 13) { return 0x275cd175a29df3b991ede02c996c13e3535e0d373e0848b0c4919b14b8144c2c; }
        if (i == 14) { return 0x24b722b53e874572fbaf837fa52b4955d8519a7b97d8320b0faaa5b3a8f03eef; }
        if (i == 15) { return 0x2079a0cf9f01f7c684d443e7afca472b34dcccbb4baca181dfaefb5f9945c685; }
        if (i == 16) { return 0xd86607e123c59ec56f2bf338319dbd1adaa26b59a9117a44ca8efc55f71dfe8; }
        if (i == 17) { return 0xed6a20fd67263c3d2a250cb63f7d51aa74ff676464cb4c9a5aceee683440213; }
        if (i == 18) { return 0x162d1ec818db3a501a21159ec7dc151602c5113d38578a3ed9f41c3826d44314; }
        if (i == 19) { return 0x176149e726aeaff585dcea9a2cf8a524ba0f50379a8a5a64c9cf431878ba3189; }
        if (i == 20) { return 0x1861d133453081d29716a2a49e9aaee2d7bebff283d2a33f1028db2a30326d8d; }
        if (i == 21) { return 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2; }
        if (i == 22) { return 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed; }
        if (i == 23) { return 0x90689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b; }
        if (i == 24) { return 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa; }
        if (i == 25) { return 0x174a10d7f49d0ccca6c982900e850940e9be969b47a71f68d394d5b51e18465b; }
        if (i == 26) { return 0x21a5262bef139a1495ef170bd427d450b4dabd3bd0bba8885402d597f133da82; }
        if (i == 27) { return 0x1c31d89cef232fe6d9603c1e1e8eb02ac64d3ea872c3f274eab282b0f3be75a6; }
        if (i == 28) { return 0x22e52c287edc6b9074f449370b532177d7e7be252a95e2a4fc9d710f27fb36a5; }
        if (i == 29) { return 0x27eb665671d7ee1a6186dcec1c0ef36b3e2b70c7cf94a60028da3b7d6b5aa5d5; }
        if (i == 30) { return 0x2e2b99fbcfe232b95c6ffd8c546f4048ab42acf3ecf01edbb6a31914b8cdcbb7; }
        if (i == 31) { return 0x15294b; }
        require(false, "vkWord: no such index");
        return 0;
    }

    function proofWord(uint256 i) internal returns (uint256) {
        if (i == 0) { return 0x1575584896e007a7bab3458f4e303034be45a3e5d94599db6fab60a2300861a; }
        if (i == 1) { return 0x9b8a227dd0d13b33255031db2f45068c5475424c734f451b26dd7d12656d985; }
        if (i == 2) { return 0x81f09cca4567f9ff5886fe45a9e5fcfb573e8edef1539c65ad3dac07c8166fc; }
        if (i == 3) { return 0x13468298d5c352d86cfcb57857ae5c79fe3527f360afe6649c8edbf6a5e97875; }
        if (i == 4) { return 0x5538e95362693ee3e0a1d929686c0eaabecef68d437fcdd4df7f329e7feaddc; }
        if (i == 5) { return 0x19721e050ca98548d84458443f93c4662bcafe4e6dc03605b6f69ae016a633d0; }
        if (i == 6) { return 0x1d3b0fd933642b761c006f4c423e87e1c542dacf069b791ef8ca58f32db942cd; }
        if (i == 7) { return 0x220215fea6aa3679458f0770cfb92ccf981139aa43eafd5c31cee0b08c34ba31; }
        if (i == 8) { return 0x181426883bdf2a32537c9b6b88407a16e70da645b62748f24c714c1f838f0365; }
        if (i == 9) { return 0xabe77c0f3053a4e50a08e9811beaf432b710f5ea7fff4783871e60902f98906; }
        if (i == 10) { return 0x1b61875c52020009040eb307655c2bf877c75785feb631fdeee92f598ea7ee6c; }
        if (i == 11) { return 0x101e1e2c003ead74c1e4ffb07b7a359cc516f8e14850d4b02cc5262c75af6b59; }
        if (i == 12) { return 0xc45ea6dae332fc093adfb55f3955dc233858b9467489a7291a3193477a5107f; }
        if (i == 13) { return 0x16f84738630fb3c4716e951357d4f9c9b85ff1445c19d87a677c32eed30adb6d; }
        if (i == 14) { return 0x2493d0e90ac4cd5524b4fa5d0acfc5baa3f8a11f6eaf68e3b7a9dc0857720414; }
        if (i == 15) { return 0x2119acbb5d438c6fa47ce0cbae8ab76b0dfea4348dc002e309574b2824ceba6b; }
        if (i == 16) { return 0x2be6f8c62f2db969d5368a291ad76d24de17c79b93eb3b06893e23b9687f3404; }
        if (i == 17) { return 0x4a0ecf44d1bbe2c2836149433ee29b7c69b555539f699d98228c00cb57ccece; }
        if (i == 18) { return 0x2da4db510b1688841c2a684d821fd4f132a96ff8baa7b14474dbe9f781c33577; }
        if (i == 19) { return 0x18946e515cb3db6e874c359600e098b13153f7bf4636f2ff14aef6dd97f4692; }
        if (i == 20) { return 0x253d393689ced9d8ba6853323caecd6772b224bc4fa4161b71383119479275d9; }
        if (i == 21) { return 0xd6a69ad2fb6c0229876c7516b1917c8de8fb21f2e7dbdc462562fb8b0045b05; }
        if (i == 22) { return 0x1ecbee3f9556272dfc0996e39af7bf4a1ca6a8cb54d21a134ce3fd98b55eecdd; }
        if (i == 23) { return 0x2e866da67cdab36a0fa8de512a7722703ce6a6ac410f7ae7f3f86ae54185362e; }
        if (i == 24) { return 0x1569e4cdac0f97e642edeae7a5a454ecd0885de46a0b8c1e55a00d779fd6765d; }
        if (i == 25) { return 0x1ae518b1ef37fbd2064508fc1e46ea93e01deed3e721df320998caf3781bf8f4; }
        if (i == 26) { return 0x213819998b65f00373267bedd152ce5ede72f9235ee8a16322758c38c2687205; }
        require(false, "proofWord: no such index");
        return 0;
    }

    function publicInput(uint256 i) internal returns (uint256) {
        if (i == 0) { return 0xbffbffdffffeffffffff7fffffffdffe; }
        if (i == 1) { return 0xeffeefffdfffdfbfbffffff7fbbfdf7f; }
        if (i == 2) { return 0xeb9fbffefffe7ffeffffffeffffffeff; }
        if (i == 3) { return 0xfffffffefafefbffff77efefffbbdfff; }
        if (i == 4) { return 0xb4d41df0cfae8b5e; }
        if (i == 5) { return 0x3e8c52865f647d1b; }
        if (i == 6) { return 0xf64b5324f0b69aa; }
        if (i == 7) { return 0xf9d53f3d0f76877d; }
        if (i == 8) { return 0x9f751fadf029ea18; }
        if (i == 9) { return 0x1335746c5e693cee; }
        if (i == 10) { return 0x80387d5231b96150; }
        if (i == 11) { return 0xe25c137be55b492b; }
        if (i == 12) { return 0x52ff38ab9e95caa7; }
        if (i == 13) { return 0x530a445c23b2e028; }
        if (i == 14) { return 0x70da2e94b248d3a4; }
        if (i == 15) { return 0xb4f7f93c90b8155; }
        if (i == 16) { return 0x1e8042c24f811689ee3b93217ebee2b7e570d579297ff9053f05ddc578db46ad; }
        require(false, "publicInput: no such index");
        return 0;
    }

}
