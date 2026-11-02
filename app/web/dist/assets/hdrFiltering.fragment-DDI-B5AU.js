import{b6 as r}from"./index-BncxKkTR.js";import{helperFunctionsWGSL as t}from"./helperFunctions-FP842bzu.js";import{i as o,h as a}from"./hdrFilteringFunctions-DK4SomqI.js";import{p as u}from"./pbrBRDFFunctions-D2YhHANM.js";const n="hdrFilteringPixelShader",i=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
uniform alphaG: f32;var inputTextureSampler: sampler;var inputTexture: texture_cube<f32>;uniform vFilteringInfo: vec2f;uniform hdrScale: f32;varying direction: vec3f;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var color: vec3f=radiance(uniforms.alphaG,inputTexture,inputTextureSampler,input.direction,uniforms.vFilteringInfo);fragmentOutputs.color= vec4f(color*uniforms.hdrScale,1.0);}`;r.ShadersStoreWGSL[n]||(r.ShadersStoreWGSL[n]=i);const c=[t,o,u,a];for(const e of c)r.IncludesShadersStoreWGSL[e.name]||(r.IncludesShadersStoreWGSL[e.name]=e.shader);const S={name:n,shader:i};export{S as hdrFilteringPixelShaderWGSL};
