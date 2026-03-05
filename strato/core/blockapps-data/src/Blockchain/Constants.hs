{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

module Blockchain.Constants where

import System.FilePath

stratoVersionString = "Ethereum(G)/v?.?.?/linux/Haskell"

stateDBPath :: String
stateDBPath = "/state/"

hashDBPath :: String
hashDBPath = "/hash/"

codeDBPath :: String
codeDBPath = "/code/"

sequencerDependentBlockDBPath :: String
sequencerDependentBlockDBPath = "/sequencer_dependent_blocks/"

blockSummaryCacheDBPath :: String
blockSummaryCacheDBPath = "/blocksummarycachedb/"

indexOffsetPath :: String
indexOffsetPath = "/indexOffset"

getDataDir :: IO FilePath
getDataDir = do
  return $ ".ethereumH"

getConfDir :: IO FilePath
getConfDir = do
  return $ ".ethereumH" </> "conf"

dbDir :: String -> String
dbDir "c" = ".ethereum"
dbDir "h" = ".ethereumH"
dbDir "t" = "/tmp/tmpDB"
dbDir x = error $ "Unknown DB specifier: " ++ show x
