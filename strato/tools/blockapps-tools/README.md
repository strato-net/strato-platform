#blockapps-tools

[![BlockApps logo](http://blockapps.net/img/logo_cropped.png)](http://blockapps.net)


This package contains tools to query the strato databases.

To use blockapps-tools in a docker container, run the following commands:
`docker pull registry-aws.blockapps.net:5000/querystrato`
`docker run -it --network strato_default registry-aws.blockapps.net:5000/querystrato /bin/bash -c "/queryStrato <tool> <args>"`
