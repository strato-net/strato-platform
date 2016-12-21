build_log=~/ethereum-build.log
exec 3>&1 1>$build_log 2>&1

function info () {
    echo 1>&3 "$@"
}

function get_mgit() {
    cd
    if [[ -d mgit ]]; then
	info "mgit already installed"
	return 0
    fi

    info "Installing mgit..."
    git clone http://github.com/blockapps/mgit &&
    cd mgit &&
    stack setup &&
    stack install
}

function build_ethereumH () {
    cd
    if [[ ! -d ethereumH ]]
    then
	info "Unpacking ethereumH..."
	mgit clone http://github.com/blockapps/ethereumH -b develop
    else
	info "ethereumH/ is already present"
    fi &&
    cd ethereumH/ethereum-vm &&
    git merge origin/deployment-patches

    cd ~/ethereumH
    info "Installing ethereumH..."
    stack setup &&
    stack install
}

function setup_dbs() {
    info "Setting up postgresql..."
    sudo -u postgres psql -U postgres -d postgres \
	-c "alter role postgres password 'api'" &&
    info "  user: postgres" &&
    info "  password: api" &&
    (sudo -u postgres createdb eth 2> /dev/null &&
	info "  database: eth" ||
	info "  database 'eth' already exists") &&
    cat <<EOF | sudo tee $db_conf_dir/pg_hba.conf >/dev/null &&
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# "local" is for Unix domain socket connections only
local   all             all                                     ident
# IPv4 local connections:
host    all             all             127.0.0.1/32            md5
# IPv6 local connections:
host    all             all             ::1/128                 md5
EOF
    cd ~/ethereumH/ethereum-data-sql &&
    case "$1" in
    "dev")        
        ln -sf stablenetGenesis.json genesis.json ;;
    "live")
        ln -sf livenetGenesis.json genesis.json ;;
    esac &&
    info "  configuring database 'eth', installing genesis block" &&
    [[ $(ethereum-setup 2>&1 | tail -n1) == "ethereum-setup: called getBlockIdFromBlock on a block that appears more than once in the DB" || $? == 0 ]]
}

function install_blockappsjs {
    cd
    info "Installing blockapps-js..."
     
    sudo npm install -g browserify minify &&
    npm install blockapps-js &&
    cd ./node_modules/blockapps-js &&
    ./mkbrowser.sh &&
    cp blockapps.js ~/ethereumH/hserver-eth/static/js &&
    ln -sf blockapps.js ~/ethereumH/hserver-eth/static/js/api.js
}

function setup_nginx () {
    info "Setting up http->https redirect..."
    sudo apt-get -y install nginx &&
    cat <<EOF | sudo tee /etc/nginx/sites-available/https_redirect >/dev/null &&
server {
    server_name \*.blockapps.net;
    return 301 https://\$host\$request_uri;
}
EOF
    sudo ln -sf ../sites-available/https_redirect /etc/nginx/sites-enabled &&
    sudo rm -f /etc/nginx/sites-enabled/default
}

function copy_files () {
    info "Unpacking distributed files"
    cd
    mkdir -p ~/.local/{strato,startup} &&
    tar xzf strato-files.tar.gz &&
    rm strato-files.tar.gz &&
    if [[ "$1" != "live" ]]; then
        rm ~/.local/strato/ethereumH
    fi &&
    ln -sf ~/.local/bin/strato ~/.local/startup &&
    cat <<EOF | sudo tee /etc/rc.local >/dev/null &&
#!/bin/bash
for homedir in /home/*; do
    user=$(basename $homedir)
    for script in $homedir/.local/startup/*; do
         [[ -x $script ]] && su - $user $script start
    done
done
exit 0
EOF
    if [[ "$2" != "private" ]]; then
        sed -i s/PORT=443/PORT=80/ ~/.local/strato/api &&
        rm ~/ethereumH/hserver-eth/{key,certificate}.pem &&
        touch ~/ethereumH/hserver-eth/{key,certificate}.pem
    fi
    cp ~/ethereumH/ethereum-conf/ethconf.yaml ~/.ethereumH &&
    sudo setcap 'cap_net_bind_service=+ep' ~/.local/bin/api &&
    strato start
}
