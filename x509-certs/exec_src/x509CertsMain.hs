{-# LANGUAGE TemplateHaskell #-}



import qualified Data.ByteString            as B
import           Crypto.PubKey.ECC.DH
import           Crypto.PubKey.ECC.Types

import           HFlags


import           Generate
import           Data.X509
import           Data.Maybe



--------------------------------------------------------------------------------------------
---------------------------------------- FLAGS ---------------------------------------------
--------------------------------------------------------------------------------------------


defineFlag "root" (True :: Bool) "should generate new root private/public key and root cert"
defineFlag "org" ("blockapps" :: String) "name of the organization"
defineFlag "node" ("" :: String) "name of the new node"
defineFlag "url" ("blockapps-licensing" :: String) "URL of the new node"

$(return []) -- an 8+ year old bug in HFlags requires this...




--------------------------------------------------------------------------------------------
-------------------------------------- GENERATE CERT ---------------------------------------
--------------------------------------------------------------------------------------------

main :: IO ()
main = do
  
 
  _ <- $initHFlags "Certificate Generator tool for X.509/Identity"
  putStrLn $ "cert-gen -> root cert: " ++ show flags_root
  putStrLn $ "cert-gen -> orgName: " ++ show flags_org
  putStrLn $ "cert-gen -> nodeName: " ++ show flags_node
  putStrLn $ "cert-gen -> nodeURL: " ++ show flags_url


  (rootPriv, clientPub) <-
    case flags_root of
      False -> do
        rootPrivBS <- B.readFile "artifacts/rootpriv.pem"
        clientPubBS <- B.readFile "artifacts/pubkey.pem"
        return (bsToPriv rootPrivBS, bsToPub clientPubBS)
      True -> do
        priv <- generatePrivate $ getCurveByName SEC_p256k1
        B.writeFile "artifacts/rootpriv.pem" $ privToBytes priv
        return (priv, calculatePublic (getCurveByName SEC_p256k1) priv)




  --TODO: ovbs this go in vault
--  B.writeFile "artifacts/pubkey.pem" $ pubToBytes clientPub



  --TODO: have a function to read cert and generate this....
  -- create issuer and subject
  let subject = Subject {
          subCommonName = flags_url
        , subCountry    = "US" -- TODO: grab from flag? remove?
        , subOrg        = flags_org
        , subUnit       = flags_node
        , subPub        = clientPub 
      }
      fp = case flags_root of
        True -> "artifacts/rootcert.pem"
        False -> "artifacts/" ++ flags_org ++ "-" ++ flags_node ++ "cert.pem"


  issuer <- case flags_root of 
        True -> return $ Issuer {
            issCommonName = flags_url
          , issCountry    = "US" 
          , issOrg        = flags_org
          , issPriv       = rootPriv
          }
        False -> do
          certBS <- B.readFile "artifacts/rootcert.pem" 
          let cert = getCertificate $ bsToCert certBS
              dn = certIssuerDN cert
              getStr el = fromASN1CS $ fromMaybe (error "could not getDnElement") $ getDnElement el dn
          return $ Issuer {
            issCommonName = getStr DnCommonName 
          , issCountry = getStr DnCountry
          , issOrg = getStr DnOrganization
          , issPriv = rootPriv
          }


  B.writeFile fp $ certToBytes $ makeSignedCert issuer subject
