import{b6 as e}from"./index-CgKvOhs2.js";import{objectIdFunctionsWGSL as i}from"./objectIdFunctions-BtKT1-bw.js";import{p as n,m as t}from"./meshBlendTagFragmentOutput-CZvJ6xO4.js";import{c as l,a as f}from"./clipPlaneFragment-B81PoMGm.js";import{i as m,a as s}from"./imageProcessingFunctions-C12NXT4J.js";import{logDepthDeclarationWGSL as p}from"./logDepthDeclaration-BlrVtrmE.js";import{helperFunctionsWGSL as S}from"./helperFunctions-DqFI9Azi.js";import{fogFragmentDeclarationWGSL as c}from"./fogFragmentDeclaration-E-xKICur.js";import{l as d}from"./logDepthFragment-BmD_lqfL.js";import{f as g}from"./fogFragment-IcTz2xB9.js";import{g as u}from"./geometryRenderingFragment-DmKGVLAU.js";const a="particlesPixelShader",o=`varying vUV: vec2f;varying vColor: vec4f;uniform textureMask: vec4f;var diffuseSamplerSampler: sampler;var diffuseSampler: texture_2d<f32>;
#ifdef PREPASS
uniform geometryZeroAlphaDiscard: f32;
#ifdef PREPASS_POSITION
varying vGeometryPositionW: vec3f;
#endif
#ifdef PREPASS_WORLD_NORMAL
varying vGeometryNormalW: vec3f;
#endif
#ifdef PREPASS_NORMAL
varying vGeometryNormalV: vec3f;
#endif
#endif
#define PREPASS_VELOCITY_ZERO
#include<prePassDeclaration>[SCENE_MRT_COUNT]
#include<clipPlaneFragmentDeclaration>
#include<imageProcessingDeclaration>
#include<logDepthDeclaration>
#include<helperFunctions>
#include<imageProcessingFunctions>
#ifdef RAMPGRADIENT
varying remapRanges: vec4f;var rampSamplerSampler: sampler;var rampSampler: texture_2d<f32>;
#endif
#include<fogFragmentDeclaration>
#define CUSTOM_FRAGMENT_DEFINITIONS
@fragment
fn main(input: FragmentInputs)->FragmentOutputs {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
var textureColor: vec4f=textureSample(diffuseSampler,diffuseSamplerSampler,input.vUV);var baseColor: vec4f=(textureColor*uniforms.textureMask+( vec4f(1.,1.,1.,1.)-uniforms.textureMask))*input.vColor;
#ifdef PREPASS
let geometryAlbedo: vec3f=toLinearSpaceVec3(baseColor.rgb);
#endif
#ifdef RAMPGRADIENT
var alpha: f32=baseColor.a;var remappedColorIndex: f32=clamp((alpha-input.remapRanges.x)/input.remapRanges.y,0.0,1.0);var rampColor: vec4f=textureSample(rampSampler,rampSamplerSampler,vec2f(1.0-remappedColorIndex,0.));baseColor=vec4f(baseColor.rgb*rampColor.rgb,baseColor.a);var finalAlpha: f32=baseColor.a;baseColor.a=clamp((alpha*rampColor.a-input.remapRanges.z)/input.remapRanges.w,0.0,1.0);
#endif
#ifdef BLENDMULTIPLYMODE
var sourceAlpha: f32=input.vColor.a*textureColor.a;baseColor=vec4f(baseColor.rgb*sourceAlpha+ vec3f(1.0)*(1.0-sourceAlpha),baseColor.a);
#endif
#include<logDepthFragment>
#include<fogFragment>(color,baseColor)
#ifdef IMAGEPROCESSINGPOSTPROCESS
baseColor=vec4f(toLinearSpaceVec3(baseColor.rgb),baseColor.a);
#else
#ifdef IMAGEPROCESSING
baseColor=vec4f(toLinearSpaceVec3(baseColor.rgb),baseColor.a);baseColor=applyImageProcessing(baseColor);
#endif
#endif
#ifdef PREPASS
let geometryColor: vec4f=baseColor;if (geometryColor.a<=0.0 && uniforms.geometryZeroAlphaDiscard>0.0) {discard;}
#ifdef PREPASS_POSITION
let geometryPositionW: vec3f=input.vGeometryPositionW;
#endif
#ifdef PREPASS_LOCAL_POSITION
let geometryPositionL: vec3f=input.vPosition;
#endif
#ifdef PREPASS_DEPTH
let geometryViewDepth: f32=input.vViewPos.z;
#endif
#ifdef PREPASS_NORMALIZED_VIEW_DEPTH
let geometryNormalizedViewDepth: f32=input.vNormViewDepth;
#endif
#ifdef PREPASS_NORMAL
let geometryNormalV: vec3f=normalize(input.vGeometryNormalV);
#endif
#ifdef PREPASS_WORLD_NORMAL
let geometryNormalW: vec3f=normalize(input.vGeometryNormalW);
#endif
#include<geometryRenderingFragment>
#else
fragmentOutputs.color=baseColor;
#endif
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStoreWGSL[a]||(e.ShadersStoreWGSL[a]=o);const P=[i,n,l,m,p,S,s,c,f,d,g,t,u];for(const r of P)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const O={name:a,shader:o};export{O as particlesPixelShaderWGSL};
