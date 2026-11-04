import{b6 as e}from"./index-CramQklb.js";import{helperFunctionsWGSL as n}from"./helperFunctions-B2c4Qgho.js";import{l as i,s as l}from"./shadowsFragmentFunctions-C_Ix5ytv.js";import{logDepthDeclarationWGSL as o}from"./logDepthDeclaration-C3ytzt4y.js";import{l as t}from"./lightsFragmentFunctions-nLso1GZX.js";import{c as m,a as s}from"./clipPlaneFragment-CKcNptCO.js";import{fogFragmentDeclarationWGSL as d}from"./fogFragmentDeclaration-Wh41R8Dx.js";import{d as S}from"./depthPrePass-D5rFlsxE.js";import{lightFragmentWGSL as p}from"./lightFragment-NvbHepeV.js";import{l as u}from"./logDepthFragment-BGVt6kHS.js";import{f as c}from"./fogFragment-CCom-7_S.js";import{i as v}from"./imageProcessingCompatibility-DIhZxqw4.js";import"./clusteredLightingFunctions-DARvPCtZ.js";const r="triplanarPixelShader",f=`uniform vEyePosition: vec4f;uniform vDiffuseColor: vec4f;
#ifdef SPECULARTERM
uniform vSpecularColor: vec4f;
#endif
varying vPositionW: vec3f;
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vColor: vec4f;
#endif
#include<helperFunctions>
#include<lightUboDeclaration>[0..maxSimultaneousLights]
#ifdef DIFFUSEX
varying vTextureUVX: vec2f;var diffuseSamplerXSampler: sampler;var diffuseSamplerX: texture_2d<f32>;
#ifdef BUMPX
var normalSamplerXSampler: sampler;var normalSamplerX: texture_2d<f32>;
#endif
#endif
#ifdef DIFFUSEY
varying vTextureUVY: vec2f;var diffuseSamplerYSampler: sampler;var diffuseSamplerY: texture_2d<f32>;
#ifdef BUMPY
var normalSamplerYSampler: sampler;var normalSamplerY: texture_2d<f32>;
#endif
#endif
#ifdef DIFFUSEZ
varying vTextureUVZ: vec2f;var diffuseSamplerZSampler: sampler;var diffuseSamplerZ: texture_2d<f32>;
#ifdef BUMPZ
var normalSamplerZSampler: sampler;var normalSamplerZ: texture_2d<f32>;
#endif
#endif
#ifdef NORMAL
varying tangentSpace0: vec3f;varying tangentSpace1: vec3f;varying tangentSpace2: vec3f;
#endif
#include<logDepthDeclaration>
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#include<clipPlaneFragmentDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying vViewDepth: f32;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var viewDirectionW: vec3f=normalize(uniforms.vEyePosition.xyz-fragmentInputs.vPositionW);var baseColor: vec4f= vec4f(0.,0.,0.,1.);var diffuseColor: vec3f=uniforms.vDiffuseColor.rgb;var alpha: f32=uniforms.vDiffuseColor.a;
#ifdef NORMAL
var normalW: vec3f=fragmentInputs.tangentSpace2;
#else
var normalW: vec3f= vec3f(1.0,1.0,1.0);
#endif
var baseNormal: vec4f= vec4f(0.0,0.0,0.0,1.0);normalW=normalW*normalW;
#ifdef DIFFUSEX
baseColor=baseColor+textureSample(diffuseSamplerX,diffuseSamplerXSampler,fragmentInputs.vTextureUVX)*normalW.x;
#ifdef BUMPX
baseNormal=baseNormal+textureSample(normalSamplerX,normalSamplerXSampler,fragmentInputs.vTextureUVX)*normalW.x;
#endif
#endif
#ifdef DIFFUSEY
baseColor=baseColor+textureSample(diffuseSamplerY,diffuseSamplerYSampler,fragmentInputs.vTextureUVY)*normalW.y;
#ifdef BUMPY
baseNormal=baseNormal+textureSample(normalSamplerY,normalSamplerYSampler,fragmentInputs.vTextureUVY)*normalW.y;
#endif
#endif
#ifdef DIFFUSEZ
baseColor=baseColor+textureSample(diffuseSamplerZ,diffuseSamplerZSampler,fragmentInputs.vTextureUVZ)*normalW.z;
#ifdef BUMPZ
baseNormal=baseNormal+textureSample(normalSamplerZ,normalSamplerZSampler,fragmentInputs.vTextureUVZ)*normalW.z;
#endif
#endif
#ifdef NORMAL
var tangentSpace: mat3x3f=mat3x3f(fragmentInputs.tangentSpace0,fragmentInputs.tangentSpace1,fragmentInputs.tangentSpace2);normalW=normalize((2.0*baseNormal.xyz-1.0)*tangentSpace);
#endif
#ifdef ALPHATEST
if (baseColor.a<0.4) {discard;}
#endif
#define DEPTHPREPASS_SKIP_EARLY_RETURN
#include<depthPrePass>
#ifndef DEPTHPREPASS
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
baseColor=vec4f(baseColor.rgb*fragmentInputs.vColor.rgb,baseColor.a);
#endif
var diffuseBase: vec3f= vec3f(0.,0.,0.);var info: lightingInfo;var shadow: f32=1.;var aggShadow: f32=0.;var numLights: f32=0.;
#ifdef SPECULARTERM
var glossiness: f32=uniforms.vSpecularColor.a;var specularBase: vec3f= vec3f(0.,0.,0.);var specularColor: vec3f=uniforms.vSpecularColor.rgb;
#else
var glossiness: f32=0.;
#endif
#include<lightFragment>[0..maxSimultaneousLights]
#if defined(VERTEXALPHA) || defined(INSTANCESCOLOR) && defined(INSTANCES)
alpha*=fragmentInputs.vColor.a;
#endif
#ifdef SPECULARTERM
var finalSpecular: vec3f=specularBase*specularColor;
#else
var finalSpecular: vec3f= vec3f(0.0);
#endif
var finalDiffuse: vec3f=clamp(diffuseBase*diffuseColor,vec3f(0.0),vec3f(1.0))*baseColor.rgb;var color: vec4f= vec4f(finalDiffuse+finalSpecular,alpha);
#include<logDepthFragment>
#include<fogFragment>
fragmentOutputs.color=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
#endif
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=f);const g=[n,i,o,t,l,m,d,s,S,p,u,c,v];for(const a of g)e.IncludesShadersStoreWGSL[a.name]||(e.IncludesShadersStoreWGSL[a.name]=a.shader);const D={name:r,shader:f};export{D as triplanarPixelShaderWGSL};
