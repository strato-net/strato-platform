// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title SolidVM-native SP1 v6.1 Groth16 verifier
/// @notice ABI-compatible verifier for the proof envelope emitted by the
/// live Across SP1 Helios prover as of 2026-08-13. The verification key,
/// recursion root, envelope checks, and pairing equation are ported from
/// succinctlabs/sp1-contracts v6.1.0. EVM assembly/precompile calls are
/// replaced with SolidVM's metered BN254 builtins.
contract SP1Groth16VerifierV6 {
    uint constant SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint constant ALPHA_X =
        15279411540481963483749982645131486879260751823620651493692884460296130891713;
    uint constant ALPHA_Y =
        15872895802316430142046488442363778159164596024024981740547841316113839677454;

    uint constant BETA_NEG_X_0 =
        6145571844528009385227270901181311049451968424667282936975270874464890915386;
    uint constant BETA_NEG_X_1 =
        12771786691609444002416405093387705070206640282801320788762089789398249455552;
    uint constant BETA_NEG_Y_0 =
        4488883874756188982949192438322346627006627895205628031405236004639323835517;
    uint constant BETA_NEG_Y_1 =
        1735169520034591855846686229876971881413094324547255227368057137445726296809;

    uint constant GAMMA_NEG_X_0 =
        10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint constant GAMMA_NEG_X_1 =
        11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint constant GAMMA_NEG_Y_0 =
        13392588948715843804641432497768002650278120570034223513918757245338268106653;
    uint constant GAMMA_NEG_Y_1 =
        17805874995975841540914202342111839520379459829704422454583296818431106115052;

    uint constant DELTA_NEG_X_0 =
        10465707362494635227101096813108413078937487707553051407465224907243675430929;
    uint constant DELTA_NEG_X_1 =
        8014260607368773541998918215611927658290278403999176336697043972644519659243;
    uint constant DELTA_NEG_Y_0 =
        19389283139277148919245778864125350153699493315071306268776225113374776030523;
    uint constant DELTA_NEG_Y_1 =
        16335894885742905444968709132584769120387318573561090701871591658625758958113;

    uint constant CONSTANT_X =
        20281192269339458123687070687118212311775320590888414619062163734024177320592;
    uint constant CONSTANT_Y =
        4733327396113282720944079206751955104965328647794767422434462962576999295035;
    uint constant PUB_0_X =
        6933777020392885277709527453058337947310422411038083362275568070104688005311;
    uint constant PUB_0_Y =
        981134475045095331624771061624185350383934842154508663637397442918499383708;
    uint constant PUB_1_X =
        4994703368938944727583784298191985234033403433117347198670233075674015451426;
    uint constant PUB_1_Y =
        8251219283963080431419977720140972699009004688253176317231536639169726973868;
    uint constant PUB_2_X =
        4290838847096051522936899065591427041691227664160185228987863596451823131267;
    uint constant PUB_2_Y =
        20588566735491008722164159313316540988426258906449040460220495569364391658476;
    uint constant PUB_3_X =
        10868099250506113890234768256645470833285719586092080686774540776807380789751;
    uint constant PUB_3_Y =
        481415511937576118656966359026147167555048629225366340770167496559184060449;
    uint constant PUB_4_X =
        248210862999154995000539012177951057105481472135341820587821789934938975214;
    uint constant PUB_4_Y =
        4435539404843896136682123140600986858809597152596796648926707165831171499457;

    function VERSION() external pure returns (string memory) {
        return "v6.1.0-solidvm";
    }

    function VERIFIER_HASH() public pure returns (bytes32) {
        return bytes32(0x4388a21c687fdd5f218d7e3d13190cac4c5355818d3605fd5fb811df468ee696);
    }

    function VK_ROOT() public pure returns (bytes32) {
        return bytes32(0x002f850ee998974d6cc00e50cd0814b098c05bfade466d28573240d057f25352);
    }

    function hashPublicValues(bytes memory publicValues) public pure returns (bytes32) {
        uint digest = uint(sha256(publicValues));
        return bytes32(digest & ((1 << 253) - 1));
    }

    function readUint(bytes memory data, uint offset) internal pure returns (uint result) {
        require(offset + 32 <= data.length, "SP1 proof word out of bounds");
        for (uint i = 0; i < 32; i++) {
            result = (result << 8) | data[offset + i];
        }
    }

    function readSelector(bytes memory data) internal pure returns (uint result) {
        require(data.length >= 4, "SP1 proof missing selector");
        for (uint i = 0; i < 4; i++) {
            result = (result << 8) | data[i];
        }
    }

    function verifyProof(
        bytes32 programVKey,
        bytes memory publicValues,
        bytes memory proofBytes
    ) external view {
        require(proofBytes.length == 356, "SP1 v6 proof envelope must be 356 bytes");
        require(readSelector(proofBytes) == 0x4388a21c, "wrong SP1 verifier selector");

        uint exitCode = readUint(proofBytes, 4);
        uint vkRoot = readUint(proofBytes, 36);
        uint nonce = readUint(proofBytes, 68);
        require(exitCode == 0, "invalid SP1 exit code");
        require(vkRoot == uint(VK_ROOT()), "invalid SP1 recursion vkey root");

        uint[8] memory proof = [
            uint(0), uint(0), uint(0), uint(0),
            uint(0), uint(0), uint(0), uint(0)
        ];
        for (uint i = 0; i < 8; i++) {
            proof[i] = readUint(proofBytes, 100 + i * 32);
        }

        uint[5] memory input = [uint(0), uint(0), uint(0), uint(0), uint(0)];
        input[0] = uint(programVKey);
        input[1] = uint(hashPublicValues(publicValues));
        input[2] = exitCode;
        input[3] = vkRoot;
        input[4] = nonce;
        Verify(proof, input);
    }

    function publicInputMSM(uint[5] memory input) internal view returns (uint x, uint y) {
        for (uint i = 0; i < 5; i++) {
            require(input[i] < SCALAR_FIELD, "SP1 public input is not in the scalar field");
        }

        (uint x0, uint y0) = ecMul(PUB_0_X, PUB_0_Y, input[0]);
        (x, y) = ecAdd(CONSTANT_X, CONSTANT_Y, x0, y0);
        (uint x1, uint y1) = ecMul(PUB_1_X, PUB_1_Y, input[1]);
        (x, y) = ecAdd(x, y, x1, y1);
        (uint x2, uint y2) = ecMul(PUB_2_X, PUB_2_Y, input[2]);
        (x, y) = ecAdd(x, y, x2, y2);
        (uint x3, uint y3) = ecMul(PUB_3_X, PUB_3_Y, input[3]);
        (x, y) = ecAdd(x, y, x3, y3);
        (uint x4, uint y4) = ecMul(PUB_4_X, PUB_4_Y, input[4]);
        (x, y) = ecAdd(x, y, x4, y4);
    }

    /// @notice Verify the raw eight-word Groth16 proof and five SP1 public inputs.
    function Verify(uint[8] memory proof, uint[5] memory input) public view {
        (uint linearX, uint linearY) = publicInputMSM(input);
        uint[] memory pairings = new uint[](24);

        // e(A, B)
        for (uint i = 0; i < 6; i++) {
            pairings[i] = proof[i];
        }

        // e(C, -delta)
        pairings[6] = proof[6];
        pairings[7] = proof[7];
        pairings[8] = DELTA_NEG_X_1;
        pairings[9] = DELTA_NEG_X_0;
        pairings[10] = DELTA_NEG_Y_1;
        pairings[11] = DELTA_NEG_Y_0;

        // e(alpha, -beta)
        pairings[12] = ALPHA_X;
        pairings[13] = ALPHA_Y;
        pairings[14] = BETA_NEG_X_1;
        pairings[15] = BETA_NEG_X_0;
        pairings[16] = BETA_NEG_Y_1;
        pairings[17] = BETA_NEG_Y_0;

        // e(linear combination of public inputs, -gamma)
        pairings[18] = linearX;
        pairings[19] = linearY;
        pairings[20] = GAMMA_NEG_X_1;
        pairings[21] = GAMMA_NEG_X_0;
        pairings[22] = GAMMA_NEG_Y_1;
        pairings[23] = GAMMA_NEG_Y_0;

        require(ecPairing(pairings), "invalid SP1 Groth16 proof");
    }
}
