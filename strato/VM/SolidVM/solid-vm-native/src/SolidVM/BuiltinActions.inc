  \case
    "keccak256" -> Just keccak
    "sha256" -> Just sha256
    "ripemd160" -> Just ripemd160
    "bls12381DecompressG1" -> Just blsDecompressG1
    "bls12381DecompressG2" -> Just blsDecompressG2
    "bls12381MapFpToG1" -> Just blsMapFpToG1
    "bls12381MapFp2ToG2" -> Just blsMapFp2ToG2
    "bls12381HashToCurveG1" -> Just blsHashToCurveG1
    "bls12381HashToCurveG2" -> Just blsHashToCurveG2
    "bls12381G1Add" -> Just blsG1Add
    "bls12381G2Add" -> Just blsG2Add
    "bls12381G1Msm" -> Just blsG1Msm
    "bls12381G2Msm" -> Just blsG2Msm
    "bls12381Pairing" -> Just blsPairing
    "ecrecover" -> Just recover
    "addmod" -> Just (modular (+))
    "mulmod" -> Just (modular (*))
    "string" -> Just string
    "decimal" -> Just decimal
    "int" -> Just integer
    "address" -> Just address
    "abiEncode" -> Just (encode False)
    "abiEncodePacked" -> Just (encode True)
    "selfdestruct" -> Just destroy
    "create" -> Just (create False)
    "create2" -> Just (create True)
    _ -> Nothing
