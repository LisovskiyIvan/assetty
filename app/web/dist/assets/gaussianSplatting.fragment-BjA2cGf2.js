import{S as e}from"./index-14bN2E_8.js";import{c as S,a as P}from"./clipPlaneFragment-FoY2Plxx.js";import{l as d}from"./logDepthDeclaration-b2L_k-XF.js";import{f as E,a as g}from"./fogFragment-vi7wtFJU.js";import{o as m}from"./objectIdFunctions-Blml9mya.js";import{p as _,l as s,m as A}from"./meshBlendTagFragmentOutput-CflHPAie.js";import{p as R}from"./packingFunctions-anhEfDtA.js";const o="gaussianSplattingFragmentDeclaration",n=`fn gaussianColor(inColor: vec4f,inPosition: vec2f)->vec4f
{var A : f32=-dot(inPosition,inPosition);if (A>-4.0)
{var B: f32=exp(A)*inColor.a;
#include<logDepthFragment>
var color: vec4f=vec4f(inColor.rgb,B);
#ifdef FOG
#include<fogFragment>
#endif
return color;} else {return vec4f(0.0);}}
`;e.IncludesShadersStoreWGSL[o]||(e.IncludesShadersStoreWGSL[o]=n);const l={name:o,shader:n},t="geometryRenderingFragment",a=`#ifdef PREPASS
#if SCENE_MRT_COUNT>0
let geometryCoverage=select(0.0,1.0,geometryColor.a>0.4);var fragData: array<vec4f,SCENE_MRT_COUNT>;
#ifdef PREPASS_COLOR
fragData[PREPASS_COLOR_INDEX]=geometryColor;
#endif
#ifdef PREPASS_POSITION
fragData[PREPASS_POSITION_INDEX]=vec4f(geometryPositionW,geometryCoverage);
#endif
#ifdef PREPASS_LOCAL_POSITION
fragData[PREPASS_LOCAL_POSITION_INDEX]=vec4f(geometryPositionL,geometryCoverage);
#endif
#ifdef PREPASS_DEPTH
fragData[PREPASS_DEPTH_INDEX]=vec4f(geometryViewDepth,0.0,0.0,geometryCoverage);
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
fragData[PREPASS_NORMALIZED_VIEW_DEPTH_INDEX]=vec4f(geometryNormalizedViewDepth,0.0,0.0,geometryCoverage);
#endif
#ifdef PREPASS_SCREENSPACE_DEPTH
fragData[PREPASS_SCREENSPACE_DEPTH_INDEX]=vec4f(fragmentInputs.position.z,0.0,0.0,geometryCoverage);
#endif
#ifdef PREPASS_NORMAL
fragData[PREPASS_NORMAL_INDEX]=vec4f(geometryNormalV,geometryCoverage);
#endif
#ifdef PREPASS_WORLD_NORMAL
fragData[PREPASS_WORLD_NORMAL_INDEX]=vec4f(geometryNormalW*0.5+0.5,geometryCoverage);
#endif
#ifdef PREPASS_ALBEDO
fragData[PREPASS_ALBEDO_INDEX]=vec4f(geometryAlbedo,geometryCoverage);
#endif
#ifdef PREPASS_ALBEDO_SQRT
fragData[PREPASS_ALBEDO_SQRT_INDEX]=vec4f(sqrt(max(geometryAlbedo,vec3f(0.0))),geometryCoverage);
#endif
#ifdef PREPASS_REFLECTIVITY
fragData[PREPASS_REFLECTIVITY_INDEX]=vec4f(0.0,0.0,0.0,geometryCoverage);
#endif
#ifdef PREPASS_IRRADIANCE
fragData[PREPASS_IRRADIANCE_INDEX]=vec4f(0.0,0.0,0.0,geometryCoverage);
#endif
#ifdef PREPASS_IRRADIANCE_LEGACY
fragData[PREPASS_IRRADIANCE_LEGACY_INDEX]=vec4f(0.0);
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
#ifdef PREPASS_VELOCITY_ZERO
let geometryMotion=vec2f(0.0);
#else
let geometryMotion=0.5*(geometryCurrentPosition.xy/geometryCurrentPosition.w-geometryPreviousPosition.xy/geometryPreviousPosition.w);
#endif
#ifdef PREPASS_VELOCITY
fragData[PREPASS_VELOCITY_INDEX]=vec4f(pow(abs(geometryMotion),vec2f(1.0/3.0))*sign(geometryMotion)*0.5+0.5,0.0,geometryCoverage);
#endif
#ifdef PREPASS_VELOCITY_LINEAR
fragData[PREPASS_VELOCITY_LINEAR_INDEX]=vec4f(-geometryMotion,0.0,geometryCoverage);
#endif
#endif
#ifdef PREPASS_OBJECT_ID
fragData[PREPASS_OBJECT_ID_INDEX]=encodeObjectId(uniforms.objectId)*geometryCoverage;
#endif
#ifdef PREPASS_MESH_BLEND_TAG
var meshBlendTagOutput: vec4<u32>=vec4u(0u);if (geometryCoverage>0.0) {meshBlendTagOutput=vec4u(u32(uniforms.meshBlendTag),0u,0u,0u);}
#endif
#include<meshBlendTagFragmentOutput>[0..8]
#endif
#endif
`;e.IncludesShadersStoreWGSL[t]||(e.IncludesShadersStoreWGSL[t]=a);const c={name:t,shader:a},r="gaussianSplattingPixelShader",f=`#include<clipPlaneFragmentDeclaration>
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#define PREPASS_CUSTOM_VARYINGS
#include<prePassDeclaration>[SCENE_MRT_COUNT]
#ifdef GPUPICKER_PACK_DEPTH
#include<packingFunctions>
#endif
varying vColor: vec4f;varying vPosition: vec2f;
#ifdef PREPASS
uniform geometryZeroAlphaDiscard: f32;
#ifdef PREPASS_POSITION
varying vGeometryPositionW: vec3f;
#endif
#ifdef PREPASS_LOCAL_POSITION
varying vGeometryPositionL: vec3f;
#endif
#ifdef PREPASS_DEPTH
varying vGeometryViewDepth: f32;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
varying vGeometryNormalizedViewDepth: f32;
#endif
#ifdef PREPASS_NORMAL
varying vGeometryNormalV: vec3f;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vGeometryNormalW: vec3f;
#endif
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
varying vGeometryAlbedo: vec3f;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
varying vGeometryCurrentPosition: vec4f;varying vGeometryPreviousPosition: vec4f;
#endif
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
#include<gaussianSplattingFragmentDeclaration>
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var finalColor: vec4f=gaussianColor(input.vColor,input.vPosition);
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
#ifdef PREPASS
if (finalColor.a<=0.0 && uniforms.geometryZeroAlphaDiscard>0.0) {discard;}
let geometryColor=finalColor;
#if defined(PREPASS_ALBEDO) || defined(PREPASS_ALBEDO_SQRT)
let geometryAlbedo=input.vGeometryAlbedo;
#endif
#ifdef PREPASS_POSITION
let geometryPositionW=input.vGeometryPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
let geometryPositionL=input.vGeometryPositionL;
#endif
#ifdef PREPASS_DEPTH
let geometryViewDepth=input.vGeometryViewDepth;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
let geometryNormalizedViewDepth=input.vGeometryNormalizedViewDepth;
#endif
#ifdef PREPASS_NORMAL
let geometryNormalV=input.vGeometryNormalV;
#endif
#ifdef PREPASS_WORLD_NORMAL
let geometryNormalW=input.vGeometryNormalW;
#endif
#if defined(PREPASS_VELOCITY) || defined(PREPASS_VELOCITY_LINEAR)
let geometryCurrentPosition=input.vGeometryCurrentPosition;let geometryPreviousPosition=input.vGeometryPreviousPosition;
#endif
#include<geometryRenderingFragment>
#elif defined(GPUPICKER_DEPTH)
fragmentOutputs.fragData0=finalColor;
#ifdef GPUPICKER_PACK_DEPTH
fragmentOutputs.fragData1=pack(fragmentInputs.position.z);
#else
fragmentOutputs.fragData1=vec4f(fragmentInputs.position.z,0.0,0.0,1.0);
#endif
#else
fragmentOutputs.color=finalColor;
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=f);const D=[S,d,E,m,_,R,s,g,l,P,A,c];for(const i of D)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const N={name:r,shader:f};export{N as gaussianSplattingPixelShaderWGSL};
