#!/bin/bash

set -x
set -e

MIN_TIMEOUT=60
authBasic=${authBasic:-true}
blockTime=${blockTime:-13} # keep default the same as strato

if [ -z "$uiPassword" ]
then
  echo "Using the default password for user \"admin\""
else
  echo "Setting UI password for user \"admin\""
  htpasswd -cb /etc/nginx/auth.htpasswd admin ${uiPassword}
fi

ln -sf nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf

BLOC_TIMEOUT=$((blockTime * 5))
if [ ${BLOC_TIMEOUT} -lt ${MIN_TIMEOUT} ]
then
  BLOC_TIMEOUT=${MIN_TIMEOUT}
fi

sed -i 's/<BLOC_TIMEOUT>/'"$BLOC_TIMEOUT"'/g' /etc/nginx/nginx.conf

if [ "$authBasic" != true ] ; then
	sed -i '/auth_basic/d' /etc/nginx/nginx.conf
fi

echo 'Waiting for apex to be available...'
until curl --silent --output /dev/null --fail --location http://apex:3001/health-check
do
  sleep 0.5
done
echo 'apex is available'

service nginx start || (tail -n 5 /var/log/nginx/error.log && exit 1) # Restart container if nginx failed to start (wait for all upstreams to become available)
tail -n0 -F /var/log/nginx/*.log
