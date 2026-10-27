rounded :: (Decimal -> Decimal -> Decimal) -> Decimal -> Decimal -> M Decimal
rounded f a b = pure $ roundTo (max (decimalPlaces a) (decimalPlaces b)) (f a b)

checkIndex :: Int -> Integer -> M ()
checkIndex n i = when (i < 0 || i >= fromIntegral n) $ revert ("index out of bounds: " <> T.pack (show i))

loop :: (Env ls' -> M Bool) -> (Env ls' -> M (Flow r)) -> (Env ls' -> M ()) -> Env ls' -> M (Flow r)
loop cf bf stepF env = go
  where
    go = cf env >>= \b -> chargeGas 1 >> if not b then pure Next else bf env >>= \case
      Brk -> pure Next
      Ret v -> pure (Ret v)
      RetDynamic ds -> pure (RetDynamic ds)
      _ -> stepF env >> go
