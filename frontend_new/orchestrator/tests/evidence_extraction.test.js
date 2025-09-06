// Evidence Extraction Tests (Phase 2 completion)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractEvidence } from '../goose_adapter.js';

describe('Evidence Extraction', () => {
  it('should extract file paths from text', () => {
    const text = 'Modified src/app.js and created test.py, also updated package.json';
    const evidence = extractEvidence(text);
    
    assert(evidence.files.includes('src/app.js'));
    assert(evidence.files.includes('test.py'));
    assert(evidence.files.includes('package.json'));
  });

  it('should extract commands from backticks', () => {
    const text = 'Ran `npm install` and `python test.py` commands successfully';
    const evidence = extractEvidence(text);
    
    assert(evidence.commands.includes('npm install'));
    assert(evidence.commands.includes('python test.py'));
  });

  it('should extract outputs with result indicators', () => {
    const text = 'Output: Installation successful\nResult: 42 tests passed\nStatus: All green';
    const evidence = extractEvidence(text);
    
    assert(evidence.outputs.length > 0);
    assert(evidence.outputs.some(out => out.includes('Installation successful')));
  });

  it('should generate summary from extracted evidence', () => {
    const text = 'Created main.js file, ran npm test command, got 10 passing tests result';
    const evidence = extractEvidence(text);
    
    assert(evidence.summary);
    assert(evidence.summary.length > 0);
  });

  it('should handle empty or invalid input', () => {
    assert.deepStrictEqual(extractEvidence(''), { files: [], commands: [], outputs: [], summary: '', score: 0 });
    assert.deepStrictEqual(extractEvidence(null), { files: [], commands: [], outputs: [], summary: '', score: 0 });
    assert.deepStrictEqual(extractEvidence(undefined), { files: [], commands: [], outputs: [], summary: '', score: 0 });
  });

  it('should limit file extraction to reasonable count', () => {
    const manyFiles = Array.from({length: 20}, (_, i) => `file${i}.js`).join(' ');
    const evidence = extractEvidence(manyFiles);
    
    assert(evidence.files.length <= 8);
  });

  it('should extract weighted evidence types', () => {
    const text = `
      RESULTS: Created 3 files successfully
      COMMANDS: npm install, git commit
      FILES: src/index.js, package.json
      ERROR: No errors found
    `;
    
    const evidence = extractEvidence(text);
    
    // Should prioritize structured evidence markers
    assert(evidence.files.length > 0);
    assert(evidence.commands.length > 0);
    assert(evidence.outputs.length > 0);
  });
});
