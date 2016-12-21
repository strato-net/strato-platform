
module Blockchain.SemiPermanent (
  SemiPermanent,
  newSemiPermanent,
  getSP,
  setSP
  ) where

import Control.Concurrent
import Control.Concurrent.STM.TVar
import Control.Monad
import Control.Monad.STM
import System.Directory
--import System.Process

newtype SemiPermanent a = SemiPermanent (TVar a)

newSemiPermanent::(Read a, Show a, Eq a)=>a->FilePath->IO (SemiPermanent a)
newSemiPermanent x filePath = do
  fileExists <- doesFileExist filePath
  value <-
    if fileExists
    then fmap read $ readFile filePath
    else do
      writeFile filePath (show x)
      return x
      
  tVar <- newTVarIO value

  _ <- forkIO $ syncValToFile filePath value tVar
  
  return $ SemiPermanent tVar

syncValToFile::(Read a, Show a, Eq a)=>FilePath->a->TVar a->IO ()
syncValToFile filePath oldVal tVar = do
  newVal <- readTVarIO tVar
  when (oldVal /= newVal) $ writeFile filePath $ show newVal
  threadDelay 1000000
  syncValToFile filePath newVal tVar
  
getSP::SemiPermanent a->IO a
getSP (SemiPermanent ref) = readTVarIO ref

setSP::SemiPermanent a->a->IO ()
setSP (SemiPermanent ref) val = atomically $ writeTVar ref val
