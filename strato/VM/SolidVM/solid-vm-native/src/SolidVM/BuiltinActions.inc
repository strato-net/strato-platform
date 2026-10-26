      \case
        "keccak256" -> Just hashCall
        "ecrecover" -> Just recoverCall
        "addmod" -> Just (pure (SomeFunction (SigCons TInt (SigCons TInt (SigCons TInt (SigNil TInt)))) (EMIT_BEGIN Builtins.addmodValue EMIT_END)))
        "mulmod" -> Just (pure (SomeFunction (SigCons TInt (SigCons TInt (SigCons TInt (SigNil TInt)))) (EMIT_BEGIN Builtins.mulmodValue EMIT_END)))
        "string" -> Just stringCall
        "decimal" -> Just (conversion TDecimal decimalCast)
        "int" -> Just (conversion TInt integerCast)
        "address" -> Just (conversion TAddr addressCast)
        "abi.encode" -> Just (abiCall False)
        "abi.encodePacked" -> Just (abiCall True)
        "selfdestruct" -> Just (conversion TBool destroyCast)
        "create" -> Just (pure (SomeFunction (SigCons TStr (SigCons TStr (SigCons TVariadic (SigNil TAddr)))) (EMIT_BEGIN Builtins.createValue EMIT_END)))
        "create2" -> Just createSaltedCall
        _ -> Nothing
