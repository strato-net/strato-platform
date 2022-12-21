module Strato.Strato23.Server.Ping where

  import           Strato.Strato23.Monad

-- getPing will return the version of the vault found in the package.yaml file 
  getPing :: VaultM String
  getPing = return $ "pingDetail: " ++ veri
