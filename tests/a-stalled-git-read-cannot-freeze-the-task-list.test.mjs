// Two bounded Git reads can exceed 3.5s under full-suite load; an unbounded read must still fail.
import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {listTaskFolders} from '../main/task-folders.mjs';
it('times out an unreadable worktree registry without deleting any folders',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'git-list-timeout-')),bin=path.join(dir,'bin');
 fs.mkdirSync(bin);const fake=path.join(bin,'git');
 fs.writeFileSync(fake,'#!/bin/sh\nif [ "$1" = rev-parse ]; then pwd; else exec sleep 10; fi\n');fs.chmodSync(fake,0o755);
 const before=process.env.PATH;process.env.PATH=bin+path.delimiter+before;
 try{const at=Date.now();expect(listTaskFolders(dir)).toEqual([]);expect(Date.now()-at).toBeLessThan(6000);expect(fs.existsSync(dir)).toBe(true)}
 finally{process.env.PATH=before;fs.rmSync(dir,{recursive:true,force:true})}
},15000);
