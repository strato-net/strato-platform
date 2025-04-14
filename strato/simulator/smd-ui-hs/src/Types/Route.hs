-- File: Types.Route.hs
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Types.Route where

import GHC.Generics (Generic)

-- Top-level sections
data TopRoute
  = RouteSMD SMDRoute
  | RouteMarketplace MarketplaceRoute
  | RouteBridge BridgeRoute
  deriving (Eq, Show, Generic)

-- STRATO Management Dashboard (SMD)
data SMDRoute
  = SMDDashboard
  | SMDUsers
  | SMDTransactions
  | SMDContracts
  | SMDBlocks
  | SMDContractEditor
  deriving (Eq, Show, Generic)

-- Marketplace
data MarketplaceRoute
  = MarketHome
  | MarketTransactions
  | MarketWallet
  | MarketFeed
  | MarketStake
  deriving (Eq, Show, Generic)

-- Bitcoin Bridge
data BridgeRoute
  = BridgeOverview
  | BridgeBridge
  | BridgeRPC
  deriving (Eq, Show, Generic)