{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}



module Strato.Strato23.API.X509 where


import           Data.Text
import           Servant
import           BlockApps.X509.Certificate


type SignCertificate = "sign-certificate"
              :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
              :> ReqBody '[JSON] (Subject, Maybe X509Certificate)
            --   :> ReqBody '[JSON] Subject
              :> Post '[JSON] X509Certificate
