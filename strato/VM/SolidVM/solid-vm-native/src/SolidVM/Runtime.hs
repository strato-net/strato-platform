{-# LANGUAGE DataKinds #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}

module SolidVM.Runtime (compiledContract, compiledFunction, constructorStage, runAction, getCodeAndCollection, internalFrame, messageSignature, messageArguments, callContract, encodeArguments, createCode, derive, createContract, copyStorage, emitContractEvent, previousBlock, proposer) where

import SolidVM.Model.Storable (StoragePath)
import qualified Data.ByteString as B
import qualified Control.Monad.Change.Modify as Mod
import {-# SOURCE #-} qualified SolidVM.Blockchain as Blockchain
import SolidVM.Events (emitEventValuesForContract)
import Blockchain.SolidVM.CodeCollectionDB (ParseOptions (..))
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM hiding (action, getCodeAndCollection)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Lens ((^.))
import Control.Monad
import qualified SolidVM.Core as N
import qualified SolidVM.Compile as N
import qualified Data.Cache.LRU as LRU
import Data.IORef
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Value
import System.IO.Unsafe (unsafePerformIO)
import UnliftIO (bracket, catch, liftIO, throwIO)
import SolidVM.Values
import SolidVM.Storage (getVar, setVar)
import qualified Blockchain.SolidVM.Builtins.ABI.Values as ABI
import Blockchain.Data.ProposalFacts

getCodeAndCollection :: Address -> SM (CC.Contract, Keccak256, CC.CodeCollection)
getCodeAndCollection = getCodeAndCollectionWithTypeCheck False

{-# NOINLINE compilationCache #-}
compilationCache :: IORef (LRU.LRU (Keccak256, Bool, T.Text) (Either T.Text N.CompiledContract))
compilationCache = unsafePerformIO $ newIORef $ LRU.newLRU (Just 128)

-- Admit the whole contract before executing any entry. Cache failures as well.
compiledContract :: Keccak256 -> CC.CodeCollection -> CC.Contract -> SM N.CompiledContract
compiledContract hsh cc contract = do
  opts <- parseOptionsForCurrentBlock
  let key = (hsh, parseLegacyOperatorPrecedence opts, contract ^. CC.contractName)
      duplicateArities f =
        let arities = map (length . CC._funcArgs) (f : CC._funcOverload f)
         in length arities /= M.size (M.fromList [(a, ()) | a <- arities])
  cached <- liftIO $ atomicModifyIORef' compilationCache $ \cache ->
    let (cache', found) = LRU.lookup key cache in (cache', found)
  result <- case cached of
    Just value -> pure value
    Nothing -> do
      let value = if any duplicateArities (M.elems (contract ^. CC.functions))
            then Left "overloads with the same arity"
            else either (Left . T.intercalate "; " . map (N.showErr . snd)) Right (N.compileContractChecked cc contract)
      liftIO $ atomicModifyIORef' compilationCache $ \cache -> (LRU.insert key value cache, ())
      pure value
  either (throwIO . N.NativeUnavailable . ((contract ^. CC.contractName <> ": ") <>)) pure result

compiledFunction :: Keccak256 -> CC.CodeCollection -> CC.Contract -> T.Text -> CC.Func -> SM N.Fun
compiledFunction hsh cc contract name selected = do
  compiled <- compiledContract hsh cc contract
  let entryName = if M.member name (contract ^. CC.functions) then name else "fallback"
      key = entryName <> "/" <> T.pack (show (length (CC._funcArgs selected)))
  case M.lookup key (N.ccFuns compiled) of
    Just (Right fun) -> pure fun
    _ -> throwIO $ N.NativeUnavailable ("compiled function unavailable: " <> key)

constructorStage :: Keccak256 -> CC.CodeCollection -> CC.Contract -> T.Text -> SM N.Fun
constructorStage hsh cc contract stage = do
  compiled <- compiledContract hsh cc contract
  let selected = case stage of
        "<initializers>" -> Just (N.ccInitializers compiled)
        "<constructor>" -> N.ccConstructor compiled
        parent -> M.lookup parent (N.ccParentArguments compiled)
  case selected of
    Just (Right fun) -> pure fun
    _ -> throwIO $ N.NativeUnavailable ("compiled constructor stage unavailable: " <> stage)

runAction ::
  CC.CodeCollection -> CC.Contract -> T.Text -> N.Fun -> ValList -> SM (Maybe Value)
runAction cc contract name (N.Fun _ sig fun) values = do
  let ctx = N.mkCtx cc contract
  args <- convertArgs (N.cStorage ctx) sig values
  let messageValues = if N.variadicTail sig then
        let (fixed, remaining) = splitAt (N.sigArity sig - 1) values
         in fixed ++ [case remaining of [SVariadic vs] -> SVariadic vs; vs -> SVariadic vs]
        else values
  out <- withCallArguments name messageValues (N.callDyn sig fun args)
    `catch` (\(N.Revert message) -> throwIO (Require (Just (T.unpack message))))
  case out of
    [] -> pure Nothing
    [N.Dyn N.TUnit ()] -> pure Nothing
    [d] -> Just <$> toValue d
    ds -> Just . STuple . V.fromList . map Constant <$> traverse toValue ds

withCallArguments :: T.Text -> ValList -> SM a -> SM a
withCallArguments name values operation = bracket acquire restore (const operation)
  where
    acquire :: SM (Int, T.Text, ValList)
    acquire = do
      info <- getCurrentCallInfo
      depth <- getCallStackDepth
      Mod.modify_ (Mod.Proxy :: Mod.Proxy [CallInfo]) $ \stack -> pure $ case stack of
        current : rest -> current {currentFunctionName = name, currentArguments = values} : rest
        [] -> stack
      pure (depth, currentFunctionName info, currentArguments info)
    restore :: (Int, T.Text, ValList) -> SM ()
    restore (depth, previousName, previousArgs) =
      Mod.modify_ (Mod.Proxy :: Mod.Proxy [CallInfo]) $ \stack -> pure $
        let (nested, caller) = splitAt (max 0 (length stack - depth)) stack
         in nested ++ case caller of
              current : rest -> current {currentFunctionName = previousName, currentArguments = previousArgs} : rest
              [] -> []

messageSignature :: SM T.Text
messageSignature = currentFunctionName <$> getCurrentCallInfo

messageArguments :: SM [N.Dyn]
messageArguments = do
  info <- getCurrentCallInfo
  let ctx = N.mkCtx (codeCollection info) (currentContract info)
  traverse (valueDynAt (currentAddress info) (N.cStorage ctx)) (currentArguments info)

internalFrame :: T.Text -> N.Sig args r -> N.Fn args r -> N.Fn args r
internalFrame name sig fun = go sig fun []
  where
    callName = maybe name id (T.stripPrefix "super." name)
    go :: N.Sig as result -> N.Fn as result -> [N.Dyn] -> N.Fn as result
    go (N.SigCons ty rest) action args = \value -> go rest (action value) (N.Dyn ty value : args)
    go (N.SigNil _) action args = do
      values <- traverse toValue (reverse args)
      withCallArguments callName values action

callContract :: N.CallKind -> Address -> T.Text -> [N.Dyn] -> Maybe N.SomeTy -> SM [N.Dyn]
callContract kind address name args expected = unwind $ do
  info <- getCurrentCallInfo
  let ctx = N.mkCtx (codeCollection info) (currentContract info)
      storageAddress = case kind of N.DelegateCall -> currentAddress info; _ -> address
  values <- traverse toValue args
  result <- Blockchain.call' (currentAddress info) address
    (case kind of N.Call -> CC.DefaultCall; N.RawCall -> CC.RawCall; N.DelegateCall -> CC.DelegateCall) name values
  case expected of
    Just (N.SomeTy N.TUnit) -> pure []
    Just (N.SomeTy ty) | not (isVariadic ty) -> case result of
      Just value -> N.retDyn ty <$> valueAsAt storageAddress (N.cStorage ctx) ty value
      Nothing -> throwIO $ N.Divergence "native external call returned no value"
    _ -> case result of
      Nothing -> pure [N.Dyn N.TUnit ()]
      Just SNULL -> pure [N.Dyn N.TUnit ()]
      Just value -> do
        (callee, _, collection) <- getCodeAndCollection address
        let calleeCtx = N.mkCtx collection callee
        case value of
          STuple xs -> traverse (valueDynAt storageAddress (N.cStorage calleeCtx) <=< weakGetVar) (V.toList xs)
          SVariadic vs -> do
            returnedValues <- traverse (valueDynAt storageAddress (N.cStorage calleeCtx)) vs
            pure $ case expected of
              Just (N.SomeTy N.TRaw) -> [N.Dyn N.TVariadic returnedValues]
              _ -> returnedValues
          _ -> (: []) <$> valueDynAt storageAddress (N.cStorage calleeCtx) value

encodeArguments :: Bool -> [N.Dyn] -> SM B.ByteString
encodeArguments packed args = do
  values <- traverse toValue args
  (if packed then ABI.abiEncodePacked else ABI.abiEncode) values

createCode :: Maybe N.Dyn -> T.Text -> T.Text -> [N.Dyn] -> SM Address
createCode salt name source args = unwind $ do
  saltValue <- traverse toValue salt
  values <- traverse toValue args
  Blockchain.createCode saltValue name source values

derive :: Address -> T.Text -> T.Text -> [N.Dyn] -> SM Address
derive creator salt name args = Blockchain.derive creator salt name =<< traverse toValue args

createContract :: T.Text -> Maybe (SM N.Dyn) -> SM [N.Dyn] -> SM Address
createContract name salt args = unwind $
  Blockchain.createContractValues name ((>>= toValue) <$> salt) (traverse toValue =<< args)

copyStorage :: StoragePath -> StoragePath -> SM ()
copyStorage destination source = setVar (Constant $ SReference destination) =<< getVar (Constant $ SReference source)

emitContractEvent :: T.Text -> T.Text -> [(T.Text, N.Dyn)] -> SM ()
emitContractEvent contractName event fields = do
  (_, collection) <- getCurrentCodeCollection
  contract <- maybe (missingType "event contract" contractName) pure $ M.lookup contractName (collection ^. CC.contracts)
  info <- getCurrentCallInfo
  let annotation = maybe (CC._contractContext contract) CC._funcContext $
        M.lookup (currentFunctionName info) (currentContract info ^. CC.functions)
  values <- traverse (toValue . snd) fields
  void $ emitEventValuesForContract contract (CC.EmitStatement event [] annotation) event values

previousBlock :: SM (Address, Address, Integer)
previousBlock = do
  facts <- Blockchain.getPrevBlockFacts
  pure (pfProposer facts, pfIntendedProposer facts, pfRound facts)

proposer :: SM Address
proposer = Env.proposer <$> getEnv

-- Nested contract failures must not leave frames behind when Solidity catches them.
unwind :: SM a -> SM a
unwind operation = do
  depth <- getCallStackDepth
  operation `catch` (\(e :: SolidException) -> trimCallStackToDepth depth >> throwIO e)
