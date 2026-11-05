import{b6 as e}from"./index-ymQalFtf.js";import{packingFunctionsWGSL as f}from"./packingFunctions-DpnUDZB7.js";const i="pickingPixelShader",t=`#if defined(INSTANCES)
flat varying vMeshID: f32;
#else
uniform meshID: f32;
#endif
#ifdef GPUPICKER_PACK_DEPTH
#include<packingFunctions>
#endif
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var id: i32;
#if defined(INSTANCES)
id=i32(input.vMeshID);
#else
id=i32(uniforms.meshID);
#endif
var color=vec3f(
f32((id>>16) & 0xFF),
f32((id>>8) & 0xFF),
f32(id & 0xFF),
)/255.0;
#ifdef GPUPICKER_DEPTH
fragmentOutputs.fragData0=vec4f(color,1.0);
#ifdef GPUPICKER_PACK_DEPTH
fragmentOutputs.fragData1=pack(fragmentInputs.position.z);
#else
fragmentOutputs.fragData1=vec4f(fragmentInputs.position.z,0.0,0.0,1.0);
#endif
#else
fragmentOutputs.color=vec4f(color,1.0);
#endif
}
`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=t);const r=[f];for(const n of r)e.IncludesShadersStoreWGSL[n.name]||(e.IncludesShadersStoreWGSL[n.name]=n.shader);const o={name:i,shader:t};export{o as pickingPixelShaderWGSL};
