import { useState } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { compileContract, deployContract } from "@/services/contracts";
import { useUser } from "@/context/UserContext";

const STARTER = `contract SimpleStorage {
  uint storedData;

  function set(uint x) {
    storedData = x;
  }

  function get() returns (uint) {
    return storedData;
  }
}
`;

export function EditorTab() {
  const { resolvedTheme } = useTheme();
  const { isAppAuthenticated } = useUser();
  const [name, setName] = useState("SimpleStorage");
  const [source, setSource] = useState(STARTER);
  const [args, setArgs] = useState("{}");
  const [output, setOutput] = useState<string>("");
  const [compiling, setCompiling] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const doCompile = async () => {
    setCompiling(true);
    setOutput("");
    try {
      const result = await compileContract(name, source);
      setOutput(JSON.stringify(result, null, 2));
      toast.success("Compiled successfully");
    } catch (err: any) {
      setOutput(String(err?.message || err));
      toast.error("Compile failed");
    } finally {
      setCompiling(false);
    }
  };

  const doDeploy = async () => {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = args.trim() ? JSON.parse(args) : {};
    } catch {
      toast.error("Constructor args must be valid JSON");
      return;
    }
    setDeploying(true);
    try {
      const result = await deployContract(name, source, parsedArgs);
      const address = result?.data?.contents?.address;
      setOutput(JSON.stringify(result, null, 2));
      toast.success("Contract deployed", { description: address });
    } catch (err: any) {
      setOutput(String(err?.message || err));
      toast.error("Deploy failed", { description: err?.message });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Solidity editor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <Editor
              height="28rem"
              defaultLanguage="sol"
              language="sol"
              theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
              value={source}
              onChange={(v) => setSource(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deploy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="contractName">Contract name</Label>
              <Input id="contractName" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ctorArgs">Constructor args (JSON)</Label>
              <Input id="ctorArgs" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="{}" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={doCompile} disabled={compiling} className="flex-1">
                {compiling ? "Compiling…" : "Compile"}
              </Button>
              <Button onClick={doDeploy} disabled={deploying || !isAppAuthenticated} className="flex-1">
                {deploying ? "Deploying…" : "Deploy"}
              </Button>
            </div>
            {!isAppAuthenticated ? (
              <p className="text-xs text-muted-foreground">
                Sign in with a STRATO wallet to deploy.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {output ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Output</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                {output}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
