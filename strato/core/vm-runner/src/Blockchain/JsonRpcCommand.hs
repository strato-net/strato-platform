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
  )
where

import BlockApps.Logging
import BlockApps.Solidity.ABI
import Blockchain.DB.CodeDB
import Blockchain.DB.SolidStorageDB (getSolidStorageKeyVal')
import Blockchain.Data.AddressStateDB
import Blockchain.Data.ExecResults (ExecResults (..))
import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.HexData (HexData (..))
import qualified Blockchain.Sequencer.TxCallObject as TxCall
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash, runMemCompilerT)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Keccak256 (hash)
import Blockchain.VMContext (ContextBestBlockInfo (..), CurrentBlockHash (..), VMBase, getContextBestBlockInfo)
import Control.Lens ((^.))
import Control.Monad ((<=<))
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate)
import qualified Data.Map as M
import qualified Data.Text as T
import Prelude hiding (id)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString (SolidString, labelToText, stringToLabel)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import Text.Format (format)

produceResponse :: String -> B.ByteString -> IO ()
produceResponse id theData = do
  _ <- runKafkaMConfigured "ethereum-vm" $
    produceItems "jsonrpcresponse" [(id, theData)]
  return ()

runJsonRpcCommand :: VMBase m => JsonRpcCommand -> m ()
runJsonRpcCommand =
  liftIO . uncurry produceResponse
    <=< runJsonRpcCommand'

runJsonRpcCommand' :: VMBase m => JsonRpcCommand -> m (String, B.ByteString)
runJsonRpcCommand' c@JRCGetBalance {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateBalance
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return (id, BC.pack response)
runJsonRpcCommand' c@JRCGetCode {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getExternallyOwned $
    case codeHash of
      ExternallyOwned ch -> ch
      _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return (id, code)
runJsonRpcCommand' c@JRCGetTransactionCount {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateNonce
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return (id, BC.pack response)
runJsonRpcCommand' JRCGetStorageAt {} = error "unsupported RPC command call"
runJsonRpcCommand' c@(JRCCall callObj id _blockTag) = do
  $logInfoS "JRCCall" . T.pack $ format c
  case TxCall.to callObj of
    Nothing -> return (id, B.empty)
    Just toAddr -> do
      initBestBlockContext
      ethCall id (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)

--------------------------------------------------------------------------------
-- eth_call: resolve contract, match selector, invoke SolidVM, encode return
--------------------------------------------------------------------------------

ethCall :: VMBase m => String -> Address -> Address -> B.ByteString -> m (String, B.ByteString)
ethCall id fromAddr toAddr callData = do
  let selector = B.take 4 callData
      argsBytes = B.drop 4 callData

  resolveFunction toAddr selector >>= \case
    Nothing -> do
      $logInfoS "ethCall" . T.pack $ "no function for selector " ++ BC.unpack (B16.encode selector)
      return (id, B.empty)
    Just (funcName, func) -> do
      let argTypes = funcArgTypes func
          retTypes = funcRetTypes func
          argTexts = map valueToArgText $ decodeABIArgs argsBytes argTypes
          prettyArgs = intercalate ", " $ map T.unpack argTexts
          prettyCall = T.unpack (labelToText funcName) ++ "(" ++ prettyArgs ++ ")"

      $logInfoS "ethCall" . T.pack $ prettyCall ++ " on " ++ show toAddr

      blockHeader <- getContextBestBlockInfo >>= \case
        ContextBestBlockInfo _ bh _ -> return bh
        Unspecified -> error "no best block available"
      result <- SolidVM.call blockHeader toAddr fromAddr fromAddr 1000000 fromAddr
        (hash callData) (labelToText funcName) argTexts Nothing

      case erException result of
        Just ex -> do
          $logInfoS "ethCall" . T.pack $ prettyCall ++ " => EXCEPTION: " ++ show ex
          return (id, B.empty)
        Nothing -> case erReturnVal result of
          Nothing -> do
            $logInfoS "ethCall" . T.pack $ prettyCall ++ " => (no return value)"
            return (id, B.empty)
          Just retStr -> do
            let encoded = encodeReturnABI retTypes retStr
            $logInfoS "ethCall" . T.pack $ prettyCall ++ " => " ++ retStr
            return (id, encoded)

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

resolveFunction :: VMBase m => Address -> B.ByteString -> m (Maybe (SolidString, CC.Func))
resolveFunction addr selector = do
  lookupContract addr >>= \case
    Nothing -> return Nothing
    Just contract -> case matchSelector contract selector of
      Just hit -> return $ Just hit
      Nothing -> followProxy addr contract >>= \case
        Nothing -> return Nothing
        Just implContract -> return $ matchSelector implContract selector

lookupContract :: VMBase m => Address -> m (Maybe CC.Contract)
lookupContract addr =
  A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> do
      $logInfoS "lookupContract" . T.pack $ "address not found: " ++ show addr
      return Nothing
    Just addrState -> case addressStateCodeHash addrState of
      SolidVMCode contractName codeHash -> do
        cc <- runMemCompilerT $ codeCollectionFromHash False True codeHash
        return $ M.lookup (stringToLabel contractName) (cc ^. CC.contracts)
      _ -> return Nothing

followProxy :: VMBase m => Address -> CC.Contract -> m (Maybe CC.Contract)
followProxy proxyAddr contract
  | M.member "fallback" (CC._functions contract),
    M.member "logicContract" (contract ^. CC.storageDefs) = do
      storageVal <- getSolidStorageKeyVal' proxyAddr (StoragePath [Field "logicContract"])
      case extractAddress storageVal of
        Nothing -> return Nothing
        Just implAddr -> do
          $logInfoS "followProxy" . T.pack $ "delegates to " ++ show implAddr
          lookupContract implAddr
  | otherwise = return Nothing
  where
    extractAddress (BContract _ a) = Just a
    extractAddress (BAddress a) = Just a
    extractAddress _ = Nothing

matchSelector :: CC.Contract -> B.ByteString -> Maybe (SolidString, CC.Func)
matchSelector contract selector =
  let enumSizes = [(labelToText n, length names) | (n, (names, _)) <- M.toList (CC._enums contract)]
   in matchFunction enumSizes selector (M.toList $ CC._functions contract)
