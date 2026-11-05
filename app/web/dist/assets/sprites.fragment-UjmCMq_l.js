import{b6 as e}from"./index-D8wS8RSU.js";import{objectIdFunctionsWGSL as f}from"./objectIdFunctions-dbMeF7sM.js";import{p as t,m as n}from"./meshBlendTagFragmentOutput-MDhbXnDS.js";import{fogFragmentDeclarationWGSL as a}from"./fogFragmentDeclaration-BjS4akDj.js";import{logDepthDeclarationWGSL as m}from"./logDepthDeclaration-Ds4heduC.js";import{helperFunctionsWGSL as s}from"./helperFunctions-ZSYtf9zz.js";import{l as d}from"./logDepthFragment-BSEwO1BF.js";import{f as v}from"./fogFragment-DHtvXKb-.js";import{i as S}from"./imageProcessingCompatibility-z84I4PQK.js";import{g as l}from"./geometryRenderingFragment-D5IUuVoW.js";const i="spritesPixelShader",o=`uniform alphaTest: i32;
#include<prePassDeclaration>[SCENE_MRT_COUNT]
varying vColor: vec4f;
#ifdef PREPASS
uniform geometryZeroAlphaDiscard: f32;
#ifdef PREPASS_POSITION
varying vPositionW: vec3f;
#endif
#ifdef PREPASS_NORMAL
varying vNormalV: vec3f;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vNormalW: vec3f;
#endif
#endif
varying vUV: vec2f;var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;
#include<fogFragmentDeclaration>
#include<logDepthDeclaration>
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
#ifdef PIXEL_PERFECT
fn uvPixelPerfect(uv: vec2f)->vec2f {var res: vec2f= vec2f(textureDimensions(diffuseSampler,0));var uvTemp=uv*res;var seam: vec2f=floor(uvTemp+0.5);uvTemp=seam+clamp((uvTemp-seam)/fwidth(uvTemp),vec2f(-0.5),vec2f(0.5));return uvTemp/res;}
#endif
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#ifdef PIXEL_PERFECT
var uv: vec2f=uvPixelPerfect(input.vUV);
#else
var uv: vec2f=input.vUV;
#endif
var color: vec4f=textureSample(diffuseSampler,diffuseSamplerSampler,uv);var fAlphaTest: f32= f32(uniforms.alphaTest);if (fAlphaTest != 0.)
{if (color.a<0.95) {discard;}}
color*=input.vColor;
#ifdef PREPASS
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
var geometryAlbedo: vec3f=toLinearSpaceVec3(color.rgb);
#endif
if (fAlphaTest==0.0 && color.a==0.0 && uniforms.geometryZeroAlphaDiscard>0.0) {discard;}
#endif
#include<logDepthFragment>
#include<fogFragment>
#ifdef PREPASS
#include<imageProcessingCompatibility>(fragmentOutputs.color,color)
var geometryColor: vec4f=color;
#ifdef PREPASS_POSITION
var geometryPositionW: vec3f=input.vPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
var geometryPositionL: vec3f=input.vPosition;
#endif
#ifdef PREPASS_DEPTH
var geometryViewDepth: f32=input.vViewPos.z;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
var geometryNormalizedViewDepth: f32=input.vNormViewDepth;
#endif
#ifdef PREPASS_NORMAL
var geometryNormalV: vec3f=input.vNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
var geometryNormalW: vec3f=input.vNormalW;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
var geometryCurrentPosition: vec4f=input.vCurrentPosition;var geometryPreviousPosition: vec4f=input.vPreviousPosition;
#endif
#include<geometryRenderingFragment>
#else
fragmentOutputs.color=color;
#include<imageProcessingCompatibility>
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=o);const c=[f,t,a,m,s,d,v,S,n,l];for(const r of c)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const N={name:i,shader:o};export{N as spritesPixelShaderWGSL};
