{-# LANGUAGE ConstraintKinds     #-}
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE PolyKinds           #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeFamilies        #-}
{-# LANGUAGE TypeOperators       #-}

module Blockchain.Event (
  module Blockchain.EventModel,
  handleEvents,
  handleGetChainDetails,
  checkPeerIsMember'' -- For testing
  ) where

import           Control.Arrow                         ((&&&), second)
import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify           hiding (get, put, yield, awaitForever)
import qualified Control.Monad.Change.Modify           as Mod (get, put)
import           Control.Monad.IO.Class
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Data.Conduit
import           Data.Default                          (def)
import           Data.Foldable                         (for_)
import qualified Data.DList                            as DL
import           Data.List                             hiding (insert, lookup)
import           Data.Map.Internal                     (WhenMissing(..), WhenMatched(..))
import           Data.Map.Merge.Strict
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import qualified Data.ByteString.Base16                as BC16
import qualified Data.ByteString.Char8                 as BS8
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Data.These
import           Data.Time.Clock
import           MonadUtils
import           Prelude                               hiding (lookup)
import           System.Random
import           Text.Printf
import           UnliftIO.Exception

import           BlockApps.Logging
import           BlockApps.X509.Certificate
import           Blockchain.Blockstanbul               (blockstanbulSender, WireMessage)
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control               (P2PCNC(..))
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionDef        (formatChainId)
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.EventModel
import           Blockchain.EventException
import           Blockchain.Options
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Address       (Address, formatAddressWithoutColor)
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Verification

import           Blockchain.Sequencer.Event

import           Blockchain.Strato.Model.Class

import           Blockapps.Crossmon                    (recordMaxBlockNumber)
import           Blockchain.Metrics

import qualified Text.Colors                           as CL
import           Text.Format
import           Text.Tools

import           Debug.Trace                           (trace)

setTitleAndProduceBlocks :: ( MonadLogger m
                            , MonadIO m
                            , Stacks Block m
                            ) => [Block] -> m Int
setTitleAndProduceBlocks blocks = do
    lastBlockHashes <- map blockHash <$> takeStack (Proxy @Block) 200
    let newBlocks = filter (not . (`elem` lastBlockHashes) . blockHash) blocks
    unless (null newBlocks) $ do
        liftIO . setTitle $ "Block #" ++ show (maximum $ map (blockDataNumber . blockBlockData) newBlocks)
        pushStack newBlocks
    return $ length newBlocks

-- drop every n-th element from the list
-- e.g. skipEntries 0 [1..20] => [1..20]
--      skipEntries 1 [1..20] => [13,5,7,9,11,13,15,17,19]
--      skipEntries 2 [1..20] => [14,7,10,13,16,19]
--      skipEntries 3 [1..20] => [15,9,13,17]
skipEntries :: Int -> [a] -> [a]
skipEntries n xs = if null xs then [] else head xs : helper (tail xs)
    where helper xs' = case drop n xs' of
                           (y:ys) -> y : helper ys
                           []     -> []

peerString :: PPeer -> String
peerString peer = key ++ "@" ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)
    where
        key = p2s (pPeerPubkey peer)
        p2s (Just p) = BS8.unpack . BC16.encode $ pointToBytes p
        p2s _        = ""

yieldR :: Monad m => a -> ConduitT i (Either e a) m ()
yieldR = yield . Right

yieldL :: Monad m => e -> ConduitT i (Either e a) m ()
yieldL = yield . Left

handleEvents :: MonadP2P m => PPeer -> ConduitM Event (Either P2PCNC Message) m ()
handleEvents peer = awaitForever $ \case
    MsgEvt Hello{}  -> error "A hello message appeared after the handshake"
    MsgEvt Status{} -> error "A status message appeared after the handshake"
-- TODO remove distinction between new status messages and old ones once entire protocol is complete
    MsgEvt NewStatus{} -> error "A new status message appeared after the handshake"
    MsgEvt Ping     -> yieldR Pong

    MsgEvt (Transactions txs) -> do
        $logInfoS "handleEvents/Transactions" . T.pack $ "Got " ++ show (length txs) ++ " transaction(s)"
        lift stampActionTimestamp
        let txo = Origin.PeerString (peerString peer)
        ts <- liftIO getCurrentMicrotime
        let ingestTxs = IETx ts . IngestTx txo <$> txs
        yieldL $ ToUnseq ingestTxs

    MsgEvt (NewBlock block' tdiff) -> do
        lift stampActionTimestamp
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock with tdiff " ++ show tdiff
        let sha         = blockHash block'
        let header      = blockHeader block'
        let num         = blockHeaderBlockNumber header
        let parentHash' = blockHeaderParentHash header
        lift . Mod.put (Proxy @WorldBestBlock) . WorldBestBlock $
          BestBlock sha num tdiff
        parentHeader <- lift $ lookup (Proxy @BlockData) parentHash'
        case parentHeader of
          Nothing -> do
            bestBlock <- lift $ Mod.get (Proxy @BestBlock)
            let bestBlockNum = numberFromBestBlock bestBlock
                fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
            $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
            $logInfoS "handleEvents/NewBlock" $ T.pack $ "#### New block is missing its parent, I am resyncing"
            syncFetch Forward fetchNumber
          Just _ -> do
            lift . void $ setTitleAndProduceBlocks [block']
            let ingestBlock = IEBlock $ blockToIngestBlock (Origin.PeerString $ peerString peer) block'
            yieldL $ ToUnseq [ingestBlock]

    MsgEvt (NewBlockHashes _) -> do
        lift stampActionTimestamp
        bestBlock <- lift $ Mod.get (Proxy @BestBlock)
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
      let count = (1 + skip') * max mrh max'
      chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start'..]
      when (null chain) $
        $logInfoS "handleEvents/GetBlockHeaders" $ T.concat $
            ["Warning: A peer requested blocks starting at #"
            , T.pack $ show start
            , ", but we don't have these in our canonical chain...."
            , " I don't know what to do, so I am returning a blank response."
            , " This may indicate something unhealthy in the network."]
      yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain

    MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> do
      lift stampActionTimestamp
      maybeHeader <- lift $ lookup (Proxy @BlockData) start
      case maybeHeader of
        Nothing    -> yieldR (BlockBodies [])
        Just head' -> do
          let num = blockHeaderBlockNumber head'
              start' = case dir of
                Forward -> num
                Reverse -> if num > fromIntegral max'
                             then num - fromIntegral max'
                             else 1
          mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
          let count = (1 + skip') * min mrh (fromIntegral num)
          chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start'..]
          yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain

    MsgEvt (BlockHeaders bHeaders) -> do
        let headers = morphBlockHeader <$> bHeaders
        lift stampActionTimestamp
        alreadyRequestedHeaders <- lift getBlockHeaders -- get already requested headers
        when (null alreadyRequestedHeaders) $ do        -- proceed if we are not already requesting headers
            -- let headerHashes = S.fromList $ map headerHash headers
            --     parentHashes = S.fromList $ map parentHash headers
            --     allNeeded = headerHashes `S.union` parentHashes

            -- check if blockheaders we recieved have parents.
            let parents = map blockDataParentHash headers
            existingParents <- lift $ lookupMany (Proxy @BlockData) parents
            let missingParents  = S.fromList parents S.\\ M.keysSet existingParents
            unless (S.null missingParents) $ do
                 bestBlock <- lift $ Mod.get (Proxy @BestBlock)
                 let fetchNumber = numberFromBestBlock bestBlock + 1
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "blockHeaders :: fetchNumber is " ++ show fetchNumber
                 let lastParent = if M.null existingParents
                                    then fetchNumber
                                    else head . sort $ blockHeaderBlockNumber <$> M.elems existingParents
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "missing blocks: " ++ (unlines $ format <$> S.toList missingParents)
                 syncFetch Reverse lastParent

            let headerHashes = map (blockHeaderHash &&& id) headers
                hashes = map fst headerHashes
            headersInDB <- fmap M.keysSet . lift $ lookupMany (Proxy @BlockData) hashes
            let neededHeaders = snd <$> filter (not . flip S.member headersInDB . fst) headerHashes
                (neededHeaders', remainingHeaders) = splitNeededHeaders neededHeaders
            -- blockOffsets <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ S.toList allNeeded
            -- let neededHeaders = filter (not . (`elem` blockOffsets) . headerHash) headers
            --     neededHashes = map headerHash neededHeaders
            --     neededParents = filter (not . (`elem` blockOffsets)) $ map parentHash neededHeaders
            --     unfoundParents = S.toList $ S.fromList neededParents S.\\ S.fromList neededHashes
            -- unless (null unfoundParents) $ do
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "neededHashes: " ++ unlines (map format neededHashes)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "incoming blocks don't seem to have existing parents: " ++ unlines (map format unfoundParents)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "### calling syncFetch again" >> syncFetch

            lift $ putBlockHeaders neededHeaders'
            lift $ putRemainingBHeaders remainingHeaders
            $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders')
            yieldR . GetBlockBodies $ blockHeaderHash <$> neededHeaders'
            lift stampActionTimestamp

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
    MsgEvt (GetBlockBodies [])   -> do
      lift stampActionTimestamp
      yieldR (BlockBodies []) -- todo parity bans peers when they do this. should we?
    MsgEvt (GetBlockBodies shas') -> do
      lift stampActionTimestamp
      mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
      let shas = take mrh shas'
      lift (getUntilMissing shas DL.empty DL.empty) >>= \(bodies, pshas) -> do
          yieldR . BlockBodies $ map (second (map morphBlockHeader) . toBody) bodies
          ptxs <- fmap M.elems . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) pshas
          unless (null ptxs) . yieldR . Transactions $ morphTx  . snd . unPrivate <$> ptxs
        where getUntilMissing :: ( (Keccak256 `Selectable` ChainTxsInBlock) m
                                 , (Word256 `Selectable` ChainMembers) m
                                 , (Keccak256 `Alters` OutputBlock) m
                                 , (Address `Selectable` X509CertInfoState) m
                                 , ((OrgName, OrgUnit) `Selectable` OrgNameChains) m
                                 )
                              => [Keccak256] -> DL.DList OutputBlock -> DL.DList Keccak256 -> m ([OutputBlock],[Keccak256])
              getUntilMissing []     bodies pshas = return (DL.toList bodies, DL.toList pshas)
              getUntilMissing (h:hs) bodies pshas = lookup (Proxy @OutputBlock) h >>= \case
                  Nothing   -> return (DL.toList bodies, DL.toList pshas)
                  Just body -> do
                    ChainTxsInBlock cIdTxsMap <- selectWithDefault (Proxy @ChainTxsInBlock) h
                    mems <- selectMany (Proxy @ChainMembers) $ M.keys cIdTxsMap
                    peerX509 <- getPeerX509 peer
                    orgChains <- selectWithDefault (Proxy @OrgNameChains) $ certOrgTuple peerX509
                    let whenMissing f = WhenMissing (pure . M.map f) (\_ x -> (pure . Just $ f x))
                        trMems = merge (whenMissing This)
                                       (whenMissing That)
                                       (WhenMatched $ \_ x y -> pure . Just $ These x y)
                                       cIdTxsMap
                                       mems
                        filtered = flip M.filter trMems $
                          mergeTheseWith (const False) (\m -> checkPeerIsMember'' flags_privateChainAuthorizationMode peer m peerX509 orgChains) (||)
                        pshas' = M.foldr (DL.append . DL.fromList . these id (const []) const) DL.empty filtered
                    getUntilMissing hs (bodies `DL.snoc` body) (pshas `DL.append` pshas')

              toBody :: OutputBlock -> ([Transaction], [BlockData])
              toBody = ((map otBaseTx . obReceiptTransactions) &&& obBlockUncles)

    -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
    -- todo:
    MsgEvt (BlockBodies []) -> return () --clearActionTimestamp
    MsgEvt (BlockBodies bodies) -> do
        lift stampActionTimestamp
        headers <- lift getBlockHeaders
        let verified = and $ zipWith (\h b -> blockDataTransactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
        unless verified $ error "headers don't match bodies"
        $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
        recordMaxBlockNumber "p2p_block_bodies" . maximum $ map blockDataNumber headers
        let blocks' = zipWith createBlockFromHeaderAndBody (morphBlockHeader <$> headers) bodies
        newCount <- lift $ setTitleAndProduceBlocks blocks'
        yieldL . ToUnseq $ IEBlock . blockToIngestBlock (Origin.PeerString $ peerString peer) <$> blocks'
        rHeaders <- lift getRemainingBHeaders
        let (neededHeaders, remainingHeaders) = splitNeededHeaders rHeaders
        lift $ putBlockHeaders neededHeaders
        lift $ putRemainingBHeaders remainingHeaders
        if null neededHeaders
            then when (newCount > 0) $ do
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
        then $logInfoS "handleEvents/Blockstanbul" . T.pack $ concat
               [ "Already seen inbound wire message "
               , format msgHash
               , ". Not forwarding to Sequencer."
               ]
        else do
          $logInfoS "handleEvents/Blockstanbul" . T.pack $ concat
            [ "First time seeing inbound wire message "
            , format msgHash
            , ". Forwarding to Sequencer."
            ]
          lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
          yieldL $ ToUnseq [IEBlockstanbul wm]

    -- private chains
    MsgEvt (GetChainDetails cids') -> handleGetChainDetails peer $ S.fromList cids'

    MsgEvt (ChainDetails chpairs) -> do
      yieldL . ToUnseq $ IEGenesis . IngestGenesis (Origin.PeerString $ peerString peer) <$> chpairs

    -- TODO: Optimize/do security checking (a peer can spam you with random hashes and keep you busy forever)
    MsgEvt (GetTransactions trHashes) -> do
      lift stampActionTimestamp
      $logInfoS "handleEvents/GetTransactions" $ T.pack $ "requesting info for txHashes: "
        ++ (intercalate "\n" (format <$> trHashes))
      ptrs <- fmap (map unPrivate . M.elems) . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) trHashes
      mems <- lift . selectMany (Proxy @ChainMembers) $ map fst ptrs
      peerX509 <- lift $ getPeerX509 peer
      orgChains <- lift $ selectWithDefault (Proxy @OrgNameChains) $ certOrgTuple peerX509
      let peerCheck cId = checkPeerIsMember''
                            flags_privateChainAuthorizationMode
                            peer
                            (fromMaybe (ChainMembers M.empty) (M.lookup cId mems))
                            peerX509
                            orgChains

      yieldR . Transactions . map (morphTx . snd) $ filter (peerCheck . fst) ptrs

    MsgEvt (Disconnect _) -> do
            $logInfoS "handleEvents/Disconnect" $ T.pack $ "Disconnect event received in Event handler"
            throwIO PeerDisconnected

    NewSeqEvent oe -> case oe of
      P2pBlock b  -> do
        when (shouldSend peer $ obOrigin b) $ do
          WorldBestBlock (BestBlock _ _ worldTDiff) <- lift $ Mod.get (Proxy @WorldBestBlock)
          $logInfoS "handleEvents/P2pBlock" . T.pack $ "World TDiff: " ++ show worldTDiff
          when (obTotalDifficulty b >= worldTDiff) $ do
            $logInfoS "handleEvents/P2pBlock" . T.pack $ "yielding new block: " ++ show (blockDataNumber . blockBlockData . outputBlockToBlock $ b)
            yieldR $ NewBlock (outputBlockToBlock b) (obTotalDifficulty b)
      P2pTx tx -> do
        let mCid = txChainId tx
        match <- case mCid of
          Nothing -> return True
          Just cId -> do
            mems     <- lift $ selectWithDefault (Proxy @ChainMembers) cId
            peerX509 <- lift $ getPeerX509 peer
            ochains  <- lift $ selectWithDefault (Proxy @OrgNameChains) $ certOrgTuple peerX509 -- swole from all this lifting
            return $ checkPeerIsMember'' flags_privateChainAuthorizationMode peer mems peerX509 ochains

        whenM (shouldSendGossip peer $ otOrigin tx) $ do
          if not match
            then $logInfoS "handleEvents/P2pTx" $ T.pack $
                    printf "peer %s is not authorized for chainID %s" (maybe "<nokey>" showEnode $ pPeerEnode peer) (formatChainId mCid)
            else do
              $logInfoS "handleEvents/P2pTx" $ T.pack $ "sending Transaction " ++ format (otHash tx) ++ " for chainID " ++ formatChainId mCid
              $logDebugS "handleEvents/P2pTx" . T.pack $ "the transaction was: " ++ format tx
              yieldR $ Transactions [otBaseTx tx]
      P2pGenesis (OutputGenesis og (cId, cInfo@(ChainInfo uci _))) -> do
        when (shouldSend peer og) $ do
          $logInfoS "handleEvents/P2pGenesis" . T.pack $ "received new chain: " ++ formatChainId (Just cId) ++ " with " ++ show uci
          peerCheck <- lift $ checkPeerIsMember peer . ChainMembers $ members uci
          if peerCheck
            then do
              $logInfoS "handleEvents/P2pGenesis" $ T.pack $ "sending ChainDetails for chainID " ++ (formatChainId $ Just cId)
              yieldR $ ChainDetails [(cId, cInfo)]
            else do
              $logInfoS "handleEvents/P2pGenesis" $ T.pack $
                printf "peer %s is not authorized for received chainID %s" (maybe "<nokey>" showEnode $ pPeerEnode peer) (formatChainId $ Just cId)
              $logDebugLS "handleEvents/P2pGenesis/members" $ members uci
      P2pGetChain chainIds -> yieldR $ GetChainDetails chainIds
      P2pGetTx shas -> yieldR $ GetTransactions shas
      P2pNewChainMember cId addr enode -> do
        let formatted = CL.yellow $ format cId
            addrStr = formatAddressWithoutColor addr
            enodeStr = showEnode enode
        $logInfoS "handleEvents/P2pNewChainMember" $ T.pack $ "New member added to chain " ++ formatted ++ ": " ++ addrStr ++ " with enode " ++ enodeStr
        (ChainMembers mems') <- lift $ selectWithDefault (Proxy @ChainMembers) cId
        let mems = ChainMembers $ mems' <> M.singleton addr enode
        peerCheck <- lift $ checkPeerIsMember peer mems
        when peerCheck $ do
          $logInfoS "handleEvents/P2pNewChainMember" $ T.pack $ "Emitting chain details for chain " ++ formatted
          mcInfo <- fmap (fmap ((,) cId)) . lift $ select (Proxy @ChainInfo) cId
          for_ mcInfo $ yieldR . ChainDetails . (:[])
      P2pNewOrgName cId org -> do
        let formatted = CL.yellow $ format cId
            orgFormat = CL.blue $ format org -- TODO: need to decode from b16
        peerCheck <- lift $ checkPeerIsMember peer (ChainMembers M.empty)
        when peerCheck $ do
          $logInfoS "handleEvents/P2pNewOrgName" $ T.pack $ "New organization associated with chain " ++ formatted ++ " for org " ++ orgFormat
          -- TODO: check if this breaks on a main chain call
          -- this should never be Nothing since this should only be called on a private chain
          cInfo <- lift $ select (Proxy @ChainInfo) cId
          when (isJust cInfo) $ do 
            $logInfoS "handleEvents/P2pNewOrgName" $ T.pack $ "Sending chain info: " ++ show cInfo
            yieldR $ ChainDetails [(cId, fromJust cInfo)]

      P2pBlockstanbul msg -> do
        let outbound = Blockstanbul msg
        $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $ "Outgoing mesage: " ++ show outbound
        let msgHash = rlpHash msg
        lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
        msgExists <- lift $ exists (Proxy @(Proxy (Outbound WireMessage))) (pPeerIp peer, msgHash)
        if msgExists
          then $logInfoS "handleEvents/P2pBlockstanbul" $ T.concat
                 [ "Already seen outbound wire message "
                 , T.pack (format msgHash)
                 , ". Not forwarding to peer "
                 , pPeerIp peer
                 ]
          else do
            $logInfoS "handleEvents/P2pBlockstanbul" $ T.concat
              [ "First time seeing outbound wire message "
              , T.pack (format msgHash)
              , ". Forwarding to peer "
              , pPeerIp peer
              ]
            lift $ insert (Proxy @(Proxy (Outbound WireMessage))) (pPeerIp peer, msgHash) Proxy
            yieldR outbound
      P2pAskForBlocks start _ _ -> do
        $logDebugS "handleEvents/P2pAskForBlocks" . T.pack $ "syncFetch: " ++ show start
        syncFetch Forward start
      P2pPushBlocks start end p -> do
        ss <- lift $ shouldSendToPeer p
        when ss $ do
          mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
          let count = min mrh . fromIntegral $ end - start + 1
          chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start..]
          when (null chain) $
            $logErrorS "handleEvents/P2pPushBlocks" . T.pack $ printf
              "Blockstanbul believes we have blocks for [%d..%d], they are not found in redis" start end
          let outbound = BlockHeaders $ morphBlockHeader . unCanonical . snd <$> chain
          $logDebugS "handleEvents/P2pPushBlocks" . T.pack $ "Outgoing message: " ++ show outbound
          yieldR outbound

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
                    error "Peer did not respond"
            Nothing -> do
              $logInfoS "TimerEvt" $ T.pack "Timestamp is not set"
              return ()
        yieldL TXQueueTimeout

    AbortEvt reason -> do
      $logInfoS "handleEvents/AbortEvt" . T.pack $ "Received AbortEvt: " ++ reason
      yieldR $ Disconnect AlreadyConnected
    event -> liftIO . error $ "unrecognized event: " ++ show event

handleGetChainDetails :: ( MonadIO m
                         , MonadResource m
                         , MonadLogger m
                         , (IPAddress `Selectable` IPChains) m
                         , (OrgId `Selectable` OrgIdChains) m
                         , ((OrgName, OrgUnit) `Selectable` OrgNameChains) m
                         , (Word256 `Selectable` ChainMembers) m
                         , (Word256 `Selectable` ChainInfo) m
                         , (Address `Selectable` X509CertInfoState) m
                         , Modifiable ActionTimestamp m
                         )
                      => PPeer
                      -> S.Set Word256
                      -> ConduitM Event (Either P2PCNC Message) m ()
handleGetChainDetails peer cids' = do
  peerX509 <- lift $ getPeerX509 peer
  orgNameChains <- case peerX509 of
    Nothing -> return $ OrgNameChains S.empty
    cIs -> lift $ selectWithDefault (Proxy @OrgNameChains) (certOrgTuple cIs)
  cids <- S.toList <$> if S.null cids'
            then lift $ do
              ipChains <- selectWithDefault (Proxy @IPChains) (peerIPAddress peer)
              orgIdChains <- fmap (fromMaybe def)
                           . traverse (selectWithDefault (Proxy @OrgIdChains) . OrgId . pointToBytes)
                           $ pPeerPubkey peer
              return $ S.union (unIPChains ipChains) $ S.union (unOrgIdChains orgIdChains) (unOrgNameChains orgNameChains)
            else return cids'
  lift stampActionTimestamp
  $logInfoS "handleGetChainDetails" $ T.pack $ "details requested for chainIDs " ++ intercalate "\n" (formatChainId . Just <$> cids <> S.toList (unOrgNameChains orgNameChains))

  mems <- lift $ selectMany (Proxy @ChainMembers) cids
  let filteredPairs = M.keys $ M.filter (\mem -> checkPeerIsMember'' flags_privateChainAuthorizationMode peer mem peerX509 orgNameChains) mems
  unless (null filteredPairs) $ do
    cInfos <- fmap M.toList . lift $ selectMany (Proxy @ChainInfo) cids 
    -- chains that use X509 may not have ChainMembers with enode addresses,
    -- so they will not have a Map in mems and their cInfos need to be queried separately
    cInfos' <-  fmap M.toList . lift $ selectMany (Proxy @ChainInfo) $ S.toList (unOrgNameChains orgNameChains) 
    for_ (cInfos ++ cInfos') $ yieldR . ChainDetails . (:[])
    lift stampActionTimestamp
    $logInfoS "handleGetChainDetails" $ T.pack $ "the following ChainIds were returned " ++
      (intercalate "\n" $ formatChainId . Just . fst <$> cInfos)

numberFromBestBlock :: BestBlock -> Integer
numberFromBestBlock (BestBlock _ n _) = n

-- todo: we should take blockNumber as argument here instead of just looking for
-- bestBlock to prevent us from getting stuck
syncFetch :: ( MonadIO m
             , Modifiable ActionTimestamp m
             , Accessible [BlockData] m
             , Accessible MaxReturnedHeaders m
             )
          => Direction -> Integer -> ConduitM Event (Either P2PCNC Message) m ()
syncFetch d num = do
    blockHeaders' <- lift getBlockHeaders -- get blockHeaders from Context
    when (null blockHeaders') $ do
        mrh <- lift $ unMaxReturnedHeaders <$> access (Proxy @MaxReturnedHeaders)
        yieldR $ GetBlockHeaders (BlockNumber num) mrh 0 d
        lift stampActionTimestamp

shouldSend :: PPeer -> Origin.TXOrigin -> Bool
shouldSend peer txo = case txo of
    Origin.PeerString ps -> ps /= peerString peer
    Origin.API           -> True
    Origin.BlockHash _   -> False
    Origin.Direct        -> True
    Origin.Quarry        -> True -- this should never reach this far anyway
    Origin.Morphism      -> -- probably means it was converted, see if this is a problem
        trace "NewTx of type Morphism came in. Should this even happen?" True
    Origin.Blockstanbul -> False

shouldSendGossip :: MonadIO m => PPeer -> Origin.TXOrigin -> m Bool
shouldSendGossip peer txo = recordGossipFinal
                          . (shouldSend peer txo &&)
                          . (flags_txGossipFanout == -1 ||) =<<
  case txo of
    Origin.PeerString{} -> do
      rangeEnd <- getNumPeersMem
      rng <- liftIO $ randomRIO (1, rangeEnd)
      recordGossipRNG $! rangeEnd <= flags_txGossipFanout || rng <= flags_txGossipFanout
    _ -> return True


-- The checkPeerIsMember functions are split up this way to maintain backwards-compatability
-- with existing uses of the function where a pure function is needed for some of the checks.
-- However, since X.509s can only be accessed through impure methods, we have... this
checkPeerIsMember :: (MonadLogger m, Selectable Address X509CertInfoState m, Selectable (OrgName, OrgUnit) OrgNameChains m)
  => PPeer
  -> ChainMembers
  -> m Bool
checkPeerIsMember = checkPeerIsMember' flags_privateChainAuthorizationMode

checkPeerIsMember' :: (MonadLogger m, Selectable Address X509CertInfoState m, Selectable (OrgName, OrgUnit) OrgNameChains m)
  => AuthorizationMode
  -> PPeer
  -> ChainMembers
  -> m Bool
checkPeerIsMember' mode peer mems = do
  peerCert <- getPeerX509 peer
  orgChains <- case peerCert of
    Nothing  -> return $ OrgNameChains S.empty
    Just cIs -> selectWithDefault (Proxy @OrgNameChains) $ (OrgName . BS8.pack . orgName &&& OrgUnit . fmap BS8.pack . orgUnit) cIs

  return $ checkPeerIsMember'' mode peer mems peerCert orgChains

checkPeerIsMember'' :: AuthorizationMode
  -> PPeer
  -> ChainMembers
  -> Maybe X509CertInfoState
  -> OrgNameChains
  -> Bool
checkPeerIsMember'' mode peer mems pcert ochains =
  let elems = M.elems $ unChainMembers mems
      orgChains = S.toList $ unOrgNameChains ochains
      ips = map ipAddress elems
      keys = map (Just . pubKey) elems
      ipkeys = map (ipAddress &&& (Just . pubKey)) elems
      thisIP = peerIPAddress peer
      thisKey = OrgId . pointToBytes <$> pPeerPubkey peer
      validCert = maybe False isValid pcert && not (null orgChains)
   in case mode of
        IPOnly -> thisIP `elem` ips
        PubkeyOnly -> thisKey `elem` keys
        X509Only -> validCert
        StrongAuth -> (thisIP, thisKey) `elem` ipkeys && validCert
        FlexibleAuth -> or [thisIP `elem` ips, thisKey `elem` keys, validCert]

peerIPAddress :: PPeer -> IPAddress
peerIPAddress = readIP . T.unpack . pPeerIp

-- extract the organization name from the cert
certOrgTuple :: Maybe X509CertInfoState -> (OrgName, OrgUnit)
certOrgTuple = maybe
  (OrgName BS8.empty, OrgUnit Nothing)
  (OrgName . BS8.pack . orgName &&& OrgUnit . fmap BS8.pack . orgUnit)

{- to reduce redundant computations on dividing block chunks under txsLimit
splitNeededHeaders :: [BlockHeader] -> [[BlockHeader]]
splitNeededHeaders x =
  let txsLens = extraData2TxsLen <$> extraData <$> neededHeaders
      txsLensInLimit =  scanl (\x y -> if ((x+y)>flags_maxHeadersTxsLens) then y else x+y) 0 txsLens
      indexToSplit :: Int -> [Int] -> [Int] -> [Int] -> [Int]
      indexToSplit index li (x:xs) (y:ys) =  indexToSplit (index++) li' xs ys
        where li = case (x==y) of
          True -> li:index
          False -> li
      indexToSplit _ li [] [] = li
  in splitAt -}

splitNeededHeaders :: [BlockData] -> ([BlockData], [BlockData])
splitNeededHeaders neededHeaders =
  let txsLens = extraData2TxsLen <$> blockDataExtraData <$> neededHeaders
      txsLensInSums =  scanl (+) (0) $ fromMaybe flags_averageTxsPerBlock <$> txsLens
      txsLensInLimit = takeWhile (< flags_maxHeadersTxsLens) $ tail txsLensInSums
  in splitAt (length txsLensInLimit) neededHeaders
