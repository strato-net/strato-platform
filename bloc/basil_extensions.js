util.RegisterCommand({
  Name: "multinode",
  Usage: "Make a multinode docker-compose",
  Flags: [
    util.MakeFlag({
      Name: "count,c",
      Usage: "how many extra stratos to make",
      Value: "1"
    }),
    util.MakeFlag({
      Name: "release,r",
      Usage: "Whether or not to use release-tagged images",
      Value: ""
    })
  ]
}, function(c) {
  var flagVal = parseInt(c.String("count"))
  var isRelease = c.String("release") != ""
  var stratoDeployment = _.first(_.filter(basilfile.Deployments, function(p) { return p.Name == "strato"; }))

  _.map(_.range(1, flagVal), function (i){
    //  console.log("Configuring node " + i)
      var stratoPeer = api.CloneDeployment(stratoDeployment)
      stratoPeer.Compose.Environment["bootnode"] = stratoDeployment.Name;
      stratoPeer.Compose.Environment["useSyncMode"] = "true";
      stratoPeer.Compose.Environment["redisBDBNumber"] = i;

      stratoPeer.Name = "strato-"+i;
      api.SetDeployment(stratoPeer)
  })
  
  console.log(api.DoCompose(isRelease))
})

util.RegisterCommand({
  Name: "setup",
  Usage: "Prepare your development environment",
}, function(c) {
  switch(util.OS.Platform) {
  case "linux":
    if (util.OS.Distribution == "Ubuntu") {
      if (util.OS.Codename != "xenial") {
        console.warn("NB: This setup was only tested with Ubuntu 16.04 (Xenial). YMMV");
      }
      basilfile.ExecuteShellInTTYOrDie("curl -sL https://deb.nodesource.com/setup_6.x | sudo bash -")
      basilfile.ExecuteShellInTTYOrDie("sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 575159689BEFB442")
      basilfile.ExecuteShellInTTYOrDie("echo \"deb http://download.fpcomplete.com/ubuntu $(lsb_release -s -c) main\" | sudo tee /etc/apt/sources.list.d/fpco.list")
      basilfile.ExecuteShellInTTYOrDie("sudo apt-get update") 
      basilfile.ExecuteShellInTTYOrDie("sudo apt-get install -y --allow-unauthenticated libleveldb-dev libpq-dev libpcre3-dev libboost-all-dev libjsoncpp-dev netbase netcat-openbsd libstdc++6 nodejs cmake stack");
      basilfile.GetDeployment("strato").ExecuteShellInTTYOrDie("stack setup && stack install alex happy")
    } else {
      console.error("Don't know how to setup for " + JSON.stringify(util.OS));
      util.Exit(1)
    }
    break;
  case "darwin":
    console.log("Nothing to set up on Darwin, as all builds are done within Docker!")
    break;
  default:
    console.error("Don't know how to setup for " + JSON.stringify(util.OS));
    util.Exit(1)
  }
})
