export fqdn="${stratoHost:-$(curl -s ident.me 2>/dev/null)}"
export registry="${stratoRegistry:-auth.blockapps.net:5000}/"
export repository="${stratoRepository:-blockapps}/"
export version=":${stratoVersion:-latest}"
export bootnodes="${bootnodes}"
export genesis="${genesis:-stablenet}"
export addBootnodes="${addBootnodes:-false}"

export postgresImage="postgres"
export zookeeperImage="wurstmeister/zookeeper"

ourImages=( kafka bloc explorer nginx solc strato globaldb streak )

for image in ${ourImages[@]} raistones
do eval "export ${image}Image=${registry}${repository}$image${version}"
done

