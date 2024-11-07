{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.CommunicationConduit
  ( handleMsgServerConduit,
    handleMsgClientConduit,
    bytesToMessages,
    debounceTxSendsAndUnseq,
    messageToBytes
  )
where

import BlockApps.Logging
import Blockchain.Constants hiding (ethVersion)
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.Control (P2PCNC (..))
import Blockchain.Data.RLP
import Blockchain.Data.Wire as W
import Blockchain.Event
import Blockchain.EventException
import Blockchain.Frame
import Blockchain.Metrics
import Blockchain.Options
import Blockchain.Participation
import Blockchain.Sequencer.Event
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Options (computeNetworkID)
import Blockchain.Strato.Model.Util
import Blockchain.Threads
import Conduit
import Control.Monad (forever, when)
import qualified Control.Monad.Change.Modify as Mod
import Crypto.Types.PubKey.ECC
import Data.Bits (shiftL)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Conduit.Binary as CB
import Data.Conduit.TQueue
import Data.List.Split
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Text.Printf
import UnliftIO.Exception
import UnliftIO.STM

ethVersion :: Int
ethVersion = 63
{-# INLINE ethVersion #-}

blockstanbulVersion :: Int
blockstanbulVersion = 1


debounceTxSendsAndUnseq :: (MonadIO m, m `Mod.Outputs` [IngestEvent]) => ConduitT (Either P2PCNC Message) Message m ()
debounceTxSendsAndUnseq = do
  txq <- atomically newTQueue
  awaitForever $ \case
    Right (W.Transactions txs) -> do
      atomically $ mapM_ (writeTQueue txq) txs
      recordQueuedTxs txs
    Right other -> yield other
    Left TXQueueTimeout -> do
      txs <- atomically $ flushTQueue txq
      recordEmptyQueue
      yieldMany . map W.Transactions $ chunksOf 100 txs
    Left (ToUnseq ie) -> lift $ Mod.output ie

handleMsgClientConduit ::
  MonadP2P m =>
  Point ->
  PPeer ->
  ConduitM Event (Either P2PCNC Message) m ()
handleMsgClientConduit myId peer = do
  $logDebugS "handleMsgClientConduit" $ T.pack $ "<waving hand emoji>"
  yield $
    Right
      Hello
        { version = 4,
          clientId = stratoVersionString,
          capability =
            [ ETH . fromIntegral $ ethVersion,
              IST . fromIntegral $ blockstanbulVersion
            ],
          port = 0,
          nodeId = myId
        }
  $logDebugS "handleMsgClientConduit" $ T.pack $ "about to parse message"
  awaitMsg >>= \case
    Just Hello {} ->
      yield
        =<< lift
          ( Mod.get (Mod.Proxy @BestSequencedBlock) >>= \(BestSequencedBlock (BestBlock bHash highestBlockNum')) -> do
              (GenesisBlockHash genHash) <- Mod.access (Mod.Proxy @GenesisBlockHash)
              let s = Status
                      { protocolVersion = fromIntegral ethVersion,
                        networkID = computeNetworkID,
                        highestBlockNum = highestBlockNum',
                        latestHash = bHash,
                        genesisHash = genHash
                      }
              return $ Right s
          )
    other -> assertHandshake other
  awaitMsg >>= \case
    Just Status {protocolVersion = ver, highestBlockNum = highestBlockNum', genesisHash = peerGH, latestHash = peerBestHash, networkID = networkID'} -> do
      (GenesisBlockHash genHash) <- lift $ Mod.access (Mod.Proxy @GenesisBlockHash)
      when (peerGH /= genHash) $ throwIO WrongGenesisBlock
      when (networkID' /= computeNetworkID) $ throwIO $ NetworkIDMismatch
      -- starting at protocol version 63, total difficulty is exactly block number (not 8192 more)
      let highestBlockNum'' = if ver < 63 then highestBlockNum' - 8192 else highestBlockNum'
      lift . Mod.put (Mod.Proxy @WorldBestBlock) . WorldBestBlock $ BestBlock peerBestHash highestBlockNum''
      BestSequencedBlock (BestBlock _ lastBlockNumber) <- lift $ Mod.get (Mod.Proxy @BestSequencedBlock)
      mrh <- lift $ unMaxReturnedHeaders <$> Mod.access (Mod.Proxy @MaxReturnedHeaders)
      yield . Right $ GetBlockHeaders (BlockNumber (max (lastBlockNumber - flags_syncBacktrackNumber) 0)) mrh 0 Forward
      yield . Right $ GetChainDetails []
      handleGetChainDetails peer S.empty
      lift stampActionTimestamp
    other -> assertHandshake other
  handleEvents peer .| filterMC (either (const $ return True) checkOutbound)

handleMsgServerConduit ::
  MonadP2P m =>
  Point ->
  PPeer ->
  ConduitM Event (Either P2PCNC Message) m ()
handleMsgServerConduit myPubkey peer = do
  $logDebugS "handleMsgServerConduit" $ T.pack $ "about to parse message"

  numActivePeers <- liftIO $ fmap length getPeersByThreads

  when (numActivePeers > flags_maxConn) $ do
    yield $ Right $ Disconnect TooManyPeers
    throwIO CurrentlyTooManyPeers
    
  awaitMsg >>= \case
    Just Hello {} -> do
      $logInfoS "handshake/Hello{}" "received hello"
      let helloMsg' =
            Hello
              { version = 4,
                clientId = stratoVersionString,
                capability = [ETH (fromIntegral ethVersion)],
                port = 0,
                nodeId = myPubkey
              }
      yield $ Right helloMsg'
    other -> assertHandshake $ other
  awaitMsg >>= \case
    Just Status {protocolVersion = ver, highestBlockNum = theirHighestBlockNum, genesisHash = peerGH, latestHash = peerBestHash, networkID = networkID'} -> do
      $logInfoS "serverHandshake/Status{}" "received status"
      yield
        =<< lift
          ( Mod.get (Mod.Proxy @BestSequencedBlock) >>= \(BestSequencedBlock (BestBlock bHash myHighestBlockNum)) -> do
              (GenesisBlockHash genHash) <- Mod.access (Mod.Proxy @GenesisBlockHash)
              -- starting at protocol version 63, total difficulty is exactly block number (not 8192 more)
              let highestBlockNum' = if ver < 63 then theirHighestBlockNum - 8192 else theirHighestBlockNum
              when (networkID' == computeNetworkID && genHash == peerGH) $ Mod.put (Mod.Proxy @WorldBestBlock) . WorldBestBlock $ BestBlock peerBestHash highestBlockNum'
              return $
                Right
                  Status
                    { protocolVersion = fromIntegral ethVersion,
                      networkID = computeNetworkID,
                      highestBlockNum = myHighestBlockNum,
                      latestHash = bHash,
                      genesisHash = genHash
                    }
          )
      BestSequencedBlock (BestBlock _ lastBlockNumber) <- lift $ Mod.get (Mod.Proxy @BestSequencedBlock)
      mrh <- lift $ unMaxReturnedHeaders <$> Mod.access (Mod.Proxy @MaxReturnedHeaders)
      yield . Right $ GetBlockHeaders (BlockNumber (max (lastBlockNumber - flags_syncBacktrackNumber) 0)) mrh 0 Forward
      yield . Right $ GetChainDetails []
      handleGetChainDetails peer S.empty
      lift stampActionTimestamp
    other -> assertHandshake other
  handleEvents peer .| filterMC (either (const $ return True) checkOutbound)

awaitMsg :: (MonadIO m) => ConduitM Event (Either P2PCNC Message) m (Maybe Message)
awaitMsg =
  await >>= \case
    Just (MsgEvt msg) -> return (Just msg)
    Nothing -> return Nothing
    _ -> awaitMsg

assertHandshake ::
  (MonadLogger m, MonadIO m) =>
  Maybe Message ->
  m ()
assertHandshake mmsg = do
  let theFail = maybe PeerDisconnected EventBeforeHandshake mmsg
  $logErrorS "assertHandshake" . T.pack $ "assertHandshake called: " ++ show theFail
  throwIO theFail

cbSafeTake' ::
  forall o m.
  Monad m =>
  Int ->
  ConduitM BC.ByteString o m BC.ByteString
cbSafeTake' i = fromMaybe (error "cb\"Safe\"Take: not enough data") <$> cbSafeTake i

getRLPData :: Monad m => forall void. ConduitM B.ByteString void m B.ByteString
getRLPData =
  (fromMaybe $ error "no rlp data") <$> CB.head >>= \case
    x | x < 128 -> return $ B.singleton x
    x | x >= 192 && x <= 192 + 55 -> do
      rest <- cbSafeTake' $ fromIntegral $ x - 192
      return $ x `B.cons` rest
    x | x >= 0xF8 && x <= 0xFF -> do
      length' <- cbSafeTake' $ fromIntegral x - 0xF7
      rest <- cbSafeTake' . fromIntegral . bytes2Integer $ B.unpack length'
      return $ x `B.cons` length' `B.append` rest
    x -> error $ "missing case in getRLPData: " ++ show x

bytesToMessages :: Monad m => ConduitM B.ByteString Message m ()
bytesToMessages = forever $ do
  msgTypeData <- cbSafeTake' 1
  let word = fromInteger (rlpDecode $ rlpDeserialize msgTypeData :: Integer)
  objBytes <- getRLPData
  yield $ obj2WireMessage word $ rlpDeserialize objBytes

maxMessageSize :: Int
maxMessageSize = 1 `shiftL` 24

messageToBytes :: Monad m => ConduitM Message B.ByteString m ()
messageToBytes = mapC serializeWithRespectToMaxMessageSize
  where
    serializeWithRespectToMaxMessageSize :: Message -> B.ByteString
    serializeWithRespectToMaxMessageSize msg =
      let (theWord, o) = wireMessage2Obj msg
          bs = theWord `B.cons` rlpSerialize o
       in if B.length bs >= maxMessageSize
            then case msg of
              NewBlockHashes arr -> serializeWithRespectToMaxMessageSize . NewBlockHashes $ firstHalf arr
              Transactions arr -> serializeWithRespectToMaxMessageSize . Transactions $ firstHalf arr
              BlockHeaders arr -> serializeWithRespectToMaxMessageSize . BlockHeaders $ firstHalf arr
              GetBlockBodies arr -> serializeWithRespectToMaxMessageSize . GetBlockBodies $ firstHalf arr
              BlockBodies arr -> serializeWithRespectToMaxMessageSize . BlockBodies $ firstHalf arr
              GetChainDetails arr -> serializeWithRespectToMaxMessageSize . GetChainDetails $ firstHalf arr
              ChainDetails arr -> serializeWithRespectToMaxMessageSize . ChainDetails $ firstHalf arr
              GetTransactions arr -> serializeWithRespectToMaxMessageSize . GetTransactions $ firstHalf arr
              _ ->
                error $
                  printf
                    "messageToBytes: message (%s...) too large to be sent via RLPx and can't be truncated (%d >= %d)"
                    (take 50 $ show msg)
                    (B.length bs)
                    maxMessageSize
            else bs

    firstHalf :: [a] -> [a]
    firstHalf arr = take (length arr `div` 2) arr
