import{b6 as e}from"./index-CTe2nUuT.js";import{b as o,a as t}from"./bakedVertexAnimationDeclaration-d2ngX5ye.js";import{c as a,a as c}from"./clipPlaneVertex-CHJ9B3mv.js";import{f}from"./fogVertexDeclaration-CJOxCdCW.js";import{i as s}from"./instancesDeclaration-D4G1bmYi.js";import{i as d}from"./instancesVertex-LRjqNUf0.js";import{b as l,a as S}from"./bakedVertexAnimation-CC7o8cuh.js";import{f as m}from"./fogVertex-mQi6N6el.js";import{v as x}from"./vertexColorMixing-B8ObFKl6.js";const i="colorVertexShader",n=`attribute position: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#ifdef FOG
uniform view: mat4x4f;
#endif
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
varying vColor: vec4f;
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
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#include<clipPlaneVertex>
#include<fogVertex>
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=n);const u=[o,t,a,f,s,d,l,S,c,m,x];for(const r of u)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const b={name:i,shader:n};export{b as colorVertexShaderWGSL};
