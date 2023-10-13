{-# OPTIONS_GHC -fno-warn-missing-signatures -fno-warn-type-defaults #-}

module Blockchain.VMConstants where

import Blockchain.Strato.Model.Gas

gTXDATANONZERO = 1 :: Gas -- 68 :: Gas

gTXDATAZERO = 1 :: Gas -- 4 :: Gas

gTX = 21000 :: Gas

gCREATETX = 53000 :: Gas

gHomesteadFirstBlock = 1150000 :: Gas
