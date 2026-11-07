import{b6 as e}from"./index-CTe2nUuT.js";import{b as n,a as f}from"./bakedVertexAnimationDeclaration-d2ngX5ye.js";import{i as o}from"./instancesDeclaration-D4G1bmYi.js";import{c as a,a as s}from"./clipPlaneVertex-CHJ9B3mv.js";import{logDepthDeclarationWGSL as c}from"./logDepthDeclaration-Da-ALNxN.js";import{f as l}from"./fogVertexDeclaration-CJOxCdCW.js";import{l as u}from"./lightVxFragmentDeclaration-DJT3dJ4C.js";import{l as d,s as v}from"./shadowsVertex-B4X12M9M.js";import{i as m}from"./instancesVertex-LRjqNUf0.js";import{b as x,a as S}from"./bakedVertexAnimation-CC7o8cuh.js";import{l as p}from"./logDepthVertex-Cwleo3q6.js";import{f as V}from"./fogVertex-mQi6N6el.js";const t="normalVertexShader",r=`attribute position: vec3f;
#ifdef NORMAL
attribute normal: vec3f;
#endif
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
uniform view: mat4x4f;uniform viewProjection: mat4x4f;
#ifdef DIFFUSE
varying vDiffuseUV: vec2f;uniform diffuseMatrix: mat4x4f;uniform vDiffuseInfos: vec2f;
#endif
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;
#ifdef NORMAL
varying vNormalW: vec3f;
#endif
#include<clipPlaneVertexDeclaration>
#include<logDepthDeclaration>
#include<fogVertexDeclaration>
#include<__decl__lightVxFragment>[0..maxSimultaneousLights]
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying vViewDepth: f32;
#endif
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#define CUSTOM_VERTEX_MAIN_BEGIN
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;vertexOutputs.vPositionW= worldPos.xyz;
#ifdef NORMAL
vertexOutputs.vNormalW=normalize(( finalWorld* vec4f(vertexInputs.normal,0.0)).xyz);
#endif
#ifndef UV1
var uv: vec2f= vec2f(0.,0.);
#else
var uv: vec2f=vertexInputs.uv;
#endif
#ifndef UV2
var uv2: vec2f= vec2f(0.,0.);
#else
var uv2: vec2f=vertexInputs.uv2;
#endif
#ifdef DIFFUSE
if (uniforms.vDiffuseInfos.x==0.)
{vertexOutputs.vDiffuseUV=(uniforms.diffuseMatrix* vec4f(uv,1.0,0.0)).xy;}
else
{vertexOutputs.vDiffuseUV=(uniforms.diffuseMatrix* vec4f(uv2,1.0,0.0)).xy;}
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=r);const L=[n,f,o,a,c,l,u,d,m,x,S,s,p,V,v];for(const i of L)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const N={name:t,shader:r};export{N as normalVertexShaderWGSL};
