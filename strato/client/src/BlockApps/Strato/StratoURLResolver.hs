module BlockApps.Strato.StratoURLResolver where

resolveStratoURL :: String -> String
resolveStratoURL "stratoDev" = "http://tester13.eastus.cloudapp.azure.com/strato-api/eth/v1.2"
resolveStratoURL "avocado" = "http://strato-ms-dev.eastus.cloudapp.azure.com/strato-api/eth/v1.2"
resolveStratoURL "local" = "http://localhost/strato-api/eth/v1.2"
resolveStratoURL x = x
