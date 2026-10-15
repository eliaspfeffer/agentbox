// A failed process can already have produced output; an unknown cause cannot prove no work happened.
import {it,expect} from 'vitest';import{deadRunSentence,deadRunCause}from'../shared/spawn-trouble.mjs';
it('reports only the known interruption and preserves recovery for older reports',()=>{
 const line=deadRunSentence({cause:'unknown'});expect(line).toContain('stopped unexpectedly before this run finished.');expect(line).not.toMatch(/did anything|not been started|will keep failing/);expect(deadRunCause(line)).toBe('unknown');
 expect(deadRunCause('Codex stopped before it did anything, so this task has not been started.')).toBe('unknown');
 expect(deadRunCause('The analysis is complete.')).toBe(null);
});
