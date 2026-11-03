import{b6 as e}from"./index-q74-en5_.js";import{b as n,a as f}from"./bakedVertexAnimationDeclaration-ZbvhFfg_.js";import{i as o}from"./instancesDeclaration-CLavv7KV.js";import{c as a,a as s}from"./clipPlaneVertex-XsC562Go.js";import{logDepthDeclarationWGSL as l}from"./logDepthDeclaration-BM_ogoKS.js";import{f as c}from"./fogVertexDeclaration-Cj8iNTa2.js";import{l as d}from"./lightVxFragmentDeclaration-_ECJJ9mZ.js";import{l as u,s as v}from"./shadowsVertex-wElYCtcL.js";import{i as m}from"./instancesVertex-FfLDjFzF.js";import{b as x,a as S}from"./bakedVertexAnimation-DoGvwL1H.js";import{f as p}from"./fogVertex-Bg21qlY6.js";import{v as V}from"./vertexColorMixing-Cqr6m4m9.js";import{l as L}from"./logDepthVertex-DgLnkTkn.js";const t="cellVertexShader",r=`attribute position: vec3f;
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
#ifdef VERTEXCOLOR
varying vColor: vec4f;
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
#ifdef VERTEXCOLOR
var colorUpdated: vec4f=vertexInputs.color;
#endif
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
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#include<logDepthVertex>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=r);const D=[n,f,o,a,l,c,d,u,m,x,S,s,p,v,V,L];for(const i of D)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const N={name:t,shader:r};export{N as cellVertexShaderWGSL};
