// Probe the tracking-server SSH path with the bot's deploy config.
import { sshCheck } from "../deploy/ssh";

sshCheck()
  .then((out) => {
    console.log(out);
    process.exit(0);
  })
  .catch((error) => {
    console.error("ssh check failed:", error);
    process.exit(1);
  });
