{-# LANGUAGE OverloadedStrings #-}

module SortDirection where

import qualified Data.Text                   as T
import qualified Database.Esqueleto as E
import           Database.Persist.Postgresql
import           Servant

data Sortby = ASC | DESC deriving (Show)

instance FromHttpApiData Sortby where
  parseQueryParam x =
    case x of
      "asc" -> Right ASC
      "desc" -> Right DESC
      _ -> Left $ T.pack $ "Could not parse sortby parameter: " ++ show x



sortToOrderBy :: (E.Esqueleto query expr backend, PersistField a)
            => Maybe Sortby -> expr (E.Value a) -> (expr E.OrderBy)
sortToOrderBy (Just ASC)  x = E.asc  x
sortToOrderBy (Just DESC) x = E.desc x
sortToOrderBy _             x = E.asc  x



