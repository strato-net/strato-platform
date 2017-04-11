#!/bin/bash

cd /usr/bin/bloc/
blocserver="/usr/bin/bloc/blockapps-bloc"
#HOST=0.0.0.0 exec $blocserver -P $pghost -u $pguser -p $pgpasswd --stratourl=$stratoHost/strato-api/eth/v1.2 --cirrusurl=$cirrusurl 
HOST=0.0.0.0 exec $blocserver -papi --stratourl=${stratourl}/strato-api/eth/v1.2
