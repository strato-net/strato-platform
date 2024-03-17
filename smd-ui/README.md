# SMD-ui

STRATO Management Dashboard - the UI for STRATO built on React.js.

# Run in production
In production we run SMD in Docker as part of STRATO node (see Dockerfile, docker-run.sh, strato-platform/docker-compose.tpl.yml and github.com/blockapps/strato-getting-started)

# Run for local development

To run react dev server locally with all features enabled go through the following steps:

Requirements:

- Node v14.21.3 (updating to 21 made the problems to run jest tests - this needs some work, including replacing of yields with awaits)

To run the React dev server locally with all features enabled, add the `SMD_DEV_MODE=true` and `SMD_DEV_MODE_HOST_IP=<MY_IP>` environment variables to your STRATO start script:

1. Determine correct SMD_DEV_MODE_HOST_IP value depending on your OS:
  - Linux: `172.17.0.1` (default)
  - MacOS: `docker.for.mac.localhost`
  - Windows: `host.docker.internal`

  Note depending on your Docker setup and version, a different value for your IP might be required.

2. Run STRATO node normally on your localhost (say, localhost:8080):
    ```
    NODE_HOST=localhost:8080 \
    HTTP_PORT=8080 \
    OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration \
    OAUTH_JWT_USERNAME_PROPERTY=email \
    OAUTH_CLIENT_ID=dev \
    OAUTH_CLIENT_SECRET=d5e67b8c-4fbf-42c6-a8d9-29a4dd13575f \
    PASSWORD=123 \
    SMD_DEV_MODE=true \
    SMD_DEV_MODE_HOST_IP=<YOUR_IP> \
    ./strato --single
    ```

3. Run SMD react dev server locally:
    ```
    cd strato-platform/smd-ui
    npm i
    REACT_APP_NODE_HOST=localhost:8080 REACT_APP_OAUTH_ENABLED=true npm run start
    ```
    (The env vars have the prefix REACT_APP_ as it is the requirement of React in order to pass the unprefixed vars to browser)

4. Open `localhost:8080/` (**NOTE: PORT 8080, NOT THE 3000!!**) in the browser, login and start making changes in SMD code to see updates live in browser. 

Alternatively, this may done manually by changing the Nginx config inside the Nginx container after it has already been started and restarting the service:

1. Update STRATO's nginx config
    Get into the nginx container:
    ```
    sudo docker exec -it strato_nginx_1 bash
    ```
2. Edit the config with vim or nano:

    ```
    vim /usr/local/openresty/nginx/conf/nginx.conf
    ```

    Replace the existing `location / {...}` block with the following, replacing the IP with the correct IP based on your OS:
    
    ```
    location / {
      set $is_ui "true";
      rewrite_by_lua_file  lua/openid.lua;
      proxy_set_header Accept-Encoding "";
      proxy_pass http://<SMD_DEV_MODE_HOST_IP>:3000/;
    }
    ```

    And add a new location block to enable the web socket connection:

    ```
    location /sockjs-node {
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_http_version 1.1;
      proxy_pass http://<SMD_DEV_MODE_HOST_IP>:3000/sockjs-node;
    }
    ```
3. Validate and reload config:
    
    ```
    openresty -t   # check for validation errors
    openresty -s reload
    ```
    If there is an error in the config, the first validation step will warn you of those errors.

4. Run SMD locally as shown above.

