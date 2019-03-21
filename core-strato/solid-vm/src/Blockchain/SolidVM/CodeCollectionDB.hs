module Blockchain.SolidVM.CodeCollectionDB where

import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8                as BC
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           System.IO.Unsafe

import           Blockchain.DB.CodeDB
import           Blockchain.SHA
import           Blockchain.SolidVM.Metrics
import           Blockchain.SolidVM.SM

import           CodeCollection


putCodeCollection :: CodeCollection -> SM SHA
putCodeCollection cc = do
  recordCacheEvent StorageWrite
  let ccString = BC.pack $ show cc
  addCode SolidVM ccString
  return $ hash ccString

getCodeCollection :: SHA -> SM CodeCollection
getCodeCollection hsh = do
  recordCacheEvent StorageRead
  read . BC.unpack <$> getEVMCode hsh

unsafeCodeMapIORef :: IORef (Map SHA CodeCollection)
unsafeCodeMapIORef = unsafePerformIO $ newIORef M.empty

-- TODO- We need to replace this with a true IO caching
-- library like http://hackage.haskell.org/package/lrucache
-- currently this never deletes anything, and will eventually fill up all of memory
getCodeCollectionCached :: SHA -> SM CodeCollection
getCodeCollectionCached address' = do
  unsafeCodeMap <- liftIO $ readIORef unsafeCodeMapIORef
  case M.lookup address' unsafeCodeMap of
    Nothing -> do
      recordCacheEvent CacheMiss
      x <- getCodeCollection address'
      liftIO $ writeIORef unsafeCodeMapIORef (M.insert address' x unsafeCodeMap)
      return x
    Just x -> do
      recordCacheEvent CacheHit
      return x
