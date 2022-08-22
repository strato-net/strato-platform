{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Strato.RedisBlockDB
    ( RedisConnection(..), inNamespace, findNamespace, runStratoRedisIO
    , getSHAsByNumber
    , getChainInfo, putChainInfo
    , getChainMembers, putChainMembers
    , addChainMember, removeChainMember
    , registerCertificate
    , revokeCertificate
    , getInitializeCertificateRegistry, initializeCertificateRegistry
    , getChainTxsInBlock, putChainTxsInBlock, addChainTxsInBlock
    , getIPChains, addIPChain, removeIPChain
    , getOrgNameChains, addOrgNameChain, removeOrgNameChain
    , getOrgIdChains, addOrgIdChain, removeOrgIdChain
    , getHeader, getHeaders, getHeadersByNumber, getHeadersByNumbers
    , getBlock,  getBlocks,  getBlocksByNumber,  getBlocksByNumbers
    , getTransactions, getPrivateTransactions, addPrivateTransactions, getUncles
    , getParent, getParents
    , getParentChain, getHeaderChain, getBlockChain
    , getCanonical, getCanonicalHeader, getCanonicalChain, getCanonicalHeaderChain
    , getChildren
    , getGenesisHash
    , getCertificate
    , putHeader, putHeaders, insertHeader, insertHeaders, deleteHeader, deleteHeaders
    , putBlock, putBlocks, insertBlock, insertBlocks, deleteBlock, deleteBlocks
    , getBestBlockInfo, putBestBlockInfo, forceBestBlockInfo
    , withRedisBlockDB
    , commonAncestorHelper
    , getWorldBestBlockInfo, updateWorldBestBlockInfo
    , acquireRedlock, releaseRedlock, defaultRedlockTTL
    , getSyncStatus, putSyncStatus, getCertificate
    ) where

import           BlockApps.X509.Certificate
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.EthConf                    (lookupRedisBlockDBConfig)
import           Blockchain.Partitioner                (partitionWith)
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord  (Word256)
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1     (importPublicKey)
import           Blockchain.Strato.RedisBlockDB.Models as Models

import           Control.Arrow                         ((&&&), (***), second)
import           Control.Concurrent                    (threadDelay)
import           Control.Monad.Change.Modify           hiding (get)
import           Control.Monad
import           Control.Monad.Trans
import qualified Data.ByteString.Char8                 as S8
import           Data.Either                           (fromRight)

import           Data.Foldable                         (foldl', toList)
import           Data.Functor                          ((<&>))
import           Data.Functor.Compose
import qualified Data.Map.Strict                       as M
import           Data.Maybe                            (catMaybes, fromJust, fromMaybe, isJust, isNothing, listToMaybe)
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Database.Redis
import           System.Random                         (randomIO)

import           BlockApps.Logging

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
            Headers              -> "h:"
            Transactions         -> "t:"
            Numbers              -> "n:"
            Uncles               -> "u:"
            Parent               -> "p:"
            Children             -> "c:"
            Canonical            -> "q:"
            PrivateChainInfo     -> "x:"
            PrivateChainMembers  -> "m:"
            PrivateTransactions  -> "pt:"
            PrivateTxsInBlocks   -> "pb:"
            PrivateIPChains      -> "pic:"
            PrivateOrgIdChains   -> "poc:"
            PrivateOrgNameChains -> "pnc:"
            X509Certificates     -> "x509:"
            X509Initialized      -> "x509init:"

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
  "pnc" -> PrivateOrgNameChains
  "x509" -> X509Certificates
  "x509init:" -> X509Initialized
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
          Compose (addOrgIdChain (unOrgId $ pubKey enode) cId) *>
          Compose (addressToOrgName address >>= \org -> addOrgNameChain (fromRight (error "addChainMember - to the left, to the left") org) cId)
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addChainMember - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addChainMember - Error" ++ e)
    where addressToOrgName :: Address -> Redis (Either () (S8.ByteString, Maybe S8.ByteString))  -- OrgName, OrgUnit
          addressToOrgName addr = do
            let getCertificate' = maybe (X509Certificate (CertificateChain [])) certificate <$> getCertificate addr
                extractDN dn    = (S8.pack (subOrg dn), (Just . S8.pack) =<< subUnit dn)  --(S8.pack . subOrg) &&& (maybe Nothing S8.pack $ subUnit)
                getCertSubject' = fromJust . getCertSubject
                getCert'        = signedsToX509 . toList . findNodeCert (fromJust $ importPublicKey (unOrgId $ pubKey enode))
            cert <- x509ToSigneds <$> getCertificate'
            return $ Right $ extractDN $ getCertSubject' $ getCert' cert

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

registerCertificate :: Address -> X509CertInfoState -> Redis (Either Reply Status)
registerCertificate userAddr x509CertInfoState = do
    status <- getInitializeCertificateRegistry
    let maybeParent = getParentUserAddress $ certificate x509CertInfoState
    certInfoState' <- case maybeParent of
        Just parentAddr -> do
            mCertInfoState <- getCertificate parentAddr
            case mCertInfoState of
                Nothing -> pure Nothing
                Just certInfoState -> pure $ Just certInfoState
        Nothing -> pure Nothing

    let parentCertIsValid = fmap isValid certInfoState'
        parentIsValid = fromMaybe False parentCertIsValid

    if not status || (status && parentIsValid)
        then do
            res <- multiExec $ set (inNamespace X509Certificates $ toKey userAddr) (toValue x509CertInfoState)
            _ <- case res of
                TxSuccess _ -> pure $ Right Ok
                TxAborted -> pure . Left $ SingleLine (S8.pack $ "registerCertificate - Aborted")
                TxError e -> pure . Left $ SingleLine (S8.pack $ "registerCertificate - Error" <> e)

            case certInfoState' of
                Nothing -> pure . Left $ SingleLine (S8.pack "registerCertificate - No Parent")
                Just certInfoState -> do
                    let newChildren = userAddr : children certInfoState
                    let newParentInfoState = certInfoState{children  = newChildren}
                    let parentAddr = userAddress certInfoState
                    res' <- multiExec $ set (inNamespace X509Certificates $ toKey parentAddr) (toValue newParentInfoState)
                    case res' of
                        TxSuccess _ -> pure $ Right Ok
                        TxAborted -> pure . Left $ SingleLine (S8.pack "registerCertificate - Aborted adding children")
                        TxError e -> pure . Left $ SingleLine (S8.pack $ "registerCertificate - Error adding children" <> e)
        else pure . Left $ SingleLine (S8.pack "registerCertificate - Parent not valid")


revokeCertificate :: Address -> Redis (Either Reply Status)
revokeCertificate userAddress = do
    mCertInfoState <- getCertificate userAddress
    case mCertInfoState of
        Nothing ->  pure . Left $ SingleLine (S8.pack "registerCertificate - userAddress invalid")
        Just certInfoState -> do
            let newInfoState = certInfoState{isValid  = False}
            res <- multiExec $ set (inNamespace X509Certificates $ toKey userAddress) (toValue newInfoState)
            case res of
                TxSuccess _ -> do
                        res2 <- mapM revokeCertificate (children certInfoState)
                        pure $ fmap (fromMaybe Ok . listToMaybe) (sequenceA res2)
                TxAborted -> pure . Left $ SingleLine (S8.pack "registerCertificate - Aborted revoking cert")
                TxError e -> pure . Left $ SingleLine (S8.pack $ "registerCertificate - Error revoking cert" <> e)

initializeCertificateRegistry :: Redis (Either Reply Status)
initializeCertificateRegistry = do
    status <- getInitializeCertificateRegistry
    if not status
        then do
            res <- multiExec $ set (inNamespace X509Initialized ("initialized" :: S8.ByteString)) (toValue True)
            case res of
                TxSuccess _ -> pure $ Right Ok
                TxAborted -> pure . Left $ SingleLine (S8.pack "initializeCertificateRegistry - Aborted initializing certificate")
                TxError e -> pure . Left $ SingleLine (S8.pack $ "initializeCertificateRegistry - Error initializing certificate" <> e)
        else pure . Left $ SingleLine (S8.pack "initializeCertificateRegistry - Aborted already initialized")

getInitializeCertificateRegistry :: Redis Bool
getInitializeCertificateRegistry = getInNamespace X509Initialized ("initialized" :: S8.ByteString) >>= \case
        Left _          -> return False
        Right Nothing   -> return False
        Right (Just state) -> return (fromValue state)


getCertificate :: Address -> Redis (Maybe X509CertInfoState)
getCertificate userAddress = getInNamespace X509Certificates userAddress >>= \case
        Left _          -> return Nothing
        Right Nothing   -> return Nothing
        Right (Just state) -> let certInfoState = fromValue state
                              in return (Just certInfoState)

getChainTxsInBlock :: Keccak256
                   -> Redis (M.Map Word256 [Keccak256])
getChainTxsInBlock bHash = getInNamespace PrivateTxsInBlocks bHash >>= \case
    Left _             -> return M.empty
    Right Nothing      -> return M.empty
    Right (Just rmems) -> let RedisChainTxsInBlocks mems = fromValue rmems
                           in return mems

putChainTxsInBlock :: Keccak256
                   -> M.Map Word256 [Keccak256]
                   -> Redis (Either Reply Status)
putChainTxsInBlock bHash chainIdTxHashMap = do
    let rmems    = RedisChainTxsInBlocks chainIdTxHashMap

    res <- multiExec $ set (inNamespace PrivateTxsInBlocks bHash) (toValue rmems)
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "putChainTxsInBlock - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "putChainTxsInBlock - Error" ++ e)

addChainTxsInBlock :: Keccak256
                   -> Word256
                   -> [Keccak256]
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

getOrgNameChains :: (S8.ByteString, Maybe S8.ByteString)
                 -> Redis (S.Set Word256)
getOrgNameChains org = getInNamespace PrivateOrgNameChains org <&> \case
    Right (Just rchains) -> let RedisOrgNameChains chains = fromValue rchains
                            in chains
    _                    -> S.empty

addOrgNameChain :: (S8.ByteString, Maybe S8.ByteString)
                -> Word256
                -> Redis (Either Reply Status)
addOrgNameChain org cId = do
    chains <- getOrgNameChains org
    let chains' = RedisOrgNameChains $ S.insert cId chains
    res <- multiExec $ set (inNamespace PrivateOrgNameChains org) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addOrgNameChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "addOrgNameChain - Error" ++ e)

removeOrgNameChain :: (S8.ByteString, Maybe S8.ByteString)
                   -> Word256
                   -> Redis (Either Reply Status)
removeOrgNameChain org cId = do
    chains <- getOrgNameChains org
    let chains' = RedisOrgNameChains $ S.delete cId chains
    res <- multiExec $ set (inNamespace PrivateOrgNameChains org) (toValue chains')
    case res of
        TxSuccess _ -> pure $ Right Ok
        TxAborted   -> pure . Left $ SingleLine (S8.pack $ "removeOrgNameChain - Aborted")
        TxError e   -> pure . Left $ SingleLine (S8.pack $ "removeOrgNameChain - Error" ++ e)

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

getGenesisHash :: Redis (Maybe Keccak256)
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
                -> Redis (Maybe [Keccak256])
getSHAsByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _   -> return Nothing
    Right hs -> let hashes = fromValue <$> hs in
        return (Just hashes)

getHeader :: Keccak256
          -> Redis (Maybe BlockData)
getHeader sha = getInNamespace Headers sha >>= \case
    Left _             -> return Nothing
    Right Nothing      -> return Nothing
    Right (Just rhead) -> let (RedisHeader h) = fromValue rhead in
        return . Just $ morphBlockHeader h

getHeaders :: [Keccak256]
           -> Redis [(Keccak256, Maybe BlockData)]
getHeaders = zipMapM getHeader

getHeadersByNumber :: Integer
                   -> Redis [(Keccak256, Maybe BlockData)]
getHeadersByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getHeaders (fromValue <$> hashes)

getHeadersByNumbers :: [Integer]
                    -> Redis [(Integer, [(Keccak256, Maybe BlockData)])]
getHeadersByNumbers = zipMapM getHeadersByNumber

getTransactions :: Keccak256
                -> Redis (Maybe [OutputTx])
getTransactions sha = getInNamespace Transactions sha >>= \case
    Left _            -> return Nothing
    Right Nothing     -> return Nothing
    Right (Just rtxs) -> let (RedisTxs txs) = fromValue rtxs in
        return . Just $ morphTx <$> txs

getPrivateTransactions :: Keccak256
                       -> Redis (Maybe (Word256, OutputTx))
getPrivateTransactions sha = getInNamespace PrivateTransactions sha >>= \case
    Left _            -> return Nothing
    Right Nothing     -> return Nothing
    Right (Just rtx) -> let (anchor, RedisTx tx) = fromValue rtx in
        return . Just $ (anchor, morphTx tx)

addPrivateTransactions :: [(Keccak256, (Word256, OutputTx))]
                       -> Redis (Either Reply Status)
addPrivateTransactions ptxs = do
  res <- multiExec
       . mset
       $ map (inNamespace PrivateTransactions *** toValue) ptxs
  case res of
      TxSuccess _ -> pure $ Right Ok
      TxAborted   -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Aborted")
      TxError e   -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Error" ++ e)

getUncles :: Keccak256
          -> Redis (Maybe [BlockData])
getUncles sha = getInNamespace Uncles sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rus) -> let (RedisUncles uncles) = fromValue rus in
        return . Just $ morphBlockHeader <$> uncles

getParent :: Keccak256
          -> Redis (Maybe Keccak256)
getParent sha = getInNamespace Parent sha >>= \case
    Left _           -> return Nothing
    Right Nothing    -> return Nothing
    Right (Just rps) -> return . Just $ fromValue rps

getParents :: (Traversable f)
           => f Keccak256
           -> Redis (f (Keccak256, Maybe Keccak256))
getParents = zipMapM getParent

getChain :: (a -> Redis (Maybe a))
         -> a
         -> Int
         -> Redis [a]
getChain getNext start limit = (start:) <$> helper start limit
    where helper h l | l <= 0    = return []
                     | otherwise = getNext h >>= maybe (return []) chainDown
          chainDown next = (next:) <$> helper next (limit - 1)

getParentChain :: Keccak256
               -> Int
               -> Redis [Keccak256]
getParentChain = getChain getParent

getZippedParentChain :: (Keccak256 -> Redis (Maybe t))
                     -> Keccak256
                     -> Int
                     -> Redis [(Keccak256, t)]
getZippedParentChain mapper start limit = do
    shaChain <- getParentChain start limit
    mapChain <- zipMapM mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getHeaderChain :: Keccak256
               -> Int
               -> Redis [(Keccak256, BlockData)]
getHeaderChain = getZippedParentChain getHeader

getBlockChain :: Keccak256
              -> Int
              -> Redis [(Keccak256, OutputBlock)]
getBlockChain = getZippedParentChain getBlock

getCanonical :: Integer
             -> Redis (Maybe Keccak256)
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
                  -> Redis [Keccak256]
getCanonicalChain start limit = do
    let chain = forM (take (limit) [start..]) getCanonical
    catMaybes <$> chain

getZippedCanonicalChain :: (Keccak256 -> Redis (Maybe t))
                        -> Integer
                        -> Int
                        -> Redis [(Keccak256, t)]
getZippedCanonicalChain mapper start limit = do
    shaChain <- getCanonicalChain start limit
    mapChain <- zipMapM mapper shaChain
    return $ second fromJust <$> takeWhile (isJust . snd) mapChain

getCanonicalHeaderChain :: Integer
                        -> Int
                        -> Redis [(Keccak256, BlockData)]
getCanonicalHeaderChain = getZippedCanonicalChain getHeader

getChildren :: Keccak256
            -> Redis (Maybe [Keccak256])
getChildren sha = getMembersInNamespace Children sha >>= \case
    Left _    -> return Nothing
    Right chs -> return . Just $ fromValue <$> chs

getBlock :: Keccak256
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

getBlocks :: [Keccak256]
          -> Redis [(Keccak256, Maybe OutputBlock)]
getBlocks = zipMapM getBlock

getBlocksByNumber :: Integer
                  -> Redis [(Keccak256, Maybe OutputBlock)]
getBlocksByNumber n = getMembersInNamespace Numbers n >>= \case
    Left _       -> return []
    Right hashes -> getBlocks (fromValue <$> hashes)

getBlocksByNumbers :: [Integer]
                   -> Redis [(Integer, [(Keccak256, Maybe OutputBlock)])]
getBlocksByNumbers = zipMapM getBlocksByNumber

putHeader :: BlockData
          -> Redis (Either Reply Status)
putHeader = uncurry insertHeader . (blockHeaderHash &&& id)

putHeaders :: Traversable t
           => t BlockData
           -> Redis (t (Either Reply Status))
putHeaders = mapM putHeader

insertHeader :: Keccak256
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

insertHeaders :: M.Map Keccak256 BlockData
              -> Redis (M.Map Keccak256 (Either Reply Status))
insertHeaders = sequenceA . M.mapWithKey insertHeader

deleteHeader :: Keccak256
             -> Redis (Either Reply Status)
deleteHeader _ = pure . Left $ SingleLine (S8.pack "deleteHeader - Not Implemented")

deleteHeaders :: Traversable t
              => t Keccak256
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

insertBlock :: Keccak256
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
        swapPayload otx = case otPrivatePayload otx of
                                Nothing -> Nothing
                                Just p -> Just otx{otBaseTx = p}
        fullPrivateTxs = catMaybes $ swapPayload <$> ptxs
        uncles  = RedisUncles (morphBlockHeader <$> blockUncleHeaders b)
        inNS'   = flip inNamespace sha
    unless (null fullPrivateTxs) $ do
      void . addPrivateTransactions $
        map (txHash &&& ((fromJust . txAnchorChain) &&& id)) fullPrivateTxs
      forM_ (partitionWith txAnchorChain fullPrivateTxs) $ \(cId, ptxs') ->
                         --  ^-- already filtered on (isJust . txChainId)
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

insertBlocks :: M.Map Keccak256 OutputBlock
             -> Redis (M.Map Keccak256 (Either Reply Status))
insertBlocks = sequenceA . M.mapWithKey insertBlock

deleteBlock :: Keccak256
            -> Redis (Either Reply Status)
deleteBlock _ = pure . Left $ SingleLine (S8.pack $ "deleteBlock - Not Implemented")

deleteBlocks :: Traversable t
             => t Keccak256
             -> Redis (t (Either Reply Status))
deleteBlocks = mapM deleteBlock

putBestBlockInfo :: Keccak256
                 -> Integer
                 -> Integer
                 -> Redis (Either Reply Status)
putBestBlockInfo newSha newNumber newTDiff = do
    --liftIO . putStrLn . ("New args" ++) $ show (keccak256ToHex newSha, newNumber, newTDiff)
    oldBBI' <- getBestBlockInfo
    case oldBBI' of
        Nothing      -> return (Left $ SingleLine "Got no block from getBetstBlockInfo")
        Just (RedisBestBlock oldSha oldNumber _) -> do
            --liftIO . putStrLn . ("Old args" ++) $ show (keccak256ToHex oldSha, oldNumber, oldTDiff)
            helper' <- commonAncestorHelper oldNumber newNumber oldSha newSha
            case helper' of
                Left err -> error $ "god save the queen! " ++ show err
                Right (updates, deletions) -> do
                    --liftIO . putStrLn $ "Updates: \n" ++ unlines ((\(x, y) -> show (keccak256ToHex x, y)) <$> updates)
                    --liftIO . putStrLn $ "Deletions: \n" ++ show deletions
                  res <- multiExec $ do
                      forM_ updates $ \(sha, num) -> set (inNamespace Canonical $ num) (toValue sha)
                      unless (null deletions) . void . del $ inNamespace Canonical . toKey <$> deletions
                      forceBestBlockInfo newSha newNumber newTDiff
                  checkAndUpdateSyncStatus
                  case res of
                      TxSuccess _ -> return $ Right Ok
                      TxAborted   -> return . Left $ SingleLine (S8.pack "Aborted")
                      TxError e   -> return . Left $ SingleLine (S8.pack e)

commonAncestorHelper :: Integer -> Integer
                     -> Keccak256     -> Keccak256
                     -> Redis (Either Reply ([(Keccak256, Integer)], [Integer])) -- ([Updates], [Deletions])
commonAncestorHelper oldNum newNum oldSha' newSha' = helper [oldSha'] [newSha'] (S.fromList [oldSha', newSha'])
        where helper [oldSha] [newSha] _ | oldSha == newSha = return $ Right ([], [])
              helper (_:(oldSha'':_)) (_:(newSha'':ns)) _ | oldSha'' == newSha'' = complete oldSha'' (mkParentChain newSha'' ns)
              helper oldShaChain newShaChain seen = do
                let oldSha = head oldShaChain
                    newSha = head newShaChain
                newParent <- (\x -> fromMaybe x <$> getParent x) newSha
                oldParent <- (\x -> fromMaybe x <$> getParent x) oldSha
                let ps = [newParent, oldParent]
                let seen' = foldl' (flip S.insert) seen (filter (/= unsafeCreateKeccak256FromWord256 0) ps) -- todo double S.insert is probably more optimal
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
              mkParentChain :: Keccak256 -> [Keccak256] -> [Keccak256]
              mkParentChain h xs | keccak256ToWord256 h == 0 = xs
              mkParentChain y xs@(x:_) = if x == y then xs else y:xs
              mkParentChain _ []       = error "the impossible happened, somehow called (mkParentChain _ [])"

              complete :: Keccak256 -> [Keccak256] -> Redis (Either Reply ([(Keccak256, Integer)], [Integer]))
              complete lca newShaChain = getHeader lca >>= \case
                      Nothing -> if lca /= unsafeCreateKeccak256FromWord256 0 -- genesis block is sha 0
                                     then return . Left . SingleLine . S8.pack $
                                              "Could not get ancestor header for Keccak256 " ++ keccak256ToHex lca
                                     else complete (head newShaChain) newShaChain
                      Just ancestor -> do
                          --liftIO . putStrLn $ show (keccak256ToHex lca, keccak256ToHex <$> newShaChain)
                          let ancestorNumber = blockHeaderBlockNumber ancestor
                              deletions      = [newNum+1..oldNum]
                              updates        = flip zip [ancestorNumber..] $ dropWhile (/= lca) newShaChain
                          return $ Right (updates, deletions)

              -- safeTail :: [a] -> [a]
              -- safeTail [] = []
              -- safeTail xs = tail xs

--validateLink :: (Keccak256,RedisHeader) -> (Keccak256, RedisHeader) -> Bool
--validateLink (psha,RedisHeader parentHeader) (_,RedisHeader childHeader) =
--  (psha == (parentHash childHeader))
--  &&
--  (((number parentHeader) + 1) == (number childHeader))
--
--validateChain :: [(Keccak256,RedisHeader)] -> Bool
--validateChain [] = True
--validateChain [_] = True
--validateChain (x:xs) = (validateLink x $ head xs) && (validateChain xs)

-- | Used to seed the first bestBlock, e.g. genesis block in strato-setup
forceBestBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> Integer -> m (f Status)
forceBestBlockInfo sha i j =
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

updateWorldBestBlockInfo :: Keccak256 -> Integer -> Integer -> Redis (Either Reply Bool)
updateWorldBestBlockInfo sha num tdiff = withRetryCount 0
    where withRetryCount :: Int -> Redis (Either Reply Bool)
          withRetryCount theRetryCount = do
              maybeLockID <- acquireWorldBestBlockRedlock defaultRedlockTTL
              case maybeLockID of
                  Left err -> do
                      when (theRetryCount /= 0 && theRetryCount `mod` 5 == 0) $ do
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
                              checkAndUpdateSyncStatus
                              releaseAndFinalize lockID True
                          Just (RedisBestBlock _ _ oldTDiff) -> do
                              liftLog $ $logDebugS "updateWorldBestBlockInfo" $ T.pack ( "oldTDiff = " ++ show oldTDiff ++ "; newTDiff = " ++ show tdiff)
                              let willUpdate = oldTDiff <= tdiff
                              if willUpdate
                                  then do
                                      liftLog $ $logDebugS "updateWorldBestBlockInfo" . T.pack $ "Updating best block: " ++ show num
                                      void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num tdiff)
                                      checkAndUpdateSyncStatus
                                  else
                                      liftLog $ $logDebugS "updateWorldBestBlockInfo" "Not updating"
                              releaseAndFinalize lockID willUpdate
              where releaseAndFinalize lockID didUpdate = do
                        didRelease <- releaseWorldBestBlockRedlock lockID
                        return $ case didRelease of
                            Right True  -> Right didUpdate
                            Right False -> Left $ SingleLine "Couldn't release redlock, it either expired or we had the wrong key"
                            err         -> err

-- Put this after any "best block" or "world best block" update.
-- We can't put this in the update functions themselves since multiExec fudges things up
checkAndUpdateSyncStatus :: Redis ()
checkAndUpdateSyncStatus = do
    status         <- getSyncStatus
    nodeBestBlock  <- getBestBlockInfo
    worldBestBlock <- getWorldBestBlockInfo
    let nodeTotalDiff  = bestBlockTotalDifficulty <$> nodeBestBlock
        worldTotalDiff = bestBlockTotalDifficulty <$> worldBestBlock

    case (status, nodeTotalDiff, worldTotalDiff) of
        (Just False, Just ntd, Just wtd) -> when (ntd >= wtd) (void $ putSyncStatus True)
        (Nothing,    Just ntd, Just wtd) -> void $ putSyncStatus (ntd >= wtd)
        (Nothing,    Nothing,  Just _  ) -> void $ putSyncStatus False
        _ -> pure ()

syncStatusKey :: S8.ByteString
syncStatusKey = "<sync_status>"
{-# INLINE syncStatusKey #-}

getSyncStatus :: Redis (Maybe Bool)
getSyncStatus = fmap fromValue . eitherToMaybe <$> get syncStatusKey
    where eitherToMaybe :: Either a (Maybe b) -> Maybe b
          eitherToMaybe (Left _)  = Nothing
          eitherToMaybe (Right a) = a

putSyncStatus :: RedisCtx m f => Bool -> m (f Status)
putSyncStatus status = set syncStatusKey $ toValue status

-- TODO: Use an effect system (IO eww... 😒)
runStratoRedisIO :: MonadIO m => Redis a -> m a
runStratoRedisIO r = liftIO $ do
  conn <- checkedConnect lookupRedisBlockDBConfig
  runRedis conn r
