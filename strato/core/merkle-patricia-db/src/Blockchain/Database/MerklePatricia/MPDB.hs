{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Database.MerklePatricia.MPDB
  ( StateDB (..),
    openMPDB,
    tick,
    flush,
    withSandbox,
  )
where

import Blockchain.Database.MerklePatricia.StateRoot
import Control.DeepSeq
import Control.Monad.IO.Class
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Default
import qualified Database.LevelDB.Base as DB

newtype StateDB = StateDB {unStateDB :: DB.DB}

instance NFData StateDB where
  rnf (StateDB a) = a `seq` ()

-- | This function is used to create an MPDB object corresponding to the blank database.
-- After creation, the stateRoot can be changed to a previously saved version.
openMPDB ::
  -- | The filepath with the location of the underlying database.
  FilePath ->
  DB.Options ->
  IO StateDB
openMPDB path opts = do
  ldb' <- DB.open path opts
  DB.put ldb' def (BL.toStrict $ encode emptyTriePtr) B.empty
  return $ StateDB ldb'

-- | A block is done / write every held-back node through now. This trie
-- keeps no nodes of its own (its caller's store does), so there is nothing
-- to do; merkle-patricia-db-baremetal's store acts on these.
tick, flush :: MonadIO m => m ()
tick = return ()
flush = return ()

-- | Run the body with nothing it writes reaching the store; a no-op here
-- for the same reason as 'tick'.
withSandbox :: IO a -> IO a
withSandbox = id
