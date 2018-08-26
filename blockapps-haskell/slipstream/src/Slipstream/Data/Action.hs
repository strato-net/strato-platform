{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
#-}

module Slipstream.Data.Action where

import BlockApps.Ethereum

data ActionType = Create | Delete | Update deriving (Show)

data Action =
  Action{
    actionType::ActionType,
    address::String,
    codeHash::String,
    sourceCodeHash::Maybe String,
    chainId::(Maybe ChainId),
    storage::(Maybe [(String, String)])
    } deriving (Show)

