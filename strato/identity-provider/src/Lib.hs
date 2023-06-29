
module Lib
    ( someFunc
    ) where

import           Servant
import           Blockchain.Strato.Model.Address


type MakeCert = "cert"
              -- what headers to include?
              :> Post '[Text] Address --should return cert address

type IdentityProviderAPI = MakeCert --only 1 endpoint

someFunc :: IO ()
someFunc = putStrLn "someFunc"
