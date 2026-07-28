{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.CallSpec
  ( TxCreateObject (..),
    TxFuncCallObject (..),
    CallSpec (..),
    TraceOptions (..),
  )
where

import Blockchain.Sequencer.TxCallObject (TxCallObject (..))
import Blockchain.Strato.Model.Address (Address (..))
import Data.Aeson (FromJSON (..), ToJSON (..), Value (Object), object, withObject, (.!=), (.:), (.:?), (.=))
import Data.Binary
import Data.Text (Text)
import GHC.Generics (Generic)

-- | A simulated contract creation for eth_call\/eth_simulateV1\/debug_traceCall.
-- SolidVM is source-based: creation takes the contract name, Solidity source
-- text and constructor args rather than EVM init bytecode.
data TxCreateObject = TxCreateObject
  { createFrom :: Address,
    createGas :: Text,
    createValue :: Text,
    createContractName :: Text,
    createSource :: Text,
    createArgs :: [Text]
  }
  deriving (Show, Eq, Generic)

instance Binary TxCreateObject

-- | A SolidVM-native direct function call: funcName plus Solidity-literal
-- args, exactly the shape a posted MessageTX carries. Simulating through this
-- variant runs SolidVM.call the same way a real transaction would (including
-- fallback\/proxy dispatch), with no ABI selector resolution.
data TxFuncCallObject = TxFuncCallObject
  { funcCallFrom :: Address,
    funcCallTo :: Address,
    funcCallGas :: Text,
    funcCallValue :: Text,
    funcCallFunctionName :: Text,
    funcCallArgs :: [Text]
  }
  deriving (Show, Eq, Generic)

instance Binary TxFuncCallObject

-- | The tx object accepted by eth_call and friends: a message call when "to"
-- is present (SolidVM-native when "functionName" is also given, otherwise ABI
-- calldata), or a contract creation described by top-level
-- "contractName"\/"source"\/"args" fields.
data CallSpec
  = SpecCall TxCallObject
  | SpecCreate TxCreateObject
  | SpecFuncCall TxFuncCallObject
  deriving (Show, Eq, Generic)

instance Binary CallSpec

instance FromJSON CallSpec where
  parseJSON = withObject "CallSpec" $ \o -> do
    mTo <- o .:? "to"
    mFuncName <- o .:? "functionName"
    mName <- o .:? "contractName"
    case (mTo :: Maybe Address, mFuncName :: Maybe Text) of
      (Just to', Just funcName) ->
        fmap SpecFuncCall $
          TxFuncCallObject
            <$> o .:? "from" .!= Address 0
            <*> pure to'
            <*> o .:? "gas" .!= "0x0"
            <*> o .:? "value" .!= "0x0"
            <*> pure funcName
            <*> o .:? "args" .!= []
      (Just _, Nothing) -> SpecCall <$> parseJSON (Object o)
      (Nothing, _) -> case mName of
        Nothing ->
          fail "tx object needs either 'to' (call) or 'contractName'+'source' (creation)"
        Just name ->
          fmap SpecCreate $
            TxCreateObject
              <$> o .:? "from" .!= Address 0
              <*> o .:? "gas" .!= "0x0"
              <*> o .:? "value" .!= "0x0"
              <*> pure name
              <*> o .: "source"
              <*> o .:? "args" .!= []

-- ToJSON mirrors FromJSON exactly: encoding then decoding any CallSpec must
-- yield the same value (bloc encodes these into JSON-RPC params).
instance ToJSON CallSpec where
  toJSON (SpecCall txObj) = toJSON txObj
  toJSON (SpecCreate c) =
    object
      [ "from" .= createFrom c,
        "gas" .= createGas c,
        "value" .= createValue c,
        "contractName" .= createContractName c,
        "source" .= createSource c,
        "args" .= createArgs c
      ]
  toJSON (SpecFuncCall f) =
    object
      [ "from" .= funcCallFrom f,
        "to" .= funcCallTo f,
        "gas" .= funcCallGas f,
        "value" .= funcCallValue f,
        "functionName" .= funcCallFunctionName f,
        "args" .= funcCallArgs f
      ]

-- | Options for the debug_trace* endpoints ("tracerConfig"). Statement-level
-- tracing is opt-in because it can be very large.
newtype TraceOptions = TraceOptions
  { traceStatements :: Bool
  }
  deriving (Show, Eq, Generic)

instance Binary TraceOptions

instance FromJSON TraceOptions where
  parseJSON = withObject "TraceOptions" $ \o ->
    TraceOptions <$> o .:? "statements" .!= False
