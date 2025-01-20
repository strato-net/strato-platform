{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Strato.RedisBlockDB
  ( RedisConnection (..),
    findNamespace,
    runStratoRedisIO,
    getChainInfo,
    isValidator,
    addValidators,
    getValidatorAddresses,  --remove
    registerCertificate,
    getChainTxsInBlock,
    getHeader,
    getHeaders,
    getBlock,
    getBlocks,
    getTransactions,
    getPrivateTransactions,
    addPrivateTransactions,
    getParent,
    getCanonicalHeader,
    getCertificate,
    insertRootCertificate,
    putHeader,
    putHeaders,
    insertHeader,
    insertHeaders,
    deleteHeader,
    deleteHeaders,
    putBlock,
    insertBlock,
    insertBlocks,
    deleteBlock,
    deleteBlocks,
    getBestBlockInfo,
    putBestBlockInfo,
    getBestSequencedBlockInfo,
    putBestSequencedBlockInfo,
    forceBestBlockInfo,
    withRedisBlockDB,
    commonAncestorHelper,
    getWorldBestBlockInfo,
    updateWorldBestBlockInfo,
    getSyncStatus,
    getSyncStatusNow,
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Partitioner (partitionWith)
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.ChainMember as CM
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.RedisBlockDB.Models as Models
import Blockchain.Strato.Model.Validator (Validator(..))
import Control.Arrow ((&&&), (***))
import Control.Concurrent (threadDelay)
import Control.Monad
import Control.Monad.Change.Modify hiding (get)
import Control.Monad.Trans
import qualified Data.ByteString.Char8 as S8
import Data.Foldable (foldl')
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes, fromJust, fromMaybe, isJust, isNothing)
import qualified Data.Set as S
import qualified Data.Text as T
import Database.Redis
import System.Random (randomIO)

newtype RedisConnection = RedisConnection {unRedisConnection :: Connection}

-- todo: move this somewhere?
zipMapM ::
  (Traversable t, Monad m) =>
  (a -> m b) ->
  t a ->
  m (t (a, b))
zipMapM f = mapM (\x -> (,) x <$> f x)

liftLog :: LoggingT m a -> m a
liftLog = runLoggingT

withRedisBlockDB ::
  (MonadIO m, Accessible RedisConnection m) =>
  Redis a ->
  m a
withRedisBlockDB m = do
  db <- unRedisConnection <$> access (Proxy @RedisConnection)
  liftIO $ runRedis db m

inNamespace ::
  RedisDBKeyable k =>
  BlockDBNamespace ->
  k ->
  S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
  where
    ns' = namespaceToKeyPrefix ns

namespaceToKeyPrefix :: BlockDBNamespace -> S8.ByteString 
namespaceToKeyPrefix ns = case ns of 
  Headers -> "h:"
  Transactions -> "t:"
  Numbers -> "n:"
  Uncles -> "u:"
  Parent -> "p:"
  Children -> "c:"
  Canonical -> "q:"
  PrivateChainInfo -> "x:"
  PrivateChainMembers -> "m:"
  PrivateTransactions -> "pt:"
  PrivateTxsInBlocks -> "pb:"
  PrivateOrgNameChains -> "pnc:"
  Validators -> "validators"
  PrivateTrueOrgNameChains -> "pnct:"
  PrivateFalseOrgNameChains -> "pncf:"
  X509Certificates -> "x509:"
  ParsedSetWhitePage -> "potu:"
  ParsedSetToX509 -> "psx509:"

findNamespace :: S8.ByteString -> BlockDBNamespace
findNamespace key = case S8.takeWhile (/= ':') key of
  "h" -> Headers
  "t" -> Transactions
  "n" -> Numbers
  "u" -> Uncles
  "p" -> Parent
  "c" -> Children
  "q" -> Canonical
  "validators" -> Validators
  "x" -> PrivateChainInfo
  "m" -> PrivateChainMembers
  "pt" -> PrivateTransactions
  "pb" -> PrivateTxsInBlocks
  "pnct" -> PrivateTrueOrgNameChains
  "pncf" -> PrivateFalseOrgNameChains
  "x509" -> X509Certificates
  "potu" -> ParsedSetWhitePage
  "psx509" -> ParsedSetToX509
  wut -> error $ "unknown namespace: " ++ show wut

getChainInfo ::
  Word256 ->
  Redis (Maybe ChainInfo)
getChainInfo cId =
  getInNamespace PrivateChainInfo cId >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rcInfo) ->
      let (RedisChainInfo cInfo) = fromValue rcInfo
       in return $ Just cInfo

isValidator ::
  CM.ChainMemberParsedSet ->
  Redis Bool
isValidator (CM.CommonName _ _ v _) =
  sismember (namespaceToKeyPrefix Validators) (toValue (Validator v)) >>= \case
    Right b -> pure b
    _ -> pure False
isValidator _ = pure False

getValidatorAddresses :: Redis [Address]
getValidatorAddresses = do 
  smembers (namespaceToKeyPrefix Validators) >>= \case 
    Left _ -> pure []
    Right keysBS -> (fmap userAddress . catMaybes) <$> (sequence $ (getCertFromParsedSet . fromValue) <$> keysBS)

addValidators ::
  [Validator] ->
  Redis (Either Reply Status)
addValidators [] = pure $ Right Ok
addValidators vals =
  sadd (namespaceToKeyPrefix Validators) (toValue <$> vals) >>= \case
    Right _ -> pure $ Right Ok
    Left reply -> pure $ Left reply

registerCertificate :: Address -> X509CertInfoState -> Redis (Either Reply Status)
registerCertificate userAddr x509CertInfoState = do
  parent <- (\ma -> maybe (pure Nothing) getCertificate ma) (getParentUserAddress $ certificate x509CertInfoState)

  -- The certificate registry will always be initialized at 0x509 on the main chain
  let parentIsValid = maybe False isValid parent

  case parent of
    -- The CertificateRegistry is initialized, this event it emitted from the right contract,
    -- and the parent certificate is valid
    Just p | parentIsValid -> do
      res1 <- modifyParsedSetFromCert x509CertInfoState
      res2 <- addParsedSet x509CertInfoState
      res3 <- fmap txToEither . multiExec $ updateParent p >> insertNewX509
      case (res1, res2, res3) of
        (Right _, Right _, Right _) -> pure $ Right Ok
        (Left e1, Left e2, Left e3) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2) <> S8.pack (show e3)
        (_, _, _) -> pure $ Left . SingleLine $ "registerCertificate failed."

    -- We can not register this certificate
    _ -> pure . Left . SingleLine $ "registerCertificate - invalid contractAddress, contract is not CertificateRegistry"
  where
    insertNewX509 = set (inNamespace X509Certificates $ toKey userAddr) (toValue x509CertInfoState)
    updateParent p@X509CertInfoState {..} = set (inNamespace X509Certificates userAddress) (toValue p {children = userAddr : children})
    txToEither = \case
      TxSuccess _ -> Right Ok
      TxAborted -> Left . SingleLine $ "registerCertificate - Aborted registering cert"
      TxError e -> Left . SingleLine $ "registerCertificate - Error registering cert " <> S8.pack e

getCertificate :: Address -> Redis (Maybe X509CertInfoState)
getCertificate userAddress =
  getInNamespace X509Certificates (toKey userAddress) >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just state) ->
      let certInfoState = fromValue state
       in return (Just certInfoState)

insertRootCertificate :: Redis (Either Reply Status)
insertRootCertificate = do
  -- TODO: check if root cert has already been added
  res1 <- modifyParsedSetFromCert rootCertInfoState
  res2 <- addParsedSet rootCertInfoState
  res3 <- fmap txToEither . multiExec $ insertNewX509
  case (res1, res2, res3) of
    (Right _, Right _, Right _) -> pure $ Right Ok
    (Left e1, Left e2, Left e3) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2) <> S8.pack (show e3)
    (_, _, _) -> pure $ Left . SingleLine $ "insertRootCertificate failed."
  where
    rootCertInfoState = x509CertToCertInfoState rootCert
    ua = userAddress rootCertInfoState
    insertNewX509 = set (inNamespace X509Certificates $ toKey ua) (toValue rootCertInfoState)
    txToEither = \case
      TxSuccess _ -> Right Ok
      TxAborted -> Left . SingleLine $ "insertRootCertificate - Aborted"
      TxError e -> Left . SingleLine $ "insertRootCertificate - Error " <> S8.pack e

getChainTxsInBlock ::
  Keccak256 ->
  Redis (M.Map Word256 [Keccak256])
getChainTxsInBlock bHash =
  getInNamespace PrivateTxsInBlocks bHash >>= \case
    Left _ -> return M.empty
    Right Nothing -> return M.empty
    Right (Just rmems) ->
      let RedisChainTxsInBlocks mems = fromValue rmems
       in return mems

addChainTxsInBlock ::
  Keccak256 ->
  Word256 ->
  [Keccak256] ->
  Redis (Either Reply Status)
addChainTxsInBlock bHash cId shas = do
  mems <- getChainTxsInBlock bHash
  let mems' = RedisChainTxsInBlocks $ M.insertWith (++) cId shas mems
  res <- multiExec $ set (inNamespace PrivateTxsInBlocks bHash) (toValue mems')
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addChainTxsInBlock - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addChainTxsInBlock - Error" ++ e)

getCertFromParsedSet :: CM.ChainMemberParsedSet -> Redis (Maybe X509CertInfoState)
getCertFromParsedSet (CM.CommonName o u c _) =
  getInNamespace ParsedSetToX509 (CM.CommonName o u c True) >>= \case
    Right (Just state) ->
      let certInfoState = fromValue state
       in pure $ Just certInfoState
    _ -> pure $ Nothing
getCertFromParsedSet _ = pure $ Nothing

addParsedSet :: X509CertInfoState -> Redis (Either Reply Status)
addParsedSet (X509CertInfoState _ _ _ _ o u c) = do
  let setOrg = CM.Org (T.pack o) True
      setOrgUnit = CM.OrgUnit (T.pack o) (T.pack $ fromMaybe "" u) True
      setCommonName = CM.CommonName (T.pack o) (T.pack $ fromMaybe "" u) (T.pack c) True
  currentUnits <-
    getInNamespace ParsedSetWhitePage setOrg >>= \case
      Right (Just runits) ->
        let units = fromValue runits
         in pure $ units
      _ -> pure $ []
  newUnits <- case setOrgUnit `elem` currentUnits of
    True -> pure $ currentUnits
    False -> pure $ currentUnits ++ [setOrgUnit]
  orgAdd <- multiExec $ set (inNamespace ParsedSetWhitePage setOrg) (toValue newUnits)
  orgRes <- case orgAdd of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Error" ++ e)
  currentMems <-
    getInNamespace ParsedSetWhitePage setOrgUnit >>= \case
      Right (Just rmems) ->
        let mems = fromValue rmems
         in pure $ mems
      _ -> pure $ []
  newMems <- case setCommonName `elem` currentMems of
    True -> pure $ currentMems
    False -> pure $ currentMems ++ [setCommonName]
  unitAdd <- multiExec $ set (inNamespace ParsedSetWhitePage setOrgUnit) (toValue newMems)
  unitRes <- case unitAdd of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Error" ++ e)
  case (orgRes, unitRes) of
    (Right _, Right _) -> pure $ Right Ok
    (Left e1, Left e2) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2)
    (_, _) -> pure $ Left . SingleLine $ "This probably shouldn't happen."

modifyParsedSetFromCert :: X509CertInfoState -> Redis (Either Reply Status)
modifyParsedSetFromCert certInfo@(X509CertInfoState _ _ _ _ o u c) = do
  let parsedSet = CM.CommonName (T.pack o) (T.pack $ fromMaybe "" u) (T.pack c) True
  res <- multiExec $ set (inNamespace ParsedSetToX509 parsedSet) (toValue certInfo)
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "modifyParsedSetFromCert - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "modifyParsedSetFromCert - Error" ++ e)

bestBlockInfoKey :: S8.ByteString
bestBlockInfoKey = S8.pack "<best>"
{-# INLINE bestBlockInfoKey #-}

bestSequencedBlockInfoKey :: S8.ByteString
bestSequencedBlockInfoKey = S8.pack "<best_sequenced>"
{-# INLINE bestSequencedBlockInfoKey #-}

getInNamespace ::
  (RedisDBKeyable key) =>
  BlockDBNamespace ->
  key ->
  Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key

getHeader ::
  Keccak256 ->
  Redis (Maybe BlockHeader)
getHeader sha =
  getInNamespace Headers sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rhead) ->
      let (RedisHeader h) = fromValue rhead
       in return . Just $ morphBlockHeader h

getHeaders ::
  [Keccak256] ->
  Redis [(Keccak256, Maybe BlockHeader)]
getHeaders = zipMapM getHeader

getTransactions ::
  Keccak256 ->
  Redis (Maybe [OutputTx])
getTransactions sha =
  getInNamespace Transactions sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rtxs) ->
      let (RedisTxs txs) = fromValue rtxs
       in return . Just $ morphTx <$> txs

getPrivateTransactions ::
  Keccak256 ->
  Redis (Maybe (Word256, OutputTx))
getPrivateTransactions sha =
  getInNamespace PrivateTransactions sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rtx) ->
      let (anchor, RedisTx tx) = fromValue rtx
       in return . Just $ (anchor, morphTx tx)

addPrivateTransactions ::
  [(Keccak256, (Word256, OutputTx))] ->
  Redis (Either Reply Status)
addPrivateTransactions ptxs = do
  res <-
    multiExec
      . mset
      $ map (inNamespace PrivateTransactions *** toValue) ptxs
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addPrivateTransactions - Error" ++ e)

getUncles ::
  Keccak256 ->
  Redis (Maybe [BlockHeader])
getUncles sha =
  getInNamespace Uncles sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rus) ->
      let (RedisUncles uncles) = fromValue rus
       in return . Just $ morphBlockHeader <$> uncles

getParent ::
  Keccak256 ->
  Redis (Maybe Keccak256)
getParent sha =
  getInNamespace Parent sha >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just rps) -> return . Just $ fromValue rps

getCanonical ::
  Integer ->
  Redis (Maybe Keccak256)
getCanonical n =
  getInNamespace Canonical n >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just sha) -> return . Just $ fromValue sha

getCanonicalHeader ::
  Integer ->
  Redis (Maybe BlockHeader)
getCanonicalHeader n =
  getCanonical n >>= \case
    Nothing -> return Nothing
    Just sha -> getHeader sha

getBlock ::
  Keccak256 ->
  Redis (Maybe OutputBlock)
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
            else
              let header = fromJust mybHeader
                  txs = fromJust mybTxs
                  uncles = fromJust mybUncles
               in return . Just $ buildBlock header txs uncles

getBlocks ::
  [Keccak256] ->
  Redis [(Keccak256, Maybe OutputBlock)]
getBlocks = zipMapM getBlock

putHeader ::
  BlockHeader ->
  Redis (Either Reply Status)
putHeader = uncurry insertHeader . (blockHeaderHash &&& id)

putHeaders ::
  Traversable t =>
  t BlockHeader ->
  Redis (t (Either Reply Status))
putHeaders = mapM putHeader

insertHeader ::
  Keccak256 ->
  BlockHeader ->
  Redis (Either Reply Status)
insertHeader sha h = do
  let parent = blockHeaderParentHash h
      number' = blockHeaderBlockNumber h
      storeHead = morphBlockHeader h :: RedisHeader
      inNS' = flip inNamespace sha

  res <- multiExec $ do
    void $ setnx (inNS' Headers) (toValue storeHead)
    void $ setnx (inNS' Parent) (toValue parent)
    void $ sadd (inNamespace Children parent) [toValue sha]
    sadd (inNamespace Numbers number') [toValue sha]
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "insertHeader - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "insertHeader - Error" ++ e)

insertHeaders ::
  M.Map Keccak256 BlockHeader ->
  Redis (M.Map Keccak256 (Either Reply Status))
insertHeaders = sequenceA . M.mapWithKey insertHeader

deleteHeader ::
  Keccak256 ->
  Redis (Either Reply Status)
deleteHeader _ = pure . Left $ SingleLine (S8.pack "deleteHeader - Not Implemented")

deleteHeaders ::
  Traversable t =>
  t Keccak256 ->
  Redis (t (Either Reply Status))
deleteHeaders = mapM deleteHeader

putBlock ::
  OutputBlock ->
  Redis (Either Reply Status)
putBlock b =
  let sha = blockHash b
   in insertBlock sha b

--partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
-- partitionWith f = map (fmap (map snd)) . indexedPartitionWith f

insertBlock ::
  Keccak256 ->
  OutputBlock ->
  Redis (Either Reply Status)
insertBlock sha b = do
  let header = blockHeader b
      number' = blockHeaderBlockNumber header
      parent = blockHeaderParentHash header
      header' = morphBlockHeader header :: RedisHeader
      txs = RedisTxs (morphTx <$> blockTransactions b :: [Models.RedisTx])
      ptxs =
        filter
          (isJust . (txChainId <=< otPrivatePayload))
          (obReceiptTransactions b)
      swapPayload otx = case otPrivatePayload otx of
        Nothing -> Nothing
        Just p -> Just otx {otBaseTx = p}
      fullPrivateTxs = catMaybes $ swapPayload <$> ptxs
      uncles = RedisUncles (morphBlockHeader <$> blockUncleHeaders b)
      inNS' = flip inNamespace sha
  unless (null fullPrivateTxs) $ do
    void . addPrivateTransactions $
      map (txHash &&& ((fromJust . (txChainId <=< otPrivatePayload)) &&& id)) fullPrivateTxs
    forM_ (partitionWith (txChainId <=< otPrivatePayload) fullPrivateTxs) $ \(cId, ptxs') ->
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
    TxAborted -> pure . Left $ SingleLine (S8.pack "Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack e)

insertBlocks ::
  M.Map Keccak256 OutputBlock ->
  Redis (M.Map Keccak256 (Either Reply Status))
insertBlocks = sequenceA . M.mapWithKey insertBlock

deleteBlock ::
  Keccak256 ->
  Redis (Either Reply Status)
deleteBlock _ = pure . Left $ SingleLine (S8.pack $ "deleteBlock - Not Implemented")

deleteBlocks ::
  Traversable t =>
  t Keccak256 ->
  Redis (t (Either Reply Status))
deleteBlocks = mapM deleteBlock

putBestBlockInfo ::
  Keccak256 ->
  Integer ->
  Redis (Either Reply Status)
putBestBlockInfo newSha newNumber = do
  --liftIO . putStrLn . ("New args" ++) $ show (keccak256ToHex newSha, newNumber, newTDiff)
  oldBBI' <- getBestBlockInfo
  case oldBBI' of
    Nothing -> return (Left $ SingleLine "Got no block from getBetstBlockInfo")
    Just (RedisBestBlock oldSha oldNumber) -> do
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
            forceBestBlockInfo newSha newNumber
          checkAndUpdateSyncStatus
          case res of
            TxSuccess _ -> return $ Right Ok
            TxAborted -> return . Left $ SingleLine (S8.pack "Aborted")
            TxError e -> return . Left $ SingleLine (S8.pack e)

commonAncestorHelper ::
  Integer ->
  Integer ->
  Keccak256 ->
  Keccak256 ->
  Redis (Either Reply ([(Keccak256, Integer)], [Integer])) -- ([Updates], [Deletions])
commonAncestorHelper oldNum newNum oldSha' newSha' = helper [oldSha'] [newSha'] (S.fromList [oldSha', newSha'])
  where
    helper [oldSha] [newSha] _ | oldSha == newSha = return $ Right ([], [])
    helper (_ : (oldSha'' : _)) (_ : (newSha'' : ns)) _ | oldSha'' == newSha'' = complete oldSha'' (mkParentChain newSha'' ns)
    helper oldShaChain newShaChain seen = do
      let oldSha = head oldShaChain
          newSha = head newShaChain
      newParent <- (\x -> fromMaybe x <$> getParent x) newSha
      oldParent <- (\x -> fromMaybe x <$> getParent x) oldSha
      let ps = [newParent, oldParent]
      let seen' = foldl' (flip S.insert) seen (filter (/= unsafeCreateKeccak256FromWord256 0) ps) -- todo double S.insert is probably more optimal
      if newParent `S.member` seen
        then complete newParent (mkParentChain newParent newShaChain)
        else
          if oldParent `S.member` seen
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
    mkParentChain y xs@(x : _) = if x == y then xs else y : xs
    mkParentChain _ [] = error "the impossible happened, somehow called (mkParentChain _ [])"

    complete :: Keccak256 -> [Keccak256] -> Redis (Either Reply ([(Keccak256, Integer)], [Integer]))
    complete lca newShaChain =
      getHeader lca >>= \case
        Nothing ->
          if lca /= unsafeCreateKeccak256FromWord256 0 -- genesis block is sha 0
            then
              return . Left . SingleLine . S8.pack $
                "Could not get ancestor header for Keccak256 " ++ keccak256ToHex lca
            else complete (head newShaChain) newShaChain
        Just ancestor -> do
          --liftIO . putStrLn $ show (keccak256ToHex lca, keccak256ToHex <$> newShaChain)
          let ancestorNumber = blockHeaderBlockNumber ancestor
              deletions = [newNum + 1 .. oldNum]
              updates = flip zip [ancestorNumber ..] $ dropWhile (/= lca) newShaChain
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
forceBestBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> m (f Status)
forceBestBlockInfo sha i =
  forceBestBlockInfo' bestBlockInfoKey (RedisBestBlock sha i) --`totalRecall` (,,)

forceBestBlockInfo' :: RedisCtx m f => S8.ByteString -> RedisBestBlock -> m (f Status)
forceBestBlockInfo' key = set key . toValue

getBestBlockInfo :: Redis (Maybe RedisBestBlock)
getBestBlockInfo = getBestBlockInfo' bestBlockInfoKey

getBestSequencedBlockInfo :: Redis (Maybe RedisBestBlock)
getBestSequencedBlockInfo = getBestBlockInfo' bestSequencedBlockInfoKey

putBestSequencedBlockInfo :: RedisCtx m f => Keccak256 -> Integer -> m (f Status)
putBestSequencedBlockInfo sha i =
  forceBestBlockInfo' bestSequencedBlockInfoKey (RedisBestBlock sha i)

getBestBlockInfo' :: S8.ByteString -> Redis (Maybe RedisBestBlock)
getBestBlockInfo' key =
  get key >>= \case
    Left x -> do
      liftLog $ $logErrorS "getBestBlockInfo'" . T.pack $ "got Left " ++ show x
      return Nothing
    Right r -> case r of
      Nothing -> return Nothing -- return . Left $ SingleLine "No BestBlock data set in RedisBlockDB"
      Just bs -> return . Just $ RedisBestBlock sha num
        where
          RedisBestBlock sha num = fromValue bs

releaseRedlockScript :: S8.ByteString
releaseRedlockScript =
  S8.pack . unlines $
    [ "if redis.call(\"get\",KEYS[1]) == ARGV[1] then",
      "    return redis.call(\"del\",KEYS[1])",
      "else",
      "    return 0",
      "end "
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
    Right (Status s) -> Left . SingleLine $ "Somehow got a nonempty status, which makes no fucking sense: " `S8.append` s
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

updateWorldBestBlockInfo :: Keccak256 -> Integer -> Redis (Either Reply Bool)
updateWorldBestBlockInfo sha num = withRetryCount 0
  where
    withRetryCount :: Int -> Redis (Either Reply Bool)
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
              void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num)
              checkAndUpdateSyncStatus
              releaseAndFinalize lockID True
            Just (RedisBestBlock _ oldNumber) -> do
              liftLog $ $logDebugS "updateWorldBestBlockInfo" $ T.pack ("oldNumber = " ++ show oldNumber ++ "; newNumber = " ++ show num)
              let willUpdate = oldNumber <= num
              if willUpdate
                then do
                  liftLog $ $logDebugS "updateWorldBestBlockInfo" . T.pack $ "Updating best block: " ++ show num
                  void $ forceBestBlockInfo' worldBestBlockKey (RedisBestBlock sha num)
                  checkAndUpdateSyncStatus
                else liftLog $ $logDebugS "updateWorldBestBlockInfo" "Not updating"
              releaseAndFinalize lockID willUpdate
      where
        releaseAndFinalize lockID didUpdate = do
          didRelease <- releaseWorldBestBlockRedlock lockID
          return $ case didRelease of
            Right True -> Right didUpdate
            Right False -> Left $ SingleLine "Couldn't release redlock, it either expired or we had the wrong key"
            err -> err

-- Put this after any "best block" or "world best block" update.
-- We can't put this in the update functions themselves since multiExec fudges things up
checkAndUpdateSyncStatus :: Redis ()
checkAndUpdateSyncStatus = do
  status <- getSyncStatus
  nodeBestBlock <- getBestBlockInfo
  worldBestBlock <- getWorldBestBlockInfo
  let nodeNumber = bestBlockNumber <$> nodeBestBlock
      worldNumber = bestBlockNumber <$> worldBestBlock

  case (status, nodeNumber, worldNumber) of
    (Just False, Just ntd, Just wtd) -> when (ntd >= wtd) (void $ putSyncStatus True)
    (Nothing, Just ntd, Just wtd) -> void $ putSyncStatus (ntd >= wtd)
    (Nothing, Nothing, Just _) -> void $ putSyncStatus False
    _ -> pure ()

getSyncStatusNow :: Redis (Maybe Bool)
getSyncStatusNow = do
  status <- getSyncStatus
  if case status of Just True -> True; _ -> False
    then pure $ Just True
    else do
      nodeBestBlock <- getBestBlockInfo
      worldBestBlock <- getWorldBestBlockInfo
      let nodeNumber = bestBlockNumber <$> nodeBestBlock
          worldNumber = bestBlockNumber <$> worldBestBlock
      pure $
        Just $ case (status, nodeNumber, worldNumber) of
          (Just False, Just ntd, Just wtd) -> ntd >= wtd
          (Nothing, Just ntd, Just wtd) -> ntd >= wtd
          (Nothing, Nothing, Just _) -> False
          _ -> True

syncStatusKey :: S8.ByteString
syncStatusKey = "<sync_status>"
{-# INLINE syncStatusKey #-}

getSyncStatus :: Redis (Maybe Bool)
getSyncStatus = fmap fromValue . eitherToMaybe <$> get syncStatusKey
  where
    eitherToMaybe :: Either a (Maybe b) -> Maybe b
    eitherToMaybe (Left _) = Nothing
    eitherToMaybe (Right a) = a

putSyncStatus :: RedisCtx m f => Bool -> m (f Status)
putSyncStatus status = set syncStatusKey $ toValue status

-- TODO: Use an effect system (IO eww... 😒)
runStratoRedisIO :: MonadIO m => Redis a -> m a
runStratoRedisIO r = liftIO $ do
  conn <- checkedConnect lookupRedisBlockDBConfig
  runRedis conn r

-- Retrieve a organization name and unit associated with an address
-- addressToOrg :: Address -> Redis (Maybe ChainMember)
-- addressToOrg addr = do
--     cIs <- getCertificate addr
--     case cIs of
--         Nothing -> return Nothing
--         Just c  -> return . Just $ (orgName &&& orgUnit) c
