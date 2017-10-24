module Handler.BlkLast where

import           Handler.Common
import           Import

import           Data.List
import qualified Database.Esqueleto as E
import qualified Prelude            as P

getBlkLastR :: Integer -> Handler Value
getBlkLastR n      =            do addHeader "Access-Control-Allow-Origin" "*"
                                   blks <- runDB $ E.select $
                                        E.from $ \(a, t) -> do
                                        E.where_ (  a E.^. BlockDataRefBlockId E.==. t E.^. BlockId)
                                        E.limit $ P.max 1 $ P.min (fromIntegral n :: Int64) fetchLimit
                                        E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
                                        return t
                                   returnJson $ P.map bToBPrime' (P.map entityVal (blks :: [Entity Block]))
