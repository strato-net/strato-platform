
module Blockchain.Constants (
  dbDir,
  hashDBPath,
  codeDBPath,
  blockSummaryCacheDBPath,
  sequencerDependentBlockDBPath,
  stateDBPath,
  stratoVersionString
  ) where

--TODO choose a better Identifier string, add version number
stratoVersionString :: String
stratoVersionString = "Ethereum(G)/v?.?.?/linux/Haskell"
{-
_Uether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000

_Vether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000

_Dether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000

_Nether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000

_Yether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000

_Zether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000

_Eether = 1000000000 * 1000000000 * 1000000000 * 1000000000

_Pether = 1000000000 * 1000000000 * 1000000000 * 1000000

_Tether = 1000000000 * 1000000000 * 1000000000 * 1000

_Gether = 1000000000 * 1000000000 * 1000000000

_Mether = 1000000000 * 1000000000 * 1000000

_Kether = 1000000000 * 1000000000 * 1000

ether = 1000000000000000000

finney = 1000000000000000

szabo = 1000000000000

_Gwei = 1000000000

_Mwei = 1000000

_Kwei = 1000

wei = 1
-}
-------------

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

dbDir :: String -> String
dbDir "c" = ".ethereum"
dbDir "h" = ".ethereumH"
dbDir "t" = "/tmp/tmpDB"
dbDir x = error $ "Unknown DB specifier: " ++ show x
