{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.EthereumVM
  ( ethereumVM
  )
where

--import           Data.List.Split                       (chunksOf)

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import Blockchain.BlockChain
import Blockchain.DB.ChainDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.BlockHeader
import Blockchain.Data.GenesisBlock
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.StateRootMismatch
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.RedisBlockDB.Models
import Blockchain.Strato.StateDiff          (stateDiff')
import Blockchain.Strato.StateDiff.Database (commitSqlDiffs)
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.VMOptions
import Blockchain.Wiring
import Conduit hiding (Flush)
import Control.Lens hiding (Context)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.List (mapMaybeM)
import Data.Foldable hiding (fold)
import Data.List
import qualified Data.Map as M
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as UTF8
import Debugger
import Executable.EthereumVM2
import SolidVM.Model.CodeCollection
import Text.Format (format)

-- newtype CertRoot = CertRoot { unCertRoot :: MP.StateRoot }
--   deriving (Eq, Ord, Show)

ethereumVM :: Maybe DebugSettings -> LoggingT IO ()
ethereumVM d = runResourceT $ do
  ctx <- initContext d
  void . runSQLM . runKafkaMConfigured "ethereum-vm" $ execContextM' ctx $ do
    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)

    initializeBestBlock

    failures <- runConsume "evm/loop" consumerGroup seqVmEventsTopicName $ \_ seqEvents -> do

        let maybeSelfAddress = listToMaybe [ addr | VmSelfAddress addr <- toList seqEvents ]
        $logInfoLS "ethereumVM/maybeSelfAddress" (show maybeSelfAddress)
        case maybeSelfAddress of
          Just x -> contextModify' $ \cs@(ContextState{}) -> cs{_selfAddress = x}
          Nothing -> pure ()
        recordBaggerMetrics =<< contextGets _baggerState
        logEventSummaries seqEvents

        let !vmInEventBatch = foldr insertInBatch newInBatch seqEvents
        failures <- fmap concat . runConduit $
          yield vmInEventBatch
            .| handleVmEvents
            .| mapMaybeM routeOutEvent
            .| sinkList

        loopTimeit "compactContextM" $ compactContextM

        return (if null failures then Nothing else Just failures, ())

    for_ failures $ \(BlockVerificationFailure bNum bHash bDetails) -> case bDetails of
      StateRootMismatch BlockDelta{..} -> do
        let err = "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format _inBlock 
        runStateRootMismatchM $ do
          sd <- runConduit $ stateDiff' Nothing bNum bHash _inBlock _derived
             .| headDefC (error $ err ++ "\nError encountered while analyzing stateRoot mismatch")
          $logErrorS "ethereumVM/StateRootMismatch" . T.pack $ formatStateRootMismatch sd
      ValidatorMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "There was a validator mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash 
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "New validators found in block header:        " ++ show (fst _inBlock) 
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "New validators found from running block:     " ++ show (fst _derived) 
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "Removed validators found in block header:    " ++ show (snd _inBlock) 
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "Removed validators found from running block: " ++ show (snd _derived) 
      CertRegistrationMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "There was a cert mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "New certs found in block header:        " ++ show (fst _inBlock) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "New certs found from running block:     " ++ show (fst _derived) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "Removed certs found in block header:    " ++ show (snd _inBlock) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "Removed certs found from running block: " ++ show (snd _derived) 
      VersionMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "There was a block header version mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash 
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "Block header version found in block header:      " ++ show _inBlock
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "Latest supported block header version by system: " ++ show _derived
      UnclesMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "There was a mismatch between uncles in block #" ++ show bNum 
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "Received uncle hashes: " ++ format _inBlock 
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "But expected: " ++ format _derived
      UnexpectedBlockNumber BlockDelta{..} -> do
        $logErrorS "ethereumVM/UnexpectedBlockNumber" . T.pack $ "Expected block number: " ++ show _derived 
        $logErrorS "ethereumVM/UnexpectedBlockNumber" . T.pack $ "But actually received: " ++ show _inBlock
    error "STRATO vm-runner encountered errors while verifying a block in the chain. Please review the logs above for more information."

initializeBestBlock :: (HasContext m, Bagger.MonadBagger m) => m ()
initializeBestBlock = do
  maybeRedisBestBlockHash <- fmap (fmap bestBlockHash) (withRedisBlockDB getBestBlockInfo)
  maybeRedisBestBlock <-
    case maybeRedisBestBlockHash of
      Nothing -> error "no best block hash in redisdb"
      Just hash -> withRedisBlockDB $ getBlock hash

  case maybeRedisBestBlock of
    Nothing -> error "no best block in redisdb"
    Just redisBestBlock -> do
      _ <- bootstrapChainDB (blockHeaderHash $ obBlockData redisBestBlock) [(Nothing, stateRoot $ obBlockData redisBestBlock)]
      putContextBestBlockInfo $ outputBlockToContextBestBlockInfo redisBestBlock

      Bagger.processNewBestBlock (blockHeaderHash $ obBlockData redisBestBlock) (obBlockData redisBestBlock) [] -- bootstrap Bagger with genesis block



outputBlockToContextBestBlockInfo :: OutputBlock -> ContextBestBlockInfo
outputBlockToContextBestBlockInfo block =
  let header = obBlockData block
      txs = obReceiptTransactions block
      txL = length txs
  in ContextBestBlockInfo (blockHeaderHash header) header txL

logEventSummaries :: MonadLogger m => [VmEvent] -> m ()
logEventSummaries evs = do
  let names = map getNames evs
      numberedNames = map (\x -> numberIt (length x) (head x)) $ group $ sort names

  $logInfoS "logEventSummaries" . T.pack $
    "#### Got: " ++ intercalate ", " numberedNames -- show numTXs ++ "TXs, " ++ show numBlocks ++ " blocks"
  where
    getNames :: VmEvent -> String
    getNames (VmTx _ _) = "TX"
    getNames (VmBlock _) = "Block"
    getNames (VmGenesis _) = "GenesisBlock"
    getNames (VmJsonRpcCommand _) = "JsonRpcCommand"
    getNames VmCreateBlockCommand = "CreateBlockCommand"
    getNames (VmPrivateTx _) = "PrivateTx"
    getNames (VmGetMPNodesRequest _ _) = "GetMPNodesRequest"
    getNames (VmMPNodesReceived _) = "MPNodesReceived"
    getNames (VmRunPreprepare _) = "VmRunPreprepare"
    getNames (VmSelfAddress _) = "VmSelfAddress"

    numberIt :: Int -> String -> String
    numberIt 1 x = "1 " ++ x
    numberIt i x = show i ++ " " ++ x ++ "s"

-- KAFKA

routeOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => VmOutEvent -> m (Maybe [BlockVerificationFailure])
routeOutEvent (OutBlockVerificationFailure bvf) = pure $ Just bvf
routeOutEvent oev = Nothing <$ sendOutEvent oev

sendOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => VmOutEvent -> m ()
sendOutEvent (OutAction act) = do
  let extractCodeCollectionAddedMessages :: Action -> Maybe VMEvent
      extractCodeCollectionAddedMessages a =
        case ( join $ fmap (M.lookup "src") $ a ^. Action.metadata,
               join $ fmap (M.lookup "name") $ a ^. Action.metadata,
               OMap.assocs $ a ^. Action.actionData
             ) of
          (Just c, Just n, actionDatas) ->
            let cp = case join $ fmap (M.lookup "VM") $ a ^. Action.metadata of
                  Just "SolidVM" -> SolidVMCode (T.unpack n) $ Keccak256.hash $ UTF8.encodeUtf8 c
                  Just "EVM" -> ExternallyOwned $ Keccak256.hash $ BC.pack $ T.unpack c
                  Just v -> error $ "Unknown VM: " ++ show v
                  Nothing -> ExternallyOwned $ Keccak256.hash $ BC.pack $ T.unpack c
                cn = fromMaybe "" . listToMaybe . catMaybes . flip map actionDatas $ \(_, Action.ActionData {..}) ->
                  if _actionDataCodeHash == cp
                    then Just _actionDataCreator
                    else Nothing
                cc = foldr (\ad b -> Action._actionDataCodeCollection ad <> b) mempty $ snd <$> actionDatas
                abstracts' = foldr (\ad b -> Action._actionDataAbstracts ad <> b) mempty $ snd <$> actionDatas
                contracts' = (cc ^. contracts) <&> ( (functions .~ M.empty)
                                                  --  . (constructor .~ Nothing)
                                                   . (modifiers .~ M.empty)
                                                   )
                -- If there are no abstract contracts, emit normal contracts. Else, only emit abstract contracts
                abstractNames = S.fromList . M.keys $ getTopLevelAbstracts cc
                contracts'' = if S.null abstractNames
                                then M.filter (isNothing . _importedFrom) contracts'
                                else M.filterWithKey (\k v -> (isNothing $ _importedFrom v) && (k `S.member` abstractNames)) contracts'
                cc' = emptyCodeCollection & contracts .~ contracts''
             in Just $
                  CodeCollectionAdded
                    { codeCollection = const () <$> cc',
                      codePtr = cp,
                      creator = cn,
                      application = n,
                      historyList =
                        case join $ fmap (M.lookup "history") (a ^. Action.metadata) of
                          Nothing -> []
                          Just v -> T.splitOn "," v,
                      abstracts = abstracts',
                      recordMappings = []
                    }
          _ -> Nothing
      ccEvents = maybeToList $ extractCodeCollectionAddedMessages act
      dcEvents = DelegatecallMade <$> toList (act ^. Action.delegatecalls)
      act' = act { Action._actionData = Action.omapMap (Action.actionDataCodeCollection .~ mempty) (Action._actionData act) }
      actionEvents = [NewAction act']
      vmes = ccEvents ++ dcEvents ++ actionEvents
  void . produceVMEvents $ toList vmes
sendOutEvent (OutIndexEvent e) = void $ produceIndexEvents [e]
sendOutEvent (OutToStateDiff cId cInfo bHash cn app) = withCurrentBlockHash bHash $ initializeChainDBs (Just cId) cInfo cn app
sendOutEvent (OutStateDiff diff) = commitSqlDiffs diff
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ void $ produceIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ void $ produceIndexEvents (EventDBEntry <$> e)
sendOutEvent (OutTXR tr) = void . produceVMEvents $ [NewTransactionResult tr]
sendOutEvent (OutASM asm) =
  when (not flags_sqlDiff) $
    timeit "updateSQLBalanceAndNonce" (Just vmBlockInsertionMined) $
      updateSQLBalanceAndNonce $
        [ ( theAccount,
            (addressStateBalance asMod, addressStateNonce asMod)
          )
          | (theAccount, Mem.ASModification asMod) <- M.toList asm
        ]
sendOutEvent (OutJSONRPC s b) = liftIO $ produceResponse s b
sendOutEvent (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
sendOutEvent (OutBlockVerificationFailure _) = pure ()
sendOutEvent (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
sendOutEvent (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
sendOutEvent (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]

consumerGroup :: ConsumerGroup
consumerGroup = "ethereum-vm"

