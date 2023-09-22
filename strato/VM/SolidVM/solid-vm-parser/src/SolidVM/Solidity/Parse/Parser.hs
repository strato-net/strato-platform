{-# LANGUAGE BangPatterns #-}

-- |
-- Module: Parser
-- Description: The Solidity source parser function
-- Maintainer: Ryan Reich <ryan@blockapps.net>
module SolidVM.Solidity.Parse.Parser where

showError :: Show a => Either a b -> Either String b
showError (Left e) = Left $ show e
showError (Right x) = Right x

orError :: Maybe a -> String -> Either String a
orError Nothing msg = Left msg
orError (Just x) _ = Right x
