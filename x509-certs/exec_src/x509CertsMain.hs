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


defineFlag "root" (False :: Bool) "whether to generate this cert as a self-signed root cert. If True, will generate new root private key. If false, will look for existing root private key/cert with which to issue the cert"
defineFlag "org" ("blockapps" :: String) "name of the organization"
defineFlag "node" ("" :: String) "name of the new node"
defineFlag "url" ("blockapps-licensing" :: String) "URL of the new node"
defineFlag "country" ("US" :: String) "organization's home country"


$(return []) -- an 8+ year old bug in HFlags requires this...





main :: IO ()
main = do
  
 
  _ <- $initHFlags "Certificate Generator tool for X.509/Identity"
  

  putStrLn $ "X509 Node Certificate Generator\n\nFLAGS: "
  putStrLn $ "\troot: " ++ show flags_root
  putStrLn $ "\torg: " ++ show flags_org
  putStrLn $ "\tnode: " ++ show flags_node
  putStrLn $ "\turl: " ++ show flags_url
  putStrLn $ "\tcountry: " ++ show flags_country


--------------------------------------------------------------------------------------------
-------------------------------------- GENERATE CERT ---------------------------------------
--------------------------------------------------------------------------------------------


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





  --TODO: have a function to read cert and generate this....
  let subject = Subject {
          subCommonName = flags_url
        , subCountry    = flags_country
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

  -- generate and write cert
  cert <- makeSignedCert issuer subject
  B.writeFile fp $ certToBytes $ cert
