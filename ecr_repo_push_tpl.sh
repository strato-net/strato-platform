#!/bin/sh

AWS_ACCESS_KEY_ID=$1 AWS_SECRET_ACCESS_KEY=$2 AWS_DEFAULT_REGION=$3 aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 406773134706.dkr.ecr.us-east-1.amazonaws.com

docker tag <REPO_URL>smd:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/smd:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/smd:<VERSION>

docker tag <REPO_URL>apex:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/apex:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/apex:<VERSION>

docker tag <REPO_URL>vault-wrapper:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/vault-wrapper:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/vault-wrapper:<VERSION>

docker tag <REPO_URL>strato:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/strato:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/strato:<VERSION>

docker tag <REPO_URL>postgrest:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/postgrest:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/postgrest:<VERSION>

docker tag <REPO_URL>nginx:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/nginx:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/nginx:<VERSION>

docker tag <REPO_URL>prometheus:<VERSION> 406773134706.dkr.ecr.us-east-1.amazonaws.com/prometheus:<VERSION>
docker push 406773134706.dkr.ecr.us-east-1.amazonaws.com/prometheus:<VERSION>
