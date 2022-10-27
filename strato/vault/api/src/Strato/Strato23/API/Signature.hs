{-# LANGUAGE DataKinds            #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeOperators        #-}

module Strato.Strato23.API.Signature where

import           Data.Text
import           Servant.API
import           Strato.Strato23.API.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "signature"
                   :> Header' '[Required, Strict] "X-USER-UNIQUE-NAME" Text
                   :> ReqBody '[JSON] MsgHash
                   :> Post '[JSON] Signature


-- curl http://mydomainorip:8000/strato/v2.3/signature 

-- curl http://vault-wrapper:8000/strato/v2.3/createCert -H 'X-USER-UNIQUE-NAME: user1@example.com' -d '{"subject": {"subCommonName":"Luke","subOrg":"BlockApps","subPub":"04cb13876cac3f5220e492884e681872f6fa3dddff44cf5068faa5bb8bf812208646e4187bb8638aac18be092591548d8c84e72e8f88da4f549d94' -i