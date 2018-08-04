module Strato.Strato23.Server.Ping where

  import           Servant

  getPing :: Handler String
  getPing = return "pingDetail"
  