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
  var makeClone = function () { return _(stratoDeployment).clone(); };

  var newStrato = makeClone();
  newStrato.Name = "not_strato"

  console.log(basilfile.SetDeployment())
  console.log("asdasdas")
  console.log(basilfile.SetDeployment(newStrato))
  //console.log(api.DoCompose(isRelease))
})
