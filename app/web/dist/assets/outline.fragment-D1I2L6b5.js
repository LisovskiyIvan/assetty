import{b6 as e}from"./index-Z4a9ijJv.js";import{c as t,a as i}from"./clipPlaneFragment-C8zUk9_o.js";import{logDepthDeclarationWGSL as l}from"./logDepthDeclaration-B2tdtDnL.js";import{l as o}from"./logDepthFragment-zcNgBtwr.js";const a="outlinePixelShader",n=`uniform color: vec4f;
#ifdef ALPHATEST
varying vUV: vec2f;var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;
#endif
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
#ifdef ALPHATEST
if (textureSample(diffuseSampler,diffuseSamplerSampler,fragmentInputs.vUV).a<0.4) {discard;}
#endif
#include<logDepthFragment>
fragmentOutputs.color=uniforms.color;
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStoreWGSL[a]||(e.ShadersStoreWGSL[a]=n);const f=[t,l,i,o];for(const r of f)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const c={name:a,shader:n};export{c as outlinePixelShaderWGSL};
