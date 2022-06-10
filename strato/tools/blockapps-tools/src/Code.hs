module Code where
import           Blockchain.Strato.Model.Code
import           DumpLevelDB


doit :: String -> String -> IO ()
doit dbtype h = showKeyVal (show . Code) dbtype "code" (if h == "-" then Nothing else Just h)






