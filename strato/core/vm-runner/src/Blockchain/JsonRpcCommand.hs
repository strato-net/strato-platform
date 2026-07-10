{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.JsonRpcCommand
  ( produceResponse,
    runJsonRpcCommand,
    runJsonRpcCommand',
    resolveFunction,
  )
where

import BlockApps.Logging
import BlockApps.Solidity.ABI
import Blockchain.Data.BlockHeader (BlockHeader)
import Blockchain.DB.CodeDB
import Blockchain.DB.SolidStorageDB (getSolidStorageKeyVal')
import Blockchain.Data.AddressStateDB
import Blockchain.Data.ExecResults (ExecResults (..))
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.HexData (HexData (..))
import qualified Data.Binary as Bin
import qualified Data.ByteString.Lazy as BL
import qualified Blockchain.Sequencer.TxCallObject as TxCall
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash)
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.GasInfo (GasInfo (..))
import Blockchain.SolidVM.SM (runSM)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.Strato.Model.Keccak256 (hash)
import Blockchain.VMContext (ContextBestBlockInfo (..), CurrentBlockHash (..), VMBase, getContextBestBlockInfo, checkIfRunningTests)
import Control.Lens ((^.))
import Control.Applicative ((<|>))
import Control.Monad ((<=<), void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate)
import qualified Data.Map as M
import qualified Data.Text as T
import Prelude hiding (id)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.VarDef (IndexedType (..))
import SolidVM.Model.CodeCollection.Visibility (Visibility (..))
import SolidVM.Model.SolidString (SolidString, labelToText, stringToLabel)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Variable(..), forceLoadVar)
import Text.Format (format)

produceResponse :: HasStreaming m => JsonRpcResponse -> m ()
produceResponse resp = void $ produceItems "jsonrpcresponse" [(responseId resp, BL.toStrict $ Bin.encode resp)]

runJsonRpcCommand :: (VMBase m, HasStreaming m) => JsonRpcCommand -> m ()
runJsonRpcCommand =
  produceResponse
    <=< runJsonRpcCommand'

runJsonRpcCommand' :: VMBase m => JsonRpcCommand -> m JsonRpcResponse
runJsonRpcCommand' c@JRCGetBalance {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateBalance
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return $ Success id (BC.pack response)
runJsonRpcCommand' c@JRCGetCode {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getExternallyOwned $
    case codeHash of
      ExternallyOwned ch -> ch
      _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return $ Success id code
runJsonRpcCommand' c@JRCGetTransactionCount {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateNonce
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return $ Success id (BC.pack response)
runJsonRpcCommand' JRCGetStorageAt {} = error "unsupported RPC command call"
runJsonRpcCommand' c@(JRCCall callObj id _blockTag) = do
  $logInfoS "JRCCall" . T.pack $ format c
  case TxCall.to callObj of
    Nothing -> return $ Success id B.empty
    Just toAddr -> do
      initBestBlockContext
      ethCall id (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)

--------------------------------------------------------------------------------
-- eth_call: resolve contract, match selector, invoke SolidVM, encode return
--------------------------------------------------------------------------------

ethCall :: VMBase m => String -> Address -> Address -> B.ByteString -> m JsonRpcResponse
ethCall id fromAddr toAddr callData = do
  let selector = B.take 4 callData
      argsBytes = B.drop 4 callData

  blockHeader <- getContextBestBlockInfo >>= \case
    ContextBestBlockInfo _ bh _ -> return bh
    Unspecified -> error "no best block available"

  resolveFunction blockHeader fromAddr toAddr selector >>= \case
    Nothing -> do
      $logInfoS "ethCall" . T.pack $ "no function for selector " ++ BC.unpack (B16.encode selector)
      return $ Error id ("no function for selector 0x" ++ BC.unpack (B16.encode selector))
    Just (funcName, func) -> do
      let argTypes = funcArgTypes func
          retTypes = funcRetTypes func
          argTexts = map valueToArgText $ decodeABIArgs argsBytes argTypes
          prettyArgs = intercalate ", " $ map T.unpack argTexts
          prettyCall = T.unpack (labelToText funcName) ++ "(" ++ prettyArgs ++ ")"

      $logInfoS "ethCall" . T.pack $ prettyCall ++ " on " ++ show toAddr

      if not (isReadOnlyFunc func)
        then do
          $logInfoS "ethCall" . T.pack $ prettyCall ++ " => rejected non-read-only function"
          return $ Error id "eth_call only supports read-only functions"
        else do
          result <- SolidVM.call blockHeader toAddr fromAddr fromAddr 1000000 fromAddr
            (hash callData) (labelToText funcName) argTexts Nothing

          case erException result of
            Just ex -> do
              $logInfoS "ethCall" . T.pack $ prettyCall ++ " => EXCEPTION: " ++ show ex
              return $ Error id (show ex)
            Nothing -> case erReturnVal result of
              Nothing -> do
                $logInfoS "ethCall" . T.pack $ prettyCall ++ " => (no return value)"
                return $ Success id B.empty
              Just retVal -> do
                -- The return value may contain IORef-backed Variables (struct
                -- getters build their tuple with createVar), so freeze it before
                -- the pure ABI encoder reads the members.
                val <- forceLoadVar $ Constant retVal
                let encoded = encodeValueABI retTypes val
                $logInfoS "ethCall" . T.pack $ prettyCall ++ " => " ++ show val
                return $ Success id encoded

isReadOnlyFunc :: CC.Func -> Bool
isReadOnlyFunc func =
  CC._funcStateMutability func `elem` map Just [CC.Pure, CC.Constant, CC.View]

initBestBlockContext :: VMBase m => m ()
initBestBlockContext = do
  bbi <- getContextBestBlockInfo
  case bbi of
    ContextBestBlockInfo bestHash _ _ ->
      Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bestHash)
    Unspecified -> return ()

--------------------------------------------------------------------------------
-- Contract resolution: address -> (funcName, func), following proxy if needed
--------------------------------------------------------------------------------

resolveFunction :: VMBase m => BlockHeader -> Address -> Address -> B.ByteString -> m (Maybe (SolidString, CC.Func))
resolveFunction blockHeader fromAddr addr selector = do
  lookupContract blockHeader fromAddr addr >>= \case
    Nothing -> do
      $logInfoS "resolveFunction" . T.pack $ "lookupContract returned Nothing for " ++ show addr
      return Nothing
    Just contract -> do
      $logInfoS "resolveFunction" . T.pack $
        "contract " ++ show (contract ^. CC.contractName)
        ++ " funcs=" ++ show (M.keys $ CC._functions contract)
        ++ " storageDefs=" ++ show (M.keys $ contract ^. CC.storageDefs)
      case matchSelector contract selector of
        Just hit -> return $ Just hit
        Nothing -> case matchStorageGetter contract selector of
          Just hit -> do
            $logInfoS "resolveFunction" "matched storage getter on direct contract"
            return $ Just hit
          Nothing -> do
            $logInfoS "resolveFunction" "no direct match, trying proxy"
            followProxy blockHeader fromAddr addr contract >>= \case
              Nothing -> do
                $logInfoS "resolveFunction" "followProxy returned Nothing"
                return Nothing
              Just implContract -> do
                let result = matchSelector implContract selector
                             <|> matchStorageGetter implContract selector
                $logInfoS "resolveFunction" . T.pack $
                  "impl contract " ++ show (implContract ^. CC.contractName)
                  ++ " funcs=" ++ show (M.keys $ CC._functions implContract)
                  ++ " storageDefs=" ++ show (M.keys $ implContract ^. CC.storageDefs)
                  ++ " resolved=" ++ show (fmap (labelToText . fst) result)
                return result

lookupContract :: VMBase m => BlockHeader -> Address -> Address -> m (Maybe CC.Contract)
lookupContract blockHeader fromAddr addr =
  A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> do
      $logInfoS "lookupContract" . T.pack $ "address not found: " ++ show addr
      return Nothing
    Just addrState -> case addressStateCodeHash addrState of
      SolidVMCode contractName codeHash -> do
        isRunningTests <- checkIfRunningTests
        let env = Env.Environment
              { Env.blockHeader = blockHeader
              , Env.sender = fromAddr
              , Env.origin = fromAddr
              , Env.proposer = fromAddr
              , Env.txHash = hash B.empty
              , Env.src = Nothing
              , Env.name = Nothing
              , Env.runningTests = isRunningTests
              }
            gi = GasInfo
              { _gasLeft = Gas 1000000
              , _gasUsed = 0
              , _gasInitialAllotment = Gas 1000000
              , _gasMetadata = ""
              }
        (_, result) <- runSM Nothing env gi $ do
          cc <- codeCollectionFromHash isRunningTests True codeHash
          return $ M.lookup (stringToLabel contractName) (cc ^. CC.contracts)
        case result of
          Right val -> do
            $logInfoS "lookupContract" . T.pack $
              "loaded " ++ contractName ++ " => " ++ show (fmap (^. CC.contractName) val)
            return val
          Left e -> do
            $logInfoS "lookupContract" . T.pack $
              "runSM failed for " ++ show addr ++ " (" ++ contractName ++ "): " ++ show e
            return Nothing
      _ -> do
        $logInfoS "lookupContract" . T.pack $
          "non-SolidVM code at " ++ show addr ++ ": " ++ show (addressStateCodeHash addrState)
        return Nothing

followProxy :: VMBase m => BlockHeader -> Address -> Address -> CC.Contract -> m (Maybe CC.Contract)
followProxy blockHeader fromAddr proxyAddr contract
  | M.member "fallback" (CC._functions contract),
    M.member "logicContract" (contract ^. CC.storageDefs) = do
      storageVal <- getSolidStorageKeyVal' proxyAddr (StoragePath [Field "logicContract"])
      case extractAddress storageVal of
        Nothing -> return Nothing
        Just implAddr -> do
          $logInfoS "followProxy" . T.pack $ "delegates to " ++ show implAddr
          lookupContract blockHeader fromAddr implAddr
  | otherwise = return Nothing
  where
    extractAddress (BContract _ a) = Just a
    extractAddress (BAddress a) = Just a
    extractAddress _ = Nothing

matchSelector :: CC.Contract -> B.ByteString -> Maybe (SolidString, CC.Func)
matchSelector contract selector =
  let enumSizes = [(labelToText n, length names) | (n, (names, _)) <- M.toList (CC._enums contract)]
   in matchFunction enumSizes selector (M.toList $ CC._functions contract)

matchStorageGetter :: CC.Contract -> B.ByteString -> Maybe (SolidString, CC.Func)
matchStorageGetter contract selector = go (M.toList $ CC._storageDefs contract)
  where
    go [] = Nothing
    go ((varName, varDecl) : rest)
      | CC._varVisibility varDecl /= Just Public = go rest
      | computeSelector varName argTypes == selector = Just (varName, syntheticFunc)
      | otherwise = go rest
      where
        (argTypes, retType) = getterSignature (CC._varType varDecl)
        -- A struct-valued getter returns its members flattened into a tuple
        -- (matching SolidVM's handleStruct), so the return signature is the list
        -- of included member types rather than the struct itself.
        retTypes = getterReturnTypes contract retType
        syntheticFunc = CC.Func
          { CC._funcArgs = zipWith (\i t -> (Nothing, IndexedType i t Nothing)) [0..] argTypes
          , CC._funcVals = zipWith (\i t -> (Nothing, IndexedType i t Nothing)) [0..] retTypes
          , CC._funcStateMutability = Just CC.View
          , CC._funcContents = Nothing
          , CC._funcVisibility = Just Public
          , CC._funcVirtual = False
          , CC._funcOverrides = Nothing
          , CC._funcConstructorCalls = M.empty
          , CC._funcModifiers = []
          , CC._funcContext = CC._varContext varDecl
          , CC._funcIsFree = False
          , CC._funcOverload = []
          }

getterSignature :: SVMType.Type -> ([SVMType.Type], SVMType.Type)
getterSignature (SVMType.Array elemT _) = ([SVMType.Int Nothing Nothing], elemT)
getterSignature (SVMType.Mapping _ keyT valT _ _) =
  let (innerArgs, innerRet) = getterSignature valT
   in (keyT : innerArgs, innerRet)
getterSignature t = ([], t)

-- | Return types produced by a public-variable getter. For a struct-valued
-- getter this flattens the struct into its member types (Solidity returns the
-- members as a tuple), skipping members the getter omits — mappings, arrays and
-- errors — to stay in lockstep with SolidVM's handleStruct. For any other type
-- the getter returns a single value.
getterReturnTypes :: CC.Contract -> SVMType.Type -> [SVMType.Type]
getterReturnTypes contract retType =
  case lookupStructFields contract retType of
    Just fields -> [t | (_, t) <- fields, includeInGetter t]
    Nothing -> [retType]
  where
    includeInGetter SVMType.Error {} = False
    includeInGetter SVMType.Array {} = False
    includeInGetter SVMType.Mapping {} = False
    includeInGetter _ = True

lookupStructFields :: CC.Contract -> SVMType.Type -> Maybe [(SolidString, SVMType.Type)]
lookupStructFields contract t = do
  name <- case t of
    SVMType.Struct _ s -> Just s
    SVMType.UnknownLabel s -> Just s
    _ -> Nothing
  fields <- M.lookup name (contract ^. CC.structs)
  pure [(fieldName, CC.fieldTypeType ft) | (fieldName, ft, _) <- fields]
