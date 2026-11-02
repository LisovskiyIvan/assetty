import{b6 as e}from"./index-BMPeYDq-.js";import{helperFunctionsWGSL as a}from"./helperFunctions-BFARXcBF.js";import{i as n,h as c}from"./hdrFilteringFunctions-DgjBov8l.js";import{p as S}from"./pbrBRDFFunctions-Cm8ctEox.js";const i="iblDominantDirectionPixelShader",t=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
var icdfSamplerSampler: sampler;var icdfSampler: texture_2d<f32>;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var lightDir: vec3f=vec3f(0.0,0.0,0.0);for(var i: u32=0u; i<NUM_SAMPLES; i++)
{var Xi: vec2f=hammersley(i,NUM_SAMPLES);var T: vec2f;T.x=textureSampleLevel(icdfSampler,icdfSamplerSampler,vec2(Xi.x,0.0),0.0).x;T.y=textureSampleLevel(icdfSampler,icdfSamplerSampler,vec2(T.x,Xi.y),0.0).y;var Ls: vec3f=uv_to_normal(vec2f(1.0-fract(T.x+0.25),T.y));lightDir+=Ls;}
lightDir/=vec3f(f32(NUM_SAMPLES));fragmentOutputs.color=vec4f(lightDir,1.0);}`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=t);const l=[a,n,S,c];for(const r of l)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const f={name:i,shader:t};export{f as iblDominantDirectionPixelShaderWGSL};
