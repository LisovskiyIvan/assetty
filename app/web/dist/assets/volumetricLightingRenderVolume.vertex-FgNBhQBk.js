import{b6 as e}from"./index-BncxKkTR.js";import{s as n}from"./sceneUboDeclaration-p9EFTo9q.js";import{m as s}from"./meshUboDeclaration-B0htINa3.js";const r="volumetricLightingRenderVolumeVertexShader",t=`#include<sceneUboDeclaration>
#include<meshUboDeclaration>
attribute position : vec3f;varying vWorldPos: vec4f;@vertex
fn main(input : VertexInputs)->FragmentInputs {let worldPos=mesh.world*vec4f(vertexInputs.position,1.0);vertexOutputs.vWorldPos=worldPos;vertexOutputs.position=scene.viewProjection*worldPos;}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=t);const i=[n,s];for(const o of i)e.IncludesShadersStoreWGSL[o.name]||(e.IncludesShadersStoreWGSL[o.name]=o.shader);const l={name:r,shader:t};export{l as volumetricLightingRenderVolumeVertexShaderWGSL};
