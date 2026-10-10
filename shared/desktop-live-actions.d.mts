export type DesktopLiveAction = {action: string; id?: string; product?: string; text?: string};
export function desktopLiveActions(callbacks: {state:()=>{current:any;rows:any[]};open:(item:any)=>void;details:(item:any)=>Promise<any>;done:(item:any)=>Promise<void>;reply:(item:any,text:string)=>Promise<void>;later:(item:any,minutes:number)=>Promise<void>}): (action:DesktopLiveAction)=>Promise<any>;
