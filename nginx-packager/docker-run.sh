#!/bin/bash

set -x
set -e

MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS=60
BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT=10
authBasic=${authBasic:-false}
blockTime=${blockTime:-13} # keep default the same as strato
sslCertFileType=${sslCertFileType:-crt}
cirrusHost=${cirrusHost:-cirrus:3333}

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /etc/nginx/auth.htpasswd admin ${uiPassword}
fi

ln -sf nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf

if [ "$ssl" = true ] ; then
	cp -r /tmp/ssl/* /etc/ssl/
	sed -i 's/<SSL_CERT_FILE_TYPE>/'"$sslCertFileType"'/g' /etc/nginx/nginx.conf
fi

sed -i 's/<CIRRUS_HOST>/'"$cirrusHost"'/g' /etc/nginx/nginx.conf
sed -i 's/<POSTGREST_HOST>/'"$postgrestHost"'/g' /etc/nginx/nginx.conf

BLOC_TIMEOUT=$((blockTime * BLOCK_TIME_MULTIPLIER_FOR_TIMEOUT))
if [ ${BLOC_TIMEOUT} -lt ${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS} ]
then
  BLOC_TIMEOUT=${MIN_TIMEOUT_BLOCKCHAIN_ENDPOINTS}
fi

sed -i 's/<BLOC_TIMEOUT>/'"$BLOC_TIMEOUT"'/g' /etc/nginx/nginx.conf

if [ "$authBasic" != true ] ; then
	sed -i '/auth_basic/d' /etc/nginx/nginx.conf
fi

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://apex:3001/_ping
do
  sleep 0.5
done
echo 'apex is available'

service nginx start || (tail -n 5 /var/log/nginx/error.log && exit 1) # Restart container if nginx failed to start (wait for all upstreams to become available)
tail -n0 -F /var/log/nginx/*.log
