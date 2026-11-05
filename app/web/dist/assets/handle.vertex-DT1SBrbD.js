import{b6 as t}from"./index-68vxHCPz.js";const e="handleVertexShader",o=`attribute position: vec3f;uniform positionOffset: vec3f;uniform worldViewProjection: mat4x4f;uniform scale: f32;@vertex
fn main(input: VertexInputs)->FragmentInputs {let vPos: vec4f=vec4f((vertexInputs.position+uniforms.positionOffset)*uniforms.scale,1.0);vertexOutputs.position=uniforms.worldViewProjection*vPos;}
`;t.ShadersStoreWGSL[e]||(t.ShadersStoreWGSL[e]=o);const n={name:e,shader:o};export{n as handleVertexShaderWGSL};
