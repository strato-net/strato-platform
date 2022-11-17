module Strato.VaultProxy.Server.Ping where

import           Strato.VaultProxy.Monad

getPing :: VaultProxyM String
getPing = return "pingDetail"
