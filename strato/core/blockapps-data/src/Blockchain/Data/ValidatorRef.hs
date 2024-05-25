{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.ValidatorRef where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Validator
import Control.Monad (forM_)
import qualified Database.Esqueleto.Legacy as E

addRemoveValidator ::
  HasSQLDB m =>
  ([Validator], [Validator]) ->
  m ()
addRemoveValidator (remove, add) = do
  forM_ add $ \(Validator c) -> do
    sqlQuery . E.insert $ ValidatorRef "" "" c
  forM_ remove $ \(Validator c) -> do
    sqlQuery $
      E.delete $
        E.from $ \vRef ->
          E.where_
            ( (vRef E.^. ValidatorRefOrg E.==. E.val "")
                E.&&. (vRef E.^. ValidatorRefOrgUnit E.==. E.val "")
                E.&&. (vRef E.^. ValidatorRefCommonName E.==. E.val c)
            )
