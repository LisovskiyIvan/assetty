import{b6 as e}from"./index-BwCexCOg.js";import{helperFunctionsWGSL as t}from"./helperFunctions-Do_1C32K.js";import{i as a,h as o}from"./hdrFilteringFunctions-CNu2u--L.js";import{p as c}from"./pbrBRDFFunctions-2_eI-izG.js";const i="hdrIrradianceFilteringPixelShader",n=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
var inputTextureSampler: sampler;var inputTexture: texture_cube<f32>;
#ifdef IBL_CDF_FILTERING
var icdfTextureSampler: sampler;var icdfTexture: texture_2d<f32>;
#endif
uniform vFilteringInfo: vec2f;uniform hdrScale: f32;varying direction: vec3f;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var color: vec3f=irradiance(inputTexture,inputTextureSampler,input.direction,uniforms.vFilteringInfo,0.0,vec3f(1.0),input.direction
#ifdef IBL_CDF_FILTERING
,icdfTexture,icdfTextureSampler
#endif
);fragmentOutputs.color= vec4f(color*uniforms.hdrScale,1.0);}`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=n);const u=[t,a,c,o];for(const r of u)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const m={name:i,shader:n};export{m as hdrIrradianceFilteringPixelShaderWGSL};
