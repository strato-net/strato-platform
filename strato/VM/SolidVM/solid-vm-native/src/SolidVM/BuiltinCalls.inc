-- Bind existing builtins with the same checked application machinery as functions.
lookupBuiltinCall :: forall ls r. Scope ls r -> Bool -> T.Text -> [Expression] -> Maybe (C (CE ls))
lookupBuiltinCall sc abiMember name args = do
  function <- lookupBuiltinFunction sc name args
  pure $ do
    types <- forM args $ \expression -> do
      CE t _ <- compileE sc expression
      pure (SomeTy t)
    if any dynamicType types
      then fromMaybe (unknown ("dynamic builtin " <> name)) (selectDynamic name)
      else do
        SomeFunction signature operation <- function
        let selected = builtinBinding operation
            target = pureAction selected
            chargedTarget = if abiMember then (CAPTURE target $ \compiled_target ->
              EMIT_BEGIN (chargeGas 1 >> chargeGas 1 >> compiled_target)
              EMIT_END) else target
        applyCall sc signature (constantFunction chargedTarget) args
  where
    selectDynamic = \case
      "keccak256" -> Just (dynamicCall TStr (EMIT_BEGIN Builtins.keccak EMIT_END))
      "ecrecover" -> Just (dynamicCall TAddr (EMIT_BEGIN Builtins.recover EMIT_END))
      "addmod" -> Just (dynamicCall TInt (EMIT_BEGIN (Builtins.modular Metered.addmod) EMIT_END))
      "mulmod" -> Just (dynamicCall TInt (EMIT_BEGIN (Builtins.modular Metered.mulmod) EMIT_END))
      "string" -> Just (dynamicCall TStr (EMIT_BEGIN Builtins.string EMIT_END))
      "decimal" -> Just (dynamicCall TDecimal (EMIT_BEGIN Builtins.decimal EMIT_END))
      "int" -> Just (dynamicCall TInt (EMIT_BEGIN Builtins.integer EMIT_END))
      "address" -> Just (dynamicCall TAddr (EMIT_BEGIN Builtins.address EMIT_END))
      "abi.encode" -> Just (dynamicCall TBytes (EMIT_BEGIN (Builtins.encode False) EMIT_END))
      "abi.encodePacked" -> Just (dynamicCall TBytes (EMIT_BEGIN (Builtins.encode True) EMIT_END))
      "selfdestruct" -> Just (dynamicCall TBool (EMIT_BEGIN Builtins.destroy EMIT_END))
      "create" -> Just (dynamicCall TAddr (EMIT_BEGIN (Builtins.create False) EMIT_END))
      "create2" -> Just (dynamicCall TAddr (EMIT_BEGIN (Builtins.create True) EMIT_END))
      _ -> Nothing

    dynamicCall :: Ty result -> Code ([Dyn] -> M Dyn) -> C (CE ls)
    dynamicCall result dynamic = do
      values <- compileDynArgs sc args
      pure $ CE result $ (CAPTURE2 values dynamic $ \compiled_values compiled_dynamic ->
        EMIT_BEGIN (\env -> do
          ds <- compiled_values env
          when abiMember $ chargeGas 1 >> chargeGas 1
          compiled_dynamic ds >>= fromDyn result)
        EMIT_END)

    dynamicType (SomeTy TVariadic) = True
    dynamicType (SomeTy TRaw) = True
    dynamicType _ = False

lookupBuiltinFunction :: forall ls r. Scope ls r -> T.Text -> [Expression] -> Maybe (C SomeFunction)
lookupBuiltinFunction sc name args = select name
  where
    select =
#include "BuiltinActions.inc"

    argumentTypes = forM args $ \expression -> do
      CE t _ <- compileE sc expression
      pure (SomeTy t)

    conversion :: Ty b -> (forall a. Ty a -> Code (a -> M b)) -> C SomeFunction
    conversion result operation = do
      types <- argumentTypes
      case types of
        [SomeTy t] -> pure $ SomeFunction (SigCons t (SigNil result)) (operation t)
        _ -> typeErr ("invalid arguments to builtin " <> name)

    integerCast :: Ty a -> Code (a -> M Integer)
    integerCast t = case t of
      TInt -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TDecimal -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TStr -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TBytes -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TAddr -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TUnit -> EMIT_BEGIN (MeteredCasts.int) EMIT_END
      TEnum _ _ -> EMIT_BEGIN (MeteredCasts.int . enumNumber) EMIT_END
      TRef _ -> EMIT_BEGIN (const (MeteredCasts.int ())) EMIT_END
      _ -> EMIT_BEGIN (Builtins.invalidCast "integer cast" t) EMIT_END

    decimalCast :: Ty a -> Code (a -> M Decimal)
    decimalCast t = case t of
      TInt -> EMIT_BEGIN (MeteredCasts.decimal) EMIT_END
      TDecimal -> EMIT_BEGIN (MeteredCasts.decimal) EMIT_END
      TStr -> EMIT_BEGIN (MeteredCasts.decimal) EMIT_END
      TUnit -> EMIT_BEGIN (MeteredCasts.decimal) EMIT_END
      TRef _ -> EMIT_BEGIN (const (MeteredCasts.decimal ())) EMIT_END
      _ -> EMIT_BEGIN (Builtins.invalidCast "decimal cast" t) EMIT_END

    addressCast :: Ty a -> Code (a -> M Address)
    addressCast t = case t of
      TAddr -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TContract _ -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TInt -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TBytes -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TStr -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TUnit -> EMIT_BEGIN (MeteredCasts.address) EMIT_END
      TRef _ -> EMIT_BEGIN (const (MeteredCasts.address ())) EMIT_END
      _ -> EMIT_BEGIN (Builtins.invalidCast "address cast" t) EMIT_END

    stringCast :: Ty a -> Code (a -> M T.Text)
    stringCast t = case t of
      TStr -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TAddr -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TInt -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TBool -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TBytes -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TUnit -> EMIT_BEGIN (MeteredCasts.string) EMIT_END
      TRef _ -> EMIT_BEGIN (const (MeteredCasts.string ())) EMIT_END
      _ -> EMIT_BEGIN (Builtins.invalidCast "string cast" t) EMIT_END

    destroyCast :: Ty a -> Code (a -> M Bool)
    destroyCast t = CAPTURE (addressCast t) $ \compiled_recipient ->
      EMIT_BEGIN (\value -> compiled_recipient value >>= Builtins.destroyAddress) EMIT_END

    recoverFunction :: Ty a -> Code (a -> M (Integer -> Integer -> Integer -> M Address))
    recoverFunction t = case t of
      TBytes -> EMIT_BEGIN (pure . Metered.ecrecover) EMIT_END
      TInt -> EMIT_BEGIN (pure . Metered.ecrecover) EMIT_END
      TAddr -> EMIT_BEGIN (pure . Metered.ecrecover) EMIT_END
      TStr -> EMIT_BEGIN (pure . Metered.ecrecover) EMIT_END
      TUnit -> EMIT_BEGIN (pure . Metered.ecrecover) EMIT_END
      _ -> EMIT_BEGIN (Builtins.invalidCast "ecrecover hash" t) EMIT_END

    stringCall = do
      types <- argumentTypes
      case types of
        [_] -> conversion TStr stringCast
        [SomeTy TBytes, SomeTy TStr] -> pure $ SomeFunction (SigCons TBytes (SigCons TStr (SigNil TStr))) (EMIT_BEGIN Builtins.stringEncoding EMIT_END)
        [_, _] -> pure $ SomeFunction (SigCons TInt (SigCons TInt (SigNil TStr))) (EMIT_BEGIN Builtins.stringBase EMIT_END)
        [_, _, _] -> pure $ SomeFunction (SigCons TInt (SigCons TInt (SigCons TInt (SigNil TStr)))) (EMIT_BEGIN Builtins.stringWidth EMIT_END)
        _ -> typeErr ("invalid arguments to builtin " <> name)

    recoverCall = do
      types <- argumentTypes
      case types of
        [SomeTy h, SomeTy TInt, SomeTy rType, SomeTy s] ->
          pure $ SomeFunction (SigCons h (SigCons TInt (SigCons rType (SigCons s (SigNil TAddr)))))
            (CAPTURE3 (recoverFunction h) (integerCast rType) (integerCast s) $ \compiled_hash compiled_r compiled_s ->
              EMIT_BEGIN (Builtins.recoverTyped compiled_hash compiled_r compiled_s) EMIT_END)
        _ -> typeErr ("invalid arguments to builtin " <> name)

    createSaltedCall = do
      types <- argumentTypes
      case types of
        SomeTy salt : _ -> pure $ SomeFunction (SigCons salt (SigCons TStr (SigCons TStr (SigCons TVariadic (SigNil TAddr)))))
          (EMIT_BEGIN (Builtins.createSaltedValue salt) EMIT_END)
        _ -> typeErr ("invalid arguments to builtin " <> name)

    aggregate :: Ty result -> (forall as. Fields as -> Code (HL as -> M result)) -> C SomeFunction
    aggregate result body = do
      types <- argumentTypes
      case fieldsFor types of
        SomeFields fields -> do
          let signature = fieldsSignature fields result
              operation = body fields
          pure $ SomeFunction signature (CAPTURE operation $ \compiled_operation ->
            EMIT_BEGIN (curryArguments signature compiled_operation)
            EMIT_END)

    hashCall = aggregate TStr $ \fields ->
      EMIT_BEGIN (let encoder = Builtins.arguments Builtins.rlpArgument fields
                  in encoder `seq` \values -> encoder values >>= Builtins.keccakValue . Builtins.rlpArguments)
      EMIT_END

    abiCall packed = aggregate TBytes $ \fields ->
      EMIT_BEGIN (Builtins.abiArguments packed fields) EMIT_END

    fieldsFor [] = SomeFields FNil
    fieldsFor (SomeTy t : rest) = case fieldsFor rest of
      SomeFields fields -> SomeFields (FCons "" t fields)

fieldsSignature :: Fields as -> Ty result -> Sig as result
fieldsSignature FNil result = SigNil result
fieldsSignature (FCons _ t fields) result = SigCons t (fieldsSignature fields result)
