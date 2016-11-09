#!/bin/bash

ln -s nginx-$(${ssl:-false} || echo "no")ssl.conf /etc/nginx/nginx.conf
service nginx start
tail -n0 -F /var/log/nginx/*.log
