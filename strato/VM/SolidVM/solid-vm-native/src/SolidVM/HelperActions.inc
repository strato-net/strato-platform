  rounded :: (Decimal -> Decimal -> Decimal) -> Decimal -> Decimal -> M Decimal
  rounded f a b = pure $ roundTo (max (decimalPlaces a) (decimalPlaces b)) (f a b)

  checkIndex :: Int -> Integer -> M ()
  checkIndex n i = when (i < 0 || i >= fromIntegral n) $ revert ("index out of bounds: " <> T.pack (show i))

  apply :: Sig as result -> Fn as result -> HL as -> M result
  apply (SigNil _) action HNil = action
  apply (SigCons _ rest) f (value :* values) = apply rest (f value) values

  loop :: (Env ls' -> M Bool) -> (Env ls' -> M (Flow r)) -> (Env ls' -> M ()) -> Env ls' -> M (Flow r)
  loop cf bf stepF env = go
    where
      go = cf env >>= \b -> chargeGas 1 >> if not b then pure Next else bf env >>= \case
        Brk -> pure Next
        Ret v -> pure (Ret v)
        RetDynamic ds -> pure (RetDynamic ds)
        _ -> stepF env >> go

  snapshot :: Sig args r -> Env args -> M [Dyn]
  snapshot (SigNil _) ENil = pure []
  snapshot (SigCons t rest) (slot :& env) =
    (:) <$> (Dyn t <$> liftIO (readIORef slot)) <*> snapshot rest env
