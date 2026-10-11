import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { before, describe, it } from 'mocha';

// Preserve the original fixtures, assertions and expectations. Each child runs
// the ported source through the repository's tsx loader, never a source stub.
const directory = path.resolve('tests/evidence/optionA');
const suites = [
  ['NORMAL integration', 'integration-runner.mjs', 47],
  ['Evidence Binding E', 'r36-runner.mjs', 16],
  ['Evidence Binding X', 'r36-fix-runner.mjs', 6],
  ['Evidence Binding Y', 'r36-residual-runner.mjs', 7],
  ['Shared counter', 'r33/runner.mjs', 12],
] as const;

for (const [title, filename, count] of suites) {
  describe(`Option A / ${title}`, function () {
    this.timeout(60000);
    let report: { total: number; passed: number; results: any[] };
    before(function () {
      const result = spawnSync(process.execPath,
        ['--import=tsx', path.join(directory, filename)],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr + result.stdout);
      report = JSON.parse(result.stdout);
      if (process.env.OPTIONA_EVIDENCE_DIR) {
        mkdirSync(process.env.OPTIONA_EVIDENCE_DIR, { recursive: true });
        writeFileSync(path.join(process.env.OPTIONA_EVIDENCE_DIR,
          filename.replaceAll('/', '-').replace('.mjs', '.json')), result.stdout);
      }
      assert.equal(report.total, count);
      assert.equal(report.passed, count);
      assert.equal(report.results.length, count);
    });
    for (let index = 0; index < count; index++) {
      it(`preserved case ${index + 1}`, function () {
        assert.equal(report.results[index].pass, true, JSON.stringify(report.results[index]));
      });
    }
  });
}
