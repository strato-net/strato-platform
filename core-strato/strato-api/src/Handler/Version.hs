
module Handler.Version where

import           Import     hiding (readFile, (</>))

import           Versioning

data Repo = Repo { name   :: String
                 , url    :: String
                 , sha    :: String
                 , branch :: String
                 } deriving (Show, Generic)

instance ToJSON Repo

getVersionR :: HandlerFor App Value
getVersionR = do
              addHeader "Access-Control-Allow-Origin" "*"
              return $ object ["monostrato" .= Repo "monostrato" "" $(gitHashMonostrato) $(gitBranchMonostrato)
                              --,"stack.yaml" .= ("stack" :: String, $(stackYaml) :: String) --(liftIO $ getStackInfo)
                              ]
