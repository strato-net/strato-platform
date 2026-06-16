import { lazy, Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RegistryTab } from "@/components/contracts/RegistryTab";
import { QueryTab } from "@/components/contracts/QueryTab";

// Lazy-load the editor so the (large) bundled monaco only downloads when opened.
const EditorTab = lazy(() =>
  import("@/components/contracts/EditorTab").then((m) => ({ default: m.EditorTab }))
);

export default function ContractsPage() {
  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Browse the registry, query state with CIRRUS, and compile & deploy contracts."
      />
      <Tabs defaultValue="registry">
        <TabsList>
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="query">Query</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
        </TabsList>
        <TabsContent value="registry" className="mt-4">
          <RegistryTab />
        </TabsContent>
        <TabsContent value="query" className="mt-4">
          <QueryTab />
        </TabsContent>
        <TabsContent value="editor" className="mt-4">
          <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
            <EditorTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
