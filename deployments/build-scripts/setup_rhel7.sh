function get_dependencies () {
    # Get screen
    sudo yum -y install screen &&

    # Get stack
    curl -sSL https://s3.amazonaws.com/download.fpcomplete.com/centos/7/fpco.repo \
	| sudo tee /etc/yum.repos.d/fpco.repo &&
    sudo yum -y install stack &&

    # Get git
    sudo yum -y install git &&

    # Get necessary packages
    ## alex and happy
    stack install happy alex &&

    ## PostgreSQL
    sudo yum -y install http://yum.postgresql.org/9.4/redhat/rhel-7-x86_64/pgdg-redhat94-9.4-2.noarch.rpm &&
    sudo yum -y install postgresql &&
    sudo yum -y install postgresql-devel &&
    sudo yum -y install postgresql94-server &&
    sudo /usr/pgsql-9.4/bin/postgresql94-setup initdb &&
    sudo systemctl enable postgresql-9.4.service &&
    sudo systemctl start postgresql-9.4.service &&

    ## LevelDB
    sudo yum -y install ftp://ftp.pbone.net/mirror/download.fedora.redhat.com/pub/fedora/epel/7/x86_64/l/leveldb-1.12.0-5.el7.x86_64.rpm &&
    sudo yum -y install ftp://ftp.pbone.net/mirror/download.fedora.redhat.com/pub/fedora/epel/7/x86_64/l/leveldb-devel-1.12.0-5.el7.x86_64.rpm &&

    ## ZLib
    sudo yum -y install zlib-devel
}

db_conf_dir="/var/lib/pgsql/9.4/data"
