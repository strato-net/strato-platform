-- |
-- Module: Blockchain.Ethereum.Solidity.Layout
-- Description: Public API for the storage layout calculator
-- Maintainer: Ryan Reich <ryan.reich@gmail.com>
module Blockchain.Ethereum.Solidity.Layout (makeContractsLayout, module DefnTypes, module LayoutTypes) where

import Layout
import DefnTypes
import LayoutTypes hiding (IdentT)
