{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.StateRootMismatch
  ( formatStateRootMismatch
  )
where

import Blockchain.Strato.StateDiff
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate)
import qualified Data.Map as M
import SolidVM.Model.Storable
import qualified Data.Text as T
import Text.Format
import Text.Tools

formatStateRootMismatch :: StateDiff -> String
formatStateRootMismatch (StateDiff _ _ _ _ c d u) = intercalate "\n" $
  [ "\nAccounts found in local state, but not block state"
  , "--------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showEvAccDiff v)) <$> M.toList c
  , "\nAccounts missing from local state, but found in block state"
  , "-----------------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showEvAccDiff v)) <$> M.toList d
  , "\nAccounts found in both local and block states, but with different values"
  , "------------------------------------------------------------------------"
  , intercalate "\n" $ (\(k,v) -> "Address " ++ format k ++ "\n" ++ tab (showIncAccDiff v)) <$> M.toList u
  ]

showIncAccDiff :: AccountDiff 'Incremental -> String
showIncAccDiff AccountDiff{..} = intercalate "\n"
  [ "Nonce: " ++ maybe "Nothing" (showIncDiff show) nonce
  , "Balance: " ++ maybe "Nothing" (showIncDiff show) balance
  , "Code: " ++ maybe "Nothing" (showIncDiff BC.unpack) code
  , "CodeHash: " ++ format codeHash
  , "Contract Root: " ++ maybe "Nothing" (showIncDiff format) contractRoot
  , "Storage:\n" ++ tab (showIncStorDiff storage)
  ]

showEvAccDiff :: AccountDiff 'Eventual -> String
showEvAccDiff AccountDiff{..} = intercalate "\n"
  [ "Nonce: " ++ maybe "Nothing" (showEvDiff show) nonce
  , "Balance: " ++ maybe "Nothing" (showEvDiff show) balance
  , "Code: " ++ maybe "Nothing" (showEvDiff BC.unpack) code
  , "CodeHash: " ++ format codeHash
  , "Contract Root: " ++ maybe "Nothing" (showEvDiff format) contractRoot
  , "Storage:\n" ++ tab (showEvStorDiff storage)
  ]

showIncStorDiff :: StorageDiff 'Incremental -> String
showIncStorDiff (EVMDiff e) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showIncDiff format v) <$> M.toList e
showIncStorDiff (SolidVMDiff s) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showIncDiff (T.unpack . storageValueToText) v) <$> M.toList s

showEvStorDiff :: StorageDiff 'Eventual -> String
showEvStorDiff (EVMDiff e) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showEvDiff format v) <$> M.toList e
showEvStorDiff (SolidVMDiff s) = intercalate "\n" $ (\(k,v) -> format k ++ ": " ++ showEvDiff (T.unpack . storageValueToText) v) <$> M.toList s

showIncDiff :: (a -> String) -> (Diff a 'Incremental) -> String
showIncDiff f (Create a)   = "In local state: " ++ f a
showIncDiff f (Delete a)   = "In block state: " ++ f a
showIncDiff f (Update a b) = "In block state: " ++ f a ++ ", in local state: " ++ f b

showEvDiff :: (a -> String) -> (Diff a 'Eventual) -> String
showEvDiff f (Value a) = f a
