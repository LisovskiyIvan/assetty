import{fc as a,al as u}from"./index-Ctl_JKww.js";let d=0;async function f(i,r){return await new Promise((l,n)=>{let e,o;if(a())e=window,o="window";else if(typeof self<"u")e=self,o="self";else{n(new Error("Cannot load script module outside of a window or a worker"));return}e._LoadScriptModuleResolve||(e._LoadScriptModuleResolve={}),e._LoadScriptModuleResolve[d]=l,i+=`
            ${o}._LoadScriptModuleResolve[${d}](returnedValue);
            ${o}._LoadScriptModuleResolve[${d}] = undefined;
        `,d++,u.LoadScript(i,void 0,(t,s)=>{n(s||new Error(t))},r,!0)})}export{f as _};
