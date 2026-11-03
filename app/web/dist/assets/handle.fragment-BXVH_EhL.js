import{b6 as r}from"./index-CR91ZdlI.js";const e="handlePixelShader",t=`uniform color: vec3f;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {fragmentOutputs.color=vec4f(uniforms.color,1.0);}
`;r.ShadersStoreWGSL[e]||(r.ShadersStoreWGSL[e]=t);const n={name:e,shader:t};export{n as handlePixelShaderWGSL};
