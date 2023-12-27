{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Database.MerklePatricia.MPDB
  ( StateDB (..),
    openMPDB,
  )
where

import Blockchain.Database.MerklePatricia.StateRoot
import Control.DeepSeq
import Control.Monad.Trans.Resource
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Default
import qualified Database.LevelDB as DB

newtype StateDB = StateDB {unStateDB :: DB.DB}

instance NFData StateDB where
  rnf (StateDB a) = a `seq` ()

-- | This function is used to create an MPDB object corresponding to the blank database.
-- After creation, the stateRoot can be changed to a previously saved version.
openMPDB ::
  -- | The filepath with the location of the underlying database.
  String ->
  ResourceT IO StateDB
openMPDB path = do
  ldb' <- DB.open path def {DB.createIfMissing = True}
  DB.put ldb' def (BL.toStrict $ encode emptyTriePtr) B.empty
  return $ StateDB ldb'
