import { evaluateResolutionBenchmark, formatResolutionBenchmark } from "./benchmark";

const report = evaluateResolutionBenchmark();
console.log(formatResolutionBenchmark(report));
if (report.failures.length > 0) process.exitCode = 1;
