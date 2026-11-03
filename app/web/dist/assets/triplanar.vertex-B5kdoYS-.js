import{b6 as e}from"./index-CR91ZdlI.js";import{helperFunctionsWGSL as a}from"./helperFunctions-BWnqPFV5.js";import{b as o,a as t}from"./bakedVertexAnimationDeclaration-CeYbbYKh.js";import{i as l}from"./instancesDeclaration-CnZGDfaU.js";import{c as f,a as d}from"./clipPlaneVertex-C94V7ujL.js";import{logDepthDeclarationWGSL as m}from"./logDepthDeclaration-DLlF61b8.js";import{f as c}from"./fogVertexDeclaration-DpUjaiS-.js";import{l as s}from"./lightVxFragmentDeclaration-BLGX6_R4.js";import{l as v,s as x}from"./shadowsVertex--TKgcK2w.js";import{i as u}from"./instancesVertex-ImYHZdrA.js";import{b as S,a as p}from"./bakedVertexAnimation-4Tg0zbAh.js";import{l as V}from"./logDepthVertex-CbId5ZKY.js";import{f as g}from"./fogVertex-UPaMiCQP.js";import{v as z}from"./vertexColorMixing-D0Fs6rFg.js";const n="triplanarVertexShader",i=`attribute position: vec3f;
#ifdef NORMAL
attribute normal: vec3f;
#endif
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
#include<helperFunctions>
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
uniform view: mat4x4f;uniform viewProjection: mat4x4f;
#ifdef DIFFUSEX
varying vTextureUVX: vec2f;
#endif
#ifdef DIFFUSEY
varying vTextureUVY: vec2f;
#endif
#ifdef DIFFUSEZ
varying vTextureUVZ: vec2f;
#endif
uniform tileSize: f32;
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;
#ifdef NORMAL
varying tangentSpace0: vec3f;varying tangentSpace1: vec3f;varying tangentSpace2: vec3f;
#endif
#if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
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
fn main(input : VertexInputs)->FragmentInputs
{
#define CUSTOM_VERTEX_MAIN_BEGIN
#ifdef VERTEXCOLOR
var colorUpdated: vec4f=vertexInputs.color;
#endif
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld* vec4f(vertexInputs.position,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;vertexOutputs.vPositionW= worldPos.xyz;
#ifdef DIFFUSEX
vertexOutputs.vTextureUVX=worldPos.zy/uniforms.tileSize;
#endif
#ifdef DIFFUSEY
vertexOutputs.vTextureUVY=worldPos.xz/uniforms.tileSize;
#endif
#ifdef DIFFUSEZ
vertexOutputs.vTextureUVZ=worldPos.xy/uniforms.tileSize;
#endif
#ifdef NORMAL
var xtan: vec3f= vec3f(0,0,1);var xbin: vec3f= vec3f(0,1,0);var ytan: vec3f= vec3f(1,0,0);var ybin: vec3f= vec3f(0,0,1);var ztan: vec3f= vec3f(1,0,0);var zbin: vec3f= vec3f(0,1,0);var normalizedNormal: vec3f=normalize(vertexInputs.normal);normalizedNormal=normalizedNormal*normalizedNormal;var worldBinormal: vec3f=normalize(xbin*normalizedNormal.x+ybin*normalizedNormal.y+zbin*normalizedNormal.z);var worldTangent: vec3f=normalize(xtan*normalizedNormal.x+ytan*normalizedNormal.y+ztan*normalizedNormal.z);var normalWorld: mat3x3f= mat3x3f(finalWorld[0].xyz,finalWorld[1].xyz,finalWorld[2].xyz);
#ifdef NONUNIFORMSCALING
normalWorld=transposeMat3(inverseMat3(normalWorld));
#endif
worldTangent=normalize((normalWorld*worldTangent).xyz);worldBinormal=normalize((normalWorld*worldBinormal).xyz);var worldNormal: vec3f=normalize((normalWorld*normalize(vertexInputs.normal)).xyz);vertexOutputs.tangentSpace0=worldTangent;vertexOutputs.tangentSpace1=worldBinormal;vertexOutputs.tangentSpace2=worldNormal;
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<shadowsVertex>[0..maxSimultaneousLights]
#include<vertexColorMixing>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[n]||(e.ShadersStoreWGSL[n]=i);const L=[a,o,t,l,f,m,c,s,v,u,S,p,d,V,g,x,z];for(const r of L)e.IncludesShadersStoreWGSL[r.name]||(e.IncludesShadersStoreWGSL[r.name]=r.shader);const C={name:n,shader:i};export{C as triplanarVertexShaderWGSL};
