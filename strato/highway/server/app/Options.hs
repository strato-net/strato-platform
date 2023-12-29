{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import HFlags

defineFlag "a:awsaccesskeyid"     ("" :: String) "AWS Access Key ID"
defineFlag "s:awssecretaccesskey" ("" :: String) "AWS Secret Access Key"
defineFlag "b:awss3bucket"        ("" :: String) "AWS S3 Bucket"
defineFlag "u:highwayUrl"         ("https://fileserver.mercata-testnet2.blockapps.net" :: String) "Public Highway URL"
