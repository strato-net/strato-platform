{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

import BlockApps.X509.Certificate (Subject(..))
import BlockApps.X509.Keys (bsToPriv)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad
import Data.Aeson (encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Char8 as C8
import HFlags
import SignSubjectOptions
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )

main :: IO ()
main = do
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  _ <- $initHFlags "Subject signing tool"
  pkBS <- B.readFile flags_key
  let ePK = bsToPriv pkBS
  case ePK of
    Left err -> error $ "Could not decode private key: " ++ err
    Right pk -> do
      let pub = case flags_public_key of
            "" -> derivePublicKey pk -- signing own subject info
            mp  -> case importPublicKey $ C8.pack mp of
              Nothing -> error $ "Could not decode public key from " ++ mp
              Just p -> p -- signing somebody else's subject info
          ou = if flags_organizationUnit == "" then Nothing else Just flags_organizationUnit
          c = if flags_country == "" then Nothing else Just flags_country
          sub = Subject
                  flags_commonName 
                  flags_organization
                  ou
                  c
                  pub
          sign' p = signMsg p . keccak256ToByteString . rlpHash
          printS = putStrLn . C8.unpack . BL.toStrict . encode
      case flags_verification_key of
        "" -> do -- new identity
          let sig = sign' pk sub
              signed = Signed sub sig
          printS signed
        filename -> do -- existing identity
          pkBS' <- B.readFile filename
          let ePK' = bsToPriv pkBS'
          case ePK' of
            Left err -> error $ "Could not decode verification private key: " ++ err
            Right pk' -> do
              let sig' = sign' pk' sub
                  signedSub = Signed sub sig'
                  sig = sign' pk signedSub
                  signed = Signed signedSub sig
              printS signed
