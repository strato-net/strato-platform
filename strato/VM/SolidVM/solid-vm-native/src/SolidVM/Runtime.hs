{-# LANGUAGE DataKinds #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}

module SolidVM.Runtime (compiledContract, compiledFunction, constructorStage, runAction, Host (..)) where

import Blockchain.DB.SolidStorageDB
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.SolidVM.CodeCollectionDB (ParseOptions (..))
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Lens ((^.))
import Control.Monad
import Control.Monad.Trans.Reader (runReaderT)
import qualified SolidVM.Core as N
import qualified SolidVM.Compile as N
import qualified Data.Cache.LRU as LRU
import Data.IORef
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Value
import System.IO.Unsafe (unsafePerformIO)
import UnliftIO (catch, liftIO, throwIO, try, withRunInIO)
import SolidVM.Values
import SolidVM.Storage (getVar, setVar)
import qualified Blockchain.SolidVM.Builtins as ABI
import Blockchain.Data.ProposalFacts

data Host = Host
  { hostCreateCode :: Maybe Value -> T.Text -> T.Text -> ValList -> SM Address
  , hostSelfdestruct :: Address -> SM Bool
  , hostPreviousBlock :: SM ProposalFacts
  , hostDerive :: Address -> T.Text -> T.Text -> ValList -> SM Address
  }

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
  (Integer -> SM ()) ->
  (Address -> Address -> CC.FunctionCallType -> T.Text -> ValList -> SM (Maybe Value)) ->
  (T.Text -> Maybe (SM Value) -> SM ValList -> SM Address) ->
  Host ->
  (T.Text -> T.Text -> [Value] -> SM ()) ->
  CC.CodeCollection -> CC.Contract -> T.Text -> N.Fun -> ValList -> SM (Maybe Value)
runAction charge callFunction createContract host emit cc contract name (N.Fun _ sig fun) values = do
  nativeEnv <- getEnv
  info <- getCurrentCallInfo
  let ctx = N.mkCtx cc contract
  args <- convertArgs (N.cStorage ctx) sig values
  let frameValues = if N.variadicTail sig then
        let (fixed, remaining) = splitAt (N.sigArity sig - 1) values
         in fixed ++ [case remaining of [SVariadic vs] -> SVariadic vs; vs -> SVariadic vs]
        else values
  frameArgs <- traverse (valueDynAt (currentAddress info) (N.cStorage ctx)) frameValues
  let fr = N.Frame
        { N.fThis = currentAddress info
        , N.fCode = currentCodeAddress info
        , N.fSender = Env.sender nativeEnv
        , N.fOrigin = Env.origin nativeEnv
        , N.fSig = name
        , N.fArgs = frameArgs
        , N.fValue = 0
        }
  out <- withRunInIO $ \run -> do
    let runtime = N.RT
          { N.rtChargeGas = \amount -> run $ charge amount
          , N.rtGet = \a p -> run $ getSolidStorageKeyVal' a p
          , N.rtPut = \a p v -> run $ do
              ci <- getCurrentCallInfo
              when (readOnly ci) $ throwIO (InvalidWrite "native write during read-only access" (show p))
              markDiffForAction a p v
              putSolidStorageKeyVal' a p v
          , N.rtEmit = \_ contractName event fields -> run $ emit contractName event =<< traverse (toValue . snd) fields
          , N.rtCall = \kind caller addr fn ds expected -> run $ do
              vals <- traverse toValue ds
              depth <- getCallStackDepth
              result <- try $ callFunction (N.fThis caller) addr
                (case kind of N.Call -> CC.DefaultCall; N.RawCall -> CC.RawCall; N.DelegateCall -> CC.DelegateCall) fn vals
              case result of
                Left (e :: SolidException) -> do
                  trimCallStackToDepth depth
                  throwIO e
                Right ret -> do
                  let storageAddr = case kind of N.DelegateCall -> N.fThis caller; _ -> addr
                  case expected of
                    Just (N.SomeTy N.TUnit) -> pure []
                    Just (N.SomeTy t) | not (isVariadic t) -> case ret of
                      Just v -> N.retDyn t <$> valueAsAt storageAddr (N.cStorage ctx) t v
                      Nothing -> throwIO $ N.Divergence "native external call returned no value"
                    _ -> case ret of
                      Nothing -> pure [N.Dyn N.TUnit ()]
                      Just SNULL -> pure [N.Dyn N.TUnit ()]
                      Just v -> do
                        (callee, _, collection) <- getCodeAndCollection addr
                        let calleeCtx = N.mkCtx collection callee
                        case v of
                          STuple xs -> traverse (valueDynAt storageAddr (N.cStorage calleeCtx) <=< weakGetVar) (V.toList xs)
                          SVariadic vs -> do
                            returnedValues <- traverse (valueDynAt storageAddr (N.cStorage calleeCtx)) vs
                            pure $ case expected of
                              Just (N.SomeTy N.TRaw) -> [N.Dyn N.TVariadic returnedValues]
                              _ -> returnedValues
                          _ -> (: []) <$> valueDynAt storageAddr (N.cStorage calleeCtx) v
          , N.rtAbiEncode = \packed ds -> run $ do
              vals <- traverse toValue ds
              (if packed then ABI.abiEncodePacked else ABI.abiEncode) vals
          , N.rtCreateCode = \salt contractName source ds -> run $ unwind $ do
              saltValue <- traverse toValue salt
              vals <- traverse toValue ds
              hostCreateCode host saltValue contractName source vals
          , N.rtSelfdestruct = \target -> run $ hostSelfdestruct host target
          , N.rtPreviousBlock = run $ do
              facts <- hostPreviousBlock host
              pure (pfProposer facts, pfIntendedProposer facts, pfRound facts)
          , N.rtProposer = run $ Env.proposer <$> getEnv
          , N.rtCopyStorage = \destination source -> run $
              setVar (Constant $ SReference destination) =<< getVar (Constant $ SReference source)
          , N.rtDerive = \creator salt contractName ds -> run $
              hostDerive host creator salt contractName =<< traverse toValue ds
          , N.rtSender = \_ -> run $ Env.sender <$> getEnv
          , N.rtCreate = \_ contractName getSalt getArgs -> run $ do
              depth <- getCallStackDepth
              result <- try $ createContract contractName ((\salt -> toValue =<< liftIO salt) <$> getSalt) (traverse toValue =<< liftIO getArgs)
              case result of
                Left (e :: SolidException) -> do
                  trimCallStackToDepth depth
                  throwIO e
                Right address -> pure address
          , N.rtBlockNumber = BlockHeader.number (Env.blockHeader nativeEnv)
          , N.rtTimestamp = round $ utcTimeToPOSIXSeconds $ BlockHeader.timestamp (Env.blockHeader nativeEnv)
          }
    runReaderT (N.callDyn sig fun args) (runtime, fr)
      `catch` (\(N.Revert message) -> throwIO (Require (Just (T.unpack message))))

  case out of
    [] -> pure Nothing
    [N.Dyn N.TUnit ()] -> pure Nothing
    [d] -> Just <$> toValue d
    ds -> Just . STuple . V.fromList . map Constant <$> traverse toValue ds

-- Nested contract failures must not leave frames behind when Solidity catches them.
unwind :: SM a -> SM a
unwind operation = do
  depth <- getCallStackDepth
  operation `catch` (\(e :: SolidException) -> trimCallStackToDepth depth >> throwIO e)
