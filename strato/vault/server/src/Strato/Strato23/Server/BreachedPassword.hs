{-# LANGUAGE OverloadedStrings #-}

module Strato.Strato23.Server.BreachedPassword
  ( isPasswordBreached,
  )
where

import qualified Crypto.Hash.SHA1 as SHA1
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC8
import qualified Data.ByteString.Lazy as LB
import Data.Char (toUpper)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Network.HTTP.Client
import Network.HTTP.Types.Status (statusCode)

-- | Check if a password has been breached using the HaveIBeenPwned API
-- Uses k-anonymity to avoid sending the full password hash to the API
-- Returns True if the password has been found in breaches, False otherwise
isPasswordBreached :: Manager -> Text -> IO Bool
isPasswordBreached manager password = do
  let passwordBytes = encodeUtf8 password
      passwordHash = SHA1.hash passwordBytes
      hashHex = BC8.map toUpper $ B16.encode passwordHash
      (prefix, suffix) = BS.splitAt 5 hashHex

  -- Construct the API request
  -- The API uses k-anonymity: we only send the first 5 chars of the hash
  let url = "https://api.pwnedpasswords.com/range/" ++ BC8.unpack prefix
  request <- parseRequest url
  let requestWithHeaders = request
        { method = "GET"
        , requestHeaders = [("User-Agent", "STRATO-Vault-Wrapper")]
        }

  -- Make the request and check the response
  response <- httpLbs requestWithHeaders manager

  if statusCode (responseStatus response) == 200
    then do
      let responseBody = LB.toStrict $ responseBody response
          matches = checkHashInResponse suffix responseBody
      return matches
    else
      -- If the API is unavailable, we fail open (allow the password)
      -- This prevents the service from breaking if the API is down
      return False

-- | Check if our hash suffix appears in the API response
checkHashInResponse :: ByteString -> ByteString -> Bool
checkHashInResponse suffix responseBody =
  let lines' = BC8.lines responseBody
      -- Each line is formatted as "HASHSUFFIX:COUNT"
      -- We need to check if our suffix matches any of them
      matchesLine line =
        case BC8.split ':' line of
          (hashSuffix:_) -> hashSuffix == suffix
          _ -> False
   in any matchesLine lines'
