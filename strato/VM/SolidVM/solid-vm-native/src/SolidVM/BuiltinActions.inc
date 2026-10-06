  lookupAction :: T.Text -> Maybe ([Dyn] -> M Dyn)
  lookupAction = \case
    "keccak256" -> Just keccak
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
