{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Event
  ( module Blockchain.EventModel,
    handleEvents,
    handleGetChainDetails,
    checkPeerIsMember,
  )
where

import BlockApps.Crossmon (recordMaxBlockNumber)
import BlockApps.Logging
import BlockApps.X509.Certificate as XC
import Blockchain.Blockstanbul (blockstanbulSender, WireMessage)
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.Data.Control (P2PCNC (..))
import Blockchain.Data.Enode
import Blockchain.Data.PubKey
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.Transaction
import Blockchain.Data.TransactionDef (formatChainId)
import Blockchain.Data.Wire
import Blockchain.EventException
import Blockchain.EventModel
import Blockchain.Options
import Blockchain.Sequencer.Event
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.MicroTime
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Verification
import Control.Arrow (second, (&&&))
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify hiding (awaitForever, get, put, yield)
import qualified Control.Monad.Change.Modify as Mod (get, put)
import Control.Monad.IO.Class
import Control.Monad.State
import qualified Data.ByteString.Base16 as BC16
import qualified Data.ByteString.Char8 as BS8
import Data.Conduit
import qualified Data.DList as DL
import Data.Default (def)
import Data.Foldable (for_)
import Data.List hiding (insert, lookup)
import Data.Map.Internal (WhenMatched (..), WhenMissing (..))
import Data.Map.Merge.Strict
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Ranged (rSetIntersection, rSetUnion)
import qualified Data.Set as S
import qualified Data.Text as T
import Data.These
import Data.Time.Clock
import Debug.Trace (trace)
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Tools
import UnliftIO.Exception
import Prelude hiding (lookup)

-- drop every n-th element from the list
-- e.g. skipEntries 0 [1..20] => [1..20]
--      skipEntries 1 [1..20] => [13,5,7,9,11,13,15,17,19]
--      skipEntries 2 [1..20] => [14,7,10,13,16,19]
--      skipEntries 3 [1..20] => [15,9,13,17]
skipEntries :: Int -> [a] -> [a]
skipEntries n xs = if null xs then [] else head xs : helper (tail xs)
  where
    helper xs' = case drop n xs' of
      (y : ys) -> y : helper ys
      [] -> []

peerString :: PPeer -> String
peerString peer = key ++ "@" ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)
  where
    key = p2s (pPeerPubkey peer)
    p2s (Just p) = BS8.unpack . BC16.encode $ pointToBytes p
    p2s _ = ""

yieldR :: Monad m => a -> ConduitT i (Either e a) m ()
yieldR = yield . Right

yieldL :: Monad m => e -> ConduitT i (Either e a) m ()
yieldL = yield . Left

handleEvents :: MonadP2P m => PPeer -> ConduitM Event (Either P2PCNC Message) m ()
handleEvents peer = awaitForever $ \case
  MsgEvt Hello {} -> error "A hello message appeared after the handshake"
  MsgEvt Status {} -> error "A status message appeared after the handshake"
  MsgEvt Ping -> yieldR Pong
  MsgEvt (Transactions txs) -> do
    $logInfoS "handleEvents/Transactions" . T.pack $ "Got " ++ show (length txs) ++ " transaction(s) from" ++ peerString peer ++ ", they are " ++ (intercalate "\n" (format <$> txs))
    lift stampActionTimestamp
    let txo = Origin.PeerString (peerString peer)
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx txo <$> txs
    yieldL $ ToUnseq ingestTxs
  MsgEvt (NewBlock block' _) -> do
    lift stampActionTimestamp
    $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock"
    let sha = blockHash block'
    let header = blockHeader block'
    let num = blockHeaderBlockNumber header
    let parentHash' = blockHeaderParentHash header
    lift . Mod.put (Proxy @WorldBestBlock) . WorldBestBlock $
      BestBlock sha num
    parentHeader <- lift $ lookup (Proxy @BlockHeader) parentHash'
    case parentHeader of
      Nothing -> do
        BestSequencedBlock bestBlock <- lift $ Mod.get (Proxy @BestSequencedBlock)
        let bestBlockNum = numberFromBestBlock bestBlock
            fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "#### New block is missing its parent, I am resyncing"
        syncFetch Forward fetchNumber
      Just _ -> do
        let ingestBlock = IEBlock $ blockToIngestBlock (Origin.PeerString $ peerString peer) block'
        yieldL $ ToUnseq [ingestBlock]
  MsgEvt (NewBlockHashes _) -> do
    lift stampActionTimestamp
    BestSequencedBlock bestBlock <- lift $ Mod.get (Proxy @BestSequencedBlock)
    let bestBlockNum = numberFromBestBlock bestBlock
    let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
    $logInfoS "handleEvents/NewBlockHashes" $ T.pack $ "newBlockHashes :: fetchNumber is " ++ show fetchNumber
    syncFetch Forward fetchNumber
  MsgEvt (GetBlockHeaders (BlockNumber start) max' skip' dir) -> do
    lift stampActionTimestamp
    start' <- case dir of
      Reverse -> return $ if start > fromIntegral max' then start - (fromIntegral max') else 1
      Forward -> return start
    mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
    -- When the skip is 0, none of the blocks are skipped but when the skip is 3,
    -- 3/4s of the blocks will be dropped when creating the blockheaders
    -- so we overcompensate here.
    let count = (1 + skip') * min mrh max'
    chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start' ..]
    when (null chain) $
      $logInfoS "handleEvents/GetBlockHeaders" $
        T.concat $
          [ "Warning: A peer requested blocks starting at #",
            T.pack $ show start,
            ", but we don't have these in our canonical chain....",
            " I don't know what to do, so I am returning a blank response.",
            " This may indicate something unhealthy in the network."
          ]
    yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain
  MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> do
    lift stampActionTimestamp
    maybeHeader <- lift $ lookup (Proxy @BlockHeader) start
    case maybeHeader of
      Nothing -> yieldR (BlockBodies [])
      Just head' -> do
        let num = blockHeaderBlockNumber head'
            start' = case dir of
              Forward -> num
              Reverse ->
                if num > fromIntegral max'
                  then num - fromIntegral max'
                  else 1
        mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
        let count = (1 + skip') * min mrh (fromIntegral max')
        chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start' ..]
        yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain
  MsgEvt (BlockHeaders bHeaders) -> do
    let headers = morphBlockHeader <$> bHeaders
    --- put bheaders log right here
    lift stampActionTimestamp
    -- check if blockheaders we recieved have parents.
    let parents = map BlockHeader.parentHash headers
    existingParents <- lift $ lookupMany (Proxy @BlockHeader) parents
    let missingParents = S.fromList parents S.\\ (M.keysSet existingParents `S.union` S.fromList (blockHeaderHash <$> bHeaders))
    unless (S.null missingParents) $ do
      BestSequencedBlock bestBlock <- lift $ Mod.get (Proxy @BestSequencedBlock)
      let fetchNumber = numberFromBestBlock bestBlock + 1
      $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "blockHeaders :: fetchNumber is " ++ show fetchNumber
      $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "missing blocks: " ++ (unlines $ format <$> S.toList missingParents)
      if M.null existingParents
        then syncFetch Forward fetchNumber
        else syncFetch Reverse (minimum $ blockHeaderBlockNumber <$> M.elems existingParents)
    
    alreadyRequestedHeaders <- lift getBlockHeaders -- check what already requested
    alreadyRequestedRemainingHeaders <- lift getRemainingBHeaders
    let headerHashes = map (blockHeaderHash &&& id) headers
        hashes = map fst headerHashes
    headersInDB <- fmap M.keysSet . lift $ lookupMany (Proxy @BlockHeader) hashes
    let neededHeaders = snd <$> filter (not . flip S.member headersInDB . fst) headerHashes
        (neededHeaders', remainingHeaders) = splitNeededHeaders neededHeaders
    case (alreadyRequestedHeaders, alreadyRequestedRemainingHeaders) of
      ([], _) -> do
        -- proceed if we are not already requesting bodies
        lift $ putBlockHeaders neededHeaders'
        lift $ putRemainingBHeaders remainingHeaders
        $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders')
        unless (null neededHeaders') $ do 
          yieldR . GetBlockBodies $ blockHeaderHash <$> neededHeaders'
        lift stampActionTimestamp
      (_, []) -> do
        lift $ putRemainingBHeaders neededHeaders -- save it to handle later
        $logInfoS "handleEvents/BlockHeaders" $ 
          "Not requesting BlockBodies because cache is currently in use, but will request after next batch of BlockBodies arrives."
      (_, _) -> $logInfoS "handleEvents/BlockHeaders" $
          T.unlines
            [ "Tried to request more block bodies but it seems the block headers cache is currenlty being used.",
              "If this message shows up a lot but the node's best block # doesn't increase,",
              "there might be something wrong with the cache."
            ]

  -- todo: seems like geth and parity will send bodies on a best-effort, skipping shas they doesnt have
  -- todo: e.g. if they have bodies for Keccak256s [1, 2, 4, 7, 8, 9] and you request [1..10] you'll get
  -- todo: bodies [1, 2, 4, 7, 8, 9] and have to correlate the bodies to the headers yourself
  -- todo: it doesn't seem like we support that behavior very well yet, so we'll just stop sending
  -- todo: blocks once we can't find one. this way we can always correlate header to body in
  -- todo: `(MsgEvt (BlockBodies bodies))` with something akin to `zipWith getHeader shas bodies`
  -- todo: our ideal scenario behavior would be returning something like [1, 2, [], 4, [], [], 7, 8, 9, []]
  -- todo: but alas, the devs hate us.
  -- todo: instead, we'd just return [1, 2] in this case, and hope the peer re-requests the missing blocks from
  -- todo: someone else or us at a later time
  MsgEvt (GetBlockBodies []) -> do
    lift stampActionTimestamp
    yieldR (BlockBodies []) -- todo parity bans peers when they do this. should we?
  MsgEvt (GetBlockBodies shas') -> do
    lift stampActionTimestamp
    mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
    let shas = take mrh shas'
    lift (getUntilMissing shas DL.empty DL.empty) >>= \(bodies, pshas) -> do
      yieldR . BlockBodies $ map (second (map morphBlockHeader) . toBody) bodies
      ptxs <- fmap M.elems . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) pshas
      unless (null ptxs) . yieldR . Transactions $ morphTx . snd . unPrivate <$> ptxs
    where
      getUntilMissing ::
        ( (Keccak256 `Selectable` ChainTxsInBlock) m,
          (Word256 `Selectable` ChainMemberRSet) m,
          (Keccak256 `Alters` OutputBlock) m,
          (Address `Selectable` X509CertInfoState) m,
          Accessible PublicKey m
        ) =>
        [Keccak256] ->
        DL.DList OutputBlock ->
        DL.DList Keccak256 ->
        m ([OutputBlock], [Keccak256])
      getUntilMissing [] bodies pshas = return (DL.toList bodies, DL.toList pshas)
      getUntilMissing (h : hs) bodies pshas =
        lookup (Proxy @OutputBlock) h >>= \case
          Nothing -> return (DL.toList bodies, DL.toList pshas)
          Just body -> do
            ChainTxsInBlock cIdTxsMap <- selectWithDefault (Proxy @ChainTxsInBlock) h
            mems <- selectMany (Proxy @ChainMemberRSet) $ M.keys cIdTxsMap
            peerX509 <- getPeerX509 peer
            myX509 <- getMyX509
            let whenMissing f = WhenMissing (pure . M.map f) (\_ x -> (pure . Just $ f x))
                trMems =
                  merge
                    (whenMissing This)
                    (whenMissing That)
                    (WhenMatched $ \_ x y -> pure . Just $ These x y)
                    cIdTxsMap
                    mems
                filtered =
                  flip M.filter trMems $
                    mergeTheseWith (const False) (checkPeerIsMember myX509 peerX509) (||)
                pshas' = M.foldr (DL.append . DL.fromList . these id (const []) const) DL.empty filtered
            getUntilMissing hs (bodies `DL.snoc` body) (pshas `DL.append` pshas')

      toBody :: OutputBlock -> ([Transaction], [BlockHeader])
      toBody = ((map otBaseTx . obReceiptTransactions) &&& obBlockUncles)

  -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
  -- todo:
  MsgEvt (BlockBodies []) -> do 
    lift stampActionTimestamp
    lift $ putBlockHeaders [] -- clear cache for other threads
    lift $ putRemainingBHeaders []
  MsgEvt (BlockBodies bodies) -> do
    lift stampActionTimestamp
    headers <- lift getBlockHeaders
    let verified = and $ zipWith (\h b -> BlockHeader.transactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
    unless verified $ error "headers don't match bodies"
    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
    unless (null headers) $ recordMaxBlockNumber "p2p_block_bodies" . maximum $ map BlockHeader.number headers
    let blocks' = zipWith createBlockFromHeaderAndBody (morphBlockHeader <$> headers) bodies
    yieldL . ToUnseq $ IEBlock . blockToIngestBlock (Origin.PeerString $ peerString peer) <$> blocks'
    rHeaders <- lift getRemainingBHeaders
    let (neededHeaders, remainingHeaders) = splitNeededHeaders rHeaders
    lift $ putBlockHeaders neededHeaders
    lift $ putRemainingBHeaders remainingHeaders
    if null neededHeaders
      then do
        mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
        let sortedHeaders = sortOn blockHeaderBlockNumber headers
        yieldR $ GetBlockHeaders (BlockHash $ blockHeaderHash $ last sortedHeaders) mrh 0 Forward
        lift stampActionTimestamp
      else do
        yieldR $ GetBlockBodies (map blockHeaderHash neededHeaders)
        lift stampActionTimestamp
  MsgEvt (Blockstanbul wm) -> do
    lift $ do
      stampActionTimestamp
      setPeerAddrIfUnset $ blockstanbulSender wm
      peerAddr <- unPeerAddress <$> access (Proxy @PeerAddress)
      $logInfoS "handleEvents/Blockstanbul" . T.pack $ "blockstanbulPeerAddr: " ++ show peerAddr
    let msgHash = rlpHash wm
    lift $ insert (Proxy @(Proxy (Outbound WireMessage))) (pPeerIp peer, msgHash) Proxy
    msgExists <- lift $ exists (Proxy @(Proxy (Inbound WireMessage))) msgHash
    if msgExists
      then
        $logInfoS "handleEvents/Blockstanbul" . T.pack $
          concat
            [ "Already seen inbound wire message ",
              format msgHash,
              ". Not forwarding to Sequencer."
            ]
      else do
        $logInfoS "handleEvents/Blockstanbul" . T.pack $
          concat
            [ "First time seeing inbound wire message ",
              format msgHash,
              ". Forwarding to Sequencer."
            ]
        lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
        yieldL $ ToUnseq [IEBlockstanbul wm]

  -- private chains
  MsgEvt (GetChainDetails cids') -> handleGetChainDetails peer $ S.fromList cids'
  MsgEvt (ChainDetails _) -> return ()

  -- TODO: Optimize/do security checking (a peer can spam you with random hashes and keep you busy forever)
  MsgEvt (GetTransactions trHashes) -> do
    lift stampActionTimestamp
    $logInfoS "handleEvents/GetTransactions" $
      T.pack $
        "requesting info for txHashes: "
          ++ (intercalate "\n" (format <$> trHashes))
          ++ " from peer "
          ++ peerString peer
    ptrs <- fmap (map unPrivate . M.elems) . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) trHashes
    mems <- lift . selectMany (Proxy @ChainMemberRSet) $ map fst ptrs
    peerX509 <- lift $ getPeerX509 peer
    myX509 <- lift getMyX509
    let peerCheck (cId, _) = checkPeerIsMember myX509 peerX509 . fromMaybe def $ M.lookup cId mems
    yieldR . Transactions . map (morphTx . snd) $ filter peerCheck ptrs
  MsgEvt (GetMPNodes srs) -> do
    let txo = Origin.PeerString (peerString peer)
    yieldL $ ToUnseq [IEGetMPNodesRequest txo srs]
  MsgEvt (MPNodes nds) -> do
    yieldL $ ToUnseq [IEMPNodesReceived nds]
  MsgEvt (Disconnect _) -> do
    $logInfoS "handleEvents/Disconnect" $ T.pack $ "Disconnect event received in Event handler"
    throwIO PeerDisconnected
  NewSeqEvent oe -> case oe of
    P2pBlock b -> do
      when (shouldSend peer $ obOrigin b) $ do
        WorldBestBlock (BestBlock _ worldNumber) <- lift $ Mod.get (Proxy @WorldBestBlock)
        $logInfoS "handleEvents/P2pBlock" . T.pack $ "World Number: " ++ show worldNumber
        when (BlockHeader.number (obBlockData b) >= worldNumber) $ do
          $logInfoS "handleEvents/P2pBlock" . T.pack $ "yielding new block: " ++ show (BlockHeader.number . blockBlockData . outputBlockToBlock $ b)
          yieldR $ NewBlock (outputBlockToBlock b) 0
    P2pTx tx -> do
      let mCid = txChainId tx
      match <- case mCid of
        Nothing -> return True
        Just cId -> do
          peerX509 <- lift $ getPeerX509 peer
          myX509 <- lift getMyX509
          mems <- lift $ selectWithDefault (Proxy @ChainMemberRSet) cId
          return $ checkPeerIsMember myX509 peerX509 mems

      when (shouldSend peer $ otOrigin tx) $ do
        if not match
          then
            $logInfoS "handleEvents/P2pTx" $
              T.pack $
                printf "peer is not authorized for chainID %s" (formatChainId mCid)
          else do
            $logInfoS "handleEvents/P2pTx" $ T.pack $ "sending Transaction " ++ format (otHash tx) ++ " for chainID " ++ formatChainId mCid
            $logDebugS "handleEvents/P2pTx" . T.pack $ "the transaction was: " ++ format tx
            yieldR $ Transactions [otBaseTx tx]
    P2pGenesis (OutputGenesis og (cId, cInfo@(ChainInfo uci _))) -> do
      when (shouldSend peer og) $ do
        $logInfoS "handleEvents/P2pGenesis" . T.pack $ "received new chain: " ++ formatChainId (Just cId) ++ " with " ++ show uci
        peerX509 <- lift $ getPeerX509 peer
        myX509 <- lift getMyX509
        if checkPeerIsMember myX509 peerX509 (chainMembersToChainMemberRset (members uci))
          then do
            $logInfoS "handleEvents/P2pGenesis" $ T.pack $ "sending ChainDetails for chainID " ++ (formatChainId $ Just cId)
            yieldR $ ChainDetails [(cId, cInfo)]
          else do
            $logInfoS "handleEvents/P2pGenesis" $
              T.pack $
                printf "peer is not authorized for received chainID %s" (formatChainId $ Just cId)
            $logDebugLS "handleEvents/P2pGenesis/members" $ (unChainMembers (members uci))
    P2pGetChain chainIds -> yieldR $ GetChainDetails chainIds
    P2pGetTx shas -> yieldR $ GetTransactions shas
    P2pNewOrgName cId org -> do
      let formatted = CL.yellow $ format cId
          orgFormat = CL.blue $ show org
      $logInfoS "handleEvents/P2pNewOrgName" $ T.pack $ "New organization associated with chain " ++ formatted ++ " for org " ++ orgFormat
      peerX509 <- lift $ getPeerX509 peer
      myX509 <- lift getMyX509
      ChainMemberRSet mems <- lift $ selectWithDefault (Proxy @ChainMemberRSet) cId
      let (hasAccess, ChainMemberRSet newMem) = chainMemberParsedSetToChainMemberRSet org
          mems' = ChainMemberRSet $ (if hasAccess then rSetUnion else rSetIntersection) mems newMem
      when (checkPeerIsMember myX509 peerX509 mems') $ do
        $logInfoS "handleEvents/P2pNewOrgName" $ T.pack $ "Peer cleared for chain " ++ formatted
        cInfo <- lift $ select (Proxy @ChainInfo) cId -- This should never be Nothing
        when (isJust cInfo) $ do
          yieldR $ ChainDetails [(cId, fromJust cInfo)]
    P2pBlockstanbul msg ->
      lift (fmap getChainMemberFromX509 <$> getPeerX509 peer) >>= \case
        Nothing ->
          $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $
            concat
              [ "Peer ",
                show (pPeerIp peer),
                " does not have a registered certificate"
              ]
        Just cm ->
          maybe False unIsValidator <$> lift (select (Proxy @IsValidator) cm) >>= \case
            False ->
              $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $
                concat
                  [ "Peer ",
                    show (pPeerIp peer),
                    " is not a validator"
                  ]
            True -> do
              let outbound = Blockstanbul msg
              $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $ "Outgoing mesage: " ++ show outbound
              let !msgHash = rlpHash msg
              lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
              msgExists <- lift $ exists (Proxy @(Proxy (Outbound WireMessage))) (pPeerIp peer, msgHash)
              if msgExists
                then
                  $logInfoS "handleEvents/P2pBlockstanbul" $
                    T.concat
                      [ "Already seen outbound wire message ",
                        T.pack (format msgHash),
                        ". Not forwarding to peer ",
                        pPeerIp peer
                      ]
                else do
                  $logInfoS "handleEvents/P2pBlockstanbul" $
                    T.concat
                      [ "First time seeing outbound wire message ",
                        T.pack (format msgHash),
                        ". Forwarding to peer ",
                        pPeerIp peer
                      ]
                  let !ip = pPeerIp peer
                  lift $ insert (Proxy @(Proxy (Outbound WireMessage))) (ip, msgHash) Proxy
                  yieldR outbound
    P2pAskForBlocks start _ _ -> do
      $logDebugS "handleEvents/P2pAskForBlocks" . T.pack $ "syncFetch: " ++ show start
      syncFetch Forward start
    P2pPushBlocks start end p -> do
      ss <- lift $ shouldSendToPeer p
      when ss $ do
        mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
        let count = min mrh . fromIntegral $ end - start + 1
        chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start ..]
        when (null chain) $
          $logErrorS "handleEvents/P2pPushBlocks" . T.pack $
            printf
              "Blockstanbul believes we have blocks for [%d..%d], they are not found in redis"
              start
              end
        let outbound = BlockHeaders $ morphBlockHeader . unCanonical . snd <$> chain
        $logDebugS "handleEvents/P2pPushBlocks" . T.pack $ "Outgoing message: " ++ show outbound
        yieldR outbound
    P2pGetMPNodes srs -> yieldR $ GetMPNodes srs
    P2pMPNodesResponse o nds -> when (shouldRespond peer o) . yieldR $ MPNodes nds
  TimerEvt -> do
    maybeOldTS <- unActionTimestamp <$> lift getActionTimestamp
    case maybeOldTS of
      Just oldTS -> do
        ts <- liftIO getCurrentTime
        let diffTime = ts `diffUTCTime` oldTS
        maxTime <- fromIntegral . unConnectionTimeout <$> lift (access (Proxy @ConnectionTimeout))
        liftIO $ setTitle $ "timer: " ++ show (maxTime - diffTime)
        when (diffTime > maxTime) $ do
          yieldR $ Disconnect UselessPeer
          liftIO $ setTitle "timer timed out!"
          throwIO PeerNonResponsive
      Nothing -> do
        $logInfoS "TimerEvt" $ T.pack "Timestamp is not set"
        return ()
    yieldL TXQueueTimeout
  AbortEvt reason -> do
    $logInfoS "handleEvents/AbortEvt" . T.pack $ "Received AbortEvt: " ++ reason
    yieldR $ Disconnect AlreadyConnected
  event -> liftIO . error $ "unrecognized event: " ++ show event

handleGetChainDetails ::
  ( MonadIO m,
    MonadLogger m,
    (ChainMemberParsedSet `Selectable` TrueOrgNameChains) m,
    (ChainMemberParsedSet `Selectable` FalseOrgNameChains) m,
    (Word256 `Selectable` ChainMemberRSet) m,
    (Word256 `Selectable` ChainInfo) m,
    (Address `Selectable` X509CertInfoState) m,
    Modifiable ActionTimestamp m,
    Accessible PublicKey m
  ) =>
  PPeer ->
  S.Set Word256 ->
  ConduitM Event (Either P2PCNC Message) m ()
handleGetChainDetails peer cids' = do
  peerX509 <- lift $ getPeerX509 peer
  myX509 <- lift getMyX509
  cids <-
    S.toList
      <$> if S.null cids'
        then do
          TrueOrgNameChains trueChains <- case peerX509 of
            Nothing -> return $ TrueOrgNameChains S.empty
            Just cmps -> lift $ selectWithDefault (Proxy @TrueOrgNameChains) (x509CertInfoStateToCMPS cmps)
          FalseOrgNameChains falseChains <- case peerX509 of
            Nothing -> return $ FalseOrgNameChains S.empty
            Just cmps -> lift $ selectWithDefault (Proxy @FalseOrgNameChains) (x509CertInfoStateToCMPS cmps)
          return $ trueChains S.\\ falseChains
        else return cids'
  lift stampActionTimestamp
  $logInfoS "handleGetChainDetails" $ T.pack $ "details requested for chainIDs " ++ intercalate "\n" (formatChainId . Just <$> cids)
  mems <- lift $ selectMany (Proxy @ChainMemberRSet) cids
  let filteredPairs = M.keys $ M.filter (checkPeerIsMember myX509 peerX509) mems

  unless (null filteredPairs) $ do
    -- chains that use X509 may not have ChainMembers with enode addresses,
    -- so they will not have a Map in mems and their cInfos need to be queried separately
    cInfos' <- fmap M.toList . lift $ selectMany (Proxy @ChainInfo) $ filteredPairs
    for_ cInfos' $ yieldR . ChainDetails . (: [])
    lift stampActionTimestamp
    $logInfoS "handleGetChainDetails" $
      T.pack $
        "the following ChainIds were returned "
          ++ (intercalate "\n" $ formatChainId . Just . fst <$> cInfos')

numberFromBestBlock :: BestBlock -> Integer
numberFromBestBlock (BestBlock _ n) = n

syncFetch ::
  ( MonadIO m,
    Modifiable ActionTimestamp m,
    Accessible MaxReturnedHeaders m
  ) =>
  Direction ->
  Integer ->
  ConduitM Event (Either P2PCNC Message) m ()
syncFetch d num = do
  mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
  yieldR $ GetBlockHeaders (BlockNumber num) mrh 0 d
  lift stampActionTimestamp

shouldRespond :: PPeer -> Origin.TXOrigin -> Bool
shouldRespond peer txo = case txo of
  Origin.PeerString ps -> ps == peerString peer
  _ -> False

shouldSend :: PPeer -> Origin.TXOrigin -> Bool
shouldSend peer txo = case txo of
  Origin.PeerString ps -> ps /= peerString peer
  Origin.API -> True
  Origin.BlockHash _ -> False
  Origin.Direct -> True
  Origin.Quarry -> True -- this should never reach this far anyway
  Origin.Morphism ->
    -- probably means it was converted, see if this is a problem
    trace "NewTx of type Morphism came in. Should this even happen?" True
  Origin.Blockstanbul -> True

checkPeerIsMember :: Maybe X509CertInfoState -> Maybe X509CertInfoState -> ChainMemberRSet -> Bool
checkPeerIsMember myCert pcert mems = case pcert of
  Nothing -> False
  Just (X509CertInfoState _ _ _ _ n (Just u) c) -> (fmap x509CertInfoStateToCMPS myCert == fmap x509CertInfoStateToCMPS pcert) || isChainMemberInRangeSet (snd $ chainMemberParsedSetToChainMemberRSet (CommonName (T.pack n) (T.pack u) (T.pack c) True)) mems
  Just (X509CertInfoState _ _ _ _ n Nothing c) -> (fmap x509CertInfoStateToCMPS myCert == fmap x509CertInfoStateToCMPS pcert) || isChainMemberInRangeSet (snd $ chainMemberParsedSetToChainMemberRSet (CommonName (T.pack n) (T.pack "") (T.pack c) True)) mems

-- extract the organization name from the cert
x509CertInfoStateToCMPS :: X509CertInfoState -> ChainMemberParsedSet
x509CertInfoStateToCMPS (X509CertInfoState _ _ _ _ n u c) = CommonName (T.pack n) (maybe "" T.pack u) (T.pack c) True

{- to reduce redundant computations on dividing block chunks under txsLimit
splitNeededHeaders :: [BlockHeader] -> [[BlockHeader]]
splitNeededHeaders x =
  let txsLens = BlockHeader.extraData2TxsLen <$> extraData <$> neededHeaders
      txsLensInLimit =  scanl (\x y -> if ((x+y)>flags_maxHeadersTxsLens) then y else x+y) 0 txsLens
      indexToSplit :: Int -> [Int] -> [Int] -> [Int] -> [Int]
      indexToSplit index li (x:xs) (y:ys) =  indexToSplit (index++) li' xs ys
        where li = case (x==y) of
          True -> li:index
          False -> li
      indexToSplit _ li [] [] = li
  in splitAt -}

splitNeededHeaders :: [BlockHeader] -> ([BlockHeader], [BlockHeader])
splitNeededHeaders neededHeaders =
  let txsLens = BlockHeader.extraData2TxsLen <$> BlockHeader.extraData <$> neededHeaders
      txsLensInSums = scanl (+) (0) $ fromMaybe flags_averageTxsPerBlock <$> txsLens
      txsLensInLimit = takeWhile (< flags_maxHeadersTxsLens) $ tail txsLensInSums
   in splitAt (length txsLensInLimit) neededHeaders
