import{b6 as e}from"./index-Bsw09bT6.js";import{b as o,a as n}from"./bakedVertexAnimationDeclaration-b8TQwfhM.js";import{i as f}from"./instancesDeclaration-v3lFZaRq.js";import{c as a,a as s}from"./clipPlaneVertex-F7KOkHBR.js";import{logDepthDeclarationWGSL as v}from"./logDepthDeclaration-CJZrA-cO.js";import{f as d}from"./fogVertexDeclaration-DfaTF9oo.js";import{i as c}from"./instancesVertex-BIRaC_0h.js";import{b as u,a as l}from"./bakedVertexAnimation-BUqJYHeE.js";import{l as x}from"./logDepthVertex-BYSPbqVt.js";import{f as p}from"./fogVertex-CE516Xgd.js";import{v as m}from"./vertexColorMixing-BnKztH0G.js";const i="fireVertexShader",r=`attribute position: vec3f;
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
varying vDiffuseUV: vec2f;
#endif
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;
#ifdef VERTEXCOLOR
varying vColor: vec4f;
#endif
#include<clipPlaneVertexDeclaration>
#include<logDepthDeclaration>
#include<fogVertexDeclaration>
uniform time: f32;uniform speed: f32;
#ifdef DIFFUSE
varying vDistortionCoords1: vec2f;varying vDistortionCoords2: vec2f;varying vDistortionCoords3: vec2f;
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
#ifdef DIFFUSE
vertexOutputs.vDiffuseUV=vec2f(vertexInputs.uv.x,vertexInputs.uv.y-0.2);
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#include<vertexColorMixing>
#ifdef DIFFUSE
var layerSpeed: vec3f= vec3f(-0.2,-0.52,-0.1)*uniforms.speed;vertexOutputs.vDistortionCoords1=vec2f(vertexInputs.uv.x,vertexInputs.uv.y+layerSpeed.x*uniforms.time/1000.0);vertexOutputs.vDistortionCoords2=vec2f(vertexInputs.uv.x,vertexInputs.uv.y+layerSpeed.y*uniforms.time/1000.0);vertexOutputs.vDistortionCoords3=vec2f(vertexInputs.uv.x,vertexInputs.uv.y+layerSpeed.z*uniforms.time/1000.0);
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[i]||(e.ShadersStoreWGSL[i]=r);const S=[o,n,f,a,v,d,c,u,l,s,x,p,m];for(const t of S)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);const C={name:i,shader:r};export{C as fireVertexShaderWGSL};
