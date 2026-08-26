{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

-- Generic register IR for uint/bool helpers and loop bodies. Not keyed on any
-- contract or function name: any helper whose statements lower is compiled
-- once (StableName cache) and executed without walking the AST.
module Blockchain.SolidVM.FastUIntIR
  ( runNamedUIntIR,
    runScalarUIntIR,
    runAnyUIntIR,
    StorageHooks (..),
    runAnyStorageIR,
    funcLowers,
    funcFallbackCount,
  )
where

import Control.Applicative ((<|>))
import Control.Lens ((^.))
import Control.Monad (forM, forM_, guard, unless, when, zipWithM_)
import Data.List (elemIndex)
import Control.Monad.ST (runST)
import Control.Monad.ST.Unsafe (unsafeIOToST)
import Data.STRef (modifySTRef', newSTRef, readSTRef, writeSTRef)
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.State.Strict (StateT, evalStateT, get, modify', put, runStateT, state)
import Data.Bits (shift, shiftR, xor, (.&.), (.|.))
import Data.Function (on)
import Data.IORef (IORef, modifyIORef', newIORef, readIORef, writeIORef)

import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromMaybe, isJust, isNothing, listToMaybe, mapMaybe)

import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV
import SolidVM.Model.CodeCollection (CodeCollection, Contract, Func)
import qualified SolidVM.Model.CodeCollection as CC
import qualified SolidVM.Model.CodeCollection.VariableDecl as VD
import SolidVM.Model.SolidString (SolidString, labelToString)
import qualified SolidVM.Model.Type as SVMType
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)
import System.Mem.StableName (StableName, eqStableName, makeStableName)
import UnliftIO (MonadUnliftIO, withRunInIO)

logMiss :: String -> ()
logMiss msg =
  unsafePerformIO $ do
    mpath <- lookupEnv "SOLIDVM_IR_MISS"
    case mpath of
      Just path | not (null path) -> appendFile path (msg ++ "\n")
      _ -> pure ()

data UOp
  = ULit !Int !Integer
  | UMov !Int !Int
  | UAdd !Int !Int !Int
  | USub !Int !Int !Int
  | UMul !Int !Int !Int
  | UDiv !Int !Int !Int
  | UMod !Int !Int !Int
  | UShl !Int !Int !Int
  | UShr !Int !Int !Int
  | UAndB !Int !Int !Int
  | UOrB !Int !Int !Int
  | UXor !Int !Int !Int
  | UNot !Int !Int
  | ULt !Int !Int !Int
  | UGt !Int !Int !Int
  | ULe !Int !Int !Int
  | UGe !Int !Int !Int
  | UEq !Int !Int !Int
  | UNeq !Int !Int !Int
  | UJmp !Int
  | UJmpZ !Int !Int
  | ULabel !Int
  | UReq !Int
  | UReqJ !Int !Int
  | UCharge !Integer
  | URet ![Int]
  | USender !Int
  | UThis !Int
  | UMapGet !Int !SolidString !Int !Bool
  | UMapSet !SolidString !Int !Int !Bool
  | UMapGetAt !Int !SolidString !Int !Bool !Int
  | UMapSetAt !SolidString !Int !Int !Bool !Int
  | UMapGet2 !Int !SolidString !Int !Bool !Int !Bool
  | UMapSet2 !SolidString !Int !Bool !Int !Int !Bool
  | UMapGet2At !Int !SolidString !Int !Bool !Int !Bool !Int
  | UMapSet2At !SolidString !Int !Bool !Int !Int !Bool !Int
  | USloadAddr !Int !SolidString
  | USloadAt !Int !SolidString !Int
  | USstore !SolidString !Int
  | USstoreAt !SolidString !Int !Int
  | UEmit !String ![Int]
  | UTimestamp !Int
  | UNumber !Int
  | UFallback
  | -- Isolated pure helper: compiled once, then invoked from ST without
    -- walking the caller's op stream.
    UCallPure !(V.Vector UOp) !Int ![Int] ![Int] ![Int]
  | -- Isolated storage helper: nested runOpsM shares the caller's storage
    -- caches so a loop of external calls does not re-sload every trip.
    UCallStorage !(V.Vector UOp) !Int ![Int] ![Int] ![Int] !(Maybe Int)
  deriving (Eq, Show)

data CState = CState
  { csNames :: !(M.Map SolidString Int),
    csNext :: !Int,
    csCode :: ![UOp],
    csDepth :: !Int,
    csCalleeReg :: !(Maybe Int),
    csCatch :: !(Maybe Int),
    -- Formal mapping names (library `self`) to the caller's map + callee.
    csMapAlias :: !(M.Map SolidString (SolidString, Maybe Int)),
    -- Static types of bound names so `Token x = t; x.transferFrom(...)`
    -- resolves on Token even when many contracts define transferFrom.
    csTypes :: !(M.Map SolidString SVMType.Type),
    -- Inlined `msg.sender`: Nothing = Env.sender at the IR entry; Just r =
    -- the calling contract of the current inlined frame.
    csSenderReg :: !(Maybe Int),
    -- True while isolate-compiling a pure helper: nested calls must inline,
    -- never isolateCompile, so there is no nested unsafePerformIO blackhole.
    csInliningOnly :: !Bool,
    -- Isolated helpers must `RetJump` so modifier postfix after `_` still
    -- runs; entry-point compile keeps `RetHalt` (historical AST-fallback).
    csRetJump :: !Bool
  }

type CM = StateT CState Maybe

-- How an inlined/top-level `return` is lowered.
data RetCont
  = RetHalt
  | RetJump !Int ![Int]

byteWidth :: Integer -> Int
byteWidth = go 0 . abs
  where
    go w 0 = w
    go w n = let !v = w + 32 in go v (n `shiftR` 256)

gasForOp :: Int -> Int
gasForOp numBytes = 1 + (numBytes `shiftR` 5)

unsignedType :: SVMType.Type -> Bool
unsignedType (SVMType.Int signedness _) = signedness /= Just True
unsignedType (SVMType.UserDefined _ actual) = unsignedType actual
unsignedType _ = False

intLike :: SVMType.Type -> Bool
intLike (SVMType.Int {}) = True
intLike (SVMType.UserDefined _ actual) = intLike actual
intLike _ = False

isAddressType :: SVMType.Type -> Bool
isAddressType (SVMType.Address {}) = True
isAddressType (SVMType.UserDefined _ actual) = isAddressType actual
isAddressType _ = False

isContractType :: SVMType.Type -> Bool
isContractType (SVMType.Contract {}) = True
isContractType (SVMType.UnknownLabel {}) = True
isContractType (SVMType.UserDefined _ t) = isContractType t
isContractType _ = False

isMappingType :: SVMType.Type -> Bool
isMappingType (SVMType.Mapping {}) = True
isMappingType (SVMType.UserDefined _ t) = isMappingType t
isMappingType _ = False

isEnumType :: SVMType.Type -> Bool
isEnumType (SVMType.Enum {}) = True
isEnumType (SVMType.UserDefined _ t) = isEnumType t
isEnumType _ = False

uintishType :: SVMType.Type -> Bool
uintishType ty =
  unsignedType ty
    || intLike ty
    || ty == SVMType.Bool
    || isAddressType ty
    || isContractType ty
    || isEnumType ty

structTypeName :: SVMType.Type -> Maybe SolidString
structTypeName (SVMType.Struct _ n) = Just n
structTypeName (SVMType.UnknownLabel n) = Just n
structTypeName (SVMType.UserDefined n _) = Just n
structTypeName _ = Nothing

mappingKeyKind :: SVMType.Type -> Maybe Bool
mappingKeyKind (SVMType.Mapping _ keyTy valTy _ _)
  | uintishType valTy =
      case keyTy of
        SVMType.Address {} -> Just True
        SVMType.Int {} -> Just False
        SVMType.UserDefined _ (SVMType.Address {}) -> Just True
        SVMType.UserDefined _ (SVMType.Int {}) -> Just False
        _ -> Nothing
mappingKeyKind _ = Nothing

keyIsAddr :: SVMType.Type -> Maybe Bool
keyIsAddr (SVMType.Address {}) = Just True
keyIsAddr (SVMType.Int {}) = Just False
keyIsAddr (SVMType.UserDefined _ t) = keyIsAddr t
keyIsAddr _ = Nothing

nestedMapKeys :: CodeCollection -> Contract -> SolidString -> Maybe (Bool, Bool)
nestedMapKeys cc contract name = do
  decl <-
    M.lookup name (contract ^. CC.storageDefs)
      <|> listToMaybe (mapMaybe (\p -> M.lookup name (p ^. CC.storageDefs)) (ancestors cc contract))
      <|> listToMaybe
        [ d
        | c <- M.elems (cc ^. CC.contracts),
          c ^. CC.contractType /= CC.LibraryType,
          Just d <- [M.lookup name (c ^. CC.storageDefs)]
        ]
  case decl ^. VD.varType of
    SVMType.Mapping _ k1 (SVMType.Mapping _ k2 v _ _) _ _
      | uintishType v -> (,) <$> keyIsAddr k1 <*> keyIsAddr k2
    _ -> Nothing

mappingAddrKey :: CodeCollection -> Contract -> SolidString -> Maybe Bool
mappingAddrKey cc contract name =
  fromDecl (contract ^. CC.storageDefs)
    <|> listToMaybe (mapMaybe (fromDecl . (^. CC.storageDefs)) (ancestors cc contract))
    <|> listToMaybe
      ( mapMaybe
          (fromDecl . (^. CC.storageDefs))
          [ c
          | c <- M.elems (cc ^. CC.contracts),
            c ^. CC.contractType /= CC.LibraryType
          ]
      )
  where
    fromDecl defs = do
      decl <- M.lookup name defs
      mappingKeyKind (decl ^. VD.varType)

fresh :: CM Int
fresh = state $ \s ->
  let n = csNext s
   in (n, s {csNext = n + 1})

emit :: UOp -> CM ()
emit op = modify' $ \s -> s {csCode = op : csCode s}

resolveMap :: SolidString -> CM (SolidString, Maybe Int)
resolveMap mapName = do
  s <- get
  case M.lookup mapName (csMapAlias s) of
    Just (actual, aliasCal) -> pure (actual, aliasCal <|> csCalleeReg s)
    Nothing -> pure (mapName, csCalleeReg s)

emitMapSet :: SolidString -> Int -> Int -> Bool -> CM ()
emitMapSet mapName k v isAddr = do
  (actual, callee) <- resolveMap mapName
  case callee of
    Nothing -> emit $ UMapSet actual k v isAddr
    Just cr -> emit $ UMapSetAt actual k v isAddr cr

emitMapGet :: Int -> SolidString -> Int -> Bool -> CM ()
emitMapGet dest mapName k isAddr = do
  (actual, callee) <- resolveMap mapName
  case callee of
    Nothing -> emit $ UMapGet dest actual k isAddr
    Just cr -> emit $ UMapGetAt dest actual k isAddr cr

emitSload :: Int -> SolidString -> CM ()
emitSload dest field = do
  callee <- csCalleeReg <$> get
  case callee of
    Nothing -> emit $ USloadAddr dest field
    Just cr -> emit $ USloadAt dest field cr

emitSstore :: SolidString -> Int -> CM ()
emitSstore field v = do
  callee <- csCalleeReg <$> get
  case callee of
    Nothing -> emit $ USstore field v
    Just cr -> emit $ USstoreAt field v cr

emitReq :: Int -> CM ()
emitReq r = do
  mCatch <- csCatch <$> get
  case mCatch of
    Just t -> emit $ UReqJ r t
    Nothing -> emit $ UReq r

emitMsgSender :: Int -> CM ()
emitMsgSender r = do
  mSender <- csSenderReg <$> get
  case mSender of
    Nothing -> emit $ USender r
    Just sr -> emit $ UMov r sr

contractTypeName :: SVMType.Type -> Maybe SolidString
contractTypeName (SVMType.Contract n) = Just n
contractTypeName (SVMType.UnknownLabel n) = Just n
contractTypeName (SVMType.UserDefined _ t) = contractTypeName t
contractTypeName _ = Nothing

methodOnType :: CodeCollection -> SVMType.Type -> SolidString -> Maybe (Contract, Func)
methodOnType cc ty methodName = do
  typeName <- contractTypeName ty
  tgt <- M.lookup typeName (cc ^. CC.contracts)
  func <-
    M.lookup methodName (tgt ^. CC.functions)
      <|> listToMaybe
        [ f
        | p <- ancestors cc tgt,
          Just f <- [M.lookup methodName (p ^. CC.functions)]
        ]
  pure (tgt, func)

singleReturnType :: Func -> Maybe SVMType.Type
singleReturnType func = case CC._funcVals func of
  [(_, CC.IndexedType _ ty _)] -> Just ty
  _ -> Nothing

callReturnType :: CodeCollection -> Contract -> CC.Expression -> Maybe SVMType.Type
callReturnType cc current = \case
  CC.Variable _ name -> do
    func <-
      listToMaybe
        [ f
        | c <- current : ancestors cc current,
          Just f <- [M.lookup name (c ^. CC.functions)]
        ]
    singleReturnType func
  CC.MemberAccess _ (CC.FunctionCall _ (CC.Variable _ typeName) [_]) methodName
    | Just tgt <- M.lookup typeName (cc ^. CC.contracts) ->
        (M.lookup methodName (tgt ^. CC.functions) >>= singleReturnType)
          <|> (uintishStorage cc tgt methodName >> ( (^. VD.varType) <$> M.lookup methodName (tgt ^. CC.storageDefs)))
  CC.MemberAccess _ (CC.Variable _ receiverName) methodName ->
    case M.lookup receiverName (cc ^. CC.contracts) of
      Just lib | lib ^. CC.contractType == CC.LibraryType ->
        M.lookup methodName (lib ^. CC.functions) >>= singleReturnType
      _ ->
        (typedMethod cc current receiverName methodName >>= singleReturnType . snd)
          <|> (mostDerivedMethod cc methodName >>= singleReturnType . snd)
  _ -> Nothing

typedMethod :: CodeCollection -> Contract -> SolidString -> SolidString -> Maybe (Contract, Func)
typedMethod cc current receiverName methodName = do
  decl <-
    M.lookup receiverName (current ^. CC.storageDefs)
      <|> listToMaybe
        ( catMaybes
            [ M.lookup receiverName (p ^. CC.storageDefs)
            | p <- ancestors cc current
            ]
        )
  methodOnType cc (decl ^. VD.varType) methodName

mostDerivedMethod :: CodeCollection -> SolidString -> Maybe (Contract, Func)
mostDerivedMethod cc methodName =
  case hits of
    [one] -> Just one
    many@(_ : _) ->
      let derived =
            [ pair
            | pair@(c, _) <- many,
              not $
                any
                  (\(c', _) ->
                     (c ^. CC.contractName) `elem` map (^. CC.contractName) (ancestors cc c')
                  )
                  many
            ]
       in case derived of
            [one] -> Just one
            _ -> Nothing
    _ -> Nothing
  where
    hits =
      [ (c, f)
      | c <- M.elems (cc ^. CC.contracts),
        c ^. CC.contractType /= CC.LibraryType,
        Just f <- [M.lookup methodName (c ^. CC.functions)]
      ]

ancestors :: CodeCollection -> Contract -> [Contract]
ancestors cc c =
  concat
    [ case M.lookup n (cc ^. CC.contracts) of
        Just p -> p : ancestors cc p
        Nothing -> []
    | n <- c ^. CC.parents
    ]

lookupModifier :: CodeCollection -> Contract -> SolidString -> Maybe CC.Modifier
lookupModifier cc contract name =
  M.lookup name (contract ^. CC.modifiers)
    <|> listToMaybe (catMaybes [M.lookup name (p ^. CC.modifiers) | p <- ancestors cc contract])

spliceModifierBody :: [CC.Statement] -> [CC.Statement] -> Maybe [CC.Statement]
spliceModifierBody body stmts =
  case break isPlaceholder stmts of
    (pre, _ : post) -> Just (pre ++ body ++ post)
    _ -> Nothing
  where
    isPlaceholder (CC.ModifierExecutor _) = True
    isPlaceholder _ = False

applyModifiers :: CodeCollection -> Contract -> Func -> [CC.Statement] -> Maybe [CC.Statement]
applyModifiers cc contract func commands =
  foldr step (Just commands) (CC._funcModifiers func)
  where
    step (name, args) acc = do
      unless (null args) $
        let !_ = logMiss ("modargs " ++ labelToString name ++ " " ++ show (length args))
         in Nothing
      guard (null args)
      body <- acc
      case lookupModifier cc contract name of
        Nothing ->
          let !_ = logMiss ("modmiss " ++ labelToString name)
           in Nothing
        Just modi -> do
          mstmts <- case CC._modifierContents modi of
            Nothing ->
              let !_ = logMiss ("modempty " ++ labelToString name)
               in Nothing
            Just s -> Just s
          case spliceModifierBody body mstmts of
            Nothing ->
              let !_ = logMiss ("modsplice " ++ labelToString name)
               in Nothing
            Just spliced -> Just spliced

bindName :: SolidString -> Int -> CM ()
bindName name r = modify' $ \s -> s {csNames = M.insert name r (csNames s)}

bindTyped :: SolidString -> SVMType.Type -> Int -> CM ()
bindTyped name ty r = do
  bindName name r
  modify' $ \s -> s {csTypes = M.insert name ty (csTypes s)}

lookupName :: SolidString -> CM Int
lookupName name = do
  s <- get
  case M.lookup name (csNames s) of
    Just r -> pure r
    Nothing -> do
      let !_ = logMiss ("lookup " ++ labelToString name)
      lift Nothing

-- Assign a register into a local, a flattened `name.field` memory-struct
-- slot, or a uintish storage variable. Used by tuple LHS `(a, s.x) = f()`.
assignTo :: CodeCollection -> Contract -> CC.Expression -> Int -> CM ()
assignTo _ _ expr src = case unwrapLHS expr of
  CC.Variable _ name -> do
    s <- get
    case M.lookup name (csNames s) of
      Just dest -> emit $ UMov dest src
      Nothing -> emitSstore name src
  CC.MemberAccess _ (CC.Variable _ rec) field -> do
    dest <- lookupName (rec ++ "." ++ field)
    emit $ UMov dest src
  other -> do
    let !_ = logMiss ("assign " ++ take 120 (show other))
    lift Nothing

charge :: Integer -> CM ()
charge 0 = pure ()
charge n = emit $ UCharge n

compileExpr :: CodeCollection -> Contract -> CC.Expression -> CM Int
compileExpr cc current = \case
  CC.NumberLiteral _ value _ -> do
    r <- fresh
    emit $ ULit r value
    charge 1
    pure r
  CC.BoolLiteral _ value -> do
    r <- fresh
    emit $ ULit r (if value then 1 else 0)
    charge 1
    pure r
  CC.Variable _ name -> compileVar cc current name
  CC.PlusPlus _ (CC.Variable _ name) -> bump name True
  CC.MinusMinus _ (CC.Variable _ name) -> bump name False
  CC.InlineBoundsCheck _ maybeLower maybeUpper child -> do
    r <- compileExpr cc current child
    case maybeLower of
      Just lo -> do
        c <- fresh
        lit <- fresh
        emit $ ULit lit lo
        emit $ UGe c r lit
        emitReq c
      Nothing -> pure ()
    case maybeUpper of
      Just hi -> do
        c <- fresh
        lit <- fresh
        emit $ ULit lit hi
        emit $ ULe c r lit
        emitReq c
      Nothing -> pure ()
    pure r
  CC.Unitary _ "!" child -> do
    x <- compileExpr cc current child
    r <- fresh
    emit $ UNot r x
    charge 1
    pure r
  CC.Unitary _ "-" child -> do
    x <- compileExpr cc current child
    z <- fresh
    r <- fresh
    emit $ ULit z 0
    emit $ USub r z x
    charge 1
    pure r
  CC.Unitary _ "+" child -> compileExpr cc current child
  CC.Ternary _ condition ifTrue ifFalse -> do
    c <- compileExpr cc current condition
    r <- fresh
    afterTrue <- freshPlaceholder
    falsePc <- freshPlaceholder
    emit $ UJmpZ c falsePc
    t <- compileExpr cc current ifTrue
    emit $ UMov r t
    emit $ UJmp afterTrue
    mark falsePc
    f <- compileExpr cc current ifFalse
    emit $ UMov r f
    mark afterTrue
    charge 1
    pure r
  CC.MemberAccess _ (CC.Variable _ "msg") "sender" -> do
    r <- fresh
    emitMsgSender r
    charge 1
    charge 1
    pure r
  CC.MemberAccess _ (CC.Variable _ "block") "timestamp" -> do
    r <- fresh
    emit $ UTimestamp r
    charge 1
    charge 1
    pure r
  CC.MemberAccess _ (CC.Variable _ "block") "number" -> do
    r <- fresh
    emit $ UNumber r
    charge 1
    charge 1
    pure r
  CC.IndexAccess _ (CC.IndexAccess _ (CC.Variable _ mapName) (Just k1e)) (Just k2e) -> do
    (actual, callee) <- resolveMap mapName
    (ia1, ia2) <- lift $ nestedMapKeys cc current actual
    k1 <- compileExpr cc current k1e
    k2 <- compileExpr cc current k2e
    r <- fresh
    case callee of
      Nothing -> emit $ UMapGet2 r actual k1 ia1 k2 ia2
      Just cr -> emit $ UMapGet2At r actual k1 ia1 k2 ia2 cr
    charge 1
    pure r
  CC.IndexAccess _ (CC.Variable _ mapName) (Just idx) -> do
    (actual, _) <- resolveMap mapName
    isAddr <- case mappingAddrKey cc current actual of
      Just b -> pure b
      Nothing -> do
        let !_ = logMiss ("mapkey " ++ labelToString actual)
        lift Nothing
    k <- compileExpr cc current idx
    r <- fresh
    emitMapGet r mapName k isAddr
    charge 1
    pure r
  CC.MemberAccess _ (CC.Variable _ receiverName) memberName -> do
    s <- get
    case M.lookup (receiverName ++ "." ++ memberName) (csNames s) of
      Just r0 -> charge 1 >> charge 1 >> pure r0
      Nothing ->
        case enumMember cc current receiverName memberName of
          Just n -> do
            r <- fresh
            emit $ ULit r n
            charge 1
            charge 1
            pure r
          Nothing -> do
            guard $ not (nameShadowed receiverName current cc (csNames s))
            target <- lift $ M.lookup receiverName (cc ^. CC.contracts)
            constantDecl <- lift $ M.lookup memberName (target ^. CC.constants)
            r <- compileExpr cc target (constantDecl ^. CC.constInitialVal)
            charge 1 -- receiver Variable
            charge 1 -- MemberAccess
            pure r
  CC.FunctionCall _ callee args -> do
    rs <- compileCallValues cc current callee args
    case rs of
      [r] -> pure r
      _ -> do
        let !_ = logMiss "call-nonsingle"
        lift Nothing
  CC.Binary _ "**" (CC.NumberLiteral _ a _) (CC.NumberLiteral _ b _)
    | b >= 0 -> do
        r <- fresh
        emit $ ULit r (a ^ b)
        charge 1
        pure r
  CC.Binary _ op left right -> compileBinary cc current op left right
  expr -> do
    let !_ = logMiss ("expr " ++ take 220 (show expr))
    lift Nothing
  where
    bump name isAdd = do
      dest <- lookupName name
      old <- fresh
      emit $ UMov old dest
      one <- fresh
      emit $ ULit one 1
      if isAdd then emit (UAdd dest dest one) else emit (USub dest dest one)
      charge 1
      pure old

compileVar :: CodeCollection -> Contract -> SolidString -> CM Int
compileVar cc current name = do
  s <- get
  case M.lookup name (csNames s) of
    Just r0 -> charge 1 >> pure r0
    Nothing
      | name == "this" -> do
          r <- fresh
          callee <- csCalleeReg <$> get
          case callee of
            Nothing -> emit $ UThis r
            Just cr -> emit $ UMov r cr
          charge 1
          pure r
    Nothing -> case M.lookup name (current ^. CC.constants) of
      Just decl -> compileExpr cc current (decl ^. CC.constInitialVal)
      Nothing -> case M.lookup name (cc ^. CC.flConstants) of
        Just decl -> compileExpr cc current (decl ^. CC.constInitialVal)
        Nothing -> case lookupStorage current name of
          Just decl | scalarStorage (decl ^. VD.varType) -> sloadScalar name
          _ -> do
            let !_ = logMiss ("var " ++ labelToString name)
            lift Nothing
  where
    lookupStorage c n =
      M.lookup n (c ^. CC.storageDefs)
        <|> listToMaybe (catMaybes [M.lookup n (p ^. CC.storageDefs) | p <- ancestors cc c])
    scalarStorage ty =
      uintishType ty || isAddressType ty
        || case ty of
          SVMType.Contract {} -> True
          SVMType.UnknownLabel {} -> True
          SVMType.UserDefined _ (SVMType.Contract {}) -> True
          SVMType.UserDefined _ (SVMType.UnknownLabel {}) -> True
          _ -> False
    sloadScalar field = do
      r <- fresh
      emitSload r field
      charge 1
      pure r

freshPlaceholder :: CM Int
freshPlaceholder = do
  r <- fresh
  pure $ negate (r + 1)

mark :: Int -> CM ()
mark lbl = emit $ ULabel lbl

accessorIsStorage :: CodeCollection -> Contract -> SolidString -> Bool
accessorIsStorage cc tgt fieldName =
  isJust (uintishStorage cc tgt fieldName)
    && maybe True (isNothing . CC._funcContents) (M.lookup fieldName (tgt ^. CC.functions))

uintishStorage :: CodeCollection -> Contract -> SolidString -> Maybe ()
uintishStorage cc tgt fieldName = do
  decl <-
    M.lookup fieldName (tgt ^. CC.storageDefs)
      <|> listToMaybe (mapMaybe (\p -> M.lookup fieldName (p ^. CC.storageDefs)) (ancestors cc tgt))
  guard $ uintishType (decl ^. VD.varType)
  pure ()

enumMember :: CodeCollection -> Contract -> SolidString -> SolidString -> Maybe Integer
enumMember cc current typeName memberName = do
  (names, _) <-
    M.lookup typeName (current ^. CC.enums)
      <|> listToMaybe (mapMaybe (\p -> M.lookup typeName (p ^. CC.enums)) (ancestors cc current))
      <|> M.lookup typeName (cc ^. CC.flEnums)
  fromIntegral <$> elemIndex memberName names

nameShadowed :: SolidString -> Contract -> CodeCollection -> M.Map SolidString Int -> Bool
nameShadowed name contract collection names =
  M.member name names
    || M.member name (contract ^. CC.storageDefs)
    || M.member name (contract ^. CC.constants)
    || M.member name (contract ^. CC.enums)
    || M.member name (contract ^. CC.structs)
    || M.member name (collection ^. CC.flConstants)
    || M.member name (collection ^. CC.flEnums)
    || M.member name (collection ^. CC.flStructs)

unwrapLHS :: CC.Expression -> CC.Expression
unwrapLHS (CC.InlineBoundsCheck _ _ _ inner) = unwrapLHS inner
unwrapLHS expr = expr

assignBin :: String -> Maybe (Int -> Int -> Int -> UOp)
assignBin ">>=" = Just UShr
assignBin "<<=" = Just UShl
assignBin "&=" = Just UAndB
assignBin "|=" = Just UOrB
assignBin "^=" = Just UXor
assignBin _ = Nothing

compileBinary :: CodeCollection -> Contract -> String -> CC.Expression -> CC.Expression -> CM Int
compileBinary cc current op left right
  | op `elem` ["&&", "||"] = do
      l <- compileExpr cc current left
      rdest <- fresh
      after <- freshPlaceholder
      other <- freshPlaceholder
      if op == "&&"
        then do
          emit $ UJmpZ l other
          rr <- compileExpr cc current right
          emit $ UMov rdest rr
          emit $ UJmp after
          mark other
          emit $ ULit rdest 0
          mark after
        else do
          emit $ UJmpZ l other
          emit $ ULit rdest 1
          emit $ UJmp after
          mark other
          rr <- compileExpr cc current right
          emit $ UMov rdest rr
          mark after
      charge 1
      pure rdest
  | otherwise = do
      l <- compileExpr cc current left
      r <- compileExpr cc current right
      d <- fresh
      case op of
        "+" -> emit (UAdd d l r)
        "-" -> emit (USub d l r)
        "*" -> emit (UMul d l r)
        "/" -> emit (UDiv d l r)
        "%" -> emit (UMod d l r)
        "<<" -> emit (UShl d l r)
        ">>" -> emit (UShr d l r)
        "&" -> emit (UAndB d l r)
        "|" -> emit (UOrB d l r)
        "^" -> emit (UXor d l r)
        "<" -> emit (ULt d l r)
        ">" -> emit (UGt d l r)
        "<=" -> emit (ULe d l r)
        ">=" -> emit (UGe d l r)
        "==" -> emit (UEq d l r)
        "!=" -> emit (UNeq d l r)
        op' -> do
          let !_ = logMiss ("binop " ++ op')
          lift Nothing
      charge 1
      pure d

namedUintReturns :: Func -> Maybe [SolidString]
namedUintReturns func = traverse namedUint (CC._funcVals func)
  where
    namedUint (Just name, CC.IndexedType _ ty _) | uintishType ty = Just name
    namedUint _ = Nothing

compileCallValues :: CodeCollection -> Contract -> CC.Expression -> CC.ArgList -> CM [Int]
compileCallValues cc current callee args
  | CC.Variable _ "_msgSender" <- callee
  , null args = do
      r <- fresh
      emitMsgSender r
      charge 2
      pure [r]
  -- Public state-variable getter: Type(addr).field() with no generated body.
  | CC.MemberAccess _ (CC.FunctionCall _ (CC.Variable _ typeName) [obj]) fieldName <- callee
  , null args
  , Just tgt <- M.lookup typeName (cc ^. CC.contracts)
  , accessorIsStorage cc tgt fieldName = do
      addrReg <- compileExpr cc current obj
      r <- fresh
      emit $ USloadAt r fieldName addrReg
      charge 2
      pure [r]
  | CC.Variable _ castName <- callee
  , (castName == "uint" || castName == "int" || castName == "address")
  , [arg] <- args = do
      r <- compileExpr cc current arg
      pure [r]
  | CC.Variable _ castName <- callee
  , M.member castName (cc ^. CC.contracts)
  , [arg] <- args = do
      r <- compileExpr cc current arg
      pure [r]
  | otherwise = do
      s <- get
      when (csDepth s >= 64) $ do
        let !_ = logMiss "depth"
        lift Nothing
      (target, original, receiverCost, mCallee) <- case callee of
        CC.MemberAccess _ (CC.Variable _ "super") methodName ->
          case [ (p, f)
               | p <- ancestors cc current,
                 Just f <- [M.lookup methodName (p ^. CC.functions)]
               ] of
            (tgt, func) : _ -> pure (tgt, func, 2, Nothing)
            _ -> lift Nothing
        CC.MemberAccess _ (CC.FunctionCall _ (CC.Variable _ typeName) [obj]) methodName
          | Just tgt <- M.lookup typeName (cc ^. CC.contracts)
          , Just func <- M.lookup methodName (tgt ^. CC.functions)
          , isJust (CC._funcContents func) -> do
              addrReg <- compileExpr cc current obj
              pure (tgt, func, 2, Just addrReg)
        CC.MemberAccess _ (CC.FunctionCall _ innerCallee innerArgs) methodName -> do
          rs <- compileCallValues cc current innerCallee innerArgs
          case rs of
            [addrReg] ->
              case (callReturnType cc current innerCallee >>= \ty -> methodOnType cc ty methodName)
                <|> mostDerivedMethod cc methodName of
                Just (tgt, func) -> pure (tgt, func, 2, Just addrReg)
                Nothing -> do
                  let !_ = logMiss ("nomethod-ret " ++ labelToString methodName)
                  lift Nothing
            _ -> lift Nothing
        CC.MemberAccess _ (CC.Variable _ receiverName) methodName ->
          case M.lookup receiverName (cc ^. CC.contracts) of
            Just lib | lib ^. CC.contractType == CC.LibraryType -> do
              guard $ not (nameShadowed receiverName current cc (csNames s))
              func <- lift $ M.lookup methodName (lib ^. CC.functions)
              pure (lib, func, 2, Nothing)
            _ -> do
              addrReg <- compileVar cc current receiverName
              st <- get
              let byLocal =
                    M.lookup receiverName (csTypes st) >>= \ty -> methodOnType cc ty methodName
              case byLocal <|> typedMethod cc current receiverName methodName <|> mostDerivedMethod cc methodName of
                Just (tgt, func) -> pure (tgt, func, 2, Just addrReg)
                Nothing -> do
                  let !_ = logMiss ("nomethod " ++ labelToString receiverName ++ "." ++ labelToString methodName)
                  lift Nothing
        CC.Variable _ functionName -> do
          guard $ isNothing $ M.lookup functionName (csNames s)
          let hits =
                [ (c, f)
                | c <- current : ancestors cc current,
                  Just f <- [M.lookup functionName (c ^. CC.functions)]
                ]
          case hits of
            (tgt, func) : _ -> pure (tgt, func, 0, Nothing)
            _ -> do
              let !_ = logMiss ("nofunc " ++ labelToString functionName)
              lift Nothing
        other -> do
          let !_ = logMiss ("callee " ++ take 180 (show other))
          lift Nothing
      charge receiverCost
      tryFuncs mCallee target (original : CC._funcOverload original)
  where
    tryFuncs _ _ [] = do
      let !_ = logMiss "tryfuncs-empty"
      lift Nothing
    tryFuncs calleeReg target (func : rest) = do
      s <- get
      case runStateT (tryFunc calleeReg target func) s of
        Nothing -> tryFuncs calleeReg target rest
        Just (r, s') -> put s' >> pure r

    tryFunc calleeReg target func = do
      guard $ not (CC._funcIsFree func)
      isolating <- csInliningOnly <$> get
      if isolating
        then inlineFunc calleeReg target func
        else case isolateCached cc target func of
          Just (!cops, !cnregs, !cargRegs, !cretRegs)
            | not (needsStorage cops) && isNothing calleeReg ->
                emitCallPure func cops cnregs cargRegs cretRegs
                  <|> inlineFunc calleeReg target func
            | isJust calleeReg ->
                emitCallStorage func calleeReg cops cnregs cargRegs cretRegs
                  <|> inlineFunc calleeReg target func
          _ -> inlineFunc calleeReg target func

    bindCallResults f dests = case namedUintReturns f of
      Just names | length names == length dests -> zipWithM_ bindName names dests
      _ -> pure ()

    emitCallPure f cops cnregs cargRegs cretRegs = do
      srcRegs <- compileArgRegs (CC._funcArgs f) args
      guard $ length srcRegs == length cargRegs
      dests <- mapM (\_ -> fresh) cretRegs
      emit $ UCallPure cops cnregs cargRegs srcRegs dests
      charge 1
      bindCallResults f dests
      pure dests

    emitCallStorage f mCallee cops cnregs cargRegs cretRegs = do
      srcRegs <- compileArgRegs (CC._funcArgs f) args
      guard $ length srcRegs == length cargRegs
      dests <- mapM (\_ -> fresh) cretRegs
      emit $ UCallStorage cops cnregs cargRegs srcRegs dests mCallee
      charge 1
      bindCallResults f dests
      pure dests

    compileArgRegs [] [] = pure []
    compileArgRegs ((_, CC.IndexedType _ ty _) : formals) (arg : rest)
      | uintishType ty = do
          r <- compileExpr cc current arg
          (r :) <$> compileArgRegs formals rest
    compileArgRegs _ _ = lift Nothing

    inlineFunc calleeReg target func = do
      commands0 <- case CC._funcContents func of
        Nothing -> do
          let !_ = logMiss "empty-body"
          lift Nothing
        Just c -> pure c
      commands <- case applyModifiers cc target func commands0 of
        Nothing -> do
          let !_ = logMiss ("inmod " ++ labelToString (target ^. CC.contractName))
          lift Nothing
        Just c -> pure c
      modify' $ \st -> st {csDepth = csDepth st + 1}
      saved <- csNames <$> get
      savedTypes <- csTypes <$> get
      -- Args are evaluated in the caller. Switching callee first made
      -- a storage-receiver call sload argument names from the callee.
      savedMaps <- csMapAlias <$> get
      bindCallFormals (CC._funcArgs func) args
      oldCallee <- csCalleeReg <$> get
      oldSender <- csSenderReg <$> get
      newSender <- case calleeReg of
        Nothing -> pure oldSender
        Just _ -> case oldCallee of
          Just cr -> pure (Just cr)
          Nothing -> do
            r <- fresh
            emit $ UThis r
            pure (Just r)
      modify' $ \st ->
        st
          { csCalleeReg = calleeReg <|> csCalleeReg st,
            csSenderReg = newSender
          }
      endLbl <- freshPlaceholder
      result <- case namedUintReturns func of
        Just retNames | not (null retNames) -> do
          destRegs <- forM retNames $ \n -> do
            r <- fresh
            bindName n r
            pure r
          _ <- compileStatements cc target (RetJump endLbl destRegs) commands
          mark endLbl
          pure destRegs
        _
          | null (CC._funcVals func) -> do
              _ <- compileStatements cc target (RetJump endLbl []) commands
              mark endLbl
              pure []
          | all (isNothing . fst) (CC._funcVals func) -> do
              dest <- fresh
              _ <- compileStatements cc target (RetJump endLbl [dest]) commands
              mark endLbl
              pure [dest]
          | otherwise -> lift Nothing
      modify' $ \st ->
        st
          { csNames = saved,
            csTypes = savedTypes,
            csDepth = csDepth st - 1,
            csCalleeReg = oldCallee,
            csSenderReg = oldSender,
            csMapAlias = savedMaps
          }
      pure result

    bindCallFormals [] [] = pure ()
    bindCallFormals ((Just name, CC.IndexedType _ ty _) : formals) (arg : rest)
      | uintishType ty = do
          r <- compileExpr cc current arg
          bindTyped name ty r
          bindCallFormals formals rest
      | isMappingType ty
      , CC.Variable _ mapName <- arg = do
          mapCallee <- csCalleeReg <$> get
          modify' $ \st -> st {csMapAlias = M.insert name (mapName, mapCallee) (csMapAlias st)}
          bindCallFormals formals rest
    bindCallFormals _ _ = do
      let !_ = logMiss "formals"
      lift Nothing

compileStatements :: CodeCollection -> Contract -> RetCont -> [CC.Statement] -> CM (Maybe Int)
compileStatements cc current ret = go Nothing
  where
    go lastRet [] = pure lastRet
    go lastRet (stmt : rest) = do
      r <- compileStmt cc current ret stmt
      go (r <|> lastRet) rest

compileStmt :: CodeCollection -> Contract -> RetCont -> CC.Statement -> CM (Maybe Int)
compileStmt cc current ret = \case
  CC.SimpleStatement (CC.ExpressionStatement (CC.InlineBoundsCheck _ _ _ inner)) annot ->
    compileStmt cc current ret (CC.SimpleStatement (CC.ExpressionStatement inner) annot)
  CC.Return (Just expr) _ -> do
    charge 1
    srcRegs <- compileRValues cc current expr
    case ret of
      RetHalt -> do
        emit $ URet srcRegs
        case srcRegs of
          r : _ -> pure $ Just r
          [] -> pure Nothing
      RetJump _ dests -> do
        guard $ length srcRegs == length dests
        zipWithM_ (\d s -> emit $ UMov d s) dests srcRegs
        -- Do not jump to tryFunc's end: modifier postfix after `_`
        -- (e.g. `unlocked = true`) must still run.
        case srcRegs of
          r : _ -> pure $ Just r
          [] -> pure Nothing
  CC.Return Nothing _ -> do
    charge 1
    case ret of
      RetHalt -> emit $ URet []
      RetJump {} -> pure ()
    pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] (Just initializer))
    _
      | uintishType varType -> do
          r <- compileExpr cc current initializer
          bindTyped name varType r
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] Nothing)
    _
      | Just sName <- structTypeName varType
      , Just fields <- CC.structDef current cc sName -> do
          forM_ fields $ \(fname, fty, _) -> do
            guard $ uintishType (CC.fieldTypeType fty)
            r <- fresh
            emit $ ULit r 0
            bindName (name ++ "." ++ fname) r
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] Nothing)
    _
      | uintishType varType -> do
          r <- fresh
          emit $ ULit r 0
          bindTyped name varType r
          charge 1
          pure Nothing
  CC.SimpleStatement (CC.VariableDefinition entries (Just rhs)) _
    | length entries > 1 -> do
        destNames <- forM entries $ \case
          CC.VarDefEntry (Just varType) _ name _ | uintishType varType -> pure name
          _ -> lift Nothing
        srcRegs <- compileRValues cc current rhs
        guard $ length srcRegs == length destNames
        zipWithM_ bindName destNames srcRegs
        charge 1
        pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" (CC.MemberAccess _ (CC.Variable _ rec) field) rhs))
    _ -> do
      dest <- lookupName (rec ++ "." ++ field)
      r <- compileExpr cc current rhs
      emit $ UMov dest r
      charge 1
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "+=" (CC.MemberAccess _ (CC.Variable _ rec) field) rhs))
    _ -> do
      dest <- lookupName (rec ++ "." ++ field)
      r <- compileExpr cc current rhs
      emit $ UAdd dest dest r
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "-=" (CC.MemberAccess _ (CC.Variable _ rec) field) rhs))
    _ -> do
      dest <- lookupName (rec ++ "." ++ field)
      r <- compileExpr cc current rhs
      emit $ USub dest dest r
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ op lhs rhs))
    _
      | Just bin <- assignBin op
      , CC.Variable _ name <- unwrapLHS lhs -> do
          dest <- lookupName name
          r <- compileExpr cc current rhs
          emit $ bin dest dest r
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" lhs rhs))
    _
      | CC.Variable _ name <- unwrapLHS lhs -> do
      s <- get
      case M.lookup name (csNames s) of
        Just dest -> do
          r <- compileExpr cc current rhs
          emit $ UMov dest r
          charge 1
          charge 1
          pure Nothing
        Nothing -> do
          r <- compileExpr cc current rhs
          emitSstore name r
          charge 1
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "+=" lhs rhs))
    _
      | CC.Variable _ name <- unwrapLHS lhs -> do
      s <- get
      case M.lookup name (csNames s) of
        Just dest -> do
          r <- compileExpr cc current rhs
          emit $ UAdd dest dest r
          charge 1
          pure Nothing
        Nothing -> do
          cur <- fresh
          emitSload cur name
          r <- compileExpr cc current rhs
          nxt <- fresh
          emit $ UAdd nxt cur r
          emitSstore name nxt
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "-=" lhs rhs))
    _
      | CC.Variable _ name <- unwrapLHS lhs -> do
      s <- get
      case M.lookup name (csNames s) of
        Just dest -> do
          r <- compileExpr cc current rhs
          emit $ USub dest dest r
          charge 1
          pure Nothing
        Nothing -> do
          cur <- fresh
          emitSload cur name
          r <- compileExpr cc current rhs
          nxt <- fresh
          emit $ USub nxt cur r
          emitSstore name nxt
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.FunctionCall _ (CC.Variable _ "require") requireArgs))
    _ -> do
      (condExpr, extra) <- case requireArgs of
        [c] -> pure (c, 0)
        -- The message is only for the revert path. IR only needs the
        -- condition; any second argument (string concat, custom error
        -- payload) is skipped so a passing require stays in IR.
        [c, _] -> pure (c, 1)
        _ -> lift Nothing
      r <- compileExpr cc current condExpr
      emitReq r
      charge $ 1 + extra + 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" (CC.IndexAccess _ (CC.IndexAccess _ (CC.Variable _ mapName) (Just k1e)) (Just k2e)) rhs))
    _ -> do
      (actual, callee) <- resolveMap mapName
      (ia1, ia2) <- lift $ nestedMapKeys cc current actual
      k1 <- compileExpr cc current k1e
      k2 <- compileExpr cc current k2e
      v <- compileExpr cc current rhs
      case callee of
        Nothing -> emit $ UMapSet2 actual k1 ia1 k2 v ia2
        Just cr -> emit $ UMapSet2At actual k1 ia1 k2 v ia2 cr
      charge 1
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" (CC.IndexAccess _ (CC.Variable _ mapName) (Just idx)) rhs))
    _ -> do
      isAddr <- lift $ mappingAddrKey cc current mapName
      k <- compileExpr cc current idx
      v <- compileExpr cc current rhs
      emitMapSet mapName k v isAddr
      charge 1
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "+=" (CC.IndexAccess _ (CC.Variable _ mapName) (Just idx)) rhs))
    _ -> do
      isAddr <- lift $ mappingAddrKey cc current mapName
      k <- compileExpr cc current idx
      cur <- fresh
      emitMapGet cur mapName k isAddr
      delta <- compileExpr cc current rhs
      nxt <- fresh
      emit $ UAdd nxt cur delta
      emitMapSet mapName k nxt isAddr
      charge 1
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "-=" (CC.IndexAccess _ (CC.Variable _ mapName) (Just idx)) rhs))
    _ -> do
      isAddr <- lift $ mappingAddrKey cc current mapName
      k <- compileExpr cc current idx
      cur <- fresh
      emitMapGet cur mapName k isAddr
      delta <- compileExpr cc current rhs
      nxt <- fresh
      emit $ USub nxt cur delta
      emitMapSet mapName k nxt isAddr
      charge 1
      charge 1
      pure Nothing
  CC.EmitStatement eventName exptups _ -> do
    rs <- forM exptups $ \(_, e) -> compileExpr cc current e
    emit $ UEmit eventName rs
    charge 1
    pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" (CC.TupleExpression _ dests) rhs))
    _ -> do
      srcRegs <- compileRValues cc current rhs
      destExprs <- forM dests $ \case
        Just e -> pure e
        Nothing -> do
          let !_ = logMiss "tuple-hole"
          lift Nothing
      guard $ length destExprs == length srcRegs
      zipWithM_ (assignTo cc current) destExprs srcRegs
      let n = fromIntegral (length destExprs)
      charge $ 1 + n + 1 + 1
      pure Nothing
  CC.SimpleStatement (CC.ExpressionStatement (CC.FunctionCall _ callee args)) _ ->
    case callee of
      CC.Variable _ "revert" -> do
        z <- fresh
        emit $ ULit z 0
        emitReq z
        charge 1
        pure Nothing
      _ -> do
        -- Void helpers (assertMatches, etc.) are statement calls, not values.
        _ <- compileCallValues cc current callee args
        pure Nothing
  CC.SimpleStatement (CC.ExpressionStatement expr) _ -> do
    _ <- compileExpr cc current expr
    pure Nothing
  CC.IfStatement condition thenStatements maybeElseStatements _ -> do
    c <- compileExpr cc current condition
    elseLbl <- freshPlaceholder
    endLbl <- freshPlaceholder
    emit $ UJmpZ c elseLbl
    s <- get
    case runStateT (compileStatements cc current ret thenStatements) s of
      Just (_, s') -> do
        put s'
        emit $ UJmp endLbl
        mark elseLbl
        _ <- compileStatements cc current ret (fromMaybe [] maybeElseStatements)
        mark endLbl
        charge 1
        pure Nothing
      Nothing -> case maybeElseStatements of
        -- if (x == 0) { unlowerable mint/burn } else { debit/credit }:
        -- keep the else so a normal transfer stays in IR.
        Just elseStmts -> do
          let !_ = logMiss "skip-then"
          mark elseLbl
          _ <- compileStatements cc current ret elseStmts
          mark endLbl
          charge 1
          pure Nothing
        Nothing -> do
          let !_ = logMiss "ufallback-if"
          emit UFallback
          mark elseLbl
          mark endLbl
          charge 1
          pure Nothing
  CC.WhileStatement cond body _ -> do
    headLbl <- freshPlaceholder
    endLbl <- freshPlaceholder
    mark headLbl
    c <- compileExpr cc current cond
    emit $ UJmpZ c endLbl
    _ <- compileStatements cc current ret body
    emit $ UJmp headLbl
    mark endLbl
    charge 1
    pure Nothing
  CC.ForStatement maybeInit maybeCond maybePost body annot -> do
    _ <- case maybeInit of
      Just initStmt -> compileStmt cc current ret (CC.SimpleStatement initStmt annot)
      Nothing -> pure Nothing
    headLbl <- freshPlaceholder
    endLbl <- freshPlaceholder
    mark headLbl
    case maybeCond of
      Just cond -> do
        c <- compileExpr cc current cond
        emit $ UJmpZ c endLbl
      Nothing -> pure ()
    _ <- compileStatements cc current ret body
    case maybePost of
      Just post -> do
        _ <- compileExpr cc current post
        pure ()
      Nothing -> pure ()
    emit $ UJmp headLbl
    mark endLbl
    pure Nothing
  CC.UncheckedStatement stmts _ -> compileStatements cc current ret stmts
  CC.Block _ -> pure Nothing
  CC.RevertStatement {} -> do
    z <- fresh
    emit $ ULit z 0
    emitReq z
    charge 1
    pure Nothing
  CC.Throw {} -> do
    z <- fresh
    emit $ ULit z 0
    emitReq z
    charge 1
    pure Nothing
  CC.TryCatchStatement tryBlock catchBlockMap _ -> do
    catchLbl <- freshPlaceholder
    endLbl <- freshPlaceholder
    old <- csCatch <$> get
    modify' $ \st -> st {csCatch = Just catchLbl}
    _ <- compileStatements cc current ret tryBlock
    modify' $ \st -> st {csCatch = old}
    emit $ UJmp endLbl
    mark catchLbl
    let catchStmts = concatMap snd (M.elems catchBlockMap)
    s <- get
    case runStateT (compileStatements cc current ret catchStmts) s of
      Just (_, s') -> put s'
      Nothing -> emit UFallback
    mark endLbl
    charge 1
    pure Nothing
  CC.ModifierExecutor _ -> lift Nothing
  stmt -> do
    let !_ = logMiss ("stmt " ++ take 220 (show stmt))
    lift Nothing

compileRValues :: CodeCollection -> Contract -> CC.Expression -> CM [Int]
compileRValues cc current = \case
  CC.TupleExpression _ srcs -> forM srcs $ \case
    Just e -> do
      r <- compileExpr cc current e
      tmp <- fresh
      emit $ UMov tmp r
      pure tmp
    Nothing -> lift Nothing
  CC.FunctionCall _ callee args -> compileCallValues cc current callee args
  expr -> (: []) <$> compileExpr cc current expr

mergeCharges :: [UOp] -> [UOp]
mergeCharges [] = []
mergeCharges (UCharge a : UCharge b : rest) = mergeCharges (UCharge (a + b) : rest)
mergeCharges (op : rest) = op : mergeCharges rest

finalize :: CState -> Maybe (V.Vector UOp, Int)
finalize s = do
  let raw = mergeCharges (reverse (csCode s))
      step (pc, acc, accLabs) op = case op of
        ULabel n -> (pc, acc, M.insert n pc accLabs)
        _ -> (pc + 1, op : acc, accLabs)
      (_, revKept, labs) = foldl step (0, [], M.empty) raw
      kept = reverse revKept
      patch (UJmpZ r n) | n < 0 = UJmpZ r <$> M.lookup n labs
      patch (UJmp n) | n < 0 = UJmp <$> M.lookup n labs
      patch (UReqJ r n) | n < 0 = UReqJ r <$> M.lookup n labs
      patch (ULabel _) = Nothing
      patch op = Just op
  patched <- traverse patch kept
  pure (V.fromList patched, csNext s)

initialState :: Bool -> Bool -> Int -> CState
initialState inlining retJump depth =
  CState M.empty 0 [] depth Nothing Nothing M.empty M.empty Nothing inlining retJump

bindArgs :: [(Maybe SolidString, CC.IndexedType)] -> CM [Int]
bindArgs [] = pure []
bindArgs ((Just name, CC.IndexedType _ ty _) : rest)
  | uintishType ty = do
      r <- fresh
      bindTyped name ty r
      (r :) <$> bindArgs rest
bindArgs _ = do
  let !_ = logMiss "bindArgs"
  lift Nothing

compileAnyFunc :: CodeCollection -> Contract -> Func -> Maybe (V.Vector UOp, Int, [Int], [Int])
compileAnyFunc cc contract func = compileAnyFuncWith False False cc contract func

compileAnyFuncWith :: Bool -> Bool -> CodeCollection -> Contract -> Func -> Maybe (V.Vector UOp, Int, [Int], [Int])
compileAnyFuncWith inlining retJump cc contract func =
  let compiled = do
        guard $ not (CC._funcIsFree func)
        commands0 <- CC._funcContents func
        commands <- case applyModifiers cc contract func commands0 of
          Nothing ->
            let !_ = logMiss ("modifiers " ++ labelToString (contract ^. CC.contractName))
             in Nothing
          Just c -> Just c
        evalStateT (go commands) (initialState inlining retJump 0)
   in case compiled of
        Nothing ->
          let !_ =
                logMiss
                  ( "nolower "
                      ++ labelToString (contract ^. CC.contractName)
                      ++ " a="
                      ++ show (length (CC._funcArgs func))
                      ++ " s="
                      ++ show (maybe 0 length (CC._funcContents func))
                  )
           in Nothing
        Just x@(ops, _, _, _) ->
          let !_ =
                logMiss
                  ( "lowered "
                      ++ labelToString (contract ^. CC.contractName)
                      ++ " fb="
                      ++ show (V.length $ V.filter (== UFallback) ops)
                      ++ " n="
                      ++ show (V.length ops)
                  )
           in Just x
  where
    go commands = do
      argRegs <- bindArgs (CC._funcArgs func)
      let retNames = fromMaybe [] (namedUintReturns func)
      useRetJump <- csRetJump <$> get
      if useRetJump
        then do
          destRegs <- case retNames of
            _ : _ -> mapM (\n -> fresh >>= \r -> bindName n r >> pure r) retNames
            []
              | null (CC._funcVals func) -> pure []
              | otherwise -> (: []) <$> fresh
          endLbl <- freshPlaceholder
          -- Isolated helpers: a `return` in the body must not skip modifier
          -- postfix after `_` (lock/whenOpen unlock).
          mret <- compileStatements cc contract (RetJump endLbl destRegs) commands
          mark endLbl
          retRegs <- case retNames of
            _ : _ -> mapM lookupName retNames
            []
              | null (CC._funcVals func) -> pure []
              | otherwise -> case destRegs of
                  [d] -> do
                    case mret of
                      Just r | r /= d -> emit $ UMov d r
                      _ -> pure ()
                    pure [d]
                  _ -> lift Nothing
          emit $ URet retRegs
          s <- get
          (ops, nregs) <- case finalize s of
            Nothing -> do
              let !_ = logMiss "finalize"
              lift Nothing
            Just x -> pure x
          pure (ops, nregs, argRegs, retRegs)
        else do
          mapM_ (\n -> fresh >>= bindName n) retNames
          mret <- compileStatements cc contract RetHalt commands
          retRegs <- case retNames of
            _ : _ -> do
              rs <- mapM lookupName retNames
              emit $ URet rs
              pure rs
            []
              | null (CC._funcVals func) -> do
                  emit $ URet []
                  pure []
              | otherwise -> do
                  ret <- lift mret
                  emit $ URet [ret]
                  pure [ret]
          s <- get
          (ops, nregs) <- case finalize s of
            Nothing -> do
              let !_ = logMiss "finalize"
              lift Nothing
            Just x -> pure x
          pure (ops, nregs, argRegs, retRegs)

runOps :: V.Vector UOp -> Int -> [Int] -> [Integer] -> [Int] -> Maybe ([Integer], Integer)
runOps ops nregs argRegs argVals _retRegs = runST $ do
  regs <- MV.replicate nregs (0 :: Integer)
  zipWithM_ (MV.write regs) argRegs argVals
  let end = V.length ops
      go !pc !gas
        | pc >= end = pure Nothing
        | otherwise = case ops V.! pc of
            URet rs -> do
              vs <- mapM (MV.read regs) rs
              pure $ Just (vs, toInteger gas)
            ULit d k -> MV.write regs d k >> go (pc + 1) gas
            UMov d a -> MV.read regs a >>= MV.write regs d >> go (pc + 1) gas
            UAdd d a b -> bin d a b (+) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            USub d a b -> bin d a b (-) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            UMul d a b -> bin d a b (*) ((+) `on` byteWidth) (pc + 1) gas
            UDiv d a b -> do
              x <- MV.read regs a
              y <- MV.read regs b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs d (x `div` y)
                  go (pc + 1) (gas + gasForOp (byteWidth x) + gasForOp (byteWidth y))
            UMod d a b -> do
              x <- MV.read regs a
              y <- MV.read regs b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs d (x `rem` y)
                  go (pc + 1) (gas + gasForOp (byteWidth y))
            UShl d a b -> bin d a b (\x i -> x `shift` fromInteger i) (\a0 _ -> byteWidth a0 + 32) (pc + 1) gas
            UShr d a b -> bin d a b (\x i -> x `shiftR` fromInteger i) (\a0 _ -> byteWidth a0) (pc + 1) gas
            UAndB d a b -> bin d a b (.&.) (max `on` byteWidth) (pc + 1) gas
            UOrB d a b -> bin d a b (.|.) (max `on` byteWidth) (pc + 1) gas
            UXor d a b -> bin d a b xor (max `on` byteWidth) (pc + 1) gas
            UNot d a -> do
              x <- MV.read regs a
              MV.write regs d (if x == 0 then 1 else 0)
              go (pc + 1) gas
            ULt d a b -> cmp d a b (<) (pc + 1) gas
            UGt d a b -> cmp d a b (>) (pc + 1) gas
            ULe d a b -> cmp d a b (<=) (pc + 1) gas
            UGe d a b -> cmp d a b (>=) (pc + 1) gas
            UEq d a b -> cmp d a b (==) (pc + 1) gas
            UNeq d a b -> cmp d a b (/=) (pc + 1) gas
            UJmp t -> go t gas
            UJmpZ c t -> do
              x <- MV.read regs c
              go (if x == 0 then t else pc + 1) gas
            UReq c -> do
              x <- MV.read regs c
              if x == 0 then pure Nothing else go (pc + 1) gas
            UReqJ c t -> do
              x <- MV.read regs c
              go (if x == 0 then t else pc + 1) gas
            UCharge n -> go (pc + 1) (gas + fromIntegral n)
            ULabel _ -> go (pc + 1) gas
            UCallPure cops cnregs cargRegs srcRegs dests -> do
              callArgs <- mapM (MV.read regs) srcRegs
              case runOps cops cnregs cargRegs callArgs dests of
                Nothing -> pure Nothing
                Just (vs, cost) -> do
                  zipWithM_ (MV.write regs) dests vs
                  go (pc + 1) (gas + fromIntegral cost)
            UCallStorage {} -> pure Nothing
            USender {} -> pure Nothing
            UThis {} -> pure Nothing
            UMapGet {} -> pure Nothing
            UMapSet {} -> pure Nothing
            UMapGetAt {} -> pure Nothing
            UMapSetAt {} -> pure Nothing
            UMapGet2 {} -> pure Nothing
            UMapSet2 {} -> pure Nothing
            UMapGet2At {} -> pure Nothing
            UMapSet2At {} -> pure Nothing
            USloadAddr {} -> pure Nothing
            USloadAt {} -> pure Nothing
            USstore {} -> pure Nothing
            USstoreAt {} -> pure Nothing
            UEmit {} -> pure Nothing
            UTimestamp {} -> pure Nothing
            UNumber {} -> pure Nothing
            UFallback ->
              let !_ = logMiss "run-fallback-st"
               in pure Nothing
      bin d a b f gasF npc g0 = do
        x <- MV.read regs a
        y <- MV.read regs b
        let !z = f x y
        MV.write regs d z
        go npc (g0 + gasForOp (gasF x y))
      cmp d a b f npc g0 = do
        x <- MV.read regs a
        y <- MV.read regs b
        MV.write regs d (if f x y then 1 else 0)
        go npc g0
  go 0 (0 :: Int)

type Compiled = (V.Vector UOp, Int, [Int], [Int])

data CacheEntry = CacheEntry !(StableName CodeCollection) !(M.Map String (Maybe Compiled))

{-# NOINLINE compiledCache #-}
compiledCache :: IORef [CacheEntry]
compiledCache = unsafePerformIO $ newIORef []

{-# NOINLINE compilingKeys #-}
compilingKeys :: IORef [String]
compilingKeys = unsafePerformIO $ newIORef []

-- Isolate cache is lookup/store only. Compiling the helper is pure
-- (compileIsolated) so it cannot nest unsafePerformIO inside cachedCompile.
{-# NOINLINE isolateCache #-}
isolateCache :: IORef [CacheEntry]
isolateCache = unsafePerformIO $ newIORef []

funcCacheKey :: Contract -> Func -> String
funcCacheKey contract func =
  show
    ( labelToString (contract ^. CC.contractName),
      CC._funcContext func,
      length (CC._funcArgs func),
      maybe 0 length (CC._funcContents func)
    )

isolateLookup :: CodeCollection -> Contract -> Func -> Maybe (Maybe Compiled)
isolateLookup cc contract func = unsafePerformIO $ do
  snCC <- makeStableName $! cc
  let k = funcCacheKey contract func
  cache <- readIORef isolateCache
  let lookupCC [] = Nothing
      lookupCC (CacheEntry sn m : rest)
        | eqStableName sn snCC = Just m
        | otherwise = lookupCC rest
  pure (lookupCC cache >>= M.lookup k)
{-# NOINLINE isolateLookup #-}

isolateStore :: CodeCollection -> Contract -> Func -> Maybe Compiled -> ()
isolateStore cc contract func compiled = unsafePerformIO $ do
  snCC <- makeStableName $! cc
  let k = funcCacheKey contract func
  cache <- readIORef isolateCache
  let lookupCC [] = Nothing
      lookupCC (CacheEntry sn m : rest)
        | eqStableName sn snCC = Just m
        | otherwise = lookupCC rest
  case lookupCC cache of
    Just m ->
      writeIORef isolateCache $
        CacheEntry snCC (M.insert k compiled m)
          : [e | e@(CacheEntry sn _) <- cache, not (eqStableName sn snCC)]
    Nothing ->
      writeIORef isolateCache (CacheEntry snCC (M.singleton k compiled) : cache)
  pure ()
{-# NOINLINE isolateStore #-}

{-# NOINLINE isolateCompiling #-}
isolateCompiling :: IORef [String]
isolateCompiling = unsafePerformIO $ newIORef []

-- Cache miss compiles purely via compileAnyFunc (nested calls become
-- UCallPure/UCallStorage). Never calls cachedCompile.
isolateCached :: CodeCollection -> Contract -> Func -> Maybe Compiled
isolateCached cc contract func =
  case isolateLookup cc contract func of
    Just cached -> cached
    Nothing ->
      let k = funcCacheKey contract func
          busy = unsafePerformIO $ (k `elem`) <$> readIORef isolateCompiling
       in if busy
            then Nothing
            else
              let !_ = unsafePerformIO $ modifyIORef' isolateCompiling (k :)
               in case compileAnyFuncWith False True cc contract func of
                    compiled ->
                      let !_ = unsafePerformIO $ modifyIORef' isolateCompiling (filter (/= k))
                          !_ = isolateStore cc contract func compiled
                       in compiled

cachedCompile :: CodeCollection -> Contract -> Func -> Maybe Compiled
cachedCompile cc contract func = unsafePerformIO $ do
  snCC <- makeStableName $! cc
  let k =
        show
          ( CC._funcContext func,
            length (CC._funcArgs func),
            maybe 0 length (CC._funcContents func)
          )
  compiling <- readIORef compilingKeys
  if k `elem` compiling
    then pure Nothing
    else do
      cache <- readIORef compiledCache
      let lookupCC [] = Nothing
          lookupCC (CacheEntry sn m : rest)
            | eqStableName sn snCC = Just m
            | otherwise = lookupCC rest
          store compiled = case lookupCC cache of
            Just m ->
              writeIORef compiledCache $
                CacheEntry snCC (M.insert k compiled m)
                  : [e | e@(CacheEntry sn _) <- cache, not (eqStableName sn snCC)]
            Nothing ->
              writeIORef compiledCache (CacheEntry snCC (M.singleton k compiled) : cache)
      case lookupCC cache >>= M.lookup k of
        Just compiled -> pure compiled
        Nothing -> do
          modifyIORef' compilingKeys (k :)
          let compiled = compileAnyFunc cc contract func
          modifyIORef' compilingKeys (filter (/= k))
          store compiled
          pure compiled

funcLowers :: CodeCollection -> Contract -> Func -> Bool
funcLowers cc contract func = isJust (compileAnyFunc cc contract func)

funcFallbackCount :: CodeCollection -> Contract -> Func -> Int
funcFallbackCount cc contract func =
  case compileAnyFunc cc contract func of
    Just (ops, _, _, _) -> V.length $ V.filter (== UFallback) ops
    Nothing -> -1

needsStorage :: V.Vector UOp -> Bool
needsStorage = V.any $ \case
  USender {} -> True
  UThis {} -> True
  UMapGet {} -> True
  UMapSet {} -> True
  UMapGetAt {} -> True
  UMapSetAt {} -> True
  UMapGet2 {} -> True
  UMapSet2 {} -> True
  UMapGet2At {} -> True
  UMapSet2At {} -> True
  USloadAddr {} -> True
  USloadAt {} -> True
  USstore {} -> True
  USstoreAt {} -> True
  UEmit {} -> True
  UTimestamp {} -> True
  UNumber {} -> True
  UFallback -> True
  UCallStorage {} -> True
  _ -> False

runAnyUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runAnyUIntIR cc contract func args = do
  (ops, nregs, argRegs, retRegs) <- cachedCompile cc contract func
  guard $ length argRegs == length args
  guard $ not (needsStorage ops)
  runOps ops nregs argRegs args retRegs

data StorageHooks m = StorageHooks
  { shSender :: m Integer,
    shMapGet :: SolidString -> Integer -> Bool -> m Integer,
    shMapSet :: SolidString -> Integer -> Integer -> Bool -> m (),
    shMapGetAt :: Integer -> SolidString -> Integer -> Bool -> m Integer,
    shMapSetAt :: Integer -> SolidString -> Integer -> Integer -> Bool -> m (),
    shMapGet2At :: Integer -> SolidString -> Integer -> Bool -> Integer -> Bool -> m Integer,
    shMapSet2At :: Integer -> SolidString -> Integer -> Bool -> Integer -> Integer -> Bool -> m (),
    shSloadAddr :: SolidString -> m Integer,
    shSloadAt :: Integer -> SolidString -> m Integer,
    shSstore :: SolidString -> Integer -> m (),
    shSstoreAt :: Integer -> SolidString -> Integer -> m (),
    shThis :: m Integer,
    shTimestamp :: m Integer,
    shNumber :: m Integer,
    shEmit :: String -> [Integer] -> m (),
    shEmitMany :: [(String, [Integer])] -> m ()
  }

type ScalarK = (Integer, SolidString)

type MapK = (Integer, SolidString, Integer)

type Map2K = (Integer, SolidString, Integer, Integer)

runAnyStorageIR ::
  MonadUnliftIO m =>
  StorageHooks m ->
  CodeCollection ->
  Contract ->
  Func ->
  [Integer] ->
  m (Maybe ([Integer], Integer))
runAnyStorageIR hooks cc contract func args =
  case cachedCompile cc contract func of
    Just (ops, nregs, argRegs, retRegs)
      | length argRegs == length args
      , needsStorage ops ->
          runOpsM hooks ops nregs argRegs args retRegs
    Just (_, _, argRegs, _) ->
      let !_ =
            logMiss
              ( "run-skip args="
                  ++ show (length args)
                  ++ " regs="
                  ++ show (length argRegs)
                  ++ " "
                  ++ labelToString (contract ^. CC.contractName)
              )
       in pure Nothing
    Nothing -> pure Nothing

runOpsM ::
  MonadUnliftIO m =>
  StorageHooks m ->
  V.Vector UOp ->
  Int ->
  [Int] ->
  [Integer] ->
  [Int] ->
  m (Maybe ([Integer], Integer))
runOpsM hooks ops nregs argRegs argVals _retRegs = withRunInIO $ \run ->
  let io = unsafeIOToST . run
   in pure $
        runST $ do
  -- Don't touch the SM stack until an op needs it. Eager shSender blows up
  -- when the call frame is empty (--svmDev tests).
  senderRef <- newSTRef (Nothing :: Maybe Integer)
  thisRef <- newSTRef (Nothing :: Maybe Integer)
  tsRef <- newSTRef (Nothing :: Maybe Integer)
  numRef <- newSTRef (Nothing :: Maybe Integer)
  let getSender = do
        m <- readSTRef senderRef
        case m of
          Just s -> pure s
          Nothing -> do
            s <- io (shSender hooks)
            writeSTRef senderRef (Just s)
            pure s
      getThis = do
        m <- readSTRef thisRef
        case m of
          Just s -> pure s
          Nothing -> do
            s <- io (shThis hooks)
            writeSTRef thisRef (Just s)
            pure s
      getTimestamp = do
        m <- readSTRef tsRef
        case m of
          Just s -> pure s
          Nothing -> do
            s <- io (shTimestamp hooks)
            writeSTRef tsRef (Just s)
            pure s
      getNumber = do
        m <- readSTRef numRef
        case m of
          Just s -> pure s
          Nothing -> do
            s <- io (shNumber hooks)
            writeSTRef numRef (Just s)
            pure s
  regs <- MV.replicate nregs (0 :: Integer)
  zipWithM_ (MV.write regs) argRegs argVals
  cache <- newSTRef (M.empty :: M.Map MapK Integer)
  dirty <- newSTRef (M.empty :: M.Map MapK (Integer, Bool))
  cache2 <- newSTRef (M.empty :: M.Map Map2K Integer)
  dirty2 <- newSTRef (M.empty :: M.Map Map2K (Integer, Bool, Bool))
  sload <- newSTRef (M.empty :: M.Map ScalarK Integer)
  sdirty <- newSTRef (M.empty :: M.Map ScalarK Integer)
  evs <- newSTRef ([] :: [(String, [Integer])])
  let getMap addr name key isAddr = do
        c <- readSTRef cache
        case M.lookup (addr, name, key) c of
          Just v -> pure v
          Nothing -> do
            v <- io $ shMapGetAt hooks addr name key isAddr
            modifySTRef' cache (M.insert (addr, name, key) v)
            pure v
      setMap addr name key val isAddr = do
        modifySTRef' cache (M.insert (addr, name, key) val)
        modifySTRef' dirty (M.insert (addr, name, key) (val, isAddr))
      getMap2 addr name k1 ia1 k2 ia2 = do
        c <- readSTRef cache2
        case M.lookup (addr, name, k1, k2) c of
          Just v -> pure v
          Nothing -> do
            v <- io $ shMapGet2At hooks addr name k1 ia1 k2 ia2
            modifySTRef' cache2 (M.insert (addr, name, k1, k2) v)
            pure v
      setMap2 addr name k1 ia1 k2 val ia2 = do
        modifySTRef' cache2 (M.insert (addr, name, k1, k2) val)
        modifySTRef' dirty2 (M.insert (addr, name, k1, k2) (val, ia1, ia2))
      getSload addr field = do
        c <- readSTRef sload
        case M.lookup (addr, field) c of
          Just v -> pure v
          Nothing -> do
            v <- io $ shSloadAt hooks addr field
            modifySTRef' sload (M.insert (addr, field) v)
            pure v
      setSload addr field val = do
        modifySTRef' sload (M.insert (addr, field) val)
        modifySTRef' sdirty (M.insert (addr, field) val)
      execGo regs' ops' !pc !gas
        | pc >= V.length ops' =
            let !_ = logMiss ("run-end n=" ++ show (V.length ops'))
             in pure Nothing
        | otherwise = case ops' V.! pc of
            URet rs -> do
              vs <- mapM (MV.read regs') rs
              let !_ = logMiss ("run-ret n=" ++ show (length vs) ++ " gas=" ++ show gas)
              pure $ Just (vs, toInteger gas)
            ULit d k -> MV.write regs' d k >> execGo regs' ops' (pc + 1) gas
            UMov d a -> (MV.read regs' a >>= MV.write regs' d) >> execGo regs' ops' (pc + 1) gas
            UAdd d a b -> bin d a b (+) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            USub d a b -> bin d a b (-) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            UMul d a b -> bin d a b (*) ((+) `on` byteWidth) (pc + 1) gas
            UDiv d a b -> do
              x <- MV.read regs' a
              y <- MV.read regs' b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs' d (x `div` y)
                  execGo regs' ops' (pc + 1) (gas + gasForOp (byteWidth x) + gasForOp (byteWidth y))
            UMod d a b -> do
              x <- MV.read regs' a
              y <- MV.read regs' b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs' d (x `rem` y)
                  execGo regs' ops' (pc + 1) (gas + gasForOp (byteWidth y))
            UShl d a b -> bin d a b (\x i -> x `shift` fromInteger i) (\a0 _ -> byteWidth a0 + 32) (pc + 1) gas
            UShr d a b -> bin d a b (\x i -> x `shiftR` fromInteger i) (\a0 _ -> byteWidth a0) (pc + 1) gas
            UAndB d a b -> bin d a b (.&.) (max `on` byteWidth) (pc + 1) gas
            UOrB d a b -> bin d a b (.|.) (max `on` byteWidth) (pc + 1) gas
            UXor d a b -> bin d a b xor (max `on` byteWidth) (pc + 1) gas
            UNot d a -> do
              x <- MV.read regs' a
              MV.write regs' d (if x == 0 then 1 else 0)
              execGo regs' ops' (pc + 1) gas
            ULt d a b -> cmp d a b (<) (pc + 1) gas
            UGt d a b -> cmp d a b (>) (pc + 1) gas
            ULe d a b -> cmp d a b (<=) (pc + 1) gas
            UGe d a b -> cmp d a b (>=) (pc + 1) gas
            UEq d a b -> cmp d a b (==) (pc + 1) gas
            UNeq d a b -> cmp d a b (/=) (pc + 1) gas
            UJmp t -> execGo regs' ops' t gas
            UJmpZ c t -> do
              x <- MV.read regs' c
              execGo regs' ops' (if x == 0 then t else pc + 1) gas
            UReq c -> do
              x <- MV.read regs' c
              if x == 0
                then do
                  let !_ =
                        logMiss
                          ( "run-req pc="
                              ++ show pc
                              ++ " "
                              ++ take 120 (show (ops' V.! pc))
                              ++ " prev="
                              ++ take 80 (show (ops' V.! max 0 (pc - 1)))
                          )
                  pure Nothing
                else execGo regs' ops' (pc + 1) gas
            UReqJ c t -> do
              x <- MV.read regs' c
              execGo regs' ops' (if x == 0 then t else pc + 1) gas
            UCharge n -> execGo regs' ops' (pc + 1) (gas + fromIntegral n)
            ULabel _ -> execGo regs' ops' (pc + 1) gas
            UCallPure cops cnregs cargRegs srcRegs dests -> do
              callArgs <- mapM (MV.read regs') srcRegs
              case runOps cops cnregs cargRegs callArgs dests of
                Nothing -> pure Nothing
                Just (vs, cost) -> do
                  zipWithM_ (MV.write regs') dests vs
                  execGo regs' ops' (pc + 1) (gas + fromIntegral cost)
            UCallStorage cops cnregs cargRegs srcRegs dests mCallee -> do
              callArgs <- mapM (MV.read regs') srcRegs
              nested <- MV.replicate cnregs (0 :: Integer)
              zipWithM_ (MV.write nested) cargRegs callArgs
              oldThis <- readSTRef thisRef
              oldSender <- readSTRef senderRef
              callerThis <- case oldThis of
                Just t -> pure t
                Nothing -> getThis
              case mCallee of
                Just cr -> do
                  callee <- MV.read regs' cr
                  writeSTRef thisRef (Just callee)
                  writeSTRef senderRef (Just callerThis)
                Nothing -> pure ()
              nestedResult <- execGo nested cops 0 0
              writeSTRef thisRef oldThis
              writeSTRef senderRef oldSender
              case nestedResult of
                Nothing -> pure Nothing
                Just (vs, cost) -> do
                  zipWithM_ (MV.write regs') dests vs
                  execGo regs' ops' (pc + 1) (gas + fromIntegral cost)
            USender d -> do
              s <- getSender
              MV.write regs' d s
              execGo regs' ops' (pc + 1) gas
            UThis d -> do
              s <- getThis
              MV.write regs' d s
              execGo regs' ops' (pc + 1) gas
            UMapGet d mapName k isAddr -> do
              key <- MV.read regs' k
              this <- getThis
              v <- getMap this mapName key isAddr
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapSet mapName k v isAddr -> do
              key <- MV.read regs' k
              val <- MV.read regs' v
              this <- getThis
              setMap this mapName key val isAddr
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapGetAt d mapName k isAddr cr -> do
              key <- MV.read regs' k
              callee <- MV.read regs' cr
              v <- getMap callee mapName key isAddr
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapSetAt mapName k v isAddr cr -> do
              key <- MV.read regs' k
              val <- MV.read regs' v
              callee <- MV.read regs' cr
              setMap callee mapName key val isAddr
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapGet2 d mapName k1 ia1 k2 ia2 -> do
              a <- MV.read regs' k1
              b <- MV.read regs' k2
              this <- getThis
              v <- getMap2 this mapName a ia1 b ia2
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapSet2 mapName k1 ia1 k2 v ia2 -> do
              a <- MV.read regs' k1
              b <- MV.read regs' k2
              val <- MV.read regs' v
              this <- getThis
              setMap2 this mapName a ia1 b val ia2
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapGet2At d mapName k1 ia1 k2 ia2 cr -> do
              a <- MV.read regs' k1
              b <- MV.read regs' k2
              callee <- MV.read regs' cr
              v <- getMap2 callee mapName a ia1 b ia2
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            UMapSet2At mapName k1 ia1 k2 v ia2 cr -> do
              a <- MV.read regs' k1
              b <- MV.read regs' k2
              val <- MV.read regs' v
              callee <- MV.read regs' cr
              setMap2 callee mapName a ia1 b val ia2
              execGo regs' ops' (pc + 1) (gas + 1)
            USloadAddr d field -> do
              this <- getThis
              v <- getSload this field
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            USloadAt d field cr -> do
              callee <- MV.read regs' cr
              v <- getSload callee field
              MV.write regs' d v
              execGo regs' ops' (pc + 1) (gas + 1)
            USstore field v -> do
              val <- MV.read regs' v
              this <- getThis
              setSload this field val
              execGo regs' ops' (pc + 1) (gas + 1)
            USstoreAt field v cr -> do
              val <- MV.read regs' v
              callee <- MV.read regs' cr
              setSload callee field val
              execGo regs' ops' (pc + 1) (gas + 1)
            UEmit name rs -> do
              vs <- mapM (MV.read regs') rs
              modifySTRef' evs ((name, vs) :)
              execGo regs' ops' (pc + 1) (gas + 1)
            UTimestamp d -> do
              s <- getTimestamp
              MV.write regs' d s
              execGo regs' ops' (pc + 1) gas
            UNumber d -> do
              s <- getNumber
              MV.write regs' d s
              execGo regs' ops' (pc + 1) gas
            UFallback -> do
              let !_ = logMiss "run-fallback"
              pure Nothing
        where
          bin d a b f _ npc g0 = do
            x <- MV.read regs' a
            y <- MV.read regs' b
            let !z = f x y
            MV.write regs' d z
            execGo regs' ops' npc (g0 + 1)
          cmp d a b f npc g0 = do
            x <- MV.read regs' a
            y <- MV.read regs' b
            MV.write regs' d (if f x y then 1 else 0)
            execGo regs' ops' npc g0
  result <- execGo regs ops 0 (0 :: Int)
  case result of
    Nothing -> pure Nothing
    Just (vs, cost) -> do
      d <- readSTRef dirty
      forM_ (M.toList d) $ \((addr, name, key), (val, isAddr)) ->
        io $ shMapSetAt hooks addr name key val isAddr
      d2 <- readSTRef dirty2
      forM_ (M.toList d2) $ \((addr, name, k1, k2), (val, ia1, ia2)) ->
        io $ shMapSet2At hooks addr name k1 ia1 k2 val ia2
      sd <- readSTRef sdirty
      forM_ (M.toList sd) $ \((addr, field), val) ->
        io $ shSstoreAt hooks addr field val
      buffered <- reverse <$> readSTRef evs
      unless (null buffered) $ io $ shEmitMany hooks buffered
      pure $ Just (vs, cost)

runNamedUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runNamedUIntIR = runAnyUIntIR

runScalarUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runScalarUIntIR = runAnyUIntIR
