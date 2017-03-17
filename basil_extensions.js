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

  var newStrato = api.CloneDeployment(stratoDeployment);
  newStrato.ComposeArgs["environment"]["addBootnodes"] = 21123

  var newStrato2 = api.CloneDeployment(stratoDeployment);
  newStrato2.Name = "also_not_strato";

  api.SetDeployment(newStrato)
  api.SetDeployment(newStrato2)

  console.log(api.DoCompose(isRelease))
})
