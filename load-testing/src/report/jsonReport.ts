import * as fs from "fs";
import * as path from "path";
import { LoadTestReport } from "../types";

export function writeJsonReport(report: LoadTestReport, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `report-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), "utf8");
  console.log(`JSON report written to: ${filepath}`);
  return filepath;
}
