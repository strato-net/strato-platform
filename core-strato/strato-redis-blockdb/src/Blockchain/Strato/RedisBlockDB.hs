{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Strato.RedisBlockDB
    ( RedisConnection(..), inNamespace, findNamespace
    , getSHAsByNumber
    , getChainInfo, putChainInfo
    , getChainMembers, putChainMembers
    , addChainMember, removeChainMember
    , getChainTxsInBlock, putChainTxsInBlock, addChainTxsInBlock
    , getIPChains, addIPChain, removeIPChain
    , getOrgIdChains, addOrgIdChain, removeOrgIdChain
    , getHeader, getHeaders, getHeadersByNumber, getHeadersByNumbers
    , getBlock,  getBlocks,  getBlocksByNumber,  getBlocksByNumbers
    , getTransactions, getPrivateTransactions, addPrivateTransactions, getUncles
    , getParent, getParents
    , getParentChain, getHeaderChain, getBlockChain
    , getCanonical, getCanonicalHeader, getCanonicalChain, getCanonicalHeaderChain
    , getChildren
    , getGenesisHash
    , putHeader, putHeaders, insertHeader, insertHeaders, deleteHeader, deleteHeaders
    , putBlock, putBlocks, insertBlock, insertBlocks, deleteBlock, deleteBlocks
    , getBestBlockInfo, putBestBlockInfo, forceBestBlockInfo
    , withRedisBlockDB
    , commonAncestorHelper
    , getWorldBestBlockInfo, updateWorldBestBlockInfo
    , acquireRedlock, releaseRedlock, defaultRedlockTTL
    ) where

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.ExtWord                    (Word256)
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.RedisBlockDB.Models as Models
import           Blockchain.Util                       (partitionWith)

import           Control.Arrow                         ((&&&), (***), second)
import           Control.Concurrent                    (threadDelay)
import           Control.Monad.Change.Modify           hiding (get)
import           Control.Monad
import           Control.Monad.Trans
import qualified Data.ByteString.Char8                 as S8
import           Data.Foldable                         (foldl')
import           Data.Functor                          ((<&>))
import           Data.Functor.Compose
import qualified Data.Map.Strict                       as M
import           Data.Maybe                            (catMaybes, fromJust, fromMaybe, isJust, isNothing)
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Database.Redis
import           System.Random                         (randomIO)

newtype RedisConnection = RedisConnection { unRedisConnection :: Connection }

-- todo: move this somewhere?
zipMapM :: (Traversable t, Monad m)
        => (a -> m b)
        -> t a
        -> m (t (a, b))
zipMapM f = mapM (\x -> (,) x <$> f x)

liftLog :: LoggingT m a -> m a
liftLog = runLoggingT

withRedisBlockDB :: (MonadIO m, Accessible RedisConnection m)
                 => Redis a
                 -> m a
withRedisBlockDB m = do
    db <- unRedisConnection <$> access (Proxy @RedisConnection)
    liftIO $ runRedis db m

inNamespace :: RedisDBKeyable k
            => BlockDBNamespace
            -> k
            -> S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
    where ns' = case ns of
            Headers             -> "h:"
            Transactions        -> "t:"
            Numbers             -> "n:"
            Uncles              -> "u:"
            Parent              -> "p:"
            Children            -> "c:"
            Canonical           -> "q:"
            PrivateChainInfo    -> "x:"
            PrivateChainMembers -> "m:"
            PrivateTransactions -> "pt:"
            PrivateTxsInBlocks  -> "pb:"
            PrivateIPChains     -> "pic:"
            PrivateOrgIdChains  -> "poc:"

findNamespace :: S8.ByteString -> BlockDBNamespace
findNamespace key = case S8.takeWhile (/= ':') key of
  "h" -> Headers
  "t" -> Transactions
  "n" -> Numbers
  "u" -> Uncles
  "p" -> Parent
  "c" -> Children
  "q" -> Canonical
  "x" -> PrivateChainInfo
  "m" -> PrivateChainMembers
  "pt" -> PrivateTransactions
  "pb" -> PrivateTxsInBlocks
  "pic" -> PrivateIPChains
  "poc" -> PrivateOrgIdChains
  wut -> error $ "unknown namespace: " ++ show wut

getChainInfo :: Word256
             -> Redis (Maybe ChainInfo)
getChainInfo cId = getInNamespace PrivateChainInfo cId >>= \case
    Left _             -> return Nothing
    Right Nothing      -> return Nothing
    Right (Just rcInfo) -> let (RedisChainInfo cInfo) = fromValue rcInfo in
        return $ Just cInfo

putChainInfo :: Word256
          -> ChainInfo
          -> Redis (Either Reply Status)
putChainInfo cId cInfo = do
    let rChain    = RedisChainInfo cInfo

    res <- multiExec $ setnx (inNamespace PrivateChainInfo cId) (toValue rChain)
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "putChainInfo - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "putChainInfo - Error" ++ e)

getChainMembers :: Word256
                -> Redis (M.Map Address Enode)
getChainMembers cId = getInNamespace PrivateChainMembers cId >>= \case
    Left _             -> return M.empty
    Right Nothing      -> return M.empty
    Right (Just rmems) -> let RedisChainMembers mems = fromValue rmems
                           in return mems

putChainMembers :: Word256
          -> M.Map Address Enode
          -> Redis (Either Reply Status)
putChainMembers cId mems = do
    let rmems    = RedisChainMembers mems

    res <- multiExec $ set (inNamespace PrivateChainMembers cId) (toValue rmems)
    case res of
        TxSuccess _ -> fmap (foldl' (>>) (Right Ok)) . forM (M.elems mems) $ \e -> getCompose $
          Compose (addIPChain (ipAddress e) cId) *>
          Compose (addOrgIdChain (unOrgId $ pubKey e) cId)
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "putChainMembers - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "putChainMembers - Error" ++ e)

addChainMember :: Word256
               -> Address
               -> Enode
               -> Redis (Either Reply Status)
addChainMember cId address enode = do
    mems <- getChainMembers cId
    let mems' = RedisChainMembers $ M.insert address enode mems
    res <- multiExec $ set (inNamespace PrivateChainMembers cId) (toValue mems')
    case res of
        TxSuccess _ -> getCompose $
          Compose (addIPChain (ipAddress enode) cId) *>
          Compose (addOrgIdChain (unOrgId $ pubKey enode) cId)
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addChainMember - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addChainMember - Error" ++ e)

removeChainMember :: Word256
                  -> Address
                  -> Redis (Either Reply Status)
removeChainMember cId address = do
    mems <- getChainMembers cId
    let mEnode = M.lookup address mems
        mems' = RedisChainMembers $ M.delete address mems
    res <- multiExec $ set (inNamespace PrivateChainMembers cId) (toValue mems')
    case res of
        TxSuccess _ -> case mEnode of
          Nothing -> pure $ Right Ok -- TODO: Maybe this should return a Left?
          Just enode -> getCompose $
            Compose (removeIPChain (ipAddress enode) cId) *>
            Compose (removeOrgIdChain (unOrgId $ pubKey enode) cId)
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "removeChainMember - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "removeChainMember - Error" ++ e)

getChainTxsInBlock :: SHA
                   -> Redis (M.Map Word256 [SHA])
getChainTxsInBlock bHash = getInNamespace PrivateTxsInBlocks bHash >>= \case
    Left _             -> return M.empty
    Right Nothing      -> return M.empty
    Right (Just rmems) -> let RedisChainTxsInBlocks mems = fromValue rmems
                           in return mems

putChainTxsInBlock :: SHA
                   -> M.Map Word256 [SHA]
                   -> Redis (Either Reply Status)
putChainTxsInBlock bHash chainIdTxHashMap = do
    let rmems    = RedisChainTxsInBlocks chainIdTxHashMap

    res <- multiExec $ set (inNamespace PrivateTxsInBlocks bHash) (toValue rmems)
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "putChainTxsInBlock - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "putChainTxsInBlock - Error" ++ e)

addChainTxsInBlock :: SHA
                   -> Word256
                   -> [SHA]
                   -> Redis (Either Reply Status)
addChainTxsInBlock bHash cId shas = do
    mems <- getChainTxsInBlock bHash
    let mems' = RedisChainTxsInBlocks $ M.insertWith (++) cId shas mems
    res <- multiExec $ set (inNamespace PrivateTxsInBlocks bHash) (toValue mems')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addChainTxsInBlock - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addChainTxsInBlock - Error" ++ e)

getIPChains :: IPAddress
            -> Redis (S.Set Word256)
getIPChains ip = getInNamespace PrivateIPChains ip <&> \case
    Right (Just rchains) -> let RedisIPChains chains = fromValue rchains
                             in chains
    _                    -> S.empty

addIPChain :: IPAddress
           -> Word256
           -> Redis (Either Reply Status)
addIPChain ip cId = do
    chains <- getIPChains ip
    let chains' = RedisIPChains $ S.insert cId chains
    res <- multiExec $ set (inNamespace PrivateIPChains ip) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addIPChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addIPChain - Error" ++ e)

removeIPChain :: IPAddress
              -> Word256
              -> Redis (Either Reply Status)
removeIPChain ip cId = do
    chains <- getIPChains ip
    let chains' = RedisIPChains $ S.delete cId chains
    res <- multiExec $ set (inNamespace PrivateIPChains ip) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "removeIPChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "removeIPChain - Error" ++ e)

getOrgIdChains :: S8.ByteString
               -> Redis (S.Set Word256)
getOrgIdChains ip = getInNamespace PrivateOrgIdChains ip <&> \case
    Right (Just rchains) -> let RedisOrgIdChains chains = fromValue rchains
                             in chains
    _                    -> S.empty

addOrgIdChain :: S8.ByteString
              -> Word256
              -> Redis (Either Reply Status)
addOrgIdChain ip cId = do
    chains <- getOrgIdChains ip
    let chains' = RedisOrgIdChains $ S.insert cId chains
    res <- multiExec $ set (inNamespace PrivateOrgIdChains ip) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addOrgIdChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addOrgIdChain - Error" ++ e)

removeOrgIdChain :: S8.ByteString
                 -> Word256
                 -> Redis (Either Reply Status)
removeOrgIdChain ip cId = do
    chains <- getOrgIdChains ip
    let chains' = RedisOrgIdChains $ S.delete cId chains
    res <- multiExec $ set (inNamespace PrivateOrgIdChains ip) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "removeOrgIdChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "removeOrgIdChain - Error" ++ e)

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

getGenesisHash :: Redis (Maybe SHA)
getGenesisHash = getCanonical 0

getInNamespace :: (RedisDBKeyable key)
               => BlockDBNamespace
               -> key
               -> Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key

getMembersInNamespace :: (RedisDBKeyable key)
                      => BlockDBNamespace
                      -> key
                      -> Redis (Either Reply [S8.ByteString])
getMembersInNamespace ns = smembers . inNamespace ns

getSHAsByNumber :: Integer
                -> Redis (Maybe [SHA])
getSHAsByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _   -> return Nothing
    Right hs -> let hashes = fromValue <$> hs in
        return (Just hashes)

getHeader :: SHA
          -> Redis (Maybe BlockData)
getHeader sha = getInNamespace Headers sha >>= \case
    Left _             -> return Nothing
    Right Nothing      -> return Nothing
    Right (Just rhead) -> let (RedisHeader h) = fromValue rhead in
        return . Just $ morphBlockHeader h

getHeaders :: [SHA]
           -> Redis [(SHA, Maybe BlockData)]
getHeaders = zipMapM getHeader

getHeadersByNumber :: Integer
                   -> Redis [(SHA, Maybe BlockData)]
getHeadersByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getHeaders (fromValue <$> hashes)

getHeadersByNumbers :: [Integer]
                    -> Redis [(Integer, [(SHA, Maybe BlockData)])]
getHeadersByNumbers = zipMapM getHeadersByNumber

getTransactions :: SHA
                -> Redis (Maybe [OutputTx])
getTransactions sha = getInNamespace Transactions sha >>= \case
    Left _            -> return Nothing
    Right Nothing     -> return Nothing
    Right (Just rtxs) -> let (RedisTxs txs) = fromValue rtxs in
        return . Just $ morphTx <$> txs

getPrivateTransactions :: SHA
                       -> Redis (Maybe (Word256, OutputTx))
getPrivateTransactions sha = getInNamespace PrivateTransactions sha >>= \case
    Left _            -> return Nothing
    Right Nothing     -> return Nothing
    Right (Just rtx) -> let (anchor, RedisTx tx) = fromValue rtx in
        return . Just $ (anchor, morphTx tx)

addPrivateTransactions :: [(SHA, (Word256, OutputTx))]
                       -> Redis (Either Reply Status)
addPrivateTransactions ptxs = do
  res <- multiExec
       . mset
       $ map (inNamespace PrivateTransactions *** toValue) ptxs
  case res of
      TxSuccess _ -> pure $ Right Ok
      TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Aborted")
      TxError e   -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Error" ++ e)

getUncles :: SHA
          -> Redis (Maybe [BlockData])
getUncles sha = getInNamespace Uncles sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rus) -> let (RedisUncles uncles) = fromValue rus in
        return . Just $ morphBlockHeader <$> uncles

getParent :: SHA
          -> Redis (Maybe SHA)
getParent sha = getInNamespace Parent sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rps) -> return . Just $ fromValue rps

getParents :: (Traversable f)
           => f SHA
           -> Redis (f (SHA, Maybe SHA))
getParents = zipMapM getParent

getChain :: (a -> Redis (Maybe a))
         -> a
         -> Int
         -> Redis [a]
getChain getNext start limit = (start:) <$> helper start limit
    where helper h l | l <= 0    = return []
                     | otherwise = getNext h >>= maybe (return []) chainDown
          chainDown next = (next:) <$> helper next (limit - 1)

getParentChain :: SHA
               -> Int
               -> Redis [SHA]
getParentChain = getChain getParent

getZippedParentChain :: (SHA -> Redis (Maybe t))
                     -> SHA
                     -> Int
                     -> Redis [(SHA, t)]
getZippedParentChain mapper start limit = do
    shaChain <- getParentChain start limit
    mapChain <- zipMapM mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getHeaderChain :: SHA
               -> Int
               -> Redis [(SHA, BlockData)]
getHeaderChain = getZippedParentChain getHeader

getBlockChain :: SHA
              -> Int
              -> Redis [(SHA, OutputBlock)]
getBlockChain = getZippedParentChain getBlock

getCanonical :: Integer
             -> Redis (Maybe SHA)
getCanonical n = getInNamespace Canonical n >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just sha) -> return . Just $ fromValue sha

getCanonicalHeader :: Integer
                   -> Redis (Maybe BlockData)
getCanonicalHeader n = getCanonical n >>= \case
    Nothing  -> return Nothing
    Just sha -> getHeader sha

getCanonicalChain :: Integer
                  -> Int
                  -> Redis [SHA]
getCanonicalChain start limit = do
    let chain = forM (take (limit) [start..]) getCanonical
    catMaybes <$> chain

getZippedCanonicalChain :: (SHA -> Redis (Maybe t))
                        -> Integer
                        -> Int
                        -> Redis [(SHA, t)]
getZippedCanonicalChain mapper start limit = do
    shaChain <- getCanonicalChain start limit
    mapChain <- zipMapM mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getCanonicalHeaderChain :: Integer
                        -> Int
                        -> Redis [(SHA, BlockData)]
getCanonicalHeaderChain = getZippedCanonicalChain getHeader

getChildren :: SHA
            -> Redis (Maybe [SHA])
getChildren sha = getMembersInNamespace Children sha >>= \case
    Left _    -> return Nothing
    Right chs -> return . Just $ fromValue <$> chs

getBlock :: SHA
         -> Redis (Maybe OutputBlock)
getBlock sha = do
    mybHeader <- getHeader sha
    if isNothing mybHeader
    then return Nothing
    else do
        mybTxs <- getTransactions sha
        if isNothing mybTxs
        then return Nothing
        else do
            mybUncles <- getUncles sha
            if isNothing mybUncles
            then return Nothing
            else let header = fromJust mybHeader
                     txs    = fromJust mybTxs
                     uncles = fromJust mybUncles
                 in return . Just $ buildBlock header txs uncles

getBlocks :: [SHA]
          -> Redis [(SHA, Maybe OutputBlock)]
getBlocks = zipMapM getBlock

getBlocksByNumber :: Integer
                  -> Redis [(SHA, Maybe OutputBlock)]
getBlocksByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getBlocks (fromValue <$> hashes)

getBlocksByNumbers :: [Integer]
                   -> Redis [(Integer, [(SHA, Maybe OutputBlock)])]
getBlocksByNumbers = zipMapM getBlocksByNumber

putHeader :: BlockData
          -> Redis (Either Reply Status)
putHeader = uncurry insertHeader . (blockHeaderHash &&& id)

putHeaders :: Traversable t
           => t BlockData
           -> Redis (t (Either Reply Status))
putHeaders = mapM putHeader

insertHeader :: SHA
             -> BlockData
             -> Redis (Either Reply Status)
insertHeader sha h = do
    let parent    = blockHeaderParentHash h
        number'    = blockHeaderBlockNumber h
        storeHead = morphBlockHeader h :: RedisHeader
        inNS'     = flip inNamespace sha

    res <- multiExec $ do
        void $ setnx (inNS' Headers) (toValue storeHead)
        void $ setnx (inNS' Parent) (toValue parent)
        void $ sadd (inNamespace Children parent) [toValue sha]
        sadd (inNamespace Numbers number') [toValue sha]
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "insertHeader - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "insertHeader - Error" ++ e)

insertHeaders :: M.Map SHA BlockData
              -> Redis (M.Map SHA (Either Reply Status))
insertHeaders = sequenceA . M.mapWithKey insertHeader

deleteHeader :: SHA
             -> Redis (Either Reply Status)
deleteHeader _ = pure . Left $ SingleLine (S8.pack $ "deleteHeader - Not Implemented")

deleteHeaders :: Traversable t
              => t SHA
              -> Redis (t (Either Reply Status))
deleteHeaders = mapM deleteHeader

putBlock :: OutputBlock
         -> Redis (Either Reply Status)
putBlock b =
  let sha = blockHash b
   in insertBlock sha b

putBlocks :: Traversable t
          => t OutputBlock
          -> Redis (t (Either Reply Status))
putBlocks = mapM putBlock

insertBlock :: SHA
            -> OutputBlock
            -> Redis (Either Reply Status)
insertBlock sha b = do
    let header  = blockHeader b
        number' = blockHeaderBlockNumber header
        parent  = blockHeaderParentHash header
        header' = morphBlockHeader header :: RedisHeader
        txs     = RedisTxs (morphTx <$> blockTransactions b :: [Models.RedisTx])
        ptxs    = filter
                    (isJust . txAnchorChain)
                    (obReceiptTransactions b)
        uncles  = RedisUncles (morphBlockHeader <$> blockUncleHeaders b)
        inNS'   = flip inNamespace sha
    unless (null ptxs) $ do
      void . addPrivateTransactions $
        map (txHash &&& ((fromJust . txAnchorChain) &&& id)) ptxs
      forM_ (partitionWith txAnchorChain ptxs) $ \(cId, ptxs') ->
                         -- ^-- already filtered on (isJust . txChainId)
        addChainTxsInBlock sha (fromJust cId) $ map txHash ptxs'
    res <- multiExec $ do
        void $ setnx (inNS' Headers) (toValue header')
        void $ setnx (inNS' Transactions) (toValue txs)
        void $ setnx (inNS' Uncles) (toValue uncles)
        void $ setnx (inNS' Parent) (toValue parent)
        void $ sadd (inNamespace Children parent) [toKey sha]
        sadd (inNamespace Numbers number') [toKey sha]
        --forM_ uncles -- todo index the uncles' headers/numbers/etc?
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack "Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack e)

insertBlocks :: M.Map SHA OutputBlock
             -> Redis (M.Map SHA (Either Reply Status))
insertBlocks = sequenceA . M.mapWithKey insertBlock

deleteBlock :: SHA
            -> Redis (Either Reply Status)
deleteBlock _ = pure . Left $ SingleLine (S8.pack $ "deleteBlock - Not Implemented")

deleteBlocks :: Traversable t
             => t SHA
             -> Redis (t (Either Reply Status))
deleteBlocks = mapM deleteBlock

putBestBlockInfo :: SHA
                 -> Integer
                 -> Integer
                 -> Redis (Either Reply Status)
putBestBlockInfo newSha newNumber newTDiff = do
    --liftIO . putStrLn . ("New args" ++) $ show (shaToHex newSha, newNumber, newTDiff)
    oldBBI' <- getBestBlockInfo
    case oldBBI' of
        Nothing      -> return (Left $ SingleLine "Got no block from getBetstBlockInfo")
        Just (RedisBestBlock oldSha oldNumber _) -> do
            --liftIO . putStrLn . ("Old args" ++) $ show (shaToHex oldSha, oldNumber, oldTDiff)
            helper' <- commonAncestorHelper oldNumber newNumber oldSha newSha
            case helper' of
                Left err -> error $ "god save the queen! " ++ show err
                Right (updates, deletions) -> do
                    --liftIO . putStrLn $ "Updates: \n" ++ unlines ((\(x, y) -> show (shaToHex x, y)) <$> updates)
                    --liftIO . putStrLn $ "Deletions: \n" ++ show deletions
                  res <- multiExec $ do
                      forM_ updates $ \(sha, num) -> set (inNamespace Canonical $ num) (toValue sha)
                      unless (null deletions) . void . del $ inNamespace Canonical . toKey <$> deletions
                      forceBestBlockInfo newSha newNumber newTDiff
                  case res of
                      TxSuccess _ -> return $ Right Ok
                      TxAborted   -> return . Left $ SingleLine (S8.pack "Aborted")
                      TxError e   -> return . Left $ SingleLine (S8.pack e)

commonAncestorHelper :: Integer -> Integer
                     -> SHA     -> SHA
                     -> Redis (Either Reply ([(SHA, Integer)], [Integer])) -- ([Updates], [Deletions])
commonAncestorHelper oldNum newNum oldSha' newSha' = helper [oldSha'] [newSha'] (S.fromList [oldSha', newSha'])
        where helper (oldSha:[]) (newSha:[]) _ | oldSha == newSha = return $ Right ([], [])
              helper (_:(oldSha'':_)) (_:(newSha'':ns)) _ | oldSha'' == newSha'' = complete oldSha'' (mkParentChain newSha'' ns)
              helper oldShaChain newShaChain seen = do
                let oldSha = head oldShaChain
                    newSha = head newShaChain
                ps@[newParent, oldParent] <- forM [newSha, oldSha] (\x -> fromMaybe x <$> getParent x)
                let seen' = foldl' (flip S.insert) seen (filter (/= (SHA 0)) ps) -- todo double S.insert is probably more optimal
                if newParent `S.member` seen
                then complete newParent (mkParentChain newParent newShaChain)
                else if oldParent `S.member` seen
                      then complete oldParent (mkParentChain oldParent newShaChain)
                      else helper (mkParentChain oldParent oldShaChain) (mkParentChain newParent newShaChain) seen'

              -- earlier, we "cycle" the last block we were able to get if we cant traverse the parent chain any
              -- deeper (i.e., we hit genesis block, and cant get any more parents for that chain)
              -- this prevents the cycling from prepending the same block over and over to the chain head
              -- and messing up the chain lengths
              --
              -- the second case is impossible because `helper`, which calls mkParentChain,
              -- always gets called with a list of at least length 1
              mkParentChain :: SHA -> [SHA] -> [SHA]
              mkParentChain (SHA 0) xs = xs
              mkParentChain y xs@(x:_) = if x == y then xs else y:xs
              mkParentChain _ []       = error "the impossible happened, somehow called (mkParentChain _ [])"

              complete :: SHA -> [SHA] -> Redis (Either Reply ([(SHA, Integer)], [Integer]))
              complete lca newShaChain = getHeader lca >>= \case
                      Nothing -> if lca /= (SHA 0) -- genesis block is sha 0
                                     then return . Left . SingleLine . S8.pack $
                                              "Could not get ancestor header for SHA " ++ shaToHex lca
                                     else complete (head newShaChain) newShaChain
                      Just ancestor -> do
                          --liftIO . putStrLn $ show (shaToHex lca, shaToHex <$> newShaChain)
                          let ancestorNumber = blockHeaderBlockNumber ancestor
                              deletions      = [newNum+1..oldNum]
                              updates        = flip zip [ancestorNumber..] $ dropWhile (/= lca) newShaChain
                          return $ Right (updates, deletions)

              -- safeTail :: [a] -> [a]
              -- safeTail [] = []
              -- safeTail xs = tail xs

--validateLink :: (SHA,RedisHeader) -> (SHA, RedisHeader) -> Bool
--validateLink (psha,RedisHeader parentHeader) (_,RedisHeader childHeader) =
--  (psha == (parentHash childHeader))
--  &&
--  (((number parentHeader) + 1) == (number childHeader))
--
--validateChain :: [(SHA,RedisHeader)] -> Bool
--validateChain [] = True
--validateChain [_] = True
--validateChain (x:xs) = (validateLink x $ head xs) && (validateChain xs)

-- | Used to seed the first bestBlock, e.g. genesis block in strato-setup
forceBestBlockInfo :: RedisCtx m f => SHA -> Integer -> Integer -> m (f Status)
forceBestBlockInfo sha i j = do
        forceBestBlockInfo' bestBlockInfoKey (RedisBestBlock sha i j) --`totalRecall` (,,)

forceBestBlockInfo' :: RedisCtx m f => S8.ByteString -> RedisBestBlock -> m (f Status)
forceBestBlockInfo' key = set key . toValue

getBestBlockInfo :: Redis (Maybe RedisBestBlock)
getBestBlockInfo = getBestBlockInfo' bestBlockInfoKey

getBestBlockInfo' :: S8.ByteString -> Redis (Maybe RedisBestBlock)
getBestBlockInfo' key = get key >>= \case
    Left x  -> do
        liftLog $ $logErrorS "getBestBlockInfo'" . T.pack $ "got Left " ++ show x
        return Nothing
    Right r -> case r of
        Nothing -> return Nothing -- return . Left $ SingleLine "No BestBlock data set in RedisBlockDB"
        Just bs -> return . Just $ RedisBestBlock sha num tdiff
            where
              RedisBestBlock sha num tdiff = fromValue bs

releaseRedlockScript :: S8.ByteString
releaseRedlockScript = S8.pack . unlines $
    [ "if redis.call(\"get\",KEYS[1]) == ARGV[1] then"
    , "    return redis.call(\"del\",KEYS[1])"
    , "else"
    , "    return 0"
    , "end "
    ]

worldBestBlockRedlockKey :: S8.ByteString
worldBestBlockRedlockKey = "<worldbest_redlock>"
{-# INLINE worldBestBlockRedlockKey #-}

defaultRedlockTTL :: Int -- in milliseconds
defaultRedlockTTL = 3000

defaultRedlockBackoff :: Int -- in microseconds
defaultRedlockBackoff = 100 {- ms -} * 1000 {- us/ms -}

redisSetNXPX :: (RedisCtx m f) => S8.ByteString -> S8.ByteString -> Int -> m (f Status)
redisSetNXPX key value lockTTL = sendRequest ["SET", key, value, "NX", "PX", S8.pack (show lockTTL)]

acquireRedlock :: S8.ByteString -> Int -> Redis (Either Reply S8.ByteString)
acquireRedlock key lockTTL = do
    random <- S8.pack . (show :: Integer -> String) <$> liftIO randomIO
    reply <- redisSetNXPX key random lockTTL
    return $ case reply of
        Right Ok -> Right random
        Right (Status "") -> Left $ SingleLine "could not acquire the lock due to NX condition unmet"
        Right (Status s)  -> Left . SingleLine $ "Somehow got a nonempty status, which makes no fucking sense: " `S8.append` s
        Right Pong -> Left $ SingleLine "Somehow got a \"PONG\", which makes no fucking sense."
        Left err -> Left err

releaseRedlock :: S8.ByteString -> S8.ByteString -> Redis (Either Reply Bool)
releaseRedlock key lock = eval releaseRedlockScript [key] [lock]

acquireWorldBestBlockRedlock :: Int -> Redis (Either Reply S8.ByteString)
acquireWorldBestBlockRedlock = acquireRedlock worldBestBlockRedlockKey

releaseWorldBestBlockRedlock :: S8.ByteString -> Redis (Either Reply Bool)
releaseWorldBestBlockRedlock = releaseRedlock worldBestBlockRedlockKey

worldBestBlockKey :: S8.ByteString
worldBestBlockKey = "<worldbest>"
{-# INLINE worldBestBlockKey #-}

getWorldBestBlockInfo :: Redis (Maybe RedisBestBlock)
getWorldBestBlockInfo = getBestBlockInfo' worldBestBlockKey

updateWorldBestBlockInfo :: SHA -> Integer -> Integer -> Redis (Either Reply Bool)
updateWorldBestBlockInfo sha num tdiff = withRetryCount 0
    where withRetryCount :: Int -> Redis (Either Reply Bool)
          withRetryCount theRetryCount = do
              maybeLockID <- acquireWorldBestBlockRedlock defaultRedlockTTL
              case maybeLockID of
                  Left err -> do
                      when (theRetryCount /= 0 && (theRetryCount `mod` 5) == 0) $ do
                          liftLog $ $logWarnS "updateWorldBestBlockInfo" . T.pack $ "Could not acquire redlock after " ++ show theRetryCount ++ " attempts, will retry; " ++ show err
                          liftIO $ threadDelay defaultRedlockBackoff -- todo make backoff a factor instead of a fixed backoff
                      withRetryCount $ theRetryCount + 1
                  Right lockID -> do
                      liftLog $ $logDebugS "updateWorldBestBlockInfo" "Acquired lock"
                      maybeExistingWBBI <- getWorldBestBlockInfo
                      case maybeExistingWBBI of
                          Nothing -> do
                              liftLog $ $logWarnS "updateWorldBestBlockInfo" "No WorldBestBlock in Redis, will force"
                              void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num tdiff)
                              releaseAndFinalize lockID True
                          Just (RedisBestBlock _ _ oldTDiff) -> do
                              liftLog $ $logDebugS "updateWorldBestBlockInfo" $ T.pack ( "oldTDiff = " ++ show oldTDiff ++ "; newTDiff = " ++ show tdiff)
                              let willUpdate = oldTDiff <= tdiff
                              if willUpdate
                                  then do
                                      liftLog $ $logDebugS "updateWorldBestBlockInfo" . T.pack $ "Updating best block: " ++ show num
                                      void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num tdiff)
                                  else
                                      liftLog $ $logDebugS "updateWorldBestBlockInfo" "Not updating"
                              releaseAndFinalize lockID willUpdate
              where releaseAndFinalize lockID didUpdate = do
                        didRelease <- releaseWorldBestBlockRedlock lockID
                        return $ case didRelease of
                            Right True  -> Right didUpdate
                            Right False -> Left $ SingleLine "Couldn't release redlock, it either expired or we had the wrong key"
                            err         -> err
