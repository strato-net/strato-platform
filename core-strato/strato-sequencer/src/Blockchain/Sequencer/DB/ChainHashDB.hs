{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.DB.ChainHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import           Blockchain.SHA

import           Control.Lens
import           Control.Monad.IO.Class
import qualified Data.Sequence                as Q
import           Data.String
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.SeenChainDB
import           Blockchain.Sequencer.DB.Metrics

insertChainHash :: HasPrivateHashDB m => SHA -> Word256 -> m ()
insertChainHash cHash chainId = repsertChainHashEntry_ cHash $ \case
  Nothing -> return $ chainHashEntryWithChainId chainId
  Just che -> return $ (onChainId .~ Just chainId) che

useChainHash :: HasPrivateHashDB m => SHA -> m ()
useChainHash cHash = modifyChainHashEntryState_ cHash $ used .= True

getChainBuffer :: HasPrivateHashDB m => Word256 -> m (CircularBuffer SHA)
getChainBuffer chainId = maybe emptyCircularBuffer _chainHashes <$> getChainIdEntry chainId

lookupChainBuffer :: HasPrivateHashDB m => Word256 -> m (CircularBuffer SHA)
lookupChainBuffer = getChainBuffer

insertChainBufferEntry :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertChainBufferEntry chainId cHash = modifyChainIdEntryState_ chainId $ do
  CircularBuffer cap sz q <- use chainHashes
  liftIO $ withLabel chainBuffer (fromString (show chainId)) (flip setGauge (fromIntegral sz))
  if sz < cap
    then chainHashes .= CircularBuffer cap (sz + 1) (q Q.|> cHash)
    else case Q.viewl q of
           Q.EmptyL -> chainHashes .= CircularBuffer cap 1 (q Q.|> cHash)
           (_ Q.:< q') -> chainHashes .= CircularBuffer cap sz (q' Q.|> cHash)

getNewChainHash :: HasPrivateHashDB m => Word256 -> m SHA
getNewChainHash chainId = do
  CircularBuffer cap sz q <- getChainBuffer chainId
  case Q.viewl q of
    Q.EmptyL -> error $ "getNewChainHash: Empty chain buffer for chainId " ++ show chainId
    (h Q.:< q') -> do
      modifyChainIdEntryState_ chainId $ chainHashes .= CircularBuffer cap (sz - 1) q'
      Just used' <- fmap _used <$> getChainHashEntry h
      if not used'
        then useChainHash h >> return h
        else getNewChainHash chainId

insertChainInfo :: HasPrivateHashDB m => Word256 -> ChainInfo -> m ()
insertChainInfo chainId cInfo = do
  let h = hash . rlpSerialize $ rlpEncode cInfo
  insertSeenChain chainId cInfo
  insertChainHash h chainId
  insertChainBufferEntry chainId h
