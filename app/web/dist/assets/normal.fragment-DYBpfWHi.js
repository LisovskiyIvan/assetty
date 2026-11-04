import{b6 as e}from"./index-CramQklb.js";import{helperFunctionsWGSL as f}from"./helperFunctions-B2c4Qgho.js";import{l as n,s as o}from"./shadowsFragmentFunctions-C_Ix5ytv.js";import{l as t}from"./lightsFragmentFunctions-nLso1GZX.js";import{c as l,a as s}from"./clipPlaneFragment-CKcNptCO.js";import{logDepthDeclarationWGSL as m}from"./logDepthDeclaration-C3ytzt4y.js";import{fogFragmentDeclarationWGSL as c}from"./fogFragmentDeclaration-Wh41R8Dx.js";import{d}from"./depthPrePass-D5rFlsxE.js";import{lightFragmentWGSL as u}from"./lightFragment-NvbHepeV.js";import{l as g}from"./logDepthFragment-BGVt6kHS.js";import{f as v}from"./fogFragment-CCom-7_S.js";import{i as S}from"./imageProcessingCompatibility-DIhZxqw4.js";import"./clusteredLightingFunctions-DARvPCtZ.js";const r="normalPixelShader",a=`uniform vEyePosition: vec4f;uniform vDiffuseColor: vec4f;varying vPositionW: vec3f;
#ifdef NORMAL
varying vNormalW: vec3f;
#endif
#ifdef LIGHTING
#include<helperFunctions>
#include<lightUboDeclaration>[0]
#include<lightUboDeclaration>[1]
#include<lightUboDeclaration>[2]
#include<lightUboDeclaration>[3]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#endif
#ifdef DIFFUSE
varying vDiffuseUV: vec2f;var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;uniform vDiffuseInfos: vec2f;
#endif
#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying vViewDepth: f32;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var viewDirectionW: vec3f=normalize(uniforms.vEyePosition.xyz-fragmentInputs.vPositionW);var baseColor: vec4f= vec4f(1.,1.,1.,1.);var diffuseColor: vec3f=uniforms.vDiffuseColor.rgb;var alpha: f32=uniforms.vDiffuseColor.a;
#ifdef DIFFUSE
baseColor=textureSample(diffuseSampler,diffuseSamplerSampler,fragmentInputs.vDiffuseUV);
#ifdef ALPHATEST
if (baseColor.a<0.4) {discard;}
#endif
#define DEPTHPREPASS_SKIP_EARLY_RETURN
#include<depthPrePass>
#ifndef DEPTHPREPASS
baseColor=vec4f(baseColor.rgb*uniforms.vDiffuseInfos.y,baseColor.a);
#endif
#endif
#ifndef DEPTHPREPASS
#ifdef NORMAL
baseColor=mix(baseColor, vec4f(fragmentInputs.vNormalW,1.0),0.5);
#endif
#ifdef NORMAL
var normalW: vec3f=normalize(fragmentInputs.vNormalW);
#else
var normalW: vec3f= vec3f(1.0,1.0,1.0);
#endif
#ifdef LIGHTING
var diffuseBase: vec3f= vec3f(0.,0.,0.);var info: lightingInfo;var shadow: f32=1.;var glossiness: f32=0.;var aggShadow: f32=0.;var numLights: f32=0.;
#include<lightFragment>[0]
#include<lightFragment>[1]
#include<lightFragment>[2]
#include<lightFragment>[3]
var finalDiffuse: vec3f=clamp(diffuseBase*diffuseColor,vec3f(0.0),vec3f(1.0))*baseColor.rgb;
#else
var finalDiffuse: vec3f= baseColor.rgb;
#endif
var color: vec4f= vec4f(finalDiffuse,alpha);
#include<logDepthFragment>
#include<fogFragment>
fragmentOutputs.color=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
#endif
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=a);const p=[f,n,t,o,l,m,c,s,d,u,g,v,S];for(const i of p)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const A={name:r,shader:a};export{A as normalPixelShaderWGSL};
