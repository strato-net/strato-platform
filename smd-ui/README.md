# smd-ui

STRATO Management Dashboard - the UI for STRATO built on React.js.

# Run in production
In production we run SMD in docker as part of STRATO node (see Dockerfile, docker-run.sh, strato-platform/docker-compose.tpl.yml and github.com/blockapps/strato-getting-started)

# Run for local development
To run react dev server locally with all features enabled go through the steps:

1. Run STRATO node normally on your localhost (say, localhost:8080):
```
NODE_HOST=localhost:8080 \
  HTTP_PORT=8080 \
  OAUTH_ENABLED=true \
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
  OAUTH_JWT_USERNAME_PROPERTY=email \
  OAUTH_CLIENT_ID=dev \
  OAUTH_CLIENT_SECRET=d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f \
  PASSWORD=123 \
  EXT_STORAGE_S3_BUCKET=strato-external-storage-test \
  EXT_STORAGE_S3_ACCESS_KEY_ID=AKIAV5NMROVZIZQY4OAE \
  EXT_STORAGE_S3_SECRET_ACCESS_KEY=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 \
  ./strato.sh --single
```

2. Get into the nginx container:
```
sudo docker exec -it strato_nginx_1 bash
```
and edit the config with vim or nano:
```
vim /usr/local/openresty/nginx/conf/nginx.conf
```
replace the existing `location / {...}` block with the following (note the difference between linux and mac):
```
location / {
  set $is_ui "true";
  rewrite_by_lua_file  lua/openid.lua;
  proxy_set_header Accept-Encoding "";
  proxy_pass http://172.17.0.1:3000/;                        # !!ON MAC USE `http://docker.for.mac.localhost:3000/` instead
};
```
and add the new location block (note the difference between linux and mac):
```
location /sockjs-node {
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_http_version 1.1;
  proxy_pass http://172.17.0.1:3000/sockjs-node;             # !!ON MAC USE `http://docker.for.mac.localhost:3000/sockjs-node` instead
}
```

3. Run SMD react dev server locally:
```
cd strato-platform/smd-ui
npm i
REACT_APP_OAUTH_ENABLED=true REACT_APP_NODE_HOST=localhost:8080 REACT_APP_EXT_STORAGE_ENABLED=true npm run start
```
(The env vars have the prefix REACT_APP_ as it is the requirement of React in order to pass the unprefixed vars to browser)

4. Open `localhost:8080/` in the browser, login and start making changes in SMD code to see updates live in browser. 

