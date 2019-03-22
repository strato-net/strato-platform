
module Blockchain.SolidVM.CodeCollectionDB where

import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8                as BC
import           Data.IORef
import           Data.Map                             (Map)
import qualified Data.Map                             as M
import           System.IO.Unsafe

import           Blockchain.DB.CodeDB
import           Blockchain.SHA
import           Blockchain.SolidVM.SM

import           CodeCollection


putCodeCollection :: CodeCollection -> SM SHA
putCodeCollection cc = do
  let ccString = BC.pack $ show cc
  addCode SolidVM ccString
  return $ hash ccString

getCodeCollection :: SHA -> SM CodeCollection
getCodeCollection = fmap (read . BC.unpack) . getEVMCode

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
      x <- getCodeCollection address'
      liftIO $ writeIORef unsafeCodeMapIORef (M.insert address' x unsafeCodeMap)
      return x
    Just x -> return x

