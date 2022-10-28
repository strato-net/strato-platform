{-#   LANGUAGE FlexibleContexts     #-}
{-#   LANGUAGE OverloadedStrings    #-}
{-#   LANGUAGE RecordWildCards      #-}
{-#   LANGUAGE TypeApplications     #-}
{-#   LANGUAGE TypeOperators        #-}
{-#   LANGUAGE ScopedTypeVariables  #-}

module Blockchain.Data.ValidatorRef where

import           Data.List                          as L
import           Control.Monad                     ( forM, forM_)

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Address
import qualified Database.Esqueleto.Legacy          as E


-- Provide (False, [Addresses]) to remove from database
-- Provide (True,  [Addresses]) to add    to   database
addRemoveValidator :: HasSQLDB m =>
                            (Bool, [Address]) -> m ()-- m (Key ValidatorRef)
addRemoveValidator (True, addr) = do
    txrs   <-  fmap (map E.entityVal) $  sqlQuery . E.select . E.from $ \(a :: E.SqlExpr (E.Entity ValidatorRef)) -> return a
    let setDifference = addr L.\\ ( (\(ValidatorRef x) -> x ) <$> txrs)
    if setDifference /= []
        then (forM_ setDifference $ (\x -> sqlQuery $  E.insert ValidatorRef{ validatorRefAddress = x })) >> pure ()
        else pure ()
addRemoveValidator (False, addr) = 
  if addr /= [] then (forM addr  $ (\x -> sqlQuery $ E.delete $ E.from $ \address -> E.where_ (address E.^. ValidatorRefAddress E.==. (E.val $ x :: E.SqlExpr (E.Value Address))))) >> pure ()                                                                       
     else pure ()