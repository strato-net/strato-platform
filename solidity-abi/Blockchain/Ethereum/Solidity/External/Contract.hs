-- |
-- Module: Blockchain.Ethereum.Solidity.External.Contract
-- Description: Public api for externally visible features of a contract.
-- Maintainer: Ryan Reich <ryan@blockapps.net>
--
-- Currently only exports the \"function selector\" calculator, which
-- computes the 4-byte hash of a Solidity function that appears in
-- a function call transaction.
module Blockchain.Ethereum.Solidity.External.Contract (selector) where

import Selector
