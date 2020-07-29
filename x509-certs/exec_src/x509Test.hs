{-# LANGUAGE TemplateHaskell #-}



import qualified Data.ByteString            as B
import qualified Crypto.Secp256k1           as S
import           Crypto.Random.Entropy


import           X509.Generate
import           Data.Maybe


-- test program!



main :: IO ()
main = do


--------------------------------------------------------------------------------------------
-------------------------------------- GENERATE CERT ---------------------------------------
--------------------------------------------------------------------------------------------


  priv <- do
   ent <- getEntropy 32
   return $ fromMaybe (error "could not generate private key") (S.secKey ent)

  

  let subject = Subject {
          subCommonName = "BlockApps"
        , subCountry    = "US"
        , subOrg        = "BlockApps"
        , subUnit       = "node1"
        , subPub        = S.derivePubKey priv 
      }

      issuer = Issuer {
            issCommonName = "BlockApps"
          , issCountry    = "US" 
          , issOrg        = "BlockApps"
          , issPriv       = priv
          }
  -- generate and write cert
  
  cert <- makeSignedCert issuer subject
  B.writeFile "cert.pem" $ certToBytes $ cert
