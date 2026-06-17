import { useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import "@/lib/monaco";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Plus, FolderInput, Download, X, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  compileContract,
  tokenizeSource,
  constructorArgs,
  type XabiResult,
} from "@/services/contracts";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { useUser } from "@/context/UserContext";

interface SourceFile {
  name: string;
  content: string;
}

const STARTER = `contract SimpleStorage {
  uint storedData;

  constructor(uint x) {
    storedData = x;
  }

  function set(uint x) public {
    storedData = x;
  }

  function get() public view returns (uint) {
    return storedData;
  }
}
`;

export function EditorTab() {
  const { resolvedTheme } = useTheme();
  const { submit: submitTx, canSubmit } = useSubmitTransaction();
  const { userAddress, isAppAuthenticated } = useUser();

  const [files, setFiles] = useState<SourceFile[]>([{ name: "Main.sol", content: STARTER }]);
  const [active, setActive] = useState(0);
  const [output, setOutput] = useState<string>("");
  const [compiling, setCompiling] = useState(false);

  // Compilation result (drives the Create Contract dialog)
  const [xabi, setXabi] = useState<XabiResult | null>(null);
  const [compiledSource, setCompiledSource] = useState<string>("");

  // Add-file popover
  const [newFileName, setNewFileName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Create Contract dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  const [name, setName] = useState("");
  const [selectedContract, setSelectedContract] = useState<string>("");
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string>("");

  const activeFile = files[active] ?? files[0];
  const contractNames = xabi?.src ? Object.keys(xabi.src) : [];
  const argDefs = constructorArgs(xabi, selectedContract);

  const updateActiveContent = (value: string) => {
    setFiles((prev) => prev.map((f, i) => (i === active ? { ...f, content: value } : f)));
  };

  const addFile = () => {
    let n = newFileName.trim();
    if (!n) return;
    if (!/\.sol$/i.test(n)) n += ".sol";
    setFiles((prev) => [...prev, { name: n, content: "" }]);
    setActive(files.length);
    setNewFileName("");
    setAddOpen(false);
  };

  const importFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.sol$/i.test(file.name)) {
      toast.error("Please choose a .sol file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      setFiles((prev) => {
        const next = [...prev, { name: file.name, content }];
        setActive(next.length - 1);
        return next;
      });
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);
  };

  const downloadFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeFile.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeTab = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (files.length === 1) return;
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setActive((cur) => (index < cur ? cur - 1 : Math.min(cur, files.length - 2)));
  };

  const doCompile = async () => {
    const source = activeFile?.content ?? "";
    if (!source.trim()) {
      toast.error("Nothing to compile — the file is empty");
      return;
    }
    setCompiling(true);
    setOutput("");
    setDeployedAddress("");
    try {
      const result = await tokenizeSource(source);
      const names = result?.src ? Object.keys(result.src) : [];
      if (!names.length) throw new Error("No contracts found in source");
      // Validate by compiling the first contract; xabi gives us names + ctor args.
      await compileContract(names[0], source);
      setXabi(result);
      setCompiledSource(source);
      setSelectedContract(names[0]);
      setArgValues({});
      setOutput("Contract compiled successfully");
      toast.success("Compiled successfully");
    } catch (err: any) {
      setXabi(null);
      setCompiledSource("");
      const msg = typeof err === "string" ? err : String(err?.message || err);
      setOutput(msg);
      toast.error("Compile failed");
    } finally {
      setCompiling(false);
    }
  };

  const openCreate = () => {
    setDeployedAddress("");
    setCreateOpen(true);
  };

  // STRATO wallets deploy directly; external wallets must route through their User
  // wallet contract, which needs a username ("Name") and "Use Wallet" enabled.
  const externalDeployReady = useWallet && !!name.trim();
  const canCreate = isAppAuthenticated || (canSubmit && externalDeployReady);

  const doCreate = async () => {
    if (!selectedContract) {
      toast.error("Select a contract to create");
      return;
    }
    if (!isAppAuthenticated && !externalDeployReady) {
      toast.error('Enter a username and enable "Use Wallet" to deploy with an external wallet');
      return;
    }
    const args: Record<string, unknown> = {};
    for (const a of argDefs) {
      const raw = argValues[a.name];
      if (raw === undefined || raw === "") continue;
      try {
        args[a.name] = JSON.parse(raw);
      } catch {
        args[a.name] = raw;
      }
    }
    const metadata: Record<string, string> = { VM: "SolidVM" };
    if (contractNames.length) metadata.nohistory = contractNames.join(",");

    setDeploying(true);
    setDeployedAddress("");
    try {
      const result = await submitTx(
        "CONTRACT",
        {
          contract: selectedContract,
          src: compiledSource,
          args,
          metadata,
        },
        useWallet ? { username: name.trim() } : undefined
      );
      const address: string | undefined = result?.data?.contents?.address;
      setDeployedAddress(address ?? "");
      setOutput(JSON.stringify(result, null, 2));
      toast.success("Contract created", { description: address });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : String(err?.message || err);
      setOutput(msg);
      toast.error("Create failed", { description: msg });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add File
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="File name (e.g. Token.sol)"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFile()}
                  autoFocus
                />
                <Button size="sm" onClick={addFile}>
                  Add
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
            <FolderInput className="mr-1.5 h-4 w-4" />
            Import File
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".sol"
            className="hidden"
            onChange={importFile}
          />

          <Button variant="outline" size="sm" onClick={downloadFile}>
            <Download className="mr-1.5 h-4 w-4" />
            Download File
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={doCompile} disabled={compiling}>
            {compiling ? "Compiling…" : "Compile"}
          </Button>
          <Button onClick={openCreate} disabled={!xabi}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            Create Contract
          </Button>
        </div>
      </div>

      {/* File tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {files.map((f, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={cn(
              "flex items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors",
              i === active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {f.name}
            {files.length > 1 ? (
              <X
                className="h-3.5 w-3.5 opacity-60 hover:opacity-100"
                onClick={(e) => closeTab(i, e)}
              />
            ) : null}
          </button>
        ))}
      </div>

      {/* Full-width editor */}
      <div className="overflow-hidden rounded-md border border-border">
        <Editor
          height="60vh"
          defaultLanguage="sol"
          language="sol"
          path={activeFile?.name}
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          value={activeFile?.content ?? ""}
          onChange={(v) => updateActiveContent(v ?? "")}
          options={{ minimap: { enabled: true }, fontSize: 13, automaticLayout: true }}
        />
      </div>

      {/* Output / console */}
      {output ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {output}
        </pre>
      ) : null}

      {/* Create Contract dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Contract</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Field label="Name">
              <Input
                placeholder="username"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Address">
              <Input
                value={userAddress ?? ""}
                placeholder="Connect a wallet"
                disabled
                className="font-mono text-xs"
              />
            </Field>

            <Field label="Use Wallet">
              <Switch checked={useWallet} onCheckedChange={setUseWallet} />
            </Field>

            <Field label="Contracts">
              <Select value={selectedContract} onValueChange={setSelectedContract}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a contract" />
                </SelectTrigger>
                <SelectContent>
                  {contractNames.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="VM">
              <span className="text-sm text-muted-foreground">SolidVM</span>
            </Field>

            <div>
              <div className="mb-2 text-sm font-medium">Compilation</div>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Arg</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {argDefs.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                          No constructor arguments
                        </td>
                      </tr>
                    ) : (
                      argDefs.map((a) => (
                        <tr key={a.name} className="border-t border-border">
                          <td className="px-3 py-2 align-middle">{a.name}</td>
                          <td className="px-3 py-2 align-middle text-muted-foreground">{a.type}</td>
                          <td className="px-2 py-1.5">
                            <Input
                              value={argValues[a.name] ?? ""}
                              onChange={(e) =>
                                setArgValues((prev) => ({ ...prev, [a.name]: e.target.value }))
                              }
                              placeholder="value"
                              className="h-8"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {deployedAddress ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">Contract created successfully</div>
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {deployedAddress}
                </div>
              </div>
            ) : null}

            {!canSubmit ? (
              <p className="text-xs text-muted-foreground">
                Connect a wallet to create a contract.
              </p>
            ) : !isAppAuthenticated && !externalDeployReady ? (
              <p className="text-xs text-muted-foreground">
                To deploy with an external wallet, enter your username above and enable "Use
                Wallet". The deploy is routed through your on-chain User wallet contract so
                MetaMask (or another external wallet) can sign it.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={doCreate} disabled={deploying || !canCreate || !selectedContract}>
              {deploying ? "Creating…" : "Create Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <Label className="text-right text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}
