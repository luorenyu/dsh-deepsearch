#!/usr/bin/env node
// Documentation illustration only; not plugin-integration evidence.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const session='deepsearch-unread-card-'+process.pid;
const env={...process.env};
for(const key of Object.keys(env))if(key.startsWith('AGENT_BROWSER_'))delete env[key];
async function browser(...args){return exec('agent-browser',['--session',session,...args],{env,timeout:45000});}
try{
 await browser('set','viewport','1180','960');
 await browser('open',pathToFileURL(path.join(root,'scripts/demo/unread-card.html')).href);
 await browser('wait','--fn','document.querySelector("iframe").contentDocument?.querySelectorAll(".menuitem").length===7');
 await browser('screenshot',process.argv[2]||path.join(root,'docs/images/08-unread-menu.png'));
 console.log('Rendered consistent feature card with approved fictional sidebar illustration.');
}finally{await browser('close');}
