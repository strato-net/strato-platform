{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

module Handlers.BlkLast
  ( API,
    GetLastBlocks(..),
    getBlkLastClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import Blockchain.Model.JsonBlock
import Control.Arrow ((&&&), (***))
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Class
import Data.Int
import qualified Data.Map as Map
import qualified Database.Esqueleto.Legacy as E
import Servant
import Servant.Client
import Settings
import UnliftIO

type API =
  "block" :> "last"
    :> Capture "num" Integer
    :> Get '[JSON] [Block']

getBlkLastClient :: Integer -> ClientM [Block']
getBlkLastClient = client (Proxy @API)

server :: (Monad m, GetLastBlocks m) => ServerT API m
server = getBlkLast

---------------------

class GetLastBlocks m where
  getLastBlocks :: Integer -> m [Block]

instance (Monad m, GetLastBlocks m, MonadTrans t) => GetLastBlocks (t m) where
  getLastBlocks = lift . getLastBlocks

instance {-# OVERLAPPING #-} MonadUnliftIO m => GetLastBlocks (SQLM m) where
  getLastBlocks n = do
    blks <- fmap (map (E.entityKey &&& E.entityVal)) . sqlQuery $ E.select $ E.from $ \a -> do
      E.limit $ max 1 $ min (fromIntegral n :: Int64) appFetchLimit
      E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
      return a
    let blockIds = fst <$> blks
        buildList' f g = Map.fromListWith (flip (++)) . map (f &&& g)
        buildList  f   = buildList' f (:[]) . map E.entityVal
        get' = Map.findWithDefault []
    vs <- fmap (buildList blockValidatorRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
      E.where_ $ v E.^. BlockValidatorRefBlockDataRefId `E.in_` E.valList blockIds
      pure v
    vd <- fmap (buildList validatorDeltaRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
      E.where_ $ v E.^. ValidatorDeltaRefBlockDataRefId `E.in_` E.valList blockIds
      pure v
    ps <- fmap (buildList proposalSignatureRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
      E.where_ $ v E.^. ProposalSignatureRefBlockDataRefId `E.in_` E.valList blockIds
      pure v
    ss <- fmap (buildList commitmentSignatureRefBlockDataRefId) . sqlQuery $ E.select $ E.from $ \v -> do
      E.where_ $ v E.^. CommitmentSignatureRefBlockDataRefId `E.in_` E.valList blockIds
      pure v
    txs <- fmap (buildList' (blockTransactionBlockDataRefId . fst) ((: []) . rawTX2TX . snd) . map (E.entityVal *** E.entityVal)) . sqlQuery $
      E.select $ E.from $ \(btx `E.InnerJoin` rawTX) -> do
        E.on (rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction)
        E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
        E.orderBy [E.asc (btx E.^. BlockTransactionId)]
        return (btx, rawTX)

    return $ map (\(k,v) -> blockDataRefToBlock v (get' k vs) (get' k  vd) (get' k  ps) (get' k  ss) (get' k txs)) blks

getBlkLast :: (Monad m, GetLastBlocks m) => Integer -> m [Block']
getBlkLast n = do
  blks <- getLastBlocks n
  pure $ flip Block' "" <$> blks
