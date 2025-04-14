{-# LANGUAGE OverloadedStrings #-}

module Components.Badge (badgeClass) where

import qualified Data.Text as T

badgeClass :: T.Text -> T.Text
badgeClass t = case T.toLower t of
  "successful" -> "badge-success"
  "stake"      -> "badge-success"
  "pending"    -> "badge-warning"
  "redemption" -> "badge-warning"
  "failed"     -> "badge-danger"
  "unstake"    -> "badge-danger"
  "order"      -> "badge-info"
  "transfer"   -> "badge-neutral"
  _            -> "badge-muted"