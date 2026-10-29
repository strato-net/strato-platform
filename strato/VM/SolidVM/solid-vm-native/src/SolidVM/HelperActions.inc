checkIndex :: Int -> Integer -> SM ()
checkIndex n i = when (i < 0 || i >= fromIntegral n) $ revert ("index out of bounds: " <> T.pack (show i))

loop :: (Env ls' -> SM Bool) -> (Env ls' -> SM (Flow r)) -> (Env ls' -> SM ()) -> Env ls' -> SM (Flow r)
loop cf bf stepF env = go
  where
    go = cf env >>= \b -> chargeGas 1 >> if not b then pure Next else bf env >>= \case
      Brk -> pure Next
      Ret v -> pure (Ret v)
      RetDynamic ds -> pure (RetDynamic ds)
      _ -> stepF env >> go
