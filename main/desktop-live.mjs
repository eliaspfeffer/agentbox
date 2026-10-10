import fs from 'node:fs';
import http from 'node:http';
export async function desktopLiveSession(config,sdp){
 if(!config)throw Error('The existing mobile Live service must be configured for desktop calls.');
 const endpoint=new URL(config.url);
 if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('Desktop Live requires a loopback service.');
 if(typeof sdp!=='string'||!sdp.startsWith('v=')||sdp.length>100000)throw Error('Invalid SDP.');
 const {session}=JSON.parse(fs.readFileSync(config.accessFile,'utf8'));
 if(typeof session!=='string'||!session)throw Error('Live service credentials are unavailable.');
 const origin=new URL(config.origin).origin;
 const result=await new Promise((resolve,reject)=>{
  const request=http.request(new URL('/api/live-session',endpoint),{method:'POST',headers:{Host:new URL(origin).host,Origin:origin,Cookie:`agentbox_session=${session}`,'Content-Type':'application/json'}},response=>{
   let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk});response.on('error',reject);response.on('end',()=>{if(response.statusCode!==201&&response.statusCode!==200)return reject(Error(`Live service refused the connection (${response.statusCode}).`));try{resolve(JSON.parse(body))}catch(error){reject(error)}});
  });
  request.setTimeout(30000,()=>request.destroy(Error('Live service timed out.')));request.on('error',reject);request.end(JSON.stringify({sdp,desktop:true}));
 });
 if(typeof result.transport?.sdp!=='string')throw Error('Live service returned no SDP answer.');
 return {transport:{sdp:result.transport.sdp}};
}
