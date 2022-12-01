{-#   LANGUAGE FlexibleContexts     #-}
{-#   LANGUAGE LambdaCase           #-}
{-#   LANGUAGE OverloadedStrings    #-}
{-#   LANGUAGE RecordWildCards      #-}
{-#   LANGUAGE TypeApplications     #-}
{-#   LANGUAGE TypeOperators        #-}
{-#   LANGUAGE ScopedTypeVariables  #-}

module Blockchain.Data.ValidatorRef where

import           Control.Monad                       (forM_)

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.ChainMember
import qualified Database.Esqueleto.Legacy           as E

addRemoveValidator :: HasSQLDB m
                   => ([ChainMemberParsedSet], [ChainMemberParsedSet])
                   -> m ()
addRemoveValidator (remove, add) = do
  forM_ add $ \x -> do
    let (o, u, c) = components x
    sqlQuery . E.insert $ ValidatorRef o u c
  forM_ remove $ \x -> do
    let (o, u, c) = components x
    sqlQuery $ E.delete $ E.from $ \vRef ->
      E.where_ ((vRef E.^. ValidatorRefOrg E.==. E.val o)
          E.&&. (vRef E.^. ValidatorRefOrgUnit E.==. E.val u)
          E.&&. (vRef E.^. ValidatorRefCommonName E.==. E.val c))
  where components = \case
          Org o True -> (o, "", "")
          OrgUnit o u True -> (o, u, "")
          CommonName o u c True -> (o, u, c)
          _ -> ("", "", "")