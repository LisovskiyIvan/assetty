import{b6 as e}from"./index-q74-en5_.js";import{helperFunctionsWGSL as a}from"./helperFunctions-nBhKMr3s.js";import{l as n,s as o}from"./shadowsFragmentFunctions-Doda9s9H.js";import{l as s}from"./lightsFragmentFunctions-BjIQogzZ.js";import{c as t,a as l}from"./clipPlaneFragment-_7o11nC8.js";import{logDepthDeclarationWGSL as m}from"./logDepthDeclaration-BM_ogoKS.js";import{fogFragmentDeclarationWGSL as d}from"./fogFragmentDeclaration-BQOYq0cQ.js";import{d as c}from"./depthPrePass-CmQcMwnO.js";import{lightFragmentWGSL as u}from"./lightFragment-C2P9FZXI.js";import{l as v}from"./logDepthFragment-BHqLS3sQ.js";import{f as S}from"./fogFragment-CzLboXnD.js";import{i as g}from"./imageProcessingCompatibility-DaIyVw0x.js";import"./clusteredLightingFunctions-BZXfsgo_.js";const f="simplePixelShader",r=`uniform vEyePosition: vec4f;uniform vDiffuseColor: vec4f;varying vPositionW: vec3f;
#ifdef NORMAL
varying vNormalW: vec3f;
#endif
#ifdef VERTEXCOLOR
varying vColor: vec4f;
#endif
#include<helperFunctions>
#include<lightUboDeclaration>[0..maxSimultaneousLights]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
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
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
baseColor=vec4f(baseColor.rgb*fragmentInputs.vColor.rgb,baseColor.a);
#endif
#ifdef NORMAL
var normalW: vec3f=normalize(fragmentInputs.vNormalW);
#else
var normalW: vec3f= vec3f(1.0,1.0,1.0);
#endif
var diffuseBase: vec3f= vec3f(0.,0.,0.);var info: lightingInfo;var shadow: f32=1.;var glossiness: f32=0.;var aggShadow: f32=0.;var numLights: f32=0.;
#ifdef SPECULARTERM
var specularBase: vec3f= vec3f(0.,0.,0.);
#endif
#include<lightFragment>[0..maxSimultaneousLights]
#if defined(VERTEXALPHA) || defined(INSTANCESCOLOR) && defined(INSTANCES)
alpha*=fragmentInputs.vColor.a;
#endif
var finalDiffuse: vec3f=clamp(diffuseBase*diffuseColor,vec3f(0.0),vec3f(1.0))*baseColor.rgb;var color: vec4f= vec4f(finalDiffuse,alpha);
#include<logDepthFragment>
#include<fogFragment>
fragmentOutputs.color=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
#endif
}
`;e.ShadersStoreWGSL[f]||(e.ShadersStoreWGSL[f]=r);const p=[a,n,s,o,t,m,d,l,c,u,v,S,g];for(const i of p)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const b={name:f,shader:r};export{b as simplePixelShaderWGSL};
