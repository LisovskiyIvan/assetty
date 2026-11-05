import{b6 as e}from"./index-ymQalFtf.js";import{b as r,a as o}from"./bakedVertexAnimationDeclaration-BTdJZSmI.js";import{i as a}from"./instancesDeclaration-C7S4LLBl.js";import{s}from"./sceneUboDeclaration-D9iQQ5fk.js";import{c as l,a as c}from"./clipPlaneVertex-CgqhcpjC.js";import{logDepthDeclarationWGSL as f}from"./logDepthDeclaration-Dxkm0Eov.js";import{f as d}from"./fogVertexDeclaration-_UZX-v7-.js";import{l as m}from"./lightVxFragmentDeclaration-Dg9-rURO.js";import{l as S,s as x}from"./shadowsVertex-D957PJEJ.js";import{i as u}from"./instancesVertex-Br6G4iGc.js";import{b as p,a as L}from"./bakedVertexAnimation-8Ceuk334.js";import{l as V}from"./logDepthVertex-ClP8dXXb.js";import{f as W}from"./fogVertex-BtN5rAD_.js";const t="shadowOnlyVertexShader",n=`attribute position: vec3f;
#ifdef NORMAL
attribute normal: vec3f;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<sceneUboDeclaration>
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
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=scene.viewProjection*worldPos;vertexOutputs.vPositionW= worldPos.xyz;
#ifdef NORMAL
vertexOutputs.vNormalW=normalize(( finalWorld* vec4f(vertexInputs.normal,0.0)).xyz);
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=n);const v=[r,o,a,s,l,f,d,m,S,u,p,L,c,V,W,x];for(const i of v)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const w={name:t,shader:n};export{w as shadowOnlyVertexShaderWGSL};
