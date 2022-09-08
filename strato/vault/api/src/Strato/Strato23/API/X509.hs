{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}



module Strato.Strato23.API.X509 where


import           Data.Text
import           Servant
import           Strato.Strato23.API.Types
import           BlockApps.X509.Certificate


type CreateCertificate = "createCert"
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> ReqBody '[JSON] CreateCertEndpoint
              :> Get '[JSON] X509Certificate
