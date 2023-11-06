{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE TemplateHaskell #-}

module Options where

import HFlags

defineFlag "a:awsaccesskeyid"     ("AKIAV5NMROVZIZQY4OAE" :: String)                     "AWS Access Key ID"
defineFlag "s:awssecretaccesskey" ("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" :: String) "AWS Secret Access Key"
defineFlag "b:awss3bucket"        ("mercata-testnet2" :: String)                         "AWS S3 Bucket"
defineFlag "loglevel"             (4 :: Int)                                             "The log level for output messages"
