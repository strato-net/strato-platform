{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Strato23.PemServer where

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.IO.Class (liftIO)
import Data.Proxy
import Servant
import Strato.Strato23.API
import Strato.Strato23.Server.Ping (getPing)

type PemVaultWrapperAPI = VaultWrapperAPI' '[]

pemVaultWrapper :: PrivateKey -> ServerT PemVaultWrapperAPI IO
pemVaultWrapper pk = getPing
             :<|> (\_ -> pure $ AddressAndKey (fromPrivateKey pk) (derivePublicKey pk))
             :<|> (\_ -> pure [AddressAndKey (fromPrivateKey pk) (derivePublicKey pk)])
             :<|> (pure $ AddressAndKey (fromPrivateKey pk) (derivePublicKey pk))
             :<|> (\pub -> pure $ deriveSharedKey pk pub)
             :<|> (\_ _ _ -> pure [])
             :<|> (\(MsgHash bs) -> pure $ signMsg pk bs)
             :<|> (const $ pure ())
             :<|> (pure True)

servePemVaultWrapper :: PrivateKey -> Server PemVaultWrapperAPI
servePemVaultWrapper pk = hoistServer pemServerProxy liftIO (pemVaultWrapper pk)

pemServerProxy :: Proxy PemVaultWrapperAPI
pemServerProxy = Proxy
