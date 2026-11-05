import{b6 as e}from"./index-68vxHCPz.js";import{b as i,a as o}from"./bakedVertexAnimationDeclaration-BAB5LZ-a.js";import{m as n,a as s}from"./morphTargetsVertexDeclaration-Dw7qOt1C.js";import{c as f,a as d}from"./clipPlaneVertex-ChHHPYFo.js";import{i as l}from"./instancesDeclaration-mOWHHX9T.js";import{logDepthDeclarationWGSL as c}from"./logDepthDeclaration-Fwe0exDD.js";import{m as u,a as m}from"./morphTargetsVertex-DHZynmWc.js";import{i as p}from"./instancesVertex-DGAPi2oz.js";import{b as x,a as v}from"./bakedVertexAnimation-GrQNXWr5.js";import{l as S}from"./logDepthVertex-Df4lGivn.js";const r="outlineVertexShader",a=`attribute position: vec3f;attribute normal: vec3f;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
uniform offset: f32;
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#ifdef ALPHATEST
varying vUV: vec2f;uniform diffuseMatrix: mat4x4f; 
#ifdef UV1
attribute uv: vec2f;
#endif
#ifdef UV2
attribute uv2: vec2f;
#endif
#endif
#include<logDepthDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input: VertexInputs)->FragmentInputs {var positionUpdated: vec3f=vertexInputs.position;var normalUpdated: vec3f=vertexInputs.normal;
#ifdef UV1
var uvUpdated: vec2f=vertexInputs.uv;
#endif
#ifdef UV2
var uv2Updated: vec2f=vertexInputs.uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
var offsetPosition: vec3f=positionUpdated+(normalUpdated*uniforms.offset);
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld*vec4f(offsetPosition,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uvUpdated,1.0,0.0)).xy;
#endif
#ifdef UV2
vertexOutputs.vUV=(uniforms.diffuseMatrix*vec4f(uv2Updated,1.0,0.0)).xy;
#endif
#endif
#include<clipPlaneVertex>
#include<logDepthVertex>
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=a);const V=[i,o,n,s,f,l,c,u,m,p,x,v,d,S];for(const t of V)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);const I={name:r,shader:a};export{I as outlineVertexShaderWGSL};
