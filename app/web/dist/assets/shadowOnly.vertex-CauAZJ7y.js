import{b6 as e}from"./index-68vxHCPz.js";import{b as r,a as o}from"./bakedVertexAnimationDeclaration-BAB5LZ-a.js";import{i as a}from"./instancesDeclaration-mOWHHX9T.js";import{s}from"./sceneUboDeclaration-BiDzVn4p.js";import{c as l,a as c}from"./clipPlaneVertex-ChHHPYFo.js";import{logDepthDeclarationWGSL as f}from"./logDepthDeclaration-Fwe0exDD.js";import{f as d}from"./fogVertexDeclaration-CqexocT7.js";import{l as m}from"./lightVxFragmentDeclaration-Bf-bmzou.js";import{l as S,s as x}from"./shadowsVertex-CketW4ST.js";import{i as u}from"./instancesVertex-DGAPi2oz.js";import{b as p,a as L}from"./bakedVertexAnimation-GrQNXWr5.js";import{l as V}from"./logDepthVertex-Df4lGivn.js";import{f as W}from"./fogVertex-CbzjUwCL.js";const t="shadowOnlyVertexShader",n=`attribute position: vec3f;
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
