import{b6 as e}from"./index-BncxKkTR.js";import{b as n,a as o}from"./bakedVertexAnimationDeclaration---THiHRQ.js";import{i as a}from"./instancesDeclaration-DT9OJVNv.js";import{c as f,a as s}from"./clipPlaneVertex-CLTTh_4P.js";import{logDepthDeclarationWGSL as l}from"./logDepthDeclaration-DmIB2266.js";import{f as c}from"./fogVertexDeclaration-BxsbSxd0.js";import{l as d}from"./lightVxFragmentDeclaration-iOgtQsM9.js";import{l as v,s as u}from"./shadowsVertex-BwnGU30-.js";import{i as m}from"./instancesVertex-CSutb2Z0.js";import{b as x,a as S}from"./bakedVertexAnimation-DKiHqIjb.js";import{l as p}from"./logDepthVertex-D9HCzIGd.js";import{f as V}from"./fogVertex-CcsmCUNb.js";import{v as L}from"./vertexColorMixing-C3Ej13ig.js";const t="gradientVertexShader",r=`attribute position: vec3f;
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
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;varying vPosition: vec3f;
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
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;vertexOutputs.vPositionW= worldPos.xyz;vertexOutputs.vPosition=vertexInputs.position;
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
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[t]||(e.ShadersStoreWGSL[t]=r);const W=[n,o,a,f,l,c,d,v,m,x,S,s,p,V,u,L];for(const i of W)e.IncludesShadersStoreWGSL[i.name]||(e.IncludesShadersStoreWGSL[i.name]=i.shader);const R={name:t,shader:r};export{R as gradientVertexShaderWGSL};
