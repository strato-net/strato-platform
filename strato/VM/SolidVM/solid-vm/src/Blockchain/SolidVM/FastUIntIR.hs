{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
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
    DynamicCallKind (..),
    HostArgKind (..),
    ScalarStorageEncoding (..),
    FastValue (..),
    PendingStorageWrite (..),
    StoragePathPiece (..),
    runAnyStorageIR,
    runAnyStorageIRArgs,
    funcLowers,
    funcFallbackCount,
    fastIRCacheEntryCounts,
    noteIRDecision,
  )
where

import Control.Applicative ((<|>))
import Control.DeepSeq (NFData, force)
import Control.Exception (evaluate, finally)
import Control.Lens ((^.))
import Control.Monad (foldM, forM, forM_, guard, unless, when, zipWithM, zipWithM_)
import Data.List (elemIndex, find)
import Control.Monad.ST (runST)
import Control.Monad.ST.Unsafe (unsafeIOToST)
import Data.STRef (modifySTRef', newSTRef, readSTRef, writeSTRef)
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.State.Strict (StateT, evalStateT, get, modify', put, runStateT, state)
import Data.Bits (shift, shiftR, xor, (.&.), (.|.))
import Data.Decimal (decimalMantissa, decimalPlaces, roundTo, roundTo')
import Data.Function (on)
import Data.IORef (IORef, modifyIORef', newIORef, readIORef, writeIORef)
import GHC.Generics (Generic)

import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromMaybe, isJust, isNothing, listToMaybe, mapMaybe)
import qualified Data.Set as Set

import qualified Data.Vector as V
import qualified Data.Vector.Mutable as MV
import SolidVM.Model.CodeCollection (CodeCollection, Contract, Func)
import qualified SolidVM.Model.CodeCollection as CC
import qualified SolidVM.Model.CodeCollection.VariableDecl as VD
import SolidVM.Model.SolidString (SolidString, labelToString)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..))
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)
import System.Mem.StableName (StableName, eqStableName, makeStableName)
import UnliftIO (MonadUnliftIO, withRunInIO)

logMiss :: String -> ()
logMiss msg =
  unsafePerformIO $ do
    case irMissPath of
      Just path | not (null path) -> appendFile path (msg ++ "\n")
      _ -> pure ()

{-# NOINLINE irMissPath #-}
irMissPath :: Maybe FilePath
irMissPath = unsafePerformIO $ lookupEnv "SOLIDVM_IR_MISS"

noteIRDecision :: String -> ()
noteIRDecision = logMiss

data UOp
  = ULit !Int !Integer
  | UMov !Int !Int
  | UAdd !Int !Int !Int
  | USub !Int !Int !Int
  | UMul !Int !Int !Int
  | UExp !Int !Int !Int
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
  | UReqNonNegative !Int
  | UReqNonNegativeJ !Int !Int
  | UCharge !Integer
  | URet ![Int]
  | USender !Int
  | UThis !Int
  | UMapGet !Int !SolidString !Int !Bool
  | UMapSet !SolidString !Int !Int !Bool !ScalarStorageEncoding
  | UMapGetAt !Int !SolidString !Int !Bool !Int
  | UMapSetAt !SolidString !Int !Int !Bool !ScalarStorageEncoding !Int
  | UMapGet2 !Int !SolidString !Int !Bool !Int !Bool
  | UMapSet2 !SolidString !Int !Bool !Int !Int !Bool
  | UMapGet2At !Int !SolidString !Int !Bool !Int !Bool !Int
  | UMapSet2At !SolidString !Int !Bool !Int !Int !Bool !Int
  | USloadAddr !Int !SolidString
  | USloadAt !Int !SolidString !Int
  | UEventSload !Int !SolidString !(Maybe Int)
  | USstore !SolidString !Int
  | USstoreAt !SolidString !Int !Int
  | UArrayNew !Int !Int
  | UArrayMov !Int !Int
  | UArrayPush !Int !Int !Int
  | UArrayLoadStorage !Int !SolidString
  | UArrayStoreStorage !SolidString !Int
  | UArrayLen !Int !Int
  | UArrayGet !Int !Int !Int
  | UArraySet !Int !Int !Int
  | UObjectLit !Int !Value
  | UObjectMov !Int !Int
  | UDecimalTruncate !Int !Int !Int
  | UDecimalDiv !Int !Int !Int
  | UObjectEq !Int !Int !Int
  | UObjectSstore !SolidString !Int
  | UObjectSstoreAt !SolidString !Int !Int
  | UDynamicCall !Int !DynamicCallKind !Int !Int ![(Int, HostArgKind)] !(Maybe Int)
  | UHostBuiltin !Int !String ![(Int, HostArgKind)]
  | UHostTupleBuiltin ![Int] !String ![(Int, HostArgKind)]
  | UPathGet !Int !SolidString ![PathStep]
  | UPathGetAt !Int !SolidString ![PathStep] !Int
  | UPathSet !SolidString ![PathStep] !Int
  | UPathSetAt !SolidString ![PathStep] !Int !Int
  | UPathDelete !SolidString ![PathStep]
  | UPathDeleteAt !SolidString ![PathStep] !Int
  | UEmit !String ![Int]
  | UTimestamp !Int
  | UNumber !Int
  | UFallback
  | -- Isolated pure helper: compiled once, then invoked from ST without
    -- walking the caller's op stream.
    UCallPure !(V.Vector UOp) !Int ![Int] ![Int] ![Int] ![Int]
  | -- Isolated storage helper: nested runOpsM shares the caller's storage
    -- caches so a loop of external calls does not re-sload every trip.
    UCallStorage !(V.Vector UOp) !Int ![Int] ![Int] ![Int] !(Maybe Int)
  deriving (Eq, Show, Generic, NFData)

data PathStep
  = PField !SolidString
  | PIndex !Int !Bool
  | PObjectIndex !Int
  deriving (Eq, Show, Generic, NFData)

data HostArgKind
  = HostInteger
  | HostAddress
  | HostBool
  | HostOpaque
  deriving (Eq, Show, Generic, NFData)

data DynamicCallKind
  = CallDefault
  | CallRaw
  | CallDelegate
  deriving (Eq, Show, Generic, NFData)

-- The authoritative evaluator preserves the runtime address/contract shape
-- of mapping assignment RHS values. Most writes use the mapping's declared
-- value type, but an implicit address-to-contract assignment remains an
-- address unless Solidity source explicitly casts it to the contract type.
data ScalarStorageEncoding
  = EncodeDeclared
  | EncodeAddress
  deriving (Eq, Show, Generic, NFData)

data StorageRef = StorageRef
  { srRoot :: !SolidString,
    srSteps :: ![PathStep],
    srCallee :: !(Maybe Int)
  }

data CState = CState
  { csNames :: !(M.Map SolidString Int),
    csArrays :: !(M.Map SolidString Int),
    csNextArray :: !Int,
    csObjects :: !(M.Map SolidString Int),
    csNextObject :: !Int,
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
    -- Storage aliases such as `OracleState storage state = oracleState[asset]`.
    -- Dynamic indexes remain register references until execution.
    csStorageRefs :: !(M.Map SolidString StorageRef),
    -- Inlined `msg.sender`: Nothing = Env.sender at the IR entry; Just r =
    -- the calling contract of the current inlined frame.
    csSenderReg :: !(Maybe Int),
    csBreakTarget :: !(Maybe Int),
    csContinueTarget :: !(Maybe Int),
    -- True while isolate-compiling a pure helper: nested calls must inline,
    -- never isolateCompile, so there is no nested unsafePerformIO blackhole.
    csInliningOnly :: !Bool,
    -- `RetJump`: `return` jumps to modifier postfix (or function end).
    -- Entry and isolate both use this so postfix still runs and statements
    -- after an early return do not. `RetHalt` is kept for the unused path.
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

storageDecl :: CodeCollection -> Contract -> SolidString -> Maybe CC.VariableDecl
storageDecl cc contract name =
  M.lookup name (contract ^. CC.storageDefs)
    <|> listToMaybe (mapMaybe (M.lookup name . (^. CC.storageDefs)) (ancestors cc contract))

storageIndexedType :: CodeCollection -> Contract -> SolidString -> Maybe SVMType.Type
storageIndexedType cc contract name = do
  decl <- storageDecl cc contract name
  indexedValue $ decl ^. VD.varType
  where
    indexedValue (SVMType.Mapping _ _ valueTy _ _) = Just valueTy
    indexedValue (SVMType.Array entryTy _) = Just entryTy
    indexedValue (SVMType.UserDefined _ ty) = indexedValue ty
    indexedValue _ = Nothing

mapAssignmentEncoding :: CodeCollection -> Contract -> SolidString -> CC.Expression -> CM ScalarStorageEncoding
mapAssignmentEncoding cc contract mapName rhs = do
  (actual, _) <- resolveMap mapName
  rhsIsAddress <- expressionIsStaticallyAddress rhs
  pure $
    if rhsIsAddress && maybe False isContractType (storageIndexedType cc contract actual)
      then EncodeAddress
      else EncodeDeclared
  where
    expressionIsStaticallyAddress = \case
      CC.InlineBoundsCheck _ _ _ inner -> expressionIsStaticallyAddress inner
      CC.Variable _ name -> do
        types <- csTypes <$> get
        pure $ maybe False isAddressType (M.lookup name types)
      CC.IndexAccess _ (CC.Variable _ name) (Just _) -> do
        types <- csTypes <$> get
        pure $ maybe False indexedAddress (M.lookup name types)
      CC.FunctionCall _ (CC.Variable _ "address") [_] -> pure True
      _ -> pure False
    indexedAddress (SVMType.Array entryTy _) = isAddressType entryTy
    indexedAddress (SVMType.UserDefined _ ty) = indexedAddress ty
    indexedAddress _ = False

rootIndexIsAddress :: CodeCollection -> Contract -> StorageRef -> Maybe Bool
rootIndexIsAddress cc contract ref = do
  decl <- storageDecl cc contract (srRoot ref)
  currentType <- foldM descend (decl ^. VD.varType) (srSteps ref)
  case unwrap currentType of
    SVMType.Mapping _ keyTy _ _ _ -> keyIsAddr keyTy
    SVMType.Array {} -> Just False
    _ -> Just False
  where
    descend ty = \case
      PIndex {} -> indexedValue ty
      PObjectIndex {} -> indexedValue ty
      PField field -> structField ty field

    indexedValue ty = case unwrap ty of
      SVMType.Mapping _ _ valueTy _ _ -> Just valueTy
      SVMType.Array entryTy _ -> Just entryTy
      _ -> Nothing

    structField ty field = do
      structName <- structTypeName (unwrap ty)
      fields <- CC.structDef contract cc structName
      (_, fieldType, _) <- find ((== field) . \(name, _, _) -> name) fields
      pure $ CC.fieldTypeType fieldType

    unwrap (SVMType.UserDefined _ ty) = unwrap ty
    unwrap ty = ty

bindStorageRef :: SolidString -> StorageRef -> CM ()
bindStorageRef name ref = modify' $ \s -> s {csStorageRefs = M.insert name ref (csStorageRefs s)}

resolveStorageRef :: CodeCollection -> Contract -> CC.Expression -> CM (Maybe StorageRef)
resolveStorageRef cc contract = \case
  CC.Variable _ name -> do
    s <- get
    case M.lookup name (csStorageRefs s) of
      Just ref -> pure $ Just ref
      Nothing -> case storageDecl cc contract name of
        Nothing -> pure Nothing
        Just _ -> pure . Just $ StorageRef name [] (csCalleeReg s)
  CC.MemberAccess _ parent field ->
    fmap (\ref -> ref {srSteps = srSteps ref ++ [PField field]})
      <$> resolveStorageRef cc contract parent
  CC.IndexAccess _ parent (Just indexExpr) -> do
    mref <- resolveStorageRef cc contract parent
    case mref of
      Nothing -> pure Nothing
      Just ref -> do
        sourceReg <- compileExpr cc contract indexExpr
        case objectSlot sourceReg of
          Just _ ->
            pure . Just $ ref {srSteps = srSteps ref ++ [PObjectIndex sourceReg]}
          Nothing -> do
            isAddr <- lift $ rootIndexIsAddress cc contract ref
            -- A Solidity storage-reference declaration captures the path as
            -- it exists at that point. Keep an immutable snapshot rather than
            -- an alias to an argument/local register later code may update.
            indexReg <- fresh
            emit $ UMov indexReg sourceReg
            pure . Just $ ref {srSteps = srSteps ref ++ [PIndex indexReg isAddr]}
  _ -> pure Nothing

emitPathGet :: Int -> StorageRef -> CM ()
emitPathGet dest ref = case srCallee ref of
  Nothing -> emit $ UPathGet dest (srRoot ref) (srSteps ref)
  Just cr -> emit $ UPathGetAt dest (srRoot ref) (srSteps ref) cr

emitPathSet :: StorageRef -> Int -> CM ()
emitPathSet ref valueReg = case srCallee ref of
  Nothing -> emit $ UPathSet (srRoot ref) (srSteps ref) valueReg
  Just cr -> emit $ UPathSetAt (srRoot ref) (srSteps ref) valueReg cr

emitPathDelete :: StorageRef -> CM ()
emitPathDelete ref = case srCallee ref of
  Nothing -> emit $ UPathDelete (srRoot ref) (srSteps ref)
  Just cr -> emit $ UPathDeleteAt (srRoot ref) (srSteps ref) cr

fresh :: CM Int
fresh = state $ \s ->
  let n = csNext s
   in (n, s {csNext = n + 1})

emit :: UOp -> CM ()
emit op = modify' $ \s -> s {csCode = op : csCode s}

-- Copy a compiled pure helper into the current stream. Child jumps are
-- already absolute PCs; rewrite them to parent placeholders so a mid-body
-- URet jumps to the splice end. AST-inlining (`csInliningOnly`) hung
-- Pool.swap; this remaps already-patched ops instead.
spliceablePure :: V.Vector UOp -> Bool
spliceablePure ops =
  V.length ops < 160
    && V.all ok ops
  where
    ok = \case
      UCallPure nested _ _ _ _ _ -> spliceablePure nested
      UCallStorage {} -> False
      UFallback -> False
      USender {} -> False
      UThis {} -> False
      UMapGet {} -> False
      UMapSet {} -> False
      UMapGetAt {} -> False
      UMapSetAt {} -> False
      UMapGet2 {} -> False
      UMapSet2 {} -> False
      UMapGet2At {} -> False
      UMapSet2At {} -> False
      USloadAddr {} -> False
      USloadAt {} -> False
      UEventSload {} -> False
      USstore {} -> False
      USstoreAt {} -> False
      UArrayNew {} -> False
      UArrayMov {} -> False
      UArrayPush {} -> False
      UArrayLoadStorage {} -> False
      UArrayStoreStorage {} -> False
      UArrayLen {} -> False
      UArrayGet {} -> False
      UArraySet {} -> False
      UObjectLit {} -> False
      UObjectMov {} -> False
      UDecimalTruncate {} -> False
      UDecimalDiv {} -> False
      UObjectEq {} -> False
      UObjectSstore {} -> False
      UObjectSstoreAt {} -> False
      UDynamicCall {} -> False
      UHostBuiltin {} -> False
      UHostTupleBuiltin {} -> False
      UPathGet {} -> False
      UPathGetAt {} -> False
      UPathSet {} -> False
      UPathSetAt {} -> False
      UPathDelete {} -> False
      UPathDeleteAt {} -> False
      UEmit {} -> False
      UTimestamp {} -> False
      UNumber {} -> False
      ULabel {} -> False
      _ -> True

spliceCallPure ::
  V.Vector UOp ->
  Int ->
  [Int] ->
  [Int] ->
  [Int] ->
  [Int] ->
  CM ()
spliceCallPure cops cnregs cargRegs cretRegs srcRegs dests = do
  guard $ spliceablePure cops
  guard $ all (>= 0) cargRegs
  guard $ length srcRegs == length cargRegs
  rmapV <- V.fromList <$> mapM (\_ -> fresh) (replicate (max cnregs 0) ())
  let rmap i = rmapV V.! i
  forM_ cretRegs $ \r -> emit $ ULit (rmap r) 0
  zipWithM_ (\c s -> emit $ UMov (rmap c) s) cargRegs srcRegs
  let n = V.length cops
  ph <- V.fromList <$> mapM (\_ -> freshPlaceholder) [0 .. n - 1]
  endLbl <- freshPlaceholder
  let jmp t = do
        guard $ t >= 0 && t < n
        pure (ph V.! t)
  forM_ [0 .. n - 1] $ \i -> do
    mark (ph V.! i)
    case cops V.! i of
      URet rs -> do
        guard $ length rs == length dests
        zipWithM_ (\d s -> emit $ UMov d (rmap s)) dests rs
        emit $ UJmp endLbl
      UCallPure nested nn narg nret nsrc ndest ->
        spliceCallPure nested nn narg nret (map rmap nsrc) (map rmap ndest)
      ULit d k -> emit $ ULit (rmap d) k
      UMov d a -> emit $ UMov (rmap d) (rmap a)
      UAdd d a b -> emit $ UAdd (rmap d) (rmap a) (rmap b)
      USub d a b -> emit $ USub (rmap d) (rmap a) (rmap b)
      UMul d a b -> emit $ UMul (rmap d) (rmap a) (rmap b)
      UExp d a b -> emit $ UExp (rmap d) (rmap a) (rmap b)
      UDiv d a b -> emit $ UDiv (rmap d) (rmap a) (rmap b)
      UMod d a b -> emit $ UMod (rmap d) (rmap a) (rmap b)
      UShl d a b -> emit $ UShl (rmap d) (rmap a) (rmap b)
      UShr d a b -> emit $ UShr (rmap d) (rmap a) (rmap b)
      UAndB d a b -> emit $ UAndB (rmap d) (rmap a) (rmap b)
      UOrB d a b -> emit $ UOrB (rmap d) (rmap a) (rmap b)
      UXor d a b -> emit $ UXor (rmap d) (rmap a) (rmap b)
      UNot d a -> emit $ UNot (rmap d) (rmap a)
      ULt d a b -> emit $ ULt (rmap d) (rmap a) (rmap b)
      UGt d a b -> emit $ UGt (rmap d) (rmap a) (rmap b)
      ULe d a b -> emit $ ULe (rmap d) (rmap a) (rmap b)
      UGe d a b -> emit $ UGe (rmap d) (rmap a) (rmap b)
      UEq d a b -> emit $ UEq (rmap d) (rmap a) (rmap b)
      UNeq d a b -> emit $ UNeq (rmap d) (rmap a) (rmap b)
      UJmp t -> emit . UJmp =<< jmp t
      UJmpZ c t -> do
        t' <- jmp t
        emit $ UJmpZ (rmap c) t'
      UReq c -> emit $ UReq (rmap c)
      UReqJ c t -> do
        t' <- jmp t
        emit $ UReqJ (rmap c) t'
      UReqNonNegative r -> emit $ UReqNonNegative (rmap r)
      UReqNonNegativeJ r t -> do
        t' <- jmp t
        emit $ UReqNonNegativeJ (rmap r) t'
      UCharge k -> emit $ UCharge k
      other -> do
        let !_ = logMiss ("splice " ++ take 40 (show other))
        lift Nothing
  mark endLbl

resolveMap :: SolidString -> CM (SolidString, Maybe Int)
resolveMap mapName = do
  s <- get
  case M.lookup mapName (csMapAlias s) of
    Just (actual, aliasCal) -> pure (actual, aliasCal <|> csCalleeReg s)
    Nothing -> pure (mapName, csCalleeReg s)

emitMapSet :: SolidString -> Int -> Int -> Bool -> CM ()
emitMapSet mapName k v isAddr = emitMapSetWithEncoding mapName k v isAddr EncodeDeclared

emitMapSetWithEncoding :: SolidString -> Int -> Int -> Bool -> ScalarStorageEncoding -> CM ()
emitMapSetWithEncoding mapName k v isAddr encoding = do
  (actual, callee) <- resolveMap mapName
  case callee of
    Nothing -> emit $ UMapSet actual k v isAddr encoding
    Just cr -> emit $ UMapSetAt actual k v isAddr encoding cr

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

emitEventSload :: Int -> SolidString -> CM ()
emitEventSload dest field = do
  callee <- csCalleeReg <$> get
  emit $ UEventSload dest field callee

emitSstore :: SolidString -> Int -> CM ()
emitSstore field v = do
  callee <- csCalleeReg <$> get
  case callee of
    Nothing -> emit $ USstore field v
    Just cr -> emit $ USstoreAt field v cr

emitObjectSstore :: SolidString -> Int -> CM ()
emitObjectSstore field v = do
  callee <- csCalleeReg <$> get
  case callee of
    Nothing -> emit $ UObjectSstore field v
    Just cr -> emit $ UObjectSstoreAt field v cr

emitReq :: Int -> CM ()
emitReq r = do
  mCatch <- csCatch <$> get
  case mCatch of
    Just t -> emit $ UReqJ r t
    Nothing -> emit $ UReq r

emitReqNonNegative :: Int -> CM ()
emitReqNonNegative r = do
  mCatch <- csCatch <$> get
  case mCatch of
    Just t -> emit $ UReqNonNegativeJ r t
    Nothing -> emit $ UReqNonNegative r

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

-- Split modifier postfix so `return` can jump to it instead of falling
-- through the rest of the function body. Nested modifiers fold as
-- (outer_pre ++ inner_pre ++ body, inner_post ++ outer_post).
applyModifiers ::
  CodeCollection ->
  Contract ->
  Func ->
  [CC.Statement] ->
  Maybe ([CC.Statement], [CC.Statement])
applyModifiers cc contract func commands =
  foldr step (Just (commands, [])) (CC._funcModifiers func)
  where
    isPlaceholder (CC.ModifierExecutor _) = True
    isPlaceholder _ = False
    step (name, args) acc = do
      unless (null args) $
        let !_ = logMiss ("modargs " ++ labelToString name ++ " " ++ show (length args))
         in Nothing
      guard (null args)
      (preBody, postfix) <- acc
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
          case break isPlaceholder mstmts of
            (pre, _ : post) -> Just (pre ++ preBody, postfix ++ post)
            _
              | null postfix,
                [CC.TryCatchStatement tryStatements catchBlocks annot] <- mstmts,
                (tryPrefix, _ : tryPostfix) <- break isPlaceholder tryStatements,
                null tryPostfix ->
                  Just
                    ( [ CC.TryCatchStatement
                          (tryPrefix ++ preBody)
                          catchBlocks
                          annot
                      ],
                      []
                    )
            _ ->
              let !_ = logMiss ("modsplice " ++ labelToString name)
               in Nothing

-- `return` jumps to postfix (or end if none) so statements after an early
-- return do not run, while modifier postfix after `_` still does.
emitFuncBody ::
  CodeCollection ->
  Contract ->
  [Int] ->
  [CC.Statement] ->
  [CC.Statement] ->
  CM (Maybe Int)
emitFuncBody cc contract dests commands postfix = do
  endLbl <- freshPlaceholder
  postfixLbl <- if null postfix then pure endLbl else freshPlaceholder
  mret <- compileStatements cc contract (RetJump postfixLbl dests) commands
  unless (null postfix) $ do
    mark postfixLbl
    _ <- compileStatements cc contract (RetJump endLbl dests) postfix
    pure ()
  mark endLbl
  pure mret

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
    Nothing -> case M.lookup name (csObjects s) of
      Just slot -> pure $ objectBinding slot
      Nothing -> case M.lookup name (csArrays s) of
        Just slot -> pure $ arrayBinding slot
        Nothing -> do
          let !_ = logMiss ("lookup " ++ labelToString name)
          lift Nothing

emitMove :: Int -> Int -> CM ()
emitMove dest src
  | dest < 0 || src < 0 = do
      case (arraySlot dest, arraySlot src) of
        (Just destSlot, Just srcSlot) -> emit $ UArrayMov destSlot srcSlot
        _ -> do
          guard $ isJust (objectSlot dest) && isJust (objectSlot src)
          emit $ UObjectMov dest src
  | otherwise = emit $ UMov dest src

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
  CC.DecimalLiteral _ value -> do
    r <- bindAnonymousObject
    emit $ UObjectLit r (SDecimal $ CC.unwrapDecimal value)
    charge 1
    pure r
  CC.StringLiteral _ value -> do
    r <- bindAnonymousObject
    emit $ UObjectLit r (SString value)
    charge 1
    pure r
  CC.ArrayExpression _ values -> do
    slotBinding <- bindAnonymousArray
    slot <- lift $ arraySlot slotBinding
    lenReg <- fresh
    emit $ ULit lenReg (fromIntegral $ length values)
    emit $ UArrayNew slot lenReg
    forM_ (zip [0 :: Integer ..] values) $ \(index, valueExpr) -> do
      indexReg <- fresh
      emit $ ULit indexReg index
      valueReg <- compileExpr cc current valueExpr
      emit $ UArraySet slot indexReg valueReg
    charge $ 1 + fromIntegral (length values)
    pure slotBinding
  CC.Unitary _ "delete" expr -> do
    ref <- lift =<< resolveStorageRef cc current expr
    emitPathDelete ref
    r <- fresh
    emit $ ULit r 0
    charge 1
    pure r
  CC.Variable _ name -> compileVar cc current name
  CC.PlusPlus _ (CC.Variable _ name) -> bump name True
  CC.MinusMinus _ (CC.Variable _ name) -> bump name False
  CC.InlineBoundsCheck _ maybeLower maybeUpper child -> do
    r <- compileExpr cc current child
    case maybeLower of
      Just 0 -> emitReqNonNegative r
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
    afterTrue <- freshPlaceholder
    falsePc <- freshPlaceholder
    emit $ UJmpZ c falsePc
    t <- compileExpr cc current ifTrue
    r <- if isJust (objectSlot t) then bindAnonymousObject else fresh
    emitMove r t
    emit $ UJmp afterTrue
    mark falsePc
    f <- compileExpr cc current ifFalse
    guard $ isJust (objectSlot r) == isJust (objectSlot f)
    emitMove r f
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
  expr@(CC.IndexAccess _ (CC.IndexAccess _ (CC.Variable _ mapName) (Just k1e)) (Just k2e)) -> do
    (actual, callee) <- resolveMap mapName
    case nestedMapKeys cc current actual of
      Just (ia1, ia2) -> do
        k1 <- compileExpr cc current k1e
        k2 <- compileExpr cc current k2e
        r <- fresh
        case callee of
          Nothing -> emit $ UMapGet2 r actual k1 ia1 k2 ia2
          Just cr -> emit $ UMapGet2At r actual k1 ia1 k2 ia2 cr
        charge 1
        pure r
      Nothing -> compileStoragePathGet expr
  expr@(CC.IndexAccess _ (CC.Variable _ mapName) (Just idx)) -> do
    s <- get
    case (M.lookup mapName (csTypes s), M.lookup mapName (csObjects s), M.lookup mapName (csArrays s)) of
      (Just SVMType.Bytes {}, Just objectSlot', _) -> do
        k <- compileExpr cc current idx
        r <- fresh
        emit $ UHostBuiltin r "__solidvm_bytesIndex" [(objectBinding objectSlot', HostOpaque), (k, HostInteger)]
        charge 1
        pure r
      (_, _, Just slot) -> do
        k <- compileExpr cc current idx
        r <- fresh
        emit $ UArrayGet r slot k
        charge 1
        pure r
      _ -> do
        (actual, _) <- resolveMap mapName
        case mappingAddrKey cc current actual of
          Just isAddr -> do
            k <- compileExpr cc current idx
            r <- fresh
            emitMapGet r mapName k isAddr
            charge 1
            pure r
          Nothing -> compileStoragePathGet expr
  expr@CC.IndexAccess {} -> compileStoragePathGet expr
  expr@(CC.MemberAccess _ (CC.Variable _ receiverName) memberName) -> do
    s <- get
    case (M.lookup receiverName (csTypes s), M.lookup receiverName (csObjects s), M.lookup receiverName (csArrays s)) of
      (Just SVMType.Bytes {}, Just objectSlot', _) | memberName == "length" -> do
        r <- fresh
        emit $ UHostBuiltin r "__solidvm_bytesLength" [(objectBinding objectSlot', HostOpaque)]
        charge 2
        pure r
      (_, _, Just slot) | memberName == "length" -> do
        r <- fresh
        emit $ UArrayLen r slot
        charge 2
        pure r
      _ ->
        case M.lookup receiverName (csStorageRefs s) of
          Just ref -> do
            r <- fresh
            emitPathGet r ref {srSteps = srSteps ref ++ [PField memberName]}
            charge 2
            pure r
          Nothing -> case M.lookup (receiverName ++ "." ++ memberName) (csNames s) of
            Just r0 -> charge 2 >> pure r0
            Nothing -> do
              mref <- resolveStorageRef cc current expr
              case mref of
                Just ref -> do
                  r <- fresh
                  emitPathGet r ref
                  charge 2
                  pure r
                Nothing ->
                  case enumMember cc current receiverName memberName of
                    Just n -> do
                      r <- fresh
                      emit $ ULit r n
                      charge 2
                      pure r
                    Nothing -> do
                      guard $ not (nameShadowed receiverName current cc (csNames s))
                      target <- lift $ M.lookup receiverName (cc ^. CC.contracts)
                      constantDecl <- lift $ M.lookup memberName (target ^. CC.constants)
                      r <- compileExpr cc target (constantDecl ^. CC.constInitialVal)
                      charge 2
                      pure r
  expr@CC.MemberAccess {} -> do
    mref <- resolveStorageRef cc current expr
    case mref of
      Just ref -> do
        r <- fresh
        emitPathGet r ref
        charge 1
        pure r
      Nothing -> do
        let !_ = logMiss ("member " ++ take 180 (show expr))
        lift Nothing
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
    compileStoragePathGet expr = do
      ref <- lift =<< resolveStorageRef cc current expr
      r <- fresh
      emitPathGet r ref
      charge 1
      pure r
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
    Nothing | Just slot <- M.lookup name (csObjects s) ->
      charge 1 >> pure (objectBinding slot)
    Nothing | Just slot <- M.lookup name (csArrays s) ->
      charge 1 >> pure (arrayBinding slot)
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
      case (isJust $ objectSlot l, isJust $ objectSlot r, op) of
        (True, True, "/") -> do
          objectDest <- bindAnonymousObject
          emit $ UDecimalDiv objectDest l r
          charge 1
          pure objectDest
        (True, True, "==") -> emit (UObjectEq d l r) >> charge 1 >> pure d
        (True, True, "!=") -> do
          eq <- fresh
          emit $ UObjectEq eq l r
          emit $ UNot d eq
          charge 1
          pure d
        (False, False, scalarOp) -> do
          case scalarOp of
            "+" -> emit (UAdd d l r)
            "-" -> emit (USub d l r)
            "*" -> emit (UMul d l r)
            "**" -> emit (UExp d l r)
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
        _ -> do
          let !_ = logMiss ("mixed-binop " ++ op)
          lift Nothing

namedUintReturns :: Func -> Maybe [SolidString]
namedUintReturns func = traverse namedUint (CC._funcVals func)
  where
    namedUint (Just name, CC.IndexedType _ ty _) | uintishType ty = Just name
    namedUint _ = Nothing

namedFastReturns :: Func -> Maybe [(SolidString, SVMType.Type)]
namedFastReturns func = traverse namedFast (CC._funcVals func)
  where
    namedFast (Just name, CC.IndexedType _ ty _)
      | uintishType ty || uintArrayType ty || opaqueType ty = Just (name, ty)
    namedFast _ = Nothing

compileCallValues :: CodeCollection -> Contract -> CC.Expression -> CC.ArgList -> CM [Int]
compileCallValues cc current callee args
  | CC.Variable _ builtinName <- callee
  , builtinName == "poseidon2Compress" = do
      refs <- mapM compileHostArg args
      dest <- fresh
      emit $ UHostBuiltin dest (labelToString builtinName) refs
      charge 1
      pure [dest]
  | CC.Variable _ builtinName <- callee
  , builtinName `elem` ["addmod", "mulmod", "modExp"] = do
      refs <- mapM compileHostArg args
      dest <- fresh
      emit $ UHostBuiltin dest (labelToString builtinName) refs
      charge 1
      pure [dest]
  | CC.Variable _ builtinName <- callee
  , builtinName `elem` ["bytes", "keccak256", "sha256", "decimal"] = do
      refs <- mapM compileHostArg args
      dest <- bindAnonymousObject
      emit $ UHostBuiltin dest (labelToString builtinName) refs
      charge 1
      pure [dest]
  | CC.Variable _ builtinName <- callee
  , builtinName `elem` ["ecAdd", "ecMul"] = do
      refs <- mapM compileHostArg args
      dests <- forM [1 :: Int, 2] $ const fresh
      emit $ UHostTupleBuiltin dests (labelToString builtinName) refs
      charge 1
      pure dests
  | CC.MemberAccess _ receiver "truncate" <- callee
  , [placesExpr] <- args = do
      source <- compileExpr cc current receiver
      guard $ isJust (objectSlot source)
      places <- compileExpr cc current placesExpr
      guard $ places >= 0
      dest <- bindAnonymousObject
      emit $ UDecimalTruncate dest source places
      charge 1
      pure [dest]
  | CC.MemberAccess _ receiver "call" <- callee
  , functionExpr : callArgs <- args = do
      mCatch <- csCatch <$> get
      target <- compileExpr cc current receiver
      functionRef <- compileExpr cc current functionExpr
      argRefs <- mapM compileHostArg callArgs
      guard $ target >= 0
      guard $ isJust (objectSlot functionRef)
      dest <- bindAnonymousObject
      emit $ UDynamicCall dest CallRaw target functionRef argRefs mCatch
      charge 2
      pure [dest]
  | CC.MemberAccess _ receiver "delegatecall" <- callee
  , functionExpr : callArgs <- args = do
      mCatch <- csCatch <$> get
      target <- compileExpr cc current receiver
      functionRef <- compileExpr cc current functionExpr
      argRefs <- mapM compileHostArg callArgs
      guard $ target >= 0
      guard $ isJust (objectSlot functionRef)
      dest <- bindAnonymousObject
      emit $ UDynamicCall dest CallDelegate target functionRef argRefs mCatch
      charge 2
      pure [dest]
  | CC.MemberAccess _ (CC.Variable _ receiverName) "push" <- callee
  , [valueExpr] <- args = do
      s <- get
      slot <- lift $ M.lookup receiverName (csArrays s)
      valueReg <- compileExpr cc current valueExpr
      newLen <- fresh
      emit $ UArrayPush newLen slot valueReg
      charge 2
      pure [newLen]
  | CC.MemberAccess _ receiver "push" <- callee
  , [valueExpr] <- args = do
      ref <- lift =<< resolveStorageRef cc current receiver
      valueReg <- compileExpr cc current valueExpr
      oldLen <- fresh
      let lenRef = ref {srSteps = srSteps ref ++ [PField "length"]}
      emitPathGet oldLen lenRef
      one <- fresh
      emit $ ULit one 1
      newLen <- fresh
      emit $ UAdd newLen oldLen one
      emitPathSet lenRef newLen
      let valueRef = ref {srSteps = srSteps ref ++ [PIndex oldLen False]}
      emitPathSet valueRef valueReg
      charge 2
      pure [newLen]
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
  , castName `elem` ["uint", "uint8", "uint256", "int", "int256", "address"]
  , [arg] <- args = do
      r <- compileExpr cc current arg
      if isJust (objectSlot r)
        then do
          dest <- fresh
          emit $ UHostBuiltin dest (labelToString castName) [(r, HostOpaque)]
          charge 1
          pure [dest]
        else pure [r]
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
        CC.MemberAccess _ receiver@(CC.IndexAccess _ (CC.Variable _ collectionName) (Just _)) methodName -> do
          valueTy <- lift $ storageIndexedType cc current collectionName
          (tgt, func) <- lift $ methodOnType cc valueTy methodName
          addrReg <- compileExpr cc current receiver
          pure (tgt, func, 2, Just addrReg)
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
          let !_ = logMiss ("callee " ++ take 2000 (show other))
          lift Nothing
      charge receiverCost
      tryFuncs mCallee target (original : CC._funcOverload original)
  where
    compileHostArg expr = do
      ref <- compileExpr cc current expr
      kind <- case expr of
        CC.Variable _ name -> do
          s <- get
          pure $ maybe (if ref < 0 then HostOpaque else HostInteger) hostKind (M.lookup name $ csTypes s)
        CC.MemberAccess _ (CC.Variable _ "msg") "sender" -> pure HostAddress
        CC.FunctionCall _ (CC.Variable _ "address") [_] -> pure HostAddress
        CC.BoolLiteral {} -> pure HostBool
        _ -> pure $ if ref < 0 then HostOpaque else HostInteger
      pure (ref, kind)
    hostKind ty
      | isAddressType ty || isContractType ty = HostAddress
      | ty == SVMType.Bool = HostBool
      | opaqueType ty = HostOpaque
      | otherwise = HostInteger
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
      case (calleeReg, CC._funcContents func) of
        (Just targetReg, Nothing) ->
          emitDynamicNamed CallDefault targetReg (functionLabel target func) func
        _ -> do
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

    emitDynamicNamed callKind targetReg methodName func = do
      mCatch <- csCatch <$> get
      functionRef <- bindAnonymousObject
      emit $ UObjectLit functionRef (SString methodName)
      argRefs <- mapM compileHostArg args
      (dest, results) <- case CC._funcVals func of
        [] -> do
          ignored <- bindAnonymousObject
          pure (ignored, [])
        [(Nothing, CC.IndexedType _ ty _)]
          | uintishType ty -> do
              result <- fresh
              pure (result, [result])
          | opaqueType ty -> do
              result <- bindAnonymousObject
              pure (result, [result])
        _ -> lift Nothing
      emit $ UDynamicCall dest callKind targetReg functionRef argRefs mCatch
      charge 2
      pure results

    emitCallPure f cops cnregs cargRegs cretRegs = do
      guard $ all (>= 0) cargRegs
      srcRegs <- compileArgRegs (CC._funcArgs f) args
      guard $ length srcRegs == length cargRegs
      dests <- mapM (\_ -> fresh) cretRegs
      let initRegs = case namedUintReturns f of
            Just (_ : _) -> cretRegs
            _ -> []
      if spliceablePure cops
        then spliceCallPure cops cnregs cargRegs initRegs srcRegs dests
        else emit $ UCallPure cops cnregs cargRegs initRegs srcRegs dests
      charge 1
      pure dests

    emitCallStorage f mCallee cops cnregs cargRegs cretRegs = do
      guard $ all (>= 0) cargRegs
      srcRegs <- compileArgRegs (CC._funcArgs f) args
      guard $ length srcRegs == length cargRegs
      dests <- forM cretRegs $ \retRef ->
        if isArrayBinding retRef
          then bindAnonymousArray
          else if isJust (objectSlot retRef)
            then bindAnonymousObject
            else fresh
      emit $ UCallStorage cops cnregs cargRegs srcRegs dests mCallee
      charge 1
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
      (commands, postfix) <- case applyModifiers cc target func commands0 of
        Nothing -> do
          let !_ = logMiss ("inmod " ++ labelToString (target ^. CC.contractName))
          lift Nothing
        Just split -> pure split
      modify' $ \st -> st {csDepth = csDepth st + 1}
      saved <- csNames <$> get
      savedTypes <- csTypes <$> get
      -- Args are evaluated in the caller. Switching callee first made
      -- a storage-receiver call sload argument names from the callee.
      savedMaps <- csMapAlias <$> get
      savedStorageRefs <- csStorageRefs <$> get
      savedArrays <- csArrays <$> get
      savedNextArray <- csNextArray <$> get
      savedObjects <- csObjects <$> get
      savedBreak <- csBreakTarget <$> get
      savedContinue <- csContinueTarget <$> get
      modify' $ \st -> st {csBreakTarget = Nothing, csContinueTarget = Nothing}
      let allowArrayArgs = functionLabel target func `elem` ["_xpMem", "__exchange", "getD", "getY", "upkeepOracles", "_getP", "_updateRatios"]
      bindCallFormals allowArrayArgs (CC._funcArgs func) args
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
      result <- case namedFastReturns func of
        Just retDefs | not (null retDefs) -> do
          destRegs <- forM retDefs $ \(name, ty) ->
            if uintArrayType ty
              then arrayBinding <$> bindArray name ty
              else if opaqueType ty
                then bindObject name ty
                else do
                  r <- fresh
                  bindTyped name ty r
                  pure r
          _ <- emitFuncBody cc target destRegs commands postfix
          pure destRegs
        _
          | null (CC._funcVals func) -> do
              _ <- emitFuncBody cc target [] commands postfix
              pure []
          | [(Nothing, CC.IndexedType _ ty _)] <- CC._funcVals func,
            uintArrayType ty -> do
              dest <- bindAnonymousArray
              _ <- emitFuncBody cc target [dest] commands postfix
              pure [dest]
          | [(Nothing, CC.IndexedType _ ty _)] <- CC._funcVals func,
            opaqueType ty -> do
              dest <- bindAnonymousObject
              _ <- emitFuncBody cc target [dest] commands postfix
              pure [dest]
          | all (isNothing . fst) (CC._funcVals func) -> do
              dests <- mapM anonymousInlineReturn (CC._funcVals func)
              _ <- emitFuncBody cc target dests commands postfix
              pure dests
          | otherwise -> lift Nothing
      modify' $ \st ->
        st
          { csNames = saved,
            csTypes = savedTypes,
            csDepth = csDepth st - 1,
            csCalleeReg = oldCallee,
            csSenderReg = oldSender,
            csMapAlias = savedMaps,
            csStorageRefs = savedStorageRefs,
            csArrays = savedArrays,
            csNextArray = max savedNextArray (csNextArray st),
            csObjects = savedObjects,
            csBreakTarget = savedBreak,
            csContinueTarget = savedContinue
          }
      pure result

    anonymousInlineReturn (_, CC.IndexedType _ ty _)
      | uintArrayType ty = bindAnonymousArray
      | opaqueType ty = bindAnonymousObject
      | uintishType ty = fresh
      | otherwise = lift Nothing

    bindCallFormals _ [] [] = pure ()
    bindCallFormals allowArrays ((Just name, CC.IndexedType _ ty _) : formals) (arg : rest)
      | uintishType ty = do
          src <- compileExpr cc current arg
          dest <- fresh
          emit $ UMov dest src
          bindTyped name ty dest
          bindCallFormals allowArrays formals rest
      | uintArrayType ty,
        allowArrays = do
          src <- compileExpr cc current arg
          slot <- lift $ arraySlot src
          bindExistingArray name ty slot
          bindCallFormals allowArrays formals rest
      | opaqueType ty = do
          src <- compileExpr cc current arg
          dest <- bindObject name ty
          emitMove dest src
          bindCallFormals allowArrays formals rest
      | isMappingType ty
      , CC.Variable _ mapName <- arg = do
          mapCallee <- csCalleeReg <$> get
          modify' $ \st -> st {csMapAlias = M.insert name (mapName, mapCallee) (csMapAlias st)}
          bindCallFormals allowArrays formals rest
    bindCallFormals _ _ _ = do
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
      RetJump endLbl dests -> do
        guard $ length srcRegs == length dests
        zipWithM_ emitMove dests srcRegs
        -- Jump to postfix (or function end). Falling through ran
        -- SqrtPriceMath's subtract path after an add `return` and inverted
        -- Uniswap next-price. Postfix is a separate RetJump target.
        emit $ UJmp endLbl
        case srcRegs of
          r : _ -> pure $ Just r
          [] -> pure Nothing
  CC.Return Nothing _ -> do
    charge 1
    case ret of
      RetHalt -> emit $ URet []
      RetJump endLbl _ -> emit $ UJmp endLbl
    pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry _ (Just CC.Storage) name _] (Just initializer))
    _ -> do
      mref <- resolveStorageRef cc current initializer
      ref <- lift mref
      bindStorageRef name ref
      charge 1
      pure Nothing
  CC.SimpleStatement
    ( CC.VariableDefinition
        [CC.VarDefEntry (Just varType) _ name _]
        (Just (CC.FunctionCall _ (CC.NewExpression _ allocatedType _) [lenExpr]))
      )
    _
      | SVMType.Array entry _ <- varType,
        SVMType.Array allocatedEntry _ <- allocatedType,
        uintishType entry,
        uintishType allocatedEntry -> do
          lenReg <- compileExpr cc current lenExpr
          slot <- bindArray name varType
          emit $ UArrayNew slot lenReg
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] (Just initializer))
    _
      | uintArrayType varType,
        CC.Variable _ storageName <- initializer,
        Just decl <- storageDecl cc current storageName,
        uintArrayType (decl ^. VD.varType) -> do
          slot <- bindArray name varType
          emit $ UArrayLoadStorage slot storageName
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] (Just initializer))
    _
      | uintArrayType varType -> do
          src <- compileExpr cc current initializer
          srcSlot <- lift $ arraySlot src
          bindExistingArray name varType srcSlot
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] (Just initializer))
    _
      | uintishType varType -> do
          src <- compileExpr cc current initializer
          dest <- fresh
          emit $ UMov dest src
          bindTyped name varType dest
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] (Just initializer))
    _
      | opaqueType varType -> do
          src <- compileExpr cc current initializer
          dest <- bindObject name varType
          emitMove dest src
          charge 1
          pure Nothing
  CC.SimpleStatement
    (CC.VariableDefinition [CC.VarDefEntry (Just varType) _ name _] Nothing)
    _
      | uintArrayType varType -> do
          zero <- fresh
          emit $ ULit zero 0
          slot <- bindArray name varType
          emit $ UArrayNew slot zero
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
        destDefs <- forM entries $ \case
          CC.VarDefEntry (Just varType) _ name _ | uintishType varType -> pure (name, varType)
          _ -> lift Nothing
        srcRegs <- compileRValues cc current rhs
        guard $ length srcRegs == length destDefs
        zipWithM_
          (\(name, varType) src -> do
             dest <- fresh
             emit $ UMov dest src
             bindTyped name varType dest)
          destDefs
          srcRegs
        charge 1
        pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" lhs@CC.MemberAccess {} rhs))
    _ -> do
      mref <- resolveStorageRef cc current lhs
      case mref of
        Just ref -> do
          r <- compileExpr cc current rhs
          emitPathSet ref r
          charge 1
          charge 1
          pure Nothing
        Nothing -> case lhs of
          CC.MemberAccess _ (CC.Variable _ rec) field -> do
            dest <- lookupName (rec ++ "." ++ field)
            r <- compileExpr cc current rhs
            emit $ UMov dest r
            charge 1
            charge 1
            pure Nothing
          _ -> lift Nothing
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
        Nothing -> case M.lookup name (csArrays s) of
          Just slot -> do
            r <- compileExpr cc current rhs
            guard $ isJust (arraySlot r)
            emitMove (arrayBinding slot) r
            charge 1
            charge 1
            pure Nothing
          Nothing -> case M.lookup name (csObjects s) of
            Just slot -> do
              r <- compileExpr cc current rhs
              guard $ isJust (objectSlot r)
              emitMove (objectBinding slot) r
              charge 1
              charge 1
              pure Nothing
            Nothing -> do
              r <- compileExpr cc current rhs
              case arraySlot r of
                Just slot -> do
                  decl <- lift $ storageDecl cc current name
                  guard $ uintArrayType (decl ^. VD.varType)
                  emit $ UArrayStoreStorage name slot
                Nothing ->
                  if isJust (objectSlot r)
                    then emitObjectSstore name r
                    else emitSstore name r
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
    (CC.ExpressionStatement (CC.Binary _ "=" lhs@(CC.IndexAccess _ (CC.IndexAccess _ (CC.Variable _ mapName) (Just k1e)) (Just k2e)) rhs))
    _ -> do
      (actual, callee) <- resolveMap mapName
      case nestedMapKeys cc current actual of
        Just (ia1, ia2) -> do
          k1 <- compileExpr cc current k1e
          k2 <- compileExpr cc current k2e
          v <- compileExpr cc current rhs
          case callee of
            Nothing -> emit $ UMapSet2 actual k1 ia1 k2 v ia2
            Just cr -> emit $ UMapSet2At actual k1 ia1 k2 v ia2 cr
        Nothing -> do
          ref <- lift =<< resolveStorageRef cc current lhs
          v <- compileExpr cc current rhs
          emitPathSet ref v
      charge 1
      charge 1
      pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" lhs@(CC.IndexAccess _ (CC.Variable _ mapName) (Just idx)) rhs))
    _ -> do
      s <- get
      case M.lookup mapName (csArrays s) of
        Just slot -> do
          k <- compileExpr cc current idx
          v <- compileExpr cc current rhs
          emit $ UArraySet slot k v
          charge 1
          charge 1
          pure Nothing
        Nothing -> case mappingAddrKey cc current mapName of
          Just isAddr -> do
            encoding <- mapAssignmentEncoding cc current mapName rhs
            k <- compileExpr cc current idx
            v <- compileExpr cc current rhs
            emitMapSetWithEncoding mapName k v isAddr encoding
            charge 1
            charge 1
            pure Nothing
          Nothing -> do
            ref <- lift =<< resolveStorageRef cc current lhs
            v <- compileExpr cc current rhs
            emitPathSet ref v
            charge 1
            charge 1
            pure Nothing
  CC.SimpleStatement
    (CC.ExpressionStatement (CC.Binary _ "=" lhs@CC.IndexAccess {} rhs))
    _ -> do
      ref <- lift =<< resolveStorageRef cc current lhs
      v <- compileExpr cc current rhs
      emitPathSet ref v
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
    rs <- forM exptups $ \(_, e) -> compileEventArg e
    emit $ UEmit eventName rs
    charge 1
    pure Nothing
    where
      compileEventArg e@(CC.Variable _ name) = do
        s <- get
        case M.lookup name (csArrays s) of
          Just slot -> pure $ arrayBinding slot
          Nothing -> case M.lookup name (csObjects s) of
            Just slot -> pure $ objectBinding slot
            Nothing
              -- Canonical event evaluation loads direct storage variables at
              -- emit time. An initialized slot becomes its typed Value, while
              -- BDefault remains an SReference that receipt encoding drops.
              -- Preserve both cases instead of choosing one at compile time.
              | M.notMember name (csNames s), isJust (storageDecl cc current name) -> do
                  r <- bindAnonymousObject
                  emitEventSload r name
                  pure r
              | otherwise -> compileExpr cc current e
      compileEventArg e = compileExpr cc current e
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
  CC.SimpleStatement
    ( CC.ExpressionStatement
        ( CC.FunctionCall
            _
            (CC.MemberAccess _ parent "push")
            [CC.FunctionCall _ (CC.Variable _ structName) fieldExprs]
          )
      )
    _ -> do
      ref <- lift =<< resolveStorageRef cc current parent
      fields <- lift $ CC.structDef current cc structName
      guard $ length fields == length fieldExprs
      guard $ all (uintishType . CC.fieldTypeType . (\(_, ty, _) -> ty)) fields

      loadedLen <- fresh
      emitPathGet loadedLen ref {srSteps = srSteps ref ++ [PField "length"]}
      zero <- fresh
      emit $ ULit zero 0
      len <- fresh
      emit $ UAdd len loadedLen zero
      one <- fresh
      emit $ ULit one 1
      nextLen <- fresh
      emit $ UAdd nextLen len one
      emitPathSet ref {srSteps = srSteps ref ++ [PField "length"]} nextLen

      zipWithM_
        (\(fieldName, _, _) fieldExpr -> do
           value <- compileExpr cc current fieldExpr
           emitPathSet
             ref
               { srSteps =
                   srSteps ref
                     ++ [PIndex len False, PField fieldName]
               }
             value)
        fields
        fieldExprs
      charge 1
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
        -- Then cannot lower (decimal, Token.transfer, factory call, ...).
        -- Do not run the else on the then path: that flushed a wrong
        -- netInput / feeBps on helium Pool.addLiquiditySingleToken (block 1336).
        -- UFallback aborts IR without flush so AST reruns this frame.
        -- Else still runs in IR when the condition is false.
        Just elseStmts -> do
          -- Then cannot lower: UFallback aborts IR without flush so AST
          -- reruns this frame. Else still runs in IR when the condition
          -- is false. Do not fail the whole function: that would AST the
          -- else-taken path too (R1336-else MustHit).
          let !_ = logMiss "skip-then"
          emit UFallback
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
    oldBreak <- csBreakTarget <$> get
    oldContinue <- csContinueTarget <$> get
    modify' $ \st -> st {csBreakTarget = Just endLbl, csContinueTarget = Just headLbl}
    _ <- compileStatements cc current ret body
    modify' $ \st -> st {csBreakTarget = oldBreak, csContinueTarget = oldContinue}
    emit $ UJmp headLbl
    mark endLbl
    charge 1
    pure Nothing
  CC.ForStatement maybeInit maybeCond maybePost body annot -> do
    _ <- case maybeInit of
      Just initStmt -> compileStmt cc current ret (CC.SimpleStatement initStmt annot)
      Nothing -> pure Nothing
    headLbl <- freshPlaceholder
    postLbl <- freshPlaceholder
    endLbl <- freshPlaceholder
    mark headLbl
    case maybeCond of
      Just cond -> do
        c <- compileExpr cc current cond
        emit $ UJmpZ c endLbl
      Nothing -> pure ()
    oldBreak <- csBreakTarget <$> get
    oldContinue <- csContinueTarget <$> get
    modify' $ \st -> st {csBreakTarget = Just endLbl, csContinueTarget = Just postLbl}
    _ <- compileStatements cc current ret body
    modify' $ \st -> st {csBreakTarget = oldBreak, csContinueTarget = oldContinue}
    mark postLbl
    case maybePost of
      Just post -> do
        _ <- compileExpr cc current post
        pure ()
      Nothing -> pure ()
    emit $ UJmp headLbl
    mark endLbl
    pure Nothing
  CC.Continue _ -> do
    target <- lift =<< (csContinueTarget <$> get)
    emit $ UJmp target
    charge 1
    pure Nothing
  CC.Break _ -> do
    target <- lift =<< (csBreakTarget <$> get)
    emit $ UJmp target
    charge 1
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
    let !_ = logMiss ("stmt " ++ take 2000 (show stmt))
    lift Nothing

compileRValues :: CodeCollection -> Contract -> CC.Expression -> CM [Int]
compileRValues cc current = \case
  CC.TupleExpression _ srcs -> forM srcs $ \case
    Just e -> do
      r <- compileExpr cc current e
      tmp <-
        if isJust (objectSlot r)
          then bindAnonymousObject
          else fresh
      emitMove tmp r
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
      patch (UReqNonNegativeJ r n) | n < 0 = UReqNonNegativeJ r <$> M.lookup n labs
      patch (UDynamicCall d k t f as (Just n)) | n < 0 =
        UDynamicCall d k t f as . Just <$> M.lookup n labs
      patch (ULabel _) = Nothing
      patch op = Just op
  patched <- traverse patch kept
  pure (V.fromList patched, csNext s)

initialState :: Bool -> Bool -> Int -> CState
initialState inlining retJump depth =
  CState M.empty M.empty 0 M.empty 0 0 [] depth Nothing Nothing M.empty M.empty M.empty Nothing Nothing Nothing inlining retJump

arrayBinding :: Int -> Int
arrayBinding slot = -1 - slot

arraySlot :: Int -> Maybe Int
arraySlot binding
  | isArrayBinding binding = Just (-1 - binding)
  | otherwise = Nothing

objectBindingBase :: Int
objectBindingBase = 1000000000

objectBinding :: Int -> Int
objectBinding slot = negate (objectBindingBase + slot)

objectSlot :: Int -> Maybe Int
objectSlot binding
  | binding <= negate objectBindingBase = Just (negate binding - objectBindingBase)
  | otherwise = Nothing

isArrayBinding :: Int -> Bool
isArrayBinding binding = binding < 0 && isNothing (objectSlot binding)

uintArrayType :: SVMType.Type -> Bool
uintArrayType = \case
  SVMType.Array entry _ -> uintishType entry
  SVMType.UserDefined _ inner -> uintArrayType inner
  _ -> False

opaqueType :: SVMType.Type -> Bool
opaqueType = \case
  SVMType.String {} -> True
  SVMType.Bytes {} -> True
  SVMType.Decimal -> True
  SVMType.Variadic -> True
  SVMType.UserDefined _ inner -> opaqueType inner
  _ -> False

bindArray :: SolidString -> SVMType.Type -> CM Int
bindArray name ty = do
  s <- get
  let slot = csNextArray s
  put
    s
      { csArrays = M.insert name slot (csArrays s),
        csNextArray = slot + 1,
        csTypes = M.insert name ty (csTypes s)
      }
  pure slot

bindExistingArray :: SolidString -> SVMType.Type -> Int -> CM ()
bindExistingArray name ty slot =
  modify' $ \s ->
    s
      { csArrays = M.insert name slot (csArrays s),
        csTypes = M.insert name ty (csTypes s)
      }

bindAnonymousArray :: CM Int
bindAnonymousArray = do
  s <- get
  let slot = csNextArray s
  put s {csNextArray = slot + 1}
  pure $ arrayBinding slot

bindObject :: SolidString -> SVMType.Type -> CM Int
bindObject name ty = do
  s <- get
  let slot = csNextObject s
  put
    s
      { csObjects = M.insert name slot (csObjects s),
        csNextObject = slot + 1,
        csTypes = M.insert name ty (csTypes s)
      }
  pure $ objectBinding slot

bindAnonymousObject :: CM Int
bindAnonymousObject = do
  s <- get
  let slot = csNextObject s
  put s {csNextObject = slot + 1}
  pure $ objectBinding slot

bindArgs :: [(Maybe SolidString, CC.IndexedType)] -> CM [Int]
bindArgs [] = pure []
bindArgs ((Just name, CC.IndexedType _ ty _) : rest)
  | uintishType ty = do
      r <- fresh
      bindTyped name ty r
      (r :) <$> bindArgs rest
  | SVMType.Array entry _ <- ty
  , uintishType entry = do
      slot <- bindArray name ty
      (arrayBinding slot :) <$> bindArgs rest
  | opaqueType ty = do
      binding <- bindObject name ty
      (binding :) <$> bindArgs rest
bindArgs _ = do
  let !_ = logMiss "bindArgs"
  lift Nothing

compileAnyFunc :: CodeCollection -> Contract -> Func -> Maybe (V.Vector UOp, Int, [Int], [Int])
compileAnyFunc cc contract func = compileAnyFuncWith False True cc contract func

compileAnyFuncWith :: Bool -> Bool -> CodeCollection -> Contract -> Func -> Maybe (V.Vector UOp, Int, [Int], [Int])
compileAnyFuncWith inlining retJump cc contract func =
  let compiled = compileCanonicalNormalizeHex <|> compileCanonicalBytesHex <|> do
        guard $ not (CC._funcIsFree func)
        commands0 <- CC._funcContents func
        (commands, postfix) <- case applyModifiers cc contract func commands0 of
          Nothing ->
            let !_ = logMiss ("modifiers " ++ labelToString (contract ^. CC.contractName))
             in Nothing
          Just split -> Just split
        evalStateT (go commands postfix) (initialState inlining retJump 0)
   in case compiled of
        Nothing ->
          let !_ =
                logMiss
                  ( "nolower "
                      ++ labelToString (contract ^. CC.contractName)
                      ++ "."
                      ++ functionLabel contract func
                      ++ " a="
                      ++ show (length (CC._funcArgs func))
                      ++ " s="
                      ++ show (maybe 0 length (CC._funcContents func))
                      ++ " "
                      ++ take 80 (show (CC._funcContext func))
                  )
           in Nothing
        Just x@(ops, _, _, _) ->
          let !_ =
                logMiss
                  ( "lowered "
                      ++ labelToString (contract ^. CC.contractName)
                      ++ "."
                      ++ functionLabel contract func
                      ++ " fb="
                      ++ show (V.length $ V.filter (== UFallback) ops)
                      ++ " n="
                      ++ show (V.length ops)
                      ++ " "
                      ++ take 80 (show (CC._funcContext func))
                      ++ if labelToString (contract ^. CC.contractName) == "PriceOracle"
                           && functionLabel contract func == "setAssetPrices"
                           then " ops=" ++ show (V.toList ops)
                           else ""
                  )
           in Just x
  where
    -- This library helper otherwise allocates three temporary byte arrays and
    -- walks the input repeatedly in SolidVM. Keep the shortcut structural so
    -- another contract that happens to use the same function name cannot opt
    -- into different semantics.
    compileCanonicalNormalizeHex = do
      guard $ labelToString (contract ^. CC.contractName) == "StringUtils"
      guard $ functionLabel contract func == "normalizeHex"
      guard $ null (CC._funcModifiers func)
      case (CC._funcArgs func, CC._funcVals func, CC._funcContents func) of
        ( [(Just "s", CC.IndexedType _ SVMType.String {} _)],
          [(Nothing, CC.IndexedType _ SVMType.String {} _)],
          Just
            [ CC.SimpleStatement
                (CC.VariableDefinition [CC.VarDefEntry _ _ "hexPart" _] (Just _))
                _,
              CC.Return (Just _) _
            ]
          ) ->
            let arg = objectBinding 0
                dest = objectBinding 1
             in Just
                  ( V.fromList
                      [ UHostBuiltin dest "__solidvm_normalizeHex" [(arg, HostOpaque)],
                        URet [dest]
                      ],
                    0,
                    [arg],
                    [dest]
                  )
        _ -> Nothing

    compileCanonicalBytesHex = do
      guard $ labelToString (contract ^. CC.contractName) == "BytesUtils"
      guard $ null (CC._funcModifiers func)
      builtin <- case functionLabel contract func of
        "b16encode" -> Just "__solidvm_b16encode"
        "b16decode" -> Just "__solidvm_b16decode"
        _ -> Nothing
      case (CC._funcArgs func, CC._funcVals func, CC._funcContents func) of
        ( [(Just "b", CC.IndexedType _ SVMType.Bytes {} _)],
          [(Nothing, CC.IndexedType _ SVMType.Bytes {} _)],
          Just statements
          )
            | canonicalBytesBody builtin statements ->
                let arg = objectBinding 0
                    dest = objectBinding 1
                 in Just
                      ( V.fromList
                          [ UHostBuiltin dest builtin [(arg, HostOpaque)],
                            URet [dest]
                          ],
                        0,
                        [arg],
                        [dest]
                      )
        _ -> Nothing

    canonicalBytesBody "__solidvm_b16encode"
      [ CC.SimpleStatement (CC.VariableDefinition [CC.VarDefEntry _ _ "dst" _] (Just _)) _,
        CC.ForStatement {},
        CC.Return (Just (CC.Variable _ "dst")) _
        ] = True
    canonicalBytesBody "__solidvm_b16decode"
      [ CC.SimpleStatement (CC.VariableDefinition [CC.VarDefEntry _ _ "isEven" _] (Just _)) _,
        CC.SimpleStatement (CC.VariableDefinition [CC.VarDefEntry _ _ "offset" _] (Just _)) _,
        CC.SimpleStatement (CC.VariableDefinition [CC.VarDefEntry _ _ "dst" _] (Just _)) _,
        CC.IfStatement {},
        CC.ForStatement {},
        CC.Return (Just (CC.Variable _ "dst")) _
        ] = True
    canonicalBytesBody _ _ = False

    go commands postfix = do
      argRegs <- bindArgs (CC._funcArgs func)
      let retDefs = fromMaybe [] (namedFastReturns func)
          retNames = map fst retDefs
          bindReturn (name, ty)
            | uintArrayType ty = arrayBinding <$> bindArray name ty
            | opaqueType ty = bindObject name ty
            | otherwise = do
                r <- fresh
                bindTyped name ty r
                pure r
      useRetJump <- csRetJump <$> get
      if useRetJump
        then do
          destRegs <- case retDefs of
            _ : _ ->
              mapM bindReturn retDefs
            []
              | null (CC._funcVals func) -> pure []
              | otherwise -> mapM anonymousReturn (CC._funcVals func)
          _ <- emitFuncBody cc contract destRegs commands postfix
          emit $ URet destRegs
          s <- get
          (ops, nregs) <- case finalize s of
            Nothing -> do
              let !_ = logMiss "finalize"
              lift Nothing
            Just x -> pure x
          pure (ops, nregs, argRegs, destRegs)
        else do
          _ <- mapM bindReturn retDefs
          mret <- compileStatements cc contract RetHalt (commands ++ postfix)
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
      where
        anonymousReturn (_, CC.IndexedType _ ty _)
          | uintArrayType ty = bindAnonymousArray
          | opaqueType ty = bindAnonymousObject
          | uintishType ty = fresh
          | otherwise = lift Nothing

functionLabel :: Contract -> Func -> String
functionLabel contract func =
  case
      [ labelToString name
      | (name, candidate) <- M.toList (contract ^. CC.functions),
        CC._funcContext candidate == CC._funcContext func,
        length (CC._funcArgs candidate) == length (CC._funcArgs func)
      ] of
    name : _ -> name
    [] -> "<anonymous>"

pureStackRegs :: V.Vector UOp -> Int -> Int
pureStackRegs ops nregs = nregs + V.foldl' max 0 (V.map childRegs ops)
  where
    childRegs (UCallPure cops cnregs _ _ _ _) = pureStackRegs cops cnregs
    childRegs _ = 0

runOps :: V.Vector UOp -> Int -> [Int] -> [Integer] -> [Int] -> Maybe ([Integer], Integer)
runOps ops nregs argRegs argVals retRegs =
  fmap (\(vs, gas) -> (vs, toInteger gas)) $
    runOpsWithStack True ops nregs argRegs argVals retRegs

runOpsFresh :: V.Vector UOp -> Int -> [Int] -> [Integer] -> [Int] -> Maybe ([Integer], Int)
runOpsFresh = runOpsWithStack False

runOpsWithStack :: Bool -> V.Vector UOp -> Int -> [Int] -> [Integer] -> [Int] -> Maybe ([Integer], Int)
runOpsWithStack reuseStack ops nregs argRegs argVals _retRegs =
  runST $ do
    let totalRegs = if reuseStack then pureStackRegs ops nregs else nregs
    regs <- MV.replicate totalRegs (0 :: Integer)
    zipWithM_ (MV.unsafeWrite regs) argRegs argVals
    let readReg base r = MV.unsafeRead regs (base + r)
        writeReg base r v = MV.unsafeWrite regs (base + r) v
        go ops' !base !frameRegs !pc !gas
          | pc >= V.length ops' = pure Nothing
          | otherwise = dispatch ops' base frameRegs pc gas (ops' V.! pc)
        dispatch ops' !base !frameRegs !pc !gas = \case
            URet rs -> pure $ Just (rs, gas)
            ULit d k -> writeReg base d k >> go ops' base frameRegs (pc + 1) gas
            UMov d a -> readReg base a >>= writeReg base d >> go ops' base frameRegs (pc + 1) gas
            UAdd d a b -> bin ops' base frameRegs d a b (+) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            USub d a b -> bin ops' base frameRegs d a b (-) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            UMul d a b -> bin ops' base frameRegs d a b (*) ((+) `on` byteWidth) (pc + 1) gas
            UExp d a b -> do
              x <- readReg base a
              y <- readReg base b
              if y < 0 || y > toInteger (maxBound :: Int)
                then pure Nothing
                else do
                  writeReg base d (x ^ y)
                  go ops' base frameRegs (pc + 1) (gas + gasForOp (byteWidth x) * (1 + fromInteger y))
            UDiv d a b -> do
              x <- readReg base a
              y <- readReg base b
              if y == 0
                then pure Nothing
                else do
                  writeReg base d (x `div` y)
                  go ops' base frameRegs (pc + 1) (gas + gasForOp (byteWidth x) + gasForOp (byteWidth y))
            UMod d a b -> do
              x <- readReg base a
              y <- readReg base b
              if y == 0
                then pure Nothing
                else do
                  writeReg base d (x `rem` y)
                  go ops' base frameRegs (pc + 1) (gas + gasForOp (byteWidth y))
            UShl d a b -> bin ops' base frameRegs d a b (\x i -> x `shift` fromInteger i) (\a0 _ -> byteWidth a0 + 32) (pc + 1) gas
            UShr d a b -> bin ops' base frameRegs d a b (\x i -> x `shiftR` fromInteger i) (\a0 _ -> byteWidth a0) (pc + 1) gas
            UAndB d a b -> bin ops' base frameRegs d a b (.&.) (max `on` byteWidth) (pc + 1) gas
            UOrB d a b -> bin ops' base frameRegs d a b (.|.) (max `on` byteWidth) (pc + 1) gas
            UXor d a b -> bin ops' base frameRegs d a b xor (max `on` byteWidth) (pc + 1) gas
            UNot d a -> do
              x <- readReg base a
              writeReg base d (if x == 0 then 1 else 0)
              go ops' base frameRegs (pc + 1) gas
            ULt d a b -> cmp ops' base frameRegs d a b (<) (pc + 1) gas
            UGt d a b -> cmp ops' base frameRegs d a b (>) (pc + 1) gas
            ULe d a b -> cmp ops' base frameRegs d a b (<=) (pc + 1) gas
            UGe d a b -> cmp ops' base frameRegs d a b (>=) (pc + 1) gas
            UEq d a b -> cmp ops' base frameRegs d a b (==) (pc + 1) gas
            UNeq d a b -> cmp ops' base frameRegs d a b (/=) (pc + 1) gas
            UJmp t -> go ops' base frameRegs t gas
            UJmpZ c t -> do
              x <- readReg base c
              go ops' base frameRegs (if x == 0 then t else pc + 1) gas
            UReq c -> do
              x <- readReg base c
              if x == 0 then pure Nothing else go ops' base frameRegs (pc + 1) gas
            UReqJ c t -> do
              x <- readReg base c
              go ops' base frameRegs (if x == 0 then t else pc + 1) gas
            UReqNonNegative r -> do
              x <- readReg base r
              if x < 0 then pure Nothing else go ops' base frameRegs (pc + 1) gas
            UReqNonNegativeJ r t -> do
              x <- readReg base r
              go ops' base frameRegs (if x < 0 then t else pc + 1) gas
            UCharge n ->
              let !nextPc = pc + 1
                  !nextGas = gas + fromIntegral n
               in if nextPc >= V.length ops'
                    then pure Nothing
                    else dispatch ops' base frameRegs nextPc nextGas (ops' V.! nextPc)
            ULabel _ -> go ops' base frameRegs (pc + 1) gas
            UCallPure cops cnregs cargRegs cretRegs srcRegs dests -> do
              if reuseStack
                then do
                  let childBase = base + frameRegs
                  forM_ cretRegs $ \r -> writeReg childBase r 0
                  zipWithM_ (\c s -> readReg base s >>= writeReg childBase c) cargRegs srcRegs
                  nestedResult <- go cops childBase cnregs 0 0
                  case nestedResult of
                    Nothing -> do
                      let !_ = logMiss ("run-nested-miss-st pc=" ++ show pc)
                      pure Nothing
                    Just (childRets, cost) -> do
                      zipWithM_ (\d r -> readReg childBase r >>= writeReg base d) dests childRets
                      go ops' base frameRegs (pc + 1) (gas + cost)
                else do
                  callArgs <- mapM (readReg base) srcRegs
                  case runOpsFresh cops cnregs cargRegs callArgs cretRegs of
                    Nothing -> pure Nothing
                    Just (vs, cost) -> do
                      zipWithM_ (writeReg base) dests vs
                      go ops' base frameRegs (pc + 1) (gas + cost)
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
            UEventSload {} -> pure Nothing
            USstore {} -> pure Nothing
            USstoreAt {} -> pure Nothing
            UArrayNew {} -> pure Nothing
            UArrayMov {} -> pure Nothing
            UArrayPush {} -> pure Nothing
            UArrayLoadStorage {} -> pure Nothing
            UArrayStoreStorage {} -> pure Nothing
            UArrayLen {} -> pure Nothing
            UArrayGet {} -> pure Nothing
            UArraySet {} -> pure Nothing
            UObjectLit {} -> pure Nothing
            UObjectMov {} -> pure Nothing
            UDecimalTruncate {} -> pure Nothing
            UDecimalDiv {} -> pure Nothing
            UObjectEq {} -> pure Nothing
            UObjectSstore {} -> pure Nothing
            UObjectSstoreAt {} -> pure Nothing
            UDynamicCall {} -> pure Nothing
            UHostBuiltin {} -> pure Nothing
            UHostTupleBuiltin {} -> pure Nothing
            UPathGet {} -> pure Nothing
            UPathGetAt {} -> pure Nothing
            UPathSet {} -> pure Nothing
            UPathSetAt {} -> pure Nothing
            UPathDelete {} -> pure Nothing
            UPathDeleteAt {} -> pure Nothing
            UEmit {} -> pure Nothing
            UTimestamp {} -> pure Nothing
            UNumber {} -> pure Nothing
            UFallback ->
              let !_ = logMiss "run-fallback-st"
               in pure Nothing
        bin ops' base frameRegs d a b f gasF npc g0 = do
          x <- readReg base a
          y <- readReg base b
          let !z = f x y
          writeReg base d z
          go ops' base frameRegs npc (g0 + gasForOp (gasF x y))
        cmp ops' base frameRegs d a b f npc g0 = do
          x <- readReg base a
          y <- readReg base b
          writeReg base d (if f x y then 1 else 0)
          go ops' base frameRegs npc g0
    result <- go ops 0 nregs 0 (0 :: Int)
    case result of
      Nothing -> pure Nothing
      Just (rs, gas) -> do
        vs <- mapM (readReg 0) rs
        let !_ = logMiss ("run-ret-st vs=" ++ show vs ++ " gas=" ++ show gas)
        pure $ Just (vs, gas)

type Compiled = (V.Vector UOp, Int, [Int], [Int])

data CacheEntry = CacheEntry !(StableName CodeCollection) !(M.Map String (Maybe Compiled))

-- A full CodeCollection can retain large isolated op trees. Testnet creates
-- many one-off contracts with distinct CodeCollection identities, so an
-- unbounded process-global cache grows until the replay is killed. Keep the
-- newest working set; eviction only costs recompilation and cannot change VM
-- semantics.
maxCachedCodeCollections :: Int
maxCachedCodeCollections = 16

boundCache :: [CacheEntry] -> [CacheEntry]
boundCache = take maxCachedCodeCollections

fastIRCacheEntryCounts :: IO (Int, Int)
fastIRCacheEntryCounts =
  (,) <$> (length <$> readIORef compiledCache) <*> (length <$> readIORef isolateCache)

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
      maybe 0 length (CC._funcContents func),
      labelToString . fst <$> CC._funcModifiers func
    )

{-# NOINLINE isolateCompiling #-}
isolateCompiling :: IORef [String]
isolateCompiling = unsafePerformIO $ newIORef []

-- Cache miss compiles purely via compileAnyFunc (nested calls become
-- UCallPure/UCallStorage). Never calls cachedCompile.
-- Recompiling loop-free pure helpers with inlining (`True True`) hung
-- Pool.swap (patched jumps in inlined FullMath/SqrtPriceMath).
isolateCached :: CodeCollection -> Contract -> Func -> Maybe Compiled
isolateCached cc contract func = unsafePerformIO $ do
  snCC <- makeStableName $! cc
  let k = funcCacheKey contract func
      lookupCC [] = Nothing
      lookupCC (CacheEntry sn m : rest)
        | eqStableName sn snCC = Just m
        | otherwise = lookupCC rest
      store cache compiled = case lookupCC cache of
        Just m ->
          writeIORef isolateCache $
            boundCache $
              CacheEntry snCC (M.insert k compiled m)
                : [e | e@(CacheEntry sn _) <- cache, not (eqStableName sn snCC)]
        Nothing ->
          writeIORef isolateCache . boundCache $
            CacheEntry snCC (M.singleton k compiled) : cache
  cache <- readIORef isolateCache
  case lookupCC cache >>= M.lookup k of
    Just cached -> pure cached
    Nothing -> do
      compiling <- readIORef isolateCompiling
      if k `elem` compiling
        then pure Nothing
        else do
          modifyIORef' isolateCompiling (k :)
          -- Force the full op tree before clearing the recursion guard or
          -- publishing it. Caching the lazy compile thunk allowed a nested
          -- lookup to retrieve the thunk currently evaluating and raise
          -- <<loop>> in consensus execution.
          compiled <-
            evaluate (force $ compileAnyFuncWith False True cc contract func)
              `finally` modifyIORef' isolateCompiling (filter (/= k))
          latest <- readIORef isolateCache
          store latest compiled
          pure compiled
{-# NOINLINE isolateCached #-}

cachedCompile :: CodeCollection -> Contract -> Func -> Maybe Compiled
cachedCompile cc contract func = unsafePerformIO $ do
  snCC <- makeStableName $! cc
  let k = funcCacheKey contract func
  compiling <- readIORef compilingKeys
  if k `elem` compiling
    then pure Nothing
    else do
      cache <- readIORef compiledCache
      let lookupCC [] = Nothing
          lookupCC (CacheEntry sn m : rest)
            | eqStableName sn snCC = Just m
            | otherwise = lookupCC rest
      case lookupCC cache >>= M.lookup k of
        Just compiled -> pure compiled
        Nothing -> do
          modifyIORef' compilingKeys (k :)
          compiled <-
            evaluate (force $ compileAnyFunc cc contract func)
              `finally` modifyIORef' compilingKeys (filter (/= k))
          latest <- readIORef compiledCache
          let storeLatest value = case lookupCC latest of
                Just m ->
                  writeIORef compiledCache $
                    boundCache $
                      CacheEntry snCC (M.insert k value m)
                        : [e | e@(CacheEntry sn _) <- latest, not (eqStableName sn snCC)]
                Nothing ->
                  writeIORef compiledCache . boundCache $
                    CacheEntry snCC (M.singleton k value) : latest
          storeLatest compiled
          pure compiled
{-# NOINLINE cachedCompile #-}

funcLowers :: CodeCollection -> Contract -> Func -> Bool
funcLowers cc contract func = isJust (cachedCompile cc contract func)

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
  UEventSload {} -> True
  USstore {} -> True
  USstoreAt {} -> True
  UArrayNew {} -> True
  UArrayMov {} -> True
  UArrayPush {} -> True
  UArrayLoadStorage {} -> True
  UArrayStoreStorage {} -> True
  UArrayLen {} -> True
  UArrayGet {} -> True
  UArraySet {} -> True
  UDecimalTruncate {} -> True
  UDecimalDiv {} -> True
  UObjectEq {} -> True
  UObjectSstore {} -> True
  UObjectSstoreAt {} -> True
  UDynamicCall {} -> True
  UHostBuiltin {} -> True
  UHostTupleBuiltin {} -> True
  UPathGet {} -> True
  UPathGetAt {} -> True
  UPathSet {} -> True
  UPathSetAt {} -> True
  UPathDelete {} -> True
  UPathDeleteAt {} -> True
  UEmit {} -> True
  UTimestamp {} -> True
  UNumber {} -> True
  UFallback -> True
  UCallStorage {} -> True
  _ -> False


mutatingStorageOp :: UOp -> Bool
mutatingStorageOp = \case
  UMapSet {} -> True
  UMapSetAt {} -> True
  UMapSet2 {} -> True
  UMapSet2At {} -> True
  USstore {} -> True
  USstoreAt {} -> True
  UObjectSstore {} -> True
  UObjectSstoreAt {} -> True
  UArrayStoreStorage {} -> True
  UPathSet {} -> True
  UPathSetAt {} -> True
  UPathDelete {} -> True
  UPathDeleteAt {} -> True
  UDynamicCall {} -> True
  _ -> False

hasBackEdge :: V.Vector UOp -> Bool
hasBackEdge =
  V.any id . V.imap
    ( \i op -> case op of
        UJmp t -> t <= i
        UJmpZ _ t -> t <= i
        _ -> False
    )

-- Helium Pool._internalSwapForZap nested Token.transfer under the caller's
-- hooks and diverged block 1336. Do not skip loop frames (erc20/swap benches
-- IR-lower a for/while that calls transfer/swap).
skipExternalMutFrame :: V.Vector UOp -> Bool
skipExternalMutFrame ops =
  not (hasBackEdge ops)
    && V.length ops < 220
    && V.all (/= UFallback) ops
    && V.any isExtMut ops
  where
    isExtMut (UCallStorage nested _ _ _ _ (Just _)) = V.any mutatingStorageOp nested
    isExtMut _ = False

-- A normal UFallback is transactional only while all writes remain in this
-- interpreter's buffers. Deletes and dynamic calls must cross the hook
-- boundary immediately; if a reachable later branch falls back, the
-- authoritative AST frame would restart after those effects had escaped.
-- Track the two-state control-flow graph so disjoint commit/fallback branches
-- keep their fast path while every commit-to-fallback path fails closed.
skipEscapingFallbackFrame :: V.Vector UOp -> Bool
skipEscapingFallbackFrame ops = walk Set.empty [(0, False)]
  where
    walk _ [] = False
    walk seen ((pc, escaped) : pending)
      | pc < 0 || pc >= V.length ops = walk seen pending
      | Set.member (pc, escaped) seen = walk seen pending
      | otherwise =
          let seen' = Set.insert (pc, escaped) seen
              next escaped' = walk seen' ((pc + 1, escaped') : pending)
              branch target = walk seen' ((target, escaped) : (pc + 1, escaped) : pending)
           in case ops V.! pc of
                UFallback -> escaped || walk seen' pending
                URet {} -> walk seen' pending
                UJmp target -> walk seen' ((target, escaped) : pending)
                UJmpZ _ target -> branch target
                UReqJ _ target -> branch target
                UReqNonNegativeJ _ target -> branch target
                UCallStorage nested _ _ _ _ _
                  | skipEscapingFallbackFrame nested -> True
                  | otherwise -> next (escaped || canCommit nested)
                op -> next (escaped || commits op)
    commits = \case
      UPathDelete {} -> True
      UPathDeleteAt {} -> True
      UDynamicCall {} -> True
      _ -> False
    canCommit = V.any $ \case
      UCallStorage nested _ _ _ _ _ -> canCommit nested
      op -> commits op

runAnyUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runAnyUIntIR cc contract func args = do
  let !_ =
        logMiss
          ( "run-pure-entry "
              ++ labelToString (contract ^. CC.contractName)
              ++ " "
              ++ take 60 (show (CC._funcContext func))
              ++ " args="
              ++ show args
          )
  (ops, nregs, argRegs, retRegs) <- cachedCompile cc contract func
  guard $ length argRegs == length args
  guard $ all (>= 0) argRegs
  guard $ not (needsStorage ops)
  runOps ops nregs argRegs args retRegs

data StoragePathPiece
  = StorageField !SolidString
  | StorageIndex !Integer !Bool
  | StorageOpaqueIndex !Value
  deriving (Eq, Ord, Show, Generic, NFData)

data FastValue
  = FastScalar !Integer
  | FastArray ![Integer]
  | FastOpaque !Value
  deriving (Eq, Show, Generic, NFData)

data PendingStorageWrite
  = PendingMapSet !Integer !SolidString !Integer !Integer !Bool !ScalarStorageEncoding
  | PendingMapSet2 !Integer !SolidString !Integer !Bool !Integer !Integer !Bool
  | PendingScalarSet !Integer !SolidString !Integer
  | PendingObjectSet !Integer !SolidString !FastValue
  | PendingPathSet !Integer !SolidString ![StoragePathPiece] !Integer
  deriving (Eq, Show, Generic, NFData)

data StorageHooks m = StorageHooks
  { shSender :: m Integer,
    shMapGet :: SolidString -> Integer -> Bool -> m Integer,
    shMapSet :: SolidString -> Integer -> Integer -> Bool -> m (),
    shMapGetAt :: Integer -> SolidString -> Integer -> Bool -> m (Integer, Bool),
    shMapSetAt :: Integer -> SolidString -> Integer -> Integer -> Bool -> m (),
    shMapGet2At :: Integer -> SolidString -> Integer -> Bool -> Integer -> Bool -> m (Integer, Bool),
    shMapSet2At :: Integer -> SolidString -> Integer -> Bool -> Integer -> Integer -> Bool -> m (),
    shSloadAddr :: SolidString -> m Integer,
    shSloadAt :: Integer -> SolidString -> m (Integer, Bool),
    shEventSloadAt :: Integer -> SolidString -> Maybe FastValue -> m FastValue,
    shSstore :: SolidString -> Integer -> m (),
    shSstoreAt :: Integer -> SolidString -> Integer -> m (),
    shObjectSstoreAt :: Integer -> SolidString -> FastValue -> m (),
    shPathGetAt :: Integer -> SolidString -> [StoragePathPiece] -> m (Integer, Bool),
    shPathSetAt :: Integer -> SolidString -> [StoragePathPiece] -> Integer -> m (),
    shPathDeleteAt :: Integer -> SolidString -> [StoragePathPiece] -> m (),
    shWriteMany :: [PendingStorageWrite] -> m (),
    shInvalidateReads :: m (),
    shThis :: m Integer,
    shTimestamp :: m Integer,
    shNumber :: m Integer,
    shDynamicCall :: Bool -> DynamicCallKind -> Integer -> FastValue -> [(HostArgKind, FastValue)] -> m (Maybe FastValue),
    shBuiltin :: String -> [(HostArgKind, FastValue)] -> m FastValue,
    shEmit :: String -> [FastValue] -> m (),
    shEmitMany :: [(String, [FastValue])] -> m ()
  }

type ScalarK = (Integer, SolidString)

type MapK = (Integer, SolidString, Integer)

type Map2K = (Integer, SolidString, Integer, Integer)

type PathK = (Integer, SolidString, [StoragePathPiece])

runAnyStorageIR ::
  MonadUnliftIO m =>
  StorageHooks m ->
  CodeCollection ->
  Contract ->
  Func ->
  [Integer] ->
  m (Maybe ([Integer], Integer))
runAnyStorageIR hooks cc contract func args =
  runAnyStorageIRArgs hooks cc contract func (FastScalar <$> args) >>= \case
    Just (values, gas) ->
      pure $ (\scalars -> (scalars, gas)) <$> traverse (\case FastScalar n -> Just n; _ -> Nothing) values
    Nothing -> pure Nothing

runAnyStorageIRArgs ::
  MonadUnliftIO m =>
  StorageHooks m ->
  CodeCollection ->
  Contract ->
  Func ->
  [FastValue] ->
  m (Maybe ([FastValue], Integer))
runAnyStorageIRArgs hooks cc contract func args
  | any isOpaque args
  , not opaqueArgsEnabled = pure Nothing
  | otherwise = case cachedCompile cc contract func of
    Just (ops, nregs, argRegs, retRegs)
      | length argRegs == length args
      , bindingsMatch argRegs args
      , needsStorage ops
      , skipEscapingFallbackFrame ops ->
          let !_ = logMiss ("run-skip-escaping-fallback " ++ labelToString (contract ^. CC.contractName))
           in pure Nothing
      | length argRegs == length args
      , bindingsMatch argRegs args
      , needsStorage ops
      , skipExternalMutFrame ops ->
          let !_ = logMiss ("run-skip-extmut " ++ labelToString (contract ^. CC.contractName))
           in pure Nothing
      | length argRegs == length args
      , bindingsMatch argRegs args
      , needsStorage ops ->
          let tag =
                labelToString (contract ^. CC.contractName)
                  ++ "."
                  ++ functionLabel contract func
                  ++ " ops="
                  ++ show (V.length ops)
                  ++ " nregs="
                  ++ show nregs
                  ++ " "
                  ++ take 60 (show (CC._funcContext func))
                  ++ " args="
                  ++ show args
           in runOpsM
            tag
            hooks
            ops
            nregs
            argRegs
            args
            retRegs
      | length argRegs == length args
      , bindingsMatch argRegs args
      , any isOpaque args ->
          runOpsM
            (labelToString (contract ^. CC.contractName))
            hooks
            ops
            nregs
            argRegs
            args
            retRegs
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
    Nothing ->
      let !_ =
            logMiss
              ( "run-nocompile "
                  ++ labelToString (contract ^. CC.contractName)
                  ++ "."
                  ++ functionLabel contract func
              )
       in pure Nothing
  where
    opaqueArgsEnabled =
      labelToString (contract ^. CC.contractName) `elem` ["AdminRegistry", "StringUtils", "BytesUtils", "DACommitment"]
    bindingsMatch bindings values = and $ zipWith matches bindings values
    isOpaque FastOpaque {} = True
    isOpaque _ = False
    matches binding FastScalar {} = binding >= 0
    matches binding FastArray {} = isArrayBinding binding
    matches binding FastOpaque {} = isJust $ objectSlot binding

runOpsM ::
  MonadUnliftIO m =>
  String ->
  StorageHooks m ->
  V.Vector UOp ->
  Int ->
  [Int] ->
  [FastValue] ->
  [Int] ->
  m (Maybe ([FastValue], Integer))
runOpsM tag hooks ops nregs argRegs argVals _retRegs = withRunInIO $ \run ->
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
  defaults <- MV.replicate nregs False
  let argBindings = zip argRegs argVals
  arrayPairs <-
    forM
      [ (slot, values)
      | (binding, FastArray values) <- argBindings,
        Just slot <- [arraySlot binding]
      ] $
      \(slot, values) -> do
        mutableValues <- V.thaw $ V.fromList values
        pure (slot, mutableValues)
  arrays <- newSTRef $ M.fromList arrayPairs
  objects <- newSTRef . M.fromList $
    [ (slot, value)
    | (binding, value@FastOpaque {}) <- argBindings,
      Just slot <- [objectSlot binding]
    ]
  forM_ argBindings $ \case
    (binding, FastScalar value) -> MV.write regs binding value
    (_, FastArray {}) -> pure ()
    (_, FastOpaque {}) -> pure ()
  cache <- newSTRef (M.empty :: M.Map MapK (Integer, Bool))
  dirty <- newSTRef (M.empty :: M.Map MapK (Integer, Bool, ScalarStorageEncoding))
  cache2 <- newSTRef (M.empty :: M.Map Map2K (Integer, Bool))
  dirty2 <- newSTRef (M.empty :: M.Map Map2K (Integer, Bool, Bool))
  sload <- newSTRef (M.empty :: M.Map ScalarK (Integer, Bool))
  sdirty <- newSTRef (M.empty :: M.Map ScalarK Integer)
  objectDirty <- newSTRef (M.empty :: M.Map ScalarK FastValue)
  pathCache <- newSTRef (M.empty :: M.Map PathK (Integer, Bool))
  pathDirty <- newSTRef (M.empty :: M.Map PathK Integer)
  evs <- newSTRef ([] :: [(String, [FastValue])])
  let flushPending = do
        d <- readSTRef dirty
        d2 <- readSTRef dirty2
        sd <- readSTRef sdirty
        od <- readSTRef objectDirty
        pd <- readSTRef pathDirty
        let pendingWrites =
              [ PendingMapSet addr name key val isAddr encoding
              | ((addr, name, key), (val, isAddr, encoding)) <- M.toList d
              ]
                ++ [ PendingMapSet2 addr name k1 ia1 k2 val ia2
                   | ((addr, name, k1, k2), (val, ia1, ia2)) <- M.toList d2
                   ]
                ++ [ PendingScalarSet addr field val
                   | ((addr, field), val) <- M.toList sd
                   ]
                ++ [ PendingObjectSet addr field value
                   | ((addr, field), value) <- M.toList od
                   ]
                ++ [ PendingPathSet addr root pieces val
                   | ((addr, root, pieces), val) <- M.toList pd
                   ]
        unless (null pendingWrites) $ io $ shWriteMany hooks pendingWrites
        writeSTRef dirty M.empty
        writeSTRef dirty2 M.empty
        writeSTRef sdirty M.empty
        writeSTRef objectDirty M.empty
        writeSTRef pathDirty M.empty
        buffered <- reverse <$> readSTRef evs
        unless (null buffered) $ io $ shEmitMany hooks buffered
        writeSTRef evs []
      invalidateReads = do
        writeSTRef cache M.empty
        writeSTRef cache2 M.empty
        writeSTRef sload M.empty
        writeSTRef pathCache M.empty
        io $ shInvalidateReads hooks
      getMap addr name key isAddr = do
        c <- readSTRef cache
        case M.lookup (addr, name, key) c of
          Just v -> pure v
          Nothing -> do
            tagged <- io $ shMapGetAt hooks addr name key isAddr
            modifySTRef' cache (M.insert (addr, name, key) tagged)
            pure tagged
      setMap addr name key val isAddr encoding = do
        modifySTRef' cache (M.insert (addr, name, key) (val, False))
        modifySTRef' dirty (M.insert (addr, name, key) (val, isAddr, encoding))
      getMap2 addr name k1 ia1 k2 ia2 = do
        c <- readSTRef cache2
        case M.lookup (addr, name, k1, k2) c of
          Just v -> pure v
          Nothing -> do
            tagged <- io $ shMapGet2At hooks addr name k1 ia1 k2 ia2
            modifySTRef' cache2 (M.insert (addr, name, k1, k2) tagged)
            pure tagged
      setMap2 addr name k1 ia1 k2 val ia2 = do
        modifySTRef' cache2 (M.insert (addr, name, k1, k2) (val, False))
        modifySTRef' dirty2 (M.insert (addr, name, k1, k2) (val, ia1, ia2))
      getSload addr field = do
        c <- readSTRef sload
        case M.lookup (addr, field) c of
          Just v -> pure v
          Nothing -> do
            tagged <- io $ shSloadAt hooks addr field
            modifySTRef' sload (M.insert (addr, field) tagged)
            pure tagged
      setSload addr field val = do
        modifySTRef' sload (M.insert (addr, field) (val, False))
        modifySTRef' sdirty (M.insert (addr, field) val)
      getPath addr root pieces = do
        c <- readSTRef pathCache
        case M.lookup (addr, root, pieces) c of
          Just v -> pure v
          Nothing -> do
            tagged <- io $ shPathGetAt hooks addr root pieces
            modifySTRef' pathCache (M.insert (addr, root, pieces) tagged)
            pure tagged
      setPath addr root pieces val = do
        modifySTRef' pathCache (M.insert (addr, root, pieces) (val, False))
        modifySTRef' pathDirty (M.insert (addr, root, pieces) val)
      resolvePath regs' defaults' steps = sequence <$> forM steps (\case
        PField field -> pure $ Just (StorageField field)
        PIndex reg isAddr -> do
          -- BDefault is the typed zero value for the uint/address shapes
          -- accepted by this IR. It is therefore also a valid index key.
          value <- MV.read regs' reg
          pure . Just $ StorageIndex value isAddr
        PObjectIndex ref ->
          readFastValue regs' defaults' ref >>= \case
            Just (FastOpaque value) -> pure . Just $ StorageOpaqueIndex value
            _ -> pure Nothing)
      anyDefault defaults' rs = or <$> mapM (MV.read defaults') rs
      markKnown defaults' rs = forM_ rs $ \r -> MV.write defaults' r False
      readFastValue regs' defaults' ref
        | ref >= 0 = do
            bad <- MV.read defaults' ref
            if bad
              then pure Nothing
              else Just . FastScalar <$> MV.read regs' ref
        | otherwise = case objectSlot ref of
            Just slot -> M.lookup slot <$> readSTRef objects
            Nothing -> case arraySlot ref of
              Nothing -> pure Nothing
              Just slot -> do
                currentArrays <- readSTRef arrays
                case M.lookup slot currentArrays of
                  Nothing -> pure Nothing
                  Just values -> Just . FastArray . V.toList <$> V.freeze values
      writeFastValue regs' defaults' ref = \case
        FastScalar value | ref >= 0 -> do
          MV.write regs' ref value
          MV.write defaults' ref False
          pure True
        FastOpaque value | ref >= 0, Just scalar <- scalarOpaque value -> do
          MV.write regs' ref scalar
          MV.write defaults' ref False
          pure True
        value@FastOpaque {} | Just slot <- objectSlot ref -> do
          modifySTRef' objects (M.insert slot value)
          pure True
        FastArray values | Just slot <- arraySlot ref -> do
          mutableValues <- V.thaw $ V.fromList values
          modifySTRef' arrays (M.insert slot mutableValues)
          pure True
        _ -> pure False
      scalarOpaque = \case
        SInteger value -> Just value
        SBool value -> Just $ if value then 1 else 0
        SAddress value _ -> Just $ toInteger value
        SContract _ value -> Just $ toInteger value
        _ -> Nothing
      readFastValues regs' defaults' refs =
        sequence <$> traverse (readFastValue regs' defaults') refs
      execGo regs' defaults' ops' !pc !gas
        | pc >= V.length ops' =
            let !_ = logMiss ("run-end n=" ++ show (V.length ops'))
             in pure Nothing
        | otherwise = dispatch regs' defaults' ops' pc gas (ops' V.! pc)
      dispatch regs' defaults' ops' !pc !gas = \case
            URet rs -> do
              readFastValues regs' defaults' rs >>= \case
                Nothing -> pure Nothing
                Just vs -> do
                  let !_ = logMiss ("run-ret " ++ tag ++ " vs=" ++ show vs ++ " gas=" ++ show gas)
                  pure $ Just (vs, toInteger gas)
            ULit d k -> do
              MV.write regs' d k
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            UMov d a -> do
              value <- MV.read regs' a
              MV.write regs' d value
              MV.read defaults' a >>= MV.write defaults' d
              execGo regs' defaults' ops' (pc + 1) gas
            UObjectLit dest value -> do
              ok <- writeFastValue regs' defaults' dest (FastOpaque value)
              if ok then execGo regs' defaults' ops' (pc + 1) gas else pure Nothing
            UObjectMov dest src -> do
              readFastValue regs' defaults' src >>= \case
                Nothing -> pure Nothing
                Just value -> do
                  ok <- writeFastValue regs' defaults' dest value
                  if ok then execGo regs' defaults' ops' (pc + 1) gas else pure Nothing
            UDecimalTruncate dest src placesRef -> do
              source <- readFastValue regs' defaults' src
              badPlaces <- MV.read defaults' placesRef
              places <- MV.read regs' placesRef
              case source of
                Just (FastOpaque (SDecimal value))
                  | not badPlaces,
                    places >= 0,
                    places <= 255 -> do
                      ok <- writeFastValue regs' defaults' dest . FastOpaque . SDecimal $
                        roundTo' truncate (fromInteger places) value
                      if ok then execGo regs' defaults' ops' (pc + 1) (gas + 1) else pure Nothing
                _ -> pure Nothing
            UDecimalDiv dest leftRef rightRef -> do
              leftValue <- readFastValue regs' defaults' leftRef
              rightValue <- readFastValue regs' defaults' rightRef
              case (leftValue, rightValue) of
                (Just (FastOpaque (SDecimal left)), Just (FastOpaque (SDecimal right)))
                  | right /= 0 -> do
                      let places = max (decimalPlaces left) (decimalPlaces right)
                          result = roundTo places (left / right)
                          opGas = gasForOp $ fromIntegral places + max (byteWidth $ decimalMantissa left) (byteWidth $ decimalMantissa right)
                      ok <- writeFastValue regs' defaults' dest (FastOpaque $ SDecimal result)
                      if ok then execGo regs' defaults' ops' (pc + 1) (gas + opGas) else pure Nothing
                _ -> pure Nothing
            UObjectEq dest leftRef rightRef -> do
              leftValue <- readFastValue regs' defaults' leftRef
              rightValue <- readFastValue regs' defaults' rightRef
              case (leftValue, rightValue) of
                (Just left, Just right) -> do
                  MV.write regs' dest (if left == right then 1 else 0)
                  MV.write defaults' dest False
                  execGo regs' defaults' ops' (pc + 1) gas
                _ -> pure Nothing
            UObjectSstore field src -> do
              readFastValue regs' defaults' src >>= \case
                Nothing -> pure Nothing
                Just value -> do
                  this <- getThis
                  modifySTRef' objectDirty (M.insert (this, field) value)
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UObjectSstoreAt field src calleeRef -> do
              badCallee <- MV.read defaults' calleeRef
              value <- readFastValue regs' defaults' src
              if badCallee
                then pure Nothing
                else case value of
                  Nothing -> pure Nothing
                  Just objectValue -> do
                    callee <- MV.read regs' calleeRef
                    modifySTRef' objectDirty (M.insert (callee, field) objectValue)
                    execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UDynamicCall dest callKind target functionRef argRefs catchTarget -> do
              badTarget <- MV.read defaults' target
              mf <- readFastValue regs' defaults' functionRef
              argValues <- traverse (\(ref, kind) -> fmap ((,) kind) <$> readFastValue regs' defaults' ref) argRefs
              if badTarget
                then pure Nothing
                else case (mf, sequence argValues) of
                  (Just functionValue, Just values) -> do
                    targetValue <- MV.read regs' target
                    -- The callee must observe all writes that precede the call,
                    -- and any writes it makes must not be hidden by stale read
                    -- snapshots or by a delayed parent flush.
                    flushPending
                    result <- io $ shDynamicCall hooks (isJust catchTarget) callKind targetValue functionValue values
                    invalidateReads
                    case result of
                      Just value -> do
                        ok <- writeFastValue regs' defaults' dest value
                        if ok then execGo regs' defaults' ops' (pc + 1) gas else pure Nothing
                      Nothing -> case catchTarget of
                        Just targetPc -> execGo regs' defaults' ops' targetPc gas
                        Nothing -> pure Nothing
                  _ -> pure Nothing
            UHostBuiltin dest builtinName refs -> do
              values <- traverse (\(ref, kind) -> fmap ((,) kind) <$> readFastValue regs' defaults' ref) refs
              case sequence values of
                Nothing -> pure Nothing
                Just argsWithKinds -> do
                  result <- io $ shBuiltin hooks builtinName argsWithKinds
                  ok <- writeFastValue regs' defaults' dest result
                  if ok then execGo regs' defaults' ops' (pc + 1) gas else pure Nothing
            UHostTupleBuiltin dests builtinName refs -> do
              values <- traverse (\(ref, kind) -> fmap ((,) kind) <$> readFastValue regs' defaults' ref) refs
              case sequence values of
                Nothing -> pure Nothing
                Just argsWithKinds -> do
                  result <- io $ shBuiltin hooks builtinName argsWithKinds
                  case result of
                    FastArray tupleValues
                      | length dests == length tupleValues -> do
                          zipWithM_ (\dest value -> MV.write regs' dest value >> MV.write defaults' dest False) dests tupleValues
                          execGo regs' defaults' ops' (pc + 1) gas
                    _ -> pure Nothing
            UAdd d a b -> bin d a b (+) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            USub d a b -> bin d a b (-) (\x y -> 1 + (max `on` byteWidth) x y) (pc + 1) gas
            UMul d a b -> bin d a b (*) ((+) `on` byteWidth) (pc + 1) gas
            UExp d a b -> do
              x <- MV.read regs' a
              y <- MV.read regs' b
              if y < 0 || y > toInteger (maxBound :: Int)
                then pure Nothing
                else do
                  MV.write regs' d (x ^ y)
                  MV.write defaults' d False
                  execGo regs' defaults' ops' (pc + 1) (gas + gasForOp (byteWidth x) * (1 + fromInteger y))
            UDiv d a b -> do
              x <- MV.read regs' a
              y <- MV.read regs' b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs' d (x `div` y)
                  MV.write defaults' d False
                  execGo regs' defaults' ops' (pc + 1) (gas + gasForOp (byteWidth x) + gasForOp (byteWidth y))
            UMod d a b -> do
              x <- MV.read regs' a
              y <- MV.read regs' b
              if y == 0
                then pure Nothing
                else do
                  MV.write regs' d (x `rem` y)
                  MV.write defaults' d False
                  execGo regs' defaults' ops' (pc + 1) (gas + gasForOp (byteWidth y))
            UShl d a b -> bin d a b (\x i -> x `shift` fromInteger i) (\a0 _ -> byteWidth a0 + 32) (pc + 1) gas
            UShr d a b -> bin d a b (\x i -> x `shiftR` fromInteger i) (\a0 _ -> byteWidth a0) (pc + 1) gas
            UAndB d a b -> bin d a b (.&.) (max `on` byteWidth) (pc + 1) gas
            UOrB d a b -> bin d a b (.|.) (max `on` byteWidth) (pc + 1) gas
            UXor d a b -> bin d a b xor (max `on` byteWidth) (pc + 1) gas
            UNot d a -> do
              x <- MV.read regs' a
              MV.write regs' d (if x == 0 then 1 else 0)
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            ULt d a b -> cmp d a b (<) (pc + 1) gas
            UGt d a b -> cmp d a b (>) (pc + 1) gas
            ULe d a b -> cmp d a b (<=) (pc + 1) gas
            UGe d a b -> cmp d a b (>=) (pc + 1) gas
            UEq d a b -> cmp d a b (==) (pc + 1) gas
            UNeq d a b -> cmp d a b (/=) (pc + 1) gas
            UJmp t -> execGo regs' defaults' ops' t gas
            UJmpZ c t -> do
              x <- MV.read regs' c
              execGo regs' defaults' ops' (if x == 0 then t else pc + 1) gas
            UReq c -> do
              x <- MV.read regs' c
              if x == 0
                then do
                  let !_ =
                        logMiss
                          ( "run-req "
                              ++ tag
                              ++ " pc="
                              ++ show pc
                              ++ " "
                              ++ take 120 (show (ops' V.! pc))
                              ++ " prev="
                              ++ take 80 (show (ops' V.! max 0 (pc - 1)))
                          )
                  pure Nothing
                else execGo regs' defaults' ops' (pc + 1) gas
            UReqJ c t -> do
              x <- MV.read regs' c
              execGo regs' defaults' ops' (if x == 0 then t else pc + 1) gas
            UReqNonNegative r -> do
              x <- MV.read regs' r
              if x < 0
                then pure Nothing
                else execGo regs' defaults' ops' (pc + 1) gas
            UReqNonNegativeJ r t -> do
              x <- MV.read regs' r
              execGo regs' defaults' ops' (if x < 0 then t else pc + 1) gas
            UCharge n ->
              let !nextPc = pc + 1
                  !nextGas = gas + fromIntegral n
               in if nextPc >= V.length ops'
                    then pure Nothing
                    else dispatch regs' defaults' ops' nextPc nextGas (ops' V.! nextPc)
            ULabel _ -> execGo regs' defaults' ops' (pc + 1) gas
            UCallPure cops cnregs cargRegs _cretRegs srcRegs dests -> do
              callArgs <- mapM (MV.read regs') srcRegs
              case runOpsFresh cops cnregs cargRegs callArgs dests of
                Nothing -> pure Nothing
                Just (vs, cost) -> do
                  zipWithM_ (MV.write regs') dests vs
                  markKnown defaults' dests
                  execGo regs' defaults' ops' (pc + 1) (gas + cost)
            UCallStorage cops cnregs cargRegs srcRegs dests mCallee -> do
              badCallee <- maybe (pure False) (MV.read defaults') mCallee
              if badCallee
                then pure Nothing
                else do
                  callArgs <- mapM (MV.read regs') srcRegs
                  callDefaults <- mapM (MV.read defaults') srcRegs
                  nested <- MV.replicate cnregs (0 :: Integer)
                  nestedDefaults <- MV.replicate cnregs False
                  zipWithM_ (MV.write nested) cargRegs callArgs
                  zipWithM_ (MV.write nestedDefaults) cargRegs callDefaults
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
                  oldArrays <- readSTRef arrays
                  writeSTRef arrays M.empty
                  nestedResult <- execGo nested nestedDefaults cops 0 0
                  writeSTRef arrays oldArrays
                  writeSTRef thisRef oldThis
                  writeSTRef senderRef oldSender
                  case nestedResult of
                    Nothing -> do
                      let !_ = logMiss ("run-nested-miss " ++ tag ++ " pc=" ++ show pc)
                      pure Nothing
                    Just (vs, cost) -> do
                      oks <- zipWithM (writeFastValue regs' defaults') dests vs
                      if and oks
                        then execGo regs' defaults' ops' (pc + 1) (gas + fromIntegral cost)
                        else pure Nothing
            USender d -> do
              s <- getSender
              MV.write regs' d s
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            UThis d -> do
              s <- getThis
              MV.write regs' d s
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            UMapGet d mapName k isAddr -> do
              bad <- MV.read defaults' k
              if bad
                then pure Nothing
                else do
                  key <- MV.read regs' k
                  this <- getThis
                  (v, isDefault) <- getMap this mapName key isAddr
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapSet mapName k v isAddr encoding -> do
              bad <- anyDefault defaults' [k, v]
              if bad
                then pure Nothing
                else do
                  key <- MV.read regs' k
                  val <- MV.read regs' v
                  this <- getThis
                  setMap this mapName key val isAddr encoding
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapGetAt d mapName k isAddr cr -> do
              bad <- anyDefault defaults' [k, cr]
              if bad
                then pure Nothing
                else do
                  key <- MV.read regs' k
                  callee <- MV.read regs' cr
                  (v, isDefault) <- getMap callee mapName key isAddr
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapSetAt mapName k v isAddr encoding cr -> do
              bad <- anyDefault defaults' [k, v, cr]
              if bad
                then pure Nothing
                else do
                  key <- MV.read regs' k
                  val <- MV.read regs' v
                  callee <- MV.read regs' cr
                  setMap callee mapName key val isAddr encoding
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapGet2 d mapName k1 ia1 k2 ia2 -> do
              bad <- anyDefault defaults' [k1, k2]
              if bad
                then pure Nothing
                else do
                  a <- MV.read regs' k1
                  b <- MV.read regs' k2
                  this <- getThis
                  (v, isDefault) <- getMap2 this mapName a ia1 b ia2
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapSet2 mapName k1 ia1 k2 v ia2 -> do
              bad <- anyDefault defaults' [k1, k2, v]
              if bad
                then pure Nothing
                else do
                  a <- MV.read regs' k1
                  b <- MV.read regs' k2
                  val <- MV.read regs' v
                  this <- getThis
                  setMap2 this mapName a ia1 b val ia2
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapGet2At d mapName k1 ia1 k2 ia2 cr -> do
              bad <- anyDefault defaults' [k1, k2, cr]
              if bad
                then pure Nothing
                else do
                  a <- MV.read regs' k1
                  b <- MV.read regs' k2
                  callee <- MV.read regs' cr
                  (v, isDefault) <- getMap2 callee mapName a ia1 b ia2
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UMapSet2At mapName k1 ia1 k2 v ia2 cr -> do
              bad <- anyDefault defaults' [k1, k2, v, cr]
              if bad
                then pure Nothing
                else do
                  a <- MV.read regs' k1
                  b <- MV.read regs' k2
                  val <- MV.read regs' v
                  callee <- MV.read regs' cr
                  setMap2 callee mapName a ia1 b val ia2
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            USloadAddr d field -> do
              this <- getThis
              (v, isDefault) <- getSload this field
              MV.write regs' d v
              MV.write defaults' d isDefault
              execGo regs' defaults' ops' (pc + 1) (gas + 1)
            USloadAt d field cr -> do
              bad <- MV.read defaults' cr
              if bad
                then pure Nothing
                else do
                  callee <- MV.read regs' cr
                  (v, isDefault) <- getSload callee field
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UEventSload dest field calleeRef -> do
              mAddr <- case calleeRef of
                Nothing -> Just <$> getThis
                Just cr -> do
                  bad <- MV.read defaults' cr
                  if bad then pure Nothing else Just <$> MV.read regs' cr
              case mAddr of
                Nothing -> pure Nothing
                Just addr -> do
                  pendingObjects <- readSTRef objectDirty
                  pendingScalars <- readSTRef sdirty
                  let pending =
                        M.lookup (addr, field) pendingObjects
                          <|> (FastScalar <$> M.lookup (addr, field) pendingScalars)
                  value <- io $ shEventSloadAt hooks addr field pending
                  ok <- writeFastValue regs' defaults' dest value
                  if ok then execGo regs' defaults' ops' (pc + 1) (gas + 1) else pure Nothing
            USstore field v -> do
              bad <- MV.read defaults' v
              if bad
                then pure Nothing
                else do
                  val <- MV.read regs' v
                  this <- getThis
                  setSload this field val
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            USstoreAt field v cr -> do
              bad <- anyDefault defaults' [v, cr]
              if bad
                then pure Nothing
                else do
                  val <- MV.read regs' v
                  callee <- MV.read regs' cr
                  setSload callee field val
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UArrayNew slot lenReg -> do
              len <- MV.read regs' lenReg
              if len < 0 || len > toInteger (maxBound :: Int)
                then pure Nothing
                else do
                  values <- MV.replicate (fromInteger len) 0
                  modifySTRef' arrays (M.insert slot values)
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UArrayMov destSlot srcSlot -> do
              currentArrays <- readSTRef arrays
              case M.lookup srcSlot currentArrays of
                Nothing -> pure Nothing
                Just srcValues -> do
                  values <- V.freeze srcValues >>= V.thaw
                  modifySTRef' arrays (M.insert destSlot values)
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UArrayPush dest slot valueReg -> do
              currentArrays <- readSTRef arrays
              case M.lookup slot currentArrays of
                Nothing -> pure Nothing
                Just oldValues -> do
                  value <- MV.read regs' valueReg
                  frozen <- V.freeze oldValues
                  values <- V.thaw $ V.snoc frozen value
                  modifySTRef' arrays (M.insert slot values)
                  MV.write regs' dest (toInteger $ MV.length values)
                  MV.write defaults' dest False
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UArrayLoadStorage slot field -> do
              this <- getThis
              (len, _) <- getPath this field [StorageField "length"]
              if len < 0 || len > toInteger (maxBound :: Int)
                then pure Nothing
                else do
                  frozen <- V.generateM (fromInteger len) $ \index ->
                    fst <$> getPath this field [StorageIndex (toInteger index) False]
                  values <- V.thaw frozen
                  modifySTRef' arrays (M.insert slot values)
                  execGo regs' defaults' ops' (pc + 1) (gas + 1 + fromInteger len)
            UArrayStoreStorage field slot -> do
              currentArrays <- readSTRef arrays
              case M.lookup slot currentArrays of
                Nothing -> pure Nothing
                Just values -> do
                  this <- getThis
                  let newLen = toInteger $ MV.length values
                  (oldLen, _) <- getPath this field [StorageField "length"]
                  if oldLen /= newLen
                    then pure Nothing
                    else do
                      setPath this field [StorageField "length"] newLen
                      forM_ [0 .. MV.length values - 1] $ \index -> do
                        value <- MV.read values index
                        setPath this field [StorageIndex (toInteger index) False] value
                      execGo regs' defaults' ops' (pc + 1) (gas + 1 + fromInteger newLen)
            UArrayLen d slot -> do
              currentArrays <- readSTRef arrays
              case M.lookup slot currentArrays of
                Nothing -> pure Nothing
                Just values -> do
                  MV.write regs' d (toInteger $ MV.length values)
                  MV.write defaults' d False
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UArrayGet d slot indexReg -> do
              index <- MV.read regs' indexReg
              currentArrays <- readSTRef arrays
              case M.lookup slot currentArrays of
                Just values
                  | index >= 0,
                    index < toInteger (MV.length values) -> do
                      value <- MV.read values (fromInteger index)
                      MV.write regs' d value
                      MV.write defaults' d False
                      execGo regs' defaults' ops' (pc + 1) (gas + 1)
                _ -> pure Nothing
            UArraySet slot indexReg valueReg -> do
              index <- MV.read regs' indexReg
              currentArrays <- readSTRef arrays
              case M.lookup slot currentArrays of
                Just values
                  | index >= 0,
                    index < toInteger (MV.length values) -> do
                      value <- MV.read regs' valueReg
                      MV.write values (fromInteger index) value
                      execGo regs' defaults' ops' (pc + 1) (gas + 1)
                _ -> pure Nothing
            UPathGet d root steps -> do
              resolvePath regs' defaults' steps >>= \case
                Nothing -> pure Nothing
                Just pieces -> do
                  this <- getThis
                  (v, isDefault) <- getPath this root pieces
                  MV.write regs' d v
                  MV.write defaults' d isDefault
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UPathGetAt d root steps cr -> do
              bad <- MV.read defaults' cr
              if bad
                then pure Nothing
                else resolvePath regs' defaults' steps >>= \case
                  Nothing -> pure Nothing
                  Just pieces -> do
                    callee <- MV.read regs' cr
                    (v, isDefault) <- getPath callee root pieces
                    MV.write regs' d v
                    MV.write defaults' d isDefault
                    execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UPathSet root steps v -> do
              resolvePath regs' defaults' steps >>= \case
                Nothing -> pure Nothing
                Just pieces -> do
                  val <- MV.read regs' v
                  this <- getThis
                  setPath this root pieces val
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UPathSetAt root steps v cr -> do
              bad <- MV.read defaults' cr
              if bad
                then pure Nothing
                else resolvePath regs' defaults' steps >>= \case
                  Nothing -> pure Nothing
                  Just pieces -> do
                    val <- MV.read regs' v
                    callee <- MV.read regs' cr
                    setPath callee root pieces val
                    execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UPathDelete root steps -> do
              resolvePath regs' defaults' steps >>= \case
                Nothing -> pure Nothing
                Just pieces -> do
                  this <- getThis
                  -- Deletes currently cross the hook boundary immediately.
                  -- Preserve source order with buffered map/path writes first.
                  flushPending
                  io $ shPathDeleteAt hooks this root pieces
                  invalidateReads
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UPathDeleteAt root steps cr -> do
              bad <- MV.read defaults' cr
              if bad
                then pure Nothing
                else resolvePath regs' defaults' steps >>= \case
                  Nothing -> pure Nothing
                  Just pieces -> do
                    callee <- MV.read regs' cr
                    flushPending
                    io $ shPathDeleteAt hooks callee root pieces
                    invalidateReads
                    execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UEmit name rs -> do
              readFastValues regs' defaults' rs >>= \case
                Nothing -> pure Nothing
                Just vs -> do
                  modifySTRef' evs ((name, vs) :)
                  execGo regs' defaults' ops' (pc + 1) (gas + 1)
            UTimestamp d -> do
              s <- getTimestamp
              MV.write regs' d s
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            UNumber d -> do
              s <- getNumber
              MV.write regs' d s
              MV.write defaults' d False
              execGo regs' defaults' ops' (pc + 1) gas
            UFallback -> do
              let !_ = logMiss ("run-fallback " ++ tag ++ " pc=" ++ show pc)
              pure Nothing
        where
          bin d a b f _ npc g0 = do
            x <- MV.read regs' a
            y <- MV.read regs' b
            let !z = f x y
            MV.write regs' d z
            MV.write defaults' d False
            execGo regs' defaults' ops' npc (g0 + 1)
          cmp d a b f npc g0 = do
            x <- MV.read regs' a
            y <- MV.read regs' b
            MV.write regs' d (if f x y then 1 else 0)
            MV.write defaults' d False
            execGo regs' defaults' ops' npc g0
  result <- execGo regs defaults ops 0 (0 :: Int)
  case result of
    Nothing -> pure Nothing
    Just (vs, cost) -> do
      flushPending
      pure $ Just (vs, cost)

runNamedUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runNamedUIntIR = runAnyUIntIR

runScalarUIntIR :: CodeCollection -> Contract -> Func -> [Integer] -> Maybe ([Integer], Integer)
runScalarUIntIR = runAnyUIntIR
