module Strato.Strato23.Server.Ping where

  import           Strato.Strato23.Monad
  import           Data.Yaml

-- getPing will return the version of the vault found in the package.yaml file 
  getPing :: VaultM String
  getPing = do
    veri <- 
    return $ "pingDetail: " ++ veri
