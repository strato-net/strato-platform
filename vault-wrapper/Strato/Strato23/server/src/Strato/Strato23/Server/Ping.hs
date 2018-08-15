module Strato.Strato23.Server.Ping where

  import           Strato.Strato23.Monad

  getPing :: VaultM String
  getPing = return "pingDetail"
