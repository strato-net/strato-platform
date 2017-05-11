{-# OPTIONS_GHC  -fno-warn-missing-signatures -fno-warn-type-defaults #-}

module Blockchain.Strato.Model.Constants where

ethVersion::Integer
ethVersion=62
shhVersion::Integer
shhVersion=2

_Uether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000;
_Vether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000;
_Dether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000;
_Nether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000000;
_Yether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000000;
_Zether = 1000000000 * 1000000000 * 1000000000 * 1000000000 * 1000;
_Eether = 1000000000 * 1000000000 * 1000000000 * 1000000000;
_Pether = 1000000000 * 1000000000 * 1000000000 * 1000000;
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

--------

-- ethereum mainnet is 131072
-- minimumDifficulty = minBlockDifficulty $ blockConfig $ ethConf

minimumDifficulty = 12000
difficultyDurationLimit = 8
difficultyAdjustment=11::Int
difficultyExpDiffPeriod=100000

minGasLimit testnet = if testnet then 125000 else 5000

rewardBase testnet = if testnet then 1500 * finney else 5000 * finney

-------------



