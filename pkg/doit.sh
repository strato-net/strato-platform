#!/bin/bash

service nginx start
tail -n0 -F /var/log/nginx/*.log
