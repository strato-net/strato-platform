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
    sourcePtr::Maybe (String, String),
    chainId::Maybe ChainId,
    storage::(Maybe [(String, String)])
    } deriving (Show)


formatAction :: Action -> String
formatAction Action{..} =
  show actionType ++ " " ++ address
  ++ (case chainId of
       Nothing -> ""
       Just c -> "in chain" ++ show c)
  ++ " with " ++ show (length storage) ++ " items\n"
  ++ "    codeHash = " ++ show codeHash ++ "\n"
  ++ "    sourcePtr = " ++ show sourcePtr
  
