{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import HFlags

defineFlag "awsaccesskeyid"     ("" :: String) "AWS Access Key ID"
defineFlag "awssecretaccesskey" ("" :: String) "AWS Secret Access Key"
defineFlag "awss3bucket"        ("" :: String) "AWS S3 Bucket"
defineFlag "highwayUrl"         ("localhost" :: String) "Highway URL local testing"-- ("https://fileserver.mercata-testnet2.blockapps.net" :: String) "Public Highway URL"
