function get_dependencies () {
    install_stack &&
    install_happy_alex &&
    install_dbs &&
    install_node

    return $?
}

function install_stack () {
    info "Installing stack..."

    cd
    wget -q -O- https://s3.amazonaws.com/download.fpcomplete.com/ubuntu/fpco.key \
	| sudo apt-key add - &&
    echo 'deb http://download.fpcomplete.com/ubuntu/trusty stable main' \
	| sudo tee /etc/apt/sources.list.d/fpco.list &&
    sudo apt-get update &&
    sudo apt-get install stack -y

    localbinpath=~/.local/bin
    profilefile=~/.profile
    setpath="PATH=\"$localbinpath:$PATH\""

    case ":$PATH:" in
	*":$localbinpath:"*) 
	    info "$localbinpath already in PATH"
	    ;;
	*)
	    info "Adding $localbinpath to PATH..."
	    echo $setpath >> $profilefile
	    eval $setpath
	    ;;
    esac
}

function install_happy_alex () {
    cd
    info "Installing alex and happy..."
    stack setup &&
    stack install happy alex
}

function install_dbs () {
    cd
    info "Installing postgresql and leveldb..."
    sudo apt-get -y install libpq-dev postgresql postgresql-client libleveldb-dev
}

function install_node {
    info "Installing Node.js"
    (curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -) &&
    sudo apt-get -y install nodejs
}

db_conf_dir="/etc/postgresql/9.3/main"
