module Strato.VaultProxy.Server.Ping where

  import           Strato.VaultProxy.Monad

  getPing :: VaultM String
  getPing = return "pingDetail"
