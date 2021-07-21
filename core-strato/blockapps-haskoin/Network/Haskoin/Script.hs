
-- {-# OPTIONS -fno-warn-unused-imports #-}

{-|
  This package provides functions for parsing and evaluating bitcoin
  transaction scripts. Data types are provided for building and
  deconstructing all of the standard input and output script types.
-}
module Network.Haskoin.Script
(
  Script(..)
, opPushData

  -- *Script Parsing
  -- **Script Outputs
, ScriptOutput(..)
, encodeOutput
, encodeOutputBS
, scriptAddr

  -- **Script Inputs
, ScriptInput(..)
, SimpleInput(..)
, RedeemScript
, encodeInputBS
, decodeInputBS

, SigHash(..)
, txSigHash
, TxSignature(..)
) where

import Network.Haskoin.Script.Types
import Network.Haskoin.Script.Parser
import Network.Haskoin.Script.SigHash
--import Network.Haskoin.Script.Evaluator
