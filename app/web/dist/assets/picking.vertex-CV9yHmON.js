import{b6 as e}from"./index-q74-en5_.js";import{b as n,a as i}from"./bakedVertexAnimationDeclaration-ZbvhFfg_.js";import{m as o,a as s}from"./morphTargetsVertexDeclaration-Gfk8eI5U.js";import{i as c}from"./instancesDeclaration-CLavv7KV.js";import{m as d,a as m}from"./morphTargetsVertex-CSbq5VJv.js";import{i as l}from"./instancesVertex-FfLDjFzF.js";import{b as S,a as p}from"./bakedVertexAnimation-DoGvwL1H.js";const r="pickingVertexShader",a=`attribute position: vec3f;
#if defined(INSTANCES)
attribute instanceMeshID: f32;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
#if defined(INSTANCES)
flat varying vMeshID: f32;
#endif
@vertex
fn main(input : VertexInputs)->FragmentInputs {var positionUpdated: vec3f=vertexInputs.position;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
var worldPos: vec4f=finalWorld*vec4f(positionUpdated,1.0);vertexOutputs.position=uniforms.viewProjection*worldPos;
#if defined(INSTANCES)
vertexOutputs.vMeshID=vertexInputs.instanceMeshID;
#endif
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=a);const f=[n,i,o,s,c,d,m,l,S,p];for(const t of f)e.IncludesShadersStoreWGSL[t.name]||(e.IncludesShadersStoreWGSL[t.name]=t.shader);const W={name:r,shader:a};export{W as pickingVertexShaderWGSL};
